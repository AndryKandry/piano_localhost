/**
 * Ход урока «Азбуки» (ADR-007 п.4): конечный автомат карточек
 * вопрос → ответ → обратная связь → следующая → итог. Чистая логика БЕЗ DOM
 * — тестируется в node (scripts/smoke-primer.ts), экран только потребляет.
 *
 * Один ответ на карточку: неверный ответ сразу показывает вердикт с
 * объяснением («Это G4 — вторая линия») и подсветкой верной ноты; дальше —
 * «Далее». Факты не считаются в проценте. Прогресс (лучший %, разблокировка)
 * живёт в progress.ts — движок про localStorage не знает.
 */
import { PRIMER_PASS_PERCENT, type LessonResult, type PrimerCard, type PrimerLesson, type Rng } from "./types";

/** Фаза карточки: вопрос ждёт ответа, обратная связь ждёт «Далее». */
export type PrimerPhase = "question" | "feedback" | "finished";

/** Мгновенная обратная связь карточки (SPEC §4.9: верно/неверно + почему). */
export interface PrimerVerdict {
  correct: boolean;
  explanation: string;
  /** Питч верной ноты для подсветки на стане; null — подсветки нет. */
  highlightPitch: number | null;
}

export class PrimerEngine {
  private cards: PrimerCard[] = [];
  private lessonId = "";
  private index = 0;
  private phase: PrimerPhase = "finished";
  private correct = 0;
  private answered = 0;
  private streak = 0;
  private bestStreak = 0;
  private lastVerdict: PrimerVerdict | null = null;
  private readonly rng: Rng;

  constructor(rng: Rng = Math.random) {
    this.rng = rng;
  }

  /** Ответных карточек в серии (факты не считаются). */
  get cardCount(): number {
    return this.cards.filter((card) => card.answer !== null).length;
  }

  get currentIndex(): number {
    return this.index;
  }

  get currentPhase(): PrimerPhase {
    return this.phase;
  }

  get currentCard(): PrimerCard | null {
    return this.cards[this.index] ?? null;
  }

  get verdict(): PrimerVerdict | null {
    return this.lastVerdict;
  }

  /** Текущий стрик верных ответов подряд. */
  get currentStreak(): number {
    return this.streak;
  }

  /** Сколько ответных карточек пройдено. */
  get answeredCount(): number {
    return this.answered;
  }

  /** Начать урок заново: серия карточек генерируется через rng урока. */
  start(lesson: PrimerLesson): void {
    this.cards = lesson.generate(this.rng);
    this.lessonId = lesson.id;
    this.index = 0;
    this.phase = "question";
    this.correct = 0;
    this.answered = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.lastVerdict = null;
  }

  /**
   * Ответ клавишей пианино (питч из маппинга основной игры). Вердикт —
   * только в фазе вопроса и на карточке с питч-ответом; иначе null
   * (нажатия в факт/выбор карточках просто звучат, не судятся).
   */
  answerPitch(pitch: number): PrimerVerdict | null {
    if (this.phase !== "question") return null;
    const card = this.currentCard;
    if (!card || card.answer === null || card.answer.type !== "pitch") return null;
    return this.judge(card.answer.pitch === pitch, card);
  }

  /** Ответ кнопкой выбора; index вне диапазона — null. */
  answerChoice(optionIndex: number): PrimerVerdict | null {
    if (this.phase !== "question") return null;
    const card = this.currentCard;
    if (!card || card.answer === null || card.answer.type !== "choice") return null;
    if (optionIndex < 0 || optionIndex >= card.answer.options.length) return null;
    return this.judge(optionIndex === card.answer.correctIndex, card);
  }

  /**
   * «Далее»: из обратной связи — к следующей карточке или к итогу;
   * на факте (фаза вопроса, ответа нет) — к следующей. На неотвеченной
   * ответной карточке — ничего (нельзя листать мимо вопроса).
   */
  advance(): void {
    const card = this.currentCard;
    if (this.phase === "feedback" || (card !== null && card.answer === null)) {
      if (this.index + 1 >= this.cards.length) {
        this.phase = "finished";
        this.index = Math.max(0, this.cards.length - 1);
        return;
      }
      this.index += 1;
      this.phase = "question";
      this.lastVerdict = null;
    }
  }

  /** Итог урока: процент, стрик, порог ≥80%. Вне фазы finished — null. */
  finish(): LessonResult | null {
    if (this.phase !== "finished") return null;
    const total = this.cardCount;
    const percent = total > 0 ? Math.round((this.correct / total) * 100) : 0;
    return {
      lessonId: this.lessonId,
      percent,
      correct: this.correct,
      total,
      bestStreak: this.bestStreak,
      passed: total > 0 && percent >= PRIMER_PASS_PERCENT,
    };
  }

  private judge(isCorrect: boolean, card: PrimerCard): PrimerVerdict {
    this.phase = "feedback";
    this.answered += 1;
    if (isCorrect) {
      this.correct += 1;
      this.streak += 1;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    } else {
      this.streak = 0;
    }
    const highlightPitch = card.answer?.type === "pitch" ? card.answer.pitch : null;
    const verdict: PrimerVerdict = { correct: isCorrect, explanation: card.explanation, highlightPitch };
    this.lastVerdict = verdict;
    return verdict;
  }
}
