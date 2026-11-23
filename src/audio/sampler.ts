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

export class SamplerSource implements InstrumentSource {
  readonly presetId: PresetId = "piano";
  private piano: SmplrPiano | null = null;
  /** StopFn на каждый запущенный голос, стек по питчу (репичи). */
  private readonly stops = new Map<number, Array<(time?: number) => void>>();

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
    stack.push(stop);
    this.stops.set(pitch, stack);
  }

  noteOff(pitch: number, timeSec: number, _fadeSec: number): void {
    // smplr применяет собственный фейд (decayTime) — сэмпл не обрывается.
    const stack = this.stops.get(pitch);
    const stop = stack?.pop();
    if (!stop || !stack) return;
    stop(timeSec);
    if (stack.length === 0) this.stops.delete(pitch);
  }

  allOff(timeSec: number, _fadeSec: number): void {
    for (const stack of this.stops.values()) {
      for (const stop of stack) stop(timeSec);
    }
    this.stops.clear();
  }

  dispose(): void {
    this.allOff(0, DECAY_TIME_SEC);
    this.piano?.dispose();
    this.piano = null;
  }
}
