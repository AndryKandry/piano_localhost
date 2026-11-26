/**
 * Маппинг «физическая клавиша ↔ нота» — ОДНО место вычисления code → pitch
 * (инвариант GLOSSARY #3, SPEC §5). Связка «нота ↔ экранная клавиша ↔
 * физическая клавиша» всегда считается здесь, через текущий октавный сдвиг.
 *
 * База v3 (ADR-006, дополнено 2026-11-26): 3 полные октавы C4–B6, 36 нот,
 * хроматический ряд «как Virtual Piano». Таблица клавиш:
 *
 *   | Ряд            | Клавиши                           | Ноты              |
 *   |----------------|-----------------------------------|-------------------|
 *   | белые, окт. 4  | Tab Q W E R T Y U I O P [ ] \     | C4 … B5 (14)      |
 *   | белые, окт. 6  | B N M , . / Shift(правый)         | C6 … B6 (7)       |
 *   | чёрные, окт. 4–5 | 1 2 4 5 6 8 9 − = Del(⌫)        | C♯4 … A♯5 (10)    |
 *   | чёрные, окт. 6 | H J L ; '                         | C♯6 … A♯6 (5)     |
 *
 * Белый ряд продолжается хроматически в нижний буквенный ряд (B N M , . /
 * ShiftRight) — правый Shift сознательно замыкает его: геометрически стоит
 * над «/»; ShiftLeft остаётся свободным модификатором (не нота). Чёрные
 * третьей октавы — домашний ряд H J L ; ' (над B N M , . /). 3 и 7 в
 * цифровом ряду пропущены — между E–F и B–C чёрных нет. Tab — нота C4 по
 * явному решению игрока (ADR-006, пересмотр 2026-11-24): фокус-навигацией
 * игрок не пользуется, UI — мышью; Backquote освобождён (не нота).
 *
 * Резолв по `event.code` — работает при любой раскладке ОС (инвариант #1).
 */
import type { MappingRange } from "./types";
import { isBlackPitch, pitchName } from "./layout";

const WHITE_CODES = [
  // Октавы 4–5: верхний буквенный + Tab.
  "Tab",
  "KeyQ",
  "KeyW",
  "KeyE",
  "KeyR",
  "KeyT",
  "KeyY",
  "KeyU",
  "KeyI",
  "KeyO",
  "KeyP",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  // Октава 6: нижний буквенный ряд, правый Shift замыкает (ADR-006 v3).
  "KeyB",
  "KeyN",
  "KeyM",
  "Comma",
  "Period",
  "Slash",
  "ShiftRight",
] as const;
const BLACK_CODES = [
  // Октавы 4–5: цифровой ряд (3 и 7 пропущены — чёрных между E–F и B–C нет).
  "Digit1",
  "Digit2",
  "Digit4",
  "Digit5",
  "Digit6",
  "Digit8",
  "Digit9",
  "Minus",
  "Equal",
  "Backspace",
  // Октава 6: домашний ряд (ADR-006 v3).
  "KeyH",
  "KeyJ",
  "KeyL",
  "Semicolon",
  "Quote",
] as const;

/** База маппинга — C4 (GLOSSARY: C4 = MIDI 60). */
const BASE_PITCH = 60;
const MIDI_MIN = 0;
const MIDI_MAX = 127;

/** Подпись физической клавиши для экранной клавиши (ADR-006: «Tab», «[», «−», «Del»…). */
export function codeLabel(code: string): string {
  switch (code) {
    case "Backquote":
      return "`";
    case "BracketLeft":
      return "[";
    case "BracketRight":
      return "]";
    case "Backslash":
      return "\\";
    case "Minus":
      return "−"; // типографский минус — как на легенде хоткеев
    case "Equal":
      return "=";
    case "Backspace":
      return "Del";
    case "Comma":
      return ",";
    case "Period":
      return ".";
    case "Slash":
      return "/";
    case "Semicolon":
      return ";";
    case "Quote":
      return "'";
    case "ShiftRight":
      return "Shift"; // правый Shift — нота B6; левый остаётся модификатором
  }
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}

function buildBaseByCode(): Map<string, number> {
  const byCode = new Map<string, number>();
  let pitch = BASE_PITCH;
  let whiteIdx = 0;
  let blackIdx = 0;
  // Хроматическая прогулка от C4: белые коды — белым питчам, чёрные — чёрным.
  while (whiteIdx < WHITE_CODES.length || blackIdx < BLACK_CODES.length) {
    const black = isBlackPitch(pitch);
    if (black && blackIdx < BLACK_CODES.length) {
      byCode.set(BLACK_CODES[blackIdx], pitch);
      blackIdx += 1;
    } else if (!black && whiteIdx < WHITE_CODES.length) {
      byCode.set(WHITE_CODES[whiteIdx], pitch);
      whiteIdx += 1;
    }
    pitch += 1;
  }
  return byCode;
}

export class PitchMapping {
  private readonly baseByCode: ReadonlyMap<string, number>;
  private readonly minBase: number;
  private readonly maxBase: number;
  private shift = 0;

  constructor() {
    this.baseByCode = buildBaseByCode();
    let min = MIDI_MAX;
    let max = MIDI_MIN;
    for (const pitch of this.baseByCode.values()) {
      min = Math.min(min, pitch);
      max = Math.max(max, pitch);
    }
    this.minBase = min;
    this.maxBase = max;
  }

  /** Клавиша ноты? (для preventDefault, SPEC 4.2) */
  isNoteCode(code: string): boolean {
    return this.baseByCode.has(code);
  }

  /**
   * Октавный сдвиг: delta = -1 (Z, вниз) / +1 (X, вверх).
   * Кламп: все питчи маппинга остаются в MIDI 0–127.
   * Возвращает true, если сдвиг изменился.
   */
  shiftOctaves(delta: number): boolean {
    const maxDown = Math.floor(this.minBase / 12);
    const maxUp = Math.floor((MIDI_MAX - this.maxBase) / 12);
    const next = Math.min(maxUp, Math.max(-maxDown, this.shift + delta));
    if (next === this.shift) return false;
    this.shift = next;
    return true;
  }

  /** Питч физической клавиши при текущем сдвиге; null — клавиша вне маппинга. */
  pitchForCode(code: string): number | null {
    const base = this.baseByCode.get(code);
    return base === undefined ? null : base + this.shift * 12;
  }

  /** Все питчи текущего диапазона по возрастанию (для раскладки). */
  pitches(): number[] {
    const out: number[] = [];
    const min = this.minBase + this.shift * 12;
    const max = this.maxBase + this.shift * 12;
    for (let pitch = min; pitch <= max; pitch += 1) out.push(pitch);
    return out;
  }

  /** Подписи физ. клавиш по питчам текущего диапазона (для рендера). */
  labels(): Map<number, string> {
    const labels = new Map<number, string>();
    for (const [code, base] of this.baseByCode) {
      labels.set(base + this.shift * 12, codeLabel(code));
    }
    return labels;
  }

  /** Текущий диапазон: база «нота вне маппинга» (инвариант #4) и HUD. */
  range(): MappingRange {
    return {
      basePitch: this.minBase + this.shift * 12,
      topPitch: this.maxBase + this.shift * 12,
    };
  }
}

/** Человекочитаемый диапазон для HUD: «C4–F5». */
export function rangeLabel(range: MappingRange): string {
  return `${pitchName(range.basePitch)}–${pitchName(range.topPitch)}`;
}
