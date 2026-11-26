/**
 * Финальная сборка (очередь 4): игровые канвасы + DOM-панели (библиотека,
 * загрузка, тембр, настройки), панель управления, диалог «Разбор партий»,
 * подтверждение удаления, экран итогов, офлайн (service worker, только prod).
 * Сценарии SPEC §3: 1–8.
 *
 * Один rAF-цикл: аудио-часы каждый кадр (инвариант GLOSSARY #2), позиция
 * нот — чистая функция времени (ADR-004 п.2); нижний канвас — по событию.
 *
 * Отсчёт 5→1 перед стартом (без звука): выбор мелодии и «Ещё раз» на экране
 * итогов. Отсчёт неприкасаем — ничего не пропускает и не сбрасывает его
 * (клики по панели работают спокойно); при уходе со вкладки остаток
 * замораживается и восстанавливается от аудио-часов.
 *
 * Хоткеи (дублируют панели; Tab — нота C4, хоткеям не занят, ADR-006):
 *   ⌥W — wait-mode;  ⌥P — панель;  ⌥H — режим партии;  ⌥M — режим плеера;
 *   ⌥A — азбука (SPEC §4.9, вход/выход);  ↑/↓ — множитель скорости.
 *   ⌥ = Option на Mac (в событиях — altKey).
 * F-ряд не используем (macOS отдаёт его яркости/медиа); ⌥+буква не нота —
 * input гейтит ноты при зажатом Alt. Пресеты — кнопками панели (цифры — ноты).
 */
import "./style.css";
import { AudioClock } from "./core/clock";
import { PitchMapping, rangeLabel } from "./core/mapping";
import { computeKeyboardLayout, type KeyboardLayout } from "./core/layout";
import { settings } from "./core/settings";
import { PRESET_NAMES } from "./core/presets";
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
import { initPrimerScreen } from "./primer/screen";
import { showToast } from "./ui/toast";
import { formatDuration, requireEl } from "./ui/dom";
import type { Melody, LoadState, PresetId } from "./core/types";

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
const hudAudio = requireEl<HTMLSpanElement>("hudAudio");
const hint = requireEl<HTMLDivElement>("hint");

function updateRangeHud(): void {
  hudRange.textContent = rangeLabel(mapping.range());
}

function updateLoadHud(state: LoadState, progress: number | null): void {
  hudLoad.classList.remove("loading", "ready", "error");
  switch (state) {
    case "loading":
      hudLoad.classList.add("loading");
      hudLoad.textContent = progress === null ? "Загрузка сэмплов…" : `Загрузка сэмплов… ${Math.round(progress * 100)}%`;
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
const hudCache = { song: "", mode: "", hand: "", speed: "", wait: "", score: "", audio: "" };

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
  // Autoplay-политика: часть браузеров активирует аудио только кликом
  // (не клавишей) — честно показываем, почему тишина.
  const audio = clock.state === "suspended" ? "muted" : "running";
  if (audio !== hudCache.audio) {
    hudCache.audio = audio;
    hudAudio.hidden = audio !== "muted";
  }
}

// --- Отсчёт перед стартом (5→1, без звука): время приготовиться играть ---
const COUNTDOWN_SEC = 5;
const countdownEl = requireEl<HTMLDivElement>("countdown");
/** Аудио-время конца отсчёта; null — отсчёта нет (инвариант #2, не Date.now). */
let countdownEnd: number | null = null;
/** Остаток отсчёта, замороженный на время ухода со вкладки (blur). */
let countdownRemain: number | null = null;
/** Кэш показанной цифры: textContent пишется только при смене, как в HUD. */
let countdownDigit = 0;

function stopCountdown(): void {
  countdownEnd = null;
  countdownRemain = null;
  countdownDigit = 0;
  countdownEl.hidden = true;
}

/** Отсчёт завершён — старт. Никаких пропусков: таймер неприкасаем. */
function finishCountdown(): void {
  stopCountdown();
  player.start();
}

/** Старт выбранной мелодии с отсчётом: player.start() придёт из rAF-цикла. */
function startWithCountdown(): void {
  scoreScreen.close(); // новый запуск закрывает висящий экран итогов прошлой попытки
  countdownEnd = clock.currentTime() + COUNTDOWN_SEC;
  countdownRemain = null;
  countdownDigit = 0;
  countdownEl.hidden = false;
}

// --- Клавиатурный ввод ---
const input = new KeyboardInput(mapping, {
  onNoteOn: (pitch, velocity) => {
    engine.noteOn(pitch, velocity); // мгновенный звук всегда, включая wait-mode
    // Азбука (SPEC §4.9): клавиатура продолжает играть звук и судит ответ
    // карточки; плеер и отсчёт в ней не трогаются.
    if (primerOpen) {
      primer.handlePitch(pitch);
      return;
    }
    // Пауза (в т.ч. после ухода со вкладки) — любая клавиша продолжает.
    // Во время отсчёта ноты старт не крадут: он пропускается кликом/Enter.
    if (countdownEnd === null && !player.isRunning && player.currentMelody && player.currentMode !== "free") player.start();
    player.onKeyPress(pitch);
  },
  onNoteOff: (pitch) => engine.noteOff(pitch),
  onShiftChanged: () => {
    // Питчи клавиш сместились: звучащее глушим, HUD и подписи обновляем.
    engine.allNotesOff();
    updateRangeHud();
    layoutDirty = true;
    keyboardStateKey = null; // подписи физ. клавиш сместились — форсируем render
    primer.invalidateKeyboardLayout(); // клавиатура карточек азбуки — тоже
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

// Отсчёт против паузы вкладки: rAF в фоне заморожен, а аудио-часы идут —
// остаток замораживаем и при возврате откладываем конец от текущего времени
// (иначе отсчёт «сгорит» незаметно, пока вкладка в фоне). Плеер при этом не
// работает — существующий blur-обработчик выше его не трогает.
window.addEventListener("blur", () => {
  if (countdownEnd === null) return;
  countdownRemain = Math.max(0, countdownEnd - clock.currentTime());
  countdownEnd = null;
  countdownEl.hidden = true;
});
window.addEventListener("focus", () => {
  if (countdownRemain === null) return;
  countdownEnd = clock.currentTime() + countdownRemain;
  countdownRemain = null;
  countdownEl.hidden = false;
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

// Кнопка «☰ Панель» — строго под шапкой: строки HUD переносятся при узком
// окне, поэтому высоту отдаёт ResizeObserver, а не константа.
const topbar = requireEl<HTMLElement>("topbar");
const syncHeaderHeight = (): void => document.documentElement.style.setProperty("--header-h", `${topbar.offsetHeight}px`);
new ResizeObserver(syncHeaderHeight).observe(topbar);
syncHeaderHeight();

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
  onOpenPrimer: () => setPrimerOpen(true),
});

// --- Азбука (SPEC §4.9, ⌥A): полноэкранный раздел обучения нотной грамоте ---
const primer = initPrimerScreen({
  root: requireEl<HTMLElement>("primer"),
  canvas: requireEl<HTMLCanvasElement>("primerCanvas"),
  kbCanvas: requireEl<HTMLCanvasElement>("primerKbCanvas"),
  mapping, // раскладка/подписи клавиатуры карточек — от живого маппинга
  pressedPitches: () => input.pressedPitches(),
  settings,
  onBack: () => setPrimerOpen(false),
});
primer.setAudio(engine); // показ ноты на карточке звучит тем же движком

let primerOpen = false;

/** Вход/выход из азбуки: главный экран прячется, клавиатура отвечает карточкам. */
function setPrimerOpen(open: boolean): void {
  if (open === primerOpen) return;
  primerOpen = open;
  document.body.classList.toggle("primer-open", open);
  if (open) {
    stopCountdown(); // висящий отсчёт не запустит мелодию под азбукой
    if (player.isRunning) player.pause(); // мелодия не бежит в азбуке
    // Карточки отвечаются в базовом диапазоне C4–B5: октавный сдвиг возвращаем.
    const delta = Math.round((60 - mapping.range().basePitch) / 12);
    if (delta !== 0) {
      mapping.shiftOctaves(delta);
      input.releaseAll();
      engine.allNotesOff();
      updateRangeHud();
      layoutDirty = true;
      keyboardStateKey = null;
      primer.invalidateKeyboardLayout(); // клавиатура карточек — от нового маппинга
    }
    panels.toggle(false);
    void primer.open();
  } else {
    primer.close();
    // Главный стейдж был display:none — раскладка/буферы устарели, перерисовать.
    layoutDirty = true;
    keyboardStateKey = null;
  }
}

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
  startWithCountdown(); // 5 секунд на подготовку, старт придёт из rAF-цикла
  activeMelodyId = id;
  panels.setActiveMelody(id);
}

async function deleteMelody(id: string): Promise<void> {
  const meta = library.list().find((entry) => entry.id === id);
  if (meta) {
    // Подтверждение в системе (DS §3.8): window.confirm блокирует rAF и
    // вне дизайн-системы; здесь — диалог с [Отмена][Удалить].
    const confirmed = await dialogs.confirm({
      title: `Удалить «${meta.title}»?`,
      hint: "Мелодия будет удалена из библиотеки (IndexedDB) безвозвратно.",
      confirmLabel: "Удалить",
    });
    if (!confirmed) return;
  }
  try {
    await library.remove(id);
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
    return;
  }
  if (activeMelodyId === id) {
    stopCountdown(); // активную мелодию удалили — висящий отсчёт отменяем
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

// --- Хоткеи. Tab — нота C4 по решению игрока (ADR-006): фокус-навигация
// отключена, UI — мышью. F-ряд не используем: macOS отдаёт его
// яркости/медиа/Mission Control. ⌥+буква (Option; в событиях — altKey) не
// конфликтует с нотами: input/keyboard гейтит ноты при зажатом Alt (ADR-006). ---
window.addEventListener("keydown", (e) => {
  if (e.repeat || !e.altKey) return;
  switch (e.code) {
    case "KeyW":
      e.preventDefault();
      player.setWaitMode(!player.isWaitMode);
      break;
    case "KeyP":
      e.preventDefault();
      panels.toggle();
      break;
    case "KeyH": {
      e.preventDefault();
      const order = HAND_MODE_CYCLE.indexOf(player.handPartyMode);
      const next = HAND_MODE_CYCLE[(order + 1) % HAND_MODE_CYCLE.length] ?? "both";
      player.setHandMode(next);
      break;
    }
    case "KeyM": {
      e.preventDefault();
      const order = MODE_CYCLE.indexOf(player.currentMode);
      const next = MODE_CYCLE[(order + 1) % MODE_CYCLE.length] ?? "free";
      player.setMode(next);
      break;
    }
    case "KeyA":
      // Азбука (SPEC §4.9): вход/выход тем же хоткеем.
      e.preventDefault();
      setPrimerOpen(!primerOpen);
      break;
  }
});

// Скорость — стрелками (не ноты, без модификаторов).
window.addEventListener("keydown", (e) => {
  if (e.repeat || e.altKey) return;
  switch (e.code) {
    case "ArrowUp":
      e.preventDefault();
      player.stepMultiplier(0.05);
      break;
    case "ArrowDown":
      e.preventDefault();
      player.stepMultiplier(-0.05);
      break;
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
  // Отсчёт: время только аудио-часы (инвариант #2). Нулевой остаток — старт;
  // цифра пишется в DOM только при смене (кэш, как у остального HUD).
  if (countdownEnd !== null) {
    const remain = countdownEnd - clock.currentTime();
    if (remain <= 0) {
      finishCountdown();
    } else {
      const digit = Math.ceil(remain);
      if (digit >= 1 && digit !== countdownDigit) {
        countdownDigit = digit;
        countdownEl.textContent = String(digit);
      }
    }
  }

  player.update();

  // Азбука открыта — главный стейдж скрыт (display:none): рендер полей
  // пропускаем (дешёвый вариант — rAF/HUD/контролы живут, канвасы не рисуем).
  if (primerOpen) {
    primer.updateKeyboard(); // клавиатура карточек: нажатия + верная клавиша после вердикта
  } else {
    const currentLayout = ensureLayout();
    const melody = player.currentMelody;
    const songTime = player.songTime();

    notefield.draw({
      melody,
      showNotes: player.currentMode !== "free" && melody !== null,
      songTime,
      layout: currentLayout,
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
      startWithCountdown(); // «Ещё раз» — снова с отсчётом
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
