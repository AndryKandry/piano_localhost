/**
 * Секция «Настройки» в боковой панели (SPEC §4.8): цвета партий, подписи нот,
 * окно попадания, громкость, пресет по умолчанию, показ счёта, сброс.
 * Все изменения сразу идут в SettingsStore (persist в localStorage);
 * применение к плееру/движку/рендеру делает подписчик в main.ts.
 */
import { HIT_WINDOW_MAX_MS, HIT_WINDOW_MIN_MS, type SettingsStore } from "../core/settings";
import { PRESET_NAMES, PRESET_ORDER } from "../core/presets";
import { el, gameButton } from "./dom";

/** Рендерит секцию настроек в контейнер панели. */
export function initSettingsSection(container: HTMLElement, store: SettingsStore): void {
  container.classList.add("panel-section");
  container.appendChild(el("h3", "panel-heading", "Настройки"));

  const current = store.get();

  // --- Цвета партий ---
  const colorRow = el("div", "settings-row");
  const rightColor = colorInput(current.partyColors.right, "Цвет правой партии");
  const leftColor = colorInput(current.partyColors.left, "Цвет левой партии");
  rightColor.input.addEventListener("input", () => store.update({ partyColors: { right: rightColor.input.value } }));
  leftColor.input.addEventListener("input", () => store.update({ partyColors: { left: leftColor.input.value } }));
  colorRow.append(rightColor.wrap, leftColor.wrap);

  // --- Подписи нот ---
  const namesCheck = el("input") as HTMLInputElement;
  namesCheck.type = "checkbox";
  namesCheck.id = "showNoteNamesCheck";
  namesCheck.checked = current.showNoteNames;
  namesCheck.addEventListener("change", () => store.update({ showNoteNames: namesCheck.checked }));
  const namesLabel = el("label", "check-label", "Имена нот на клавишах");
  namesLabel.htmlFor = namesCheck.id;

  // --- Показ счёта ---
  const scoreCheck = el("input") as HTMLInputElement;
  scoreCheck.type = "checkbox";
  scoreCheck.id = "showScoreCheck";
  scoreCheck.checked = current.showScore;
  scoreCheck.addEventListener("change", () => store.update({ showScore: scoreCheck.checked }));
  const scoreLabel = el("label", "check-label", "Показывать счёт");
  scoreLabel.htmlFor = scoreCheck.id;

  // --- Окно попадания ---
  const hitSlider = el("input") as HTMLInputElement;
  hitSlider.type = "range";
  hitSlider.min = String(HIT_WINDOW_MIN_MS);
  hitSlider.max = String(HIT_WINDOW_MAX_MS);
  hitSlider.step = "5";
  hitSlider.value = String(current.hitWindowMs);
  const hitValue = el("span", "ctl-value", `±${current.hitWindowMs} мс`);
  hitSlider.addEventListener("input", () => {
    const ms = Math.round(Number.parseFloat(hitSlider.value));
    hitValue.textContent = `±${ms} мс`;
    store.update({ hitWindowMs: ms });
  });

  // --- Громкость ---
  const volumeSlider = el("input") as HTMLInputElement;
  volumeSlider.type = "range";
  volumeSlider.min = "0";
  volumeSlider.max = "100";
  volumeSlider.step = "1";
  volumeSlider.value = String(Math.round(current.volume * 100));
  const volumeValue = el("span", "ctl-value", `${Math.round(current.volume * 100)}%`);
  volumeSlider.addEventListener("input", () => {
    const percent = Math.round(Number.parseFloat(volumeSlider.value));
    volumeValue.textContent = `${percent}%`;
    store.update({ volume: percent / 100 });
  });

  // --- Пресет по умолчанию (применяется при старте) ---
  const presetSelect = el("select") as HTMLSelectElement;
  for (const id of PRESET_ORDER) {
    const option = el("option", undefined, PRESET_NAMES[id]);
    option.value = id;
    presetSelect.appendChild(option);
  }
  presetSelect.value = current.defaultPreset;
  presetSelect.addEventListener("change", () => store.update({ defaultPreset: presetSelect.value as typeof current.defaultPreset }));
  const presetRow = el("div", "settings-row");
  presetRow.append(el("span", "ctl-label", "Пресет при запуске"), presetSelect);

  // --- Сброс ---
  const resetBtn = gameButton("Сбросить настройки", () => store.reset(), "btn small");

  container.append(
    colorRow,
    pair(namesCheck, namesLabel),
    pair(scoreCheck, scoreLabel),
    sliderRow("Окно попадания", hitSlider, hitValue),
    sliderRow("Громкость", volumeSlider, volumeValue),
    presetRow,
    resetBtn,
  );

  // Внешние изменения (например, «Сбросить») — синхронизировать контролы.
  store.subscribe((next) => {
    rightColor.input.value = next.partyColors.right;
    leftColor.input.value = next.partyColors.left;
    namesCheck.checked = next.showNoteNames;
    scoreCheck.checked = next.showScore;
    hitSlider.value = String(next.hitWindowMs);
    hitValue.textContent = `±${next.hitWindowMs} мс`;
    volumeSlider.value = String(Math.round(next.volume * 100));
    volumeValue.textContent = `${Math.round(next.volume * 100)}%`;
    presetSelect.value = next.defaultPreset;
  });
}

function colorInput(value: string, title: string): { wrap: HTMLElement; input: HTMLInputElement } {
  const input = el("input") as HTMLInputElement;
  input.type = "color";
  input.value = value;
  input.title = title;
  const wrap = el("div", "settings-row color-row");
  wrap.append(el("span", "ctl-label", title), input);
  return { wrap, input };
}

function sliderRow(labelText: string, slider: HTMLInputElement, value: HTMLElement): HTMLElement {
  const row = el("div", "settings-row slider-group");
  row.append(el("span", "ctl-label", labelText), slider, value);
  return row;
}

function pair(check: HTMLInputElement, label: HTMLLabelElement): HTMLElement {
  const row = el("div", "settings-row");
  row.append(check, label);
  return row;
}
