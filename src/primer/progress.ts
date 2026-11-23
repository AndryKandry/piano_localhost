/**
 * Прогресс «Азбуки» (SPEC §4.9): лучший % урока, последовательность уроков —
 * в localStorage (версионированный JSON, паттерн core/settings.ts).
 *
 * Хранилище внедряется конструктором (node-смоук подставляет in-memory),
 * по умолчанию — window.localStorage; недоступен — прогресс живёт в памяти
 * сессии. Разблокировка НЕ хранится, а вычисляется: урок открыт, если у
 * предыдущего bestPercent ≥ порога — нельзя «потерять» открытие при правке
 * порога или добавлении уроков.
 */
import {
  PRIMER_PASS_PERCENT,
  PRIMER_VERSION,
  STORAGE_KEY,
  normalizePrimerProgress,
  type LessonResult,
  type PrimerLesson,
  type PrimerProgress,
} from "./types";

export interface PrimerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type ProgressListener = (progress: PrimerProgress) => void;

export class PrimerProgressStore {
  private data: PrimerProgress;
  private readonly listeners = new Set<ProgressListener>();
  private readonly storage: PrimerStorage | null;

  constructor(storage: PrimerStorage | null = defaultStorage()) {
    this.storage = storage;
    this.data = this.storage ? this.load() : { bestPercent: {} };
  }

  get(): Readonly<PrimerProgress> {
    return this.data;
  }

  /** Лучший % урока (0 — попыток не было). */
  bestPercent(lessonId: string): number {
    return this.data.bestPercent[lessonId] ?? 0;
  }

  /** Записать итог: best = max(старый, новый). Отписки нет — подписка на перерисовку списка. */
  recordResult(result: LessonResult): void {
    const previous = this.bestPercent(result.lessonId);
    if (result.percent <= previous) return;
    this.data = normalizePrimerProgress({
      bestPercent: { ...this.data.bestPercent, [result.lessonId]: result.percent },
    });
    this.persist();
    for (const listener of this.listeners) listener(this.data);
  }

  /** Урок открыт? Первый — всегда; остальные — при bestPercent предыдущего ≥ порога. */
  isUnlocked(lesson: PrimerLesson, lessons: readonly PrimerLesson[]): boolean {
    if (lesson.order <= lessons[0]?.order) return true;
    const index = lessons.findIndex((entry) => entry.id === lesson.id);
    const previous = index > 0 ? lessons[index - 1] : undefined;
    return previous !== undefined && this.bestPercent(previous.id) >= PRIMER_PASS_PERCENT;
  }

  subscribe(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Сброс прогресса (для отладки; UI v1 кнопку сброса не показывает). */
  reset(): void {
    this.data = { bestPercent: {} };
    this.persist();
    for (const listener of this.listeners) listener(this.data);
  }

  private load(): PrimerProgress {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (raw === null || raw === undefined) return { bestPercent: {} };
      return normalizePrimerProgress(JSON.parse(raw));
    } catch {
      return { bestPercent: {} };
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify({ version: PRIMER_VERSION, bestPercent: { ...this.data.bestPercent } }));
    } catch {
      // Квота/приватный режим: прогресс не сохранится, уроки играть можно.
    }
  }
}

function defaultStorage(): PrimerStorage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}
