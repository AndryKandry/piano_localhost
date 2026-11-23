/**
 * Цвета партий и подсветки. Цвета партий — из настроек (SPEC §4.8):
 * значения мутируются applyPartyColors при старте и при смене настройки;
 * рендеры читают их каждый кадр/перерисовку.
 */

/** Цвета колонок нот и мягкой подсветки автопартии по партиям рук. */
export const PARTY_COLORS = {
  right: "#4da3ff",
  left: "#ff9d5c",
};

/** Применить цвета партий из настроек (вызывает main при смене настроек). */
export function applyPartyColors(colors: { right: string; left: string }): void {
  PARTY_COLORS.right = colors.right;
  PARTY_COLORS.left = colors.left;
}

/** Подсветка «жми-сейчас» (яркая, инвариант GLOSSARY #5). */
export const HIGHLIGHT_NEXT_COLOR = "#ffd166";
/** Вспышка попадания на линии удара. */
export const HIT_FLASH_COLOR = "#ffe9a8";
