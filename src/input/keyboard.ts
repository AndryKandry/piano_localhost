/**
 * Слушатель физической клавиатуры (SPEC 4.2): event.code → нота (инвариант #1),
 * фильтр event.repeat, реестр зажатых, preventDefault на клавишах маппинга
 * + Space, Z/X — октавный сдвиг, Space — педаль.
 *
 * Tab — нота C4 по решению игрока (ADR-006, пересмотр 2026-11-24):
 * фокус-навигация отключена (preventDefault на клавишах маппинга), UI — мышью.
 */
import type { PitchMapping } from "../core/mapping";
import { DEFAULT_VELOCITY } from "../core/types";

export interface KeyboardInputCallbacks {
  /** Нота нажата (velocity — MIDI 1–127). */
  onNoteOn(pitch: number, velocity: number): void;
  /** Нота отпущена. */
  onNoteOff(pitch: number): void;
  /** Октавный сдвиг изменился: зажатые ноты сброшены, диапазон другой. */
  onShiftChanged(): void;
  /** Педаль Space изменила состояние. */
  onPedalChanged(down: boolean): void;
}

const PEDAL_CODE = "Space";
const SHIFT_DOWN_CODE = "KeyZ";
const SHIFT_UP_CODE = "KeyX";

/**
 * Фокус в поле ввода (слайдер/список/выбор цвета панели, очередь 4) — игровые
 * клавиши молчат: ноты не играются, Space не жмёт педаль, preventDefault не
 * рушит нативное поведение полей. Ключи-события панелей (F1 и т.п.) гейтятся
 * в своих слушателях.
 */
function isTypingTarget(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  const tag = active.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || active.isContentEditable;
}

export class KeyboardInput {
  /** Реестр зажатых: code → питч, под которым нота была нажата. */
  private readonly pressedCodes = new Map<string, number>();
  private spaceDown = false;
  private attached = false;

  constructor(
    private readonly mapping: PitchMapping,
    private readonly cb: KeyboardInputCallbacks,
  ) {}

  attach(target: Window = window): void {
    if (this.attached) return;
    target.addEventListener("keydown", this.handleKeyDown);
    target.addEventListener("keyup", this.handleKeyUp);
    this.attached = true;
  }

  detach(target: Window = window): void {
    target.removeEventListener("keydown", this.handleKeyDown);
    target.removeEventListener("keyup", this.handleKeyUp);
    this.attached = false;
  }

  /** Питчи зажатых сейчас нот — для подсветки экранных клавиш. */
  pressedPitches(): Set<number> {
    return new Set(this.pressedCodes.values());
  }

  get pedalDown(): boolean {
    return this.spaceDown;
  }

  /**
   * Сбросить реестр без звука (window.blur, сдвиг октавы). Звук глушит
   * движок: его allNotesOff идёт отдельным вызовом.
   */
  releaseAll(): void {
    this.pressedCodes.clear();
    if (this.spaceDown) {
      this.spaceDown = false;
      this.cb.onPedalChanged(false);
    }
  }

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (isTypingTarget()) return; // панели: ввод в полях не должен играть ноты
    if (e.altKey) return; // Alt+буква — хоткеи приложения (ADR-006), не ноты
    const code = e.code;
    const ours =
      code === PEDAL_CODE || code === SHIFT_DOWN_CODE || code === SHIFT_UP_CODE || this.mapping.isNoteCode(code);
    if (ours) e.preventDefault();
    if (e.repeat) return; // автоповтор ОС не должен переигрывать ноту (SPEC 4.2)

    if (code === PEDAL_CODE) {
      if (!this.spaceDown) {
        this.spaceDown = true;
        this.cb.onPedalChanged(true);
      }
      return;
    }
    if (code === SHIFT_DOWN_CODE) {
      this.applyShift(-1);
      return;
    }
    if (code === SHIFT_UP_CODE) {
      this.applyShift(1);
      return;
    }

    const pitch = this.mapping.pitchForCode(code);
    if (pitch === null) return;
    if (this.pressedCodes.has(code)) return; // страховка к фильтру repeat
    this.pressedCodes.set(code, pitch);
    this.cb.onNoteOn(pitch, DEFAULT_VELOCITY);
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    const code = e.code;
    if (code === PEDAL_CODE) {
      if (this.spaceDown) {
        this.spaceDown = false;
        this.cb.onPedalChanged(false);
      }
      return;
    }
    const pitch = this.pressedCodes.get(code);
    if (pitch === undefined) return;
    this.pressedCodes.delete(code);
    this.cb.onNoteOff(pitch);
  };

  /** Сдвиг октавы: питчи всех клавиш сместились — зажатое сбрасываем. */
  private applyShift(delta: number): void {
    if (!this.mapping.shiftOctaves(delta)) return;
    this.releaseAll();
    this.cb.onShiftChanged();
  }
}
