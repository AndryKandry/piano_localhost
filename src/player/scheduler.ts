/**
 * Lookahead-планировщик автоплея/автопартии (ADR-002 п.2, «A Tale of Two
 * Clocks»): неточный JS-таймер (~25 мс) только опрашивает очередь, звук
 * планируется точными вызовами с абсолютным временем на аудио-часах на ~100 мс
 * вперёд. В wait-mode ноты нажимаемой партии не планируются вовсе — host
 * возвращает null для времён за гейтом, и они звучат по факту нажатия.
 *
 * Второй канал — тики метронома (SPEC §4.3, PIANO-15): те же гейт/lookahead/
 * LATE_SKIP-правила, что у нот, поэтому тик за гейтом не планируется — тик
 * открывшейся доли звучит при открытии гейта.
 *
 * Никакой синхронизации через performance.now/Date.now — только TimeSource
 * (инвариант GLOSSARY #2).
 */
import type { TimeSource } from "../core/clock";
import type { Note, TempoChange } from "../core/types";
import type { AudioNoteTarget, MetronomeTarget } from "./player";

/** Чего планирует плеер (реализуется Player). */
export interface SchedulerHost {
  /** Аудио-время для музыкального; null — время стоит (пауза/wait-mode гейт). */
  audioTimeFor(songTime: number): number | null;
  /** Длительность ноты в секундах стены (учитывает множитель скорости). */
  wallDurationSec(songDurationSec: number): number;
}

/** Тик планировщика (research 01: 25 мс). */
export const SCHEDULER_TICK_MS = 25;
/** Окно планирования вперёд по аудио-часам (research 01: 100 мс). */
export const SCHEDULER_LOOKAHEAD_SEC = 0.1;
/** Безнадёжно опоздавшие ноты (фоновая вкладка душит таймер) не играются. */
const LATE_SKIP_SEC = 0.25;

/** Запланированный тик метронома: доля мелодии и её акцент (1-я доля такта). */
export interface MetronomeTickPlan {
  /** Момент доли в секундах мелодии. */
  timeSec: number;
  /** 1-я доля такта — акцент (тик 2000 Гц вместо 800). */
  accent: boolean;
}

/**
 * Размер такта метронома: 4/4. Размера файла в модели Melody нет (v1 его не
 * импортирует), MIDI-дефолт — 4/4; с появлением timeSignature в модели —
 * заменить на данные мелодии.
 */
export const METRONOME_BEATS_PER_BAR = 4;
/** Темп, когда темповая карта пуста (тот же дефолт, что import/shared). */
const FALLBACK_BPM = 120;
/** Предохранитель: битая карта (bpm→∞) не должна порождать миллионы тиков. */
const MAX_TICKS = 20000;

/**
 * Сетка долей метронома по темповой карте: четверти, до untilSec. Смена BPM
 * перезапускает доли от момента смены — как ноты, чьё время посчитано по той
 * же карте. Акцент — каждая beatsPerBar-я доля по счёту от начала.
 * Чистая функция: тесты и плеер не зависят от аудио.
 */
export function metronomeTicks(
  tempoMap: readonly TempoChange[],
  untilSec: number,
  beatsPerBar: number = METRONOME_BEATS_PER_BAR,
): MetronomeTickPlan[] {
  if (!(untilSec > 0)) return [];
  const bar = beatsPerBar > 0 ? Math.floor(beatsPerBar) : METRONOME_BEATS_PER_BAR;
  const changes: readonly TempoChange[] =
    tempoMap.length > 0 ? tempoMap : [{ timeSec: 0, bpm: FALLBACK_BPM }];
  const ticks: MetronomeTickPlan[] = [];
  for (let i = 0; i < changes.length && ticks.length < MAX_TICKS; i += 1) {
    const change = changes[i];
    if (!change) break;
    const segEnd = i + 1 < changes.length ? (changes[i + 1] as TempoChange).timeSec : untilSec;
    const beatSec = change.bpm > 0 ? 60 / change.bpm : Number.NaN;
    // Битый BPM или сегмент за концом мелодии — долей в нём нет.
    if (!Number.isFinite(beatSec) || segEnd <= change.timeSec) continue;
    for (let t = change.timeSec; t < segEnd - 1e-9 && ticks.length < MAX_TICKS; t += beatSec) {
      ticks.push({ timeSec: t, accent: ticks.length % bar === 0 });
    }
  }
  return ticks;
}

export class Scheduler {
  private notes: readonly Note[] = [];
  private index = 0;
  /** Тики метронома: тот же lookahead, отдельный курсор (смена мелодии/вкл-выкл). */
  private ticks: readonly MetronomeTickPlan[] = [];
  private tickIndex = 0;
  private metronome: MetronomeTarget | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly clock: TimeSource,
    private readonly engine: AudioNoteTarget,
    private readonly host: SchedulerHost,
  ) {}

  /** Запуск тика. Повторный вызов безвреден. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), SCHEDULER_TICK_MS);
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Новый набор нот автопартии (смена режима/партии/мелодии). */
  setNotes(notes: readonly Note[]): void {
    this.notes = notes;
    this.index = 0;
  }

  /** Новый набор тиков метронома (мелодия/вкл-выкл); курсор — в начало. */
  setTicks(ticks: readonly MetronomeTickPlan[]): void {
    this.ticks = ticks;
    this.tickIndex = 0;
  }

  /** Подключить звук метронома (null — выключить); план тиков ведёт Player. */
  setMetronome(target: MetronomeTarget | null): void {
    this.metronome = target;
  }

  /** Продвинуть курсоры мимо событий, чьё время уже прошло (позиция прыгнула). */
  resync(songTimeNow: number): void {
    while (this.index < this.notes.length) {
      const note = this.notes[this.index];
      if (!note || note.startTimeSec >= songTimeNow - 1e-6) break;
      this.index += 1;
    }
    while (this.tickIndex < this.ticks.length) {
      const planned = this.ticks[this.tickIndex];
      if (!planned || planned.timeSec >= songTimeNow - 1e-6) break;
      this.tickIndex += 1;
    }
  }

  /**
   * Один такт планирования. Публичен для smoke-проверки без setInterval.
   */
  tick(): void {
    const now = this.clock.currentTime();
    const horizon = now + SCHEDULER_LOOKAHEAD_SEC;
    while (this.index < this.notes.length) {
      const note = this.notes[this.index];
      if (!note) break;
      const at = this.host.audioTimeFor(note.startTimeSec);
      if (at === null) break; // время стоит — будущие ноты не планируются
      if (at > horizon) break;
      this.index += 1;
      if (at < now - LATE_SKIP_SEC) continue; // опоздала сверх меры — пропускаем
      // «Прямо сейчас» играем немедленно (research 01), иначе — точно в at.
      this.engine.playNote(note.pitch, note.velocity, Math.max(at, now), this.host.wallDurationSec(note.durationSec));
    }
    // Метроном: те же null-гейт / horizon / LATE_SKIP, что у нот выше.
    while (this.metronome !== null && this.tickIndex < this.ticks.length) {
      const planned = this.ticks[this.tickIndex];
      if (!planned) break;
      const at = this.host.audioTimeFor(planned.timeSec);
      if (at === null) break; // пауза или гейт wait-mode — тики не планируются
      if (at > horizon) break;
      this.tickIndex += 1;
      if (at < now - LATE_SKIP_SEC) continue; // давно пропущенная доля — мимо
      this.metronome.tick(Math.max(at, now), planned.accent);
    }
  }

  dispose(): void {
    this.stop();
    this.notes = [];
    this.index = 0;
    this.ticks = [];
    this.tickIndex = 0;
  }
}
