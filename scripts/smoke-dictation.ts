/**
 * Smoke-проверка «Музыкального диктанта» (PIANO-17) без браузера: генератор
 * (детерминизм по rng-сиду, диапазоны уровней 1–2 белые / 3–4 с диезами,
 * длина по уровню, шаг ≤ квинты, первые ноты C4/E4/G4), план проигрывания
 * (offsets/длительности/totalSec), сессия ввода/проверки (фазы, % позиций,
 * разбор, границы: лишний ввод игнорится, проверка вне фазы — null) и экран
 * (PIANO-23): cancelScheduled playback — close/новый диктант/уровень/реплiter
 * глушат запланированный хвост, репли звучит немедленно; playback без отмены
 * живёт по-старому. Экран — на DOM-стабе (панель ADR-004) с моком playback;
 * канвас-рендер клавиатуры — no-op 2D-контекст. Отмена в самих источниках
 * (smplr/synth) в node невозможна — нужен живой AudioContext (проверка
 * вручную в браузере); здесь — экранная логика и типы (build).
 * Запуск: npm run smoke:dictation.
 */
import {
  DICTATION_LEAD_IN_SEC,
  DICTATION_LEVELS,
  DICTATION_NOTE_COUNTS,
  DICTATION_NOTE_SEC,
  DICTATION_STEP_SEC,
  DictationSession,
  dictationPool,
  dictationProgressKey,
  generateDictation,
  planDictationPlayback,
  type DictationLevel,
  type DictationSequence,
} from "../src/primer/dictation";
import { initDictationScreen, type DictationScreenApi, type PrimerPlayback } from "../src/primer/dictation-screen";
import { PrimerProgressStore } from "../src/primer/progress";

let checks = 0;
function assert(condition: boolean, message: string): void {
  checks += 1;
  if (!condition) throw new Error(`ПРОВАЛ: ${message}`);
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message} (ожидалось ${String(expected)}, получено ${String(actual)})`);
}
function assertArrayEqual<T>(actual: T[], expected: T[], message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  assert(a === b, `${message} (ожидалось ${b}, получено ${a})`);
}
/** Разворачивает possibly-undefined стаба: нет элемента — провал, не тихий null. */
function requireStub<T>(value: T | undefined, message: string): T {
  checks += 1;
  if (value === undefined) throw new Error(`ПРОВАЛ: ${message}`);
  return value;
}

// --- Детерминированный rng (одинаковый seed → одинаковый диктант) ---

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

const WHITE_C4_C5 = new Set([60, 62, 64, 65, 67, 69, 71, 72]);
const CHROMATIC_C4_C5 = new Set([60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72]);
const STARTING_PITCHES = new Set([60, 64, 67]);
const SEEDS = [1, 7, 42, 99, 1234, 2026];

// --- 1. Генератор: длины, диапазоны, шаг ≤ квинты, первые ноты ---

function testGenerator(): void {
  console.log("Генератор диктантов:");
  assertEqual(DICTATION_LEVELS.length, 4, "четыре уровня диктанта");
  assertEqual(DICTATION_NOTE_COUNTS[1], 2, "уровень 1: 2 ноты");
  assertEqual(DICTATION_NOTE_COUNTS[2], 3, "уровень 2: 3 ноты");
  assertEqual(DICTATION_NOTE_COUNTS[3], 4, "уровень 3: 4 ноты");
  assertEqual(DICTATION_NOTE_COUNTS[4], 5, "уровень 4: 5 нот");

  for (const level of DICTATION_LEVELS) {
    const pool = dictationPool(level);
    const allowed = level <= 2 ? WHITE_C4_C5 : CHROMATIC_C4_C5;
    assertEqual(pool.length, allowed.size, `уровень ${level}: размер пула`);
    for (const pitch of pool) assert(allowed.has(pitch), `уровень ${level}: питч ${pitch} в диапазоне C4–C5`);

    for (const seed of SEEDS) {
      const dictation = generateDictation(level, mulberry32(seed));
      assertEqual(dictation.level, level, `уровень ${level} сид ${seed}: level записан`);
      assertEqual(dictation.notes.length, DICTATION_NOTE_COUNTS[level], `уровень ${level} сид ${seed}: длина по уровню`);
      assert(
        STARTING_PITCHES.has(dictation.notes[0]),
        `уровень ${level} сид ${seed}: первая нота C4/E4/G4`,
      );
      for (const pitch of dictation.notes) {
        assert(allowed.has(pitch), `уровень ${level} сид ${seed}: питч ${pitch} в пуле уровня`);
      }
      for (let i = 1; i < dictation.notes.length; i += 1) {
        const step = Math.abs(dictation.notes[i] - dictation.notes[i - 1]);
        assert(step <= 7, `уровень ${level} сид ${seed}: шаг ${step} на ноте ${i} ≤ квинты`);
      }
    }
  }

  // Уровни 3–4 реально встречают диезы (иначе «допускают диезы» — пустые слова).
  const sharpsSeen = SEEDS.some((seed) =>
    [3, 4].some((level) =>
      generateDictation(level as DictationLevel, mulberry32(seed)).notes.some(
        (pitch) => !WHITE_C4_C5.has(pitch),
      ),
    ),
  );
  assert(sharpsSeen, "уровни 3–4: диезы встречаются на наборе сидов");

  // Детерминизм: одинаковый сид → одинаковый диктант, разные сиды → различимо.
  const a = generateDictation(4, mulberry32(77));
  const b = generateDictation(4, mulberry32(77));
  assertEqual(JSON.stringify(a), JSON.stringify(b), "одинаковый сид → одинаковый диктант");
  const differs = SEEDS.some(
    (seed) =>
      JSON.stringify(generateDictation(2, mulberry32(seed))) !==
      JSON.stringify(generateDictation(2, mulberry32(seed + 1))),
  );
  assert(differs, "разные сиды дают разные диктанты (на наборе сидов)");

  // Неверный уровень — RangeError.
  let threw = false;
  try {
    generateDictation(5 as DictationLevel, mulberry32(1));
  } catch {
    threw = true;
  }
  assert(threw, "уровень вне 1–4 — RangeError");
  console.log("  OK: 4 уровня × сиды, длины, диапазоны, шаг ≤ квинты, первые ноты, диезы 3–4, детерминизм");
}

// --- 2. План проигрывания: планируемый звук на аудио-часах (инвариант #2) ---

function testPlayPlan(): void {
  console.log("План проигрывания:");
  const plan = planDictationPlayback([60, 64, 67]);
  assertEqual(plan.entries.length, 3, "по ноте на элемент плана");
  assertEqual(plan.entries[0]?.offsetSec, DICTATION_LEAD_IN_SEC, "первая нота — после вступления");
  assertEqual(plan.entries[1]?.offsetSec, DICTATION_LEAD_IN_SEC + DICTATION_STEP_SEC, "вторая — через шаг");
  assertEqual(plan.entries[2]?.offsetSec, DICTATION_LEAD_IN_SEC + 2 * DICTATION_STEP_SEC, "третья — через 2 шага");
  for (const entry of plan.entries) {
    assertEqual(entry.durationSec, DICTATION_NOTE_SEC, "длительность ноты по ТЗ");
  }
  assertEqual(plan.totalSec, DICTATION_LEAD_IN_SEC + 2 * DICTATION_STEP_SEC + DICTATION_NOTE_SEC, "totalSec — конец последней ноты");
  assertEqual(planDictationPlayback([]).entries.length, 0, "пустая последовательность — пустой план");
  assertEqual(planDictationPlayback([]).totalSec, 0, "пустая последовательность — totalSec 0");

  // Планируемое время — единственная модель: экран прибавляет аудио-часы.
  const now = 12.5;
  const base = now + DICTATION_LEAD_IN_SEC;
  assertEqual(base + (plan.entries[1]?.offsetSec ?? 0), now + 2 * DICTATION_LEAD_IN_SEC + DICTATION_STEP_SEC, "базовая точка + offset = абсолютное аудио-время");
  console.log("  OK: вступление/шаг/длительность, totalSec, пустой план, привязка к аудио-часам");
}

// --- 3. Сессия: фазы listen → input → result, ввод, границы ---

function testSession(): void {
  console.log("Сессия диктанта:");
  const dictation: DictationSequence = { level: 2, notes: [60, 67, 64] };
  const session = new DictationSession();

  // Вне сессии ввод и проверка невозможны.
  assertEqual(session.noteCount, 0, "до старта нот нет");
  assertEqual(session.addPitch(60).accepted, false, "нажатие до старта игнорится");
  assertEqual(session.check(), null, "проверка до старта — null");

  session.start(dictation);
  assertEqual(session.level, 2, "уровень записан");
  assertEqual(session.noteCount, 3, "нот 3");
  assertEqual(session.currentPhase, "listen", "старт в фазе «слушай»");
  assertEqual(session.enteredCount, 0, "ввод пуст");
  assertEqual(session.isFull, false, "ввод не заполнен");
  assertEqual(session.addPitch(60).accepted, false, "нажатие в фазе «слушай» игнорится");

  // Слушай → ввод (по плану аудио-часов или первому нажатию игрока).
  session.beginInput();
  assertEqual(session.currentPhase, "input", "beginInput открывает ввод");

  // Позиция 1: верно.
  const first = session.addPitch(60);
  assert(first.accepted && first.enteredCount === 1 && !first.isFull, "первое нажатие принято");
  assertEqual(session.enteredCount, 1, "введено 1/3");

  // Позиция 2: неверно.
  assert(session.addPitch(69).accepted, "второе нажатие принято");
  assertEqual(session.enteredCount, 2, "введено 2/3");
  assertEqual(session.currentPhase, "input", "автопроверки до заполнения нет");

  // Позиция 3: верно — ввод заполнен.
  const third = session.addPitch(64);
  assert(third.accepted && third.isFull, "третье нажатие заполняет ввод");
  assertEqual(session.isFull, true, "isFull");

  // Лишний ввод игнорится (не заменяет введённое).
  const extra = session.addPitch(72);
  assert(!extra.accepted && extra.reason === "full", "лишнее нажатие — отказ full");

  // Проверка: 2/3 верных позиций → 67%.
  const check = session.check();
  assert(check !== null, "проверка доступна");
  assertEqual(check?.total, 3, "итог: всего 3");
  assertEqual(check?.correctCount, 2, "итог: верных 2");
  assertEqual(check?.percent, 67, "итог: 2/3 → 67% (округление)");
  assertEqual(check?.bestRun, 1, "итог: лучший ряд подряд — 1 (верно/неверно/верно)");
  assertEqual(check?.positions[0]?.correct, true, "позиция 1 верна");
  assertEqual(check?.positions[1]?.playedPitch, 69, "позиция 2: сыграно A4");
  assertEqual(check?.positions[1]?.correct, false, "позиция 2 неверна");
  assertEqual(check?.positions[1]?.expectedPitch, 67, "позиция 2: ожидалось G4");
  assertEqual(check?.positions[2]?.correct, true, "позиция 3 верна");

  // Повторная проверка и ввод после проверки невозможны.
  assertEqual(session.check(), null, "повторная проверка — null");
  assertEqual(session.addPitch(60).accepted, false, "ввод в фазе результата игнорится");
  console.log("  OK: фазы, ввод, лишний ввод — full, проверка 67%, разбор позиций, результат закрыт");
}

// --- 4. Границы: ранняя проверка с незаполненными позициями, чистый диктант ---

function testBoundaries(): void {
  console.log("Границы и проверка до заполнения:");
  const session = new DictationSession();
  session.start({ level: 1, notes: [64, 60] });
  session.beginInput();
  session.addPitch(64); // только первая позиция, вторая пуста

  const check = session.check();
  assert(check !== null, "проверка до заполнения доступна («Проверить»)");
  assertEqual(check?.correctCount, 1, "верна только заполненная верная позиция");
  assertEqual(check?.percent, 50, "1/2 → 50%");
  assertEqual(check?.positions[1]?.playedPitch, null, "незаполненная позиция — playedPitch null");
  assertEqual(check?.positions[1]?.correct, false, "незаполненная позиция неверна");
  assertEqual(check?.positions[1]?.expectedPitch, 60, "незаполненная позиция: ожидалось C4");
  assertEqual(check?.bestRun, 1, "ряд из первой верной");

  // Идеальный диктант: 100%, ряд = длине.
  const perfect = new DictationSession();
  perfect.start({ level: 4, notes: [67, 67, 72, 61, 66] });
  perfect.beginInput();
  for (const pitch of [67, 67, 72, 61, 66]) perfect.addPitch(pitch);
  const perfectCheck = perfect.check();
  assertEqual(perfectCheck?.percent, 100, "все позиции верны → 100%");
  assertEqual(perfectCheck?.bestRun, 5, "ряд = 5");
  assertEqual(perfectCheck?.correctCount, 5, "верных 5");

  // Все мимо: 0%, прима-повторы не спасают неверный порядок.
  const wrong = new DictationSession();
  wrong.start({ level: 3, notes: [60, 62, 64, 65] });
  wrong.beginInput();
  for (const pitch of [62, 64, 65, 60]) wrong.addPitch(pitch);
  const wrongCheck = wrong.check();
  assertEqual(wrongCheck?.percent, 0, "порядок перепутан → 0%");

  assertEqual(dictationProgressKey(3), "dictation-level-3", "ключ прогресса уровня 3");
  console.log("  OK: ранняя проверка (playedPitch null), 100%, 0%, ключ прогресса");
}

// --- 5. Прогресс: лучший % уровня через PrimerProgressStore ---

function testProgress(): void {
  console.log("Прогресс диктанта:");
  const memory: Map<string, string> = new Map();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
  };
  const progress = new PrimerProgressStore(storage);
  assertEqual(progress.bestPercent(dictationProgressKey(1)), 0, "попыток не было → 0%");

  progress.recordResult({ lessonId: dictationProgressKey(1), percent: 50, correct: 1, total: 2, bestStreak: 1, passed: false });
  assertEqual(progress.bestPercent(dictationProgressKey(1)), 50, "первая попытка записана");

  // Хуже — не перезаписывает лучший результат.
  progress.recordResult({ lessonId: dictationProgressKey(1), percent: 0, correct: 0, total: 2, bestStreak: 0, passed: false });
  assertEqual(progress.bestPercent(dictationProgressKey(1)), 50, "худшая попытка не затирает лучший %");

  // Лучше — перезаписывает; уровни независимы; persisted в хранилище.
  progress.recordResult({ lessonId: dictationProgressKey(1), percent: 100, correct: 2, total: 2, bestStreak: 2, passed: true });
  progress.recordResult({ lessonId: dictationProgressKey(2), percent: 67, correct: 2, total: 3, bestStreak: 2, passed: false });
  assertEqual(progress.bestPercent(dictationProgressKey(1)), 100, "лучшая попытка записана");
  assertEqual(progress.bestPercent(dictationProgressKey(2)), 67, "уровень 2 независим");
  assert(memory.get("piano.primer.progress")?.includes('"dictation-level-1":100') === true, "ключ dictation-level-N в хранилище");
  console.log("  OK: запись, best = max, уровни независимы, ключ в хранилище");
}

// --- 6. Экран: cancelScheduled playback (PIANO-23) — DOM-стаб + мок playback ---

/** Канвас-2D no-op: рендер клавиатуры в node не рисует, только вызывает методы. */
function fakeCtx2D(): CanvasRenderingContext2D {
  return {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textAlign: "",
    textBaseline: "",
    globalAlpha: 1,
    fillRect: () => {},
    strokeRect: () => {},
    setTransform: () => {},
    fillText: () => {},
    measureText: (text: string) => ({ width: text.length * 6 }),
  } as unknown as CanvasRenderingContext2D;
}

/** DOM-элемент-стаб с собранными click-обработчиками и детьми (appendChild). */
interface FakeEl {
  hidden: boolean;
  disabled: boolean;
  textContent: string;
  className: string;
  classList: { toggle(name: string, force?: boolean): void };
  addEventListener(type: string, handler: () => void): void;
  appendChild(child: FakeEl): void;
  replaceChildren(...children: unknown[]): void;
  children: FakeEl[];
  clicks: Array<() => void>;
}

function makeEl(isCanvas: boolean): FakeEl {
  const element: FakeEl = {
    hidden: false,
    disabled: false,
    textContent: "",
    className: "",
    classList: { toggle: () => {} },
    addEventListener: (type: string, handler: () => void) => {
      if (type === "click") element.clicks.push(handler);
    },
    appendChild: (child: FakeEl) => {
      element.children.push(child);
    },
    replaceChildren: () => {},
    children: [],
    clicks: [],
  };
  if (isCanvas) {
    const canvas = element as FakeEl & {
      width: number;
      height: number;
      getContext(kind: string): CanvasRenderingContext2D | null;
      getBoundingClientRect(): { width: number; height: number };
    };
    canvas.width = 0;
    canvas.height = 0;
    canvas.getContext = (kind: string) => (kind === "2d" ? fakeCtx2D() : null);
    canvas.getBoundingClientRect = () => ({ width: 320, height: 88 });
  }
  return element;
}

interface PlaybackMock {
  playback: PrimerPlayback;
  /** Все запланированные ноты: { pitch, timeSec, durationSec }. */
  notes: Array<{ pitch: number; timeSec: number; durationSec: number }>;
  /** Аргументы cancelScheduled (пусто у legacy-мока без отмены). */
  cancels: number[];
  hasCancel: boolean;
  setTime(t: number): void;
}

function makePlayback(withCancel: boolean): PlaybackMock {
  let now = 100;
  const notes: Array<{ pitch: number; timeSec: number; durationSec: number }> = [];
  const cancels: number[] = [];
  const playback: PrimerPlayback = {
    playNote: (pitch: number, _velocity: number, timeSec: number, durationSec: number) => {
      notes.push({ pitch, timeSec, durationSec });
    },
    currentTime: () => now,
  };
  if (withCancel) playback.cancelScheduled = (fromSec: number) => void cancels.push(fromSec);
  return { playback, notes, cancels, hasCancel: withCancel, setTime: (t: number) => void (now = t) };
}

interface ScreenHarness {
  api: DictationScreenApi;
  els: Map<string, FakeEl>;
  mock: PlaybackMock;
}

/**
 * Собрать экран диктанта на стабе DOM: document/window подменяются глобально —
 * модули экрана читают их только внутри вызовов (top-level чист), поэтому
 * статический импорт безопасен.
 */
function makeScreen(mock: PlaybackMock): ScreenHarness {
  const els = new Map<string, FakeEl>();
  const canvasIds = new Set(["primerDictKbCanvas"]);
  const ids = [
    "primerDictation",
    "primerDictLevels",
    "primerDictStatus",
    "primerDictFeedback",
    "primerDictResult",
    "primerDictNew",
    "primerDictListen",
    "primerDictCheck",
    "primerDictBack",
    "primerDictKbCanvas",
  ];
  for (const id of ids) els.set(id, makeEl(canvasIds.has(id)));

  (globalThis as Record<string, unknown>).document = {
    getElementById: (id: string) => els.get(id) ?? null,
    createElement: () => makeEl(false),
  };
  (globalThis as Record<string, unknown>).window = { devicePixelRatio: 1 };

  const memory = new Map<string, string>();
  const progress = new PrimerProgressStore({
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
  });
  const pressed = new Set<number>();
  const api = initDictationScreen({
    mapping: {
      pitches: () => [60, 61, 62, 63, 64, 65, 66, 67],
      labels: () => new Map([[60, "Tab"]]),
    },
    pressedPitches: () => pressed,
    progress,
    playback: mock.playback,
    onBack: () => {},
  });
  return { api, els, mock };
}

function testScreenCancel(): void {
  console.log("Экран диктанта: cancelScheduled playback (PIANO-23):");

  // A. Playback с отменой: open/реплай/новый/уровень/close глушат хвост.
  const mock = makePlayback(true);
  const { api, els } = makeScreen(mock);
  const listenBtn = requireStub(els.get("primerDictListen"), "стаб: кнопка «Прослушать» найдена");
  const newBtn = requireStub(els.get("primerDictNew"), "стаб: кнопка «Новый диктант» найдена");
  const checkBtn = requireStub(els.get("primerDictCheck"), "стаб: кнопка «Проверить» найдена");
  const statusEl = requireStub(els.get("primerDictStatus"), "стаб: статус найден");
  const levelsEl = requireStub(els.get("primerDictLevels"), "стаб: контейнер уровней найден");

  api.open();
  assert(api.isActive(), "open → экран активен");
  assertArrayEqual(mock.cancels, [100], "open: хвост прошлого отменяется от текущего времени");
  assertEqual(mock.notes.length, DICTATION_NOTE_COUNTS[1], "open: план уровня 1 запланирован");
  assertEqual(mock.notes[0]?.timeSec, 100 + 2 * DICTATION_LEAD_IN_SEC, "первая нота — вступление от now");
  const feedback = els.get("primerDictFeedback");
  assert((feedback?.textContent ?? "").includes("Слушай"), "фаза «слушай» — фидбек выставлен");

  // Реплай mid-listen: старый план ещё не доиграл (listenUntil ≈ 102.5),
  // отмена позволяет перебить сразу — новая первая нота на 101 + 2×вступление.
  mock.setTime(101);
  listenBtn.clicks[0]?.();
  assertArrayEqual(mock.cancels, [100, 101], "реплай: cancel от текущего времени");
  assertEqual(mock.notes.length, 2 * DICTATION_NOTE_COUNTS[1], "реплай: второй план запланирован");
  assertEqual(
    mock.notes[2]?.timeSec,
    101 + 2 * DICTATION_LEAD_IN_SEC,
    "реплай звучит немедленно, не ждёт конца старого плана",
  );

  // «Новый диктант» — тоже cancel (хвост старого диктанта).
  newBtn.clicks[0]?.();
  assertArrayEqual(mock.cancels, [100, 101, 101], "новый диктант: cancel");

  // Смена уровня — тоже cancel.
  const level2 = requireStub(levelsEl.children[1], "стаб: кнопка уровня 2 создана");
  level2.clicks[0]?.();
  assertArrayEqual(mock.cancels, [100, 101, 101, 101], "смена уровня: cancel");
  // Планов к моменту: open + реплай + новый (уровень 1, по 2 ноты) + уровень 2 (3 ноты).
  assertEqual(
    mock.notes.length,
    3 * DICTATION_NOTE_COUNTS[1] + DICTATION_NOTE_COUNTS[2],
    "смена уровня: план уровня 2",
  );

  // Фаза «слушай» кончается по аудио-часам (ежекадровый мост updateKeyboard).
  mock.setTime(200);
  api.updateKeyboard();
  assertEqual(checkBtn.disabled, false, "после конца плана — фаза ввода (Проверить доступна)");
  api.handlePitch(60); // ввод в фазе input принимается
  assert(statusEl.textContent.includes("введено 1/"), "введённая позиция отражена в статусе");

  // close глушит хвост; повторный close — тихий.
  api.close();
  assertArrayEqual(mock.cancels, [100, 101, 101, 101, 200], "close: хвост отменяется от текущего времени");
  assertEqual(api.isActive(), false, "close: экран неактивен");
  api.close();
  assertEqual(mock.cancels.length, 5, "повторный close — cancel не дублируется");

  // B. Legacy playback без отмены: старое поведение (реплай ждёт конца плана).
  const legacy = makePlayback(false);
  const legacyScreen = makeScreen(legacy);
  assertEqual(legacy.hasCancel, false, "legacy-мок: cancelScheduled отсутствует");
  legacyScreen.api.open();
  assertEqual(legacy.notes.length, DICTATION_NOTE_COUNTS[1], "legacy: первый план запланирован");
  legacy.setTime(101); // listenUntil старого плана ≈ 102.5
  legacyScreen.els.get("primerDictListen")?.clicks[0]?.();
  assertEqual(legacy.notes.length, 2 * DICTATION_NOTE_COUNTS[1], "legacy: реплай запланирован");
  assertEqual(
    legacy.notes[2]?.timeSec,
    100 + DICTATION_LEAD_IN_SEC + 2 * DICTATION_STEP_SEC + DICTATION_NOTE_SEC + DICTATION_LEAD_IN_SEC,
    "legacy: реплай не раньше конца текущего плана + вступление",
  );
  legacyScreen.api.close();
  assertEqual(legacyScreen.api.isActive(), false, "legacy close без отмены — без ошибок");
  console.log("  OK: open/реплай/новый/уровень/close глушат хвост, немедленный реплай, legacy ждёт конца плана");
}

function main(): void {
  testGenerator();
  testPlayPlan();
  testSession();
  testBoundaries();
  testProgress();
  testScreenCancel();
  console.log(`SMOKE OK: ${checks} проверок пройдено`);
}

try {
  main();
} catch (error) {
  console.error("SMOKE FAIL:", error);
  throw error;
}
