/**
 * Уроки «Азбуки» (SPEC §4.9): 9 последовательных уроков — стан и скрипичный
 * ключ, первая октава, вторая октава, длительности, паузы, такты и размеры,
 * басовый ключ, малая октава в басовом ключе, оба ключа (PIANO-13).
 *
 * Каждый урок — генератор серии карточек: 1–2 обучающих факта в начале
 * (без ответа, «Далее») + ответные карточки. Рандомизация лёгкая: какой питч
 * спросить / какой размер дать; rng внедряется (тесты подставляют
 * детерминированную функцию, в рантайме — Math.random). Термины — GLOSSARY
 * «Азбука»: нотный стан, скрипичный ключ, басовый ключ, длительность,
 * пауза, такт, размер, малая октава.
 */
import { pitchName, pitchNameRuFull, pitchNameRuStep } from "../core/layout";
import { pitchToStaffPos, type ClefKind, type StaffDuration } from "../notation/geometry";
import type { ChoiceAnswer, PrimerCard, PrimerLesson, Rng, StaffItem } from "./types";

// --- Случайность (используется и гитарными уроками guitar-lessons.ts) ---

/** Случайный элемент (по rng). */
export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)] as T;
}

/** Перемешанная копия (Фишер—Йетс по rng). */
export function shuffled<T>(rng: Rng, arr: readonly T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i] as T;
    copy[i] = copy[j] as T;
    copy[j] = tmp;
  }
  return copy;
}

/** Кнопки выбора: верный вариант + отвлекающие, порядок перемешан. */
function shuffledOptions(rng: Rng, correct: string, distractors: readonly string[]): ChoiceAnswer {
  const options = shuffled(rng, [correct, ...distractors]);
  return { type: "choice", options, correctIndex: options.indexOf(correct) };
}

// --- Справочники объяснений ---

const ALL_DURATIONS: readonly StaffDuration[] = ["whole", "half", "quarter", "eighth"];

/** Русское имя длительности (GLOSSARY: длительность). */
const DURATION_NAME: Record<StaffDuration, string> = {
  whole: "целая",
  half: "половинная",
  quarter: "четверть",
  eighth: "восьмая",
};

/** Вариант для кнопок выбора (с заглавной). */
const DURATION_NAME_CAP: Record<StaffDuration, string> = {
  whole: "Целая",
  half: "Половинная",
  quarter: "Четверть",
  eighth: "Восьмая",
};

/** Вид ноты — объяснение «почему это именно эта длительность». */
const DURATION_SHAPE: Record<StaffDuration, string> = {
  whole: "пустая головка без штиля",
  half: "пустая головка со штилем",
  quarter: "заполненная головка со штилем",
  eighth: "заполненная головка, у штиля — флаг",
};

/** Сколько долей: согласование «4 доли / 2 доли / 1 долю / ½ доли». */
const DURATION_BEATS_PHRASE: Record<StaffDuration, string> = {
  whole: "4 доли",
  half: "2 доли",
  quarter: "1 долю",
  eighth: "½ доли",
};

/** Счёт вслух (SPEC §4.9: 1 / 1-2 / та-та / ти-ти). */
const DURATION_COUNT_ALOUD: Record<StaffDuration, string> = {
  whole: "„1“",
  half: "„1-2“",
  quarter: "„та“",
  eighth: "„ти-ти“",
};

const ORDINAL_FEM = ["первая", "вторая", "третья", "четвёртая", "пятая"] as const;
/** Те же порядковые в творительном (под/над чем): «промежуток под первой добавочной». */
const ORDINAL_FEM_INSTR = ["первой", "второй", "третьей", "четвёртой", "пятой"] as const;
const ORDINAL_MASC = ["первый", "второй", "третий", "четвёртый"] as const;

/**
 * Человекочитаемая позиция на стане (GLOSSARY: позиция на стане) для справки.
 * Позиция — относительно нижней линии КЛЮЧА карточки (pitchToStaffPos с clef).
 * За станом: чётные позиции — добавочные линейки, нечётные — промежутки,
 * обрамлённые соседними линейками («промежуток под/над N-й добавочной»).
 */
export function staffPositionName(pos: number): string {
  if (pos >= 0 && pos <= 8) {
    if (pos % 2 === 0) return `${ORDINAL_FEM[pos / 2]} линия`;
    return `${ORDINAL_MASC[(pos - 1) / 2]} промежуток`;
  }
  if (pos === -1) return "промежуток под станом";
  if (pos === 9) return "промежуток над станом";
  if (pos < -1) {
    const ordinal = -pos % 2 === 0 ? -pos / 2 : (-pos - 1) / 2; // -2/-3 → первая, -4/-5 → вторая
    return -pos % 2 === 0
      ? `${ORDINAL_FEM[ordinal - 1]} добавочная линейка снизу`
      : `промежуток под ${ORDINAL_FEM_INSTR[ordinal - 1]} добавочной снизу`;
  }
  const ordinal = pos % 2 === 0 ? (pos - 8) / 2 : (pos - 9) / 2; // 10/11 → первая, 12/13 → вторая
  return pos % 2 === 0
    ? `${ORDINAL_FEM[ordinal - 1]} добавочная линейка сверху`
    : `промежуток над ${ORDINAL_FEM_INSTR[ordinal - 1]} добавочной сверху`;
}

// --- Конструкторы карточек ---

/** Западное имя + русская ступень в скобках: «B4 (си)» (GLOSSARY). */
export function namedPitch(pitch: number): string {
  return `${pitchName(pitch)} (${pitchNameRuStep(pitch)})`;
}

/**
 * Нота на стане → «нажми клавишу» (GLOSSARY: ответ клавишей). Позиция в
 * справке — относительно нижней линии ключа карточки.
 */
function nameTheNote(pitch: number, clef: ClefKind = "treble"): PrimerCard {
  return {
    prompt: "Какая нота на стане? Нажми её клавишу",
    staff: [{ kind: "note", pitch, duration: "quarter" }],
    explanation: `Это ${namedPitch(pitch)} — ${staffPositionName(pitchToStaffPos(pitch, clef))}.`,
    answer: { type: "pitch", pitch },
    clef,
  };
}

/** Имя ноты → «сыграй» (GLOSSARY: ответ клавишей, мостик к основному режиму). */
function playTheNote(pitch: number, clef: ClefKind = "treble"): PrimerCard {
  return {
    prompt: `Сыграй на клавиатуре ноту ${namedPitch(pitch)}`,
    staff: [],
    explanation: `Это ${namedPitch(pitch)} — ${staffPositionName(pitchToStaffPos(pitch, clef))}.`,
    answer: { type: "pitch", pitch },
    label: namedPitch(pitch),
    clef,
  };
}

/** Питчи для карточек длительностей/пауз: красивые позиции на стане, все в маппинге. */
const DURATION_PITCHES = [64, 67, 71, 72, 76, 79] as const;

/** Нота/пауза на стане → выбор из 4 кнопок (имя длительности или число долей). */
function durationQuestion(rng: Rng, isRest: boolean): PrimerCard {
  const duration = pick(rng, ALL_DURATIONS);
  const staffPitch = pick(rng, DURATION_PITCHES);
  const what: StaffItem = isRest ? { kind: "rest", duration } : { kind: "note", pitch: staffPitch, duration };
  const subject = isRest ? `пауза` : `нота`;
  const askBeats = rng() < 0.35;
  if (askBeats) {
    const verb = isRest ? "молчит" : "звучит";
    return {
      prompt: isRest ? "Сколько долей молчит эта пауза?" : "Сколько долей звучит эта нота?",
      staff: [what],
      explanation: `Это ${DURATION_NAME[duration]} ${subject} — ${verb} ${DURATION_BEATS_PHRASE[duration]}. Счёт вслух: ${DURATION_COUNT_ALOUD[duration]}.`,
      answer: shuffledOptions(rng, DURATION_BEATS_PHRASE[duration], ["4 доли", "2 доли", "1 долю", "½ доли"].filter(
        (option) => option !== DURATION_BEATS_PHRASE[duration],
      )),
    };
  }
  return {
    prompt: isRest ? "Какая это пауза?" : "Какая это длительность?",
    staff: [what],
    explanation: isRest
      ? `Это ${DURATION_NAME[duration]} пауза — молчание ${DURATION_BEATS_PHRASE[duration]}.`
      : `Это ${DURATION_NAME[duration]}: ${DURATION_SHAPE[duration]}.`,
    answer: shuffledOptions(
      rng,
      DURATION_NAME_CAP[duration],
      ALL_DURATIONS.map((d) => DURATION_NAME_CAP[d]).filter((name) => name !== DURATION_NAME_CAP[duration]),
    ),
  };
}

/** Наполнение такта по размеру: все варианты дают ровно numer долей по четверти. */
const FOUR_FOUR_CONTENTS: readonly StaffDuration[][] = [
  ["quarter", "quarter", "quarter", "quarter"],
  ["half", "half"],
  ["whole"],
];
const THREE_FOUR_CONTENTS: readonly StaffDuration[][] = [
  ["quarter", "quarter", "quarter"],
  ["half", "quarter"],
];

function contentToText(content: readonly StaffDuration[]): string {
  const key = content.join("+");
  switch (key) {
    case "quarter+quarter+quarter+quarter":
      return "четыре четверти";
    case "half+half":
      return "две половинные";
    case "whole":
      return "целая";
    case "quarter+quarter+quarter":
      return "три четверти";
    case "half+quarter":
      return "половинная и четверть";
    default:
      return content.join(", ");
  }
}

/** Такт с нотами → сколько долей / какой размер — выбор (GLOSSARY: такт, размер). */
function measureQuestion(rng: Rng): PrimerCard {
  const numer = pick(rng, [3, 4]);
  const content = pick(rng, numer === 4 ? FOUR_FOUR_CONTENTS : THREE_FOUR_CONTENTS);
  const notes: StaffItem[] = content.map((duration) => ({ kind: "note", pitch: 67, duration }));
  const askSignature = rng() < 0.5;
  if (askSignature) {
    return {
      prompt: "Какой размер у этого такта?",
      staff: [...notes, { kind: "barline" }],
      explanation: `В такте ${contentToText(content)} — итого ${numer} доли по четверти, значит размер ${numer}/4.`,
      answer: shuffledOptions(rng, `${numer}/4`, ["4/4", "3/4", "2/4", "6/8"].filter((option) => option !== `${numer}/4`)),
    };
  }
  return {
    prompt: "Сколько долей в этом такте?",
    staff: [{ kind: "timeSignature", numerator: numer, denominator: 4 }, ...notes, { kind: "barline" }],
    explanation: `Размер ${numer}/4 — в такте ${numer} доли; здесь они заполнены так: ${contentToText(content)}.`,
    answer: shuffledOptions(rng, String(numer), ["4", "3", "2", "6"].filter((option) => option !== String(numer))),
  };
}

// --- Пулы питчей (все в маппинге C4–B5, инвариант GLOSSARY #4) ---

/** Ноты первой октавы C4–B4 (натуральные). */
const FIRST_OCTAVE = [60, 62, 64, 65, 67, 69, 71] as const;
/** Ноты второй октавы C5–B5 (натуральные). */
const SECOND_OCTAVE = [72, 74, 76, 77, 79, 81, 83] as const;
/** Ноты на линиях/промежутках стана для урока 1 (E4–B4, без добавочных). */
const WITHIN_STAFF = [64, 65, 67, 69, 71] as const;

// --- Пулы уроков басового ключа (PIANO-13, уроки 7–9; позиции — bass, G2 = нижняя линия) ---

/**
 * Непрерывная гамма басового стана G2–B3 (натуральные, позиции 0–9: линии
 * G2 B2 D3 F3 A3, промежутки A2 C3 E3 G3, над станом — B3) — рисунок факта
 * урока 7. G2, A2, B2 — большая октава, играются сдвигом Z дважды.
 */
const BASS_SCALE = [43, 45, 47, 48, 50, 52, 53, 55, 57, 59] as const;

/** Пул вопросов урока 7: линии G2 B2 D3 F3 A3, промежутки C3 E3 G3, над станом B3. */
const BASS_STAFF_NOTES = [43, 47, 48, 50, 52, 53, 55, 57, 59] as const;

/** Малая октава C3–B3 (GLOSSARY: малая октава) — пул урока 8, все играются сдвигом Z один раз. */
const SMALL_OCTAVE = [48, 50, 52, 53, 55, 57, 59] as const;

/**
 * Пограничные ноты урока 9 «Оба ключа»: одна высота — два места на стане.
 * G3 — четвёртый промежуток басового / под второй добавочной скрипичного;
 * B3 — над станом / под первой добавочной; C4 — первая добавочная сверху
 * басового / снизу скрипичного («средняя до»); D4 — над первой добавочной
 * басового / под станом скрипичного; E4 — вторая добавочная басового /
 * нижняя линия скрипичного.
 */
const BOTH_CLEFS_PITCHES = [55, 59, 60, 62, 64] as const;

// --- Факты (обучающие карточки без ответа, «Далее») ---

function lesson1Facts(): PrimerCard[] {
  return [
    {
      prompt: "Это нотный стан",
      staff: [],
      explanation:
        "Нотный стан — пять линий и четыре промежутка. Ноты записываются на линиях и в промежутках; линии считают снизу вверх.",
      answer: null,
    },
    {
      prompt: "Это скрипичный ключ",
      staff: [{ kind: "note", pitch: 67, duration: "quarter", highlight: true }],
      explanation:
        "Скрипичный ключ стоит в начале стана: его завиток указывает на вторую линию — там живёт G4 (соль), она подсвечена.",
      answer: null,
    },
  ];
}

function lesson2Facts(): PrimerCard[] {
  const scale: StaffItem[] = FIRST_OCTAVE.map((pitch) => ({ kind: "note", pitch, duration: "quarter" }));
  return [
    {
      prompt: "Первая октава на стане: C4–B4",
      staff: scale,
      explanation: `Ноты первой октавы: ${FIRST_OCTAVE.map(namedPitch).join(" ")}. Каждая ступень вверх — следующая нота. C4 — ${pitchNameRuFull(60)}, на добавочной линейке под станом; B4 — ${pitchNameRuFull(71)}, на средней линии.`,
      answer: null,
    },
    {
      prompt: "Добавочные линейки",
      staff: [{ kind: "note", pitch: 60, duration: "quarter", highlight: true }],
      explanation: `Добавочные линейки — короткие линейки для нот вне пяти линий стана. ${namedPitch(60)} живёт на первой добавочной линейке снизу — это ${pitchNameRuFull(60)}, она подсвечена.`,
      answer: null,
    },
  ];
}

function lesson3Facts(): PrimerCard[] {
  const scale: StaffItem[] = SECOND_OCTAVE.map((pitch) => ({ kind: "note", pitch, duration: "quarter" }));
  return [
    {
      prompt: "Вторая октава на стане: C5–B5",
      staff: scale,
      explanation: `Вторая октава — ноты от ${pitchNameRuFull(72)} до ${pitchNameRuFull(83)} — выше первой: C5 (до) — промежуток над средней линией, F5 (фа) — верхняя линия; выше стана — добавочные линейки сверху.`,
      answer: null,
    },
    {
      prompt: "B5 — над первой добавочной",
      staff: [{ kind: "note", pitch: 83, duration: "quarter", highlight: true }],
      explanation: `${namedPitch(83)} — это ${pitchNameRuFull(83)}; нота подсвечена и сидит в промежутке над первой добавочной линейкой сверху: линейки через A5 (ля) и под C6 (до) обрамляют её.`,
      answer: null,
    },
  ];
}

function lesson4Facts(): PrimerCard[] {
  return [
    {
      prompt: "Длительности: как выглядит каждая нота",
      staff: [
        { kind: "note", pitch: 64, duration: "whole" },
        { kind: "note", pitch: 67, duration: "half" },
        { kind: "note", pitch: 71, duration: "quarter" },
        { kind: "note", pitch: 76, duration: "eighth" },
      ],
      explanation:
        "Целая — пустая головка без штиля; половинная — пустая со штилем; четверть — заполненная со штилем; восьмая — заполненная, у штиля флаг.",
      answer: null,
    },
    {
      prompt: "Счёт вслух",
      staff: [
        { kind: "note", pitch: 64, duration: "whole" },
        { kind: "note", pitch: 67, duration: "half" },
        { kind: "note", pitch: 71, duration: "quarter" },
        { kind: "note", pitch: 76, duration: "eighth" },
      ],
      explanation: `Считаем вслух: целая — „1“, половинная — „1-2“, четверть — „та“, восьмая — „ти-ти“. Доли: ${ALL_DURATIONS.map(
        (d) => `${DURATION_NAME[d]} — ${DURATION_BEATS_PHRASE[d]}`,
      ).join(", ")}.`,
      answer: null,
    },
  ];
}

function lesson5Facts(): PrimerCard[] {
  return [
    {
      prompt: "Пауза — знак молчания",
      staff: [
        { kind: "rest", duration: "whole" },
        { kind: "rest", duration: "half" },
        { kind: "rest", duration: "quarter" },
        { kind: "rest", duration: "eighth" },
      ],
      explanation:
        "Пауза — молчание той же длительности, что и нота: целая, половинная, четверть, восьмая. Счёт тот же: „1“, „1-2“, „та“, „ти-ти“.",
      answer: null,
    },
    {
      prompt: "Где стоят паузы",
      staff: [
        { kind: "rest", duration: "whole", highlight: true },
        { kind: "rest", duration: "half" },
        { kind: "rest", duration: "quarter" },
      ],
      explanation:
        "Целая пауза висит под второй линией сверху (подсвечена); остальные паузы стоят на средней линии.",
      answer: null,
    },
  ];
}

function lesson6Facts(): PrimerCard[] {
  return [
    {
      prompt: "Такт и тактовая черта",
      staff: [
        { kind: "note", pitch: 64, duration: "quarter" },
        { kind: "note", pitch: 67, duration: "quarter" },
        { kind: "barline" },
        { kind: "note", pitch: 71, duration: "quarter" },
        { kind: "note", pitch: 69, duration: "quarter" },
        { kind: "barline" },
      ],
      explanation: "Такт — отрезок между тактовыми чертами. Черта делит запись на такты; в каждом такте — ровно размер долей.",
      answer: null,
    },
    {
      prompt: "Размер 4/4 и 3/4",
      staff: [
        { kind: "timeSignature", numerator: 4, denominator: 4 },
        { kind: "note", pitch: 64, duration: "quarter" },
        { kind: "note", pitch: 67, duration: "quarter" },
        { kind: "note", pitch: 71, duration: "quarter" },
        { kind: "note", pitch: 69, duration: "quarter" },
        { kind: "barline" },
      ],
      explanation:
        "Размер — дробь при ключе: числитель — сколько долей в такте, знаменатель — какая нота равна доле (4 — четверть). В 3/4 — три доли (вальс).",
      answer: null,
    },
  ];
}

// --- Факты уроков басового ключа (PIANO-13) ---

function lesson7Facts(): PrimerCard[] {
  const scale: StaffItem[] = BASS_SCALE.map((pitch) => ({ kind: "note", pitch, duration: "quarter" }));
  return [
    {
      prompt: "Это басовый ключ",
      staff: [{ kind: "note", pitch: 53, duration: "quarter", highlight: true }],
      explanation:
        "Басовый ключ (𝄢) стоит в начале стана: две его точки охватывают четвёртую линию — там живёт F3 (фа), она подсвечена. Басовым ключом записывают ноты левой руки: малую октаву C3–B3 и ниже.",
      answer: null,
      clef: "bass",
    },
    {
      prompt: "Басовый стан: ноты G2–B3",
      staff: scale,
      explanation:
        "Линии басового стана снизу вверх: G2, B2, D3, F3, A3; промежутки: A2, C3, E3, G3; над станом — B3. Ключ стоит на F3 — от неё легко посчитать остальные. Чтобы играть эти ноты, сдвинь октаву вниз клавишей Z: один раз для C3–B3, дважды для G2–B2.",
      answer: null,
      clef: "bass",
    },
  ];
}

function lesson8Facts(): PrimerCard[] {
  const scale: StaffItem[] = SMALL_OCTAVE.map((pitch) => ({ kind: "note", pitch, duration: "quarter" }));
  return [
    {
      prompt: "Малая октава: C3–B3",
      staff: scale,
      explanation: `Малая октава — ${SMALL_OCTAVE.map(namedPitch).join(" ")} — октавой ниже первой, ноты левой руки. На басовом стане: C3 — второй промежуток, F3 — четвёртая линия (на ней стоит ключ), B3 — промежуток над станом.`,
      answer: null,
      clef: "bass",
    },
    {
      prompt: "Малая октава на твоей клавиатуре",
      staff: [{ kind: "note", pitch: 48, duration: "quarter", highlight: true }],
      explanation:
        "Сдвинь октаву вниз — клавиша Z (один раз): первая клавиша ряда (Tab) станет C3, и буквенный ряд сыграет C3–B5. Нажми C3 — она подсветится на стане.",
      answer: null,
      clef: "bass",
    },
  ];
}

function lesson9Facts(): PrimerCard[] {
  return [
    {
      prompt: "C4 в скрипичном ключе",
      staff: [{ kind: "note", pitch: 60, duration: "quarter", highlight: true }],
      explanation:
        "C4 (до первой октавы) — первая добавочная линейка снизу скрипичного стана. Запомни это место: дальше та же нота встретится в басовом ключе.",
      answer: null,
      clef: "treble",
    },
    {
      prompt: "Та же C4 в басовом ключе",
      staff: [{ kind: "note", pitch: 60, duration: "quarter", highlight: true }],
      explanation:
        "В басовом ключе C4 — первая добавочная линейка сверху. Одна нота — два места на стане: имя линии даёт ключ. C4 — «средняя до», граница ключей: ниже записывают басовым, выше — скрипичным.",
      answer: null,
      clef: "bass",
    },
  ];
}

// --- Генераторы уроков ---

function generateLesson1(rng: Rng): PrimerCard[] {
  const picks = shuffled(rng, WITHIN_STAFF);
  const again = pick(
    rng,
    WITHIN_STAFF.filter((pitch) => pitch !== picks[picks.length - 1]),
  );
  const questions = [...picks, again].map((pitch) => nameTheNote(pitch));
  return [...lesson1Facts(), ...questions];
}

function generateScaleLesson(pool: readonly number[], facts: PrimerCard[], clef: ClefKind = "treble") {
  return (rng: Rng): PrimerCard[] => {
    const picks = shuffled(rng, pool);
    const questions = [
      ...picks.slice(0, 4).map((pitch) => nameTheNote(pitch, clef)),
      ...picks.slice(4, 7).map((pitch) => playTheNote(pitch, clef)),
    ];
    return [...facts, ...questions];
  };
}

function generateDurations(rng: Rng): PrimerCard[] {
  const questions = [0, 1, 2, 3, 4].map(() => durationQuestion(rng, false));
  return [...lesson4Facts(), ...questions];
}

function generateRests(rng: Rng): PrimerCard[] {
  const questions = [0, 1, 2, 3, 4].map(() => durationQuestion(rng, true));
  return [...lesson5Facts(), ...questions];
}

function generateMeasures(rng: Rng): PrimerCard[] {
  const questions = [0, 1, 2, 3, 4].map(() => measureQuestion(rng));
  return [...lesson6Facts(), ...questions];
}

/** Урок 7 «Басовый ключ»: весь пул басового стана — 5 «какая нота» + 4 «сыграй». */
function generateBassStaffLesson(rng: Rng): PrimerCard[] {
  const picks = shuffled(rng, BASS_STAFF_NOTES);
  const questions = [
    ...picks.slice(0, 5).map((pitch) => nameTheNote(pitch, "bass")),
    ...picks.slice(5).map((pitch) => playTheNote(pitch, "bass")),
  ];
  return [...lesson7Facts(), ...questions];
}

/**
 * Урок 9 «Оба ключа»: пары карточек одной высоты в скрипичном и басовом
 * ключе идут подряд (какой ключ первым — случайно), чтобы контраст мест
 * читался сразу; первые три пары — «какая нота», остальные — «сыграй».
 */
function generateBothClefs(rng: Rng): PrimerCard[] {
  const picks = shuffled(rng, BOTH_CLEFS_PITCHES);
  const questions: PrimerCard[] = [];
  picks.forEach((pitch, i) => {
    const treble = i < 3 ? nameTheNote(pitch, "treble") : playTheNote(pitch, "treble");
    const bass = i < 3 ? nameTheNote(pitch, "bass") : playTheNote(pitch, "bass");
    const [first, second] = rng() < 0.5 ? [treble, bass] : [bass, treble];
    questions.push(first, second);
  });
  return [...lesson9Facts(), ...questions];
}

/** Уроки (SPEC §4.9) в порядке прохождения; следующий открывается при ≥80%. */
export const LESSONS: readonly PrimerLesson[] = [
  {
    id: "staff-clef",
    order: 1,
    title: "Стан и скрипичный ключ",
    description: "Линии и промежутки нотного стана, скрипичный ключ и место G4 (соль)",
    generate: generateLesson1,
  },
  {
    id: "octave-4",
    order: 2,
    title: "Ноты первой октавы",
    description: "C4 (до)–B4 (си) на стане и добавочные линейки (C4 ниже стана)",
    generate: generateScaleLesson(FIRST_OCTAVE, lesson2Facts()),
  },
  {
    id: "octave-5",
    order: 3,
    title: "Ноты второй октавы",
    description: "C5 (до)–B5 (си) на стане и добавочные линейки сверху",
    generate: generateScaleLesson(SECOND_OCTAVE, lesson3Facts()),
  },
  {
    id: "durations",
    order: 4,
    title: "Длительности",
    description: "Целая, половинная, четверть, восьмая — вид ноты и счёт вслух",
    generate: generateDurations,
  },
  {
    id: "rests",
    order: 5,
    title: "Паузы",
    description: "Паузы тех же длительностей: как выглядят и сколько молчат",
    generate: generateRests,
  },
  {
    id: "measures",
    order: 6,
    title: "Такты и размеры",
    description: "4/4 и 3/4, тактовые черты, «сколько долей в такте»",
    generate: generateMeasures,
  },
  {
    id: "bass-clef",
    order: 7,
    title: "Басовый ключ",
    description: "Ключ 𝄢: четвёртая линия = F3; ноты левой руки на басовом стане",
    generate: generateBassStaffLesson,
  },
  {
    id: "octave-3",
    order: 8,
    title: "Малая октава в басовом ключе",
    description: "C3–B3 — ноты левой руки; октавный сдвиг Z, Tab становится C3",
    generate: generateScaleLesson(SMALL_OCTAVE, lesson8Facts(), "bass"),
  },
  {
    id: "both-clefs",
    order: 9,
    title: "Оба ключа",
    description: "Одна нота в 𝄞 и 𝄢 — разные места на стане: имя линии даёт ключ",
    generate: generateBothClefs,
  },
];
