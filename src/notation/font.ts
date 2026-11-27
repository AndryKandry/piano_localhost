/**
 * Загрузчик шрифта Bravura (SMuFL) для «Азбуки» (ADR-007).
 *
 * Пакет @fontsource/bravura отдаёт один файл `bravura-latin-400-normal.woff2`
 * (~313 КБ): «latin» здесь — просто имя сабсета конвейера fontsource, сам
 * файл полный — PUA-кодпоинты SMuFL U+E0xx проверены разбором cmap
 * (U+E050 скрипичный ключ, U+E062 басовый ключ, U+E0A2–E0A4 головки,
 * U+E240 флаг, U+E4E3–E4E6 паузы, U+E080–E089 цифры размера — все
 * присутствуют). Vite отдаёт импортированный woff2 как ассет-URL (313 КБ ≫
 * лимита инлайна 4 КБ) — в бандл шрифт не попадает.
 *
 * Загрузка через FontFace API (research 05 §1): `new FontFace("Bravura", url)`
 * → `load()` → `document.fonts.add`. Обещание кэшируется — фактическая
 * загрузка ровно одна за сессию; при провале кэш сбрасывается, чтобы
 * следующее обращение могло повторить попытку.
 */
import bravuraWoff2Url from "@fontsource/bravura/files/bravura-latin-400-normal.woff2";

/** Имя семейства под которым шрифт регистрируется (использует renderer: `<em>px Bravura`). */
export const BRAVURA_FAMILY = "Bravura";

let bravuraPromise: Promise<void> | null = null;

/** Дождаться готовности шрифта; идемпотентно — повторные вызовы ждут того же обещания. */
export function ensureBravura(): Promise<void> {
  bravuraPromise ??= loadBravura().catch((error: unknown) => {
    bravuraPromise = null; // провал не кэшируем — повторный вызов попробует снова
    throw error;
  });
  return bravuraPromise;
}

async function loadBravura(): Promise<void> {
  if (typeof document === "undefined") {
    throw new Error("FontFace API недоступен: загрузка Bravura возможна только в браузере");
  }
  const font = new FontFace(BRAVURA_FAMILY, `url(${bravuraWoff2Url})`);
  const loaded = await font.load();
  document.fonts.add(loaded);
}
