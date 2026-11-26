/**
 * Гитарная нотная тетрадь (PIANO-20, SPEC §4.13) — чистая логика БЕЗ DOM:
 * генератор тетрадей I позиции по уровням (rng внедрён — детерминируется в
 * smoke). Экран — primer/guitar-notebook-screen.ts, он только потребляет.
 *
 * Паттерн — нотная тетрадь (primer/notebook.ts, SPEC §4.10): те же 8 тактов
 * 4/4 четвертями, тот же судья чтения с листа (NotebookJudge — wait-семантика,
 * «верно с первой», стрик) и те же типы данных (NotebookSheet/Measure/Note) —
 * рендер стана и судья переиспользуются без копий. Отличие только в пуле
 * питчей: ЗАПИСАННЫЕ высоты I позиции гитары (research 06 §4, словарь
 * writtenToGuitar 52..80 E3–G♯5) вместо фортепианных C4–B5. Ответ — клавиша
 * роя по записанной высоте (research 06 §1: гитара звучит октавой ниже
 * записи, но тренируется чтение записи); звук нажатий — игровой движок
 * (engine.noteOn по записанной высоте), автопрослушки в v1 нет (SPEC §4.13).
 *
 * Уровни — whitelist струн (research 06 §4: тренажёры ограничивают диапазон,
 * «жёсткий whitelist струн/ладов на уровень», порядок школ — струны сверху
 * вниз): 1 = открытые струны (6 нот); 2 = 1-я+2-я струны (B4–G♯5, лады 0–4);
 * 3 = вся I позиция, натуральные; 4 = вся I позиция с диезами (29 нот).
 */
import { FIRST_POSITION_WRITTEN_HIGH, FIRST_POSITION_WRITTEN_LOW, writtenToGuitar } from "../core/fretboard";
import type { NotebookLevel, NotebookMeasure, NotebookNote, NotebookSheet } from "./notebook";
import type { Rng } from "./types";

/** Уровень гитарной тетради — тот же ряд 1–4, что у тетради (GLOSSARY: уровень тетради). */
export type GuitarNotebookLevel = NotebookLevel;

export const GUITAR_NOTEBOOK_LEVELS: readonly GuitarNotebookLevel[] = [1, 2, 3, 4];

/** Тактов в тетради — как в нотной тетради (SPEC §4.10/§4.13: 8 тактов 4/4). */
export const GUITAR_NOTEBOOK_MEASURE_COUNT = 8;

/** Долей в такте (4/4 → 4 четверти; ритм уровня 1 тетради). */
const BEATS_PER_MEASURE = 4;

/** Максимальный шаг мелодии: квинта (7 полутонов) — как в тетради (SPEC §4.10). */
const MAX_STEP_SEMITONES = 7;

/** Ключ прогресса уровня в хранилище Азбуки (паттерн notebook-level-N, SPEC §4.10). */
export function guitarNotebookProgressKey(level: GuitarNotebookLevel): string {
  return `guitar-notebook-level-${level}`;
}

// --- Пулы уровней: whitelist струн словаря I позиции (research 06 §4) ---

/** Натуральная высота? (пицц-класс 0,2,4,5,7,9,11 — уровни 1–3 без диезов). */
function isNatural(pitch: number): boolean {
  return [0, 2, 4, 5, 7, 9, 11].includes(((pitch % 12) + 12) % 12);
}

/**
 * Пул записанных высот уровня — выведен из словаря I позиции (writtenToGuitar
 * — единственный источник «записанная высота → струна.лад»), не захардкожен:
 * уровни = ограничения словаря.
 * 1: только открытые струны (лад 0) — шесть нот E3 A3 D4 G4 B4 E5;
 * 2: струны 1–2 (лады 0–4) — B4…G♯5;
 * 3: вся I позиция, натуральные (диезы появятся в уровне 4);
 * 4: вся I позиция, с диезами — все 29 высот словаря.
 */
export const GUITAR_NOTEBOOK_POOLS: Readonly<Record<GuitarNotebookLevel, readonly number[]>> = (() => {
  const pools: Record<GuitarNotebookLevel, number[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (let written = FIRST_POSITION_WRITTEN_LOW; written <= FIRST_POSITION_WRITTEN_HIGH; written += 1) {
    const place = writtenToGuitar(written);
    if (!place) continue; // словарь I позиции — источник истины по диапазону
    pools[4].push(written);
    if (isNatural(written)) pools[3].push(written);
    if (place.string <= 2) pools[2].push(written);
    if (place.fret === 0) pools[1].push(written);
  }
  return pools;
})();

/** Первые ноты уровня — открытые струны своего пула (SPEC §4.13: опора — открытая струна). */
const STARTING_PITCHES: Readonly<Record<GuitarNotebookLevel, readonly number[]>> = (() => {
  const starts = {} as Record<GuitarNotebookLevel, readonly number[]>;
  for (const level of GUITAR_NOTEBOOK_LEVELS) {
    starts[level] = GUITAR_NOTEBOOK_POOLS[level].filter((pitch) => writtenToGuitar(pitch)?.fret === 0);
  }
  return starts;
})();

// --- Генерация (rng внедрён — тесты подставляют детерминированную функцию) ---

function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)] as T;
}

/** Следующий питч: из пула в пределах квинты от предыдущего (SPEC §4.10/§4.13). */
function nextPitch(rng: Rng, pool: readonly number[], previous: number): number {
  const candidates = pool.filter((pitch) => Math.abs(pitch - previous) <= MAX_STEP_SEMITONES);
  return pick(rng, candidates);
}

/**
 * Тетрадь гитарного уровня: 8 тактов 4/4 четвертями (ритм уровня 1 тетради —
 * смысл гитарной тетради в ВЫСОТАХ I позиции, не в ритме; SPEC §4.13).
 * Первая нота — открытая струна, шаг ≤ квинты. Данные — те же типы, что у
 * нотной тетради: NotebookSheet судится NotebookJudge без изменений.
 */
export function generateGuitarNotebook(level: GuitarNotebookLevel, rng: Rng): NotebookSheet {
  if (!GUITAR_NOTEBOOK_LEVELS.includes(level)) throw new RangeError(`Уровень гитарной тетради вне 1–4: ${level}`);
  const pool = GUITAR_NOTEBOOK_POOLS[level];
  const measures: NotebookMeasure[] = [];
  let pitch = pick(rng, STARTING_PITCHES[level]);
  for (let m = 0; m < GUITAR_NOTEBOOK_MEASURE_COUNT; m += 1) {
    const items: NotebookNote[] = [];
    for (let beat = 0; beat < BEATS_PER_MEASURE; beat += 1) {
      items.push({ pitch, duration: "quarter" });
      pitch = nextPitch(rng, pool, pitch);
    }
    measures.push({ beats: BEATS_PER_MEASURE, items });
  }
  return { level, measures };
}
