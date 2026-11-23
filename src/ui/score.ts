/**
 * Экран итогов попытки (SPEC §3.7, §4.7): % попаданий крупно, стрик/лучший
 * стрик, топ ошибок с русскими метками (SCORE_ERROR_LABELS). Открывается по
 * onFinished плеера, если включён показ счёта; лучший результат записывает
 * вызывающий (main) через library.setBest.
 */
import { SCORE_ERROR_LABELS, type ScoreResult } from "../player/judge";
import { el, gameButton } from "./dom";

export interface ScoreScreenApi {
  show(result: ScoreResult, melodyTitle: string, onAgain: () => void): void;
  /** Закрыть экран итогов (например, при повторном запуске мелодии). */
  close(): void;
}

export interface ScoreScreenDeps {
  /** Контейнер модальных диалогов (#dialogRoot, общий с dialogs.ts). */
  root: HTMLElement;
}

export function initScoreScreen(deps: ScoreScreenDeps): ScoreScreenApi {
  let escapeHandler: ((event: KeyboardEvent) => void) | null = null;

  function close(): void {
    deps.root.replaceChildren();
    if (escapeHandler) {
      window.removeEventListener("keydown", escapeHandler);
      escapeHandler = null;
    }
  }

  function show(result: ScoreResult, melodyTitle: string, onAgain: () => void): void {
    const backdrop = el("div", "dialog-backdrop");
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close();
    });

    const card = el("div", "dialog-card score-card");
    card.appendChild(el("p", "score-kicker", "Прохождение завершено"));
    card.appendChild(el("h3", "dialog-title", melodyTitle));

    const percent = el("div", "score-percent", `${Math.round(result.hitPercent)}%`);
    percent.title = `${result.hitGroups} из ${result.totalGroups} групп`;
    card.appendChild(percent);
    card.appendChild(el("p", "score-sub", "попаданий"));

    const stats = el("div", "score-stats");
    stats.append(
      statTile("Стрик", String(result.streak)),
      statTile("Лучший стрик", String(result.bestStreak)),
      statTile("Группы", `${result.hitGroups}/${result.totalGroups}`),
    );
    card.appendChild(stats);

    // Топ ошибок: те же числом встречаемости, отсортированы по убыванию.
    const byLabel = new Map<string, number>();
    for (const error of result.errors) {
      const label = SCORE_ERROR_LABELS[error.kind];
      byLabel.set(label, (byLabel.get(label) ?? 0) + 1);
    }
    const errorsBlock = el("div", "score-errors");
    if (byLabel.size === 0) {
      errorsBlock.appendChild(el("p", "score-errors-title ok", "Без ошибок!"));
    } else {
      errorsBlock.appendChild(el("p", "score-errors-title", "Топ ошибок"));
      const top = [...byLabel.entries()].sort((a, b) => b[1] - a[1]);
      for (const [label, count] of top) {
        const row = el("div", "score-error-row");
        row.append(el("span", undefined, label), el("b", undefined, String(count)));
        errorsBlock.appendChild(row);
      }
    }
    card.appendChild(errorsBlock);

    const againBtn = gameButton("Ещё раз", () => {
      close();
      onAgain();
    });
    againBtn.classList.add("primary");
    const actions = el("div", "dialog-actions");
    actions.append(gameButton("Закрыть", close), againBtn);
    card.appendChild(actions);

    backdrop.appendChild(card);
    deps.root.replaceChildren(backdrop);
    againBtn.focus();

    const onEscape = (event: KeyboardEvent): void => {
      // Самоочистка: другой модал мог заменить наш DOM.
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

  return { show, close };
}

function statTile(label: string, value: string): HTMLElement {
  const tile = el("div", "stat-tile");
  tile.append(el("span", "stat-value", value), el("span", "stat-label", label));
  return tile;
}
