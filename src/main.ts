/**
 * Финальная сборка (очередь 4): игровые канвасы + DOM-панели (библиотека,
 * загрузка, тембр, настройки), панель управления, диалог «Разбор партий»,
 * экран итогов, офлайн (service worker, только prod).
 * Сценарии SPEC §3: 1–8.
 *
 * Один rAF-цикл: аудио-часы каждый кадр (инвариант GLOSSARY #2), позиция
 * нот — чистая функция времени (ADR-004 п.2); нижний канвас — по событию.
 *
 * Хоткеи (дублируют панели; Tab не перехватывается — a11y):
 *   ` (Backquote) — wait-mode;  +/- (Equal/Minus) — множитель скорости;
 *   F1 — панель;  F2 — режим партии;  F3 — режим плеера;  1–4 — пресеты.
 */
import "./style.css";
import { AudioClock } from "./core/clock";
import { PitchMapping, rangeLabel } from "./core/mapping";
import { computeKeyboardLayout, type KeyboardLayout } from "./core/layout";
import { settings } from "./core/settings";
import { PRESET_NAMES, PRESET_ORDER } from "./core/presets";
import { AudioEngine } from "./audio/engine";
import { KeyboardInput } from "./input/keyboard";
import { KeyboardRenderer } from "./render/keyboard";
import { NoteFieldRenderer } from "./render/notefield";
import { computeKeyHighlight } from "./render/highlight";
import { applyPartyColors } from "./render/colors";
import { Player, HAND_MODE_NAMES, PLAYER_MODE_NAMES, type HandMode, type PlayerMode } from "./player/player";
import type { ScoreResult } from "./player/judge";
import { library } from "./library/store";
import { cloneMelody } from "./library/split";
import { initControls } from "./ui/controls";
import { initSidePanel } from "./ui/panels";
import { initDialogs } from "./ui/dialogs";
import { initScoreScreen } from "./ui/score";
import { showToast } from "./ui/toast";
import { formatDuration, requireEl } from "./ui/dom";
import type { Melody, LoadState, PresetId } from "./core/types";

const PRESET_SHORTCUTS = ["Digit1", "Digit2", "Digit3", "Digit4"] as const;
const HAND_MODE_CYCLE: readonly HandMode[] = ["both", "right", "left"];
const MODE_CYCLE: readonly PlayerMode[] = ["free", "learn", "autoplay"];

const clock = new AudioClock();
clock.init();
clock.attachUnlock();

const engine = new AudioEngine(clock, settings.get().defaultPreset);
const mapping = new PitchMapping();
const player = new Player(clock, engine);

// --- HUD ---
const hudPreset = requireEl<HTMLSpanElement>("hudPreset");
const hudRange = requireEl<HTMLSpanElement>("hudRange");
const hudMode = requireEl<HTMLSpanElement>("hudMode");
const hudHand = requireEl<HTMLSpanElement>("hudHand");
const hudSpeed = requireEl<HTMLSpanElement>("hudSpeed");
const hudWait = requireEl<HTMLSpanElement>("hudWait");
const hudSong = requireEl<HTMLSpanElement>("hudSong");
const hudScore = requireEl<HTMLSpanElement>("hudScore");
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

engine.onLoadState = (presetId, state, progress) => {
  updateLoadHud(state, progress);
  if (presetId === engine.preset) panels.setSampleLoad(state, progress);
};

/** Текстовые состояния HUD — обновляются только при смене (без layout-шума). */
const hudCache = { song: "", mode: "", hand: "", speed: "", wait: "", score: "" };

function updateHud(): void {
  const song = formatDuration(player.songTime());
  if (song !== hudCache.song) {
    hudCache.song = song;
    hudSong.textContent = song;
  }
  const mode = PLAYER_MODE_NAMES[player.currentMode];
  if (mode !== hudCache.mode) {
    hudCache.mode = mode;
    hudMode.textContent = mode;
  }
  const hand = HAND_MODE_NAMES[player.handPartyMode];
  if (hand !== hudCache.hand) {
    hudCache.hand = hand;
    hudHand.textContent = hand;
  }
  const speed = `×${player.speedMultiplier.toFixed(2)}`;
  if (speed !== hudCache.speed) {
    hudCache.speed = speed;
    hudSpeed.textContent = speed;
  }
  const wait = player.isWaitMode ? "Wait-mode: вкл" : "Wait-mode: выкл";
  if (wait !== hudCache.wait) {
    hudCache.wait = wait;
    hudWait.textContent = wait;
    hudWait.classList.toggle("on", player.isWaitMode);
  }
  const showScore = settings.get().showScore;
  const score =
    showScore && player.currentMode === "learn" && player.currentMelody
      ? `${Math.round(player.score().hitPercent)}% · стрик ${player.score().streak}`
      : "—";
  if (score !== hudCache.score) {
    hudCache.score = score;
    hudScore.textContent = score;
  }
}

// --- Клавиатурный ввод ---
const input = new KeyboardInput(mapping, {
  onNoteOn: (pitch, velocity) => {
    engine.noteOn(pitch, velocity); // мгновенный звук всегда, включая wait-mode
    // Пауза (в т.ч. после ухода со вкладки) — любая клавиша продолжает.
    if (!player.isRunning && player.currentMelody && player.currentMode !== "free") player.start();
    player.onKeyPress(pitch);
  },
  onNoteOff: (pitch) => engine.noteOff(pitch),
  onShiftChanged: () => {
    // Питчи клавиш сместились: звучащее глушим, HUD и подписи обновляем.
    engine.allNotesOff();
    updateRangeHud();
    layoutDirty = true;
  },
  onPedalChanged: (down) => engine.setPedal(down),
});
input.attach();

// window.blur: движок глушит звук сам; здесь чистим реестр и ставим паузу —
// фоновая вкладка душит таймеры, учиться/слушать в ней всё равно нельзя.
window.addEventListener("blur", () => {
  input.releaseAll();
  if (player.isRunning) player.pause();
});

// --- Стартовая подсказка (сценарий 1): до первого жеста (клик/клавиша → clock.resume) ---
let hintHidden = false;
function hideStartHint(): void {
  if (hintHidden) return;
  hintHidden = true;
  hint.classList.add("hidden");
}
window.addEventListener("keydown", hideStartHint, { once: true });
window.addEventListener("pointerdown", hideStartHint, { once: true });

// --- Активная мелодия и панели ---
let activeMelodyId: string | null = null;

const controls = initControls({ player, settings, root: requireEl<HTMLElement>("controls") });

const dialogs = initDialogs({
  library,
  root: requireEl<HTMLElement>("dialogRoot"),
  onApply: (id, melody) => {
    player.loadMelody(melody); // resplitMelody уже вернул свежую копию с новыми партиями
    notefield.resetMelodyCache(); // id и число нот те же — кэш держит старые объекты нот
    activeMelodyId = id;
    panels.setActiveMelody(id);
  },
});

const scoreScreen = initScoreScreen({ root: requireEl<HTMLElement>("dialogRoot") });

const panels = initSidePanel({
  library,
  settingsStore: settings,
  mount: requireEl<HTMLElement>("sidePanel"),
  dropOverlay: requireEl<HTMLElement>("dropOverlay"),
  toggleButton: requireEl<HTMLButtonElement>("panelToggle"),
  onPlay: playMelody,
  onDelete: deleteMelody,
  onPreset: applyPreset,
  onOpenSplit: (id) => dialogs.openSplit(id),
});

/** Клик по карточке библиотеки: копия в плеер, learn-режим, старт (сценарий 3). */
function playMelody(id: string): void {
  scoreScreen.close(); // новый запуск закрывает висящий экран итогов прошлой попытки
  let melody: Melody;
  try {
    melody = library.get(id);
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
    return;
  }
  player.loadMelody(cloneMelody(melody)); // копия: библиотечный оригинал не мутируется
  player.setMode("learn");
  player.start();
  activeMelodyId = id;
  panels.setActiveMelody(id);
}

async function deleteMelody(id: string): Promise<void> {
  const meta = library.list().find((entry) => entry.id === id);
  if (meta && !window.confirm(`Удалить «${meta.title}» из библиотеки?`)) return;
  try {
    await library.remove(id);
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
    return;
  }
  if (activeMelodyId === id) {
    player.unload();
    player.setMode("free");
    activeMelodyId = null;
    panels.setActiveMelody(null);
  }
  panels.refreshLibrary();
}

function applyPreset(id: PresetId): void {
  engine.setPreset(id); // смена тембра на ходу — сценарий 6/8
  hudPreset.textContent = PRESET_NAMES[id];
  panels.setActivePreset(id);
}

// --- Настройки: применяются к рендерам/плееру/движку сразу и при старте ---
// null ≠ любой ключ состояния — первый кадр обязан нарисовать клавиатуру
// (баг: старт "" совпадал с ключом пустого состояния, рендер пропускался).
let keyboardStateKey: string | null = null;

function applySettings(): void {
  const current = settings.get();
  engine.setVolume(current.volume);
  player.setHitWindowMs(current.hitWindowMs);
  applyPartyColors(current.partyColors);
  keyboardStateKey = null; // подписи/цвета клавиш могли смениться — перерисовать
}
settings.subscribe(applySettings);
applySettings();

// --- Хоткеи (Tab не трогаем — a11y) ---
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  switch (e.code) {
    case "Backquote":
      e.preventDefault();
      player.setWaitMode(!player.isWaitMode);
      break;
    case "Equal":
      e.preventDefault();
      player.stepMultiplier(0.05);
      break;
    case "Minus":
      e.preventDefault();
      player.stepMultiplier(-0.05);
      break;
    case "F1":
      e.preventDefault();
      panels.toggle();
      break;
    case "F2": {
      e.preventDefault();
      const order = HAND_MODE_CYCLE.indexOf(player.handPartyMode);
      const next = HAND_MODE_CYCLE[(order + 1) % HAND_MODE_CYCLE.length] ?? "both";
      player.setHandMode(next);
      break;
    }
    case "F3": {
      e.preventDefault();
      const order = MODE_CYCLE.indexOf(player.currentMode);
      const next = MODE_CYCLE[(order + 1) % MODE_CYCLE.length] ?? "free";
      player.setMode(next);
      break;
    }
    default: {
      // Пресеты — клавишами 1–4 (дубль секции «Тембр»).
      const idx = PRESET_SHORTCUTS.indexOf(e.code as (typeof PRESET_SHORTCUTS)[number]);
      if (idx === -1) return;
      const id = PRESET_ORDER[idx];
      if (!id) return;
      e.preventDefault();
      applyPreset(id);
      break;
    }
  }
});

// --- Рендер ---
const keyboardCanvas = requireEl<HTMLCanvasElement>("keyboardCanvas");
const noteCanvas = requireEl<HTMLCanvasElement>("noteCanvas");

const keyboardRenderer = new KeyboardRenderer(keyboardCanvas);
const notefield = new NoteFieldRenderer(noteCanvas);

let layoutDirty = true;
let layout: KeyboardLayout | null = null;

/** Единая раскладка — геометрия клавиш и колонок нот (ADR-004 п.3). */
function ensureLayout(): KeyboardLayout {
  // Пересоздание буфера чистит канвас: раскладка и рисунок клавиш устарели.
  if (keyboardRenderer.resize()) {
    layoutDirty = true;
    keyboardStateKey = null; // форсируем render — иначе клавиатура останется пустой
  }
  notefield.resize();
  if (layoutDirty || !layout) {
    const { width, height } = keyboardRenderer.size;
    layout = computeKeyboardLayout(width, height, mapping.pitches());
    notefield.setLayout(layout);
    layoutDirty = false;
  }
  return layout;
}

function drawFrame(): void {
  player.update();

  const currentLayout = ensureLayout();
  const melody = player.currentMelody;
  const songTime = player.songTime();

  notefield.draw({
    melody,
    showNotes: player.currentMode !== "free" && melody !== null,
    songTime,
    layout: currentLayout,
    range: mapping.range(),
    nowSec: clock.currentTime(),
  });

  // Свободная игра — подсветки партий нет (SPEC §4.3: режим без нот).
  const highlight =
    melody && player.currentMode !== "free"
      ? computeKeyHighlight({
          notes: melody.notes,
          songTime,
          isAuto: (note) => !player.isPlayableNote(note),
          pendingPlayable: player.pendingPlayablePitches(),
          expectedPitches: player.expectedPitches(),
          waitMode: player.isWaitMode && player.currentMode === "learn" && player.isRunning,
          hitWindowSec: player.hitWindowSec,
        })
      : { next: new Set<number>(), auto: new Map<number, string>() };

  const pressed = input.pressedPitches();
  const key = `${[...pressed].sort().join(",")}|${[...highlight.next].sort().join(",")}|${[...highlight.auto.entries()].sort().map(([p, c]) => `${p}:${c}`).join(",")}`;
  if (key !== keyboardStateKey) {
    keyboardStateKey = key;
    keyboardRenderer.render(currentLayout, {
      pressed,
      labelByPitch: mapping.labels(),
      showNoteNames: settings.get().showNoteNames,
      next: highlight.next,
      auto: highlight.auto,
    });
  }

  updateHud();
  controls.update();
  requestAnimationFrame(drawFrame);
}

// Вспышка попадания — на линии удара в колонке ноты.
player.onNoteHit = (pitch) => notefield.spawnHitFlash(pitch, clock.currentTime());

// Итог прохождения (сценарий 7): лучший результат в библиотеку + экран итогов.
player.onFinished = (result: ScoreResult) => {
  if (player.currentMode !== "learn" || !player.currentMelody) return;
  const melodyId = player.currentMelody.id;
  const title = player.currentMelody.title;
  const text = `Пройдено: ${Math.round(result.hitPercent)}% · стрик ${result.bestStreak} · ошибок ${result.errors.length}`;
  hudScore.textContent = text;
  hudCache.score = text;
  try {
    // Вырожденный судья (0 групп — режим переключали после финиша) не пишет счёт.
    if (result.totalGroups > 0) {
      library.setBest(melodyId, Math.round(result.hitPercent * 10) / 10);
      panels.refreshLibrary(); // «Лучший: …» в карточке
    }
  } catch (error) {
    console.error("Не удалось записать лучшую попытку", error);
  }
  if (settings.get().showScore && result.totalGroups > 0) {
    scoreScreen.show(result, title, () => {
      player.stop();
      player.start();
    });
  }
};

// --- Старт ---
applyPreset(engine.preset); // пресет по умолчанию из настроек; сэмплы — лениво с CDN
updateRangeHud();
requestAnimationFrame(drawFrame);

// Список библиотеки полный после чтения IndexedDB (пользовательские записи).
library.ready().then(() => panels.refreshLibrary());

// Офлайн (SPEC §7.6): index+bundle+иконки — service worker (runtime cache-first
// same-origin); сэмплы CDN не перехватываются — их держит HTTP-кэш браузера.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.error("Не удалось зарегистрировать service worker", error);
    });
  });
}
