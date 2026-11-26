/**
 * Импорт MIDI → Melody (ADR-003 п.1–4).
 * Загрузка только через конструктор: new Midi(arrayBuffer) — статических
 * fromString/fromArrayBuffer у @tonejs/midi нет. Время нот уже в секундах
 * (посчитано библиотекой по tempo-карте), свои тики→секунды не пишем.
 * Партия руки — каскад: имя MIDI-трека → канал → сплит по питчу.
 */
import { Midi } from "@tonejs/midi";
import type { HandPart, Melody, Note, TempoChange, TimeSignature } from "../core/types";
import {
  assembleMelody,
  clampVelocity,
  ImportError,
  isValidNote,
  type MelodyParts,
} from "./shared";

/** Правая рука в имени трека (рус/англ): melody/верх и т.п. */
const RIGHT_NAME = /right|прав|melody|верх/i;
/** Левая рука в имени трека: bass/accomp/лев и т.п. */
const LEFT_NAME = /left|лев|bass|accomp/i;
/** Историческая конвенция каналов (research 02): левая = 3, правая = 4. */
const LEFT_CHANNEL = 3;
const RIGHT_CHANNEL = 4;

/**
 * Размер такта из первого meta-события 0x58 (PIANO-22). @tonejs/midi собирает
 * события всех треков и сортирует по тикам (Header.update), `timeSignature` —
 * [числитель, знаменатель] числами (знаменатель уже 2^dd из SMF-байтов):
 * 0x58 03 02 → [3, 4]. Нет событий или мусор в числах — undefined (4/4).
 */
function readTimeSignature(events: ReadonlyArray<{ timeSignature: number[] }>): TimeSignature | undefined {
  const first = events[0]?.timeSignature;
  if (!Array.isArray(first) || first.length < 2) return undefined;
  const [numerator, denominator] = first as [number, number];
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) return undefined;
  return { numerator, denominator };
}

/** Разброс питчей (P90−P10), с которого считаем, что руки вперемешку. */
const SPLIT_SPREAD_SEMITONES = 24;
/** Границы разумного порога сплита: C3–C5 (переиспользуются диалогом сплита). */
export const SPLIT_MIN = 48;
export const SPLIT_MAX = 72;

export interface MidiImportOptions {
  /** Заголовок, если в файле имени нет (обычно имя файла без расширения). */
  fallbackTitle?: string;
  composer?: string;
}

/** Партия руки по имени MIDI-трека (каскад, шаг 1). */
function handFromName(name: string): HandPart | undefined {
  if (RIGHT_NAME.test(name)) return "right";
  if (LEFT_NAME.test(name)) return "left";
  return undefined;
}

/** Партия руки по каналу трека (каскад, шаг 2). */
function handFromChannel(channel: number): HandPart | undefined {
  if (channel === LEFT_CHANNEL) return "left";
  if (channel === RIGHT_CHANNEL) return "right";
  return undefined;
}

/**
 * Порог сплита по питчу (каскад, шаг 3): по умолчанию C4=60; если разброс
 * питчей большой (руки явно вперемешку) — медиана распределения.
 */
export function pickSplitPoint(pitches: number[]): number {
  if (pitches.length < 8) return 60;
  const sorted = [...pitches].sort((a, b) => a - b);
  const quantile = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const spread = quantile(0.9) - quantile(0.1);
  if (spread < SPLIT_SPREAD_SEMITONES) return 60;
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Math.round(quantile(0.5))));
}

/**
 * Разбирает MIDI-файл (уже прочитанный ArrayBuffer) во внутреннюю модель.
 * Бросает ImportError с понятным сообщением: файл битый или без нот.
 */
export function parseMidi(buffer: ArrayBuffer, options: MidiImportOptions = {}): Melody {
  if (buffer.byteLength < 14) {
    throw new ImportError("Файл слишком маленький: это не MIDI.");
  }
  let midi: Midi;
  try {
    midi = new Midi(buffer);
  } catch {
    throw new ImportError("Не удалось разобрать MIDI-файл: структура повреждена.");
  }

  const tempoMap: TempoChange[] = midi.header.tempos.map((tempo) => ({
    timeSec: tempo.time ?? 0,
    bpm: tempo.bpm,
  }));

  // Каскад: ноты трека с именем/каналом получают партию сразу;
  // остальные собираются в общий пул и делятся сплитом по питчу.
  const named: Note[] = [];
  const unassignedRaw: Array<{ pitch: number; time: number; duration: number; velocity: number }> = [];

  for (const track of midi.tracks) {
    // Перкуссия (каналы 9/10) — не партия руки, в пианино не попадает.
    if (track.instrument.percussion) continue;
    const byName = handFromName(track.name);
    const byChannel = byName === undefined ? handFromChannel(track.channel) : undefined;
    for (const note of track.notes) {
      const hand = byName ?? byChannel;
      if (hand !== undefined) {
        named.push({
          pitch: note.midi,
          startTimeSec: note.time,
          durationSec: note.duration,
          handPart: hand,
          velocity: clampVelocity(note.velocity * 127),
        });
      } else {
        unassignedRaw.push({
          pitch: note.midi,
          time: note.time,
          duration: note.duration,
          velocity: note.velocity,
        });
      }
    }
  }

  let splitPoint: number | undefined;
  if (unassignedRaw.length > 0) {
    splitPoint = pickSplitPoint(unassignedRaw.map((n) => n.pitch));
    for (const raw of unassignedRaw) {
      named.push({
        pitch: raw.pitch,
        startTimeSec: raw.time,
        durationSec: raw.duration,
        handPart: raw.pitch < splitPoint ? "left" : "right",
        velocity: clampVelocity(raw.velocity * 127),
      });
    }
  }

  const notes = named.filter(isValidNote);
  if (notes.length === 0) {
    throw new ImportError("В MIDI-файле нет нот (только перкуссия или пустые треки).");
  }

  const parts: MelodyParts = {
    id: "",
    title: options.fallbackTitle ?? "Мелодия",
    composer: options.composer ?? "Неизвестный композитор",
    notes,
    tempoMap,
  };
  if (midi.header.name.trim() !== "") parts.title = midi.header.name.trim();
  const timeSignature = readTimeSignature(midi.header.timeSignatures);
  if (timeSignature !== undefined) parts.timeSignature = timeSignature;
  if (splitPoint !== undefined) parts.splitPoint = splitPoint;
  return assembleMelody(parts);
}
