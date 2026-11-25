/**
 * Smoke-проверка «Нотной тетради» (SPEC §4.10, PIANO-12) без браузера:
 * генератор (детерминизм по rng-сиду, диапазоны уровней, тактовая сумма 4/4,
 * шаг ≤ квинты, первые ноты C4/E4/G4, восьмые парами) и судья чтения с листа
 * (верно/неверно, попытки, «верно с первой», стрик, итог, завершение).
 * Экран (DOM/канвас/шрифт) в node не тестируется — нужен живой браузер.
 * Запуск: npm run smoke:notebook.
 */
import { DURATION_BEATS } from "../src/notation/geometry";
import {
  NOTEBOOK_LEVELS,
  NotebookJudge,
  generateNotebook,
  notebookNotes,
  notebookProgressKey,
  type NotebookLevel,
  type NotebookSheet,
} from "../src/primer/notebook";

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

const FIRST_OCTAVE = new Set([60, 62, 64, 65, 67, 69, 71]);
const BOTH_OCTAVES = new Set([60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83]);
const STARTING_PITCHES = new Set([60, 64, 67]);
const SEEDS = [1, 7, 42, 99, 1234, 2026];

// --- 1. Генератор: структура, диапазоны, ритмы уровней ---

function testGenerator(): void {
  console.log("Генератор тетрадей:");
  assertEqual(NOTEBOOK_LEVELS.length, 4, "четыре уровня тетради");

  for (const level of NOTEBOOK_LEVELS) {
    for (const seed of SEEDS) {
      const sheet = generateNotebook(level, mulberry32(seed));
      assertEqual(sheet.level, level, `уровень ${level} сид ${seed}: level записан`);
      assertEqual(sheet.measures.length, 8, `уровень ${level} сид ${seed}: 8 тактов`);

      const notes = notebookNotes(sheet);
      assert(notes.length >= 8, `уровень ${level} сид ${seed}: ноты есть`);
      assert(STARTING_PITCHES.has(notes[0].pitch), `уровень ${level} сид ${seed}: первая нота C4/E4/G4`);

      // Диапазон уровня (SPEC §4.10): 1 — первая октава, 2–4 — обе.
      const pool = level === 1 ? FIRST_OCTAVE : BOTH_OCTAVES;
      for (const note of notes) {
        assert(pool.has(note.pitch), `уровень ${level} сид ${seed}: питч ${note.pitch} в пуле уровня`);
      }

      // Шаг мелодии ≤ квинты (7 полутонов), включая стык тактов.
      for (let i = 1; i < notes.length; i += 1) {
        const step = Math.abs(notes[i].pitch - notes[i - 1].pitch);
        assert(step <= 7, `уровень ${level} сид ${seed}: шаг ${step} на ноте ${i} ≤ квинты`);
      }

      // Тактовая сумма всегда 4 доли (eighth=0.5, half=2, whole=4).
      for (const measure of sheet.measures) {
        assertEqual(measure.beats, 4, `уровень ${level}: размер 4/4`);
        const beats = measure.items.reduce((sum, note) => sum + DURATION_BEATS[note.duration], 0);
        assertEqual(beats, 4, `уровень ${level} сид ${seed}: такт заполнен ровно на 4 доли`);
      }

      // Ритмы по уровням.
      const durations = new Set(notes.map((note) => note.duration));
      if (level <= 2) {
        assertEqual(durations.size, 1, `уровень ${level}: только четверти`);
        assert(durations.has("quarter"), `уровень ${level}: длительность — четверть`);
      }
      if (level === 3) {
        assert(
          [...durations].every((d) => d === "quarter" || d === "half" || d === "whole"),
          `уровень ${level}: четверти/половинные/целые, без восьмых`,
        );
      }
      if (level === 4) {
        for (const note of notes) {
          if (note.duration !== "eighth") {
            assert(note.eighthGroup !== true, `уровень ${level} сид ${seed}: eighthGroup только у восьмых`);
          }
        }
      }

      // Восьмые — только парами под ребром (GLOSSARY: рёбра): каждый ран
      // подряд идущих восьмых чётный и весь помечен eighthGroup.
      const grouped = notes.filter((note) => note.eighthGroup === true);
      assert(
        grouped.every((note) => note.duration === "eighth"),
        `уровень ${level} сид ${seed}: ребро стоит только на восьмых`,
      );
      const eighthCount = notes.filter((note) => note.duration === "eighth").length;
      assertEqual(eighthCount % 2, 0, `уровень ${level} сид ${seed}: восьмые идут чётным числом`);
      for (const measure of sheet.measures) {
        let run = 0;
        for (const item of [...measure.items, { duration: "quarter" } as const]) {
          if (item.duration === "eighth") {
            run += 1;
            assert(item.eighthGroup === true, `уровень ${level} сид ${seed}: каждая восьмая под ребром`);
            continue;
          }
          assertEqual(run % 2, 0, `уровень ${level} сид ${seed}: ран восьмых чётный (пары)`);
          run = 0;
        }
      }
    }
  }

  // Детерминизм: одинаковый сид → одинаковая тетрадь, разный сид → различимо.
  const a = generateNotebook(4, mulberry32(77));
  const b = generateNotebook(4, mulberry32(77));
  assertEqual(JSON.stringify(a), JSON.stringify(b), "одинаковый сид → одинаковая тетрадь");
  const differs = SEEDS.some((seed) => JSON.stringify(generateNotebook(2, mulberry32(seed))) !== JSON.stringify(generateNotebook(2, mulberry32(seed + 1))));
  assert(differs, "разные сиды дают разные тетради (на наборе сидов)");

  // Уровень 3/4 реально встречает длинные/восьмые (иначе генерация вырождена).
  const longSeen = SEEDS.some((seed) => notebookNotes(generateNotebook(3, mulberry32(seed))).some((n) => n.duration !== "quarter"));
  assert(longSeen, "уровень 3: половинные/целые встречаются на наборе сидов");
  const eighthSeen = SEEDS.some((seed) => notebookNotes(generateNotebook(4, mulberry32(seed))).some((n) => n.duration === "eighth"));
  assert(eighthSeen, "уровень 4: восьмые встречаются на наборе сидов");

  // Неверный уровень — RangeError.
  let threw = false;
  try {
    generateNotebook(5 as NotebookLevel, mulberry32(1));
  } catch {
    threw = true;
  }
  assert(threw, "уровень вне 1–4 — RangeError");
  console.log("  OK: 4 уровня × сиды, диапазоны, шаг ≤ квинты, сумма такта 4/4, восьмые парами, детерминизм");
}

// --- 2. Судья: верно/неверно, попытки, «верно с первой», стрик ---

function testJudge(): void {
  console.log("Судья тетради:");

  // Управляемая тетрадь из трёх нот: попадание, промах+попадание, попадание.
  const sheet: NotebookSheet = {
    level: 2,
    measures: [
      { beats: 4, items: [{ pitch: 60, duration: "quarter" }, { pitch: 62, duration: "quarter" }] },
      { beats: 4, items: [{ pitch: 64, duration: "half" }, { pitch: 67, duration: "half" }] },
    ],
  };
  const judge = new NotebookJudge();
  assertEqual(judge.result(), null, "итог до старта — null");
  assertEqual(judge.handlePitch(60), null, "нажатие до старта — null");
  judge.start(sheet);
  assertEqual(judge.currentIndex, 0, "старт: индекс 0");
  assertEqual(judge.totalCount, 4, "всего 4 ноты");
  assertEqual(judge.expectedPitch, 60, "ждётся первая нота");
  assertEqual(judge.isComplete, false, "не завершена");

  // Нота 1: верно с первой — продвижение, стрик 1.
  const hit1 = judge.handlePitch(60);
  assert(hit1 !== null && hit1.correct && hit1.advanced, "верный питч — верно и продвинулся");
  assertEqual(judge.currentIndex, 1, "индекс стал 1");
  assertEqual(judge.currentStreak, 1, "стрик 1");

  // Нота 2: промах — позиция не двигается, attempts растёт, стрик рвётся.
  const miss = judge.handlePitch(64);
  assert(miss !== null && !miss.correct && !miss.advanced, "неверный питч — не продвижение");
  assertEqual(judge.currentIndex, 1, "промах не двигает позицию (wait-семантика)");
  assertEqual(judge.attemptsCurrent, 1, "промах отмечен на ноте");
  assertEqual(judge.currentStreak, 0, "промах сорвал стрик");
  judge.handlePitch(64);
  assertEqual(judge.attemptsCurrent, 2, "второй промах — attempts 2");
  const hit2 = judge.handlePitch(62);
  assert(hit2 !== null && hit2.advanced, "со второй попытки — продвижение");
  assertEqual(judge.attemptsCurrent, 0, "следующая нота начинается без промахов");

  // Нота 3 после промаха предыдущей: «не с первой» — стрик не растёт.
  assertEqual(judge.expectedPitch, 64, "ждётся третья нота");
  judge.handlePitch(67);
  const hit3 = judge.handlePitch(64);
  assert(hit3 !== null && hit3.advanced, "третья нота взята со второй попытки");

  // Нота 4 (последняя): верно — complete.
  const hit4 = judge.handlePitch(67);
  assert(hit4 !== null && hit4.complete, "последняя верная нота завершает тетрадь");
  assertEqual(judge.isComplete, true, "isComplete");
  assertEqual(judge.handlePitch(67), null, "нажатия после завершения — null");

  // Итог: 3 из 4 верно с первой → 75%; стрик рвался промахом и «не с первой».
  const result = judge.result();
  assert(result !== null, "итог доступен после завершения");
  assertEqual(result?.total, 4, "итог: всего 4");
  assertEqual(result?.firstTryCount, 2, "итог: верно с первой — 2 (ноты 1 и 4)");
  assertEqual(result?.firstTryPercent, 50, "итог: 2/4 → 50%");
  assertEqual(result?.bestStreak, 1, "итог: лучший стрик 1 (рвался промахом и повтором)");
  assertEqual(result?.level, 2, "итог: уровень записан");
  console.log("  OK: верно/неверно, wait-семантика, attempts, firstTry, стрик, итог 50%");
}

// --- 3. Судья на сгенерённой тетради: 100% и завершение на последней ---

function testJudgeOnGenerated(): void {
  console.log("Судья на сгенерённой тетради:");
  for (const level of NOTEBOOK_LEVELS) {
    const sheet = generateNotebook(level, mulberry32(2026 + level));
    const judge = new NotebookJudge();
    judge.start(sheet);
    const notes = notebookNotes(sheet);
    let guard = 0;
    while (!judge.isComplete && guard < notes.length + 10) {
      guard += 1;
      const expected = judge.expectedPitch;
      if (expected === null) break;
      judge.handlePitch(expected + 1); // всегда мимо
      const outcome = judge.handlePitch(expected); // затем верно
      if (outcome === null) break;
    }
    assert(judge.isComplete, `уровень ${level}: тетрадь дочитана после верных нажатий`);
    const result = judge.result();
    assert(result !== null, `уровень ${level}: итог доступен`);
    assertEqual(result?.total, notes.length, `уровень ${level}: итог по всем нотам`);
    assertEqual(result?.firstTryCount, 0, `уровень ${level}: каждая нота была с промахом — firstTry 0`);
    assertEqual(result?.bestStreak, 0, `уровень ${level}: стрик «верно с первой» пустой`);
    assertEqual(result?.firstTryPercent, 0, `уровень ${level}: 0% верно с первой`);
  }

  // Чистый проход без промахов: 100%, стрик = числу нот.
  const sheet = generateNotebook(1, mulberry32(5));
  const judge = new NotebookJudge();
  judge.start(sheet);
  const notes = notebookNotes(sheet);
  while (!judge.isComplete) {
    const expected = judge.expectedPitch;
    if (expected === null) break;
    judge.handlePitch(expected);
  }
  const perfect = judge.result();
  assertEqual(perfect?.firstTryPercent, 100, "все верно с первой → 100%");
  assertEqual(perfect?.bestStreak, notes.length, "стрик = числу нот без промахов");
  assertEqual(notebookProgressKey(3), "notebook-level-3", "ключ прогресса уровня 3");
  console.log("  OK: проход с промахами и без, complete на последней, ключ прогресса");
}

function main(): void {
  testGenerator();
  testJudge();
  testJudgeOnGenerated();
  console.log(`SMOKE OK: ${checks} проверок пройдено`);
}

try {
  main();
} catch (error) {
  console.error("SMOKE FAIL:", error);
  throw error;
}
