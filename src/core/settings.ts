/**
 * Настройки приложения (SPEC §4.8): localStorage, JSON, версионируются.
 * Цвета партий, подписи нот, окно попадания, громкость, пресет по умолчанию,
 * показ счёта. Чтение всегда через normalizeSettings: частичный/битый JSON
 * и значения из будущих версий дают валидный объект с дефолтами.
 *
 * Хранилище внедряется конструктором (node-смоук подставляет in-memory),
 * по умолчанию — window.localStorage; недоступен (node/приватный режим) —
 * настройки живут в памяти сессии.
 */
import type { PresetId } from "./types";

/** Цвета партий рук (GLOSSARY: партия руки) — колонки нот и мягкая подсветка. */
export interface PartyColors {
  right: string;
  left: string;
}

export interface Settings {
  partyColors: PartyColors;
  /** Имена нот на экранных клавишах (SPEC §4.1). */
  showNoteNames: boolean;
  /** Окно попадания ±мс (SPEC §4.3: ±50–300). */
  hitWindowMs: number;
  /** Громкость мастера, 0–1. */
  volume: number;
  /** Пресет (тембр), включаемый при старте приложения. */
  defaultPreset: PresetId;
  /** Показ счёта: живой в HUD и экран итогов попытки (SPEC §4.8). */
  showScore: boolean;
}

export const SETTINGS_VERSION = 1;

export const HIT_WINDOW_MIN_MS = 50;
export const HIT_WINDOW_MAX_MS = 300;

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  partyColors: { right: "#4da3ff", left: "#ff9d5c" },
  showNoteNames: true,
  hitWindowMs: 150,
  volume: 1,
  defaultPreset: "piano",
  showScore: true,
};

const STORAGE_KEY = "piano.settings";
const PRESET_IDS: ReadonlyArray<PresetId> = ["piano", "organ", "synthLead", "bass"];
const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function clampNumber(raw: unknown, min: number, max: number, fallback: number): number {
  const value = typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeColor(raw: unknown, fallback: string): string {
  return typeof raw === "string" && HEX_COLOR.test(raw) ? raw : fallback;
}

/** Сырые данные (JSON хранилища или патч) → валидные настройки с дефолтами. */
export function normalizeSettings(raw: unknown): Settings {
  const src = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const party = (typeof src.partyColors === "object" && src.partyColors !== null ? src.partyColors : {}) as Record<string, unknown>;
  const preset = src.defaultPreset;
  return {
    partyColors: {
      right: normalizeColor(party.right, DEFAULT_SETTINGS.partyColors.right),
      left: normalizeColor(party.left, DEFAULT_SETTINGS.partyColors.left),
    },
    showNoteNames: typeof src.showNoteNames === "boolean" ? src.showNoteNames : DEFAULT_SETTINGS.showNoteNames,
    hitWindowMs: clampNumber(src.hitWindowMs, HIT_WINDOW_MIN_MS, HIT_WINDOW_MAX_MS, DEFAULT_SETTINGS.hitWindowMs),
    volume: clampNumber(src.volume, 0, 1, DEFAULT_SETTINGS.volume),
    defaultPreset:
      typeof preset === "string" && (PRESET_IDS as ReadonlyArray<string>).includes(preset)
        ? (preset as PresetId)
        : DEFAULT_SETTINGS.defaultPreset,
    showScore: typeof src.showScore === "boolean" ? src.showScore : DEFAULT_SETTINGS.showScore,
  };
}

function cloneSettings(source: Readonly<Settings>): Settings {
  return { ...source, partyColors: { ...source.partyColors } };
}

type SettingsListener = (settings: Settings) => void;

export class SettingsStore {
  private data: Settings;
  private readonly listeners = new Set<SettingsListener>();
  private readonly storage: SettingsStorage | null;

  constructor(storage: SettingsStorage | null = defaultStorage()) {
    this.storage = storage;
    this.data = this.storage ? this.load() : cloneSettings(DEFAULT_SETTINGS);
  }

  /** Текущие настройки. Считается read-only: изменения — только через update(). */
  get(): Readonly<Settings> {
    return this.data;
  }

  /**
   * Частичный патч → нормализация → подписчикам. partyColors мержится
   * поглубже: { partyColors: { right } } не затирает левую руку.
   */
  update(patch: Partial<Omit<Settings, "partyColors">> & { partyColors?: Partial<PartyColors> }): Settings {
    const merged = {
      ...this.data,
      ...patch,
      partyColors: { ...this.data.partyColors, ...(patch.partyColors ?? {}) },
    };
    this.data = normalizeSettings(merged);
    this.persist();
    for (const listener of this.listeners) listener(this.data);
    return this.data;
  }

  /** Подписка на изменения; возвращает отписку. */
  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Сброс к дефолтам. */
  reset(): Settings {
    return this.update(DEFAULT_SETTINGS);
  }

  private load(): Settings {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (raw === null || raw === undefined) return cloneSettings(DEFAULT_SETTINGS);
      return normalizeSettings(JSON.parse(raw));
    } catch {
      return cloneSettings(DEFAULT_SETTINGS);
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify({ version: SETTINGS_VERSION, ...this.data }));
    } catch {
      // Квота/приватный режим: настройки не сохранятся, играть можно.
    }
  }
}

function defaultStorage(): SettingsStorage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

/** Единственный экземпляр на приложение (смоук создаёт свои с in-memory хранилищем). */
export const settings = new SettingsStore();
