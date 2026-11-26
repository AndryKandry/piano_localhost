/**
 * Нотная тетрадь (SPEC §4.10, PIANO-12) — чистая логика БЕЗ DOM: генератор
 * тетрадей по уровням (rng внедрён — детерминируется в smoke) и судья
 * чтения с листа. Экран — primer/notebook-screen.ts, он только потребляет.
 *
 * Термины — GLOSSARY «Азбука»: нотная тетрадь (сгенерированная
 * последовательность тактов), чтение с листа (время не лимитировано — тетрадь
 * стоит на текущей ноте до верного нажатия), текущая нота тетради, уровень
 * тетради, попытка ноты («верно с первой» — попадание без промаха).
 *
 * Судья (SPEC §4.10): верное нажатие (питч) — продвижение; неверное — отметка
 * промаха на ноте (счёт попыток), позиция не двигается. Стрик — подряд
 * «верно с первой»: нота, взятая не с первой попытки, стрик рвёт (итог
 * «Верно с первой: N%» — главная метрика беглости).
 */
import type { StaffDuration } from "../notation/geometry";
import type { Rng } from "./types";

/** Уровень тетради (GLOSSARY: уровень тетради) — диапазон и ритм сложности. */
export type NotebookLevel = 1 | 2 | 3 | 4;

export const NOTEBOOK_LEVELS: readonly NotebookLevel[] = [1, 2, 3, 4];

/** Тактов в тетради (SPEC §4.10: 8 тактов 4/4). */
export const NOTEBOOK_MEASURE_COUNT = 8;

/** Ключ прогресса уровня в хранилище Азбуки (как у уроков, SPEC §4.10). */
export function notebookProgressKey(level: NotebookLevel): string {
  return `notebook-level-${level}`;
}

// --- Данные тетради ---

/** Нота тетради (GLOSSARY: головка нота/длительность; пауз в v1 нет). */
export interface NotebookNote {
  /** Питч, MIDI 0–127 (C4 = 60), натуральный — в маппинге C4–B5. */
  pitch: number;
  duration: StaffDuration;
  /** Пара восьмых под одним ребром (renderer.drawBeam; GLOSSARY: рёбра). */
  eighthGroup?: boolean;
}

/** Такт тетради: размер 4/4 — константа тетради v1 (GLOSSARY: такт, размер). */
export interface NotebookMeasure {
  /** Долей в такте (4/4 → 4 четверти). */
  beats: 4;
  items: NotebookNote[];
}

/** Тетрадь — 8 тактов одного уровня. */
export interface NotebookSheet {
  level: NotebookLevel;
  measures: NotebookMeasure[];
}

// --- Генерация (rng внедрён — тесты подставляют детерминированную функцию) ---

/** Ноты первой октавы C4–B4 (натуральные, уровень 1). */
const FIRST_OCTAVE: readonly number[] = [60, 62, 64, 65, 67, 69, 71];
/** Ноты обеих октав C4–B5 (натуральные, уровни 2–4; инвариант GLOSSARY #4). */
const BOTH_OCTAVES: readonly number[] = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83];
/** Опорные первые ноты (SPEC §4.10: C4/E4/G4 — тоника, терция, квинта). */
const STARTING_PITCHES: readonly number[] = [60, 64, 67];
/** Максимальный шаг мелодии: квинта (7 полутонов). */
const MAX_STEP_SEMITONES = 7;

const Q: StaffDuration = "quarter";
const H: StaffDuration = "half";
const W: StaffDuration = "whole";
const E: StaffDuration = "eighth";

/**
 * Ритмические шаблоны такта по уровням; каждая строка — ровно 4 доли
 * (SPEC §4.10: тактовая сумма всегда 4/4). Уровень 4 добавляет восьмые
 * ПАРАМИ (ребро на каждую пару, GLOSSARY: рёбра) к набору уровня 3.
 */
const RHYTHM_POOLS: Record<NotebookLevel, readonly StaffDuration[][]> = {
  1: [[Q, Q, Q, Q]],
  2: [[Q, Q, Q, Q]],
  3: [
    [Q, Q, Q, Q],
    [H, Q, Q],
    [Q, Q, H],
    [H, H],
    [W],
  ],
  4: [
    [Q, Q, Q, Q],
    [H, Q, Q],
    [Q, Q, H],
    [H, H],
    [W],
    [E, E, Q, Q, Q],
    [Q, E, E, Q, Q],
    [E, E, H, Q],
    [Q, E, E, H],
    [E, E, E, E, Q, Q],
    [E, E, E, E, H],
  ],
};

function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)] as T;
}

/** Следующий питч: из пула в пределах квинты от предыдущего (SPEC §4.10). */
function nextPitch(rng: Rng, pool: readonly number[], previous: number): number {
  const candidates = pool.filter((pitch) => Math.abs(pitch - previous) <= MAX_STEP_SEMITONES);
  return pick(rng, candidates);
}

/** Пометить пары восьмых ребром (рисуются общей плашкой renderer.drawBeam). */
function markEighthGroups(items: NotebookNote[]): void {
  let i = 0;
  while (i < items.length - 1) {
    if (items[i].duration === "eighth" && items[i + 1].duration === "eighth") {
      items[i].eighthGroup = true;
      items[i + 1].eighthGroup = true;
      i += 2; // пары не пересекаются: восьмые всегда идут чётными группами
    } else {
      i += 1;
    }
  }
}

/**
 * Сгенерировать тетрадь уровня (SPEC §4.10): 8 тактов 4/4; уровни —
 * 1: C4–B4 четверти; 2: C4–B5 четверти; 3: + половинные/целые;
 * 4: + восьмые парами. Первая нота — C4/E4/G4, шаг ≤ квинты.
 */
export function generateNotebook(level: NotebookLevel, rng: Rng): NotebookSheet {
  if (!NOTEBOOK_LEVELS.includes(level)) throw new RangeError(`Уровень тетради вне 1–4: ${level}`);
  const pool = level === 1 ? FIRST_OCTAVE : BOTH_OCTAVES;
  const rhythms = RHYTHM_POOLS[level];
  const measures: NotebookMeasure[] = [];
  let pitch = pick(rng, STARTING_PITCHES);
  for (let m = 0; m < NOTEBOOK_MEASURE_COUNT; m += 1) {
    const items: NotebookNote[] = pick(rng, rhythms).map((duration) => {
      const note: NotebookNote = { pitch, duration };
      pitch = nextPitch(rng, pool, pitch);
      return note;
    });
    markEighthGroups(items);
    measures.push({ beats: 4, items });
  }
  return { level, measures };
}

/** Ноты тетради подряд (плоский индекс — «номер ноты» судьи и экрана). */
export function notebookNotes(sheet: NotebookSheet): NotebookNote[] {
  return sheet.measures.flatMap((measure) => measure.items);
}

// --- Судья чтения с листа ---

/** Результат одного нажатия (для экрана: перерисовать/завершить). */
export interface NotebookPitchOutcome {
  correct: boolean;
  /** Верно и позиция продвинулась. */
  advanced: boolean;
  /** Последняя нота дочитана — тетрадь завершена. */
  complete: boolean;
  /** Питч текущей ноты после хода (для подсветки клавиши/стана). */
  expectedPitch: number;
}

/** Итог сессии (SPEC §4.10: % «верно с первой», стрик). */
export interface NotebookResult {
  level: NotebookLevel;
  /** Нот в тетради. */
  total: number;
  /** Нот, взятых без промаха. */
  firstTryCount: number;
  /** % «верно с первой», 0–100 (целое). */
  firstTryPercent: number;
  /** Лучший стрик «верно с первой» подряд. */
  bestStreak: number;
}

/**
 * Судья тетради: конечный автомат по плоскому индексу ноты. Чистая логика —
 * экран передаёт питчи (тот же мост handlePitch, что у карточек), судья
 * возвращает исход. Промахи хранит сам (attempts по индексу ноты) — сгенерённая
 * тетрадь остаётся неизменяемыми данными.
 */
export class NotebookJudge {
  private sheet: NotebookSheet | null = null;
  private notes: NotebookNote[] = [];
  private attempts: number[] = [];
  private index = 0;
  private firstTryCount = 0;
  private streak = 0;
  private bestStreak = 0;

  /** Начать тетрадь заново. */
  start(sheet: NotebookSheet): void {
    this.sheet = sheet;
    this.notes = notebookNotes(sheet);
    this.attempts = this.notes.map(() => 0);
    this.index = 0;
    this.firstTryCount = 0;
    this.streak = 0;
    this.bestStreak = 0;
  }

  get isStarted(): boolean {
    return this.sheet !== null;
  }

  /** Нот, взятых верно с первой попытки (живой процент на экране). */
  get firstTrySoFar(): number {
    return this.firstTryCount;
  }

  get level(): NotebookLevel {
    return this.sheet?.level ?? 1;
  }

  /** Плоский индекс текущей ноты (после завершения — за последней). */
  get currentIndex(): number {
    return this.index;
  }

  get totalCount(): number {
    return this.notes.length;
  }

  get currentNote(): NotebookNote | null {
    return this.notes[this.index] ?? null;
  }

  /** Питч, которого судья ждёт сейчас. */
  get expectedPitch(): number | null {
    return this.currentNote?.pitch ?? null;
  }

  /** Промахи на текущей ноте (GLOSSARY: попытка ноты). */
  get attemptsCurrent(): number {
    return this.attempts[this.index] ?? 0;
  }

  /** Промахи на ноте по плоскому индексу (экран рисует отметку промаха). */
  attemptsAt(flatIndex: number): number {
    return this.attempts[flatIndex] ?? 0;
  }

  get currentStreak(): number {
    return this.streak;
  }

  /** Тетрадь дочитана (последняя нота взята верно). */
  get isComplete(): boolean {
    return this.notes.length > 0 && this.index >= this.notes.length;
  }

  /**
   * Нажатие питча (GLOSSARY: чтение с листа — wait-семантика, время не
   * лимитировано). Вне тетради или после завершения — null.
   */
  handlePitch(pitch: number): NotebookPitchOutcome | null {
    if (this.sheet === null || this.isComplete) return null;
    const note = this.notes[this.index] as NotebookNote;
    const firstTry = this.attempts[this.index] === 0;
    if (note.pitch !== pitch) {
      this.attempts[this.index] += 1; // отметка промаха на ноте, позиция не двигается
      this.streak = 0;
      return { correct: false, advanced: false, complete: false, expectedPitch: note.pitch };
    }
    if (firstTry) {
      this.firstTryCount += 1;
      this.streak += 1;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    } else {
      this.streak = 0; // взято не с первой попытки — стрик «верно с первой» рвётся
    }
    this.index += 1;
    return { correct: true, advanced: true, complete: this.isComplete, expectedPitch: note.pitch };
  }

  /** Итог сессии; тетрадь не завершена — null. */
  result(): NotebookResult | null {
    if (!this.isComplete) return null;
    const total = this.totalCount;
    const firstTryPercent = total > 0 ? Math.round((this.firstTryCount / total) * 100) : 0;
    return {
      level: this.sheet?.level ?? 1,
      total,
      firstTryCount: this.firstTryCount,
      firstTryPercent,
      bestStreak: this.bestStreak,
    };
  }
}
