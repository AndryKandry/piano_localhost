/**
 * Внутренняя модель мелодии и общие типы (SPEC §5).
 * Импортёры (MIDI/MusicXML/встроенный JSON) выдают Melody;
 * плеер, рендер и звук потребляют её. Ничего про форматы файлов дальше слоя импорта.
 */

/** Партия руки (GLOSSARY: партия руки). */
export type HandPart = "right" | "left";

/**
 * Пресет (тембр) — инструмент звучания (GLOSSARY).
 * piano — сэмплы Splendid (audio/sampler.ts); epiano/guitar/strings/flute —
 * сэмплы soundfont-банка (audio/sfont.ts); organ/synthLead/bass — синтезаторные
 * голоса (audio/synth.ts). Список и имена — core/presets.ts (единый источник).
 */
export type PresetId =
  | "piano"
  | "epiano"
  | "guitar"
  | "strings"
  | "flute"
  | "organ"
  | "synthLead"
  | "bass";

/** Нота — каноничное представление (ADR-003 п.3). */
export interface Note {
  /** Питч, MIDI 0–127 (C4 = 60). */
  pitch: number;
  /** Момент начала в секундах от начала мелодии. */
  startTimeSec: number;
  /** Длительность в секундах. */
  durationSec: number;
  handPart: HandPart;
  /** Сила удара, MIDI velocity 1–127. */
  velocity: number;
}

/** Точка темповой карты: с момента timeSec действует темп bpm. */
export interface TempoChange {
  timeSec: number;
  bpm: number;
}

/** Размер такта (GLOSSARY: размер) — числитель/знаменатель, как пишут в нотах. */
export interface TimeSignature {
  /** Сколько долей в такте: метроном акцентирует каждую numerator-ю долю. */
  numerator: number;
  /** Какая нота равна доле (4 — четверть, 8 — восьмая); на длину тиков не влияет. */
  denominator: number;
}

/**
 * Дефолтный размер 4/4: файлы без размера (MIDI без meta 0x58, MusicXML без
 * <time>), встроенные мелодии и данные, сохранённые до PIANO-22.
 */
export const DEFAULT_TIME_SIGNATURE: TimeSignature = { numerator: 4, denominator: 4 };

/** Мелодия — то, что лежит в библиотеке и играет плеер. */
export interface Melody {
  id: string;
  title: string;
  composer: string;
  notes: Note[];
  tempoMap: TempoChange[];
  /**
   * Размер такта (PIANO-22): акценты метронома — каждая numerator-я доля.
   * Импортёры берут его из файла (MIDI meta 0x58, MusicXML <time>), при
   * отсутствии — 4/4 (assembleMelody ставит DEFAULT_TIME_SIGNATURE).
   */
  timeSignature: TimeSignature;
  /** Общая длительность в секундах (при множителе 1.0). */
  durationSec: number;
  /**
   * Порог сплита партий по питчу (MIDI-номер), если партии определены
   * автоматическим сплитом (ADR-003 п.4). Есть только когда руки не удалось
   * определить по имени трека или каналу; служит стартовым значением для
   * ручной коррекции в диалоге мелодии. Для MusicXML и встроенных мелодий
   * отсутствует — руки там закодированы явно.
   */
  splitPoint?: number;
}

/** Состояние загрузки пресета (сэмплы фортепиано грузятся с CDN). */
export type LoadState = "idle" | "loading" | "ready" | "error";

/** Текущий диапазон маппинга (для HUD и признака «нота вне маппинга», инвариант #4). */
export interface MappingRange {
  /** Нижний питч диапазона, включительно. */
  basePitch: number;
  /** Верхний питч диапазона, включительно. */
  topPitch: number;
}

/** Velocity живого ввода с клавиатуры: у клавиш ноутбука нет силы удара. */
export const DEFAULT_VELOCITY = 100;
