/**
 * Пресет «Фортепиано» — сэмплы через smplr (ADR-002 п.4).
 * smplr везёт Splendid Grand Piano (public domain) со своего CDN; Salamander
 * в smplr не входит (research 01, открытый пункт) — замена сэмплов позже
 * делается опцией baseUrl, интерфейс источника не меняется.
 * Загрузка ленивая: источник создаётся при первом использовании пресета;
 * прогресс отдаётся наружу для индикации в HUD.
 */
import { SplendidGrandPiano } from "smplr";
import type { LoadState, PresetId } from "../core/types";
import type { InstrumentSource } from "./source";

type SmplrPiano = ReturnType<typeof SplendidGrandPiano>;

export type SamplerLoadNotify = (state: LoadState, progress: number | null) => void;

/** Release-фейд сэмпла, сек (research 01 п.5: естественное затухание 0.3–0.6). */
const DECAY_TIME_SEC = 0.4;

/** Запущенный голос: StopFn smplr + аудио-время старта (для отмены запланированных). */
interface ScheduledStop {
  stop: (time?: number) => void;
  startAt: number;
}

export class SamplerSource implements InstrumentSource {
  readonly presetId: PresetId = "piano";
  private piano: SmplrPiano | null = null;
  /** Запущенные голоса, стек по питчу (репичи). */
  private readonly stops = new Map<number, ScheduledStop[]>();

  constructor(ctx: AudioContext, notify: SamplerLoadNotify, destination?: AudioNode) {
    const piano = SplendidGrandPiano(ctx, {
      volume: 100,
      decayTime: DECAY_TIME_SEC,
      destination, // мастер-гейн движка (громкость SPEC §4.8); undefined → ctx.destination
      onLoadProgress: (progress) => {
        if (progress.total > 0) notify("loading", progress.loaded / progress.total);
      },
    });
    this.piano = piano;
    void piano.ready
      .then(() => notify("ready", 1))
      .catch((err: unknown) => {
        console.error("Не удалось загрузить сэмплы фортепиано:", err);
        notify("error", null);
      });
  }

  noteOn(pitch: number, velocity: number, timeSec: number): void {
    if (!this.piano) return;
    const stop = this.piano.start({ note: pitch, velocity, time: timeSec });
    const stack = this.stops.get(pitch) ?? [];
    stack.push({ stop, startAt: timeSec });
    this.stops.set(pitch, stack);
  }

  noteOff(pitch: number, timeSec: number, _fadeSec: number): void {
    // smplr применяет собственный фейд (decayTime) — сэмпл не обрывается.
    const stack = this.stops.get(pitch);
    const voice = stack?.pop();
    if (!voice || !stack) return;
    voice.stop(timeSec);
    if (stack.length === 0) this.stops.delete(pitch);
  }

  allOff(timeSec: number, _fadeSec: number): void {
    for (const stack of this.stops.values()) {
      for (const voice of stack) voice.stop(timeSec);
    }
    this.stops.clear();
  }

  /**
   * Отмена запланированных голосов (PIANO-23). StopFn smplr до времени старта
   * отменяет голос (doc SmplrImpl.start: «cancels the note if it hasn't played
   * yet»): снимает недиспатченное событие планировщика, а уже созданному
   * Voice.stop(t ≤ startAt) делает source.stop(t) + cancelScheduledValues —
   * по спецификации Web Audio источник со stop ≤ start не зазвучит.
   * StopFn() без аргумента = мгновенно (now ≤ startAt отменённых голосов).
   */
  cancelScheduled(fromSec: number): void {
    for (const [pitch, stack] of this.stops) {
      const kept = stack.filter((voice) => {
        if (voice.startAt < fromSec) return true; // уже звучит — не трогаем
        voice.stop();
        return false;
      });
      if (kept.length === 0) this.stops.delete(pitch);
      else this.stops.set(pitch, kept);
    }
  }

  dispose(): void {
    this.allOff(0, DECAY_TIME_SEC);
    this.piano?.dispose();
    this.piano = null;
  }
}
