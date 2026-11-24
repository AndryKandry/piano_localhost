/**
 * DOM-помощники панелей (ADR-004: DOM — только для панелей, канвасы не трогаем).
 */

/** Элемент по id; отсутствие — ошибка сборки страницы, не тихий null. */
export function requireEl<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Элемент #${id} не найден`);
  return element as T;
}

/** Создать элемент с классом и текстом. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Длительность «m:ss» — HUD и карточки библиотеки. */
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Кнопка, не принимающая фокус кликом мыши: Space остаётся педалью, а не
 * «нажать последнюю кнопку» (профиль: игровые клавиши не конфликтуют с UI).
 * Tab — нота C4 по решению игрока (ADR-006): фокус-навигация отключена,
 * UI — мышью; Enter на сфокусированной кнопке работает как обычно.
 */
export function gameButton(label: string, onClick: () => void, className = "btn"): HTMLButtonElement {
  const button = el("button", className, label);
  button.type = "button";
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => onClick());
  return button;
}
