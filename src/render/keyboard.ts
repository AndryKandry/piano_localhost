/**
 * Рендер экранных клавиш на нижнем канвасе (ADR-004): Canvas 2D,
 * перерисовка по событию (нажатие/сдвиг), Retina — буфер = CSS × devicePixelRatio,
 * рисование в CSS-пикселях через ctx.scale(dpr, dpr).
 */
import type { KeyboardLayout } from "../core/layout";
import { pitchName } from "../core/layout";

export interface KeyboardRenderState {
  /** Зажатые сейчас питчи — яркая подсветка («жму-сейчас»). */
  pressed: ReadonlySet<number>;
  /** Подпись физической клавиши по питчу (из маппинга). */
  labelByPitch: ReadonlyMap<number, string>;
  /** Имена нот на клавишах (настройка SPEC 4.8, по умолчанию вкл). */
  showNoteNames: boolean;
}

const COLORS = {
  background: "#141821",
  whiteKey: "#e9e7e2",
  whiteKeyPressed: "#ffd166",
  whiteBorder: "#0b0e13",
  blackKey: "#232a38",
  blackKeyPressed: "#ffb020",
  blackBorder: "#05070b",
  whiteLabel: "#3a4050",
  whiteNoteName: "#8a91a0",
  blackLabel: "#c9cfdd",
  blackNoteName: "#97a0b4",
} as const;

export class KeyboardRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private cssWidth = 0;
  private cssHeight = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D недоступен");
    this.ctx = ctx;
  }

  /** CSS-размер, под который последний раз считался буфер. */
  get size(): { width: number; height: number } {
    return { width: this.cssWidth, height: this.cssHeight };
  }

  /**
   * Пересоздать буфер под CSS-размер × devicePixelRatio (ADR-004 п.4).
   * Возвращает true, если размер изменился и нужен перерасчёт раскладки.
   */
  resize(): boolean {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const dpr = window.devicePixelRatio || 1;
    const bufferW = Math.round(w * dpr);
    const bufferH = Math.round(h * dpr);
    const unchanged =
      this.cssWidth === w && this.cssHeight === h && this.canvas.width === bufferW && this.canvas.height === bufferH;
    if (unchanged) return false;
    this.canvas.width = bufferW;
    this.canvas.height = bufferH;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssWidth = w;
    this.cssHeight = h;
    return true;
  }

  render(layout: KeyboardLayout, state: KeyboardRenderState): void {
    const { ctx } = this;
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, layout.width, layout.height);

    // Белые клавиши (чёрные поверх них).
    for (const key of layout.keys) {
      if (key.isBlack) continue;
      const pressed = state.pressed.has(key.pitch);
      ctx.fillStyle = pressed ? COLORS.whiteKeyPressed : COLORS.whiteKey;
      ctx.fillRect(key.x, key.y, key.width, key.height);
      ctx.strokeStyle = COLORS.whiteBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(key.x + 0.5, key.y + 0.5, key.width - 1, key.height - 1);
    }
    // Подписи белых: физическая клавиша + имя ноты.
    for (const key of layout.keys) {
      if (key.isBlack) continue;
      this.drawKeyLabels(key, state, {
        labelColor: COLORS.whiteLabel,
        nameColor: COLORS.whiteNoteName,
        labelPx: Math.min(14, Math.max(9, key.width * 0.32)),
        namePx: Math.min(10, Math.max(8, key.width * 0.22)),
        labelBaseline: layout.height - 24,
        nameBaseline: layout.height - 9,
      });
    }

    // Чёрные клавиши.
    for (const key of layout.keys) {
      if (!key.isBlack) continue;
      const pressed = state.pressed.has(key.pitch);
      ctx.fillStyle = pressed ? COLORS.blackKeyPressed : COLORS.blackKey;
      ctx.fillRect(key.x, key.y, key.width, key.height);
      ctx.strokeStyle = COLORS.blackBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(key.x + 0.5, key.y + 0.5, key.width - 1, key.height - 1);
      this.drawKeyLabels(key, state, {
        labelColor: COLORS.blackLabel,
        nameColor: COLORS.blackNoteName,
        labelPx: Math.min(11, Math.max(8, key.width * 0.4)),
        namePx: Math.min(9, Math.max(7, key.width * 0.3)),
        labelBaseline: key.height - 8,
        nameBaseline: key.height - 22,
      });
    }
  }

  private drawKeyLabels(
    key: { pitch: number; x: number; width: number; height: number },
    state: KeyboardRenderState,
    style: {
      labelColor: string;
      nameColor: string;
      labelPx: number;
      namePx: number;
      labelBaseline: number;
      nameBaseline: number;
    },
  ): void {
    const cx = key.x + key.width / 2;
    const physLabel = state.labelByPitch.get(key.pitch);
    if (physLabel !== undefined) {
      this.ctx.fillStyle = style.labelColor;
      this.ctx.font = `600 ${style.labelPx}px system-ui, sans-serif`;
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "alphabetic";
      this.ctx.fillText(physLabel, cx, style.labelBaseline);
    }
    if (state.showNoteNames) {
      this.ctx.fillStyle = style.nameColor;
      this.ctx.font = `${style.namePx}px system-ui, sans-serif`;
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "alphabetic";
      this.ctx.fillText(pitchName(key.pitch), cx, style.nameBaseline);
    }
  }
}
