/**
 * Встроенная библиотека: компактный DSL → Melody (SPEC §4.5).
 * Формат на сетке долей (4/4 и любые другие размеры — просто числа долей):
 *   - строка нот: "C4 E4/0.5 F#4+G4/2 R/1" — токены через пробел, "+"
 *     собирает аккорд, "/доля" задаёт длительность (по умолчанию 1 доля),
 *     R — пауза; курсор идёт слева направо;
 *   - массив кортежей [pitch, beat, durBeats] — абсолютные доли.
 * Конвертер переводит доли в секунды по BPM мелодии (темп — свойство
 * композиции, GLOSSARY).
 */
import { DEFAULT_VELOCITY, type HandPart, type Melody, type Note } from "../core/types";
import { assembleMelody, ImportError } from "./shared";

const STEP_SEMITONES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/** Трек DSL: строка нот или кортежи [pitch, beat, durBeats]. */
export type BuiltinTrack =
  | { hand: HandPart; notes: string }
  | { hand: HandPart; notes: ReadonlyArray<readonly [number, number, number]> };

/** Описание встроенной мелодии (авторский аранж-файл). */
export interface BuiltinSpec {
  /** Короткий латинский идентификатор; в Melody становится `builtin:<id>`. */
  id: string;
  title: string;
  composer: string;
  bpm: number;
  tracks: BuiltinTrack[];
}

/** "C4", "F#3", "Bb2", "c4" → MIDI-номер. */
export function parsePitchName(name: string): number {
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name);
  if (!match) throw new ImportError(`Встроенная мелодия: неверное имя ноты «${name}».`);
  const semitone = STEP_SEMITONES[match[1].toUpperCase()];
  if (semitone === undefined) throw new ImportError(`Встроенная мелодия: неверная ступень «${name}».`);
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  const octave = Number(match[3]);
  return (octave + 1) * 12 + semitone + accidental;
}

/** Разбирает строку нот в кортежи [pitch, beat, durBeats] с бегущим курсором. */
export function parseNotesString(source: string): Array<readonly [number, number, number]> {
  const tuples: Array<readonly [number, number, number]> = [];
  let beat = 0;
  for (const rawToken of source.split(/\s+/)) {
    if (rawToken === "") continue;
    const [head, durText] = rawToken.split("/");
    const dur = durText === undefined ? 1 : Number(durText);
    if (!Number.isFinite(dur) || dur <= 0) {
      throw new ImportError(`Встроенная мелодия: неверная длительность в токене «${rawToken}».`);
    }
    if (head !== "R") {
      for (const pitchName of head.split("+")) {
        tuples.push([parsePitchName(pitchName), beat, dur]);
      }
    }
    beat += dur;
  }
  return tuples;
}

/** Собирает Melody из описания: доли → секунды по BPM. */
export function buildBuiltinMelody(spec: BuiltinSpec): Melody {
  const secPerBeat = 60 / spec.bpm;
  const notes: Note[] = [];
  for (const track of spec.tracks) {
    const tuples =
      typeof track.notes === "string" ? parseNotesString(track.notes) : track.notes;
    for (const [pitch, beat, durBeats] of tuples) {
      notes.push({
        pitch,
        startTimeSec: beat * secPerBeat,
        durationSec: durBeats * secPerBeat,
        handPart: track.hand,
        velocity: DEFAULT_VELOCITY,
      });
    }
  }
  if (notes.length === 0) {
    throw new ImportError(`Встроенная мелодия «${spec.title}» не содержит нот.`);
  }
  return assembleMelody({
    id: `builtin:${spec.id}`,
    title: spec.title,
    composer: spec.composer,
    notes,
    tempoMap: [{ timeSec: 0, bpm: spec.bpm }],
  });
}
