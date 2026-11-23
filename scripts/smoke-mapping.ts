/**
 * Smoke-проверка маппинга v2 (ADR-006) без браузера: таблица code→pitch
 * (24 ноты C4–B5), подписи клавиш, октавные сдвиги и клампы MIDI 0–127,
 * отсутствие колонок у нот вне охвата. Запуск: npm run smoke:mapping.
 */
import { codeLabel, PitchMapping, rangeLabel } from "../src/core/mapping";
import { computeKeyboardLayout, pitchName } from "../src/core/layout";

let checks = 0;
function assert(condition: boolean, message: string): void {
  checks += 1;
  if (!condition) throw new Error(`ПРОВАЛ: ${message}`);
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message} (ожидалось ${String(expected)}, получено ${String(actual)})`);
}

/** Таблица ADR-006: 24 ноты C4–B5 — белые + чёрные ряды. */
const EXPECTED: ReadonlyArray<readonly [string, number]> = [
  // Белый ряд слева направо.
  ["Backquote", 60], // C4
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
];

// --- 1. Таблица маппинга: все 24 code→pitch ---

function testTable(): void {
  console.log("Таблица маппинга:");
  const mapping = new PitchMapping();
  for (const [code, pitch] of EXPECTED) {
    assertEqual(mapping.pitchForCode(code), pitch, `${code} → ${pitchName(pitch)}`);
    assert(mapping.isNoteCode(code), `isNoteCode(${code}) — нота (preventDefault, вкл. Backspace)`);
  }
  // Не-ноты: Tab (a11y), педаль/сдвиг, старые клавиши v1, пропуски 3/7, F-ряд.
  for (const code of ["Tab", "Space", "KeyZ", "KeyX", "KeyA", "KeyS", "Semicolon", "Digit3", "Digit7", "F4"]) {
    assertEqual(mapping.pitchForCode(code), null, `${code} вне маппинга`);
    assert(!mapping.isNoteCode(code), `isNoteCode(${code}) = false`);
  }
  console.log(`  OK: 24 ноты C4–B5, не-ноты (Tab/Space/Z/X/3/7/F4) отфильтрованы`);
}

// --- 2. Подписи клавиш ---

function testLabels(): void {
  console.log("Подписи клавиш:");
  const expectedLabels: Record<string, string> = {
    Backquote: "`",
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
  };
  for (const [code, label] of Object.entries(expectedLabels)) {
    assertEqual(codeLabel(code), label, `codeLabel(${code})`);
    assert(label.length > 0, `подпись ${code} непустая`);
  }
  // labels(): у каждого питча диапазона есть непустая подпись физической клавиши.
  const mapping = new PitchMapping();
  const labels = mapping.labels();
  assertEqual(labels.size, 24, "labels(): 24 подписи");
  for (const pitch of mapping.pitches()) {
    const label = labels.get(pitch);
    assert(label !== undefined && label.length > 0, `подпись питча ${pitchName(pitch)} непустая`);
  }
  console.log("  OK: ` [ ] \\ − = Del и буквы/цифры, подписи у всех 24 питчей");
}

// --- 3. Диапазон и сдвиги ---

function testRange(): void {
  console.log("Диапазон и сдвиги:");
  const mapping = new PitchMapping();
  const range0 = mapping.range();
  assertEqual(rangeLabel(range0), "C4–B5", "HUD при сдвиге 0");
  assertEqual(range0.basePitch, 60, "basePitch C4 = 60");
  assertEqual(range0.topPitch, 83, "topPitch B5 = 83");
  assertEqual(mapping.pitches().length, 24, "pitches(): 24 ноты");
  assert(
    mapping.pitches().every((p, i, arr) => (i === 0 ? true : arr[i - 1] === p - 1)),
    "pitches(): хроматика без дыр 60..83",
  );

  assert(mapping.shiftOctaves(1), "shiftOctaves(+1) применился");
  const rangeUp = mapping.range();
  assertEqual(rangeUp.basePitch, 72, "сдвиг +1: base C5 = 72");
  assertEqual(rangeUp.topPitch, 95, "сдвиг +1: top B6 = 95");
  assertEqual(rangeLabel(rangeUp), "C5–B6", "HUD при сдвиге +1");
  assertEqual(mapping.pitchForCode("Backquote"), 72, "сдвиг +1: ` → C5");

  assert(mapping.shiftOctaves(-1), "shiftOctaves(-1) вернул назад");
  assert(mapping.shiftOctaves(-1), "shiftOctaves(-1) вниз");
  const rangeDown = mapping.range();
  assertEqual(rangeDown.basePitch, 48, "сдвиг −1: base C3 = 48");
  assertEqual(rangeDown.topPitch, 71, "сдвиг −1: top B4 = 71");
  assertEqual(rangeLabel(rangeDown), "C3–B4", "HUD при сдвиге −1");
  assertEqual(mapping.pitchForCode("Backspace"), 70, "сдвиг −1: ⌫ → A#4");

  console.log("  OK: C4–B5 → C5–B6 (+1) → C3–B4 (−1), хроматика без дыр");
}

// --- 4. Клампы на границах MIDI 0–127 ---

function testClamps(): void {
  console.log("Клампы MIDI:");
  const mapping = new PitchMapping();
  let ups = 0;
  while (mapping.shiftOctaves(1)) ups += 1;
  assertEqual(ups, 3, "вверх максимум +3 октавы");
  const top = mapping.range();
  assertEqual(top.topPitch, 119, "верхний кламп: B8 = 119 ≤ 127");
  assertEqual(rangeLabel(top), "C7–B8", "HUD на верхнем клампе");

  let downs = 0;
  while (mapping.shiftOctaves(-1)) downs += 1;
  assertEqual(downs, 8, "вниз до упора: +3 − 8 = −5 октав");
  const bottom = mapping.range();
  assertEqual(bottom.basePitch, 0, "нижний кламп: MIDI 0 ≥ 0");
  assertEqual(rangeLabel(bottom), "C-1–B0", "HUD на нижнем клампе (MIDI 0 = C-1 в научной нотации)");
  assert(!mapping.shiftOctaves(-1), "ниже −5 сдвиг не меняется");

  for (const pitch of mapping.pitches()) {
    assert(pitch >= 0 && pitch <= 127, `питч ${pitch} в MIDI 0–127`);
  }
  console.log("  OK: сдвиг ограничен −5..+3, все питчи в MIDI 0–127");
}

// --- 5. Ноты вне охвата: колонки нет (не рисуются, ADR-006 п.6) ---

function testOutOfRange(): void {
  console.log("Ноты вне охвата:");
  const mapping = new PitchMapping();
  // Раскладка строится только из питчей маппинга — неефект notefield:
  // нота без колонки (layout.byPitch) не рисуется вовсе.
  const layout = computeKeyboardLayout(1400, 300, mapping.pitches());
  assertEqual(layout.keys.length, 24, "раскладка: 24 клавиши");
  for (const pitch of mapping.pitches()) {
    assert(layout.byPitch.has(pitch), `${pitchName(pitch)} имеет колонку`);
  }
  for (const outside of [58, 59, 84, 85, 96]) {
    assert(!layout.byPitch.has(outside), `${pitchName(outside)} вне охвата — колонки нет`);
  }
  console.log("  OK: колонки только у 24 нот охвата, соседние октавы — мимо");
}

async function main(): Promise<void> {
  testTable();
  testLabels();
  testRange();
  testClamps();
  testOutOfRange();
  console.log(`SMOKE OK: ${checks} проверок пройдено`);
}

try {
  await main();
} catch (error) {
  console.error("SMOKE FAIL:", error);
  throw error;
}
