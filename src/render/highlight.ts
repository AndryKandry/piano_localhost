/**
 * Подсветка экранных клавиш (SPEC §4.1, инвариант GLOSSARY #5):
 *  - next  «жми-сейчас» (яркая): в wait-mode — следующая ожидаемая нота/аккорд,
 *          в обычном обучении — ноты нажимаемой партии в окне попадания;
 *  - auto  «автопартия» (мягкая): ненажимаемые ноты, звучащие сейчас;
 *  - pressed «нажато-мной» — уже есть от очереди 1 (KeyboardInput).
 *
 * Вычисляется чистой функцией от songTime каждый кадр.
 */
import type { Note } from "../core/types";
import { PARTY_COLORS } from "./colors";

export interface KeyHighlightInput {
  notes: readonly Note[];
  songTime: number;
  /** Нота принадлежит автопартии (в автоплее — все ноты). */
  isAuto: (note: Note) => boolean;
  /** Питчи ещё не сыгранных нот нажимаемой партии (состояние судьи). */
  pendingPlayable: ReadonlySet<number>;
  /** Питчи ожидаемой группы (wait-mode; пуст вне wait-mode). */
  expectedPitches: ReadonlySet<number>;
  waitMode: boolean;
  hitWindowSec: number;
}

export interface KeyHighlight {
  /** Питчи «жми-сейчас». */
  next: Set<number>;
  /** Питчи автопартии → цвет её партии (мягкая подсветка). */
  auto: Map<number, string>;
}

export function computeKeyHighlight(input: KeyHighlightInput): KeyHighlight {
  const next = new Set<number>();
  const auto = new Map<number, string>();

  if (input.waitMode && input.expectedPitches.size > 0) {
    for (const pitch of input.expectedPitches) next.add(pitch);
  }

  for (const note of input.notes) {
    const sounding = note.startTimeSec <= input.songTime && input.songTime < note.startTimeSec + note.durationSec;
    if (sounding && input.isAuto(note)) {
      auto.set(note.pitch, note.handPart === "right" ? PARTY_COLORS.right : PARTY_COLORS.left);
      continue;
    }
    if (
      !input.waitMode &&
      input.pendingPlayable.has(note.pitch) &&
      Math.abs(note.startTimeSec - input.songTime) <= input.hitWindowSec
    ) {
      next.add(note.pitch);
    }
  }

  return { next, auto };
}
