/**
 * Рендер нотной грамоты для карточек «Азбуки» (ADR-007): Canvas 2D + шрифт
 * Bravura (SMuFL PUA-кодпоинты из research 05 §1.1). Только рисунок — никакой
 * логики уроков (очередь 2). Геометрия — чистые функции geometry.ts.
 *
 * Стиль как в src/render/*: Retina-буфер = CSS × devicePixelRatio, рисование
 * в CSS-пикселях через ctx.scale(dpr, dpr), перерисовка по событию.
 *
 * Контракты:
 * - перед первым рисованием вызывающая сторона обязана дождаться ensureBravura()
 *   (до загрузки PUA-глифы не отрисуются) и вызвать setStaffGeometry();
 * - размер шрифта Bravura = высота стана (SMuFL: 1 межлинейное = 0.25 em);
 * - глифы ставятся по baseline — y-координаты даёт geometry.pitchToY.
 *
 * Посадка флага восьмой на кончик штиля (align по краю штиля) — по практике
 * рендереров; точная выверка по Bravura bBox — этап Validation (research 05 §8).
 */
import { HIGHLIGHT_NEXT_COLOR } from "../render/colors";
import {
  BEAM_THICKNESS_SPACES,
  CLEF_BASELINE_POS,
  FLAG_CODEPOINTS,
  LEDGER_EXTENSION_SPACES,
  LEDGER_THICKNESS_SPACES,
  STAFF_LINE_COUNT,
  STAFF_LINE_THICKNESS_SPACES,
  STEM_THICKNESS_SPACES,
  THIN_BARLINE_THICKNESS_SPACES,
  TIMESIG_DENOMINATOR_POS,
  TIMESIG_NUMERATOR_POS,
  TOP_LINE_POS,
  type StaffDuration,
  ledgerLineYs,
  pitchToY,
  restBaselinePos,
  stemDirection,
  stemTipY,
} from "./geometry";
import { BRAVURA_FAMILY } from "./font";

const COLORS = {
  background: "#141821",
  staff: "#5a6680", // guide-line: линии стана, 3.1:1 на panel (design-system §2.2, §2.3)
  ink: "#e9e7e2",
  label: "#8a91a0",
  error: "#ff7a6e", // --error: отметки промахов в тетради (design-system §2.2)
} as const;

/** Токен notation-ink (design-system §2.2): чернила стана для вне-канвасного
 *  использования (подпись карточки азбуки в primer/screen.ts). Канвас-константа
 *  — единственное место, где hex живёт вне :root. */
export const NOTATION_INK = COLORS.ink;

/** Кодпоинты глифов SMuFL (research 05 §1.1 — таблица из спеки). */
const SMUFL = {
  gClef: 0xe050,
  noteheadWhole: 0xe0a2,
  noteheadHalf: 0xe0a3,
  noteheadBlack: 0xe0a4,
  restWhole: 0xe4e3,
  restHalf: 0xe4e4,
  restQuarter: 0xe4e5,
  rest8th: 0xe4e6,
  barlineSingle: 0xe030,
  timeSig0: 0xe080,
} as const;

/** Головка по длительности: целая — пустой овал без штиля, половинная — пустой со штилем. */
const HEAD_BY_DURATION: Record<StaffDuration, number> = {
  whole: SMUFL.noteheadWhole,
  half: SMUFL.noteheadHalf,
  quarter: SMUFL.noteheadBlack,
  eighth: SMUFL.noteheadBlack,
};

const REST_BY_DURATION: Record<StaffDuration, number> = {
  whole: SMUFL.restWhole,
  half: SMUFL.restHalf,
  quarter: SMUFL.restQuarter,
  eighth: SMUFL.rest8th,
};

export interface GlyphDrawOptions {
  /** Подсветка: акцентный цвет проекта + лёгкое свечение (тень канваса). */
  highlight?: boolean;
  /**
   * Приглушение будущих нот (тетрадь, SPEC §4.10): alpha 0.4 — как disabled
   * (design-system §2.3). Несовместимо с highlight (подсветка сильнее).
   */
  dim?: boolean;
  /** Нота под ребром: флаг восьмой не рисуется (плашку ведёт drawBeam). */
  inBeam?: boolean;
  /**
   * Свой кончик штиля (y, CSS-px): плашка ребра горизонтальна между штилями
   * — штиль дорисовывается до неё, а не до стандартных 3.5 межлинейных.
   */
  stemTipY?: number;
  /**
   * Верхняя линия стана для этой ноты/паузы (вторая строка тетради, две
   * строки стана на канвасе); по умолчанию — геометрия setStaffGeometry.
   */
  topY?: number;
}

export interface LabelOptions {
  sizePx?: number;
  color?: string;
  align?: CanvasTextAlign;
  weight?: number | string;
}

export class NotationRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvasEl: HTMLCanvasElement;
  private cssWidth = 0;
  private cssHeight = 0;
  /** y верхней линии стана и межлинейное расстояние (CSS-px) — задаёт карточка урока. */
  private staffTopY = 0;
  private spacePx = 0;
  /** Кэш ширины глифов (зависит от размера шрифта = масштаба стана). */
  private glyphWidthCache = new Map<number, number>();

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

  /** Задать геометрию стана (CSS-px); без неё рисование запрещено. */
  setStaffGeometry(staffTop: number, staffSpace: number): void {
    if (!(staffSpace > 0)) throw new Error("Межлинейное расстояние должно быть положительным");
    this.staffTopY = staffTop;
    this.spacePx = staffSpace;
    this.glyphWidthCache.clear(); // ширины глифов зависят от масштаба стана
  }

  get staffTop(): number {
    return this.staffTopY;
  }

  get staffSpace(): number {
    return this.spacePx;
  }

  /** Залить фон карточки. */
  clear(): void {
    this.ctx.fillStyle = COLORS.background;
    this.ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
  }

  /**
   * Нотный стан: 5 линий (толщина 0.13 межлинейного, Bravura staffLineThickness)
   * на [x, x+width] + скрипичный ключ U+E050 у левого края (SMuFL: baseline
   * ключа = линия G4, здесь — вторая линия). topY — верхняя линия стана;
   * не задана — геометрия setStaffGeometry (две строки тетради задают свою).
   */
  drawStaff(x: number, width: number, topY: number = this.staffTopY): void {
    this.requireStaffGeometry();
    const { ctx } = this;
    const ss = this.spacePx;
    ctx.fillStyle = COLORS.staff;
    const lineT = STAFF_LINE_THICKNESS_SPACES * ss;
    for (let i = 0; i < STAFF_LINE_COUNT; i += 1) {
      const y = topY + i * ss;
      ctx.fillRect(x, y - lineT / 2, width, lineT);
    }
    // Ключ: 1 em = высота стана = 4 межлинейных; baseline на линии G4.
    ctx.fillStyle = COLORS.ink;
    ctx.font = this.bravuraFont();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const clefY = topY + ((TOP_LINE_POS - CLEF_BASELINE_POS) * ss) / 2;
    ctx.fillText(String.fromCodePoint(SMUFL.gClef), x + ss * 0.4, clefY);
  }

  /**
   * Нота с длительностью. Головка центрируется на baseline позиции питча;
   * штиль — линия толщиной 0.12 межлинейного и длиной 3.5 (вверх — справа от
   * головки, вниз — слева); флаг восьмой — на кончике штиля (U+E240 вверх /
   * U+E241 вниз). У целой штиля нет. Добавочные линейки для нот за станом
   * (C4 и ниже / A5 и выше) — короткие, с выступом 0.4 межлинейного.
   */
  drawNote(pitch: number, duration: StaffDuration, x: number, opts?: GlyphDrawOptions): void {
    this.requireStaffGeometry();
    const { ctx } = this;
    const ss = this.spacePx;
    const topY = opts?.topY ?? this.staffTopY;
    const y = pitchToY(pitch, topY, ss);
    const head = HEAD_BY_DURATION[duration];
    const headW = this.glyphWidth(head);
    const highlight = opts?.highlight === true;
    const color = highlight ? HIGHLIGHT_NEXT_COLOR : COLORS.ink;

    ctx.save();
    this.applyInk(color, highlight, opts?.dim === true);

    // Добавочные линейки — до головки (рисуются под/над ней).
    const ledgers = ledgerLineYs(pitch, topY, ss);
    if (ledgers.length > 0) {
      const halfW = headW / 2 + LEDGER_EXTENSION_SPACES * ss;
      const ledgerT = LEDGER_THICKNESS_SPACES * ss;
      for (const ly of ledgers) ctx.fillRect(x - halfW, ly - ledgerT / 2, halfW * 2, ledgerT);
    }

    // Головка: SMuFL регистрирует её центром на baseline.
    this.drawGlyph(head, x, y, "center");

    // Штиль и флаг — у целой нет.
    if (duration !== "whole") {
      const dir = stemDirection(pitch);
      const stemT = STEM_THICKNESS_SPACES * ss;
      const stemX = dir === "up" ? x + headW / 2 - stemT : x - headW / 2;
      const tipY = opts?.stemTipY ?? stemTipY(pitch, topY, ss);
      const len = Math.abs(tipY - y);
      ctx.fillRect(stemX, Math.min(y, tipY), stemT, len);
      if (duration === "eighth" && opts?.inBeam !== true) {
        // Флаг сажается на кончик штиля: вверх — справа от штиля, вниз — слева
        // (нота под ребром флага не имеет — плашку рисует drawBeam).
        this.drawGlyph(FLAG_CODEPOINTS[dir], dir === "up" ? stemX + stemT : stemX, tipY, dir === "up" ? "left" : "right");
      }
    }
    ctx.restore();
  }

  /**
   * Пауза той же длительности. Позиции по SMuFL (research 05 §1): целая —
   * висит под второй линией сверху (baseline на позиции 6), остальные — на
   * средней линии (позиция 4).
   */
  drawRest(duration: StaffDuration, x: number, opts?: GlyphDrawOptions): void {
    this.requireStaffGeometry();
    const { ctx } = this;
    const topY = opts?.topY ?? this.staffTopY;
    const y = topY + ((TOP_LINE_POS - restBaselinePos(duration)) * this.spacePx) / 2;
    ctx.save();
    this.applyInk(opts?.highlight === true ? HIGHLIGHT_NEXT_COLOR : COLORS.ink, opts?.highlight === true, opts?.dim === true);
    this.drawGlyph(REST_BY_DURATION[duration], x, y, "center");
    ctx.restore();
  }

  /**
   * Тактовая черта U+E030: тонкая линия 0.16 межлинейного на всю высоту стана;
   * x — левый край, topY — верхняя линия (по умолчанию — геометрия).
   */
  drawBarline(x: number, topY: number = this.staffTopY): void {
    this.requireStaffGeometry();
    const t = THIN_BARLINE_THICKNESS_SPACES * this.spacePx;
    this.ctx.fillStyle = COLORS.ink;
    this.ctx.fillRect(x, topY, t, this.spacePx * (STAFF_LINE_COUNT - 1));
  }

  /**
   * Размер: цифры 0–9 (U+E080…E089, по 0.5 em — два межлинейных, центрированы
   * на baseline). Числитель — в верхней половине стана, знаменатель — в нижней.
   */
  drawTimeSignature(numer: number, denom: number, x: number, topY: number = this.staffTopY): void {
    this.requireStaffGeometry();
    const { ctx } = this;
    const yNumer = topY + ((TOP_LINE_POS - TIMESIG_NUMERATOR_POS) * this.spacePx) / 2;
    const yDenom = topY + ((TOP_LINE_POS - TIMESIG_DENOMINATOR_POS) * this.spacePx) / 2;
    ctx.save();
    this.applyInk(COLORS.ink, false);
    this.drawGlyph(this.timeSigDigit(numer), x, yNumer, "center");
    this.drawGlyph(this.timeSigDigit(denom), x, yDenom, "center");
    ctx.restore();
  }

  /**
   * Ребро (beam) восьмых: плашка толщиной 0.5 межлинейного от точки (x1, y1)
   * до (x2, y2) — по умолчанию горизонтальна (y1 = y2 = кончик штиля),
   * лёгкий наклон допустим: пары с разным шагом нот плашка соединяет по
   * среднему кончику (штиль дорисовывает stemTipY у drawNote). Объединение
   * больше двух нот — v2.
   */
  drawBeam(x1: number, y1: number, x2: number, y2: number): void {
    this.requireStaffGeometry();
    const { ctx } = this;
    const t = BEAM_THICKNESS_SPACES * this.spacePx;
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (!(len > 0)) return;
    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(Math.atan2(y2 - y1, x2 - x1));
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(0, -t / 2, len, t);
    ctx.restore();
  }

  /**
   * Маркер текущей позиции (тетрадь, SPEC §4.10: позиция очевидна всегда):
   * тонкая вертикальная линия accent над станом у текущей ноты.
   */
  drawPositionMarker(x: number, topY: number): void {
    this.requireStaffGeometry();
    const ss = this.spacePx;
    const ctx = this.ctx;
    ctx.fillStyle = HIGHLIGHT_NEXT_COLOR;
    ctx.fillRect(x - ss * 0.08, topY - ss * 1.7, ss * 0.16, ss * 0.9);
  }

  /**
   * Отметки промахов под нотой (тетрадь, SPEC §4.10: «отметка промаха на ноте,
   * счёт попыток»): до 3 точек --error; больше — точки и «×N» рядом.
   */
  drawMissDots(x: number, y: number, count: number): void {
    this.requireStaffGeometry();
    if (count <= 0) return;
    const ss = this.spacePx;
    const ctx = this.ctx;
    const r = Math.max(1.5, ss * 0.14);
    const shown = Math.min(count, 3);
    ctx.fillStyle = COLORS.error;
    for (let i = 0; i < shown; i += 1) {
      const cx = x + (i - (shown - 1) / 2) * r * 3;
      ctx.beginPath();
      ctx.arc(cx, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (count > 3) {
      this.drawLabel(`×${count}`, x, y + r * 3, { color: COLORS.error, sizePx: Math.max(9, Math.round(ss * 0.7)) });
    }
  }

  /** Подпись обычным системным шрифтом (не Bravura): имена нот, названия карточек. */
  drawLabel(text: string, x: number, y: number, opts?: LabelOptions): void {
    const { ctx } = this;
    ctx.fillStyle = opts?.color ?? COLORS.label;
    ctx.font = `${opts?.weight ?? 500} ${opts?.sizePx ?? 12}px system-ui, sans-serif`;
    ctx.textAlign = opts?.align ?? "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, x, y);
  }

  // --- приватное ---

  private requireStaffGeometry(): void {
    if (!(this.spacePx > 0)) throw new Error("Геометрия стана не задана — вызовите setStaffGeometry()");
  }

  /** Размер шрифта Bravura = высота стана (SMuFL: 1 межлинейное = 0.25 em). */
  private bravuraFont(): string {
    return `${this.spacePx * (STAFF_LINE_COUNT - 1)}px ${BRAVURA_FAMILY}`;
  }

  private applyInk(color: string, highlight: boolean, dim = false): void {
    const { ctx } = this;
    ctx.fillStyle = color;
    if (dim) {
      // Приглушение будущих нот тетради: alpha 0.6 — читаемее, штили не
      // «теряются» (0.4 как disabled оказался слишком бледным — запрос игрока).
      ctx.globalAlpha = 0.6;
    }
    if (highlight) {
      // Лёгкое свечение подсветки (тень канваса) вокруг глифов ноты/паузы.
      ctx.shadowColor = HIGHLIGHT_NEXT_COLOR;
      ctx.shadowBlur = this.spacePx * 0.8;
    }
  }

  private drawGlyph(codepoint: number, x: number, y: number, align: CanvasTextAlign): void {
    const { ctx } = this;
    ctx.font = this.bravuraFont();
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(String.fromCodePoint(codepoint), x, y);
  }

  private glyphWidth(codepoint: number): number {
    const cached = this.glyphWidthCache.get(codepoint);
    if (cached !== undefined) return cached;
    this.ctx.font = this.bravuraFont();
    const width = this.ctx.measureText(String.fromCodePoint(codepoint)).width;
    this.glyphWidthCache.set(codepoint, width);
    return width;
  }

  private timeSigDigit(digit: number): number {
    if (!Number.isInteger(digit) || digit < 0 || digit > 9) throw new RangeError(`Цифра размера вне 0–9: ${digit}`);
    return SMUFL.timeSig0 + digit;
  }
}
