/**
 * Публичный API модуля «Азбука» — переиспользуемый рендер нотной грамоты
 * (ADR-007). Никакой логики уроков (очередь 2): только шрифт, геометрия и
 * рисунок на канвасе.
 *
 * Типовой сценарий очереди 2:
 *   await ensureBravura();
 *   const r = new NotationRenderer(canvas);
 *   r.resize(); r.setStaffGeometry(top, space);
 *   r.clear(); r.drawStaff(x, w); r.drawTimeSignature(4, 4, x); r.drawNote(64, "quarter", x);
 *   // клик по стану: yToPitch(y, r.staffTop, r.staffSpace)
 */
export { BRAVURA_FAMILY, ensureBravura } from "./font";
export { NotationRenderer, NOTATION_INK, type GlyphDrawOptions, type LabelOptions } from "./renderer";
export * from "./geometry";
