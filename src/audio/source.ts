/**
 * Общий интерфейс источника звука пресета (ADR-002): сэмпловые и
 * синтезаторные пресеты реализуют его, движок не знает их внутренностей.
 * Всё время — аудио-часы в секундах (инвариант GLOSSARY #2).
 */
import type { PresetId } from "../core/types";

export interface InstrumentSource {
  readonly presetId: PresetId;

  /** Запуск голоса. velocity — MIDI 1–127. */
  noteOn(pitch: number, velocity: number, timeSec: number): void;

  /**
   * Гейт-рампа последнего голоса питча — звук НЕ обрывается (ADR-002 п.6).
   * fadeSec — желаемая длительность затухания; синтезаторные пресеты могут
   * отдать предпочтение собственной ADSR-высвой release.
   */
  noteOff(pitch: number, timeSec: number, fadeSec: number): void;

  /** Заглушить все голоса источника. */
  allOff(timeSec: number, fadeSec: number): void;

  /**
   * Отмена запланированных нот (PIANO-23): голоса со временем старта
   * ≥ fromSec (аудио-время) не должны прозвучать вовсе — хвост автоплея
   * или диктанта после ухода со сцены. Уже звучащие голоса (старт < fromSec)
   * не затрагиваются: их завершают обычные noteOff/allOff.
   */
  cancelScheduled(fromSec: number): void;

  /** Освободить ресурсы источника. */
  dispose(): void;
}
