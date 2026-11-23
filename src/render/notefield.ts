/**
 * Верхний канвас: колонки нот + линия удара (ADR-004 п.1, research 04).
 *
 * Геометрия колонок — из ЕДИНОЙ раскладки клавиш (layout.byPitch, ADR-004 п.3):
 * колонка всегда над своей экранной клавишей. Позиция ноты — чистая функция
 * songTime (ADR-004 п.2): y(t) = y_линии − (t_ноты − songTime) × скорость.
 *
 * Ноты вне маппинга (инвариант GLOSSARY #4) видны в крайних колонках с
 * маркером-стрелкой октавного сдвига (Z — ниже диапазона, X — выше).
 *
 * Вспышки попадания живут по аудио-часам (инвариант #2), очищаются по
 * истечении жизни; массив ограничен MAX_PARTICLES. Ноты вне экрана не
 * рисуются: отбор окном видимости + бинарный поиск (research 04 Q2).
 */
import type { KeyboardLayout } from "../core/layout";
import type { MappingRange, Melody, Note } from "../core/types";
import { HIT_FLASH_COLOR, PARTY_COLORS } from "./colors";

/** Скорость падения, CSS-пикс/сек — высота ноты ∝ длительности (задание Q3). */
export const FALL_SPEED_PX_PER_SEC = 150;
/** Отступ колонки от краёв экранной клавиши. */
const COLUMN_INSET_PX = 2;
/** Линия удара — отступ от нижнего края канваса. */
const HIT_LINE_INSET_PX = 3;
/** Вспышка попадания: жизнь и потолок массива (память). */
const FLASH_LIFETIME_SEC = 0.4;
const MAX_PARTICLES = 48;
/** Минимальная видимая высота ноты, px. */
const MIN_NOTE_HEIGHT_PX = 4;

const COLORS = {
  background: "#0e1116",
  hitLine: "#3a4356",
  outOfRangeMark: "#e8ecf4",
} as const;

export interface NoteFieldFrame {
  melody: Melody | null;
  /** false — свободная игра: поле пусто (SPEC §4.3). */
  showNotes: boolean;
  /** Позиция песни (чистая функция аудио-часов, из Player.songTime()). */
  songTime: number;
  layout: KeyboardLayout;
  range: MappingRange;
  /** Аудио-часы сейчас — возраст вспышек. */
  nowSec: number;
}

interface Particle {
  pitch: number;
  bornAt: number;
}

interface Column {
  x: number;
  width: number;
}

export class NoteFieldRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvasEl: HTMLCanvasElement;
  private cssWidth = 0;
  private cssHeight = 0;
  private readonly particles: Particle[] = [];
  private layout: KeyboardLayout | null = null;
  /** Отсортированные по старту ноты текущей мелодии (кэш по id). */
  private notes: readonly Note[] = [];
  private notesMelodyId: string | null = null;
  /** Самая долгая нота мелодии — окно видимости длинных нот. */
  private maxNoteSec = 1;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D недоступен");
    this.ctx = ctx;
    this.canvasEl = canvas;
  }

  get size(): { width: number; height: number } {
    return { width: this.cssWidth, height: this.cssHeight };
  }

  /** Пересоздать буфер под CSS-размер × devicePixelRatio (ADR-004 п.4). */
  resize(): boolean {
    const rect = this.canvasEl.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const dpr = window.devicePixelRatio || 1;
    const bufferW = Math.round(w * dpr);
    const bufferH = Math.round(h * dpr);
    const unchanged =
      this.cssWidth === w && this.cssHeight === h && this.canvasEl.width === bufferW && this.canvasEl.height === bufferH;
    if (unchanged) return false;
    this.canvasEl.width = bufferW;
    this.canvasEl.height = bufferH;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssWidth = w;
    this.cssHeight = h;
    return true;
  }

  /** Запомнить раскладку (пересчитывается в main при resize/сдвиге октавы). */
  setLayout(layout: KeyboardLayout): void {
    this.layout = layout;
  }

  /** Полный кадр. */
  draw(frame: NoteFieldFrame): void {
    const { ctx } = this;
    const w = this.cssWidth;
    const h = this.cssHeight;
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, w, h);

    const yLine = h - HIT_LINE_INSET_PX;

    if (frame.showNotes && frame.melody) {
      if (this.notesMelodyId !== frame.melody.id || this.notes.length !== frame.melody.notes.length) {
        this.notes = [...frame.melody.notes].sort((a, b) => a.startTimeSec - b.startTimeSec);
        this.maxNoteSec = this.notes.reduce((max, n) => Math.max(max, n.durationSec), 0.25);
        this.notesMelodyId = frame.melody.id;
      }
      this.drawNotes(frame, yLine);
    }

    // Линия удара — у нижнего края, над клавиатурой (GLOSSARY).
    ctx.fillStyle = COLORS.hitLine;
    ctx.fillRect(0, yLine, w, 2);

    this.drawParticles(frame, yLine);
  }

  private drawNotes(frame: NoteFieldFrame, yLine: number): void {
    const { ctx } = this;
    const t = frame.songTime;
    const px = FALL_SPEED_PX_PER_SEC;
    const h = this.cssHeight;
    // Видимое окно музыкального времени: вперёд — сколько секунд умещается
    // над линией, назад — самая долгая нота (хвосты длинных нот видны).
    const visibleAhead = h / px;
    const lookback = this.maxNoteSec + 1 / px;
    const upperStart = t + visibleAhead;

    // Крайние колонки для нот вне маппинга (инвариант #4) — кэш на кадр.
    let leftmost: Column | null = null;
    let rightmost: Column | null = null;
    for (const key of frame.layout.keys) {
      const col = { x: key.x, width: key.width };
      if (!leftmost || key.x < leftmost.x) leftmost = col;
      if (!rightmost || key.x + key.width > rightmost.x + rightmost.width) rightmost = col;
    }

    for (let i = lowerBound(this.notes, t - lookback); i < this.notes.length; i += 1) {
      const note = this.notes[i];
      if (!note || note.startTimeSec > upperStart) break;
      const endSec = note.startTimeSec + note.durationSec;
      if (endSec <= t) continue; // уже ушла за линию удара

      const column = this.columnFor(note.pitch, frame, leftmost, rightmost);
      if (!column) continue;

      // Чистая функция времени (ADR-004 п.2): нижний край = момент ноты.
      const yBottom = Math.min(h, yLine - (note.startTimeSec - t) * px);
      const yTopRaw = yLine - (endSec - t) * px;
      const yTop = Math.max(0, yTopRaw);
      if (yTopRaw >= h) continue; // ещё высоко над экраном
      const height = yBottom - yTop;
      if (height < MIN_NOTE_HEIGHT_PX) continue;

      const color = note.handPart === "right" ? PARTY_COLORS.right : PARTY_COLORS.left;
      const outOfRange = !frame.layout.byPitch.has(note.pitch);
      ctx.globalAlpha = outOfRange ? 0.65 : 1;
      ctx.fillStyle = color;
      roundRect(ctx, column.x + COLUMN_INSET_PX, yTop, Math.max(2, column.width - COLUMN_INSET_PX * 2), height, 3);
      ctx.fill();
      ctx.globalAlpha = 1;

      if (outOfRange) {
        const below = note.pitch < frame.range.basePitch;
        this.drawShiftMark(column, yTop, below ? "▼ Z" : "▲ X");
      }
    }
  }

  /** Колонка ноты: своя клавиша или крайняя при выходе из диапазона (инвариант #4). */
  private columnFor(
    pitch: number,
    frame: NoteFieldFrame,
    leftmost: Column | null,
    rightmost: Column | null,
  ): Column | null {
    const key = frame.layout.byPitch.get(pitch);
    if (key) return { x: key.x, width: key.width };
    if (pitch < frame.range.basePitch) return leftmost;
    return rightmost;
  }

  /** Маркер октавного сдвига: подсказка Z (вниз) / X (вверх). */
  private drawShiftMark(column: Column, yTop: number, mark: string): void {
    const { ctx } = this;
    ctx.fillStyle = COLORS.outOfRangeMark;
    ctx.font = "700 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(mark, column.x + column.width / 2, Math.max(12, yTop - 4));
  }

  /** Вспышка попадания: рождается на линии удара в колонке ноты. */
  spawnHitFlash(pitch: number, nowSec: number): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push({ pitch, bornAt: nowSec });
  }

  private drawParticles(frame: NoteFieldFrame, yLine: number): void {
    const { ctx } = this;
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const particle = this.particles[i];
      if (!particle) continue;
      const age = frame.nowSec - particle.bornAt;
      if (age < 0 || age >= FLASH_LIFETIME_SEC) {
        this.particles.splice(i, 1); // очистка по истечении жизни
        continue;
      }
      const key = this.layout?.byPitch.get(particle.pitch) ?? this.leftmostColumn(frame);
      if (!key) continue;
      const k = age / FLASH_LIFETIME_SEC;
      const cx = key.x + key.width / 2;
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.strokeStyle = HIT_FLASH_COLOR;
      ctx.lineWidth = 2.5 * (1 - k) + 0.5;
      ctx.beginPath();
      ctx.arc(cx, yLine, 6 + 26 * k, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private leftmostColumn(frame: NoteFieldFrame): Column | null {
    let found: Column | null = null;
    for (const key of frame.layout.keys) {
      if (!found || key.x < found.x) found = { x: key.x, width: key.width };
    }
    return found;
  }
}

/** Первый индекс ноты со стартом ≥ timeSec (ноты отсортированы). */
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
