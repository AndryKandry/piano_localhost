/**
 * Тосты — краткие уведомления поверх игры (ошибки импорта ImportError,
 * успехи загрузки). Никаких alert() — они крадут фокус и блокируют rAF.
 */
import { el } from "./dom";

const TOAST_LIFETIME_MS = 4000;
const FADE_MS = 300;
const MAX_VISIBLE = 4;

let root: HTMLElement | null = null;

function ensureRoot(): HTMLElement {
  if (!root) {
    root = el("div", "toast-root");
    document.body.appendChild(root);
  }
  return root;
}

export function showToast(message: string, kind: "info" | "error" = "info"): void {
  const holder = ensureRoot();
  while (holder.children.length >= MAX_VISIBLE) holder.firstElementChild?.remove();
  const toast = el("div", `toast ${kind}`, message);
  holder.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add("gone");
    window.setTimeout(() => toast.remove(), FADE_MS);
  }, TOAST_LIFETIME_MS);
}
