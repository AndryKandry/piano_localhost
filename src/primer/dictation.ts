/**
 * Музыкальный диктант (PIANO-17) — чистая логика БЕЗ DOM: генератор
 * последовательностей по уровням (rng внедрён — детерминируется в smoke),
 * план проигрывания и сессия ввода/проверки. Экран — primer/dictation-screen.ts,
 * он только потребляет (паттерн primer/notebook.ts → notebook-screen.ts).
 *
 * Диктант (GLOSSARY «Азбука»: тренировка слуха) — Азбука играет
 * последовательность нот, игрок повторяет её нажатиями клавиш, проверка —
 * по завершении ввода (все позиции введены) или кнопкой «Проверить».
 * Wait-семантики нет (это не чтение с листа): ввод свободный, нажатия
 * добавляются подряд, лишние (сверх длины) — игнорируются. Подсветка
 * «жми-сейчас» не показывается — проверяется слух, а не глаза.
 *
 * Звук диктанта планируемый (инвариант GLOSSARY #2): planDictationPlayback
 * отдаёт ноты с offsetSec — экран планирует их через engine.playNote на
 * аудио-часах; педаль и живой ввод на план не влияют.
 */
import type { Rng } from "./types";

/** Уровень диктанта (GLOSSARY: уровень диктанта) — длина и диапазон. */
export type DictationLevel = 1 | 2 | 3 | 4;

export const DICTATION_LEVELS: readonly DictationLevel[] = [1, 2, 3, 4];

/** Нот в диктанте по уровням (PIANO-17): 1 = 2, 2 = 3, 3 = 4, 4 = 5. */
export const DICTATION_NOTE_COUNTS: Readonly<Record<DictationLevel, number>> = { 1: 2, 2: 3, 3: 4, 4: 5 };

/** Ключ прогресса уровня в хранилище Азбуки (как у уроков и тетради). */
export function dictationProgressKey(level: DictationLevel): string {
  return `dictation-level-${level}`;
}

// --- Данные диктанта ---

/** Сгенерированная последовательность диктанта (неизменяемая для сессии). */
export interface DictationSequence {
  level: DictationLevel;
  /** Питчи по порядку, MIDI 0–127 (C4 = 60). */
  notes: readonly number[];
}

// --- Генерация (rng внедрён — тесты подставляют детерминированную функцию) ---

/** Белые клавиши C4–C5 (уровни 1–2: только белые — диезы слуху не по силам). */
const WHITE_C4_C5: readonly number[] = [60, 62, 64, 65, 67, 69, 71, 72];
/** Хроматика C4–C5 (уровни 3–4: диезы допущены — у игрока уже есть опора). */
const CHROMATIC_C4_C5: readonly number[] = [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72];
/** Опорные первые ноты (как в тетради, SPEC §4.10: тоника, терция, квинта). */
const STARTING_PITCHES: readonly number[] = [60, 64, 67];
/** Максимальный шаг между соседними нотами: квинта (7 полутонов). */
const MAX_STEP_SEMITONES = 7;

function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)] as T;
}

/** Пул питчей уровня: 1–2 — белые C4–C5, 3–4 — хроматика C4–C5. */
export function dictationPool(level: DictationLevel): readonly number[] {
  return level <= 2 ? WHITE_C4_C5 : CHROMATIC_C4_C5;
}

/**
 * Сгенерировать диктант уровня (PIANO-17): длина по DICTATION_NOTE_COUNTS,
 * диапазон C4–C5 (уровни 1–2 — белые, 3–4 — с диезами), шаг ≤ квинты,
 * первая нота — C4/E4/G4 (опора). Ноты могут повторяться — слуху это
 * нормально: интервал 0 (прима) тоже надо различать.
 */
export function generateDictation(level: DictationLevel, rng: Rng): DictationSequence {
  if (!DICTATION_LEVELS.includes(level)) throw new RangeError(`Уровень диктанта вне 1–4: ${level}`);
  const pool = dictationPool(level);
  const count = DICTATION_NOTE_COUNTS[level];
  const notes: number[] = [pick(rng, STARTING_PITCHES)];
  while (notes.length < count) {
    const previous = notes[notes.length - 1] as number;
    const candidates = pool.filter((pitch) => Math.abs(pitch - previous) <= MAX_STEP_SEMITONES);
    notes.push(pick(rng, candidates));
  }
  return { level, notes };
}

// --- План проигрывания (звук планирует экран: engine.playNote, инвариант #2) ---

/** Вступление перед первой нотой, сек (уши настраиваются на тембр). */
export const DICTATION_LEAD_IN_SEC = 0.5;
/** Шаг между нотами, сек: 0.5 звучит + 0.5 тишины (запомнить порядок). */
export const DICTATION_STEP_SEC = 1.0;
/** Длительность звучания одной ноты, сек (по ТЗ 0.5 с). */
export const DICTATION_NOTE_SEC = 0.5;

/** Одна нота плана: когда и сколько звучит от начала проигрывания. */
export interface DictationPlayEntry {
  pitch: number;
  /** Секунды от начала проигрывания (экран прибавляет audio-часы). */
  offsetSec: number;
  durationSec: number;
}

/** План проигрывания: ноты по очереди + момент готовности ввода. */
export interface DictationPlayPlan {
  entries: readonly DictationPlayEntry[];
  /**
   * Момент завершения плана от его начала, сек: прозвучала последняя нота —
   * фаза «слушай» кончилась, ввод открыт (экран сверяет с аудио-часами).
   */
  totalSec: number;
}

/** План: нота i звучит с LEAD + i·STEP, длительность NOTE; пауза — остаток шага. */
export function planDictationPlayback(notes: readonly number[]): DictationPlayPlan {
  const entries = notes.map((pitch, i) => ({
    pitch,
    offsetSec: DICTATION_LEAD_IN_SEC + i * DICTATION_STEP_SEC,
    durationSec: DICTATION_NOTE_SEC,
  }));
  const totalSec =
    notes.length === 0 ? 0 : DICTATION_LEAD_IN_SEC + (notes.length - 1) * DICTATION_STEP_SEC + DICTATION_NOTE_SEC;
  return { entries, totalSec };
}

// --- Сессия: фазы listen → input → result ---

/** Фаза диктанта (GLOSSARY): слушай → ввод нажатиями → вердикт с разбором. */
export type DictationPhase = "listen" | "input" | "result";

/** Вердикт по одной позиции диктанта (GLOSSARY: позиция диктанта). */
export interface DictationPositionVerdict {
  /** Номер позиции с 0 (порядковый для показа +1 на экране). */
  position: number;
  correct: boolean;
  /** Что сыграл игрок; null — позиция не заполнена (проверка раньше ввода). */
  playedPitch: number | null;
  /** Какая нота была в последовательности. */
  expectedPitch: number;
}

/** Итог проверки (GLOSSARY: разбор диктанта) — данные, строки строит экран. */
export interface DictationCheck {
  /** Нот в диктанте. */
  total: number;
  /** Верных позиций. */
  correctCount: number;
  /** % верных позиций, 0–100 (целое) — записывается в прогресс уровня. */
  percent: number;
  /** Разбор по позициям, по порядку. */
  positions: readonly DictationPositionVerdict[];
  /** Самый длинный ряд подряд верных позиций (0–total). */
  bestRun: number;
}

/** Исход одного нажатия при вводе (для экрана: обновить статус/проверить). */
export type DictationInputOutcome =
  | { accepted: true; enteredCount: number; isFull: boolean }
  | { accepted: false; reason: "phase" | "full" };

/**
 * Сессия диктанта: конечный автомат по фазам. Чистая логика — экран передаёт
 * питчи (тот же мост handlePitch, что у карточек и тетради) и время фазы
 * «слушай» сверяет с аудио-часами сам (beginInput по плану).
 */
export class DictationSession {
  private sequence: DictationSequence | null = null;
  private phase: DictationPhase = "listen";
  private input: number[] = [];

  /** Начать диктант: фаза «слушай», ввод пуст. */
  start(sequence: DictationSequence): void {
    this.sequence = sequence;
    this.phase = "listen";
    this.input = [];
  }

  get level(): DictationLevel {
    return this.sequence?.level ?? 1;
  }

  get notes(): readonly number[] {
    return this.sequence?.notes ?? [];
  }

  get noteCount(): number {
    return this.notes.length;
  }

  get currentPhase(): DictationPhase {
    return this.phase;
  }

  /** Сколько позиций уже введено (статус «введено 2/3»). */
  get enteredCount(): number {
    return this.input.length;
  }

  /** Ввод заполнен — можно проверять (экран проверит сам, без кнопки). */
  get isFull(): boolean {
    return this.sequence !== null && this.input.length >= this.notes.length;
  }

  /** Открыть ввод: по плану (аудио-часы) или по первому нажатию игрока. */
  beginInput(): void {
    if (this.phase === "listen") this.phase = "input";
  }

  /**
   * Нажатие питча при вводе: добавляется в очередь (ввод свободный,
   * wait-семантики нет). Вне фазы ввода или при заполненном вводе — отказ:
   * лишние нажатия игнорируются, а не заменяют введённое.
   */
  addPitch(pitch: number): DictationInputOutcome {
    if (this.phase !== "input") return { accepted: false, reason: "phase" };
    if (this.isFull) return { accepted: false, reason: "full" };
    this.input.push(pitch);
    return { accepted: true, enteredCount: this.enteredCount, isFull: this.isFull };
  }

  /**
   * Проверить ввод: % верных позиций + разбор. Незаполненные позиции —
   * неверные (playedPitch null). Вне фазы ввода — null (повторная проверка
   * и проверка недозаполненной фазы «слушай» не имеют смысла).
   */
  check(): DictationCheck | null {
    if (this.phase !== "input" || this.sequence === null) return null;
    this.phase = "result";
    const notes = this.notes;
    const positions: DictationPositionVerdict[] = notes.map((expectedPitch, position) => {
      const playedPitch = this.input[position] ?? null;
      return { position, correct: playedPitch === expectedPitch, playedPitch, expectedPitch };
    });
    const correctCount = positions.filter((verdict) => verdict.correct).length;
    let bestRun = 0;
    let run = 0;
    for (const verdict of positions) {
      run = verdict.correct ? run + 1 : 0;
      bestRun = Math.max(bestRun, run);
    }
    return {
      total: notes.length,
      correctCount,
      percent: notes.length > 0 ? Math.round((correctCount / notes.length) * 100) : 0,
      positions,
      bestRun,
    };
  }
}
