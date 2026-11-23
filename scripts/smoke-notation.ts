/**
 * Smoke-проверка геометрии нотного стана модуля «Азбука» (ADR-007) — чистая
 * математика src/notation/geometry.ts: позиции нот, y-координаты и roundtrip
 * кликов, направление и длина штиля, добавочные линейки, позиции пауз и
 * размера, раскладка такта. Запуск: npm run smoke:notation.
 *
 * САМ РЕНДЕР (renderer.ts: глифы Bravura, штили, подсветка) в node НЕ
 * проверяется — нужен живой браузер и загруженный шрифт; визуальная выверка
 * посадки флага и глифов — этап Validation (research 05 §8). Здесь
 * проверяются только соотношения, кодпоинты и чистые функции.
 */
import {
  BEAM_SPACING_SPACES,
  BEAM_THICKNESS_SPACES,
  BOTTOM_LINE_POS,
  CLEF_BASELINE_POS,
  DURATION_BEATS,
  FLAG_CODEPOINTS,
  LEDGER_EXTENSION_SPACES,
  LEDGER_THICKNESS_SPACES,
  MIDDLE_LINE_POS,
  STEM_LENGTH_SPACES,
  STEM_THICKNESS_SPACES,
  STAFF_LINE_COUNT,
  STAFF_LINE_THICKNESS_SPACES,
  THIN_BARLINE_THICKNESS_SPACES,
  TIMESIG_DENOMINATOR_POS,
  TIMESIG_NUMERATOR_POS,
  TOP_LINE_POS,
  ledgerPositions,
  layoutMeasure,
  pitchToStaffPos,
  pitchToY,
  restBaselinePos,
  staffPosToPitch,
  stemDirection,
  stemLengthPx,
  stemTipY,
  yToPitch,
  type StaffDuration,
} from "../src/notation/geometry";

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

// --- 1. Позиции нот на стане (скрипичный ключ: E4 — нижняя линия) ---

function testStaffPositions(): void {
  console.log("Позиции нот на стане:");
  assertEqual(pitchToStaffPos(64), 0, "E4 (MIDI 64) — нижняя линия");
  assertEqual(pitchToStaffPos(67), 2, "G4 — вторая линия (линия скрипичного ключа)");
  assertEqual(pitchToStaffPos(71), 4, "B4 — средняя линия");
  assertEqual(pitchToStaffPos(77), 8, "F5 — верхняя линия");
  assertEqual(pitchToStaffPos(60), -2, "C4 — первая добавочная линейка снизу");
  assertEqual(pitchToStaffPos(72), 5, "C5 — промежуток над средней линией");
  assertEqual(pitchToStaffPos(83), 11, "B5 — промежуток над первой добавочной сверху");
  assertEqual(pitchToStaffPos(84), 12, "C6 — вторая добавочная сверху");
  assertEqual(pitchToStaffPos(69), 3, "A4 — промежуток");
  assertEqual(pitchToStaffPos(61), -2, "C#4 стоит на позиции своей буквы C4 (альтераций в v1 нет)");

  // Обратное соответствие линий и натуральных нот.
  assertEqual(staffPosToPitch(0), 64, "позиция 0 → E4");
  assertEqual(staffPosToPitch(2), 67, "позиция 2 → G4");
  assertEqual(staffPosToPitch(4), 71, "позиция 4 → B4");
  assertEqual(staffPosToPitch(-2), 60, "позиция −2 → C4");
  assertEqual(staffPosToPitch(8), 77, "позиция 8 → F5");

  // Шаг письма: квинта E4→B4 = 4 диатонические позиции (E-F-G-A-B).
  assertEqual(pitchToStaffPos(64) + 4, pitchToStaffPos(71), "E4 → B4: +4 позиции (квинта письма)");
  console.log("  OK: E4/G4/B4/F5, добавочные C4/B5/C6, диезы на позиции буквы");
}

// --- 2. y-координаты и roundtrip кликов ---

function testPitchToY(): void {
  console.log("y-координаты и roundtrip:");
  const staffTop = 40;
  const ss = 12; // межлинейное
  const staffH = 4 * ss; // высота стана 48

  assertApprox(pitchToY(77, staffTop, ss), staffTop, "F5 — верхняя линия = staffTop");
  assertApprox(pitchToY(64, staffTop, ss), staffTop + staffH, "E4 — нижняя линия (на 4 межлинейных ниже)");
  assertApprox(pitchToY(71, staffTop, ss), staffTop + 2 * ss, "B4 — средняя линия");
  assertApprox(pitchToY(67, staffTop, ss), staffTop + 3 * ss, "G4 — вторая линия снизу");
  assertApprox(pitchToY(60, staffTop, ss), staffTop + staffH + ss, "C4 — на одно межлинейное ниже нижней линии");
  assertApprox(pitchToY(64, staffTop, ss) - pitchToY(71, staffTop, ss), 2 * ss, "E4 на два межлинейных ниже B4 (y больше)");

  // Roundtrip для всех натуральных нот C4..F6: клик по y возвращает питч.
  const naturals: number[] = [];
  for (let octave = 4; octave <= 6; octave += 1) {
    for (const semitone of [0, 2, 4, 5, 7, 9, 11]) naturals.push((octave + 1) * 12 + semitone);
  }
  for (const pitch of naturals) {
    const y = pitchToY(pitch, staffTop, ss);
    assertEqual(yToPitch(y, staffTop, ss), pitch, `roundtrip y↔pitch для MIDI ${pitch}`);
  }

  // Промах клика в середину промежутка → ближайшая позиция (не теряется).
  const yBetween = (pitchToY(64, staffTop, ss) + pitchToY(65, staffTop, ss)) / 2; // между E4 и F4
  assertEqual(yToPitch(yBetween, staffTop, ss), 65, "клик ровно между E4 и F4 → F4 (округление вверх от линии)");

  // Небольшой промах от линии не уводит на соседнюю позицию.
  assertEqual(yToPitch(pitchToY(60, staffTop, ss) - 0.2 * ss, staffTop, ss), 60, "клик на 0.2 межлинейного выше C4 остаётся C4");
  assertEqual(yToPitch(pitchToY(60, staffTop, ss) - 0.6 * ss, staffTop, ss), 62, "клик ближе к D4 → D4");
  console.log(`  OK: линии на своих y, roundtrip ${naturals.length} натуральных, округление кликов`);
}

// --- 3. Штили: направление, длина, кончик ---

function testStems(): void {
  console.log("Штили:");
  // Правило средней линии (Gould/MuseScore): ниже B4 — вверх, на B4 и выше — вниз.
  assertEqual(stemDirection(64), "up", "E4 — штиль вверх");
  assertEqual(stemDirection(67), "up", "G4 — вверх");
  assertEqual(stemDirection(69), "up", "A4 — вверх");
  assertEqual(stemDirection(71), "down", "B4 (средняя линия) — вниз");
  assertEqual(stemDirection(72), "down", "C5 (выше средней) — вниз");
  assertEqual(stemDirection(77), "down", "F5 — вниз");
  assertEqual(stemDirection(73), "down", "C#5 наследует направление C5");

  assertEqual(STEM_LENGTH_SPACES, 3.5, "длина штиля 3.5 межлинейного (Gould/MuseScore)");
  assertApprox(stemLengthPx(12), 42, "12px межлинейное → штиль 42px");
  assertApprox(stemLengthPx(10), 35, "10px межлинейное → штиль 35px (линейно)");

  const staffTop = 40;
  const ss = 12;
  assertApprox(stemTipY(64, staffTop, ss), pitchToY(64, staffTop, ss) - 42, "кончик штиля E4 — выше головки");
  assertApprox(stemTipY(72, staffTop, ss), pitchToY(72, staffTop, ss) + 42, "кончик штиля C5 — ниже головки");
  // Штиль длиной 3.5 межлинейного = октава: кончик штиля E4 лежит на линии E5.
  assertApprox(stemTipY(64, staffTop, ss), pitchToY(76, staffTop, ss), "кончик штиля E4 — на линии E5 (октава)");
  console.log("  OK: правило средней линии (B4/C5 — вниз), 3.5 межлинейного = октава");
}

// --- 4. Добавочные линейки ---

function testLedgerLines(): void {
  console.log("Добавочные линейки:");
  assertEqual(ledgerPositions(-1).length, 0, "D4 (крайний промежуток снизу) — без линеек");
  assertEqual(ledgerPositions(9).length, 0, "G5 (крайний промежуток сверху) — без линеек");
  assertEqual(ledgerPositions(0).length, 0, "E4 — нижняя линия, без линеек");
  assertEqual(ledgerPositions(8).length, 0, "F5 — верхняя линия, без линеек");
  assertEqual(ledgerPositions(BOTTOM_LINE_POS - 2).join(","), "-2", "C4 — одна линейка через головку");
  assertEqual(ledgerPositions(-3).join(","), "-2,-4", "B3 — обрамлена линейками C4 и A3");
  assertEqual(ledgerPositions(-4).join(","), "-2,-4", "A3 — линейки C4 и A3 (через головку)");
  assertEqual(ledgerPositions(10).join(","), "10", "A5 — одна линейка через головку");
  assertEqual(ledgerPositions(11).join(","), "10,12", "B5 — обрамлена линейками A5 и C6");
  assertEqual(ledgerPositions(12).join(","), "10,12", "C6 — линейки A5 и C6 (через головку)");

  const staffTop = 40;
  const ss = 12;
  const ledgersC4 = ledgerPositions(-2).map((p) => staffTop + ((TOP_LINE_POS - p) * ss) / 2);
  assertApprox(ledgersC4[0] ?? NaN, staffTop + 5 * ss, "линейка C4 — на одно межлинейное ниже нижней линии");
  console.log("  OK: крайние промежутки без линеек, обрамление промежуточных нот");
}

// --- 5. Паузы, размер, ключ: позиции baseline ---

function testRestAndTimeSigPositions(): void {
  console.log("Позиции пауз и размера:");
  assertEqual(restBaselinePos("whole"), 6, "целая пауза висит: baseline на 2-й линии сверху (SMuFL «should hang»)");
  assertEqual(restBaselinePos("half"), MIDDLE_LINE_POS, "половинная стоит на средней линии");
  assertEqual(restBaselinePos("quarter"), MIDDLE_LINE_POS, "четверть — на средней линии");
  assertEqual(restBaselinePos("eighth"), MIDDLE_LINE_POS, "восьмая — на средней линии");

  assertEqual(CLEF_BASELINE_POS, 2, "скрипичный ключ — на линии G4");
  assertEqual(staffPosToPitch(CLEF_BASELINE_POS), 67, "baseline ключа резолвится в G4");
  assertEqual(TIMESIG_NUMERATOR_POS, 6, "числитель — центр верхней половины стана");
  assertEqual(TIMESIG_DENOMINATOR_POS, 2, "знаменатель — центр нижней половины стана");
  // Цифра размера 0.5 em = 2 межлинейного = ±1 межлинейное от baseline = ±2 позиции:
  // числитель точно заполняет верхнюю половину стана, знаменатель — нижнюю.
  assertEqual(TIMESIG_NUMERATOR_POS + 2, TOP_LINE_POS, "цифра числителя достаёт до верхней линии");
  assertEqual(TIMESIG_NUMERATOR_POS - 2, MIDDLE_LINE_POS, "цифра числителя стоит на средней линии");
  assertEqual(TIMESIG_DENOMINATOR_POS - 2, BOTTOM_LINE_POS, "цифра знаменателя достаёт до нижней линии");
  assertEqual(TIMESIG_DENOMINATOR_POS + 2, MIDDLE_LINE_POS, "цифра знаменателя стоит на средней линии");

  assertEqual(FLAG_CODEPOINTS.up, 0xe240, "флаг восьмой вверх U+E240");
  assertEqual(FLAG_CODEPOINTS.down, 0xe241, "флаг восьмой вниз U+E241");
  console.log("  OK: целая висит под 2-й линией, остальные на средней, ключ G4, флаги E240/E241");
}

// --- 6. Толщины из engravingDefaults (research 05 §5) ---

function testEngravingDefaults(): void {
  console.log("Толщины (engravingDefaults Bravura):");
  assertApprox(STAFF_LINE_THICKNESS_SPACES, 0.13, "линия стана");
  assertApprox(STEM_THICKNESS_SPACES, 0.12, "штиль");
  assertApprox(BEAM_THICKNESS_SPACES, 0.5, "ребро");
  assertApprox(BEAM_SPACING_SPACES, 0.25, "зазор между рёбрами");
  assertApprox(LEDGER_THICKNESS_SPACES, 0.16, "добавочная линейка");
  assertApprox(LEDGER_EXTENSION_SPACES, 0.4, "выступ добавочной за головку");
  assertApprox(THIN_BARLINE_THICKNESS_SPACES, 0.16, "тонкая тактовая черта");
  assertEqual(STAFF_LINE_COUNT, 5, "стан из 5 линий");
  console.log("  OK: значения совпадают с Bravura.json");
}

// --- 7. Раскладка такта ---

function testMeasureLayout(): void {
  console.log("Раскладка такта:");
  // 4/4 из четвертей: равные слоты.
  const quarters = layoutMeasure(["quarter", "quarter", "quarter", "quarter"], 10, 200);
  assertEqual(quarters.length, 4, "четыре слота");
  assertApprox(quarters[0]?.x ?? NaN, 35, "центр первого слота");
  assertApprox(quarters[1]?.x ?? NaN, 85, "центр второго слота");
  assertApprox(quarters[3]?.x ?? NaN, 185, "центр четвёртого слота");
  assertApprox(quarters.reduce((s, q) => s + q.width, 0), 200, "сумма слотов = ширина такта");

  // Пропорциональность: половинная занимает вдвое больше четверти.
  const mixed = layoutMeasure(["quarter", "half"], 0, 180);
  assertApprox(mixed[0]?.width ?? NaN, 60, "четверть — треть такта");
  assertApprox(mixed[1]?.width ?? NaN, 120, "половинная — две трети такта");
  assertApprox(mixed[1]?.x ?? NaN, 120, "центр половинной");

  // Восьмые и паузы — те же длительности в долях.
  const eighths = layoutMeasure(["eighth", "eighth"], 5, 100);
  assertApprox(eighths[0]?.width ?? NaN, 50, "две восьмые = равные слоты");
  const beats = (Object.keys(DURATION_BEATS) as StaffDuration[]).map((d) => DURATION_BEATS[d]);
  assertEqual(beats.join(","), "4,2,1,0.5", "целая=4, половинная=2, четверть=1, восьмая=0.5 доли");
  assertApprox(4 * DURATION_BEATS.quarter, DURATION_BEATS.whole, "4/4 наполняется целой");

  assertEqual(layoutMeasure([], 0, 100).length, 0, "пустой такт — пустая раскладка");
  assertEqual(layoutMeasure(["quarter"], 0, 0).length, 0, "нулевая ширина — пустая раскладка");
  console.log("  OK: равные и пропорциональные слоты, сумма = ширина такта");
}

function main(): void {
  testStaffPositions();
  testPitchToY();
  testStems();
  testLedgerLines();
  testRestAndTimeSigPositions();
  testEngravingDefaults();
  testMeasureLayout();
  console.log(`SMOKE OK: ${checks} проверок пройдено`);
}

try {
  main();
} catch (error) {
  console.error("SMOKE FAIL:", error);
  throw error;
}
