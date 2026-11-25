/**
 * Панель управления текущей мелодией (SPEC §4.3, §4.4): старт/пауза/стоп/
 * «с начала», режим (свободная/обучение/автоплей), партии (обе/правая/левая),
 * wait-mode, множитель скорости 0.25–1.0, окно попадания ±мс.
 *
 * Дублирует хоткеи очереди 3 (` , +/-, F2, F3) — оба источника меняют плеер,
 * поэтому панель каждый кадр синхронизируется с ним через update()
 * (кэш строк, как у HUD, — без layout-шума). Слайдер не перезаписывается,
 * пока на нём фокус (пользователь тащит ползунок).
 */
import { HAND_MODE_NAMES, PLAYER_MODE_NAMES, type HandMode, type PlayerMode, type Player } from "../player/player";
import { HIT_WINDOW_MAX_MS, HIT_WINDOW_MIN_MS, type SettingsStore } from "../core/settings";
import { el, gameButton } from "./dom";

export interface ControlsApi {
  /** Синхронизация с плеером — вызывается каждый кадр из rAF-цикла. */
  update(): void;
}

export interface ControlsDeps {
  player: Player;
  settings: SettingsStore;
  root: HTMLElement;
}

const HAND_MODES: ReadonlyArray<HandMode> = ["both", "right", "left"];
const PLAYER_MODES: ReadonlyArray<PlayerMode> = ["free", "learn", "autoplay"];

export function initControls(deps: ControlsDeps): ControlsApi {
  const { player, settings, root } = deps;

  // --- Транспорт ---
  const startBtn = gameButton("Старт", () => player.start());
  const pauseBtn = gameButton("Пауза", () => player.pause());
  const stopBtn = gameButton("Стоп", () => player.stop());
  const restartBtn = gameButton("С начала", () => {
    player.stop();
    player.start();
  });

  const transport = el("div", "controls-group");
  transport.append(startBtn, pauseBtn, stopBtn, restartBtn);

  // --- Режим и партии (сегменты) ---
  const modeButtons = new Map<PlayerMode, HTMLButtonElement>();
  const modeGroup = el("div", "seg");
  for (const mode of PLAYER_MODES) {
    const button = gameButton(PLAYER_MODE_NAMES[mode], () => player.setMode(mode), "btn seg-item");
    modeButtons.set(mode, button);
    modeGroup.appendChild(button);
  }

  const handButtons = new Map<HandMode, HTMLButtonElement>();
  const handGroup = el("div", "seg");
  for (const hand of HAND_MODES) {
    const button = gameButton(HAND_MODE_NAMES[hand], () => player.setHandMode(hand), "btn seg-item");
    handButtons.set(hand, button);
    handGroup.appendChild(button);
  }

  // --- Wait-mode ---
  const waitCheck = el("input") as HTMLInputElement;
  waitCheck.type = "checkbox";
  waitCheck.id = "waitCheck";
  waitCheck.addEventListener("change", () => player.setWaitMode(waitCheck.checked));
  const waitLabel = el("label", "check-label", "Wait-mode");
  waitLabel.htmlFor = waitCheck.id;

  // --- Множитель скорости ---
  const multSlider = el("input") as HTMLInputElement;
  multSlider.type = "range";
  multSlider.min = "0.25";
  multSlider.max = "1";
  multSlider.step = "0.05";
  multSlider.addEventListener("input", () => player.setMultiplier(Number.parseFloat(multSlider.value)));
  const multValue = el("span", "ctl-value", "×1.00");

  // --- Окно попадания (persist в настройки) ---
  const windowSlider = el("input") as HTMLInputElement;
  windowSlider.type = "range";
  windowSlider.min = String(HIT_WINDOW_MIN_MS);
  windowSlider.max = String(HIT_WINDOW_MAX_MS);
  windowSlider.step = "5";
  windowSlider.addEventListener("input", () => {
    const ms = Math.round(Number.parseFloat(windowSlider.value));
    player.setHitWindowMs(ms);
    settings.update({ hitWindowMs: ms });
  });
  const windowValue = el("span", "ctl-value", "±150 мс");

  function sliderGroup(labelText: string, slider: HTMLInputElement, value: HTMLElement): HTMLElement {
    const group = el("div", "controls-group slider-group");
    const label = el("span", "ctl-label", labelText);
    group.append(label, slider, value);
    return group;
  }

  // --- Название мелодии ---
  const songTitle = el("span", "ctl-song", "—");

  root.classList.add("controls");
  root.append(
    transport,
    wrapWithLabel("Режим:", modeGroup),
    wrapWithLabel("Партия:", handGroup),
    waitCheck,
    waitLabel,
    sliderGroup("Множитель", multSlider, multValue),
    sliderGroup("Окно", windowSlider, windowValue),
    wrapWithLabel("Мелодия:", songTitle),
  );

  // --- Кэш синхронизации (DOM трогаем только при смене значения) ---
  const cache = {
    song: "",
    mode: "",
    hand: "",
    wait: false as boolean,
    mult: "",
    window: "",
    start: null as boolean | null,
    pause: null as boolean | null,
    stop: null as boolean | null,
  };

  function syncSeg<T extends string>(map: Map<T, HTMLButtonElement>, current: T): void {
    // Выбранная в сегменте ровно одна: .active + aria-pressed (DS §3.2)
    for (const [value, button] of map) {
      const active = value === current;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  function syncSlider(
    slider: HTMLInputElement,
    valueLabel: HTMLElement,
    cacheKey: "mult" | "window",
    sliderValue: string,
    labelText: string,
  ): void {
    if (cache[cacheKey] === labelText) return;
    cache[cacheKey] = labelText;
    if (document.activeElement !== slider) slider.value = sliderValue;
    valueLabel.textContent = labelText;
  }

  return {
    update(): void {
      const title = player.currentMelody?.title ?? "—";
      if (title !== cache.song) {
        cache.song = title;
        songTitle.textContent = title;
        songTitle.title = title;
      }

      if (player.currentMode !== cache.mode) {
        cache.mode = player.currentMode;
        syncSeg(modeButtons, player.currentMode);
      }
      if (player.handPartyMode !== cache.hand) {
        cache.hand = player.handPartyMode;
        syncSeg(handButtons, player.handPartyMode);
      }
      if (player.isWaitMode !== cache.wait) {
        cache.wait = player.isWaitMode;
        waitCheck.checked = player.isWaitMode;
      }

      const multText = `×${player.speedMultiplier.toFixed(2)}`;
      syncSlider(multSlider, multValue, "mult", multText, multText);

      const hitWindowMs = Math.round(player.hitWindowSec * 1000);
      syncSlider(windowSlider, windowValue, "window", String(hitWindowMs), `±${hitWindowMs} мс`);

      const hasMelody = player.currentMelody !== null;
      const canStart = hasMelody && (!player.isRunning || player.isFinished);
      const canPause = player.isRunning && !player.isFinished;
      if (canStart !== cache.start) {
        cache.start = canStart;
        startBtn.disabled = !canStart;
      }
      if (canPause !== cache.pause) {
        cache.pause = canPause;
        pauseBtn.disabled = !canPause;
      }
      if (hasMelody !== cache.stop) {
        cache.stop = hasMelody;
        stopBtn.disabled = !hasMelody;
        restartBtn.disabled = !hasMelody;
      }
    },
  };
}

function wrapWithLabel(labelText: string, group: HTMLElement): HTMLElement {
  const wrap = el("div", "controls-group");
  wrap.append(el("span", "ctl-label", labelText), group);
  return wrap;
}
