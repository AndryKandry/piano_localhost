/**
 * Единая функция раскладки клавиш (ADR-004 п.3): источник геометрии и для
 * рендера клавиш, и для колонок нот — колонка всегда над своей клавишей.
 */

const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

/** Чёрная клавиша — по классу питча (C#=1, D#=3, F#=6, G#=8, A#=10). */
export function isBlackPitch(pitch: number): boolean {
  return BLACK_PITCH_CLASSES.has(((pitch % 12) + 12) % 12);
}

const PITCH_CLASS_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/** Имя ноты в научной нотации: C4 = MIDI 60 (GLOSSARY). */
export function pitchName(pitch: number): string {
  const name = PITCH_CLASS_NAMES[((pitch % 12) + 12) % 12];
  const octave = Math.floor(pitch / 12) - 1;
  return `${name}${octave}`;
}

/** Чёрная клавиша — доля ширины белой (ADR-004). */
export const BLACK_WIDTH_RATIO = 0.6;
/** Чёрная клавиша — доля высоты белой (ADR-004: ~60–65%). */
export const BLACK_HEIGHT_RATIO = 0.62;

/** Геометрия одной экранной клавиши в CSS-пикселях канваса. */
export interface KeyGeometry {
  pitch: number;
  isBlack: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Полная раскладка диапазона. */
export interface KeyboardLayout {
  /** CSS-ширина/высота канваса, под которую считалась раскладка. */
  width: number;
  height: number;
  whiteWidth: number;
  /** Белые — по возрастанию питча, чёрные поверх них. */
  keys: KeyGeometry[];
  byPitch: ReadonlyMap<number, KeyGeometry>;
}

/**
 * Раскладка диапазона питчей на канвас CSS-размером width×height.
 * Белые — равной ширины; чёрные — 0.6× ширины белой, 62% высоты,
 * центрированы на границе соседних белых («absolute по границам белых»).
 */
export function computeKeyboardLayout(width: number, height: number, pitches: readonly number[]): KeyboardLayout {
  const sorted = [...pitches].sort((a, b) => a - b);
  const whites = sorted.filter((p) => !isBlackPitch(p));
  const blackCount = Math.max(1, whites.length);
  const whiteWidth = width / blackCount;

  const keys: KeyGeometry[] = [];
  const whiteX = new Map<number, number>();
  whites.forEach((pitch, i) => {
    const x = i * whiteWidth;
    whiteX.set(pitch, x);
    keys.push({ pitch, isBlack: false, x, y: 0, width: whiteWidth, height });
  });

  const blackWidth = whiteWidth * BLACK_WIDTH_RATIO;
  const blackHeight = height * BLACK_HEIGHT_RATIO;
  for (const pitch of sorted) {
    if (!isBlackPitch(pitch)) continue;
    const rightX = whiteX.get(pitch + 1);
    const leftX = whiteX.get(pitch - 1);
    let x: number;
    if (rightX !== undefined) {
      // Центр на левой границе правой соседней белой.
      x = rightX - blackWidth / 2;
    } else if (leftX !== undefined) {
      // Крайний случай: чёрная без правой белой — прижимаем к правой границе левой.
      x = leftX + whiteWidth - blackWidth / 2;
    } else {
      continue; // Чёрная без белых соседей — не бывает в валидном диапазоне.
    }
    keys.push({ pitch, isBlack: true, x, y: 0, width: blackWidth, height: blackHeight });
  }

  const byPitch = new Map<number, KeyGeometry>();
  for (const key of keys) byPitch.set(key.pitch, key);

  return { width, height, whiteWidth, keys, byPitch };
}
