/**
 * Импорт MusicXML → Melody (ADR-003 п.5): свой DOMParser-экстрактор,
 * OSMD (1.4 MB рендерер нотных листов) не берём — он про отрисовку, не про ноты.
 *
 * Покрытие (базовое, растёт по нужде): score-partwise и score-timewise,
 * attributes/divisions, размер <time> (beats/beat-type, PIANO-22), тактовые
 * backup/forward, паузы, аккорды (<chord/>), питч step+alter+octave → MIDI,
 * рука из <staff> (1=правая, 2=левая), голос <voice> как запасной сигнал,
 * темп из <sound tempo="..."> (дефолт 120).
 */
import type { HandPart, Melody, Note, TempoChange, TimeSignature } from "../core/types";
import {
  DEFAULT_BPM,
  IMPORT_VELOCITY,
  assembleMelody,
  ImportError,
  isValidNote,
  type MelodyParts,
} from "./shared";

const STEP_SEMITONES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

export interface MusicXmlImportOptions {
  fallbackTitle?: string;
  composer?: string;
}

function textOf(parent: Element, tag: string): string | undefined {
  const text = parent.getElementsByTagName(tag)[0]?.textContent?.trim();
  return text !== undefined && text !== "" ? text : undefined;
}

function intOf(parent: Element, tag: string): number | undefined {
  const text = textOf(parent, tag);
  if (text === undefined) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/** step + alter + octave → MIDI-номер (C4 = 60). */
export function pitchToMidi(step: string, alter: number, octave: number): number {
  const semitone = STEP_SEMITONES[step.toUpperCase()];
  if (semitone === undefined) {
    throw new ImportError(`Нота с неизвестной ступенью «${step}».`);
  }
  return (octave + 1) * 12 + semitone + alter;
}

/** Рука из <staff>: верхний нотоносец — правая, нижний — левая. */
function handFromStaff(staff: number | undefined): HandPart | undefined {
  if (staff === 1) return "right";
  if (staff === 2) return "left";
  return undefined;
}

/** Рука из <voice> — запасной сигнал: нечётный голос правый, чётный левый. */
function handFromVoice(voice: number | undefined): HandPart | undefined {
  if (voice === undefined) return undefined;
  return voice % 2 === 1 ? "right" : "left";
}

/** Партия по индексу <part> — последний запас: первая правая, вторая левая. */
function handFromPartIndex(index: number): HandPart {
  return index === 1 ? "left" : "right";
}

/**
 * Накопитель времени одной <part>: позиция в тиках + якорь (момент, где
 * действует текущий темп) в секундах. Длительности — тики/divisions × доля.
 */
class PartTimeline {
  private positionTicks = 0;
  private anchorTicks = 0;
  private anchorSec = 0;
  private lastNoteStartTicks = 0;
  private bpm = DEFAULT_BPM;
  divisions = 1;

  /** Секунды для произвольной тиковой позиции (относительно якоря темпа). */
  secondsAtTicks(ticks: number): number {
    const beats = (ticks - this.anchorTicks) / this.divisions;
    return this.anchorSec + beats * (60 / this.bpm);
  }

  /** Секунды текущей позиции курсора. */
  secondsAt(): number {
    return this.secondsAtTicks(this.positionTicks);
  }

  /**
   * Начало очередной <note>: не-аккорд запоминает свою позицию как точку
   * старта (аккордные ноты будут разделять её), аккорд — берёт её же.
   */
  beginNote(isChord: boolean): number {
    if (!isChord) this.lastNoteStartTicks = this.positionTicks;
    return this.lastNoteStartTicks;
  }

  /** Длительность в тиках → секунды при текущем темпе. */
  ticksToSeconds(ticks: number): number {
    return (ticks / this.divisions) * (60 / this.bpm);
  }

  /** Смена темпа в текущей точке: вернуть момент и перебазировать якорь. */
  applyTempo(bpm: number): number {
    const now = this.secondsAt();
    this.bpm = bpm;
    this.anchorTicks = this.positionTicks;
    this.anchorSec = now;
    return now;
  }

  advance(ticks: number): void {
    this.positionTicks += ticks;
  }
}

function readComposer(root: Element): string | undefined {
  for (const creator of Array.from(root.getElementsByTagName("creator"))) {
    if (creator.getAttribute("type") === "composer") {
      const text = creator.textContent?.trim();
      if (text) return text;
    }
  }
  return undefined;
}

/**
 * Размер такта из первого <attributes><time> партитуры (PIANO-22): пара
 * <beats>/<beat-type>, как у «3/4» → {3, 4}. Составные размеры (несколько
 * <beats> подряд) не разбираем — берём первую пару. Нет/битое → undefined
 * (assembleMelody поставит 4/4).
 */
function readTimeSignature(root: Element): TimeSignature | undefined {
  const time = root.getElementsByTagName("time")[0];
  if (!time) return undefined;
  const numerator = intOf(time, "beats");
  const denominator = intOf(time, "beat-type");
  if (
    numerator === undefined || denominator === undefined ||
    !Number.isInteger(numerator) || !Number.isInteger(denominator)
  ) {
    return undefined;
  }
  return { numerator, denominator };
}

/**
 * Разбирает MusicXML (строка) во внутреннюю модель. Бросает ImportError
 * с указанием места, если XML битый, это не MusicXML или нот нет.
 */
export function parseMusicXml(source: string, options: MusicXmlImportOptions = {}): Melody {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(source, "application/xml");
  } catch {
    throw new ImportError("Не удалось прочитать файл как XML.");
  }
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    // Текст ошибки разбора обычно содержит строку и столбец проблемного места.
    throw new ImportError(`XML повреждён: ${parserError.textContent?.trim() ?? "ошибка разбора"}`);
  }
  const root = doc.documentElement;
  const isPartwise = root.tagName === "score-partwise";
  const isTimewise = root.tagName === "score-timewise";
  if (!isPartwise && !isTimewise) {
    throw new ImportError(
      "Это не MusicXML: корневой элемент должен быть <score-partwise> или <score-timewise>.",
    );
  }

  const notes: Note[] = [];
  const tempoChanges: TempoChange[] = [];
  const timelines = new Map<string, PartTimeline>(); // для timewise: шкала на часть

  const walkContainer = (container: Element, hand: HandPart, timeline: PartTimeline): void => {
    for (const element of Array.from(container.children)) {
      switch (element.tagName) {
        case "attributes": {
          const divisions = intOf(element, "divisions");
          if (divisions !== undefined && divisions > 0) timeline.divisions = divisions;
          break;
        }
        case "direction":
        case "sound": {
          const sound = element.tagName === "sound" ? element : element.getElementsByTagName("sound")[0];
          const tempoText = sound?.getAttribute("tempo");
          const tempo = tempoText === null || tempoText === undefined ? undefined : Number(tempoText);
          if (tempo !== undefined && Number.isFinite(tempo) && tempo > 0) {
            tempoChanges.push({ timeSec: timeline.applyTempo(tempo), bpm: tempo });
          }
          break;
        }
        case "backup":
          timeline.advance(-1 * (intOf(element, "duration") ?? 0));
          break;
        case "forward":
          timeline.advance(intOf(element, "duration") ?? 0);
          break;
        case "note": {
          const note = readNote(element, timeline, hand);
          if (note) notes.push(note);
          break;
        }
        default:
          break;
      }
    }
  };

  if (isPartwise) {
    // part > measure > note; у части своя шкала времени.
    Array.from(root.getElementsByTagName("part")).forEach((part, partIndex) => {
      const timeline = new PartTimeline();
      const hand = handFromPartIndex(partIndex);
      for (const measure of Array.from(part.getElementsByTagName("measure"))) {
        walkContainer(measure, hand, timeline);
      }
    });
  } else {
    // timewise: measure > part > note; части идентифицируем по id/порядку.
    Array.from(root.getElementsByTagName("measure")).forEach((measure) => {
      Array.from(measure.getElementsByTagName("part")).forEach((part, partIndex) => {
        const key = part.getAttribute("id") ?? `#index-${partIndex}`;
        const timeline = timelines.get(key) ?? new PartTimeline();
        timelines.set(key, timeline);
        walkContainer(part, handFromPartIndex(partIndex), timeline);
      });
    });
  }

  if (notes.length === 0) {
    throw new ImportError("В MusicXML-файле нет нот (только паузы или пустые части).");
  }

  const parts: MelodyParts = {
    id: "",
    title: options.fallbackTitle ?? "Мелодия",
    composer: options.composer ?? "Неизвестный композитор",
    notes: notes.filter(isValidNote),
    tempoMap: tempoChanges,
  };
  const title = textOf(root, "work-title") ?? textOf(root, "movement-title");
  if (title) parts.title = title;
  const composer = readComposer(root);
  if (composer) parts.composer = composer;
  const timeSignature = readTimeSignature(root);
  if (timeSignature !== undefined) parts.timeSignature = timeSignature;
  return assembleMelody(parts);
}

/** Разбирает один <note>: пауза двигает курсор без ноты, аккорд не двигает. */
function readNote(
  element: Element,
  timeline: PartTimeline,
  fallbackHand: HandPart,
): Note | undefined {
  // Грация: без <duration>, курсор не двигает — в модель не попадает.
  if (element.getElementsByTagName("grace").length > 0) return undefined;
  const isRest = element.getElementsByTagName("rest").length > 0;
  const isChord = element.getElementsByTagName("chord").length > 0;
  const durationTicks = intOf(element, "duration") ?? 0;
  // Аккордная нота начинается с позиции предыдущей ноты и курсор не двигает.
  const startTicks = timeline.beginNote(isChord);
  const startSec = timeline.secondsAtTicks(startTicks);

  if (!isChord) timeline.advance(durationTicks);
  if (isRest || durationTicks <= 0) return undefined;

  const pitchElement = element.getElementsByTagName("pitch")[0];
  if (!pitchElement) return undefined; // <unpitched> и прочее — не партия руки
  const step = textOf(pitchElement, "step");
  const octave = intOf(pitchElement, "octave");
  if (step === undefined || octave === undefined) {
    const measureNo = element.closest("measure")?.getAttribute("number") ?? "?";
    throw new ImportError(`Нота без <step>/<octave> в такте ${measureNo}.`);
  }
  const alter = intOf(pitchElement, "alter") ?? 0;

  const staff = intOf(element, "staff");
  const voice = intOf(element, "voice");
  const hand = handFromStaff(staff) ?? handFromVoice(voice) ?? fallbackHand;

  return {
    pitch: pitchToMidi(step, alter, octave),
    startTimeSec: startSec,
    durationSec: timeline.ticksToSeconds(durationTicks),
    handPart: hand,
    velocity: IMPORT_VELOCITY,
  };
}
