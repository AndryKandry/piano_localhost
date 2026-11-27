/**
 * Чистая геометрия нотного стана для «Азбуки» (ADR-007, research 05):
 * позиции нот, y-координаты, штили, добавочные линейки, раскладка такта.
 * БЕЗ канваса и DOM — проверяется в node (scripts/smoke-notation.ts).
 *
 * Единицы. Позиция на стане — половина межлинейного расстояния: чётные
 * позиции — линии (0 — нижняя, 4 — средняя, 8 — верхняя), нечётные —
 * промежутки. Ключ задаёт нижнюю линию (GLOSSARY: скрипичный ключ,
 * басовый ключ): в скрипичном E4 (MIDI 64), в басовом G2 (MIDI 43);
 * функции принимают clef с дефолтом «treble» — существующие вызовы
 * не меняются. Каждая позиция = один диатонический шаг; альтерированные
 * ноты стоят на позиции своей ПИСЬМЕННОЙ буквы (GLOSSARY: альтерация):
 * ♯ и ♮ наследуют букву питча, ♭ — букву на полтона выше (writtenPitch).
 *
 * Все функции, работающие в пикселях, принимают staffSpace (межлинейное
 * расстояние, CSS-px) и staffTop (y верхней линии) явно — рендер
 * подставляет свой масштаб, прикладная логика может считать без канваса.
 */

/** Длительность карточки азбуки (GLOSSARY: длительность). */
export type StaffDuration = "whole" | "half" | "quarter" | "eighth";

/** Направление штиля (GLOSSARY: штиль). */
export type StemDirection = "up" | "down";

/** Ключ стана (GLOSSARY: скрипичный ключ, басовый ключ): «treble» 𝄞 / «bass» 𝄢. */
export type ClefKind = "treble" | "bass";

/** Знак альтерации (GLOSSARY: диез/бемоль/бекар): ♯ вверх, ♭ вниз, ♮ отмена. */
export type AccidentalKind = "sharp" | "flat" | "natural";

/** Число линий стана. */
export const STAFF_LINE_COUNT = 5;
/** Позиция нижней линии. */
export const BOTTOM_LINE_POS = 0;
/** Позиция средней линии. */
export const MIDDLE_LINE_POS = 4;
/** Позиция верхней линии. */
export const TOP_LINE_POS = 8;
/** Скрипичный ключ ставится своей точкой отсчёта на линию G4 (SMuFL: baseline = referenced pitch). */
export const CLEF_BASELINE_POS = 2;
/** Басовый ключ — своей точкой отсчёта на четвёртую линию F3 (SMuFL fClef: baseline = referenced pitch). */
export const F_CLEF_BASELINE_POS = 6;

/** Кодпоинты ключей (SMuFL PUA, research 05 §1.1): ключ → глиф (Bravura cmap проверен). */
export const CLEF_CODEPOINTS: Record<ClefKind, number> = { treble: 0xe050, bass: 0xe062 } as const;

/** Позиция числителя размера: верхняя половина стана (цифра 0.5 em, центрирована на baseline). */
export const TIMESIG_NUMERATOR_POS = 6;
/** Позиция знаменателя размера: нижняя половина стана. */
export const TIMESIG_DENOMINATOR_POS = 2;

/**
 * Толщины и длины в межлинейных — `engravingDefaults` метаданных шрифта
 * Bravura (research 05 §5) плюс нотографическая практика длины штиля
 * (Gould/MuseScore: ровно 3.5 межлинейных, спекой SMuFL не фиксируется).
 */
export const STAFF_LINE_THICKNESS_SPACES = 0.13;
export const STEM_THICKNESS_SPACES = 0.12;
export const STEM_LENGTH_SPACES = 3.5;
export const BEAM_THICKNESS_SPACES = 0.5;
export const BEAM_SPACING_SPACES = 0.25;
export const LEDGER_THICKNESS_SPACES = 0.16;
export const LEDGER_EXTENSION_SPACES = 0.4;
export const THIN_BARLINE_THICKNESS_SPACES = 0.16;

/** Кодпоинты флага восьмой (SMuFL PUA, research 05 §1.1): направление штиля → глиф. */
export const FLAG_CODEPOINTS = { up: 0xe240, down: 0xe241 } as const;

/**
 * Кодпоинты знаков альтерации (SMuFL accidentalSharp/Flat/Natural): знак →
 * глиф. Присутствие в Bravura проверено разбором cmap woff2
 * (tmp-скрипт задачи PIANO-14): U+E262, U+E260, U+E261 — все есть.
 */
export const ACCIDENTAL_CODEPOINTS: Record<AccidentalKind, number> = {
  sharp: 0xe262,
  flat: 0xe260,
  natural: 0xe261,
} as const;

/** Длительность в четвертных долях — для пропорциональной раскладки такта. */
export const DURATION_BEATS: Record<StaffDuration, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
};

/** Буква (C=0…B=6) каждого полутона октавы: диезы наследуют букву нижней натуральной. */
const LETTER_BY_PITCH_CLASS: readonly number[] = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
/** Полутоны натуральных букв C,D,E,F,G,A,B от начала октавы. */
const NATURAL_SEMITONES: readonly number[] = [0, 2, 4, 5, 7, 9, 11];
/** Диатонический индекс нижней линии стана (E4): октава 4 × 7 + буква E(2) = 30. */
const BOTTOM_LINE_DIATONIC = 30;
/** Диатонический индекс нижней линии басового стана (G2): октава 2 × 7 + буква G(4) = 18. */
const BOTTOM_LINE_DIATONIC_BASS = 18;

/** Диатонический индекс нижней линии стана для ключа (скрипичный: E4, басовый: G2). */
function bottomLineDiatonic(clef: ClefKind): number {
  return clef === "bass" ? BOTTOM_LINE_DIATONIC_BASS : BOTTOM_LINE_DIATONIC;
}

/**
 * Позиция ноты на стане (в полпробела от нижней линии) для питча MIDI.
 * Скрипичный: E4 → 0 (нижняя линия), G4 → 2, B4 → 4 (средняя), F5 → 8
 * (верхняя), C4 → −2 (первая добавочная линейка снизу).
 * Басовый: G2 → 0, F3 → 6 (линия ключа), A3 → 8 (верхняя), C4 → 10
 * (первая добавочная сверху).
 */
export function pitchToStaffPos(pitch: number, clef: ClefKind = "treble"): number {
  const octave = Math.floor(pitch / 12) - 1;
  const letter = LETTER_BY_PITCH_CLASS[((pitch % 12) + 12) % 12];
  return octave * 7 + letter - bottomLineDiatonic(clef);
}

/**
 * Питч ПИСЬМЕННОЙ позиции ноты (GLOSSARY: альтерация): ♯ и ♮ пишутся на
 * позиции своей натуральной буквы (сама нота — диезы схлопываются в букву
 * уже в pitchToStaffPos), ♭ — на позиции буквы НА ПОЛТОНА ВЫШЕ: D♭4 звучит
 * 61, но пишется на D4 (62). Позиция на стане — pitchToStaffPos от этого
 * питча; y, штиль и добавочные линейки ноты считаются от него же.
 */
export function writtenPitch(pitch: number, accidental: AccidentalKind | null | undefined): number {
  return accidental === "flat" ? pitch + 1 : pitch;
}

/** Обратно: натуральный питч (MIDI) позиции на стане. Диезы схлопываются в натуральную букву. */
export function staffPosToPitch(pos: number, clef: ClefKind = "treble"): number {
  const diatonic = pos + bottomLineDiatonic(clef);
  const octave = Math.floor(diatonic / 7);
  const letter = diatonic - octave * 7;
  return (octave + 1) * 12 + (NATURAL_SEMITONES[letter] ?? 0);
}

/** y-координата ноты: baseline глифа головки (SMuFL регистрирует головку центром на baseline). */
export function pitchToY(pitch: number, staffTop: number, staffSpace: number, clef: ClefKind = "treble"): number {
  return staffTop + (TOP_LINE_POS - pitchToStaffPos(pitch, clef)) * (staffSpace / 2);
}

/** Обратно (для кликов по стану, очередь 2): округляет к ближайшей линии/промежутку. */
export function yToPitch(y: number, staffTop: number, staffSpace: number, clef: ClefKind = "treble"): number {
  const bottomY = staffTop + (TOP_LINE_POS * staffSpace) / 2;
  const pos = Math.round((bottomY - y) / (staffSpace / 2));
  return staffPosToPitch(pos, clef);
}

/**
 * Направление штиля (практика Gould/MuseScore, research 05 §5): на средней
 * линии и выше — вниз, ниже — вверх. Сравнение по позиции на стане (для
 * ключа карточки), чтобы альтерированные ноты наследовали направление
 * своей буквы.
 */
export function stemDirection(pitch: number, clef: ClefKind = "treble"): StemDirection {
  return pitchToStaffPos(pitch, clef) >= MIDDLE_LINE_POS ? "down" : "up";
}

/** Длина штиля в px: 3.5 межлинейных (октава) — Gould/MuseScore. */
export function stemLengthPx(staffSpace: number): number {
  return STEM_LENGTH_SPACES * staffSpace;
}

/** y кончика штиля (там же точка посадки флага восьмой). */
export function stemTipY(pitch: number, staffTop: number, staffSpace: number, clef: ClefKind = "treble"): number {
  const y = pitchToY(pitch, staffTop, staffSpace, clef);
  const len = stemLengthPx(staffSpace);
  return stemDirection(pitch, clef) === "up" ? y - len : y + len;
}

/**
 * Позиции добавочных линеек для позиции на стане (пусто — линейки не нужны).
 * Правило: крайний промежуток за станом (D4 снизу, G5 сверху) живёт без
 * линеек; дальше линейка на каждой линии от стана до ноты включительно,
 * а промежуточная нота-«промежуток» обрамляется линейками сверху и снизу
 * (B5 → линейки A5 и C6). Проверено на C4/B3/A3/B5/C6 в smoke.
 */
export function ledgerPositions(pos: number): number[] {
  if (pos >= BOTTOM_LINE_POS - 1 && pos <= TOP_LINE_POS + 1) return [];
  const out: number[] = [];
  if (pos < BOTTOM_LINE_POS) {
    const last = pos % 2 === 0 ? pos : pos - 1;
    for (let p = BOTTOM_LINE_POS - 2; p >= last; p -= 2) out.push(p);
  } else {
    const last = pos % 2 === 0 ? pos : pos + 1;
    for (let p = TOP_LINE_POS + 2; p <= last; p += 2) out.push(p);
  }
  return out;
}

/** y-координаты добавочных линеек ноты (короткие, через головку — рисует рендер). */
export function ledgerLineYs(pitch: number, staffTop: number, staffSpace: number, clef: ClefKind = "treble"): number[] {
  return ledgerPositions(pitchToStaffPos(pitch, clef)).map((pos) => staffTop + (TOP_LINE_POS - pos) * (staffSpace / 2));
}

/**
 * Позиция baseline паузы (SMuFL: baseline пауз — их дефолтное место на стане,
 * кроме целой: «should hang» — висит под второй линией сверху). Классика:
 * целая висит с линии в 0.5 межлинейного под верхней (позиция 6), остальные
 * стоят на средней линии (позиция 4).
 */
export function restBaselinePos(duration: StaffDuration): number {
  return duration === "whole" ? 6 : MIDDLE_LINE_POS;
}

/** Слот элемента такта: x — центр (точка головки/паузы), width — ширина слота. */
export interface MeasureSlot {
  x: number;
  width: number;
}

/**
 * Тактовая геометрия: x-координаты последовательности элементов внутри такта.
 * Слоты делят [xStart, xStart+width] пропорционально длительностям
 * (четверть — одна доля, целая — четыре). Тактовая черта ставится в
 * xStart + width (renderer.drawBarline). Пустой список → пустой массив.
 */
export function layoutMeasure(durations: readonly StaffDuration[], xStart: number, width: number): MeasureSlot[] {
  if (durations.length === 0 || !(width > 0)) return [];
  const totalBeats = durations.reduce((sum, d) => sum + DURATION_BEATS[d], 0);
  const slots: MeasureSlot[] = [];
  let cursor = xStart;
  for (const duration of durations) {
    const slotWidth = (width * DURATION_BEATS[duration]) / totalBeats;
    slots.push({ x: cursor + slotWidth / 2, width: slotWidth });
    cursor += slotWidth;
  }
  return slots;
}
