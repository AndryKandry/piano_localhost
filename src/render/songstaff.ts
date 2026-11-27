/**
 * Нотный стан как режим отображения игры (PIANO-16, бэклог SPEC §8):
 * горизонтальный поток тактов с фиксированным курсором игрока (~25% ширины) —
 * ноты и тактовые черты скользят влево, окно чтения вперёд ~2.5 с, за курсором
 * остаётся ~1 с хвостов. Линии стана, ключ и размер статичны; движутся ТОЛЬКО
 * ноты и тактовые черты: x = курсор + (t_ноты − songTime) × pxPerSec — чистая
 * функция songTime (инвариант GLOSSARY #2, ADR-004 п.2), никаких инкрементов.
 * Wait-mode: songTime замерло на гейте — кадр статичен той же формулой.
 *
 * Слой: main рисует на том же #noteCanvas ЛИБО NoteFieldRenderer (падающие
 * колонки), ЛИБО этот рендер (настройка melodyDisplay) — два рендера один
 * canvas одновременно не живут, у каждого свой Retina-буфер (ADR-004 п.4).
 *
 * Рисунок — существующий API «Азбуки» (ADR-007): NotationRenderer внедряется
 * конструктором (renderer.ts без правок). Зависимость ТИПОВАЯ (import type —
 * стирается): модуль не тянет загрузчик Bravura и проверяется в node
 * (scripts/smoke-songstaff.ts). Шрифт глифов загружает main при первом кадре
 * стана (ensureBravura); до загрузки стан виден линиями, головки добегут.
 * Сырой ctx канваса нужен только для клипа движущейся зоны (ноты уезжают за
 * ключ, а не рисуются поверх него) — getContext отдаёт тот же объект.
 *
 * Подсветка (инвариант GLOSSARY #5): в обучении accent+свечение — ближайшая
 * играбельная нота (группа на одном моменте = аккорд); в wait-mode она
 * статична у курсора. Автопартия — dim (0.6, как в тетради). В автоплее
 * accent при звучании («что жмёт компьютер»), остальное dim.
 *
 * Упрощения v1 (бэклог SPEC): головки — четвертные со штилем (длительность
 * глифом не кодируется), пауз нет, тактовые черты — по сетке долей метронома
 * (каждая numerator-я четверть темповой карты; размер из melody.timeSignature,
 * у данных до PIANO-22 — дефолт 4/4).
 */
import { metronomeTicks } from "../player/scheduler";
import type { Melody, Note, TempoChange, TimeSignature } from "../core/types";
import type { NotationRenderer } from "../notation/index";

/** Доля ширины канваса, где стоит курсор игрока (задание PIANO-16: ~25%). */
export const STAFF_CURSOR_RATIO = 0.25;
/** Окно чтения вперёд от курсора, сек мелодии (задание PIANO-16: ~2–3 с). */
export const STAFF_LOOK_AHEAD_SEC = 2.5;
/** Хвост за курсором, сек: сыгранное уплывает влево, а не исчезает скачком. */
export const STAFF_LOOK_BEHIND_SEC = 1;
/** Минимальная скорость чтения, px/сек мелодии (узкое окно не сплющивать). */
export const STAFF_MIN_SPEED_PX_PER_SEC = 40;

const EPS = 1e-6;

/** Роль ноты в текущем режиме: партия игрока или автопартия. */
export type StaffNoteRole = "playable" | "auto";
/** Фаза ноты относительно songTime: сыграна / звучит / впереди. */
export type StaffNotePhase = "past" | "now" | "future";

/** Нота окна чтения: позиция головки (x центра) и вид. */
export interface StaffNoteView {
  readonly note: Note;
  readonly x: number;
  readonly role: StaffNoteRole;
  readonly phase: StaffNotePhase;
  /** accent + свечение (drawNote highlight): играем сейчас / звучит в автоплее. */
  readonly highlight: boolean;
  /** Приглушение (drawNote dim, alpha 0.6): автопартия / не звучит в автоплее. */
  readonly dim: boolean;
}

/** Окно чтения стана на данный кадр. */
export interface StaffWindowView {
  readonly notes: readonly StaffNoteView[];
  /** x курсора игрока (статичен, доля ширины). */
  readonly cursorX: number;
  /** px на секунду мелодии (скорость скольжения нот). */
  readonly pxPerSec: number;
}

export interface StaffWindowInput {
  /** Ноты, отсортированные по startTimeSec (контракт: плеер держит сортировку). */
  readonly notes: readonly Note[];
  /** Позиция песни (Player.songTime(), чистая функция аудио-часов). */
  readonly songTime: number;
  /** Ширина канваса, CSS-px. */
  readonly widthPx: number;
  /** Автоплей: accent при звучании, остальное dim (в обучении — как в тетради). */
  readonly autoplay: boolean;
  /** Партия игрока в данном кадре (Player.isPlayableNote). */
  isPlayable(note: Note): boolean;
  /** Окно попадания: просроченные ноты уже не «ближайшие». */
  readonly hitWindowSec: number;
  readonly cursorRatio?: number;
  readonly lookAheadSec?: number;
  readonly lookBehindSec?: number;
  /** Не задан — выводится из окна чтения: правая часть канваса = lookAhead сек. */
  readonly pxPerSec?: number;
}

/**
 * Видимое окно стана: ноты с концом позже songTime − lookBehind и стартом
 * раньше songTime + lookAhead (края по ВРЕМЕНИ, не по x — длинная нота,
 * начатая до окна, видна, пока её хвост звучит). x монотонен по старту ноты.
 * Чистая функция: без канваса, времени и мутаций входа (проверяется смоуком).
 */
export function computeStaffWindow(input: StaffWindowInput): StaffWindowView {
  const w = input.widthPx;
  if (!(w > 0)) return { notes: [], cursorX: 0, pxPerSec: 0 };
  const cursorRatio = input.cursorRatio ?? STAFF_CURSOR_RATIO;
  const lookAhead = input.lookAheadSec ?? STAFF_LOOK_AHEAD_SEC;
  const lookBehind = input.lookBehindSec ?? STAFF_LOOK_BEHIND_SEC;
  const cursorX = Math.round(w * cursorRatio);
  const pxPerSec =
    input.pxPerSec ?? Math.max(STAFF_MIN_SPEED_PX_PER_SEC, (w - cursorX) / Math.max(lookAhead, EPS));

  const t = input.songTime;
  const tStart = t - lookBehind;
  const tEnd = t + lookAhead;
  const notes = input.notes;

  // Левый край сканирования — с запасом на самую долгую ноту: нота, начатая
  // до окна, видна, пока её конец не ушёл за tStart.
  const maxDur = notes.reduce((max, n) => Math.max(max, n.durationSec), 0);
  const scanFrom = lowerBound(notes, tStart - maxDur);

  // Ближайшая играбельная нота: самый ранний старт ≥ t − hitWindow (ещё не
  // просрочена). Ноты на том же моменте — аккорд, подсвечиваются вместе.
  let groupTime: number | null = null;
  for (let i = scanFrom; i < notes.length; i += 1) {
    const note = notes[i];
    if (!note || note.startTimeSec >= tEnd) break;
    if (!input.isPlayable(note)) continue;
    if (note.startTimeSec >= t - input.hitWindowSec - EPS) {
      groupTime = note.startTimeSec;
      break;
    }
  }

  const views: StaffNoteView[] = [];
  for (let i = scanFrom; i < notes.length; i += 1) {
    const note = notes[i];
    if (!note || note.startTimeSec >= tEnd) break;
    const end = note.startTimeSec + note.durationSec;
    if (end <= tStart) continue; // ушла за левый край окна целиком
    const playable = input.isPlayable(note);
    const sounding = note.startTimeSec <= t && t < end;
    const phase: StaffNotePhase = note.startTimeSec > t + EPS ? "future" : sounding ? "now" : "past";
    const isCurrent = playable && groupTime !== null && Math.abs(note.startTimeSec - groupTime) <= EPS;
    views.push({
      note,
      x: cursorX + (note.startTimeSec - t) * pxPerSec,
      role: playable ? "playable" : "auto",
      phase,
      highlight: input.autoplay ? sounding : isCurrent,
      dim: input.autoplay ? !sounding : !playable,
    });
  }
  return { notes: views, cursorX, pxPerSec };
}

export interface StaffBarlinesInput {
  readonly tempoMap: readonly TempoChange[];
  readonly durationSec: number;
  /** Размер мелодии; не задан/битый — дефолт 4/4 (как у метронома). */
  readonly timeSignature?: TimeSignature;
  readonly songTime: number;
  readonly cursorX: number;
  readonly pxPerSec: number;
  readonly widthPx: number;
}

/**
 * x-позиции тактовых черт в окне: сетка долей метронома, accent-тики — начала
 * тактов (каждая numerator-я четверть темповой карты; смена BPM сдвигает
 * черту — та же арифметика, что у тиков). Чистая функция.
 */
export function staffBarlineXs(input: StaffBarlinesInput): number[] {
  const xs: number[] = [];
  for (const tick of metronomeTicks(input.tempoMap, input.durationSec, input.timeSignature)) {
    if (!tick.accent) continue;
    const x = input.cursorX + (tick.timeSec - input.songTime) * input.pxPerSec;
    if (x >= 0 && x <= input.widthPx) xs.push(x);
  }
  return xs;
}

const COLORS = {
  cursor: "#5a6680", // guide-line: курсор игрока — по нему играют (design-system §2.2, §2.3)
} as const;

export interface SongStaffFrame {
  readonly melody: Melody;
  /** Позиция песни (Player.songTime()). */
  readonly songTime: number;
  /** Автоплей: accent при звучании (курсор бежит, подсветка «что жмёт компьютер»). */
  readonly autoplay: boolean;
  isPlayable(note: Note): boolean;
  readonly hitWindowSec: number;
}

/**
 * Рендер стана на канвасе игрового поля. NotationRenderer «Азбуки» внедряется
 * снаружи (renderer.ts не знает про плеер); canvas — тот же элемент, что у
 * NoteFieldRenderer: getContext возвращает ЕДИНЫЙ контекст, клип движущейся
 * зоны не конфликтует с рисованием обёртки.
 */
export class SongStaffRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly notation: NotationRenderer;
  /** Отсортированные по старту ноты текущей мелодии (кэш по id, как в notefield). */
  private notes: readonly Note[] = [];
  private notesMelodyId: string | null = null;

  constructor(canvas: HTMLCanvasElement, notation: NotationRenderer) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D недоступен");
    this.ctx = ctx;
    this.notation = notation;
  }

  /** CSS-размер (тот же, что у NotationRenderer). */
  get size(): { width: number; height: number } {
    return this.notation.size;
  }

  /** Retina-буфер под CSS × devicePixelRatio (ADR-004 п.4) — каждый кадр. */
  resize(): boolean {
    return this.notation.resize();
  }

  /**
   * Сбросить кэш нот — после пересборки партий той же мелодии (диалог сплита):
   * id и число нот не меняются, а объекты нот новые.
   */
  resetMelodyCache(): void {
    this.notesMelodyId = null;
    this.notes = [];
  }

  /** Полный кадр стана: статичный стан + движущиеся черты и ноты + курсор. */
  draw(frame: SongStaffFrame): void {
    this.cacheNotes(frame.melody);
    const { width, height } = this.notation.size;
    if (!(width > 0) || !(height > 0)) return;

    // Вертикаль: один стан по центру; над станом запас на B6 (верх диапазона
    // маппинга, 5 межлинейных) и свечение подсветки, под — на C4 и хвосты.
    const ss = Math.max(10, Math.min(24, Math.round(height / 14)));
    const staffH = ss * 4; // стан = 4 межлинейных (SMuFL: 1 межлинейное = 0.25 em)
    const topY = Math.max(0, Math.round((height - staffH) / 2));
    this.notation.setStaffGeometry(topY, ss);
    this.notation.clear();

    const margin = Math.round(ss * 1.2);
    this.notation.drawStaff(margin, width - margin * 2, topY);
    // Размер — свойство стана: статичен у ключа (тетрадь ставит его так же).
    const sig = frame.melody.timeSignature;
    if (sig.numerator >= 0 && sig.numerator <= 9 && sig.denominator >= 0 && sig.denominator <= 9) {
      this.notation.drawTimeSignature(sig.numerator, sig.denominator, margin + ss * 2.1, topY);
    }
    const contentLeft = margin + ss * 3.4;

    const view = computeStaffWindow({
      notes: this.notes,
      songTime: frame.songTime,
      widthPx: width,
      autoplay: frame.autoplay,
      isPlayable: frame.isPlayable,
      hitWindowSec: frame.hitWindowSec,
    });

    // Движущаяся часть — за клипом: ноты уезжают влево ЗА ключ/размер и
    // исчезают у края, а не рисуются поверх статичных знаков.
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(contentLeft, 0, Math.max(0, width - contentLeft - margin), height);
    this.ctx.clip();

    // Курсор игрока: статичная вертикаль по стану (guide-line) — «ты здесь».
    this.ctx.fillStyle = COLORS.cursor;
    this.ctx.fillRect(view.cursorX - ss * 0.06, topY - ss * 0.6, ss * 0.12, staffH + ss * 2.2);

    for (const x of staffBarlineXs({
      tempoMap: frame.melody.tempoMap,
      durationSec: frame.melody.durationSec,
      timeSignature: frame.melody.timeSignature,
      songTime: frame.songTime,
      cursorX: view.cursorX,
      pxPerSec: view.pxPerSec,
      widthPx: width,
    })) {
      this.notation.drawBarline(x, topY);
    }

    for (const item of view.notes) {
      if (item.x > width + ss) break; // ноты отсортированы — x монотонен
      // v1: четвертная головка со штилем независимо от durationSec (бэклог SPEC).
      this.notation.drawNote(item.note.pitch, "quarter", item.x, {
        topY,
        highlight: item.highlight,
        dim: item.dim,
      });
    }
    this.ctx.restore();

    // Маркер позиции над станом (accent, как в тетради) — поверх клипа.
    this.notation.drawPositionMarker(view.cursorX, topY);
  }

  private cacheNotes(melody: Melody): void {
    if (this.notesMelodyId === melody.id && this.notes.length === melody.notes.length) return;
    this.notes = [...melody.notes].sort((a, b) => a.startTimeSec - b.startTimeSec);
    this.notesMelodyId = melody.id;
  }
}

/** Первый индекс ноты со стартом ≥ timeSec (ноты отсортированы; как в notefield). */
function lowerBound(notes: readonly Note[], timeSec: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const note = notes[mid];
    if (note && note.startTimeSec < timeSec) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
