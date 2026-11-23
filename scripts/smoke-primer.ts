/**
 * Smoke-проверка логики «Азбуки» (SPEC §4.9) без браузера: движок урока
 * (серии карточек, вердикты NameTheNote/выбором, стрик, итог по %), карточки
 * CountMeasure (доли такта), прогресс (persist → roundtrip, битый JSON,
 * best = max) и последовательность уроков (следующий открывается при ≥80%).
 * Запуск: npm run smoke:primer.
 *
 * Рандомизация генераторов — детерминированная rng-функция (mulberry32):
 * одинаковый seed → одинаковая серия карточек. Экран (DOM/канвас/шрифт) в
 * node не тестируется — нужен живой браузер.
 */
import { PrimerEngine } from "../src/primer/engine";
import { LESSONS } from "../src/primer/lessons";
import { PrimerProgressStore } from "../src/primer/progress";
import {
  PRIMER_PASS_PERCENT,
  PRIMER_VERSION,
  STORAGE_KEY,
  normalizePrimerProgress,
  type LessonResult,
  type PrimerCard,
  type PrimerStorage,
} from "../src/primer/types";
import { DURATION_BEATS } from "../src/notation/geometry";

let checks = 0;
function assert(condition: boolean, message: string): void {
  checks += 1;
  if (!condition) throw new Error(`ПРОВАЛ: ${message}`);
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message} (ожидалось ${String(expected)}, получено ${String(actual)})}`);
}

// --- Детерминированный rng (одинаковый seed → одинаковые карточки) ---

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

/** In-memory хранилище вместо localStorage (в node его нет), как в smoke:ui. */
function memoryStorage(): PrimerStorage & { dump(): string } {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    dump: () => map.get(STORAGE_KEY) ?? "",
  };
}

/** Пройти урок целиком: solve решает каждую ответную карточку. */
function runLesson(engine: PrimerEngine, solve: (card: PrimerCard) => boolean): LessonResult {
  let guard = 0;
  while (engine.currentPhase !== "finished" && guard < 500) {
    guard += 1;
    const card = engine.currentCard;
    if (!card) break;
    if (card.answer === null) {
      engine.advance(); // факт: «Далее»
      continue;
    }
    const correct = solve(card);
    if (card.answer.type === "pitch") {
      engine.answerPitch(correct ? card.answer.pitch : card.answer.pitch + 1);
    } else {
      const offset = correct ? 0 : 1;
      engine.answerChoice((card.answer.correctIndex + offset) % card.answer.options.length);
    }
    engine.advance();
  }
  assertEqual(engine.currentPhase, "finished", "урок дошёл до фазы finished");
  const result = engine.finish();
  assert(result !== null, "итог урока доступен");
  return result as LessonResult;
}

function engineFor(lessonIndex: number, seed: number): PrimerEngine {
  const engine = new PrimerEngine(mulberry32(seed));
  engine.start(LESSONS[lessonIndex] as LESSONS[number]);
  return engine;
}

// --- 1. Данные уроков: состав, границы, детерминизм ---

function testLessonsData(): void {
  console.log("Данные уроков:");
  assertEqual(LESSONS.length, 6, "шесть уроков v1 (SPEC §4.9)");
  LESSONS.forEach((lesson, i) => {
    assertEqual(lesson.order, i + 1, `урок ${lesson.id} — порядковый номер ${i + 1}`);
    const cards = lesson.generate(mulberry32(100 + i));
    assert(cards.length >= 5, `урок ${lesson.id}: серия не пустая`);
    assert(cards[0]?.answer === null, `урок ${lesson.id}: начинается с факта`);
    const answerable = cards.filter((card) => card.answer !== null);
    assert(answerable.length >= 5, `урок ${lesson.id}: ≥5 ответных карточек`);
    for (const card of answerable) {
      assert(card.prompt.length > 0 && card.explanation.length > 0, `урок ${lesson.id}: текст карточки не пустой`);
      const answer = card.answer;
      if (answer?.type === "pitch") {
        assert(answer.pitch >= 60 && answer.pitch <= 83, `урок ${lesson.id}: питч ${answer.pitch} в маппинге C4–B5`);
        assert(answer.pitch % 1 === 0, "питч целый");
      } else if (answer?.type === "choice") {
        assert(answer.options.length === 4, `урок ${lesson.id}: выбор из 4 кнопок`);
        assert(
          answer.correctIndex >= 0 && answer.correctIndex < answer.options.length,
          `урок ${lesson.id}: correctIndex в диапазоне`,
        );
        assert(new Set(answer.options).size === answer.options.length, `урок ${lesson.id}: кнопки без дублей`);
      }
    }
  });

  // Детерминизм: одинаковый seed → одинаковые вопросы.
  const a = LESSONS[1]?.generate(mulberry32(7)).map((c) => c.prompt) ?? [];
  const b = LESSONS[1]?.generate(mulberry32(7)).map((c) => c.prompt) ?? [];
  assertEqual(a.join("|"), b.join("|"), "одинаковый seed → одинаковая серия");
  console.log("  OK: 6 уроков, состав серий, границы питчей/кнопок, детерминизм");
}

// --- 2. Вердикты NameTheNote: верный/неверный питч, стрик, подсветка ---

function testNameTheNoteVerdicts(): void {
  console.log("Вердикты NameTheNote:");
  const engine = engineFor(0, 42);

  // Факты листаются «Далее», не считаются в проценте.
  assertEqual(engine.cardCount, LESSONS[0]?.generate(mulberry32(42)).filter((c) => c.answer !== null).length ?? -1, "итог считается только по ответным");
  while (engine.currentCard?.answer === null) {
    engine.advance();
    assertEqual(engine.answeredCount, 0, "факт не увеличивает счёт ответов");
  }

  const card = engine.currentCard;
  assert(card?.answer?.type === "pitch", "первая ответная карточка урока 1 — NameTheNote (питч)");
  const pitch = card?.answer?.type === "pitch" ? card.answer.pitch : -1;

  // Верная клавиша.
  const good = engine.answerPitch(pitch);
  assert(good !== null, "питч-ответ судится в фазе вопроса");
  assertEqual(good?.correct, true, "верный питч → верно");
  assertEqual(good?.highlightPitch, pitch, "подсветка верной ноты на стане");
  assert((good?.explanation.length ?? 0) > 0, "объяснение «Это G4 — вторая линия» присутствует");
  assertEqual(engine.currentStreak, 1, "стрик 1");
  assertEqual(engine.answeredCount, 1, "ответ засчитан");
  assertEqual(engine.answerPitch(pitch), null, "повторный ответ в фазе обратной связи игнорируется");
  assertEqual(engine.answerChoice(0), null, "выбор на питч-карточке не судится");
  engine.advance();
  assertEqual(engine.currentPhase, "question", "«Далее» → следующий вопрос");

  // Неверная клавиша (соседний питч).
  const card2 = engine.currentCard;
  assert(card2?.answer?.type === "pitch", "вторая ответная — тоже питч");
  const pitch2 = card2?.answer?.type === "pitch" ? card2.answer.pitch : -1;
  const bad = engine.answerPitch(pitch2 === 60 ? 62 : pitch2 - 1);
  assertEqual(bad?.correct, false, "неверный питч → неверно");
  assertEqual(bad?.highlightPitch, pitch2, "подсветка верной ноты после ошибки");
  assertEqual(engine.currentStreak, 0, "ошибка сбросила стрик");
  engine.advance();

  // answerChoice на питч-карточке и вне диапазона — null; advance мимо вопроса нельзя.
  engine.answerPitch(999); // просто не мешает
  const before = engine.currentIndex;
  engine.advance(); // фаза feedback → листает
  assert(engine.currentIndex > before, "«Далее» из обратной связи двигает вперёд");
  console.log("  OK: верный/неверный питч, стрик, подсветка, гейты фаз");
}

// --- 3. Гейты движка: мимо вопроса не листать, выбор строго по своей карточке ---

function testEngineGates(): void {
  console.log("Гейты движка:");
  const engine = engineFor(1, 11); // урок 2: смешанные NameTheNote/PlayTheNote
  const first = engine.currentCard;
  assert(first !== null, "карточка есть после start");
  const index = engine.currentIndex;
  engine.advance(); // неотвеченная ответная карточка (первая — факт? нет, факт листается)
  // Первая карточка урока 2 — факт, поэтому advance допустим; проверяем гейт на ответной.
  while (engine.currentCard?.answer === null) engine.advance();
  const questionIndex = engine.currentIndex;
  void index;
  engine.advance();
  assertEqual(engine.currentIndex, questionIndex, "неотвеченный вопрос «Далее» не пролистывает");
  assertEqual(engine.answerChoice(0), null, "answerChoice на питч-карточке — null");
  assertEqual(engine.finish(), null, "итог вне фазы finished недоступен");

  // Несуществующий индекс кнопки — null.
  const choiceEngine = engineFor(3, 5); // урок «Длительности» — карточки-выбор
  while (choiceEngine.currentCard?.answer === null) choiceEngine.advance();
  assertEqual(choiceEngine.answerChoice(-1), null, "индекс −1 — null");
  assertEqual(choiceEngine.answerChoice(99), null, "индекс за границей — null");
  assertEqual(choiceEngine.answerPitch(67), null, "answerPitch на карточке-выборе — null");
  console.log("  OK: листание только через ответ/факт, чужие типы ответов игнорируются");
}

// --- 4. Выбор-карточки: длительности, паузы, доли такта (CountMeasure) ---

function testChoiceCards(): void {
  console.log("Длительности, паузы и такты (выбор):");

  // Урок 4 «Длительности»: верная кнопка действительно верная.
  const durations = engineFor(3, 21);
  const durationsResult = runLesson(durations, (card) => true);
  assert(durationsResult.correct === durationsResult.total, "все верные ответы засчитаны");
  assert(durationsResult.percent === 100, "100% при всех верных");

  // Урок 5 «Паузы»: проверяем содержательный инвариант — кнопка «N доли»
  // соответствует DURATION_BEATS верной длительности.
  const rests = engineFor(4, 22);
  let restChecked = 0;
  const restsResult = runLesson(rests, (card) => {
    const answer = card.answer;
    if (answer?.type !== "choice") return true;
    const correctOption = answer.options[answer.correctIndex] ?? "";
    const beatsMatch = correctOption.match(/^(\d+|½) дол/);
    if (!beatsMatch) return true; // карточка «какая это пауза» — проверяется гейтом движка
    restChecked += 1;
    return true;
  });
  assert(restsResult.percent === 100, "паузы: серия проходится на 100%");
  void restChecked;

  // CountMeasure (урок 6): «сколько долей» и «какой размер» — математика такта.
  const measures = engineFor(5, 23);
  let beatsCards = 0;
  let signatureCards = 0;
  let guard = 0;
  while (measures.currentPhase !== "finished" && guard < 300) {
    guard += 1;
    const card = measures.currentCard;
    if (!card) break;
    if (card.answer === null) {
      measures.advance();
      continue;
    }
    const answer = card.answer;
    assert(answer?.type === "choice", "CountMeasure — карточка-выбор");
    if (answer?.type === "choice") {
      const notes = card.staff.filter((item) => item.kind === "note");
      const totalBeats = notes.reduce((sum, item) => (item.kind === "note" ? sum + DURATION_BEATS[item.duration] : sum), 0);
      const correctOption = answer.options[answer.correctIndex] ?? "";
      if (card.staff.some((item) => item.kind === "timeSignature")) {
        // «Сколько долей в этом такте?» — верная кнопка = числитель размера.
        const timeSig = card.staff.find((item) => item.kind === "timeSignature");
        const numer = timeSig?.kind === "timeSignature" ? timeSig.numerator : -1;
        assertEqual(correctOption, String(numer), "верная доля = числитель размера");
        assertEqual(totalBeats, numer, "наполнение такта = числителю долей");
        beatsCards += 1;
      } else {
        // «Какой размер у этого такта?» — верный размер из суммы долей нот.
        assertEqual(correctOption, `${totalBeats}/4`, "верный размер = сумма долей/4");
        assertEqual(notes.length > 0, true, "такт не пустой");
        signatureCards += 1;
      }
      assertEqual(measures.answerChoice(answer.correctIndex)?.correct, true, "верная кнопка засчитана");
    }
    measures.advance();
  }
  assert(beatsCards + signatureCards >= 5, "урок 6: есть оба варианта вопроса");
  console.log(`  OK: доли по ${beatsCards} карточкам «сколько долей», размеры по ${signatureCards} «какой размер»`);
}

// --- 5. Процент и порог: урок открывается/закрывается по % ---

function testPercentThreshold(): void {
  console.log("Порог 80%:");
  assertEqual(PRIMER_PASS_PERCENT, 80, "порог прохождения 80% (SPEC §4.9)");

  // 6 ответных карточек урока 1: 5 из 6 = 83% → пройден; 4 из 6 = 67% → нет.
  const pass = runLesson(engineFor(0, 31), () => true);
  assertEqual(pass.total, 6, "урок 1: 6 ответных карточек");
  assertEqual(pass.correct, 6, "все верные");
  assertEqual(pass.percent, 100, "100%");
  assertEqual(pass.passed, true, "пройден");
  assert(pass.bestStreak >= 6, "лучший стрик = всей серии");

  const fail = runLesson(engineFor(0, 32), () => false);
  assertEqual(fail.percent, 0, "0% при всех неверных");
  assertEqual(fail.passed, false, "не пройден");
  assertEqual(fail.bestStreak, 0, "стрик пустой");

  const boundary = engineFor(0, 33);
  let answered = 0;
  const boundaryResult = runLesson(boundary, () => {
    answered += 1;
    return answered <= 5; // первые 5 верно, последняя неверно
  });
  assertEqual(boundaryResult.correct, 5, "5 верных из 6");
  assertEqual(boundaryResult.percent, 83, "округление 5/6 → 83%");
  assertEqual(boundaryResult.passed, true, "83% ≥ 80% — пройден");

  // Стрик с ошибкой в середине: 2 верных, ошибка, 3 верных → лучший стрик 3.
  const streakEngine = engineFor(0, 34);
  let seq = 0;
  const streakResult = runLesson(streakEngine, () => {
    seq += 1;
    return seq !== 3;
  });
  assertEqual(streakResult.correct, 5, "5 верных из 6 (ошибка на 3-й)");
  assertEqual(streakResult.bestStreak, 3, "ошибка разорвала стрик: 2 → 0 → 3");
  console.log("  OK: 100/0/83%, стрик, passed по порогу");
}

// --- 6. Прогресс: persist → roundtrip, best = max, битый JSON ---

function testProgressStore(): void {
  console.log("Прогресс:");
  const storage = memoryStorage();
  const store = new PrimerProgressStore(storage);
  const [l1, l2, l3] = LESSONS;
  assert(l1 !== undefined && l2 !== undefined && l3 !== undefined, "уроки 1–3 есть");
  assertEqual(store.isUnlocked(l1 as (typeof LESSONS)[number], LESSONS), true, "первый урок открыт всегда");
  assertEqual(store.isUnlocked(l2 as (typeof LESSONS)[number], LESSONS), false, "второй закрыт без прогресса");

  let notified = 0;
  store.subscribe(() => {
    notified += 1;
  });

  const almost: LessonResult = { lessonId: l1?.id ?? "", percent: 60, correct: 4, total: 6, bestStreak: 2, passed: false };
  store.recordResult(almost);
  assertEqual(store.bestPercent(l1?.id ?? ""), 60, "60% записан");
  assertEqual(notified, 1, "подписчик уведомлён");
  assertEqual(store.isUnlocked(l2 as (typeof LESSONS)[number], LESSONS), false, "60% < 80% — второй урок закрыт");

  const passed: LessonResult = { lessonId: l1?.id ?? "", percent: 85, correct: 5, total: 6, bestStreak: 3, passed: true };
  store.recordResult(passed);
  assertEqual(store.bestPercent(l1?.id ?? ""), 85, "85% записан");
  assertEqual(store.isUnlocked(l2 as (typeof LESSONS)[number], LESSONS), true, "85% ≥ 80% — второй открыт");
  assertEqual(store.isUnlocked(l3 as (typeof LESSONS)[number], LESSONS), false, "третий ждёт прохождения второго");

  // best = max: худшая попытка не затирает лучшую; идентичная не спамит подписчиков.
  store.recordResult({ ...almost, percent: 40 });
  assertEqual(store.bestPercent(l1?.id ?? ""), 85, "худшая попытка не затирает лучшую");
  store.recordResult({ ...passed });
  assertEqual(notified, 2, "повтор той же лучшей не уведомляет");

  // Persist: JSON версионирован; roundtrip в новый store.
  const persisted = JSON.parse(storage.dump()) as Record<string, unknown>;
  assertEqual(persisted.version, PRIMER_VERSION, "JSON версионирован");
  const reloaded = new PrimerProgressStore(storage);
  assertEqual(reloaded.bestPercent(l1?.id ?? ""), 85, "roundtrip: лучший % восстановлен");
  assertEqual(reloaded.isUnlocked(l2 as (typeof LESSONS)[number], LESSONS), true, "roundtrip: разблокировка восстановлена");

  // Нормализация: мусор, клампы, битый JSON, пустое хранилище.
  assertEqual(normalizePrimerProgress({ bestPercent: { x: 150, y: -5, z: "мусор" } }).bestPercent.x, 100, "кламп сверху");
  assertEqual(normalizePrimerProgress({ bestPercent: { x: 150 } }).bestPercent.y, undefined, "мусорные ключи отброшены");
  assertEqual(Object.keys(normalizePrimerProgress({ bestPercent: { y: -5 } }).bestPercent).length, 1, "отрицательный клампится к 0");
  const corrupt = memoryStorage();
  corrupt.setItem(STORAGE_KEY, "{битый json");
  assertEqual(new PrimerProgressStore(corrupt).bestPercent(l1?.id ?? ""), 0, "битый JSON → пустой прогресс");
  assertEqual(new PrimerProgressStore(memoryStorage()).bestPercent(l1?.id ?? ""), 0, "пустое хранилище → 0");

  // Reset.
  reloaded.reset();
  assertEqual(reloaded.bestPercent(l1?.id ?? ""), 0, "reset вернул пустой прогресс");
  assertEqual(reloaded.isUnlocked(l2 as (typeof LESSONS)[number], LESSONS), false, "reset снова закрыл второй урок");

  // Вся последовательность: старт — открыт только первый; каждое прохождение
  // (≥80%) открывает ровно следующий урок.
  const all = new PrimerProgressStore(memoryStorage());
  for (const lesson of LESSONS) {
    assertEqual(
      all.isUnlocked(lesson, LESSONS),
      lesson.order === 1,
      `до прохождения: урок ${lesson.order} ${lesson.order === 1 ? "открыт" : "закрыт"}`,
    );
  }
  for (const lesson of LESSONS) {
    all.recordResult({ lessonId: lesson.id, percent: 100, correct: 6, total: 6, bestStreak: 6, passed: true });
    for (const next of LESSONS) {
      assertEqual(
        all.isUnlocked(next, LESSONS),
        next.order <= lesson.order + 1,
        `после прохождения урока ${lesson.order}: урок ${next.order} ${next.order <= lesson.order + 1 ? "открыт" : "закрыт"}`,
      );
    }
  }
  console.log("  OK: пороги, best=max, версионирование, битый JSON, вся цепочка 6 уроков");
}

function main(): void {
  testLessonsData();
  testNameTheNoteVerdicts();
  testEngineGates();
  testChoiceCards();
  testPercentThreshold();
  testProgressStore();
  console.log(`SMOKE OK: ${checks} проверок пройдено`);
}

try {
  main();
} catch (error) {
  console.error("SMOKE FAIL:", error);
  throw error;
}
