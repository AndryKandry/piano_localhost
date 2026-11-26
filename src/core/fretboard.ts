/**
 * Модель грифа гитары для гитарного раздела «Азбуки» (research 06). Чистая
 * логика без DOM — покрывается scripts/smoke-fretboard.ts.
 *
 * Ключевые факты домена (research 06):
 * - строй EADGBE (§1): струны 1..6 — сверху вниз, от высокой E4 (MIDI 64) к
 *   низкой E2 (MIDI 40); между 3-й и 2-й струнами терция (+4), между
 *   остальными — кварта (+5);
 * - гитара — транспонирующий инструмент и звучит ОКТавой НИЖЕ записи (§1):
 *   канон приложения — записанная высота (вопрос на стане, ответ роя),
 *   аудио играет soundingMidi = writtenMidi − 12;
 * - I позиция = лады 0–4 (§2, Noad: «позиция = лад, где стоит 1-й палец»);
 * - внутри ладов 0–4 ровно один дубликат — записанная B4: открытая 2-я и
 *   3-я струна IV лад; конвенция школ — открытая 2-я (§4), поэтому словарь
 *   резолвит B4 в {string: 2, fret: 0}.
 */
import { pitchName } from "./layout";

/** Открытые струны, звучащий MIDI: индекс 0 = 1-я струна (высокая E4), 5 = 6-я (низкая E2). */
export const OPEN_MIDI: readonly number[] = [64, 59, 55, 50, 45, 40];

/** Число струн. */
export const STRING_COUNT = 6;

/** Глубина I позиции: лады 0–4 (открытые струны + I–IV лады). */
export const FIRST_POSITION_FRETS = 4;

/** Нота на грифе в I позиции. */
export interface GuitarNote {
  /** Струна 1–6: 1 = верхняя высокая E, 6 = нижняя низкая E (research 06 §1). */
  readonly string: number;
  /** Лад 0–4; 0 = открытая струна. */
  readonly fret: number;
}

/** Буквы открытых струн 1..6 для подписей диаграммы: E B G D A E. */
export const STRING_LETTERS: readonly string[] = ["E", "B", "G", "D", "A", "E"];

/**
 * Границы записанного диапазона I позиции (research 06 §4): от E3 (52,
 * 6-я открытая) до G♯5 (80, 1-я струна IV лад). Диапазон непрерывен —
 * каждая записанная высота внутри него достижима в I позиции.
 */
export const FIRST_POSITION_WRITTEN_LOW = OPEN_MIDI[STRING_COUNT - 1] + 12; // 52 = E3
export const FIRST_POSITION_WRITTEN_HIGH = OPEN_MIDI[0] + FIRST_POSITION_FRETS + 12; // 80 = G♯5

/** Гарантировать валидную струну 1–6 (исключение — для программных ошибок вызывающего). */
function requireString(s: number): number {
  if (!Number.isInteger(s) || s < 1 || s > STRING_COUNT) {
    throw new RangeError(`Струна вне 1–${STRING_COUNT}: ${s}`);
  }
  return s;
}

/** Гарантировать валидный лад 0–4 I позиции. */
function requireFret(f: number): number {
  if (!Number.isInteger(f) || f < 0 || f > FIRST_POSITION_FRETS) {
    throw new RangeError(`Лад вне 0–${FIRST_POSITION_FRETS}: ${f}`);
  }
  return f;
}

/** Проверка «нота в I позиции» без исключений — для guard'ов рендера и уроков. */
export function isValidGuitarNote(g: GuitarNote): boolean {
  return (
    Number.isInteger(g.string) && g.string >= 1 && g.string <= STRING_COUNT &&
    Number.isInteger(g.fret) && g.fret >= 0 && g.fret <= FIRST_POSITION_FRETS
  );
}

function requireGuitarNote(g: GuitarNote): GuitarNote {
  if (!isValidGuitarNote(g)) {
    throw new RangeError(`Нота вне I позиции (струна 1–${STRING_COUNT}, лад 0–${FIRST_POSITION_FRETS}): ${JSON.stringify(g)}`);
  }
  return g;
}

/**
 * Словарь «записанная высота → струна.лад» I позиции (research 06 §4) —
 * строится из формулы лада: written = OPEN_MIDI[string − 1] + fret + 12
 * (+12 — октавная конвенция гитарной записи, §1). Струны перебираются 1→6,
 * поэтому единственный дубликат внутри ладов 0–4 — записанная B4 (открытая
 * 2-я и 3-я IV лад) — остаётся за первым вариантом, открытой 2-й (§4).
 */
const WRITTEN_TO_GUITAR: ReadonlyMap<number, GuitarNote> = (() => {
  const map = new Map<number, GuitarNote>();
  for (let string = 1; string <= STRING_COUNT; string += 1) {
    for (let fret = 0; fret <= FIRST_POSITION_FRETS; fret += 1) {
      const written = OPEN_MIDI[string - 1] + fret + 12;
      if (!map.has(written)) map.set(written, Object.freeze({ string, fret }));
    }
  }
  return map;
})();

/**
 * Записанная высота на стане (MIDI) для ноты на грифе; null — высота вне
 * I позиции (ниже E3 или выше G♯5). Ответ роя и рендер стана судятся по
 * записанной высоте (research 06 §1, §6).
 */
export function writtenToGuitar(writtenMidi: number): GuitarNote | null {
  return WRITTEN_TO_GUITAR.get(writtenMidi) ?? null;
}

/**
 * Записанная высота (MIDI) ноты на грифе: звучащая формула лада + 12.
 * Roundtrip с writtenToGuitar для всех позиций, кроме 3-й струны IV лада —
 * её высота B4 словарь резолвит в открытую 2-ю (конвенция research 06 §4).
 */
export function guitarToWritten(g: GuitarNote): number {
  requireGuitarNote(g);
  return OPEN_MIDI[g.string - 1] + g.fret + 12;
}

/** Звучащая высота (MIDI) ноты на грифе — то, что слышно от настоящей гитары. */
export function guitarToSounding(g: GuitarNote): number {
  requireGuitarNote(g);
  return OPEN_MIDI[g.string - 1] + g.fret;
}

/** Звучащая высота записанной гитарной ноты: гитара звучит октавой ниже записи. */
export function soundingMidi(writtenMidi: number): number {
  return writtenMidi - 12;
}

/**
 * Имя открытой струны по звучащей высоте (западное имя, GLOSSARY):
 * 1-я — «E4», 2-я — «B3», …, 6-я — «E2» (research 06 §1). Имя струны —
 * физическое (звучащее); записанная высота той же струны на октаву выше.
 */
export function stringName(s: number): string {
  return pitchName(OPEN_MIDI[requireString(s) - 1]);
}

/**
 * Подпись лада («цифра пальца»): открытая — «0», таб-конвенция тренажёров
 * (research 06 §3: Songsterr «0 = открытая»). «откр.» не используем, чтобы
 * кружок диаграммы и будущая таб-строка писались одинаково.
 */
export function fretLabel(fret: number): string {
  requireFret(fret);
  return String(fret);
}
