/**
 * Судья попаданий (SPEC §4.7, §6).
 *
 * Единица счёта — группа (аккорд): ноты нажимаемой партии, начавшие звучать
 * в пределах CHORD_EPS_SEC, считаются одним аккордом. Группа засчитана,
 * если в окне попадания нажата хотя бы одна её нота — митигация ghosting
 * (SPEC §6: счёт не карает потерю ноты аккорда, если ≥1 нота нажата).
 * Вариант «ждать все ноты аккорда» включается requireFullChord.
 *
 * Ошибки (метки SPEC §4.7 «рано/поздно/мимо/лишняя»):
 *   early — правильный питч нажат до окна;
 *   late  — правильный питч нажат после окна (группа уже пропущена);
 *   miss  — «мимо»: нота/аккорд прошли без правильного нажатия;
 *   wrong — «мимо»: нажата не та клавиша, когда рядом ожидалась нота;
 *   extra — «лишняя нота»: нажатие без ожидаемых нот поблизости.
 *
 * Времена — музыкальные (секунды сетки мелодии); судья не знает про аудио-часы.
 */
import type { Note } from "../core/types";

export type ScoreErrorKind = "early" | "late" | "miss" | "wrong" | "extra";

/** Русские метки ошибок для UI (SPEC §4.7). */
export const SCORE_ERROR_LABELS: Record<ScoreErrorKind, string> = {
  early: "рано",
  late: "поздно",
  miss: "мимо",
  wrong: "мимо",
  extra: "лишняя нота",
};

export interface ScoreError {
  kind: ScoreErrorKind;
  /** Момент нажатия/ноты в секундах мелодии. */
  timeSec: number;
  /** Питч нажатой клавиши; null для пропуска целой группы. */
  pitch: number | null;
}

/** Группа (аккорд) нажимаемой партии — единица счёта. */
export interface ChordGroup {
  timeSec: number;
  notes: readonly Note[];
  /** Индексы ещё не накрытых нажатиями нот. */
  pending: Set<number>;
  /** Засчитана (≥1 нота в окне — митигация ghosting). */
  hit: boolean;
  /** Прошла мимо: окно истекло без правильного нажатия. */
  missed: boolean;
  hitCount: number;
}

/** Итог прохождения (GLOSSARY: счёт прохождения). */
export interface ScoreResult {
  /** Процент засчитанных групп, 0–100. */
  hitPercent: number;
  /** Текущий стрик: подряд засчитанные группы без ошибок. */
  streak: number;
  bestStreak: number;
  hitGroups: number;
  totalGroups: number;
  errors: readonly ScoreError[];
}

export type PressVerdictKind = "hit" | "early" | "late" | "wrong" | "extra";

export interface PressVerdict {
  kind: PressVerdictKind;
  group: ChordGroup | null;
  note: Note | null;
}

/** Окно попадания по умолчанию ±150 мс (SPEC §4.3). */
export const DEFAULT_HIT_WINDOW_SEC = 0.15;
export const MIN_HIT_WINDOW_SEC = 0.05;
export const MAX_HIT_WINDOW_SEC = 0.3;

/** Ноты со стартами в этом разбеге — один аккорд. */
const CHORD_EPS_SEC = 0.03;
/** Кандидаты ищем вдвое шире окна: за его пределами фиксируются рано/поздно. */
const CANDIDATE_FACTOR = 2;

/** Черновик группы на сборке: notes ещё расширяются (ChordGroup отдаёт readonly). */
interface ChordGroupDraft {
  timeSec: number;
  notes: Note[];
  pending: Set<number>;
  hit: boolean;
  missed: boolean;
  hitCount: number;
}

/** Группировка нот нажимаемой партии в аккорды по времени старта. */
export function groupNotes(notes: readonly Note[]): ChordGroup[] {
  const groups: ChordGroupDraft[] = [];
  for (const note of notes) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(note.startTimeSec - last.timeSec) <= CHORD_EPS_SEC) {
      last.notes.push(note);
      last.pending.add(last.notes.length - 1);
    } else {
      groups.push({
        timeSec: note.startTimeSec,
        notes: [note],
        pending: new Set<number>([0]),
        hit: false,
        missed: false,
        hitCount: 0,
      });
    }
  }
  return groups;
}

export class Judge {
  private groups: ChordGroup[] = [];
  private streak = 0;
  private bestStreak = 0;
  private hitGroups = 0;
  private readonly errors: ScoreError[] = [];
  private hitWindow: number;
  private readonly requireFullChord: boolean;

  constructor(hitWindowSec = DEFAULT_HIT_WINDOW_SEC, requireFullChord = false) {
    this.hitWindow = clampHitWindow(hitWindowSec);
    this.requireFullChord = requireFullChord;
  }

  get hitWindowSec(): number {
    return this.hitWindow;
  }

  setHitWindowSec(sec: number): void {
    this.hitWindow = clampHitWindow(sec);
  }

  /** Новая попытка: группы строятся из нот нажимаемой партии. */
  reset(notes: readonly Note[]): void {
    this.groups = groupNotes(notes);
    this.streak = 0;
    this.bestStreak = 0;
    this.hitGroups = 0;
    this.errors.length = 0;
  }

  /** Первая незавершённая группа — «следующая ожидаемая» (wait-mode, инвариант #5). */
  get nextGroup(): ChordGroup | null {
    for (const group of this.groups) {
      if (!group.hit && !group.missed) return group;
    }
    return null;
  }

  /** Питчи ожидаемой группы (подсветка wait-mode). */
  expectedPitches(): Set<number> {
    const out = new Set<number>();
    const group = this.nextGroup;
    if (!group) return out;
    for (const idx of group.pending) {
      const note = group.notes[idx];
      if (note) out.add(note.pitch);
    }
    return out;
  }

  /** Питчи всех несыгранных нот нажимаемой партии (подсветка вне wait-mode). */
  pendingPlayablePitches(): Set<number> {
    const out = new Set<number>();
    for (const group of this.groups) {
      if (group.hit || group.missed) continue;
      for (const idx of group.pending) {
        const note = group.notes[idx];
        if (note) out.add(note.pitch);
      }
    }
    return out;
  }

  /**
   * Нажатие клавиши в момент songTime. В wait-mode время замерло на gates,
   * поэтому правильное нажатие даёт Δ=0 и засчитывается по питчу.
   */
  onPress(pitch: number, songTime: number): PressVerdict {
    const wide = this.hitWindow * CANDIDATE_FACTOR;
    let best: ChordGroup | null = null;
    let bestIdx = -1;
    let bestAbs = Infinity;
    let anyPendingNear = false;

    for (const group of this.groups) {
      if (group.hit || group.missed) continue;
      const dt = songTime - group.timeSec;
      if (Math.abs(dt) > wide) continue;
      anyPendingNear = true;
      let idx = -1;
      for (const i of group.pending) {
        const note = group.notes[i];
        if (note && note.pitch === pitch) {
          idx = i;
          break;
        }
      }
      if (idx === -1) continue;
      const abs = Math.abs(dt);
      if (abs < bestAbs) {
        bestAbs = abs;
        best = group;
        bestIdx = idx;
      }
    }

    if (best && bestIdx >= 0) {
      if (bestAbs <= this.hitWindow) {
        const note = best.notes[bestIdx] ?? null;
        best.pending.delete(bestIdx);
        best.hitCount += 1;
        const enough = this.requireFullChord ? best.pending.size === 0 : true;
        if (!best.hit && enough) {
          best.hit = true;
          this.hitGroups += 1;
          this.streak += 1;
          this.bestStreak = Math.max(this.bestStreak, this.streak);
        }
        return { kind: "hit", group: best, note };
      }
      const kind: PressVerdictKind = songTime < best.timeSec ? "early" : "late";
      this.registerError(kind, songTime, pitch);
      return { kind, group: best, note: null };
    }

    // Питч не совпал ни с одной ожидающейся нотой. Возможно, нажали правильную
    // клавишу по уже пропущенной группе — это «поздно», не «не та клавиша».
    for (const group of this.groups) {
      if (!group.missed) continue;
      const dt = songTime - group.timeSec;
      if (dt <= this.hitWindow || dt > wide) continue;
      for (const note of group.notes) {
        if (note.pitch === pitch) {
          this.registerError("late", songTime, pitch);
          return { kind: "late", group, note: null };
        }
      }
    }

    if (anyPendingNear) {
      this.registerError("wrong", songTime, pitch);
      return { kind: "wrong", group: null, note: null };
    }
    this.registerError("extra", songTime, pitch);
    return { kind: "extra", group: null, note: null };
  }

  /**
   * Ход времени (каждый кадр): группы, чьё окно истекло без правильного
   * нажатия, получают «мимо». В wait-mode время стоит — истечений нет.
   */
  update(songTime: number): void {
    for (const group of this.groups) {
      if (group.hit || group.missed) continue;
      if (songTime > group.timeSec + this.hitWindow) {
        group.missed = true;
        this.registerError("miss", group.timeSec, null);
      }
    }
  }

  get result(): ScoreResult {
    const total = this.groups.length;
    const hitPercent = total === 0 ? 0 : (this.hitGroups / total) * 100;
    return {
      hitPercent,
      streak: this.streak,
      bestStreak: this.bestStreak,
      hitGroups: this.hitGroups,
      totalGroups: total,
      errors: [...this.errors],
    };
  }

  private registerError(kind: ScoreErrorKind, timeSec: number, pitch: number | null): void {
    this.streak = 0;
    if (this.errors.length < 500) this.errors.push({ kind, timeSec, pitch });
  }
}

function clampHitWindow(sec: number): number {
  if (!Number.isFinite(sec)) return DEFAULT_HIT_WINDOW_SEC;
  return Math.min(MAX_HIT_WINDOW_SEC, Math.max(MIN_HIT_WINDOW_SEC, sec));
}
