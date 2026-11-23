/**
 * Аудио-часы — единственный источник истины о времени во время игры
 * (инвариант GLOSSARY #2, ADR-002). Не Date.now(), не performance.now().
 */
export class AudioClock {
  private ctx: AudioContext | null = null;

  /** Создаёт AudioContext. Безопасно звать до первого жеста: контекст стартует suspended. */
  init(): void {
    if (this.ctx) return;
    this.ctx = new AudioContext({ latencyHint: "interactive" });
  }

  /** Возобновить контекст (autoplay policy). Идемпотентно, отказ не фатален. */
  async resume(): Promise<void> {
    if (!this.ctx || this.ctx.state === "running") return;
    try {
      await this.ctx.resume();
    } catch {
      // Проигрышная гонка с политикой автоплея — повторим по следующему жесту.
    }
  }

  /** Разблокировка по первому пользовательскому жесту (research 01 п.1). */
  attachUnlock(): void {
    const unlock = (): void => {
      void this.resume();
    };
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock, { passive: true });
    window.addEventListener("touchstart", unlock, { passive: true });
  }

  /** Аудио-часы в секундах. До init() — 0. */
  currentTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** Состояние контекста — движок звонит resume при живом вводе в suspended. */
  get state(): AudioContextState {
    return this.ctx?.state ?? "suspended";
  }

  /** Задержка графа в секундах — для замера бюджета < 40 мс (SPEC §6). */
  get baseLatencySec(): number {
    return this.ctx?.baseLatency ?? 0;
  }

  /** Контекст для аудио-слоёв; создаёт при необходимости. */
  context(): AudioContext {
    if (!this.ctx) this.init();
    if (!this.ctx) throw new Error("Не удалось создать AudioContext");
    return this.ctx;
  }
}
