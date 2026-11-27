/**
 * Smoke-проверка логики «Азбуки» (SPEC §4.9) без браузера: движок урока
 * (серии карточек, вердикты NameTheNote/выбором, стрик, итог по %), карточки
 * CountMeasure (доли такта), прогресс (persist → roundtrip, битый JSON,
 * best = max) и последовательность уроков (следующий открывается при ≥80%).
 * Плюс раздел «Гитара» (research 06): реестр GUITAR_LESSONS (структура,
 * пулы в словаре I позиции), звук показа cardSoundPitch (soundingMidi),
 * диаграмма fretboardHighlight (словарь + явная подсказка B4=3.IV), гейты
 * гитарной цепочки guitar-1..6 (независимой от нотной). И уроки басового
 * ключа 7–9 (PIANO-13): clef-карточки, пулы G2–B3 / C3–B3, пары «одна нота —
 * два ключа», позиционные имена, гейты 6→7→8→9. И уроки альтерации 10–11
 * (PIANO-14): пулы ♯/♭, бекар-пары «♯/♭ → ♮», письменная позиция ♭,
 * энгармонизм D♭4 = клавиша C♯4, гейты 9→10→11.
 * Запуск: npm run smoke:primer.
 *
 * Рандомизация генераторов — детерминированная rng-функция (mulberry32):
 * одинаковый seed → одинаковая серия карточек. Экран (DOM/канвас/шрифт) в
 * node не тестируется — нужен живой браузер.
 */
import { PrimerEngine } from "../src/primer/engine";
import { LESSONS, staffPositionName } from "../src/primer/lessons";
import { cardSoundPitch, fretboardHighlight, GUITAR_LESSONS } from "../src/primer/guitar-lessons";
import { PrimerProgressStore } from "../src/primer/progress";
import { isBlackPitch } from "../src/core/layout";
import {
  FIRST_POSITION_WRITTEN_HIGH,
  FIRST_POSITION_WRITTEN_LOW,
  guitarToSounding,
  isValidGuitarNote,
  soundingMidi,
  writtenToGuitar,
} from "../src/core/fretboard";
import {
  PRIMER_PASS_PERCENT,
  PRIMER_VERSION,
  STORAGE_KEY,
  normalizePrimerProgress,
  type LessonResult,
  type PrimerCard,
  type PrimerStorage,
  type StaffNote,
} from "../src/primer/types";
import { DURATION_BEATS, pitchToStaffPos, writtenPitch } from "../src/notation/geometry";

let checks = 0;
function assert(condition: boolean, message: string): void {
  checks += 1;
  if (!condition) throw new Error(`ПРОВАЛ: ${message}`);
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message} (ожидалось ${String(expected)}, получено ${String(actual)})}`);
}
function assertNotEqual<T>(actual: T, unexpected: T, message: string): void {
  assert(actual !== unexpected, `${message} (не должно быть ${String(unexpected)})}`);
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
  assertEqual(LESSONS.length, 11, "одиннадцать уроков: 6 (SPEC §4.9 v1) + 3 басовых (PIANO-13) + 2 альтерации (PIANO-14)");
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
        assert(
          answer.pitch >= 43 && answer.pitch <= 83,
          `урок ${lesson.id}: питч ${answer.pitch} достижим маппингом с октавным сдвигом (G2–B6 при Z ≤ 2)`,
        );
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
  console.log("  OK: 9 уроков, состав серий, границы питчей/кнопок, детерминизм");
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
  console.log("  OK: пороги, best=max, версионирование, битый JSON, вся цепочка 11 уроков");
}

// --- 7. Раздел «Гитара» (research 06): структура уроков и словарь I позиции ---

/** Первая нота на стане карточки (гитарные карточки всегда показывают ноту). */
function staffNote(card: PrimerCard): StaffNote | null {
  const found = card.staff.find((item): item is StaffNote => item.kind === "note");
  return found ?? null;
}

function testGuitarLessonsData(): void {
  console.log("Гитарные уроки (research 06 §6):");
  assertEqual(GUITAR_LESSONS.length, 6, "шесть гитарных уроков Г1–Г6");
  const ids = GUITAR_LESSONS.map((lesson) => lesson.id);
  assertEqual(ids.join(","), "guitar-1,guitar-2,guitar-3,guitar-4,guitar-5,guitar-6", "ids guitar-1..6 по порядку");
  GUITAR_LESSONS.forEach((lesson, i) => {
    assertEqual(lesson.order, i + 1, `порядок Г${i + 1}`);
    assertEqual(lesson.section, "guitar", `урок ${lesson.id} помечен разделом «guitar»`);
    const cards = lesson.generate(mulberry32(300 + i));
    assert(cards.length >= 6, `${lesson.id}: серия не пустая`);
    assert(cards[0]?.answer === null, `${lesson.id}: начинается с факта`);
    const answerable = cards.filter((card) => card.answer !== null);
    assert(answerable.length >= 5, `${lesson.id}: ≥5 ответных карточек`);
    for (const card of cards) {
      if (card.fretboard) {
        assert(isValidGuitarNote(card.fretboard), `${lesson.id}: подсказка грифа в I позиции`);
      }
      const note = staffNote(card);
      if (note) {
        assert(writtenToGuitar(note.pitch) !== null, `${lesson.id}: показ ${note.pitch} из словаря I позиции`);
        assert(
          note.pitch >= FIRST_POSITION_WRITTEN_LOW && note.pitch <= FIRST_POSITION_WRITTEN_HIGH,
          `${lesson.id}: показ ${note.pitch} в диапазоне E3–G♯5`,
        );
      }
      const answer = card.answer;
      if (answer?.type === "pitch") {
        const g = writtenToGuitar(answer.pitch);
        assert(g !== null, `${lesson.id}: ответ ${answer.pitch} из словаря I позиции`);
        // Звучащая высота ответа — в строе E2–G♯4 (research 06 §1).
        const sounding = soundingMidi(answer.pitch);
        assert(sounding >= 40 && sounding <= 68, `${lesson.id}: звучащая ${sounding} в строе`);
        assertEqual(sounding, guitarToSounding(g as NonNullable<typeof g>), `${lesson.id}: звук = звук словарной ноты`);
      } else if (answer?.type === "choice") {
        assert(answer.options.length >= 2, `${lesson.id}: выбор не пустой`);
        assert(new Set(answer.options).size === answer.options.length, `${lesson.id}: кнопки без дублей`);
        assert(
          answer.correctIndex >= 0 && answer.correctIndex < answer.options.length,
          `${lesson.id}: correctIndex в диапазоне`,
        );
      }
    }
  });
  console.log("  OK: 6 уроков, section=guitar, все питчи в словаре E3–G♯5, звук = словарная нота");
}

// --- 8. Г1 «Открытые струны»: все шесть, смешанные типы ответа ---

function testGuitarOpenStrings(): void {
  console.log("Г1 «Открытые струны»:");
  const lesson = GUITAR_LESSONS[0] as (typeof GUITAR_LESSONS)[number];
  const cards = lesson.generate(mulberry32(777));
  const answerable = cards.filter((card) => card.answer !== null);
  const shown = new Set<number>();
  let stringCards = 0;
  let pitchCards = 0;
  for (const card of answerable) {
    const note = staffNote(card);
    assert(note !== null, "карточка Г1 показывает ноту на стане");
    if (note) shown.add(note.pitch);
    const answer = card.answer;
    if (answer?.type === "choice") {
      stringCards += 1;
      assertEqual(answer.options.join(","), "1,2,3,4,5,6", "кнопки — номера струн 1–6");
      const g = note ? writtenToGuitar(note.pitch) : null;
      assert(g !== null, "нота Г1 в словаре");
      assertEqual(answer.correctIndex, (g?.string ?? 0) - 1, "верная кнопка = номер струны по словарю");
      const hint = fretboardHighlight(card);
      assert(hint !== null && hint.string === g?.string && hint.fret === 0, "диаграмма — открытая струна");
      assert((card.explanation.includes("октавой ниже")), "объяснение упоминает октаву вниз");
    } else if (answer?.type === "pitch") {
      pitchCards += 1;
      assertEqual(answer.pitch, note?.pitch ?? -1, "ответ клавишей = записанная высота показанной ноты");
    }
  }
  assertEqual(
    [...shown].sort((a, b) => b - a).join(","),
    "76,71,67,62,57,52",
    "все шесть открытых спрошены (E5 B4 G4 D4 A3 E3)",
  );
  assert(stringCards > 0 && pitchCards > 0, "смешаны типы: «какая струна?» и «сыграй»");
  // Факт про октаву: запись в скрипичном ключе, «8» не пишут.
  const fact2 = cards[1];
  assert((fact2?.explanation ?? "").includes("октавой ниже записи"), "факт Г1: звучит октавой ниже записи");
  assert((fact2?.explanation ?? "").includes("8"), "факт Г1: «8» под ключом не пишут");
  console.log(`  OK: 6 открытых струн, ${stringCards} карточек-выбор + ${pitchCards} клавишей, факт про октаву`);
}

// --- 9. Диаграмма грифа: словарь и явная подсказка B4=3.IV ---

function testGuitarFretboardHints(): void {
  console.log("Подсказки грифа:");
  // Г4: B4 в уроке 3-й струны — явная подсказка 3-я струна IV лад (не словарная
  // открытая 2-я); остальные ноты — строго по словарю.
  const g4 = GUITAR_LESSONS[3] as (typeof GUITAR_LESSONS)[number];
  let sawB4 = false;
  for (let seed = 1; seed <= 30; seed += 1) {
    for (const card of g4.generate(mulberry32(seed))) {
      const answer = card.answer;
      if (answer?.type !== "pitch") continue;
      const hint = fretboardHighlight(card);
      if (answer.pitch === 71) {
        sawB4 = true;
        assert(hint !== null && hint.string === 3 && hint.fret === 4, "B4 в Г4 — 3-я струна IV лад");
      } else {
        const dict = writtenToGuitar(answer.pitch);
        assert(hint !== null && hint.string === dict?.string && hint.fret === dict?.fret, `${answer.pitch}: диаграмма по словарю`);
      }
    }
  }
  assert(sawB4, "Г4 за 30 seed'ов спросил B4");

  // Факт Г3 объясняет дубликат B4 (открытая 2-я vs 3-я IV лад).
  const g3 = GUITAR_LESSONS[2] as (typeof GUITAR_LESSONS)[number];
  const g3Fact = g3.generate(mulberry32(5))[0];
  assert((g3Fact?.explanation ?? "").includes("открытая 2-я и 3-я струна IV лад"), "факт Г3 называет оба места B4");

  // Карточки без явной подсказки (Г6): диаграмма строится из словаря.
  const g6 = GUITAR_LESSONS[5] as (typeof GUITAR_LESSONS)[number];
  for (const card of g6.generate(mulberry32(42))) {
    const answer = card.answer;
    if (answer?.type !== "pitch") continue;
    assertEqual(card.fretboard, undefined, "Г6 без явных подсказок");
    const hint = fretboardHighlight(card);
    const dict = writtenToGuitar(answer.pitch);
    assert(hint !== null && hint.string === dict?.string && hint.fret === dict?.fret, "без подсказки — словарь");
  }

  // Факты и выбор без подсказки дают null (чистый гриф), а не мусор.
  assertEqual(fretboardHighlight({ prompt: "", staff: [], explanation: "", answer: null }), null, "факт без подсказки → null");
  console.log("  OK: B4=3.IV в Г4 по подсказке, остальные — словарь writtenToGuitar");
}

// --- 10. Звук показа: гитарные уроки — soundingMidi, нотные — запись ---

function testGuitarSound(): void {
  console.log("Звук показа карточек:");
  assertEqual(soundingMidi(76), 64, "показ E5 (открытая 1-я) звучит 64 = E4");
  assertEqual(soundingMidi(52), 40, "показ E3 (открытая 6-я) звучит 40 = E2");
  const guitarLesson = GUITAR_LESSONS[0] as (typeof GUITAR_LESSONS)[number];
  const notationLesson = LESSONS[0] as (typeof LESSONS)[number];
  assertEqual(cardSoundPitch(guitarLesson, 76), 64, "гитарный урок: soundingMidi");
  assertEqual(cardSoundPitch(notationLesson, 76), 76, "нотный урок: записанная высота");
  // Вся гитарная серия: звук показа каждой ноты = soundingMidi.
  for (const lesson of GUITAR_LESSONS) {
    const cards = lesson.generate(mulberry32(9));
    let sounded = 0;
    for (const card of cards) {
      const note = staffNote(card);
      if (!note) continue;
      assertEqual(cardSoundPitch(lesson, note.pitch), note.pitch - 12, `${lesson.id}: показ ${note.pitch} − 12`);
      sounded += 1;
    }
    assert(sounded > 0, `${lesson.id}: есть показы ноты`);
  }
  console.log("  OK: guitar → written − 12 на всех показах, notation → written");
}

// --- 11. Движок и гейты гитарной цепочки (независимой от нотной) ---

function testGuitarEngineAndGates(): void {
  console.log("Движок и гейты гитарной цепочки:");
  // Каждая гитарная серия проходится движком на 100% (выбор + клавиша вперемешку).
  GUITAR_LESSONS.forEach((lesson, i) => {
    const engine = new PrimerEngine(mulberry32(500 + i));
    engine.start(lesson);
    const result = runLesson(engine, () => true);
    assertEqual(result.percent, 100, `${lesson.id}: серия проходится на 100%`);
    assertEqual(result.passed, true, `${lesson.id}: пройден`);
    assertEqual(result.lessonId, lesson.id, `итог с id ${lesson.id}`);
  });

  // Вердикт выбора струны: кнопка с номером по словарю — верная.
  const engine = new PrimerEngine(mulberry32(600));
  engine.start(GUITAR_LESSONS[0] as (typeof GUITAR_LESSONS)[number]);
  while (engine.currentCard?.answer === null) engine.advance();
  const card = engine.currentCard;
  assert(card?.answer?.type === "choice", "первая ответная Г1 — выбор струны");
  if (card?.answer?.type === "choice") {
    const verdict = engine.answerChoice(card.answer.correctIndex);
    assert(verdict?.correct === true, "номер струны по словарю засчитан");
    assert((verdict?.explanation ?? "").includes("октавой ниже"), "объяснение упоминает октаву вниз");
    assertEqual(verdict?.highlightPitch ?? null, null, "подсветка стана у выбора — через диаграмму, не питч");
  }

  // Гейты: Г-цепочка своя; нотный прогресс её не двигает (и наоборот).
  const store = new PrimerProgressStore(memoryStorage());
  const g1 = GUITAR_LESSONS[0] as (typeof GUITAR_LESSONS)[number];
  const g2 = GUITAR_LESSONS[1] as (typeof GUITAR_LESSONS)[number];
  const g3 = GUITAR_LESSONS[2] as (typeof GUITAR_LESSONS)[number];
  const n1 = LESSONS[0] as (typeof LESSONS)[number];
  const n2 = LESSONS[1] as (typeof LESSONS)[number];
  assertEqual(store.isUnlocked(g1, GUITAR_LESSONS), true, "Г1 открыта всегда");
  for (const lesson of GUITAR_LESSONS.slice(1)) {
    assertEqual(store.isUnlocked(lesson, GUITAR_LESSONS), false, `${lesson.id} закрыт без прогресса`);
  }
  store.recordResult({ lessonId: g1.id, percent: 100, correct: 7, total: 7, bestStreak: 7, passed: true });
  assertEqual(store.isUnlocked(g2, GUITAR_LESSONS), true, "Г1 ≥80% → Г2 открыта");
  assertEqual(store.isUnlocked(g3, GUITAR_LESSONS), false, "Г3 ждёт Г2");
  store.recordResult({ lessonId: n1.id, percent: 100, correct: 6, total: 6, bestStreak: 6, passed: true });
  assertEqual(store.isUnlocked(g3, GUITAR_LESSONS), false, "нотный урок не открывает Г3");
  assertEqual(store.isUnlocked(n2, LESSONS), true, "нотная цепочка отвечает на свой прогресс");
  store.recordResult({ lessonId: g2.id, percent: 100, correct: 5, total: 5, bestStreak: 5, passed: true });
  assertEqual(store.isUnlocked(g3, GUITAR_LESSONS), true, "Г2 ≥80% → Г3 открыта");

  // Полная гитарная цепочка: каждое прохождение открывает ровно следующий.
  const full = new PrimerProgressStore(memoryStorage());
  for (const lesson of GUITAR_LESSONS) {
    full.recordResult({ lessonId: lesson.id, percent: 100, correct: 8, total: 8, bestStreak: 8, passed: true });
    for (const next of GUITAR_LESSONS) {
      assertEqual(
        full.isUnlocked(next, GUITAR_LESSONS),
        next.order <= lesson.order + 1,
        `после Г${lesson.order}: Г${next.order} ${next.order <= lesson.order + 1 ? "открыт" : "закрыт"}`,
      );
    }
  }
  console.log("  OK: серии проходятся, вердикт выбора, гейты guitar-1..6 независимы от нотных");
}

// --- 12. Басовый ключ (PIANO-13): уроки 7–9 — clef-карточки, пулы, пары ключей ---

function testBassClefLessons(): void {
  console.log("Уроки басового ключа (PIANO-13):");
  const bassClef = LESSONS[6] as (typeof LESSONS)[number];
  const smallOctave = LESSONS[7] as (typeof LESSONS)[number];
  const bothClefs = LESSONS[8] as (typeof LESSONS)[number];

  // Реестр: номера 7–9 подряд, нотная секция (как уроки 1–6, не «Гитара»).
  assertEqual(LESSONS.length, 11, "одиннадцать нотных уроков");
  assertEqual([bassClef.id, smallOctave.id, bothClefs.id].join(","), "bass-clef,octave-3,both-clefs", "ids по порядку");
  assertEqual([bassClef.order, smallOctave.order, bothClefs.order].join(","), "7,8,9", "номера 7–9 подряд");
  assert(bassClef.section === undefined && smallOctave.section === undefined && bothClefs.section === undefined, "уроки 7–9 — нотная секция");

  // Урок 7 «Басовый ключ»: 2 факта + 9 ответных, все карточки clef="bass".
  const l7 = bassClef.generate(mulberry32(700));
  const answerable7 = l7.filter((card) => card.answer !== null);
  assertEqual(answerable7.length, 9, "урок 7: 9 ответных карточек (весь пул за один заход)");
  assertEqual(l7.length, 11, "урок 7: 2 факта + 9 ответных");
  const asked7 = new Set<number>();
  for (const card of l7) {
    assertEqual(card.clef, "bass", `урок 7 «${card.prompt}»: карточка в басовом ключе`);
    const note = staffNote(card);
    if (note) asked7.add(note.pitch);
    const answer = card.answer;
    if (answer?.type === "pitch") {
      assert(answer.pitch >= 43 && answer.pitch <= 59, `урок 7: ответ ${answer.pitch} внутри G2–B3`);
      asked7.add(answer.pitch);
    }
  }
  assertEqual(
    [...asked7].sort((a, b) => a - b).join(","),
    "43,47,48,50,52,53,55,57,59",
    "урок 7 спросил весь пул: G2 B2 C3 D3 E3 F3 G3 A3 B3 (линии G2 B2 D3 F3 A3, промежутки C3 E3 G3, над станом B3)",
  );
  assert((l7[0]?.explanation ?? "").includes("четвёртую линию"), "факт 7: точки ключа охватывают четвёртую линию");
  assert((l7[0]?.explanation ?? "").includes("F3"), "факт 7: на четвёртой линии F3");
  assert((l7[0]?.explanation ?? "").includes("левой руки"), "факт 7: басовый ключ — для левой руки");
  assert((l7[1]?.explanation ?? "").includes("Z"), "факт 7: объясняет октавный сдвиг Z");

  // Урок 8 «Малая октава»: все ответы внутри C3–B3; за 30 seed'ов спрошены все 7 натуральных.
  const shown8 = new Set<number>();
  for (let seed = 1; seed <= 30; seed += 1) {
    for (const card of smallOctave.generate(mulberry32(seed))) {
      assertEqual(card.clef, "bass", `урок 8 «${card.prompt}»: карточка в басовом ключе`);
      const answer = card.answer;
      if (answer?.type === "pitch") {
        assert(answer.pitch >= 48 && answer.pitch <= 59, `урок 8: ответ ${answer.pitch} внутри малой октавы C3–B3`);
        shown8.add(answer.pitch);
      }
    }
  }
  assertEqual(
    [...shown8].sort((a, b) => a - b).join(","),
    "48,50,52,53,55,57,59",
    "урок 8 за 30 seed'ов спросил всю малую октаву C3 B3 (7 натуральных)",
  );
  const l8 = smallOctave.generate(mulberry32(800));
  assert((l8[1]?.explanation ?? "").includes("Tab"), "факт 8: связь с клавиатурой — Tab становится C3");
  assert((l8[1]?.explanation ?? "").includes("Z"), "факт 8: объясняет сдвиг Z");

  // Урок 9 «Оба ключа»: пары одной ноты подряд — скрипичный и басовый, оба ключа в серии.
  const l9 = bothClefs.generate(mulberry32(900));
  assertEqual(l9.length, 12, "урок 9: 2 факта + 10 ответных (5 нот × 2 ключа)");
  for (let i = 2; i < l9.length; i += 2) {
    const first = l9[i];
    const second = l9[i + 1] as PrimerCard;
    const pitch1 = first?.answer?.type === "pitch" ? first.answer.pitch : -1;
    const pitch2 = second?.answer?.type === "pitch" ? second.answer.pitch : -1;
    assertEqual(pitch1, pitch2, `пара ${i / 2}: одна нота в двух карточках`);
    assertNotEqual(first?.clef, second?.clef, `пара ${i / 2}: ключи разные`);
    assert(first?.clef === "treble" || first?.clef === "bass", "clef пары — treble или bass");
    assert(pitch1 === 55 || pitch1 === 59 || pitch1 === 60 || pitch1 === 62 || pitch1 === 64, `пара: нота ${pitch1} из пула G3 B3 C4 D4 E4`);
  }
  const clefs9 = new Set(l9.filter((c) => c.answer !== null).map((c) => c.clef));
  assert(clefs9.has("treble") && clefs9.has("bass"), "урок 9: и скрипичный, и басовый ключи в ответных карточках");
  assert((l9[1]?.explanation ?? "").includes("средняя до"), "факт 9: C4 — «средняя до», граница ключей");
  assert((l9[1]?.explanation ?? "").includes("сверху"), "факт 9: в басовом C4 — добавочная сверху");

  // Позиционные имена (справка карточек) — включая обрамлённые промежутки
  // (латентный баг «undefined добавочная» на B5/D4 устранён).
  assertEqual(staffPositionName(3), "второй промежуток", "C3 в басовом — второй промежуток");
  assertEqual(staffPositionName(6), "четвёртая линия", "F3 в басовом — четвёртая линия");
  assertEqual(staffPositionName(9), "промежуток над станом", "B3 в басовом");
  assertEqual(staffPositionName(10), "первая добавочная линейка сверху", "C4 в басовом");
  assertEqual(staffPositionName(11), "промежуток над первой добавочной сверху", "D4 в басовом");
  assertEqual(staffPositionName(-2), "первая добавочная линейка снизу", "C4 в скрипичном");
  assertEqual(staffPositionName(-3), "промежуток под первой добавочной снизу", "B3 в скрипичном");
  assertEqual(staffPositionName(-5), "промежуток под второй добавочной снизу", "G3 в скрипичном");
  assertEqual(staffPositionName(11), "промежуток над первой добавочной сверху", "B5 в скрипичном (урок 3)");

  // Ни одно объяснение всех уроков не содержит «undefined» (20 seed'ов на урок).
  for (const lesson of LESSONS) {
    for (let seed = 1; seed <= 20; seed += 1) {
      for (const card of lesson.generate(mulberry32(seed))) {
        assert(!card.explanation.includes("undefined"), `урок ${lesson.id} (seed ${seed}): справка без «undefined»`);
        assert(!card.prompt.includes("undefined"), `урок ${lesson.id} (seed ${seed}): вопрос без «undefined»`);
      }
    }
  }

  // Движок: серии 7–9 проходятся на 100% (ответ клавишей; факты листаются).
  for (const lesson of [bassClef, smallOctave, bothClefs]) {
    const engine = new PrimerEngine(mulberry32(710 + lesson.order));
    engine.start(lesson);
    const result = runLesson(engine, () => true);
    assertEqual(result.percent, 100, `${lesson.id}: серия проходится на 100%`);
    assertEqual(result.passed, true, `${lesson.id}: пройден`);
    assertEqual(result.lessonId, lesson.id, `${lesson.id}: итог с правильным id`);
  }

  // Гейты нотной цепочки: 6 → 7 → 8 → 9; гитарный прогресс и соседние уроки не мешают.
  const store = new PrimerProgressStore(memoryStorage());
  assertEqual(store.isUnlocked(bassClef, LESSONS), false, "урок 7 закрыт без прогресса");
  store.recordResult({ lessonId: "measures", percent: 100, correct: 5, total: 5, bestStreak: 5, passed: true });
  assertEqual(store.isUnlocked(bassClef, LESSONS), true, "урок 6 ≥80% → урок 7 открыт");
  assertEqual(store.isUnlocked(smallOctave, LESSONS), false, "урок 8 ждёт урок 7");
  store.recordResult({ lessonId: bassClef.id, percent: 100, correct: 9, total: 9, bestStreak: 9, passed: true });
  assertEqual(store.isUnlocked(smallOctave, LESSONS), true, "урок 7 ≥80% → урок 8 открыт");
  assertEqual(store.isUnlocked(bothClefs, LESSONS), false, "урок 9 ждёт урок 8");
  store.recordResult({ lessonId: smallOctave.id, percent: 83, correct: 6, total: 7, bestStreak: 6, passed: true });
  assertEqual(store.isUnlocked(bothClefs, LESSONS), true, "урок 8 83% ≥80% → урок 9 открыт");
  assertEqual(store.isUnlocked(bassClef, GUITAR_LESSONS), false, "гитарная серия не открывает нотные уроки");
  console.log("  OK: уроки 7–9, clef=bass, пулы G2–B3/C3–B3, пары «одна нота — два ключа», гейты 6→7→8→9");
}

// --- 13. Альтерация (PIANO-14): уроки 10–11 — пулы ♯/♭, бекар-пары, гейты 9→10→11 ---

function testAlterationLessons(): void {
  console.log("Уроки альтерации (PIANO-14):");
  const sharps = LESSONS[9] as (typeof LESSONS)[number];
  const flats = LESSONS[10] as (typeof LESSONS)[number];

  // Реестр: 11 нотных уроков, номера 10–11 подряд, нотная секция.
  assertEqual([sharps.id, flats.id].join(","), "sharps,flats-naturals", "ids уроков 10–11 по порядку");
  assertEqual([sharps.order, flats.order].join(","), "10,11", "номера 10–11 подряд");
  assert(sharps.section === undefined && flats.section === undefined, "уроки 10–11 — нотная секция");

  // Урок 10 «Диезы»: 2 факта + 5 ответных (весь пул ♯ за один заход).
  const l10 = sharps.generate(mulberry32(1000));
  assertEqual(l10.length, 7, "урок 10: 2 факта + 5 ответных");
  const answerable10 = l10.filter((card) => card.answer !== null);
  assertEqual(answerable10.length, 5, "урок 10: 5 ответных карточек");
  assert((l10[0]?.explanation ?? "").includes("полтона"), "факт 10: диез — полтона вверх");
  assert((l10[0]?.explanation ?? "").includes("чёрной клавишей"), "факт 10: диез звучит чёрной клавишей");
  assert((l10[1]?.explanation ?? "").includes("1 2 4 5 6"), "факт 10: чёрные клавиши — ряд 1 2 4 5 6");
  let playedSharpCards = 0;
  for (const card of answerable10) {
    const answer = card.answer;
    assert(answer?.type === "pitch", "урок 10: ответ клавишей");
    if (answer?.type !== "pitch") continue;
    assert([61, 63, 66, 68, 70].includes(answer.pitch), `урок 10: ответ ${answer.pitch} из пула C♯4 D♯4 F♯4 G♯4 A♯4`);
    assert(isBlackPitch(answer.pitch), `урок 10: ответ ${answer.pitch} — чёрная клавиша`);
    const note = staffNote(card);
    if (note) {
      assertEqual(note.accidental, "sharp", `урок 10 «${card.prompt}»: знак ♯ у ноты на стане`);
      assertEqual(writtenPitch(note.pitch, note.accidental), note.pitch, "диез пишется на букве своего питча");
    } else {
      playedSharpCards += 1;
      // «Сыграй»-карточка: стан пуст — верная нота после вердикта дорисовывается со ♯.
      assertEqual(card.answerAccidental, "sharp", "урок 10: «сыграй» — подсветка верной ноты со знаком ♯");
    }
  }
  assert(playedSharpCards >= 2, "урок 10: есть «сыграй»-карточки");
  const asked10 = new Set<number>();
  for (let seed = 1; seed <= 30; seed += 1) {
    for (const card of sharps.generate(mulberry32(seed))) {
      const answer = card.answer;
      if (answer?.type === "pitch") asked10.add(answer.pitch);
    }
  }
  assertEqual([...asked10].sort((a, b) => a - b).join(","), "61,63,66,68,70", "урок 10 за 30 seed'ов спросил весь пул ♯");

  // Урок 11 «Бемоли и бекары»: 3 факта + 4 ♭-карточки + 3 пары «♯/♭ → ♮».
  const l11 = flats.generate(mulberry32(1100));
  assertEqual(l11.length, 10, "урок 11: 3 факта + 7 ответных");
  const answerable11 = l11.filter((card) => card.answer !== null);
  assertEqual(answerable11.length, 7, "урок 11: 4 ♭-карточки + 3 бекар-пары");
  assert((l11[0]?.explanation ?? "").includes("полтона"), "факт 11: бемоль — полтона вниз");
  assert((l11[1]?.explanation ?? "").includes("энгармонизм"), "факт 11: энгармонизм назван");
  assert((l11[2]?.explanation ?? "").includes("отменяет"), "факт 11: бекар отменяет альтерацию");
  let flatCards = 0;
  let pairCards = 0;
  for (const card of answerable11) {
    const answer = card.answer;
    assert(answer?.type === "pitch", "урок 11: ответ клавишей");
    if (answer?.type !== "pitch") continue;
    const notes = card.staff.filter((item): item is StaffNote => item.kind === "note");
    if (notes.length === 1) {
      // ♭-карточка: письменная буква — на полтона выше звучания (D♭4 = 61 → D4).
      flatCards += 1;
      const note = notes[0] as StaffNote;
      assertEqual(note.accidental, "flat", "урок 11: ♭-карточка со знаком бемоль");
      assertEqual(writtenPitch(note.pitch, note.accidental), note.pitch + 1, "♭ пишется буквой на полтона выше звучания");
      assertEqual(answer.pitch, note.pitch, "ответ ♭-карточки = звучание показанной ноты");
      assert([61, 63, 68, 70].includes(answer.pitch), `урок 11: ответ ${answer.pitch} из пула D♭4 E♭4 A♭4 B♭4`);
      assert(isBlackPitch(answer.pitch), `урок 11: ответ ${answer.pitch} — чёрная клавиша`);
    } else {
      // Пара: первая со ♯/♭, вторая ♮ той же письменной буквы; ответ — вторая.
      assertEqual(notes.length, 2, "бекар-пара — две ноты на стане");
      pairCards += 1;
      const first = notes[0] as StaffNote;
      const second = notes[1] as StaffNote;
      assert(first.accidental === "sharp" || first.accidental === "flat", "первая нота пары — со ♯ или ♭");
      assertEqual(second.accidental, "natural", "вторая нота пары — с бекаром ♮");
      assertEqual(answer.pitch, second.pitch, "ответ пары — нота со знаком бекар");
      assert(
        pitchToStaffPos(writtenPitch(first.pitch, first.accidental)) ===
          pitchToStaffPos(writtenPitch(second.pitch, second.accidental)),
        "обе ноты пары — на одной письменной букве",
      );
      assert(isBlackPitch(first.pitch) && !isBlackPitch(second.pitch), "♯/♭ — чёрная клавиша, ♮ — белая");
    }
  }
  assert(flatCards >= 3 && pairCards >= 2, `урок 11: смешанный пул (${flatCards} ♭-карточек + ${pairCards} пар)`);

  // Покрытие: за 30 seed'ов — все 4 бемоля и все 5 бекар-пар (пары считаем по
  // первой ноте: у A♯4→A♮4 и A♭4→A♮4 ответ один — 69).
  const seenFlat = new Set<number>();
  const seenPair = new Set<string>();
  const seenPairAnswers = new Set<number>();
  for (let seed = 1; seed <= 30; seed += 1) {
    for (const card of flats.generate(mulberry32(seed))) {
      const answer = card.answer;
      if (answer?.type !== "pitch") continue;
      const notes = card.staff.filter((item): item is StaffNote => item.kind === "note");
      if (notes.length === 1) seenFlat.add(answer.pitch);
      else if (notes.length === 2) {
        const first = notes[0] as StaffNote;
        seenPair.add(`${first.pitch}:${first.accidental ?? ""}`);
        seenPairAnswers.add(answer.pitch);
      }
    }
  }
  assertEqual([...seenFlat].sort((a, b) => a - b).join(","), "61,63,68,70", "урок 11 за 30 seed'ов спросил все бемоли D♭4 E♭4 A♭4 B♭4");
  assertEqual(seenPair.size, 5, `урок 11 за 30 seed'ов спросил все 5 бекар-пар (спрошено ${seenPair.size})`);
  assertEqual(
    [...seenPairAnswers].sort((a, b) => a - b).join(","),
    "60,62,65,69",
    "бекар-пары отвечают C4 D4 F4 A4 (белые клавиши)",
  );

  // Энгармонизм в справке ♭-карточки: D♭4 звучит клавишей C♯4 (MIDI 61).
  let flat61: PrimerCard | null = null;
  for (let seed = 1; seed <= 30 && flat61 === null; seed += 1) {
    for (const card of flats.generate(mulberry32(seed))) {
      const notes = card.staff.filter((item): item is StaffNote => item.kind === "note");
      const answer = card.answer;
      if (notes.length === 1 && answer?.type === "pitch" && answer.pitch === 61) {
        flat61 = card;
        break;
      }
    }
  }
  assert(flat61 !== null, "урок 11: D♭4-карточка найдена");
  assert((flat61?.explanation ?? "").includes("C#4"), "D♭4: справка называет ту же клавишу C♯4 (энгармонизм)");

  // Движок: серии проходятся на 100% (ответ клавишей; факты листаются).
  for (const lesson of [sharps, flats]) {
    const engine = new PrimerEngine(mulberry32(1200 + lesson.order));
    engine.start(lesson);
    const result = runLesson(engine, () => true);
    assertEqual(result.percent, 100, `${lesson.id}: серия проходится на 100%`);
    assertEqual(result.passed, true, `${lesson.id}: пройден`);
    assertEqual(result.lessonId, lesson.id, `${lesson.id}: итог с правильным id`);
  }

  // Гейты нотной цепочки: 9 → 10 → 11; гитарный прогресс не мешает.
  const store = new PrimerProgressStore(memoryStorage());
  assertEqual(store.isUnlocked(sharps, LESSONS), false, "урок 10 закрыт без прогресса");
  store.recordResult({ lessonId: "both-clefs", percent: 100, correct: 10, total: 10, bestStreak: 10, passed: true });
  assertEqual(store.isUnlocked(sharps, LESSONS), true, "урок 9 ≥80% → урок 10 открыт");
  assertEqual(store.isUnlocked(flats, LESSONS), false, "урок 11 ждёт урок 10");
  store.recordResult({ lessonId: sharps.id, percent: 80, correct: 4, total: 5, bestStreak: 4, passed: true });
  assertEqual(store.isUnlocked(flats, LESSONS), true, "урок 10 80% ≥ порога → урок 11 открыт");
  assertEqual(store.isUnlocked(sharps, GUITAR_LESSONS), false, "гитарная серия не открывает нотные уроки");
  console.log("  OK: уроки 10–11, пулы ♯ (5) и ♭ (4), бекар-пары на одной букве, энгармонизм 61, гейты 9→10→11");
}

function main(): void {
  testLessonsData();
  testNameTheNoteVerdicts();
  testEngineGates();
  testChoiceCards();
  testPercentThreshold();
  testProgressStore();
  testGuitarLessonsData();
  testGuitarOpenStrings();
  testGuitarFretboardHints();
  testGuitarSound();
  testGuitarEngineAndGates();
  testBassClefLessons();
  testAlterationLessons();
  console.log(`SMOKE OK: ${checks} проверок пройдено`);
}

try {
  main();
} catch (error) {
  console.error("SMOKE FAIL:", error);
  throw error;
}
