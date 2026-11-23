/**
 * Сборка очереди 1: аудио-часы + движок + клавиатурный ввод + рендер
 * экранных клавиш. Критерий: открыл → жмёшь клавиши → звучит мгновенно,
 * экранная клавиша подсвечена. Падающие ноты (верхний канвас) — очередь плеера.
 */
import { AudioClock } from "./core/clock";
import { PitchMapping, rangeLabel } from "./core/mapping";
import { computeKeyboardLayout } from "./core/layout";
import { AudioEngine } from "./audio/engine";
import { KeyboardInput } from "./input/keyboard";
import { KeyboardRenderer } from "./render/keyboard";
import { library } from "./library/store";
import type { LoadState, PresetId } from "./core/types";

const PRESET_ORDER: ReadonlyArray<PresetId> = ["piano", "organ", "synthLead", "bass"];
const PRESET_NAMES: Record<PresetId, string> = {
  piano: "Фортепиано",
  organ: "Орган",
  synthLead: "Синт-лид",
  bass: "Бас",
};
const PRESET_SHORTCUTS = ["Digit1", "Digit2", "Digit3", "Digit4"] as const;

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Элемент #${id} не найден`);
  return el as T;
}

const clock = new AudioClock();
clock.init();
clock.attachUnlock();

const engine = new AudioEngine(clock, "piano");
const mapping = new PitchMapping();

// --- HUD ---
const hudPreset = requireEl<HTMLSpanElement>("hudPreset");
const hudRange = requireEl<HTMLSpanElement>("hudRange");
const hudLoad = requireEl<HTMLSpanElement>("hudLoad");
const hint = requireEl<HTMLDivElement>("hint");

function updateRangeHud(): void {
  hudRange.textContent = rangeLabel(mapping.range());
}

function updateLoadHud(state: LoadState, progress: number | null): void {
  hudLoad.classList.remove("loading", "ready", "error");
  switch (state) {
    case "loading":
      hudLoad.classList.add("loading");
      hudLoad.textContent = progress === null ? "Загрузка сэмплов фортепиано…" : `Загрузка сэмплов фортепиано… ${Math.round(progress * 100)}%`;
      break;
    case "ready":
      hudLoad.classList.add("ready");
      hudLoad.textContent = "Сэмплы готовы";
      break;
    case "error":
      hudLoad.classList.add("error");
      hudLoad.textContent = "Сэмплы не загрузились (CDN недоступен?)";
      break;
    case "idle":
      hudLoad.textContent = "";
      break;
  }
}

engine.onLoadState = (_presetId, state, progress) => updateLoadHud(state, progress);

// --- Клавиатурный ввод ---
let hintHidden = false;

const input = new KeyboardInput(mapping, {
  onNoteOn: (pitch, velocity) => {
    engine.noteOn(pitch, velocity);
    if (!hintHidden) {
      hintHidden = true;
      hint.classList.add("hidden");
    }
    drawKeyboard();
  },
  onNoteOff: (pitch) => {
    engine.noteOff(pitch);
    drawKeyboard();
  },
  onShiftChanged: () => {
    // Питчи клавиш сместились: звучащее глушим, HUD и подписи обновляем.
    engine.allNotesOff();
    updateRangeHud();
    drawKeyboard();
  },
  onPedalChanged: (down) => engine.setPedal(down),
});
input.attach();

// window.blur: движок глушит звук сам; здесь чистим реестр зажатых.
window.addEventListener("blur", () => {
  input.releaseAll();
  drawKeyboard();
});

// Пресеты — клавишами 1–4 (временная замена панели пресетов, очередь 4).
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const idx = PRESET_SHORTCUTS.indexOf(e.code as (typeof PRESET_SHORTCUTS)[number]);
  if (idx === -1) return;
  const preset = PRESET_ORDER[idx];
  if (!preset) return;
  e.preventDefault();
  engine.setPreset(preset);
  hudPreset.textContent = PRESET_NAMES[preset];
});

// --- Рендер экранных клавиш ---
const keyboardCanvas = requireEl<HTMLCanvasElement>("keyboardCanvas");
// Верхний канвас (колонки нот) — очередь плеера/рендера нот; пока пустой слой.
requireEl<HTMLCanvasElement>("noteCanvas");

const renderer = new KeyboardRenderer(keyboardCanvas);

function drawKeyboard(): void {
  renderer.resize();
  const { width, height } = renderer.size;
  const layout = computeKeyboardLayout(width, height, mapping.pitches());
  renderer.render(layout, {
    pressed: input.pressedPitches(),
    labelByPitch: mapping.labels(),
    showNoteNames: true,
  });
}

const resizeObserver = new ResizeObserver(() => drawKeyboard());
resizeObserver.observe(keyboardCanvas);

// Первый кадр + инициализация HUD.
engine.setPreset("piano"); // стартует ленивую загрузку сэмплов с CDN
updateRangeHud();
hudPreset.textContent = PRESET_NAMES[engine.preset];
drawKeyboard();

// Библиотека мелодий (очередь 2): встроенные + пользовательские. Панель
// библиотеки и плеер (очереди 3–4) потребляют library.list()/get()/addUserFile().
library.ready().then(() => {
  console.info(`Библиотека готова: ${library.list().length} мелодий`);
});
