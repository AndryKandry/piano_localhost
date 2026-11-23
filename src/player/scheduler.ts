/**
 * Lookahead-планировщик автоплея/автопартии (ADR-002 п.2, «A Tale of Two
 * Clocks»): неточный JS-таймер (~25 мс) только опрашивает очередь, звук
 * планируется точными вызовами с абсолютным временем на аудио-часах на ~100 мс
 * вперёд. В wait-mode ноты нажимаемой партии не планируются вовсе — host
 * возвращает null для времён за гейтом, и они звучат по факту нажатия.
 *
 * Никакой синхронизации через performance.now/Date.now — только TimeSource
 * (инвариант GLOSSARY #2).
 */
import type { TimeSource } from "../core/clock";
import type { Note } from "../core/types";
import type { AudioNoteTarget } from "./player";

/** Чего планирует плеер (реализуется Player). */
export interface SchedulerHost {
  /** Аудио-время для музыкального; null — время стоит (пауза/wait-mode гейт). */
  audioTimeFor(songTime: number): number | null;
  /** Длительность ноты в секундах стены (учитывает множитель скорости). */
  wallDurationSec(songDurationSec: number): number;
}

/** Тик планировщика (research 01: 25 мс). */
export const SCHEDULER_TICK_MS = 25;
/** Окно планирования вперёд по аудио-часам (research 01: 100 мс). */
export const SCHEDULER_LOOKAHEAD_SEC = 0.1;
/** Безнадёжно опоздавшие ноты (фоновая вкладка душит таймер) не играются. */
const LATE_SKIP_SEC = 0.25;

export class Scheduler {
  private notes: readonly Note[] = [];
  private index = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly clock: TimeSource,
    private readonly engine: AudioNoteTarget,
    private readonly host: SchedulerHost,
  ) {}

  /** Запуск тика. Повторный вызов безвреден. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), SCHEDULER_TICK_MS);
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Новый набор нот автопартии (смена режима/партии/мелодии). */
  setNotes(notes: readonly Note[]): void {
    this.notes = notes;
    this.index = 0;
  }

  /** Продвинуть курсор мимо нот, чьё время уже прошло (позиция прыгнула). */
  resync(songTimeNow: number): void {
    while (this.index < this.notes.length) {
      const note = this.notes[this.index];
      if (!note || note.startTimeSec >= songTimeNow - 1e-6) break;
      this.index += 1;
    }
  }

  /**
   * Один такт планирования. Публичен для smoke-проверки без setInterval.
   */
  tick(): void {
    const now = this.clock.currentTime();
    const horizon = now + SCHEDULER_LOOKAHEAD_SEC;
    while (this.index < this.notes.length) {
      const note = this.notes[this.index];
      if (!note) break;
      const at = this.host.audioTimeFor(note.startTimeSec);
      if (at === null) break; // время стоит — будущие ноты не планируются
      if (at > horizon) break;
      this.index += 1;
      if (at < now - LATE_SKIP_SEC) continue; // опоздала сверх меры — пропускаем
      // «Прямо сейчас» играем немедленно (research 01), иначе — точно в at.
      this.engine.playNote(note.pitch, note.velocity, Math.max(at, now), this.host.wallDurationSec(note.durationSec));
    }
  }

  dispose(): void {
    this.stop();
    this.notes = [];
    this.index = 0;
  }
}
