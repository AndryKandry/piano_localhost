/**
 * Сборка очереди 3: плеер (машина состояний) + lookahead-планировщик +
 * падающие ноты + подсчёт. Сценарии SPEC §3: 3 (wait-mode обучение),
 * 4 (две руки/автопартия), 6 (автоплей), 7 (счёт).
 *
 * Один rAF-цикл: читает аудио-часы каждый кадр (инвариант GLOSSARY #2),
 * позиция нот — чистая функция времени (ADR-004 п.2). Нижний канвас
 * перерисовывается по событию — при смене подсветки/нажатий (diff по кадру).
 *
 * Хоткеи очереди 3 (Tab не перехватывается — a11y):
 *   ` (Backquote) — wait-mode вкл/выкл;
 *   +/- (Equal/Minus) — множитель скорости ±0.05 (0.25–1.0);
 *   F2 — цикл режима партии (обе → правая → левая);
 *   F3 — цикл режима (свободная → обучение → автоплей).
 */
import { AudioClock } from "./core/clock";
import { PitchMapping, rangeLabel } from "./core/mapping";
import { computeKeyboardLayout, type KeyboardLayout } from "./core/layout";
import { AudioEngine } from "./audio/engine";
import { KeyboardInput } from "./input/keyboard";
import { KeyboardRenderer } from "./render/keyboard";
import { NoteFieldRenderer } from "./render/notefield";
import { computeKeyHighlight } from "./render/highlight";
import { Player, HAND_MODE_NAMES, PLAYER_MODE_NAMES, type HandMode, type PlayerMode } from "./player/player";
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
const HAND_MODE_CYCLE: readonly HandMode[] = ["both", "right", "left"];
const MODE_CYCLE: readonly PlayerMode[] = ["free", "learn", "autoplay"];

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

engine.onLoadState = (_presetId, state, progress) => updateLoadHud(state, progress);

function formatSongTime(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Текстовые состояния HUD — обновляются только при смене (без layout-шума). */
const hudCache = { song: "", mode: "", hand: "", speed: "", wait: "", score: "" };

function updateHud(): void {
  const song = formatSongTime(player.songTime());
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
  const score = player.currentMode === "learn" && player.currentMelody
    ? `${Math.round(player.score().hitPercent)}% · стрик ${player.score().streak}`
    : "—";
  if (score !== hudCache.score) {
    hudCache.score = score;
    hudScore.textContent = score;
  }
}

// --- Клавиатурный ввод ---
let hintHidden = false;

const input = new KeyboardInput(mapping, {
  onNoteOn: (pitch, velocity) => {
    engine.noteOn(pitch, velocity); // мгновенный звук всегда, включая wait-mode
    if (!hintHidden) {
      hintHidden = true;
      hint.classList.add("hidden");
    }
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

// --- Хоткеи очереди 3 (Tab не трогаем — a11y) ---
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
      // Пресеты — клавишами 1–4 (временная замена панели, очередь 4).
      const idx = PRESET_SHORTCUTS.indexOf(e.code as (typeof PRESET_SHORTCUTS)[number]);
      if (idx === -1) return;
      const preset = PRESET_ORDER[idx];
      if (!preset) return;
      e.preventDefault();
      engine.setPreset(preset);
      hudPreset.textContent = PRESET_NAMES[preset];
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
  keyboardRenderer.resize();
  notefield.resize();
  if (layoutDirty || !layout) {
    const { width, height } = keyboardRenderer.size;
    layout = computeKeyboardLayout(width, height, mapping.pitches());
    notefield.setLayout(layout);
    layoutDirty = false;
  }
  return layout;
}

/** Ключ diff-а нижнего канваса: перерисовка только по событию (ADR-004 п.1). */
let keyboardStateKey = "";

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
      showNoteNames: true,
      next: highlight.next,
      auto: highlight.auto,
    });
  }

  updateHud();
  requestAnimationFrame(drawFrame);
}

// Вспышка попадания — на линии удара в колонке ноты.
player.onNoteHit = (pitch) => notefield.spawnHitFlash(pitch, clock.currentTime());

// Итог прохождения: счёт в HUD + лучшая попытка в библиотеку (SPEC §4.7).
player.onFinished = (result) => {
  if (player.currentMode !== "learn" || !player.currentMelody) return;
  const text = `Пройдено: ${Math.round(result.hitPercent)}% · стрик ${result.bestStreak} · ошибок ${result.errors.length}`;
  hudScore.textContent = text;
  hudCache.score = text;
  try {
    // Вырожденный судья (0 групп — режим переключали после финиша) не пишет счёт.
    if (result.totalGroups > 0) {
      library.setBest(player.currentMelody.id, Math.round(result.hitPercent * 10) / 10);
    }
  } catch (error) {
    console.error("Не удалось записать лучшую попытку", error);
  }
  console.info(text);
};

// --- Старт ---
engine.setPreset("piano"); // ленивая загрузка сэмплов с CDN
updateRangeHud();
hudPreset.textContent = PRESET_NAMES[engine.preset];
requestAnimationFrame(drawFrame);

// Сценарий обучения (SPEC §3.3): «Ода к радости», правая рука, wait-mode, ×0.5.
library.ready().then(() => {
  try {
    const melody = library.get("builtin:ode-to-joy");
    player.loadMelody(melody);
    player.setMode("learn");
    player.setHandMode("right");
    player.setWaitMode(true);
    player.setMultiplier(0.5);
    player.start();
  } catch (error) {
    console.error("Не удалось загрузить мелодию для обучения", error);
  }
});
