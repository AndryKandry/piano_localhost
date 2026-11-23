/**
 * Пересборка партий рук по порогу сплита (ADR-003 п.4, SPEC §4.4) — ручная
 * коррекция из диалога мелодии. Все функции работают с КОПИЯМИ: библиотечный
 * оригинал не мутируется, плеер получает свежий Melody.
 */
import type { HandPart, Melody, Note } from "../core/types";
import { SPLIT_MAX, SPLIT_MIN } from "../import/midi";

export { SPLIT_MAX, SPLIT_MIN };

/** Порог сплита держится в разумных границах C3–C5 (как при импорте MIDI). */
export function clampSplitPoint(value: number): number {
  if (!Number.isFinite(value)) return SPLIT_MIN;
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Math.round(value)));
}

/** Глубокая копия мелодии для плеера: store-оригинал остаётся нетронутым. */
export function cloneMelody(melody: Melody): Melody {
  return {
    ...melody,
    notes: melody.notes.map((note) => ({ ...note })),
    tempoMap: melody.tempoMap.map((change) => ({ ...change })),
  };
}

/** Новая мелодия с партиями по порогу: pitch < порога → левая рука (ADR-003 п.4). */
export function resplitMelody(melody: Melody, splitPoint: number): Melody {
  const point = clampSplitPoint(splitPoint);
  const notes = melody.notes.map(
    (note): Note => ({
      ...note,
      handPart: (note.pitch < point ? "left" : "right") as HandPart,
    }),
  );
  return { ...melody, notes, splitPoint: point };
}

export interface HandCounts {
  right: number;
  left: number;
}

/** Превью диалога: сколько нот уйдёт в каждую партию при данном пороге. */
export function countHandNotes(melody: Melody, splitPoint: number): HandCounts {
  const point = clampSplitPoint(splitPoint);
  let right = 0;
  let left = 0;
  for (const note of melody.notes) {
    if (note.pitch < point) left += 1;
    else right += 1;
  }
  return { right, left };
}
