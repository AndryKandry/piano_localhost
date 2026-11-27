/**
 * Типы «Азбуки» (SPEC §4.9, ADR-007): карточка (вопрос-данные + вид ответа),
 * урок (генератор серии карточек), итог урока, прогресс (localStorage,
 * версионирован — паттерн core/settings.ts: чтение всегда через
 * normalizePrimerProgress, битый/частичный JSON даёт дефолты).
 *
 * Карточки — чистые данные БЕЗ пикселей: что рисовать на нотном стане
 * описывает StaffItem, раскладку по x считает экран (screen.ts) через
 * notation/geometry. Терминология — GLOSSARY «Азбука».
 */
import type { GuitarNote } from "../core/fretboard";
import type { AccidentalKind, ClefKind, StaffDuration } from "../notation/geometry";

/**
 * Раздел Азбуки (GLOSSARY): «notation» — уроки по стану (звук по записанной
 * высоте), «guitar» — раздел «Гитара» (research 06: звук показа — звучащая
 * высота, октавой ниже записи; карточки с диаграммой грифа).
 */
export type PrimerSection = "notation" | "guitar";

/** Функция случайности генераторов карточек (в тестах — детерминированная). */
export type Rng = () => number;

// --- Что рисовать на нотном стане ---

/** Нота с длительностью (GLOSSARY: головка ноты, штиль, длительность). */
export interface StaffNote {
  kind: "note";
  /**
   * Питч, MIDI 0–127 (C4 = 60) — ЗВУЧАЩАЯ высота и ответ судьи: у ♭-нот он
   * на полтона ниже письменной буквы (D♭4 = 61 — рендер пишет её на D4 по
   * notation/geometry writtenPitch).
   */
  pitch: number;
  duration: StaffDuration;
  /**
   * Знак альтерации слева от головки (GLOSSARY: альтерация; уроки 10–11,
   * PIANO-14). Не задан — натуральная нота, существующие карточки не меняются.
   */
  accidental?: AccidentalKind;
  /** Подсветить сразу (обучающие карточки-факты). */
  highlight?: boolean;
}

/** Пауза (GLOSSARY: пауза — знак молчания той же длительности). */
export interface StaffRest {
  kind: "rest";
  duration: StaffDuration;
  highlight?: boolean;
}

/** Тактовая черта (GLOSSARY: такт — отрезок между тактовыми чертами). */
export interface StaffBarline {
  kind: "barline";
}

/** Размер (GLOSSARY: размер — дробь при ключе). */
export interface StaffTimeSignature {
  kind: "timeSignature";
  numerator: number;
  denominator: number;
}

export type StaffItem = StaffNote | StaffRest | StaffBarline | StaffTimeSignature;

// --- Вид ответа карточки ---

/** Ответ клавишей пианино (GLOSSARY: ответ клавишей): ожидаемый питч. */
export interface PitchAnswer {
  type: "pitch";
  pitch: number;
}

/** Ответ выбором: кнопки options, верная — correctIndex. */
export interface ChoiceAnswer {
  type: "choice";
  options: readonly string[];
  correctIndex: number;
}

export type PrimerAnswer = PitchAnswer | ChoiceAnswer;

// --- Карточка ---

/**
 * Карточка урока (GLOSSARY: карточка). answer = null — обучающая карточка-факт
 * без ответа (кнопка «Далее»); explanation — справка «почему», показывается
 * после ответа (у фактов — сразу).
 */
export interface PrimerCard {
  /** Вопрос карточки. */
  prompt: string;
  /** Содержимое нотного стана (без ключа — его рисует drawStaff). */
  staff: readonly StaffItem[];
  /** Справка после ответа: «Это G4 — вторая линия». */
  explanation: string;
  /** Ответ; null — факт, отвечает кнопкой «Далее». */
  answer: PrimerAnswer | null;
  /** Подпись под станом (имя ноты у «сыграй»-карточек). */
  label?: string;
  /**
   * Нота на грифе для диаграммы-подсказки (раздел «Гитара», research 06
   * §6 п.4). Явное значение перекрывает словарь I позиции — например B4 =
   * 3-я струна IV лад в уроке 3-й струны (в словаре B4 резолвится в
   * открытую 2-ю, research 06 §4). Не задано — диаграмма строится из питча
   * ответа клавишей.
   */
  fretboard?: GuitarNote | null;
  /**
   * Ключ стана карточки (GLOSSARY: басовый ключ): «bass» — басовый 𝄢,
   * определяет места нот на стане. Не задан — скрипичный 𝄞 (дефолт,
   * уроки 1–6 и «Гитара»).
   */
  clef?: ClefKind;
  /**
   * Знак альтерации подсветки верной ноты после вердикта (карточки «сыграй»
   * с альтерацией, уроки 10–11): стан пуст — верная нота дорисовывается по
   * питчу ответа, знак нужен чтобы она не выглядела натуральной. Не задан —
   * подсветка без знака (карточки 1–9).
   */
  answerAccidental?: AccidentalKind;
}

// --- Урок ---

/**
 * Урок — серия карточек одного навыка (GLOSSARY: урок). generate вызывается
 * при каждом старте урока: лёгкая рандомизация через rng (тесты подставляют
 * детерминированную функцию).
 */
export interface PrimerLesson {
  id: string;
  /** Порядковый номер в своей серии (нотные 1–11, гитарные Г1–Г6). */
  order: number;
  title: string;
  description: string;
  /** Раздел Азбуки; нет — «notation» (звук и метка карточек по умолчанию). */
  section?: PrimerSection;
  generate(rng: Rng): PrimerCard[];
}

// --- Итог и прогресс ---

/** Итог урока (GLOSSARY: следующий открывается при ≥80% правильных). */
export interface LessonResult {
  lessonId: string;
  /** % верных ответов, 0–100 (целое). */
  percent: number;
  correct: number;
  /** Ответных карточек в серии (факты не считаются). */
  total: number;
  /** Лучший стрик серии. */
  bestStreak: number;
  /** Урок пройден — открывает следующий. */
  passed: boolean;
}

/** Лучший процент по id урока (единственное хранимое состояние прогресса). */
export interface PrimerProgress {
  bestPercent: Readonly<Record<string, number>>;
}

export const PRIMER_VERSION = 1;
/** Порог прохождения урока (SPEC §4.9: следующий открывается при ≥80%). */
export const PRIMER_PASS_PERCENT = 80;

export const STORAGE_KEY = "piano.primer.progress";

/** Сырые данные хранилища → валидный прогресс с дефолтами. */
export function normalizePrimerProgress(raw: unknown): PrimerProgress {
  const src = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const rawBest = (typeof src.bestPercent === "object" && src.bestPercent !== null ? src.bestPercent : {}) as Record<
    string,
    unknown
  >;
  const bestPercent: Record<string, number> = {};
  for (const [id, value] of Object.entries(rawBest)) {
    const num = typeof value === "number" ? value : Number.NaN;
    if (Number.isFinite(num)) bestPercent[id] = Math.min(100, Math.max(0, Math.round(num)));
  }
  return { bestPercent };
}
