/**
 * Smoke-проверка маппинга v3 (ADR-006) без браузера: таблица code→pitch
 * (36 нот C4–B6, Tab = C4, третья октава на B N M , . / Shift + H J L ; '),
 * подписи клавиш, октавные сдвиги и клампы MIDI 0–127, отсутствие колонок
 * у нот вне охвата, русские имена нот (ступень и полная форма).
 * Запуск: npm run smoke:mapping.
 */
import { codeLabel, PitchMapping, rangeLabel } from "../src/core/mapping";
import { computeKeyboardLayout, pitchName, pitchNameRuFull, pitchNameRuStep } from "../src/core/layout";

let checks = 0;
function assert(condition: boolean, message: string): void {
  checks += 1;
  if (!condition) throw new Error(`ПРОВАЛ: ${message}`);
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message} (ожидалось ${String(expected)}, получено ${String(actual)})`);
}

/** Таблица ADR-006 v3: 36 нот C4–B6 — белые + чёрные ряды. */
const EXPECTED: ReadonlyArray<readonly [string, number]> = [
  // Белый ряд слева направо (Tab = C4 по решению игрока, ADR-006 2026-11-24).
  ["Tab", 60], // C4
  ["KeyQ", 62], // D4
  ["KeyW", 64], // E4
  ["KeyE", 65], // F4
  ["KeyR", 67], // G4
  ["KeyT", 69], // A4
  ["KeyY", 71], // B4
  ["KeyU", 72], // C5
  ["KeyI", 74], // D5
  ["KeyO", 76], // E5
  ["KeyP", 77], // F5
  ["BracketLeft", 79], // G5
  ["BracketRight", 81], // A5
  ["Backslash", 83], // B5
  // Третья октава: нижний буквенный ряд, правый Shift замыкает (ADR-006 v3).
  ["KeyB", 84], // C6
  ["KeyN", 86], // D6
  ["KeyM", 88], // E6
  ["Comma", 89], // F6
  ["Period", 91], // G6
  ["Slash", 93], // A6
  ["ShiftRight", 95], // B6
  // Чёрный ряд (3 и 7 пропущены — между E–F и B–C чёрных нет).
  ["Digit1", 61], // C#4
  ["Digit2", 63], // D#4
  ["Digit4", 66], // F#4
  ["Digit5", 68], // G#4
  ["Digit6", 70], // A#4
  ["Digit8", 73], // C#5
  ["Digit9", 75], // D#5
  ["Minus", 78], // F#5
  ["Equal", 80], // G#5
  ["Backspace", 82], // A#5
  // Чёрные третьей октавы: домашний ряд (ADR-006 v3).
  ["KeyH", 85], // C#6
  ["KeyJ", 87], // D#6
  ["KeyL", 90], // F#6
  ["Semicolon", 92], // G#6
  ["Quote", 94], // A#6
];

// --- 1. Таблица маппинга: все 36 code→pitch ---

function testTable(): void {
  console.log("Таблица маппинга:");
  const mapping = new PitchMapping();
  for (const [code, pitch] of EXPECTED) {
    assertEqual(mapping.pitchForCode(code), pitch, `${code} → ${pitchName(pitch)}`);
    assert(mapping.isNoteCode(code), `isNoteCode(${code}) — нота (preventDefault, вкл. Backspace/ShiftRight)`);
  }
  // Не-ноты: Backquote (освобождён, ADR-006 2026-11-24), педаль/сдвиг,
  // старые клавиши v1, пропуски 3/7, F-ряд, левый Shift (свободный
  // модификатор — нота сидит на правом Shift).
  for (const code of ["Backquote", "Space", "KeyZ", "KeyX", "KeyA", "KeyS", "Digit3", "Digit7", "F4", "ShiftLeft"]) {
    assertEqual(mapping.pitchForCode(code), null, `${code} вне маппинга`);
    assert(!mapping.isNoteCode(code), `isNoteCode(${code}) = false`);
  }
  console.log(`  OK: 36 нот C4–B6 (Tab = C4, третья октава на B N M , . / Shift + H J L ; ')`);
  console.log(`  OK: не-ноты (\`/Space/Z/X/3/7/F4/ShiftLeft) отфильтрованы`);
}

// --- 2. Подписи клавиш ---

function testLabels(): void {
  console.log("Подписи клавиш:");
  const expectedLabels: Record<string, string> = {
    Tab: "Tab",
    KeyQ: "Q",
    KeyW: "W",
    KeyE: "E",
    KeyR: "R",
    KeyT: "T",
    KeyY: "Y",
    KeyU: "U",
    KeyI: "I",
    KeyO: "O",
    KeyP: "P",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    KeyB: "B",
    KeyN: "N",
    KeyM: "M",
    Comma: ",",
    Period: ".",
    Slash: "/",
    ShiftRight: "Shift",
    Digit1: "1",
    Digit2: "2",
    Digit4: "4",
    Digit5: "5",
    Digit6: "6",
    Digit8: "8",
    Digit9: "9",
    Minus: "−",
    Equal: "=",
    Backspace: "Del",
    KeyH: "H",
    KeyJ: "J",
    KeyL: "L",
    Semicolon: ";",
    Quote: "'",
  };
  for (const [code, label] of Object.entries(expectedLabels)) {
    assertEqual(codeLabel(code), label, `codeLabel(${code})`);
    assert(label.length > 0, `подпись ${code} непустая`);
  }
  // labels(): у каждого питча диапазона есть непустая подпись физической клавиши.
  const mapping = new PitchMapping();
  const labels = mapping.labels();
  assertEqual(labels.size, 36, "labels(): 36 подписей");
  for (const pitch of mapping.pitches()) {
    const label = labels.get(pitch);
    assert(label !== undefined && label.length > 0, `подпись питча ${pitchName(pitch)} непустая`);
  }
  console.log("  OK: Tab [ ] \\ − = Del , . / ; ' Shift и буквы/цифры, подписи у всех 36 питчей");
}

// --- 3. Диапазон и сдвиги ---

function testRange(): void {
  console.log("Диапазон и сдвиги:");
  const mapping = new PitchMapping();
  const range0 = mapping.range();
  assertEqual(rangeLabel(range0), "C4–B6", "HUD при сдвиге 0");
  assertEqual(range0.basePitch, 60, "basePitch C4 = 60");
  assertEqual(range0.topPitch, 95, "topPitch B6 = 95");
  assertEqual(mapping.pitches().length, 36, "pitches(): 36 нот");
  assert(
    mapping.pitches().every((p, i, arr) => (i === 0 ? true : arr[i - 1] === p - 1)),
    "pitches(): хроматика без дыр 60..95",
  );

  assert(mapping.shiftOctaves(1), "shiftOctaves(+1) применился");
  const rangeUp = mapping.range();
  assertEqual(rangeUp.basePitch, 72, "сдвиг +1: base C5 = 72");
  assertEqual(rangeUp.topPitch, 107, "сдвиг +1: top B7 = 107");
  assertEqual(rangeLabel(rangeUp), "C5–B7", "HUD при сдвиге +1");
  assertEqual(mapping.pitchForCode("Tab"), 72, "сдвиг +1: Tab → C5");

  assert(mapping.shiftOctaves(-1), "shiftOctaves(-1) вернул назад");
  assert(mapping.shiftOctaves(-1), "shiftOctaves(-1) вниз");
  const rangeDown = mapping.range();
  assertEqual(rangeDown.basePitch, 48, "сдвиг −1: base C3 = 48");
  assertEqual(rangeDown.topPitch, 83, "сдвиг −1: top B5 = 83");
  assertEqual(rangeLabel(rangeDown), "C3–B5", "HUD при сдвиге −1");
  assertEqual(mapping.pitchForCode("Backspace"), 70, "сдвиг −1: ⌫ → A#4");

  console.log("  OK: C4–B6 → C5–B7 (+1) → C3–B5 (−1), хроматика без дыр");
}

// --- 4. Клампы на границах MIDI 0–127 ---

function testClamps(): void {
  console.log("Клампы MIDI:");
  const mapping = new PitchMapping();
  let ups = 0;
  while (mapping.shiftOctaves(1)) ups += 1;
  assertEqual(ups, 2, "вверх максимум +2 октавы (база дошла до C6, top B6 = 95)");
  const top = mapping.range();
  assertEqual(top.topPitch, 119, "верхний кламп: B8 = 119 ≤ 127");
  assertEqual(rangeLabel(top), "C6–B8", "HUD на верхнем клампе");

  let downs = 0;
  while (mapping.shiftOctaves(-1)) downs += 1;
  assertEqual(downs, 7, "вниз до упора: +2 − 7 = −5 октав");
  const bottom = mapping.range();
  assertEqual(bottom.basePitch, 0, "нижний кламп: MIDI 0 ≥ 0");
  assertEqual(rangeLabel(bottom), "C-1–B1", "HUD на нижнем клампе (MIDI 0 = C-1 в научной нотации)");
  assert(!mapping.shiftOctaves(-1), "ниже −5 сдвиг не меняется");

  for (const pitch of mapping.pitches()) {
    assert(pitch >= 0 && pitch <= 127, `питч ${pitch} в MIDI 0–127`);
  }
  console.log("  OK: сдвиг ограничен −5..+2, все питчи в MIDI 0–127");
}

// --- 5. Ноты вне охвата: колонки нет (не рисуются, ADR-006 п.6) ---

function testOutOfRange(): void {
  console.log("Ноты вне охвата:");
  const mapping = new PitchMapping();
  // Раскладка строится только из питчей маппинга — неефект notefield:
  // нота без колонки (layout.byPitch) не рисуется вовсе.
  const layout = computeKeyboardLayout(1400, 300, mapping.pitches());
  assertEqual(layout.keys.length, 36, "раскладка: 36 клавиш (21 белая + 15 чёрных)");
  assertEqual(layout.keys.filter((k) => !k.isBlack).length, 21, "раскладка: 21 белая клавиша");
  for (const pitch of mapping.pitches()) {
    assert(layout.byPitch.has(pitch), `${pitchName(pitch)} имеет колонку`);
  }
  for (const outside of [58, 59, 96, 97, 108]) {
    assert(!layout.byPitch.has(outside), `${pitchName(outside)} вне охвата — колонки нет`);
  }
  console.log("  OK: колонки только у 36 нот охвата, соседние октавы — мимо");
}

// --- 6. Русские имена нот (GLOSSARY «Русское имя ноты») ---

function testRussianNames(): void {
  console.log("Русские имена нот:");
  // Ступень: натуральные и чёрные со знаком ♯ (U+266F).
  assertEqual(pitchNameRuStep(60), "до", "C4 ступень");
  assertEqual(pitchNameRuStep(62), "ре", "D4 ступень");
  assertEqual(pitchNameRuStep(64), "ми", "E4 ступень");
  assertEqual(pitchNameRuStep(65), "фа", "F4 ступень");
  assertEqual(pitchNameRuStep(67), "соль", "G4 ступень");
  assertEqual(pitchNameRuStep(69), "ля", "A4 ступень");
  assertEqual(pitchNameRuStep(71), "си", "B4 ступень");
  assertEqual(pitchNameRuStep(61), "до♯", "C#4 ступень со знаком ♯");
  assertEqual(pitchNameRuStep(63), "ре♯", "D#4 ступень");
  assertEqual(pitchNameRuStep(66), "фа♯", "F#4 ступень");
  assertEqual(pitchNameRuStep(70), "ля♯", "A#4 ступень");
  assertEqual(pitchNameRuStep(78), "фа♯", "F#5 ступень");
  assertEqual(pitchNameRuStep(83), "си", "B5 ступень");
  // Третья октава (C6–B6): белые на нижнем ряду, чёрные на домашнем.
  assertEqual(pitchNameRuStep(84), "до", "C6 ступень");
  assertEqual(pitchNameRuStep(85), "до♯", "C#6 ступень");
  assertEqual(pitchNameRuStep(87), "ре♯", "D#6 ступень");
  assertEqual(pitchNameRuStep(90), "фа♯", "F#6 ступень");
  assertEqual(pitchNameRuStep(92), "соль♯", "G#6 ступень");
  assertEqual(pitchNameRuStep(94), "ля♯", "A#6 ступень");
  assertEqual(pitchNameRuStep(95), "си", "B6 ступень");
  // Полная форма — родительный падеж «нота <чего>».
  assertEqual(pitchNameRuFull(60), "до первой октавы", "C4 полная форма");
  assertEqual(pitchNameRuFull(71), "си первой октавы", "B4 полная форма");
  assertEqual(pitchNameRuFull(72), "до второй октавы", "C5 полная форма");
  assertEqual(pitchNameRuFull(83), "си второй октавы", "B5 полная форма");
  assertEqual(pitchNameRuFull(48), "до малой октавы", "C3 полная форма");
  assertEqual(pitchNameRuFull(36), "до большой октавы", "C2 полная форма");
  assertEqual(pitchNameRuFull(84), "до третьей октавы", "C6 полная форма");
  assertEqual(pitchNameRuFull(95), "си третьей октавы", "B6 полная форма");
  assertEqual(pitchNameRuFull(24), "до контроктавы", "C1 полная форма");
  assertEqual(pitchNameRuFull(12), "до субконтроктавы", "C0 полная форма");
  // Вся таблица маппинга: ступень непустая и не совпадает с соседней белой.
  const mapping = new PitchMapping();
  for (const pitch of mapping.pitches()) {
    const step = pitchNameRuStep(pitch);
    assert(step.length > 0, `ступень ${pitchName(pitch)} непустая`);
    assert(pitchNameRuFull(pitch).startsWith(step), `полная форма ${pitchName(pitch)} начинается со ступени`);
  }
  assertEqual(pitchNameRuFull(0), "до (C-1)", "ниже субконтроктавы — fallback на западное имя");
  console.log("  OK: ступени до…си с ♯, полные формы с падежами октав, fallback ниже субконтроктавы");
}

async function main(): Promise<void> {
  testTable();
  testLabels();
  testRange();
  testClamps();
  testOutOfRange();
  testRussianNames();
  console.log(`SMOKE OK: ${checks} проверок пройдено`);
}

try {
  await main();
} catch (error) {
  console.error("SMOKE FAIL:", error);
  throw error;
}
