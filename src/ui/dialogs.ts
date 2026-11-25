/**
 * Диалог «Разбор партий» (SPEC §4.4, ADR-003 п.4): ручной порог сплита, когда
 * автоматическая эвристика импорта определила руки криво. Слайдер 48–72
 * (C3–C5) с подписями нот, живое превью «правая/левая» при данном пороге,
 * «Применить» пересобирает handPart нот (pitch < порога → левая) и отдаёт
 * плееру свежую КОПИЮ мелодии — библиотечный оригинал не трогается.
 */
import { pitchName } from "../core/layout";
import { SPLIT_MAX, SPLIT_MIN, clampSplitPoint, countHandNotes, resplitMelody } from "../library/split";
import type { LibraryStore } from "../library/store";
import type { Melody } from "../core/types";
import { PARTY_COLORS } from "../render/colors";
import { el, gameButton } from "./dom";

export interface ConfirmOptions {
  /** Заголовок карточки («Удалить «Название»?»). */
  title: string;
  /** Пояснение под заголовком (что произойдёт и обратимо ли). */
  hint: string;
  /** Надпись danger primary-кнопки («Удалить»). */
  confirmLabel: string;
  /** Надпись второстепенной кнопки (по умолчанию «Отмена»). */
  cancelLabel?: string;
}

export interface DialogsApi {
  openSplit(id: string): void;
  /**
   * Модальное подтверждение (DS §3.8): true — нажата danger primary,
   * false — отмена, Escape или клик мимо карточки. Заменяет window.confirm,
   * который блокирует rAF и вне системы (нативное окно не стилизуется).
   */
  confirm(options: ConfirmOptions): Promise<boolean>;
}

export interface DialogsDeps {
  library: LibraryStore;
  /** Контейнер модальных диалогов (#dialogRoot). */
  root: HTMLElement;
  /** Применить пересобранную мелодию: loadMelody в плеер + подсветка в панели. */
  onApply(id: string, melody: Melody): void;
}

export function initDialogs(deps: DialogsDeps): DialogsApi {
  let escapeHandler: ((event: KeyboardEvent) => void) | null = null;

  function close(): void {
    deps.root.replaceChildren();
    if (escapeHandler) {
      window.removeEventListener("keydown", escapeHandler);
      escapeHandler = null;
    }
  }

  function openSplit(id: string): void {
    let melody: Melody;
    try {
      melody = deps.library.get(id);
    } catch {
      return; // запись удалена между рендером списка и кликом
    }

    const initial = melody.splitPoint ?? 60;

    const backdrop = el("div", "dialog-backdrop");
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close();
    });

    const card = el("div", "dialog-card");
    card.appendChild(el("h3", "dialog-title", `Разбор партий — ${melody.title}`));
    card.appendChild(
      el(
        "p",
        "dialog-hint",
        "Ноты ниже порога уходят в левую руку, выше — в правую. Для мелодий, у которых руки определены по трекам/каналам, применённый порог перекрывает авторское разбиение.",
      ),
    );

    // --- Слайдер порога с подписями нот ---
    const splitSlider = el("input") as HTMLInputElement;
    splitSlider.type = "range";
    splitSlider.min = String(SPLIT_MIN);
    splitSlider.max = String(SPLIT_MAX);
    splitSlider.step = "1";
    splitSlider.value = String(clampSplitPoint(initial));

    const splitValue = el("div", "split-value", "");
    const scale = el("div", "split-scale");
    scale.append(el("span", undefined, pitchName(SPLIT_MIN)), el("span", undefined, pitchName(60)), el("span", undefined, pitchName(SPLIT_MAX)));

    const countsRow = el("div", "split-counts");
    const rightDot = el("span", "dot");
    rightDot.style.background = PARTY_COLORS.right;
    const leftDot = el("span", "dot");
    leftDot.style.background = PARTY_COLORS.left;
    countsRow.append(leftDot, el("span", "split-count-left", ""), el("span", "split-sep", "·"), rightDot, el("span", "split-count-right", ""));

    function refresh(): void {
      const point = clampSplitPoint(Number.parseFloat(splitSlider.value));
      splitValue.textContent = `Порог: ${pitchName(point)} (MIDI ${point})`;
      const counts = countHandNotes(melody, point);
      const rightLabel = countsRow.querySelector(".split-count-right");
      const leftLabel = countsRow.querySelector(".split-count-left");
      if (rightLabel) rightLabel.textContent = `правая: ${counts.right}`;
      if (leftLabel) leftLabel.textContent = `левая: ${counts.left}`;
    }
    splitSlider.addEventListener("input", refresh);
    refresh();

    // --- Кнопки ---
    const applyBtn = gameButton("Применить", () => {
      const point = clampSplitPoint(Number.parseFloat(splitSlider.value));
      deps.onApply(id, resplitMelody(melody, point));
      close();
    });
    applyBtn.classList.add("primary");
    const closeBtn = gameButton("Закрыть", close);
    const actions = el("div", "dialog-actions");
    actions.append(closeBtn, applyBtn);

    card.append(splitValue, splitSlider, scale, countsRow, actions);
    backdrop.appendChild(card);
    deps.root.replaceChildren(backdrop);
    splitSlider.focus();

    const onEscape = (event: KeyboardEvent): void => {
      // Самоочистка: другой модал (экран итогов) мог заменить наш DOM.
      if (!backdrop.isConnected) {
        window.removeEventListener("keydown", onEscape);
        escapeHandler = null;
        return;
      }
      if (event.code === "Escape") close();
    };
    escapeHandler = onEscape;
    window.addEventListener("keydown", onEscape);
  }

  function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (confirmed: boolean): void => {
        if (settled) return;
        settled = true;
        close();
        resolve(confirmed);
      };

      const backdrop = el("div", "dialog-backdrop");
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) finish(false);
      });

      const card = el("div", "dialog-card");
      card.appendChild(el("h3", "dialog-title", options.title));
      card.appendChild(el("p", "dialog-hint", options.hint));

      // §3.8: второстепенная, затем primary (здесь — danger primary: краснеет
      // только как заливка необратимого действия, не «в покое»).
      const cancelBtn = gameButton(options.cancelLabel ?? "Отмена", () => finish(false));
      const confirmBtn = gameButton(options.confirmLabel, () => finish(true), "btn danger primary");
      const actions = el("div", "dialog-actions");
      actions.append(cancelBtn, confirmBtn);
      card.appendChild(actions);

      backdrop.appendChild(card);
      deps.root.replaceChildren(backdrop);
      confirmBtn.focus(); // фокус приходит на primary (DS §3.8)

      const onEscape = (event: KeyboardEvent): void => {
        // Самоочистка: другой модал мог заменить наш DOM.
        if (!backdrop.isConnected) {
          window.removeEventListener("keydown", onEscape);
          escapeHandler = null;
          return;
        }
        if (event.code === "Escape") finish(false);
      };
      escapeHandler = onEscape;
      window.addEventListener("keydown", onEscape);
    });
  }

  return { openSplit, confirm };
}
