/**
 * Smoke-проверка UI-логики очереди 4 без браузера и DOM: настройки
 * (нормализация, roundtrip localStorage, подписки, частичные патчи) и
 * пересборка партий по порогу сплита (клоны, счётчики, инвариант
 * «библиотечный оригинал не мутируется»). Запуск: npm run smoke:ui.
 *
 * Канвасы и DOM-панели здесь не тестируются — они требуют живой браузер.
 */
import {
  DEFAULT_SETTINGS,
  HIT_WINDOW_MAX_MS,
  HIT_WINDOW_MIN_MS,
  normalizeSettings,
  SettingsStore,
  SETTINGS_VERSION,
  type SettingsStorage,
} from "../src/core/settings";
import { countHandNotes, cloneMelody, clampSplitPoint, resplitMelody, SPLIT_MAX, SPLIT_MIN } from "../src/library/split";
import { PRESET_NAMES, PRESET_ORDER } from "../src/core/presets";
import type { Melody, Note } from "../src/core/types";

let checks = 0;
function assert(condition: boolean, message: string): void {
  checks += 1;
  if (!condition) throw new Error(`ПРОВАЛ: ${message}`);
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message} (ожидалось ${String(expected)}, получено ${String(actual)})`);
}
function assertApprox(actual: number, expected: number, message: string, eps = 1e-9): void {
  assert(Math.abs(actual - expected) < eps, `${message} (ожидалось ~${expected}, получено ${actual})`);
}

/** In-memory хранилище вместо localStorage (в node его нет). */
function memoryStorage(): SettingsStorage & { dump(): string } {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    dump: () => map.get("piano.settings") ?? "",
  };
}

function note(pitch: number, startTimeSec: number, durationSec = 0.5, handPart: "right" | "left" = "right"): Note {
  return { pitch, startTimeSec, durationSec, handPart, velocity: 90 };
}

function melody(notes: readonly Note[]): Melody {
  return {
    id: "smoke:split",
    title: "Smoke",
    composer: "Smoke",
    notes: [...notes],
    tempoMap: [{ timeSec: 0, bpm: 120 }],
    durationSec: 4,
    splitPoint: 60,
  };
}

// --- 1. Нормализация настроек: клампы и мусор ---

function testNormalize(): void {
  console.log("Нормализация настроек:");
  const normalized = normalizeSettings({
    hitWindowMs: 9999,
    volume: -3,
    defaultPreset: "accordion",
    partyColors: { right: "red", left: "#abc" },
    showNoteNames: "да",
  });
  assertEqual(normalized.hitWindowMs, HIT_WINDOW_MAX_MS, "окно попадания клампится к максимуму");
  assertEqual(normalized.volume, 0, "громкость клампится к минимуму");
  assertEqual(normalized.defaultPreset, DEFAULT_SETTINGS.defaultPreset, "неизвестный пресет → дефолт");
  assertEqual(normalized.partyColors.right, DEFAULT_SETTINGS.partyColors.right, "битый цвет правой → дефолт");
  assertEqual(normalized.partyColors.left, "#abc", "короткий hex допустим");

  assertEqual(normalizeSettings(null).hitWindowMs, DEFAULT_SETTINGS.hitWindowMs, "null → дефолты");
  assertEqual(normalizeSettings("мусор").volume, DEFAULT_SETTINGS.volume, "строка → дефолты");
  assertEqual(
    normalizeSettings({ hitWindowMs: 10 }).hitWindowMs,
    HIT_WINDOW_MIN_MS,
    "окно попадания клампится к минимуму 50 мс",
  );
  console.log("  OK: клампы окна/громкости, пресет, цвета, не-объекты");
}

// --- 2. Roundtrip: persist → новый store читает то же ---

function testRoundtrip(): void {
  console.log("Roundtrip настроек:");
  const storage = memoryStorage();
  const store = new SettingsStore(storage);
  assertEqual(store.get().hitWindowMs, DEFAULT_SETTINGS.hitWindowMs, "старт с дефолтов");

  const unsubscribe = store.subscribe(() => {
    assert(false, "подписчик не должен сработать без update");
  });
  unsubscribe();

  let notified: number | null = null;
  store.subscribe((next) => {
    notified = next.volume;
  });

  store.update({ volume: 0.5, hitWindowMs: 220, defaultPreset: "organ", partyColors: { right: "#12abef" } });
  assertEqual(notified, 0.5, "подписчик получил update");
  assertEqual(store.get().partyColors.right, "#12abef", "цвет правой применён");

  // Частичный патч partyColors НЕ затирает вторую руку.
  assertEqual(store.get().partyColors.left, DEFAULT_SETTINGS.partyColors.left, "левая рука пережила частичный патч");

  const persisted = JSON.parse(storage.dump()) as Record<string, unknown>;
  assertEqual(persisted.version, SETTINGS_VERSION, "JSON версионирован");
  assertEqual(persisted.defaultPreset, "organ", "пресет сохранён");

  // Новый store над тем же хранилищем видит изменения; битый JSON → дефолты.
  const reloaded = new SettingsStore(storage);
  assertEqual(reloaded.get().defaultPreset, "organ", "roundtrip: пресет восстановлен");
  assertApprox(reloaded.get().volume, 0.5, "roundtrip: громкость восстановлена");
  assertEqual(new SettingsStore(memoryStorage()).get().showScore, DEFAULT_SETTINGS.showScore, "пустое хранилище → дефолты");

  const corrupt = memoryStorage();
  corrupt.setItem("piano.settings", "{битый json");
  assertEqual(new SettingsStore(corrupt).get().volume, DEFAULT_SETTINGS.volume, "битый JSON → дефолты");

  // Reset возвращает дефолты и persist-ит их.
  reloaded.reset();
  assertEqual(reloaded.get().hitWindowMs, DEFAULT_SETTINGS.hitWindowMs, "reset вернул дефолт окна");

  // Отсутствие хранилища (node/приватный режим) — сессия в памяти.
  const ephemeral = new SettingsStore(null);
  ephemeral.update({ volume: 0.25 });
  assertApprox(ephemeral.get().volume, 0.25, "без хранилища update работает в памяти");
  console.log("  OK: persist/reload, частичные патчи, версии, битый JSON, безхранилищный режим");
}

// --- 3. Пересборка партий по порогу сплита ---

function testSplit(): void {
  console.log("Разбор партий:");
  assertEqual(SPLIT_MIN, 48, "нижняя граница порога C3");
  assertEqual(SPLIT_MAX, 72, "верхняя граница порога C5");
  assertEqual(clampSplitPoint(10), 48, "порог клампится снизу");
  assertEqual(clampSplitPoint(200), 72, "порог клампится сверху");
  assertEqual(clampSplitPoint(59.6), 60, "порог округляется к целому питчу");
  assertEqual(clampSplitPoint(Number.NaN), 48, "NaN → нижняя граница");

  const original = melody([note(55, 0, 1, "right"), note(60, 1, 1, "right"), note(64, 2, 1, "left"), note(48, 3, 1, "left")]);

  // Порог 60: 48/55 → левая, 60/64 → правая, независимо от старых handPart.
  const resplit = resplitMelody(original, 60);
  assertEqual(resplit.notes[0]?.handPart, "left", "55 ниже порога — левая");
  assertEqual(resplit.notes[1]?.handPart, "right", "60 ≥ порога — правая");
  assertEqual(resplit.notes[2]?.handPart, "right", "64 — правая");
  assertEqual(resplit.notes[3]?.handPart, "left", "48 — левая");
  assertEqual(resplit.splitPoint, 60, "порог записан в мелодию");
  assertEqual(resplit.id, original.id, "id сохранён (счёт лучшей попытки не теряется)");

  // Оригинал не тронут: handPart и отсутствие мутаций.
  assertEqual(original.notes[0]?.handPart, "right", "оригинал: 55 остался right");
  assertEqual(original.notes[2]?.handPart, "left", "оригинал: 64 осталась left");
  assert(original.notes !== resplit.notes && original.notes[0] !== resplit.notes[0], "ноты скопированы, не переиспользованы");

  // cloneMelody — глубокая копия: мутация клона не видна оригиналу.
  const clone = cloneMelody(original);
  clone.notes[0].pitch = 127;
  clone.tempoMap[0].bpm = 999;
  assertEqual(original.notes[0]?.pitch, 55, "мутация клона не тронула оригинал (ноты)");
  assertEqual(original.tempoMap[0]?.bpm, 120, "мутация клона не тронула оригинал (темпы)");

  // Превью-счётчики согласованы с пересборкой.
  const counts = countHandNotes(original, 60);
  assertEqual(counts.left, 2, "счётчик левой");
  assertEqual(counts.right, 2, "счётчик правой");
  // Правило строгое (pitch < порога): нота 48 при пороге 48 остаётся справа.
  const edge = countHandNotes(original, 48);
  assertEqual(edge.left, 0, "порог 48: нота 48 не уходит влево (строго меньше)");
  assertEqual(edge.right, 4, "порог 48: все четыре справа");
  const lower = countHandNotes(original, 49);
  assertEqual(lower.left, 1, "порог 49: нота 48 уходит влево");
  assertEqual(resplitMelody(original, 49).notes[3]?.handPart, "left", "пересборка согласована со счётчиком");
  console.log("  OK: клампы порога, переназначение партий, копии, счётчики");
}

// --- 4. Согласованность справочника пресетов ---

function testPresets(): void {
  console.log("Пресеты:");
  assertEqual(PRESET_ORDER.length, 4, "четыре пресета v1");
  for (const id of PRESET_ORDER) {
    assert(PRESET_NAMES[id] !== undefined, `русское имя для ${id}`);
    assert(PRESET_NAMES[id].length > 0, `имя пресета ${id} не пустое`);
  }
  assertEqual(normalizeSettings({ defaultPreset: "synthLead" }).defaultPreset, "synthLead", "все пресеты валидны для настроек");
  console.log("  OK: список и русские имена");
}

function main(): void {
  testNormalize();
  testRoundtrip();
  testSplit();
  testPresets();
  console.log(`SMOKE OK: ${checks} проверок пройдено`);
}

try {
  main();
} catch (error) {
  console.error("SMOKE FAIL:", error);
  throw error;
}
