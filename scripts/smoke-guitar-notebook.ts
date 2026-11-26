/**
 * Smoke-проверка «Гитарной тетради» (PIANO-20, SPEC §4.13) без браузера:
 * генератор (детерминизм по rng-сиду, whitelist струн уровней по словарю
 * writtenToGuitar, 8 тактов 4/4 четвертями, шаг ≤ квинты, первая нота —
 * открытая струна), судья чтения с листа на сгенерённой тетради (тот же
 * NotebookJudge — wait-семантика, промахи не двигают позицию, «верно с
 * первой»), данные подсказки «Гриф» (каждая нота тетради резолвится в
 * струну.лад I позиции) и настройка режима подсказки (tri-state
 * guitarNotebookHint: дефолт «Клавиатура», persist, битый JSON → дефолт).
 *
 * Экран (DOM/канвасы/шрифт) в node не тестируется — нужен живой браузер.
 * Запуск: npm run smoke:guitar-notebook.
 */
import { writtenToGuitar, isValidGuitarNote, FIRST_POSITION_WRITTEN_HIGH, FIRST_POSITION_WRITTEN_LOW } from "../src/core/fretboard";
import {
  normalizeSettings,
  SettingsStore,
  DEFAULT_SETTINGS,
  type GuitarHintMode,
  type SettingsStorage,
} from "../src/core/settings";
import { DURATION_BEATS } from "../src/notation/geometry";
import { NotebookJudge, notebookNotes } from "../src/primer/notebook";
import {
  GUITAR_NOTEBOOK_LEVELS,
  GUITAR_NOTEBOOK_POOLS,
  guitarNotebookProgressKey,
  generateGuitarNotebook,
  type GuitarNotebookLevel,
} from "../src/primer/guitar-notebook";

let checks = 0;
function assert(condition: boolean, message: string): void {
  checks += 1;
  if (!condition) throw new Error(`ПРОВАЛ: ${message}`);
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message} (ожидалось ${String(expected)}, получено ${String(actual)})`);
}

// --- Детерминированный rng (одинаковый seed → одинаковая тетрадь) ---

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEEDS = [1, 7, 42, 99, 1234, 2026];

/** Открытые струны (запись): 6-я E3 … 1-я E5. */
const OPEN_WRITTEN = new Set([52, 57, 62, 67, 71, 76]);
/** Натуральный пицц-класс (уровень 3 — без диезов). */
const NATURAL_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);

// --- 1. Пулы уровней: whitelist струн словаря I позиции ---

function testPools(): void {
  console.log("Пулы уровней гитарной тетради:");
  assertEqual(GUITAR_NOTEBOOK_LEVELS.length, 4, "четыре уровня гитарной тетради");

  const all: number[] = [];
  for (let written = FIRST_POSITION_WRITTEN_LOW; written <= FIRST_POSITION_WRITTEN_HIGH; written += 1) all.push(written);
  assertEqual(GUITAR_NOTEBOOK_POOLS[4].length, 29, "уровень 4: все 29 высот словаря I позиции");
  assertEqual(GUITAR_NOTEBOOK_POOLS[4].join(","), all.join(","), "уровень 4: непрерывный диапазон E3–G♯5");

  assertEqual(GUITAR_NOTEBOOK_POOLS[3].length, 17, "уровень 3: 17 натуральных высот I позиции");
  assert(
    GUITAR_NOTEBOOK_POOLS[3].every((pitch) => NATURAL_CLASSES.has(((pitch % 12) + 12) % 12)),
    "уровень 3: только натуральные",
  );
  assert(!GUITAR_NOTEBOOK_POOLS[3].includes(73), "уровень 3: C♯5 не в пуле");

  assertEqual(GUITAR_NOTEBOOK_POOLS[2].join(","), "71,72,73,74,75,76,77,78,79,80", "уровень 2: 1-я+2-я струны, B4–G♯5");
  assert(
    GUITAR_NOTEBOOK_POOLS[2].every((pitch) => (writtenToGuitar(pitch)?.string ?? 9) <= 2),
    "уровень 2: только струны 1–2",
  );

  assertEqual(GUITAR_NOTEBOOK_POOLS[1].length, 6, "уровень 1: шесть открытых струн");
  assertEqual(
    [...GUITAR_NOTEBOOK_POOLS[1]].sort((a, b) => a - b).join(","),
    [...OPEN_WRITTEN].sort((a, b) => a - b).join(","),
    "уровень 1: открытые струны E3 A3 D4 G4 B4 E5",
  );
  assert(
    GUITAR_NOTEBOOK_POOLS[1].every((pitch) => writtenToGuitar(pitch)?.fret === 0),
    "уровень 1: все ноты — открытые струны",
  );
  console.log("  OK: whitelist струн из словаря I позиции — 6 / 10 / 17 / 29 нот");
}

// --- 2. Генератор: структура, диапазоны струн, суммы тактов, первые ноты ---

function testGenerator(): void {
  console.log("Генератор гитарных тетрадей:");
  for (const level of GUITAR_NOTEBOOK_LEVELS) {
    for (const seed of SEEDS) {
      const sheet = generateGuitarNotebook(level, mulberry32(seed));
      assertEqual(sheet.level, level, `уровень ${level} сид ${seed}: level записан`);
      assertEqual(sheet.measures.length, 8, `уровень ${level} сид ${seed}: 8 тактов`);

      const notes = notebookNotes(sheet);
      assertEqual(notes.length, 32, `уровень ${level} сид ${seed}: 32 четверти (8×4)`);

      // Первая нота — открытая струна (SPEC §4.13: опора).
      const first = writtenToGuitar(notes[0].pitch);
      assert(first !== null && first.fret === 0, `уровень ${level} сид ${seed}: первая нота — открытая струна`);

      // Пулы уровня и словарь I позиции.
      const pool = new Set(GUITAR_NOTEBOOK_POOLS[level]);
      for (const note of notes) {
        assert(pool.has(note.pitch), `уровень ${level} сид ${seed}: питч ${note.pitch} в пуле уровня`);
        const place = writtenToGuitar(note.pitch);
        assert(place !== null, `уровень ${level} сид ${seed}: питч ${note.pitch} в словаре I позиции`);
        assert(place !== null && isValidGuitarNote(place), `уровень ${level} сид ${seed}: струна.лад валидны`);
        assertEqual(note.duration, "quarter", `уровень ${level} сид ${seed}: только четверти`);
      }

      // Шаг мелодии ≤ квинты (7 полутонов), включая стык тактов.
      for (let i = 1; i < notes.length; i += 1) {
        const step = Math.abs(notes[i].pitch - notes[i - 1].pitch);
        assert(step <= 7, `уровень ${level} сид ${seed}: шаг ${step} на ноте ${i} ≤ квинты`);
      }

      // Тактовая сумма всегда 4 доли (четверть = 1).
      for (const measure of sheet.measures) {
        assertEqual(measure.beats, 4, `уровень ${level}: размер 4/4`);
        const beats = measure.items.reduce((sum, note) => sum + DURATION_BEATS[note.duration], 0);
        assertEqual(beats, 4, `уровень ${level} сид ${seed}: такт заполнен ровно на 4 доли`);
      }

      // Границы уровня: 1 — только открытые, 2 — только струны 1–2,
      // 3 — только натуральные (диезы — уровень 4).
      for (const note of notes) {
        const place = writtenToGuitar(note.pitch);
        if (level === 1) assertEqual(place?.fret, 0, `уровень ${level}: нота открытой струны`);
        if (level === 2) assert((place?.string ?? 9) <= 2, `уровень ${level}: только струны 1–2`);
        if (level === 3) assert(NATURAL_CLASSES.has(((note.pitch % 12) + 12) % 12), `уровень ${level}: без диезов`);
      }
    }
  }

  // Уровень 4 реально встречает диезы и низкие струны (иначе вырожден).
  const sharpSeen = SEEDS.some((seed) =>
    notebookNotes(generateGuitarNotebook(4, mulberry32(seed))).some((n) => !NATURAL_CLASSES.has(((n.pitch % 12) + 12) % 12)),
  );
  assert(sharpSeen, "уровень 4: диезы встречаются на наборе сидов");
  const lowSeen = SEEDS.some((seed) =>
    notebookNotes(generateGuitarNotebook(3, mulberry32(seed))).some((n) => (writtenToGuitar(n.pitch)?.string ?? 0) >= 5),
  );
  assert(lowSeen, "уровень 3: ноты 5-й/6-й струн встречаются (низкие — под станом)");

  // Детерминизм: одинаковый сид → одинаковая тетрадь, разный сид → различимо.
  const a = generateGuitarNotebook(4, mulberry32(77));
  const b = generateGuitarNotebook(4, mulberry32(77));
  assertEqual(JSON.stringify(a), JSON.stringify(b), "одинаковый сид → одинаковая тетрадь");
  const differs = SEEDS.some(
    (seed) =>
      JSON.stringify(generateGuitarNotebook(2, mulberry32(seed))) !==
      JSON.stringify(generateGuitarNotebook(2, mulberry32(seed + 1))),
  );
  assert(differs, "разные сиды дают разные тетради (на наборе сидов)");

  // Неверный уровень — RangeError.
  let threw = false;
  try {
    generateGuitarNotebook(5 as GuitarNotebookLevel, mulberry32(1));
  } catch {
    threw = true;
  }
  assert(threw, "уровень вне 1–4 — RangeError");
  console.log("  OK: 4 уровня × сиды, первая открытая, шаг ≤ квинты, сумма 4/4, детерминизм, RangeError");
}

// --- 3. Судья (тот же NotebookJudge) на сгенерённой гитарной тетради ---

function testJudge(): void {
  console.log("Судья чтения с листа (wait-семантика):");
  for (const level of GUITAR_NOTEBOOK_LEVELS) {
    const sheet = generateGuitarNotebook(level, mulberry32(2026 + level));
    const judge = new NotebookJudge();
    judge.start(sheet);
    const notes = notebookNotes(sheet);
    assertEqual(judge.expectedPitch, notes[0].pitch, `уровень ${level}: ждётся первая нота`);

    // Каждый питч — сначала промах (позиция стоит), затем верно.
    let guard = 0;
    while (!judge.isComplete && guard < notes.length + 10) {
      guard += 1;
      const expected = judge.expectedPitch;
      if (expected === null) break;
      const wrong = expected === 52 ? 53 : 52; // любой питч ≠ ожидаемого — всегда мимо
      const miss = judge.handlePitch(wrong);
      assert(miss !== null && !miss.advanced, `уровень ${level}: промах не двигает позицию`);
      assertEqual(judge.attemptsCurrent, 1, `уровень ${level}: промах отмечен на ноте`);
      const outcome = judge.handlePitch(expected);
      if (outcome === null) break;
    }
    assert(judge.isComplete, `уровень ${level}: тетрадь дочитана после верных нажатий`);
    assertEqual(judge.handlePitch(60), null, `уровень ${level}: нажатия после завершения — null`);

    const result = judge.result();
    assert(result !== null, `уровень ${level}: итог доступен`);
    assertEqual(result?.total, 32, `уровень ${level}: итог по всем 32 нотам`);
    assertEqual(result?.level, level, `уровень ${level}: уровень записан в итог`);
    assertEqual(result?.firstTryCount, 0, `уровень ${level}: каждая нота была с промахом — firstTry 0`);
    assertEqual(result?.firstTryPercent, 0, `уровень ${level}: 0% верно с первой`);
  }

  // Чистый проход без промахов: 100%, стрик = числу нот.
  const sheet = generateGuitarNotebook(1, mulberry32(5));
  const judge = new NotebookJudge();
  judge.start(sheet);
  while (!judge.isComplete) {
    const expected = judge.expectedPitch;
    if (expected === null) break;
    judge.handlePitch(expected);
  }
  const perfect = judge.result();
  assertEqual(perfect?.firstTryPercent, 100, "все верно с первой → 100%");
  assertEqual(perfect?.bestStreak, 32, "стрик = числу нот без промахов");
  assertEqual(guitarNotebookProgressKey(3), "guitar-notebook-level-3", "ключ прогресса уровня 3");
  console.log("  OK: промахи не двигают позицию, complete на последней, 100%/0%, ключ прогресса");
}

// --- 4. Подсказка-режимы: tri-state guitarNotebookHint в настройках ---

function memoryStorage(): SettingsStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

function testHintModes(): void {
  console.log("Режимы подсказки (guitarNotebookHint):");
  assertEqual(DEFAULT_SETTINGS.guitarNotebookHint, "keyboard", "дефолт подсказки — «Клавиатура» (вкл)");
  assertEqual(normalizeSettings({}).guitarNotebookHint, "keyboard" satisfies GuitarHintMode, "без записи → дефолт «Клавиатура»");

  // Все три режима persist; битое значение → дефолт.
  const storage = memoryStorage();
  const store = new SettingsStore(storage);
  for (const mode of ["fretboard", "none", "keyboard"] as const) {
    store.update({ guitarNotebookHint: mode });
    assertEqual(store.get().guitarNotebookHint, mode, `режим «${mode}» применяется патчем`);
    assertEqual(new SettingsStore(storage).get().guitarNotebookHint, mode, `режим «${mode}» переживает reload`);
  }
  const corrupt = memoryStorage();
  corrupt.setItem("piano.settings", JSON.stringify({ version: 1, guitarNotebookHint: "табы" }));
  assertEqual(new SettingsStore(corrupt).get().guitarNotebookHint, "keyboard", "битый режим → дефолт «Клавиатура»");
  assertEqual(normalizeSettings({ guitarNotebookHint: 42 }).guitarNotebookHint, "keyboard", "не-строка → дефолт");

  // Данные подсказки «Гриф»: каждая нота любой тетради резолвится в струну.лад.
  for (const level of GUITAR_NOTEBOOK_LEVELS) {
    const notes = notebookNotes(generateGuitarNotebook(level, mulberry32(11)));
    const places = notes.map((note) => writtenToGuitar(note.pitch));
    assert(places.every((place) => place !== null && isValidGuitarNote(place)), `уровень ${level}: диаграмма грифа показывает каждую ноту`);
  }
  console.log("  OK: дефолт keyboard, три режима persist, битый JSON → дефолт, гриф резолвит каждую ноту");
}

function main(): void {
  testPools();
  testGenerator();
  testJudge();
  testHintModes();
  console.log(`SMOKE OK: ${checks} проверок пройдено`);
}

try {
  main();
} catch (error) {
  console.error("SMOKE FAIL:", error);
  throw error;
}
