/**
 * Общие помощники слоя импорта (SPEC §5): ошибка разбора и сборка Melody
 * из нот и темповой карты. Форматы файлов сюда не проникают.
 */
import type { Melody, Note, TempoChange } from "../core/types";

/** Ошибка разбора файла: понятное сообщение для UI на русском. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

/** Дефолтный темп, когда в файле темпа нет (как у MIDI: 120 BPM). */
export const DEFAULT_BPM = 120;

/** Velocity живого разбора без данных о силе удара (MusicXML, встроенные). */
export const IMPORT_VELOCITY = 100;

export interface MelodyParts {
  id: string;
  title: string;
  composer: string;
  notes: Note[];
  tempoMap: TempoChange[];
  /** Порог сплита по питчу, если партии определены сплитом (см. Melody). */
  splitPoint?: number;
}

/** Приводит темповую карту к канону: сортировка, дедупликация, старт с 0 c. */
export function normalizeTempoMap(changes: TempoChange[]): TempoChange[] {
  if (changes.length === 0) return [{ timeSec: 0, bpm: DEFAULT_BPM }];
  const sorted = [...changes].sort((a, b) => a.timeSec - b.timeSec);
  const out: TempoChange[] = [];
  for (const change of sorted) {
    const last = out[out.length - 1];
    // Дубли темпа из разных партий в один момент времени — берём первый.
    if (last && Math.abs(last.timeSec - change.timeSec) < 0.01) continue;
    // Подряд идущий тот же темп не несёт информации.
    if (last && last.bpm === change.bpm && change.timeSec - last.timeSec < 0.02) continue;
    out.push({ timeSec: change.timeSec, bpm: change.bpm });
  }
  if (out[0].timeSec > 0) out.unshift({ timeSec: 0, bpm: out[0].bpm });
  return out;
}

/** Собирает Melody: сортирует ноты, считает длительность, канонизирует темпы. */
export function assembleMelody(parts: MelodyParts): Melody {
  const notes = [...parts.notes].sort(
    (a, b) => a.startTimeSec - b.startTimeSec || a.pitch - b.pitch,
  );
  let durationSec = 0;
  for (const note of notes) {
    durationSec = Math.max(durationSec, note.startTimeSec + note.durationSec);
  }
  const melody: Melody = {
    id: parts.id,
    title: parts.title,
    composer: parts.composer,
    notes,
    tempoMap: normalizeTempoMap(parts.tempoMap),
    durationSec,
  };
  if (parts.splitPoint !== undefined) melody.splitPoint = parts.splitPoint;
  return melody;
}

/** Обрезает velocity до MIDI-диапазона 1–127. */
export function clampVelocity(velocity: number): number {
  return Math.min(127, Math.max(1, Math.round(velocity)));
}

/** Проверка ноты перед сборкой: битые ноты из кривых файлов не пропускаем. */
export function isValidNote(note: Note): boolean {
  return (
    Number.isFinite(note.pitch) &&
    note.pitch >= 0 &&
    note.pitch <= 127 &&
    Number.isFinite(note.startTimeSec) &&
    Number.isFinite(note.durationSec) &&
    note.durationSec > 0
  );
}
