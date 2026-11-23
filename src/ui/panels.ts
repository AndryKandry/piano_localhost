/**
 * Боковая панель (DOM поверх канвасов — ADR-004): «Библиотека», «Загрузить»,
 * «Тембр», «Настройки» (рендер делегирует ui/settings.ts). Скрывается/показывается
 * кнопкой-гамбургером или F1 — игровые клавиши не конфликтуют (панель вне
 * маппинга, Tab-порядок естественный).
 *
 * Загрузка своего файла: кнопка выбора + drag&drop на всё окно (overlay
 * «Отпустите файл»); ошибки ImportError — тостом (ui/toast.ts).
 */
import { formatDuration, el, gameButton } from "./dom";
import { showToast } from "./toast";
import { initSettingsSection } from "./settings";
import { PRESET_NAMES, PRESET_ORDER } from "../core/presets";
import type { SettingsStore } from "../core/settings";
import type { LibraryStore, MelodyMeta } from "../library/store";
import type { LoadState, PresetId } from "../core/types";

export interface PanelsApi {
  /** Показать/скрыть панель; без аргумента — переключить. */
  toggle(force?: boolean): void;
  isVisible(): boolean;
  /** Перечитать список библиотеки (после загрузки/удаления/нового счёта). */
  refreshLibrary(): void;
  /** Подсветить активную мелодию (null — ничего не активно). */
  setActiveMelody(id: string | null): void;
  /** Подсветить активный пресет. */
  setActivePreset(id: PresetId): void;
  /** Индикатор загрузки сэмплов в секции «Тембр». */
  setSampleLoad(state: LoadState, progress: number | null): void;
}

export interface PanelsDeps {
  library: LibraryStore;
  settingsStore: SettingsStore;
  /** Контейнер панели (#sidePanel). */
  mount: HTMLElement;
  /** Полноэкранный overlay drag&drop (#dropOverlay). */
  dropOverlay: HTMLElement;
  /** Кнопка-гамбургер (#panelToggle). */
  toggleButton: HTMLButtonElement;
  /** Клик по мелодии: загрузить в плеер и начать learn-режим. */
  onPlay(id: string): void;
  /** Удаление пользовательской мелодии (store+плеер делает вызывающий). */
  onDelete(id: string): void;
  /** Смена пресета. */
  onPreset(id: PresetId): void;
  /** Открыть диалог «Разбор партий». */
  onOpenSplit(id: string): void;
}

export function initSidePanel(deps: PanelsDeps): PanelsApi {
  const { library, mount, dropOverlay, toggleButton } = deps;
  mount.classList.add("side-panel");

  const activeCards = new Map<string, HTMLElement>();
  let activeMelodyId: string | null = null;

  // --- Секция «Библиотека» ---
  const librarySection = el("section", "panel-section");
  librarySection.appendChild(el("h3", "panel-heading", "Библиотека"));
  const melodyList = el("div", "melody-list");
  librarySection.appendChild(melodyList);

  // --- Секция «Загрузить» ---
  const uploadSection = el("section", "panel-section");
  uploadSection.appendChild(el("h3", "panel-heading", "Загрузить"));
  const fileInput = el("input") as HTMLInputElement;
  fileInput.type = "file";
  fileInput.accept = ".mid,.midi,.musicxml,.xml";
  fileInput.multiple = true;
  fileInput.hidden = true;
  const uploadBtn = gameButton("Выбрать файл…", () => fileInput.click());
  uploadBtn.classList.add("wide");
  const uploadHint = el("p", "panel-hint", "Поддерживаются .mid и .musicxml/.xml. Можно перетащить файл прямо в окно.");
  uploadSection.append(uploadBtn, fileInput, uploadHint);
  fileInput.addEventListener("change", () => {
    void handleFiles(Array.from(fileInput.files ?? []));
    fileInput.value = "";
  });

  // --- Секция «Тембр» ---
  const timbreSection = el("section", "panel-section");
  timbreSection.appendChild(el("h3", "panel-heading", "Тембр"));
  const presetButtons = new Map<PresetId, HTMLButtonElement>();
  const presetGroup = el("div", "preset-grid");
  for (const id of PRESET_ORDER) {
    const button = gameButton(PRESET_NAMES[id], () => deps.onPreset(id), "btn preset-btn");
    presetButtons.set(id, button);
    presetGroup.appendChild(button);
  }
  const sampleStatus = el("span", "sample-status", "Сэмплы фортепиано: —");
  timbreSection.append(presetGroup, sampleStatus);

  // --- Секция «Настройки» ---
  const settingsSection = el("section");
  initSettingsSection(settingsSection, deps.settingsStore);

  mount.append(librarySection, uploadSection, timbreSection, settingsSection);

  // --- Гамбургер ---
  toggleButton.classList.add("panel-toggle");
  toggleButton.addEventListener("click", () => api.toggle());

  // --- Drag&drop на всё окно ---
  let dragDepth = 0;
  window.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    dragDepth += 1;
    dropOverlay.classList.add("visible");
  });
  window.addEventListener("dragover", (event) => {
    // Без dragover- preventDefault браузер не откроет drop.
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
  });
  window.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropOverlay.classList.remove("visible");
  });
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    dropOverlay.classList.remove("visible");
    void handleFiles(Array.from(event.dataTransfer?.files ?? []));
  });

  async function handleFiles(files: File[]): Promise<void> {
    for (const file of files) {
      try {
        const meta = await library.addUserFile(file);
        showToast(`Добавлено: ${meta.title}`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showToast(`Не удалось загрузить «${file.name}»: ${message}`, "error");
      }
    }
    api.refreshLibrary();
  }

  // --- Карточки библиотеки ---
  function buildCardNode(meta: MelodyMeta): HTMLElement {
    const card = el("div", "mel-card");
    card.dataset.id = meta.id;

    const main = el("button", "mel-main");
    main.type = "button";
    // Клик не переносит фокус: Space остаётся педалью (см. ui/dom.ts gameButton).
    main.addEventListener("mousedown", (event) => event.preventDefault());
    const titleRow = el("span", "mel-title-row");
    titleRow.append(el("span", "mel-title", meta.title), el("span", `mel-badge ${meta.source}`, meta.source === "builtin" ? "встроенная" : "своя"));
    const metaLine = el("span", "mel-meta");
    metaLine.append(
      el("span", undefined, meta.composer),
      el("span", undefined, formatDuration(meta.durationSec)),
      el("span", undefined, meta.bestScore !== undefined ? `Лучший: ${Math.round(meta.bestScore)}%` : "Попыток не было"),
    );
    main.append(titleRow, metaLine);
    main.addEventListener("click", () => deps.onPlay(meta.id));

    const actions = el("div", "mel-actions");
    const splitBtn = gameButton("Партии", () => deps.onOpenSplit(meta.id), "btn small");
    actions.appendChild(splitBtn);
    if (meta.source === "user") {
      const removeBtn = gameButton("Удалить", () => deps.onDelete(meta.id), "btn small danger");
      actions.appendChild(removeBtn);
    }

    card.append(main, actions);
    return card;
  }

  const api: PanelsApi = {
    toggle(force?: boolean): void {
      const show = force ?? !mount.classList.contains("open");
      mount.classList.toggle("open", show);
      toggleButton.setAttribute("aria-expanded", String(show));
      toggleButton.textContent = show ? "✕" : "☰ Панель";
    },
    isVisible(): boolean {
      return mount.classList.contains("open");
    },
    refreshLibrary(): void {
      activeCards.clear();
      melodyList.replaceChildren();
      for (const meta of library.list()) {
        const card = buildCardNode(meta);
        if (meta.id === activeMelodyId) card.classList.add("active");
        activeCards.set(meta.id, card);
        melodyList.appendChild(card);
      }
    },
    setActiveMelody(id: string | null): void {
      if (activeMelodyId === id) return;
      const previous = activeMelodyId ? activeCards.get(activeMelodyId) : undefined;
      previous?.classList.remove("active");
      activeMelodyId = id;
      if (id !== null) activeCards.get(id)?.classList.add("active");
    },
    setActivePreset(id: PresetId): void {
      for (const [presetId, button] of presetButtons) button.classList.toggle("active", presetId === id);
    },
    setSampleLoad(state: LoadState, progress: number | null): void {
      sampleStatus.classList.remove("loading", "ready", "error");
      switch (state) {
        case "loading":
          sampleStatus.classList.add("loading");
          sampleStatus.textContent =
            progress === null ? "Сэмплы фортепиано: загрузка…" : `Сэмплы фортепиано: загрузка ${Math.round(progress * 100)}%`;
          break;
        case "ready":
          sampleStatus.classList.add("ready");
          sampleStatus.textContent = "Сэмплы фортепиано: готовы";
          break;
        case "error":
          sampleStatus.classList.add("error");
          sampleStatus.textContent = "Сэмплы фортепиано: не загрузились (CDN недоступен?)";
          break;
        case "idle":
          sampleStatus.textContent = "Сэмплы фортепиано: —";
          break;
      }
    },
  };

  // Начальный рендер: builtin видны сразу, user-записи подтянут main после library.ready().
  api.refreshLibrary();
  return api;
}
