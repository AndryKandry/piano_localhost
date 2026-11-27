/**
 * Smoke-проверка чистой геометрии окна нотного стана (PIANO-16) без браузера:
 * курсор на 25% ширины, окно чтения по ВРЕМЕНИ (вперёд/хвосты), скольжение
 * нот (x = курсор + (t − songTime) × pxPerSec), подсветка (ближайшая играбельная
 * группа, автопартия dim, автоплей accent при звучании), тактовые черты по
 * сетке долей метронома. Чистота: те же входы → тот же вывод (в т.ч. после
 * «отмотки» songTime назад), вход не мутируется — никаких инкрементов.
 * Рендер (canvas/шрифт) в node не тестируется — нужен живой браузер.
 * Запуск: npm run smoke:songstaff.
 */
import {
  STAFF_CURSOR_RATIO,
  STAFF_LOOK_AHEAD_SEC,
  STAFF_LOOK_BEHIND_SEC,
  computeStaffWindow,
  staffBarlineXs,
  type StaffWindowInput,
} from "../src/render/songstaff";
import type { Melody, Note, TempoChange } from "../src/core/types";

let checks = 0;
function assert(condition: boolean, message: string): void {
  checks += 1;
  if (!condition) throw new Error(`ПРОВАЛ: ${message}`);
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message} (ожидалось ${String(expected)}, получено ${String(actual)})`);
}
function assertApprox(actual: number, expected: number, message: string, eps = 1e-9): void {
  assert(Math.abs(actual - expected) < eps, `${message} (ожидалось ~${expected}, получено ${actual})`);
}

function note(pitch: number, startTimeSec: number, durationSec: number, handPart: "right" | "left" = "right"): Note {
  return { pitch, startTimeSec, durationSec, handPart, velocity: 90 };
}

/** Окно обучения: партия игрока — правая рука (как сплит партий). */
function learnInput(notes: readonly Note[], songTime: number, overrides: Partial<StaffWindowInput> = {}): StaffWindowInput {
  return {
    notes,
    songTime,
    widthPx: 1000,
    autoplay: false,
    isPlayable: (n) => n.handPart === "right",
    hitWindowSec: 0.15,
    ...overrides,
  };
}

// --- 1. Геометрия окна: курсор 25%, скорость чтения из окна, x ноты ---

function testGeometry(): void {
  console.log("Геометрия окна стана:");
  const view = computeStaffWindow(learnInput([note(60, 10, 0.5)], 10));
  assertEqual(view.cursorX, 250, "курсор на 25% ширины (1000 → 250)");
  assertApprox(view.pxPerSec, 300, "pxPerSec = (ширина − курсор)/окно чтения");
  assertEqual(view.notes.length, 1, "нота в окне");
  const only = view.notes[0];
  assert(only !== undefined, "нота доступна");
  assertApprox(only.x, 250, "нота на songTime стоит ровно на курсоре");
  assertEqual(STAFF_CURSOR_RATIO, 0.25, "константа курсора 0.25");
  assertEqual(STAFF_LOOK_AHEAD_SEC, 2.5, "окно чтения вперёд 2.5 с");
  assertEqual(STAFF_LOOK_BEHIND_SEC, 1, "хвост за курсором 1 с");

  // Явный pxPerSec перекрывает вывод из окна (детерминизм раскладки).
  const fixed = computeStaffWindow(learnInput([note(60, 12, 0.5)], 10, { pxPerSec: 120 }));
  assertApprox(fixed.pxPerSec, 120, "явный pxPerSec используется как дан");
  const fixedNote = fixed.notes[0];
  assert(fixedNote !== undefined, "нота видна при явной скорости");
  assertApprox(fixedNote.x, 250 + 2 * 120, "x = курсор + (t − songTime) × pxPerSec");

  // Вырожденные входы не падают.
  const empty = computeStaffWindow(learnInput([], 5));
  assertEqual(empty.notes.length, 0, "пустая мелодия — пустое окно");
  const zero = computeStaffWindow(learnInput([note(60, 5, 1)], 5, { widthPx: 0 }));
  assertEqual(zero.cursorX, 0, "нулевая ширина — курсор 0");
  assertEqual(zero.notes.length, 0, "нулевая ширина — окно пусто");
  console.log("  OK: курсор 25%, pxPerSec из окна чтения, линейный x, вырожденные входы");
}

// --- 2. Окно по ВРЕМЕНИ: вперёд lookAhead, назад хвосты длинных нот ---

function testTimeWindow(): void {
  console.log("Границы окна чтения:");
  // songTime 10: окно по стартам (9.0, 12.5), края — по концам нот.
  // Контракт computeStaffWindow: ноты отсортированы по старту (как у плеера).
  const notes = [
    note(60, 5, 4.0), // конец 9.0 ≤ хвоста 9.0 — ушла целиком, НЕ видна
    note(62, 5, 4.1), // конец 9.1 > 9.0 — хвост ещё звучит, видна слева от курсора
    note(71, 8.95, 0.1), // старт до окна, конец 9.05 > 9.0 — видна (хвост)
    note(64, 9.2, 0.5), // старт внутри окна
    note(65, 12.4, 0.5), // старт 12.4 < 12.5 — видна справа
    note(67, 12.5, 0.5), // старт на границе окна — НЕ видна
    note(69, 13, 0.5), // за окном чтения — НЕ видна
  ];
  const view = computeStaffWindow(learnInput(notes, 10));
  const starts = view.notes.map((item) => item.note.startTimeSec);
  assert(!starts.includes(5.0001) && !view.notes.some((item) => item.note.durationSec === 4.0), "нота, ушедшая целиком за левый край, скрыта");
  assert(view.notes.some((item) => item.note.durationSec === 4.1), "звучащий хвост длинной ноты виден");
  assert(view.notes.some((item) => item.note.startTimeSec === 9.2), "нота внутри окна видна");
  assert(view.notes.some((item) => item.note.startTimeSec === 12.4), "нота у правого края окна видна");
  assert(!view.notes.some((item) => item.note.startTimeSec === 12.5), "нота на границе окна скрыта");
  assert(!view.notes.some((item) => item.note.startTimeSec === 13), "нота за окном чтения скрыта");
  assert(view.notes.some((item) => Math.abs(item.note.startTimeSec - 8.95) < 1e-9), "нота-хвост с короткой длительностью видна");

  // Скольжение: +0.5 с songTime → каждая нота левее ровно на 0.5 × pxPerSec
  // (состав окон может различаться на краях — сравниваем ноты, попавшие в оба).
  const before = computeStaffWindow(learnInput(notes, 10));
  const after = computeStaffWindow(learnInput(notes, 10.5));
  const afterByStart = new Map(after.notes.map((item) => [item.note.startTimeSec, item]));
  let compared = 0;
  for (const b of before.notes) {
    const a = afterByStart.get(b.note.startTimeSec);
    if (!a) continue;
    compared += 1;
    assertApprox(a.x - b.x, -0.5 * before.pxPerSec, `нота t=${b.note.startTimeSec} уехала влево на 0.5 × pxPerSec`);
    assert(a.highlight === b.highlight && a.dim === b.dim, `вид ноты t=${b.note.startTimeSec} при скольжении не мигает`);
  }
  assert(compared >= 2, "есть ноты, общие для обоих окон (сравнение состоялось)");
  // Нота пересекает курсор: была справа, стала слева — непрерывно, без скачка.
  const crossing = computeStaffWindow(learnInput([note(60, 10.2, 0.5)], 10.1));
  const crossed = computeStaffWindow(learnInput([note(60, 10.2, 0.5)], 10.3));
  const cb = crossing.notes[0];
  const ca = crossed.notes[0];
  assert(cb && ca && cb.x > crossing.cursorX && ca.x < crossed.cursorX, "нота переезжает курсор непрерывно");
  console.log("  OK: края окна по времени, хвосты длинных нот, скольжение без скачков");
}

// --- 3. Чистота: нет мутаций, нет скрытого состояния (инкрементов) ---

function testPurity(): void {
  console.log("Чистота функции окна:");
  const notes = [note(60, 9.8, 0.5), note(62, 10.4, 0.5), note(64, 11, 2)];
  const snapshot = JSON.stringify(notes);
  const first = computeStaffWindow(learnInput(notes, 10));

  // Повтор в том же кадре — тот же вывод (нет инкрементального состояния).
  assertEqual(JSON.stringify(computeStaffWindow(learnInput(notes, 10))), JSON.stringify(first), "повтор с теми же входами — тот же вывод");
  // Отмотка назад и вперёд — снова тот же вывод (позиция не накапливается).
  void computeStaffWindow(learnInput(notes, 5));
  void computeStaffWindow(learnInput(notes, 20));
  assertEqual(JSON.stringify(computeStaffWindow(learnInput(notes, 10))), JSON.stringify(first), "songTime 10 → 5 → 20 → 10 даёт исходный вывод");
  // Вход не мутируется (ни порядок, ни поля нот).
  assertEqual(JSON.stringify(notes), snapshot, "массив нот не изменён");
  // Другой массив с равным содержимым — тот же вывод (нет кэша по ссылке).
  const twin = [...notes].map((n) => ({ ...n }));
  assertEqual(JSON.stringify(computeStaffWindow(learnInput(twin, 10))), JSON.stringify(first), "равный вход (копия) — равный вывод");
  console.log("  OK: без мутаций и инкрементов — вывод только от параметров");
}

// --- 4. Подсветка в обучении: ближайшая играбельная группа, автопартия dim ---

function testLearnHighlight(): void {
  console.log("Подсветка обучения:");
  const notes = [
    note(60, 9.7, 0.5), // играбельная, просрочена (старт < t − hitWindow) — не «ближайшая»
    note(62, 10.0, 0.5), // ближайшая играбельная — accent
    note(67, 10.0, 0.5), // аккорд на том же моменте — accent
    note(72, 10.0, 0.5, "left"), // автопартия — dim
    note(64, 10.5, 0.5), // следующая играбельная — чернила, без accent
    note(55, 10.25, 0.5, "left"), // автопартия впереди — dim
  ];
  const view = computeStaffWindow(learnInput(notes, 10));
  const byPitch = new Map(view.notes.map((item) => [item.note.pitch, item]));
  const current = byPitch.get(62);
  const chordMate = byPitch.get(67);
  assert(current?.highlight === true, "ближайшая играбельная — accent");
  assert(chordMate?.highlight === true, "аккордная соседка — accent");
  assert(current?.dim === false && chordMate?.dim === false, "подсвеченные не приглушены");
  const autoNow = byPitch.get(72);
  assert(autoNow?.role === "auto" && autoNow.dim === true && !autoNow.highlight, "автопартия — dim без accent");
  const autoFuture = byPitch.get(55);
  assert(autoFuture?.dim === true, "автопартия впереди — dim");
  const missed = byPitch.get(60);
  assert(missed?.highlight === false, "просроченная играбельная без accent");
  assert(missed?.dim === false && missed?.role === "playable", "просроченная играбельная — чернила");
  const upcoming = byPitch.get(64);
  assert(upcoming?.highlight === false && upcoming?.dim === false && upcoming.phase === "future", "следующая играбельная — чернила без accent");

  // Нет играбельных рядом → accent получает следующая по времени играбельная.
  const ahead = computeStaffWindow(learnInput([note(60, 10.5, 0.5)], 10));
  assert(ahead.notes[0]?.highlight === true, "ближайшая впереди — accent");

  // Чистая нота: несколько играбельных в окне — accent ровно у одной группы.
  const spread = computeStaffWindow(learnInput([note(60, 9.9, 0.5), note(62, 10.4, 0.5), note(64, 11, 0.5)], 10));
  assertEqual(spread.notes.filter((item) => item.highlight).length, 1, "accent ровно у одной группы");
  console.log("  OK: группа accent, автопартия dim, просроченные и будущие — чернила");
}

// --- 5. Wait-mode: кадр статичен, пока время замерло на гейте ---

function testWaitMode(): void {
  console.log("Wait-mode (статичный кадр):");
  const notes = [note(60, 10, 0.5), note(62, 10, 0.5, "left"), note(64, 10.5, 0.5)];
  const frozen = computeStaffWindow(learnInput(notes, 10, { hitWindowSec: 0.3 }));
  assertEqual(JSON.stringify(computeStaffWindow(learnInput(notes, 10, { hitWindowSec: 0.3 }))), JSON.stringify(frozen), "замерший songTime — кадр не меняется");
  const current = frozen.notes.filter((item) => item.highlight);
  assertEqual(current.length, 1, "группа гейта — одна (играбельная часть)");
  assert(current[0]?.note.pitch === 60, "ждётся нота на гейте (10.0)");
  assertApprox(current[0]?.x ?? -1, frozen.cursorX, "гейт стоит ровно на курсоре");
  const leftMate = frozen.notes.find((item) => item.note.pitch === 62);
  assert(leftMate?.dim === true, "автопартия аккорда приглушена");
  console.log("  OK: замерший кадр, группа гейта на курсоре");
}

// --- 6. Автоплей: accent при звучании, остальное dim ---

function testAutoplay(): void {
  console.log("Автоплей:");
  const notes = [
    note(60, 9.2, 0.5), // уже отзвучала (конец 9.7) — dim
    note(62, 9.8, 0.5), // звучит сейчас — accent
    note(64, 10.5, 0.5), // впереди — dim
  ];
  const view = computeStaffWindow(learnInput(notes, 10, { autoplay: true, isPlayable: () => false }));
  const byPitch = new Map(view.notes.map((item) => [item.note.pitch, item]));
  const sounding = byPitch.get(62);
  assert(sounding?.highlight === true && sounding.dim === false && sounding.phase === "now", "звучащая нота — accent");
  const past = byPitch.get(60);
  assert(past?.highlight === false && past.dim === true && past.phase === "past", "отзвучавшая — dim");
  const future = byPitch.get(64);
  assert(future?.highlight === false && future.dim === true && future.phase === "future", "будущая — dim");
  assert(view.notes.every((item) => item.role === "auto"), "в автоплее все ноты — автопартия");
  console.log("  OK: «караоке» — accent только у звучащих, остальное dim");
}

// --- 7. Тактовые черты: сетка долей метронома, фильтр по ширине ---

function testBarlines(): void {
  console.log("Тактовые черты:");
  const bpm120: TempoChange[] = [{ timeSec: 0, bpm: 120 }];
  const base = { songTime: 2, cursorX: 250, pxPerSec: 300, widthPx: 1000 };

  // 4/4 (размер не задан — дефолт): такты по 2 с (0, 2, 4, 6 с при 120 BPM).
  // При songTime 2 такт t=2 стоит на курсоре, t=4 — на 2 с × 300 px правее.
  const bars44 = staffBarlineXs({ tempoMap: bpm120, durationSec: 8, ...base });
  assertEqual(bars44.length, 2, "4/4: черты t=2 и t=4 в окне");
  assertApprox(bars44[0] ?? -1, 250, "черта такта t=2 стоит на курсоре");
  assertApprox(bars44[1] ?? -1, 850, "черта такта t=4 — 2 с × 300 px/с правее");

  // 3/4: такты 1.5 с → черты …1.5, 3, 4.5 в окне (4.5 у правого края inclusively).
  const bars34 = staffBarlineXs({ tempoMap: bpm120, durationSec: 8, timeSignature: { numerator: 3, denominator: 4 }, ...base });
  assertEqual(bars34.length, 3, "3/4: три черты в окне (1.5-секундные такты)");
  assertApprox(bars34[0] ?? -1, 100, "3/4: черта t=1.5");
  assertApprox(bars34[1] ?? -1, 550, "3/4: черта t=3");
  assertApprox(bars34[2] ?? -1, 1000, "3/4: черта t=4.5 у правого края");

  // Смена BPM: черты по арифметике четвертей от начала (как метроном), не
  // равные интервалы: 0–4 с по 120, далее 60 → акценты 0, 2, 4; t=6 — 3-я
  // доля такта, начавшегося в 4 с, чертой НЕ является.
  const changing: TempoChange[] = [
    { timeSec: 0, bpm: 120 },
    { timeSec: 4, bpm: 60 },
  ];
  const barsChanging = staffBarlineXs({ tempoMap: changing, durationSec: 8, songTime: 0, cursorX: 250, pxPerSec: 300, widthPx: 2600 });
  assertEqual(barsChanging.length, 3, "смена BPM: черты 0, 2, 4 в окне");
  assertApprox(barsChanging[2] ?? -1, 250 + 4 * 300, "черта на смене темпа (t=4)");
  assert(!barsChanging.some((x) => Math.abs(x - (250 + 6 * 300)) < 1e-9), "t=6 — не черта (3-я доля такта от 4 с)");

  // Скольжение черт с нотами: та же линейная формула от songTime.
  const later = staffBarlineXs({ tempoMap: bpm120, durationSec: 8, ...base, songTime: 5 });
  assertEqual(later.length, 1, "при songTime 5 в окне только такт t=6");
  assertApprox(later[0] ?? -1, 550, "черта t=6 — на 1 с × 300 px правее курсора");

  // Пустая темповая карта и вырожденная длительность.
  assertEqual(staffBarlineXs({ tempoMap: [], durationSec: 8, ...base }).length, 2, "пустая карта — дефолт 120 BPM");
  assertEqual(staffBarlineXs({ tempoMap: bpm120, durationSec: 0, ...base }).length, 0, "нулевая длительность — черт нет");
  console.log("  OK: сетка метронома, 3/4, смена BPM, фильтр ширины, скольжение");
}

// --- 8. Окно на настоящей мелодии (контракт с Player/Melody) ---

function testMelodyContract(): void {
  console.log("Контракт с мелодией:");
  const melody: Melody = {
    id: "smoke:staff",
    title: "Smoke",
    composer: "Smoke",
    notes: [note(60, 0, 0.5), note(62, 0.5, 0.5), note(64, 1, 0.5), note(65, 1.5, 0.5)],
    tempoMap: [{ timeSec: 0, bpm: 120 }],
    timeSignature: { numerator: 4, denominator: 4 },
    durationSec: 2,
  };
  const sorted = [...melody.notes].sort((a, b) => a.startTimeSec - b.startTimeSec);
  const view = computeStaffWindow({
    notes: sorted,
    songTime: 0,
    widthPx: 800,
    autoplay: false,
    isPlayable: () => true,
    hitWindowSec: 0.15,
  });
  assertEqual(view.notes.length, 4, "все ноты начала видны");
  assert(view.notes[0]?.highlight === true, "первая нота — accent");
  // Курсор в начале мелодии: первая нота на курсоре, остальные правее.
  assertApprox(view.notes[0]?.x ?? -1, view.cursorX, "первая нота на курсоре");
  assert(view.notes.every((item, i) => i === 0 || (view.notes[i - 1]?.x ?? 0) < item.x), "x монотонен по времени");
  console.log("  OK: сортировка как у плеера, accent на первой, монотонный x");
}

function main(): void {
  testGeometry();
  testTimeWindow();
  testPurity();
  testLearnHighlight();
  testWaitMode();
  testAutoplay();
  testBarlines();
  testMelodyContract();
  console.log(`SMOKE OK: ${checks} проверок пройдено`);
}

try {
  main();
} catch (error) {
  console.error("SMOKE FAIL:", error);
  throw error;
}
