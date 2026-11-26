/**
 * Рендер гриф-диаграммы гитары для гитарного раздела «Азбуки» (research 06
 * §3, §6 п.4): третий слой карточки-подсказки — «эта записанная нота = 2-я
 * струна, I лад». Вопрос и ответ остаются «стан → роя»; диаграмма ничего не
 * судит и не принимает ввода.
 *
 * Ориентация — горизонтальный гриф (формат тренажёров одиночных нот):
 * 1-я (высокая E) — верхняя струна, вниз к 6-й (низкой E); лады 0–4 слева
 * направо, нут — толстая вертикаль слева, открытая нота — кружок у нулевого
 * порога. Слева — буквы открытых струн. Подсветка — кружок-палец на
 * (струна, лад) с цифрой лада (fretLabel: 0 = открытая).
 *
 * Стиль как в src/render/* и src/notation/renderer.ts: Retina-буфер
 * (CSS × devicePixelRatio), рисование в CSS-px через ctx.setTransform,
 * перерисовка по событию. Геометрия — чистая функция layoutFretboard
 * (node-тестируемая, как src/notation/geometry.ts).
 */
import {
  FIRST_POSITION_FRETS,
  STRING_COUNT,
  STRING_LETTERS,
  fretLabel,
  isValidGuitarNote,
  type GuitarNote,
} from "../core/fretboard";
import { HIGHLIGHT_NEXT_COLOR } from "./colors";

/**
 * Канвас-константы — копии токенов design-system (§2.1–2.2; файл DS —
 * источник значений, CSS-переменные :root здесь не читаются — §6).
 */
const COLORS = {
  background: "#141821", // --panel: подложка диаграммы (design-system §2.2)
  string: "#e9e7e2", // notation-ink: струны и нут (design-system §2.2, 14.4:1 на panel)
  fret: "#2a3244", // --border: порожки — контур диаграммы (design-system §2.1)
  label: "#8a91a0", // notation-label: буквы открытых струн (design-system §2.2, 5.6:1)
  onAccent: "#141821", // --on-accent: цифра лада на янтарном кружке (design-system §2.1)
} as const;

/** Пороги геометрии грифа: отступы и пределы раздува (CSS-px). */
const PAD_X = 12; // отступ букв струн от левого края
const PAD_Y = 10; // минимальный отступ струн от верхнего/нижнего края
const MAX_STRING_GAP = 26; // межструнное не раздувается выше — диаграмма не растягивается на весь канвас
const MIN_STRING_GAP = 10;
const WIRE_OVERHANG = 0.6; // порожки и нут выступают за крайние струны (доли межструнного)
const STRING_TAIL = 0.12; // струны выходят за последний порожек (доли ширины лада)

/** Чистая геометрия диаграммы в CSS-px — считает layoutFretboard. */
export interface FretboardGeometry {
  width: number;
  height: number;
  /** y струн 1..6 (индекс 0 = 1-я, верхняя). */
  stringYs: readonly number[];
  /** Толщина струн 1..6: 1-я тоньше, басовые толще (индекс 0 = 1-я). */
  stringWidths: readonly number[];
  /** x нута (нулевой порожек) — центр кружка открытой ноты. */
  nutX: number;
  /** x порожков ладов 1..4 (индекс 0 = граница I лада). */
  fretXs: readonly number[];
  /** Ширина одного лада, CSS-px. */
  fretSpacing: number;
  /** Радиус кружка-пальца, CSS-px (не наезжает на соседнюю струну). */
  fingerRadius: number;
  /** x букв открытых струн (левый край подписи). */
  labelX: number;
  /** Верх/низ порожков и нута — с выступом за крайние струны. */
  wireTop: number;
  wireBottom: number;
  /** Длина струны от нута вправо — до последнего порожка и хвост. */
  stringLength: number;
}

/**
 * Геометрия горизонтального грифа под CSS-размер канваса. Слева — полоса
 * букв открытых струн, зона кружка открытой ноты, нут, затем 4 лада; справа
 * — небольшой хвост струн. На узком канвасе нут прижимается к середине,
 * лады не сжимаются ниже минимума (диаграмма может обрезаться — валидный
 * размер даёт вызывающая сторона).
 */
export function layoutFretboard(width: number, height: number): FretboardGeometry {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));

  const gap = Math.min(MAX_STRING_GAP, Math.max(MIN_STRING_GAP, (h - 2 * PAD_Y) / (STRING_COUNT - 1)));
  const neckH = gap * (STRING_COUNT - 1);
  const topY = (h - neckH) / 2;
  const stringYs: number[] = [];
  for (let s = 1; s <= STRING_COUNT; s += 1) stringYs.push(topY + (s - 1) * gap);

  // Калибровка струн реального грифа: 1-я тоньше, басовые толще.
  const stringWidths: number[] = [];
  for (let s = 1; s <= STRING_COUNT; s += 1) stringWidths.push(1.2 + (s - 1) * 0.34);

  const labelX = Math.min(PAD_X, w * 0.04);
  const nutX = Math.min(Math.max(22, w * 0.08) + Math.max(16, w * 0.05), w / 2);
  const fretSpacing = Math.max(20, (w - Math.max(10, w * 0.03) - nutX) / FIRST_POSITION_FRETS);
  const fretXs: number[] = [];
  for (let f = 1; f <= FIRST_POSITION_FRETS; f += 1) fretXs.push(nutX + f * fretSpacing);

  return {
    width: w,
    height: h,
    stringYs,
    stringWidths,
    nutX,
    fretXs,
    fretSpacing,
    fingerRadius: Math.min(gap, fretSpacing) * 0.38,
    labelX,
    wireTop: topY - gap * WIRE_OVERHANG,
    wireBottom: topY + neckH + gap * WIRE_OVERHANG,
    stringLength: fretSpacing * (FIRST_POSITION_FRETS + STRING_TAIL),
  };
}

/** x центра кружка-пальца для лада f: 0 — на нуте («у нулевого порога»), 1–4 — центр промежутка. */
export function fingerCircleX(geo: FretboardGeometry, fret: number): number {
  return fret === 0 ? geo.nutX : geo.nutX + (fret - 0.5) * geo.fretSpacing;
}

export interface FretboardRenderOptions {
  /** Нота-подсказка: кружок-палец на (струна, лад) с цифрой лада. Не задана/null — чистый гриф. */
  highlight?: GuitarNote | null;
  /**
   * Приглушение подсказки (после ответа): alpha 0.6 на всей диаграмме —
   * как dim нотации (src/notation/renderer.ts applyInk).
   */
  dim?: boolean;
}

export class FretboardRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvasEl: HTMLCanvasElement;
  private cssWidth = 0;
  private cssHeight = 0;

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

  /** Нарисовать диаграмму грифа на текущем CSS-размере (см. FretboardRenderOptions). */
  render(opts: FretboardRenderOptions = {}): void {
    const geo = layoutFretboard(this.cssWidth, this.cssHeight);
    const { ctx } = this;

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, geo.width, geo.height);

    ctx.save();
    if (opts.dim === true) ctx.globalAlpha = 0.6;

    // Струны: от нута вправо, толщина растёт к басу.
    ctx.fillStyle = COLORS.string;
    for (let s = 1; s <= STRING_COUNT; s += 1) {
      const t = geo.stringWidths[s - 1];
      ctx.fillRect(geo.nutX, geo.stringYs[s - 1] - t / 2, geo.stringLength, t);
    }

    // Порожки ладов 1–4 — поверх струн.
    ctx.fillStyle = COLORS.fret;
    for (const fx of geo.fretXs) ctx.fillRect(fx - 0.5, geo.wireTop, 1, geo.wireBottom - geo.wireTop);

    // Нут — толстая вертикаль чернилами струн: граница «открыто/прижато».
    ctx.fillStyle = COLORS.string;
    ctx.fillRect(geo.nutX - 2, geo.wireTop, 4, geo.wireBottom - geo.wireTop);

    // Буквы открытых струн слева (E B G D A E).
    ctx.fillStyle = COLORS.label;
    ctx.font = `500 ${Math.min(12, Math.max(9, Math.round(geo.fingerRadius * 1.5)))}px system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (let s = 1; s <= STRING_COUNT; s += 1) {
      ctx.fillText(STRING_LETTERS[s - 1], geo.labelX, geo.stringYs[s - 1]);
    }

    // Кружок-палец на (струна, лад) с цифрой лада; лад 0 — у нулевого порога.
    const note = opts.highlight;
    if (note) {
      if (!isValidGuitarNote(note)) {
        throw new RangeError(`Подсветка вне I позиции (струна 1–${STRING_COUNT}, лад 0–${FIRST_POSITION_FRETS})`);
      }
      const cx = fingerCircleX(geo, note.fret);
      const cy = geo.stringYs[note.string - 1];
      ctx.fillStyle = HIGHLIGHT_NEXT_COLOR; // --accent (design-system §6)
      ctx.beginPath();
      ctx.arc(cx, cy, geo.fingerRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.onAccent;
      ctx.font = `600 ${Math.min(13, Math.max(9, Math.round(geo.fingerRadius * 1.2)))}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(fretLabel(note.fret), cx, cy);
    }

    ctx.restore();
  }
}
