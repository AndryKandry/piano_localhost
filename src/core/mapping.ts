/**
 * Маппинг «физическая клавиша ↔ нота» — ОДНО место вычисления code → pitch
 * (инвариант GLOSSARY #3, SPEC §5). Связка «нота ↔ экранная клавиша ↔
 * физическая клавиша» всегда считается здесь, через текущий октавный сдвиг.
 *
 * База v2 (ADR-006): 2 полные октавы C4–B5, 24 ноты, хроматический ряд
 * «как Virtual Piano». Белые — `` ` Q W E R T Y U I O P [ ] \ `` слева
 * направо, чёрные — `1 2 4 5 6 8 9 − = Del` (цифровой ряд; 3 и 7 пропущены —
 * между E–F и B–C чёрных нет). Tab — НЕ нота: перехват ломает
 * фокус-навигацию (a11y); C4 живёт на Backquote — соседняя позиция.
 *
 * Резолв по `event.code` — работает при любой раскладке ОС (инвариант #1).
 */
import type { MappingRange } from "./types";
import { isBlackPitch, pitchName } from "./layout";

const WHITE_CODES = [
  "Backquote",
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
] as const;
const BLACK_CODES = [
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
] as const;

/** База маппинга — C4 (GLOSSARY: C4 = MIDI 60). */
const BASE_PITCH = 60;
const MIDI_MIN = 0;
const MIDI_MAX = 127;

/** Подпись физической клавиши для экранной клавиши (ADR-006: «`», «[», «−», «Del»…). */
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
