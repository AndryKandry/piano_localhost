/**
 * Пресеты (тембры) — общий список и русские имена (GLOSSARY: пресет (тембр),
 * SPEC §4.6). Единый источник для панели «Тембр», настроек и HUD.
 *
 * Порядок панели «Тембр»: клавишные/сэмпловые сверху, затем синтезаторные.
 * Полнота списка гарантируется типом Record<PresetId, string> у PRESET_NAMES.
 */
import type { PresetId } from "./types";

export const PRESET_ORDER: ReadonlyArray<PresetId> = [
  "piano",
  "epiano",
  "guitar",
  "strings",
  "flute",
  "organ",
  "synthLead",
  "bass",
];

/** Те же ids без порядка — валидация defaultPreset в настройках. */
export const PRESET_IDS: ReadonlyArray<PresetId> = PRESET_ORDER;

export const PRESET_NAMES: Record<PresetId, string> = {
  piano: "Фортепиано",
  epiano: "Электропиано",
  guitar: "Гитара",
  strings: "Струнные",
  flute: "Флейта",
  organ: "Орган",
  synthLead: "Синт-лид",
  bass: "Бас",
};
