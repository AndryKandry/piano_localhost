/**
 * Smoke-проверка модели грифа гитары (research 06) — чистая логика
 * src/core/fretboard.ts: строй EADGBE, словарь «записанная нота → струна.лад»
 * I позиции (натуральные research 06 §4 + все диезы), roundtrip записанной
 * высоты, звучащая высота (−12), дубликат B4, границы диапазона, валидация.
 * Плюс чистая геометрия диаграммы layoutFretboard из src/render/fretboard.ts:
 * порядок струн/порожков, толщина к басу, кружок открытой ноты у нута.
 * Запуск: npm run smoke:fretboard.
 *
 * САМ РЕНДЕР (рисование кружка, Retina-буфер) в node НЕ проверяется —
 * нужен живой браузер; визуальная выверка — этап Validation (как у нотации,
 * research 05 §8). Здесь проверяются только чистые функции.
 */
import {
  FIRST_POSITION_FRETS,
  FIRST_POSITION_WRITTEN_HIGH,
  FIRST_POSITION_WRITTEN_LOW,
  OPEN_MIDI,
  STRING_COUNT,
  STRING_LETTERS,
  fretLabel,
  guitarToSounding,
  guitarToWritten,
  isValidGuitarNote,
  soundingMidi,
  stringName,
  writtenToGuitar,
  type GuitarNote,
} from "../src/core/fretboard";
import { fingerCircleX, layoutFretboard } from "../src/render/fretboard";

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
function assertNote(actual: GuitarNote | null, string: number, fret: number, message: string): void {
  checks += 1;
  if (!actual || actual.string !== string || actual.fret !== fret) {
    throw new Error(`ПРОВАЛ: ${message} (ожидалось {string: ${string}, fret: ${fret}}, получено ${JSON.stringify(actual)})`);
  }
}
function assertThrows(fn: () => unknown, message: string): void {
  checks += 1;
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(`ПРОВАЛ: ${message} (исключения не было)`);
}

// --- 1. Строй EADGBE (research 06 §1) ---

function testTuning(): void {
  console.log("Строй и имена струн:");
  assertEqual(STRING_COUNT, 6, "шесть струн");
  assertEqual(FIRST_POSITION_FRETS, 4, "I позиция — лады 0–4");
  assertEqual([...OPEN_MIDI].join(","), "64,59,55,50,45,40", "открытые струны: 1-я E4 … 6-я E2");
  // Четыре кварты (+5) с большой терцией (+4) между 3-й и 2-й струнами.
  const intervals: number[] = [];
  for (let s = 1; s < STRING_COUNT; s += 1) intervals.push(OPEN_MIDI[s - 1] - OPEN_MIDI[s]);
  assertEqual(intervals.join(","), "5,4,5,5,5", "интервалы 1→6: кварта, терция (3-я–2-я), кварта, кварта, кварта");
  assertEqual([...STRING_LETTERS].join(""), "EBGDAE", "буквы открытых струн E B G D A E");
  assertEqual(stringName(1), "E4", "1-я струна звучит E4");
  assertEqual(stringName(2), "B3", "2-я — B3");
  assertEqual(stringName(3), "G3", "3-я — G3");
  assertEqual(stringName(4), "D3", "4-я — D3");
  assertEqual(stringName(5), "A2", "5-я — A2");
  assertEqual(stringName(6), "E2", "6-я — E2");
  console.log("  OK: EADGBE 64/59/55/50/45/40, кварта-терция-кварта, имена струн");
}

// --- 2. Словарь натуральных I позиции (research 06 §4) ---

function testNaturalDictionary(): void {
  console.log("Словарь натуральных I позиции:");
  // Таблица research 06 §4 (записанная высота → струна.лад).
  const naturals: Array<[number, number, number]> = [
    [52, 6, 0], // E3 — 6 откр.
    [53, 6, 1], // F3 — 6.I
    [55, 6, 3], // G3 — 6.III
    [57, 5, 0], // A3 — 5 откр.
    [59, 5, 2], // B3 — 5.II
    [60, 5, 3], // C4 — 5.III
    [62, 4, 0], // D4 — 4 откр.
    [64, 4, 2], // E4 — 4.II
    [65, 4, 3], // F4 — 4.III
    [67, 3, 0], // G4 — 3 откр.
    [69, 3, 2], // A4 — 3.II
    [71, 2, 0], // B4 — 2 откр. (конвенция для дубликата)
    [72, 2, 1], // C5 — 2.I
    [74, 2, 3], // D5 — 2.III
    [76, 1, 0], // E5 — 1 откр.
    [77, 1, 1], // F5 — 1.I
    [79, 1, 3], // G5 — 1.III
  ];
  for (const [written, string, fret] of naturals) {
    assertNote(writtenToGuitar(written), string, fret, `MIDI ${written} → струна ${string}, лад ${fret}`);
  }
  console.log(`  OK: ${naturals.length} натуральных по таблице research 06 §4`);
}

// --- 3. Диезы I позиции (та же формула лада) ---

function testSharpsDictionary(): void {
  console.log("Словарь диезов I позиции:");
  const sharps: Array<[number, number, number]> = [
    [54, 6, 2], // F♯3 — 6.II
    [56, 6, 4], // G♯3 — 6.IV
    [58, 5, 1], // A♯3 — 5.I
    [61, 5, 4], // C♯4 — 5.IV
    [63, 4, 1], // D♯4 — 4.I
    [66, 4, 4], // F♯4 — 4.IV
    [68, 3, 1], // G♯4 — 3.I
    [70, 3, 3], // A♯4 — 3.III
    [73, 2, 2], // C♯5 — 2.II
    [75, 2, 4], // D♯5 — 2.IV
    [78, 1, 2], // F♯5 — 1.II
    [80, 1, 4], // G♯5 — 1.IV (верх диапазона)
  ];
  for (const [written, string, fret] of sharps) {
    assertNote(writtenToGuitar(written), string, fret, `MIDI ${written} → струна ${string}, лад ${fret}`);
  }
  console.log(`  OK: ${sharps.length} диезов, каждый на своей струне лады I–IV`);
}

// --- 4. Полнота диапазона и границы ---

function testRange(): void {
  console.log("Полнота диапазона I позиции:");
  assertEqual(FIRST_POSITION_WRITTEN_LOW, 52, "низ записанного диапазона — E3 (52)");
  assertEqual(FIRST_POSITION_WRITTEN_HIGH, 80, "верх записанного диапазона — G♯5 (80)");
  let reachable = 0;
  for (let w = FIRST_POSITION_WRITTEN_LOW; w <= FIRST_POSITION_WRITTEN_HIGH; w += 1) {
    const note = writtenToGuitar(w);
    if (note) reachable += 1;
    assert(note !== null, `записанная ${w} достижима в I позиции`);
  }
  assertEqual(reachable, 29, "диапазон 52–80 непрерывен: все 29 высот достижимы");

  // Вне I позиции — null, без исключений.
  for (const outside of [0, 39, 51, 81, 96, 100, 127]) {
    assertEqual(writtenToGuitar(outside), null, `MIDI ${outside} вне I позиции → null`);
  }
  assertEqual(writtenToGuitar(51.5), null, "нецелый MIDI → null (не питч)");

  // 30 позиций покрывают 29 высот — ровно один дубликат.
  const writtenByPosition = new Set<number>();
  let positions = 0;
  for (let s = 1; s <= STRING_COUNT; s += 1) {
    for (let f = 0; f <= FIRST_POSITION_FRETS; f += 1) {
      writtenByPosition.add(guitarToWritten({ string: s, fret: f }));
      positions += 1;
    }
  }
  assertEqual(positions, 30, "30 позиций (6 струн × лады 0–4)");
  assertEqual(writtenByPosition.size, 29, "29 различных высот — ровно один дубликат в I позиции");
  console.log("  OK: 52–80 непрерывен, вне диапазона null, 30 позиций → 29 высот");
}

// --- 5. Дубликат B4: конвенция «открытая 2-я» (research 06 §4) ---

function testB4Duplicate(): void {
  console.log("Дубликат B4:");
  assertNote(writtenToGuitar(71), 2, 0, "записанная B4 → открытая 2-я струна");
  assertEqual(guitarToWritten({ string: 3, fret: 4 }), 71, "3-я струна IV лад — та же высота B4 (есть на грифе)");
  assertEqual(
    guitarToWritten({ string: 2, fret: 0 }),
    guitarToWritten({ string: 3, fret: 4 }),
    "оба варианта звучат одинаково (B3 sounding 59)",
  );
  console.log("  OK: B4 → {2, 0}, вариант 3.IV существует, но словарю не принадлежит");
}

// --- 6. Roundtrip guitarToWritten ↔ writtenToGuitar ---

function testRoundtrip(): void {
  console.log("Roundtrip записанной высоты:");
  assertEqual(guitarToWritten({ string: 1, fret: 0 }), 76, "открытая 1-я записана E5 (76)");
  assertEqual(guitarToWritten({ string: 6, fret: 0 }), 52, "открытая 6-я записана E3 (52)");
  assertEqual(guitarToWritten({ string: 2, fret: 1 }), 72, "2-я I лад записана C5 (72)");
  for (let s = 1; s <= STRING_COUNT; s += 1) {
    for (let f = 0; f <= FIRST_POSITION_FRETS; f += 1) {
      if (s === 3 && f === 4) continue; // 3.IV — алиас B4, словарь отдаёт открытую 2-ю
      const note: GuitarNote = { string: s, fret: f };
      assertNote(writtenToGuitar(guitarToWritten(note)), s, f, `roundtrip струна ${s}, лад ${f}`);
    }
  }
  // Все 30 позиций дают валидную высоту I позиции (словарь её знает).
  for (let s = 1; s <= STRING_COUNT; s += 1) {
    for (let f = 0; f <= FIRST_POSITION_FRETS; f += 1) {
      assert(writtenToGuitar(guitarToWritten({ string: s, fret: f })) !== null, `высота (${s}, ${f}) в словаре`);
    }
  }
  console.log("  OK: 29 позиций roundtrip точно, 3.IV — задокументированный алиас B4");
}

// --- 7. Звучащая высота: −12 (research 06 §1) ---

function testSounding(): void {
  console.log("Звучащая высота:");
  assertEqual(soundingMidi(76), 64, "записанная E5 звучит как открытая 1-я (64)");
  assertEqual(soundingMidi(52), 40, "записанная E3 звучит как открытая 6-я (40)");
  assertEqual(guitarToSounding({ string: 5, fret: 3 }), 48, "записанная C4 (5-я III) звучит C3 = MIDI 48 (research 06 §4)");
  for (let s = 1; s <= STRING_COUNT; s += 1) {
    for (let f = 0; f <= FIRST_POSITION_FRETS; f += 1) {
      const note: GuitarNote = { string: s, fret: f };
      assertEqual(
        soundingMidi(guitarToWritten(note)),
        guitarToSounding(note),
        `sounding = written − 12 для (${s}, ${f})`,
      );
    }
  }
  console.log("  OK: sounding = written − 12 на всех 30 позициях");
}

// --- 8. Подписи и валидация ---

function testLabelsAndValidation(): void {
  console.log("Подписи и валидация:");
  assertEqual(fretLabel(0), "0", "открытая — «0» (таб-конвенция research 06 §3)");
  assertEqual(fretLabel(1), "1", "I лад — «1»");
  assertEqual(fretLabel(4), "4", "IV лад — «4»");

  assertEqual(isValidGuitarNote({ string: 1, fret: 0 }), true, "1-я открытая валидна");
  assertEqual(isValidGuitarNote({ string: 6, fret: 4 }), true, "6-я IV лад валидна");
  assertEqual(isValidGuitarNote({ string: 0, fret: 0 }), false, "струна 0 невалидна");
  assertEqual(isValidGuitarNote({ string: 2, fret: 5 }), false, "лад 5 вне I позиции");
  assertEqual(isValidGuitarNote({ string: 2, fret: 1.5 }), false, "дробный лад невалиден");

  assertThrows(() => stringName(0), "stringName(0) — исключение");
  assertThrows(() => stringName(7), "stringName(7) — исключение");
  assertThrows(() => fretLabel(-1), "fretLabel(-1) — исключение");
  assertThrows(() => fretLabel(5), "fretLabel(5) — исключение");
  assertThrows(() => guitarToWritten({ string: 2, fret: 5 }), "лад вне I позиции — исключение");
  assertThrows(() => guitarToWritten({ string: 7, fret: 0 }), "струна 7 — исключение");
  assertThrows(() => guitarToSounding({ string: 1, fret: -1 }), "отрицательный лад — исключение");
  console.log("  OK: «0» для открытой, guard'ы валидации не пропускают мусор");
}

// --- 9. Геометрия диаграммы (чистая функция, node) ---

function testGeometry(): void {
  console.log("Геометрия диаграммы:");
  const geo = layoutFretboard(320, 140);
  assertEqual(geo.stringYs.length, 6, "шесть струн");
  for (let s = 1; s < STRING_COUNT; s += 1) {
    assert(geo.stringYs[s] > geo.stringYs[s - 1], "струны идут вниз: 1-я сверху, 6-я снизу");
  }
  assertApprox(geo.stringYs[0] - geo.stringYs[1], -(geo.stringYs[1] - geo.stringYs[0]), "равное межструнное", 1e-9);
  for (let s = 1; s < STRING_COUNT; s += 1) {
    assert(geo.stringWidths[s] > geo.stringWidths[s - 1], "толщина растёт к басу (1-я тоньше 6-й)");
  }
  assert(geo.fingerRadius * 2 <= geo.stringYs[1] - geo.stringYs[0], "кружок не наезжает на соседнюю струну");

  assert(geo.labelX < geo.nutX, "буквы струн левее нута");
  let x = geo.nutX;
  for (const fx of geo.fretXs) {
    assert(fx > x, "порожки правее нута и друг друга (лады 0–4 слева направо)");
    x = fx;
  }
  assert(geo.fretXs[3] <= geo.width, "последний порожек внутри канваса");
  for (let f = 1; f < FIRST_POSITION_FRETS; f += 1) {
    assertApprox(geo.fretXs[f] - geo.fretXs[f - 1], geo.fretSpacing, `порожек лада ${f + 1} — на ширине лада`);
  }
  assertApprox(geo.fretXs[0] - geo.nutX, geo.fretSpacing, "нут — нулевой порожек перед I ладом");
  assert(geo.wireTop < geo.stringYs[0] && geo.wireBottom > geo.stringYs[5], "порожки выступают за крайние струны");
  assertApprox(geo.fretXs[3] + geo.fretSpacing * 0.12, geo.nutX + geo.stringLength, "струны кончаются хвостом за IV порожком");

  // Кружок-палец: лад 0 — у нулевого порога, 1–4 — центры промежутков.
  assertApprox(fingerCircleX(geo, 0), geo.nutX, "открытая нота — кружок на нуте");
  assertApprox(fingerCircleX(geo, 1), geo.nutX + 0.5 * geo.fretSpacing, "кружок I лада — центр промежутка");
  assertApprox(fingerCircleX(geo, 4), geo.nutX + 3.5 * geo.fretSpacing, "кружок IV лада — центр промежутка");

  console.log("  OK: порядок струн/порожков, толщина к басу, нут перед I ладом");
}

// --- 10. Узкий канвас — без NaN и вылетов ---

function testGeometryDegenerate(): void {
  console.log("Геометрия вырожденных размеров:");
  for (const [w, h] of [[60, 40], [1, 1], [200, 300]]) {
    const geo = layoutFretboard(w, h);
    for (const y of geo.stringYs) assert(Number.isFinite(y), `y струны конечен при ${w}×${h}`);
    assert(Number.isFinite(geo.nutX) && geo.nutX <= w / 2 + 1e-9, `нут прижат к половине при ${w}×${h}`);
    assert(Number.isFinite(geo.fretSpacing) && geo.fretSpacing >= 20, `лад не сжимается ниже минимума при ${w}×${h}`);
    assert(geo.fingerRadius > 0, `радиус кружка положителен при ${w}×${h}`);
  }
  console.log("  OK: 60×40, 1×1, 200×300 — без NaN, нут ≤ половины ширины");
}

function main(): void {
  testTuning();
  testNaturalDictionary();
  testSharpsDictionary();
  testRange();
  testB4Duplicate();
  testRoundtrip();
  testSounding();
  testLabelsAndValidation();
  testGeometry();
  testGeometryDegenerate();
  console.log(`SMOKE OK: ${checks} проверок пройдено`);
}

try {
  main();
} catch (error) {
  console.error("SMOKE FAIL:", error);
  throw error;
}
