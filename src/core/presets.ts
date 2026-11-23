/**
 * Пресеты (тембры) — общий список и русские имена (GLOSSARY: пресет (тембр),
 * SPEC §4.6). Единый источник для панели «Тембр», настроек и HUD.
 */
import type { PresetId } from "./types";

export const PRESET_ORDER: ReadonlyArray<PresetId> = ["piano", "organ", "synthLead", "bass"];

export const PRESET_NAMES: Record<PresetId, string> = {
  piano: "Фортепиано",
  organ: "Орган",
  synthLead: "Синт-лид",
  bass: "Бас",
};
