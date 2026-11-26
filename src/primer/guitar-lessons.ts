/**
 * Гитарные уроки «Азбуки» — раздел «Гитара» (research 06): своя
 * последовательность Г1–Г6, независимая от нотных уроков 1–6 (src/primer/
 * lessons.ts). Прогресс — те же ключи «id урока → лучший %» (guitar-1..6),
 * цепочка гейтов своя: Г(n+1) открывается за Гn, нотные уроки на неё не
 * влияют.
 *
 * Порядок уроков — классическая школа (research 06 §2: Noad/Parkening/
 * Shearer/Werner): открытые струны → струны 1→6 внутри I позиции (лады 0–4),
 * «одна струна за раз», ноты по струнам сверху вниз; Г6 — проверка всего
 * словаря. Вопрос и ответ остаются «стан → роя» в ЗАПИСАННОЙ высоте — вся
 * механика Азбуки (судья, клавиатура карточек, прогресс) переиспользуется.
 *
 * Отличия раздела (research 06 §1, §6):
 * - звук показа ноты — звучащая высота soundingMidi = written − 12 (гитара —
 *   транспонирующий инструмент, звучит октавой ниже записи): cardSoundPitch;
 * - третий слой карточки — диаграмма грифа «струна.лад» (research 06 §3:
 *   паттерн квиз-тренажёров — две проекции, стан и гриф): fretboardHighlight.
 */
import {
  FIRST_POSITION_WRITTEN_HIGH,
  FIRST_POSITION_WRITTEN_LOW,
  soundingMidi,
  stringName,
  writtenToGuitar,
  type GuitarNote,
} from "../core/fretboard";
import { namedPitch, pick, shuffled } from "./lessons";
import type { PrimerCard, PrimerLesson, Rng, StaffItem } from "./types";

// --- Пулы питчей (записанные высоты, research 06 §1/§4) ---

/** Открытые струны (запись): E5 B4 G4 D4 A3 E3 — от 1-й струны к 6-й. */
const OPEN_STRINGS = [76, 71, 67, 62, 57, 52] as const;

/** 1-я струна, лады 0–4: E5 F5 F♯5 G5 G♯5. */
const STRING_1 = [76, 77, 78, 79, 80] as const;

/** 2-я струна, лады 0–4: B4 C5 C♯5 D5 D♯5. */
const STRING_2 = [71, 72, 73, 74, 75] as const;

/** 3-я и 4-я струны: G4 G♯4 A4 A♯4 B4(IV) + D4 D♯4 E4 F4 F♯4. */
const STRING_3_4 = [67, 68, 69, 70, 71, 62, 63, 64, 65, 66] as const;

/** 5-я и 6-я струны: A3 A♯3 B3 C4 C♯4 + E3 F3 F♯3 G3 G♯3. */
const STRING_5_6 = [57, 58, 59, 60, 61, 52, 53, 54, 55, 56] as const;

/** Вся I позиция: 29 записанных высот E3–G♯5 (диапазон непрерывен, §4). */
const FIRST_POSITION_ALL: readonly number[] = (() => {
  const pitches: number[] = [];
  for (let written = FIRST_POSITION_WRITTEN_LOW; written <= FIRST_POSITION_WRITTEN_HIGH; written += 1) {
    pitches.push(written);
  }
  return pitches;
})();

/**
 * Явные места на грифе, отличные от словаря I позиции: записанная B4 в уроке
 * 3-й струны — 3-я струна IV лад (тот же звук, что открытая 2-я; research 06
 * §4). В словаре B4 резолвится в открытую 2-ю — в уроках 1-й/2-й струн и в
 * проверке Г6 диаграмма покажет её по словарю, здесь — по подсказке карточки.
 */
const B4_ON_THIRD: GuitarNote = { string: 3, fret: 4 };
const STRING_3_4_HINTS: Readonly<Record<number, GuitarNote>> = { 71: B4_ON_THIRD };

/** Максимум ответных карточек на урок струн (пулы 5/10/29 → серия 5–8). */
const MAX_QUESTIONS = 8;

// --- Конструкторы карточек ---

const FRET_ROMAN = ["", "I", "II", "III", "IV"] as const;

/** Место ноты на грифе по-русски: «открытая 2-я струна», «3-я струна, IV лад». */
function guitarPlace(pitch: number, hint?: GuitarNote): string {
  const note = hint ?? writtenToGuitar(pitch);
  if (!note) throw new RangeError(`Питч ${pitch} вне I позиции — пулы уроков обязаны быть в словаре`);
  return note.fret === 0
    ? `открытая ${note.string}-я струна`
    : `${note.string}-я струна, ${FRET_ROMAN[note.fret] ?? ""} лад`;
}

/** Нота на стане → «какая струна?» — выбор номера кнопками 1–6 (Г1). */
function nameTheString(pitch: number): PrimerCard {
  const note = writtenToGuitar(pitch);
  if (!note) throw new RangeError(`Питч ${pitch} вне I позиции`);
  return {
    prompt: "Какая струна открыта? Выбери её номер",
    staff: [{ kind: "note", pitch, duration: "quarter" }],
    explanation: `Это ${namedPitch(pitch)} — открытая ${note.string}-я струна: звучит ${stringName(note.string)}, октавой ниже записи.`,
    // Номера струн — упорядоченный ряд, кнопки не перемешиваем (как доли такта).
    answer: { type: "choice", options: ["1", "2", "3", "4", "5", "6"], correctIndex: note.string - 1 },
    fretboard: note,
  };
}

/** Нота на стане → «сыграй эту открытую струну» — ответ клавишей (Г1). */
function playOpenString(pitch: number): PrimerCard {
  return {
    prompt: "Сыграй эту открытую струну на клавиатуре",
    staff: [{ kind: "note", pitch, duration: "quarter" }],
    explanation: `Это ${namedPitch(pitch)} — ${guitarPlace(pitch)}: звучит октавой ниже записи.`,
    answer: { type: "pitch", pitch },
    fretboard: writtenToGuitar(pitch),
  };
}

/** Нота на стане → «какая нота? нажми клавишу» — чтение записи (Г2–Г6). */
function readNote(pitch: number, hint?: GuitarNote): PrimerCard {
  return {
    prompt: "Какая нота на стане? Нажми её клавишу",
    staff: [{ kind: "note", pitch, duration: "quarter" }],
    explanation: `Это ${namedPitch(pitch)} — ${guitarPlace(pitch, hint)}.`,
    answer: { type: "pitch", pitch },
    fretboard: hint,
  };
}

/** Нота на стане → «сыграй» — мостик к основному режиму (Г2–Г6). */
function playStaffNote(pitch: number, hint?: GuitarNote): PrimerCard {
  return {
    prompt: "Сыграй ноту со стана на клавиатуре",
    staff: [{ kind: "note", pitch, duration: "quarter" }],
    explanation: `Это ${namedPitch(pitch)} — ${guitarPlace(pitch, hint)}.`,
    answer: { type: "pitch", pitch },
    fretboard: hint,
  };
}

// --- Факты (обучающие карточки без ответа, «Далее») ---

function g1Facts(): PrimerCard[] {
  const openNotes: StaffItem[] = OPEN_STRINGS.map((pitch) => ({ kind: "note", pitch, duration: "quarter" }));
  return [
    {
      prompt: "У гитары шесть струн",
      staff: openNotes,
      explanation:
        "Шесть струн, от тонкой 1-й до толстой 6-й; строй E–B–G–D–A–E. Здесь они записаны по порядку: E5, B4, G4, D4, A3, E3 — от 1-й струны к 6-й.",
      answer: null,
    },
    {
      prompt: "Гитара звучит октавой ниже записи",
      staff: [{ kind: "note", pitch: 76, duration: "quarter", highlight: true }],
      explanation:
        "Гитару записывают в скрипичном ключе, но звучит она октавой ниже записи: открытая 1-я струна записана E5, а слышится E4. Маленькую «8» под ключом обычно не пишут — октаву просто подразумевают.",
      answer: null,
      fretboard: { string: 1, fret: 0 },
    },
  ];
}

function g2Facts(): PrimerCard[] {
  const scale: StaffItem[] = STRING_1.map((pitch) => ({ kind: "note", pitch, duration: "quarter" }));
  return [
    {
      prompt: "1-я струна и I позиция",
      staff: scale,
      explanation:
        "Позиция — лад, в котором стоит 1-й палец; в I позиции доступны открытые струны (лад 0) и лады I–IV. 1-я струна — верхняя, самая тонкая: E5 (открытая), F5 (I лад), F♯5 (II), G5 (III), G♯5 (IV).",
      answer: null,
    },
  ];
}

function g3Facts(): PrimerCard[] {
  return [
    {
      prompt: "2-я струна: у B4 два места",
      staff: [{ kind: "note", pitch: 71, duration: "quarter", highlight: true }],
      explanation:
        "2-я струна: B4 (открытая), C5 (I лад), C♯5 (II), D5 (III), D♯5 (IV). B4 — единственная нота I позиции с двумя местами: открытая 2-я и 3-я струна IV лад. Школы играют её открытой 2-й — её и показывает диаграмма.",
      answer: null,
      fretboard: { string: 2, fret: 0 },
    },
  ];
}

function g4Facts(): PrimerCard[] {
  return [
    {
      prompt: "3-я и 4-я струны",
      staff: [
        { kind: "note", pitch: 67, duration: "quarter", highlight: true },
        { kind: "note", pitch: 62, duration: "quarter", highlight: true },
      ],
      explanation:
        "3-я струна открывается G4 (соль): G♯4 (I лад), A4 (II), A♯4 (III), B4 (IV). 4-я — D4 (ре): D♯4 (I), E4 (II), F4 (III), F♯4 (IV).",
      answer: null,
    },
  ];
}

function g5Facts(): PrimerCard[] {
  return [
    {
      prompt: "Низкие струны — под станом",
      staff: [{ kind: "note", pitch: 57, duration: "quarter", highlight: true }],
      explanation:
        "Записанные A3 и ниже живут на добавочных линейках снизу стана: A3 — вторая линейка, E3 — под третьей. 5-я струна: A3 (открытая), A♯3 (I), B3 (II), C4 (III), C♯4 (IV). 6-я: E3 (открытая), F3 (I), F♯3 (II), G3 (III), G♯3 (IV). Звучат они октавой ниже записи.",
      answer: null,
      fretboard: { string: 5, fret: 0 },
    },
  ];
}

function g6Facts(): PrimerCard[] {
  return [
    {
      prompt: "Вся I позиция: 29 нот",
      staff: [
        { kind: "note", pitch: 52, duration: "quarter", highlight: true },
        { kind: "note", pitch: 64, duration: "quarter" },
        { kind: "note", pitch: 76, duration: "quarter" },
        { kind: "note", pitch: 80, duration: "quarter" },
      ],
      explanation:
        "Проверка: от E3 (6-я открытая) до G♯5 (1-я струна IV лад) — 29 записанных высот, каждая на своём месте «струна.лад». Перед ответом вспомни и струну, и лад.",
      answer: null,
    },
  ];
}

// --- Генераторы уроков ---

/** Г1: все шесть открытых струн, вперемешку «какая струна?» и «сыграй». */
function generateG1(rng: Rng): PrimerCard[] {
  const picks = shuffled(rng, OPEN_STRINGS);
  const last = picks[picks.length - 1];
  const extra = pick(
    rng,
    OPEN_STRINGS.filter((pitch) => pitch !== last),
  );
  const questions: PrimerCard[] = picks.map((pitch, i) => (i % 2 === 0 ? nameTheString(pitch) : playOpenString(pitch)));
  questions.push(rng() < 0.5 ? nameTheString(extra) : playOpenString(extra));
  return [...g1Facts(), ...questions];
}

/**
 * Урок струн Г2–Г6: перемешанный пул (до MAX_QUESTIONS карточек), первая
 * половина — «какая нота», вторая — «сыграй». hints перекрывают словарь
 * диаграммы (B4 = 3-я струна IV лад в уроке 3-й струны).
 */
function guitarStringLesson(
  pool: readonly number[],
  facts: PrimerCard[],
  hints: Readonly<Record<number, GuitarNote>> = {},
) {
  return (rng: Rng): PrimerCard[] => {
    const asked = shuffled(rng, pool).slice(0, Math.min(MAX_QUESTIONS, pool.length));
    const readCount = Math.ceil(asked.length / 2);
    const questions = asked.map((pitch, i) => (i < readCount ? readNote(pitch, hints[pitch]) : playStaffNote(pitch, hints[pitch])));
    return [...facts, ...questions];
  };
}

/**
 * Уроки раздела «Гитара» в порядке прохождения (research 06 §6 п.3);
 * следующий открывается при ≥80% — гейты считаются по этому списку.
 */
export const GUITAR_LESSONS: readonly PrimerLesson[] = [
  {
    id: "guitar-1",
    order: 1,
    section: "guitar",
    title: "Открытые струны",
    description: "Шесть струн: запись в скрипичном ключе, звучит октавой ниже («8» не пишут)",
    generate: generateG1,
  },
  {
    id: "guitar-2",
    order: 2,
    section: "guitar",
    title: "1-я струна, лады 0–4",
    description: "E5, F5, F♯5, G5, G♯5 — I позиция: открытая струна и лады I–IV",
    generate: guitarStringLesson(STRING_1, g2Facts()),
  },
  {
    id: "guitar-3",
    order: 3,
    section: "guitar",
    title: "2-я струна",
    description: "B4, C5, C♯5, D5, D♯5; дубликат B4: открытая 2-я вместо 3-й IV лад",
    generate: guitarStringLesson(STRING_2, g3Facts()),
  },
  {
    id: "guitar-4",
    order: 4,
    section: "guitar",
    title: "3-я и 4-я струны",
    description: "G4–B4 (3-я; здесь B4 = IV лад) и D4–F♯4 (4-я)",
    generate: guitarStringLesson(STRING_3_4, g4Facts(), STRING_3_4_HINTS),
  },
  {
    id: "guitar-5",
    order: 5,
    section: "guitar",
    title: "5-я и 6-я струны",
    description: "A3–C♯4 (5-я) и E3–G♯3 (6-я) — добавочные линейки снизу стана",
    generate: guitarStringLesson(STRING_5_6, g5Facts()),
  },
  {
    id: "guitar-6",
    order: 6,
    section: "guitar",
    title: "Вся I позиция",
    description: "Проверка: 29 нот словаря от E3 (6-я открытая) до G♯5 (1-я IV лад)",
    generate: guitarStringLesson(FIRST_POSITION_ALL, g6Facts()),
  },
];

// --- Чистые хелпы раздела (экран и смоук) ---

/**
 * Нота на грифе для диаграммы карточки (research 06 §6 п.4): явная подсказка
 * карточки (fretboard) перекрывает словарь; не задана — словарь I позиции по
 * питчу ответа клавишей. Факты и карточки-выбор без подсказки дают null
 * (чистый гриф без кружка).
 */
export function fretboardHighlight(card: PrimerCard): GuitarNote | null {
  if (card.fretboard !== undefined) return card.fretboard ?? null;
  const pitch = card.answer?.type === "pitch" ? card.answer.pitch : null;
  return pitch === null ? null : writtenToGuitar(pitch);
}

/**
 * Питч звучания показа карточки: гитарные уроки играют soundingMidi — гитара
 * звучит октавой ниже записи (research 06 §1, §6 п.2), иначе гитарный тембр
 * будет на октаву выше реального инструмента; нотные уроки — записанную
 * высоту. Ответ роя судится по записанной высоте в обоих разделах.
 */
export function cardSoundPitch(lesson: Pick<PrimerLesson, "section">, writtenPitch: number): number {
  return lesson.section === "guitar" ? soundingMidi(writtenPitch) : writtenPitch;
}
