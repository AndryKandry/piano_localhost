/**
 * Сэмпловые пресеты на soundfont-банке (ADR-002): Электропиано, Гитара,
 * Струнные, Флейта — smplr Soundfont поверх midi-js-soundfonts (gleitz CDN,
 * kit MusyngKite — как у сэмплов фортепиано ленивая загрузка с прогрессом).
 * Паттерн — audio/sampler.ts: stops-стек по питчу (репичи), notify наружу
 * для индикации загрузки, dispose освобождает инструмент.
 *
 * Гейт-фейд отпускания — ampRelease голоса smplr (пер-нота, как decayTime у
 * Splendid): StopFn(time) планирует release с той же длительностью. Флейта —
 * тянущаяся: тянем loop-данные (goldst.dev), чтобы сэмпл не обрывался, пока
 * клавиша держится; недоступность loop-данных не ошибка — smplr молча играет
 * без цикла. Струнные в банке без loop-данных — one-shot с затуханием.
 */
import { Soundfont } from "smplr";
import type { LoadState, PresetId } from "../core/types";
import type { InstrumentSource } from "./source";

type SmplrSoundfont = ReturnType<typeof Soundfont>;

export type SfontLoadNotify = (state: LoadState, progress: number | null) => void;

export interface SfontSpec {
  /** instrument-строка банка midi-js-soundfonts (getSoundfontNames()). */
  instrument: string;
  /** Гейт-фейд при отпускании (ampRelease голоса), сек (research 01: 0.3–0.6). */
  releaseSec: number;
  /** Тянущиеся инструменты: загрузить loop-данные для сустейна. */
  loadLoopData: boolean;
  /** Баланс громкости против остальных пресетов (PIANO-21, по слуху). */
  gain?: number;
}

/**
 * Звуковые пресеты на soundfont-банке; ключи — подмножество PresetId.
 * loadLoopData только там, где loop.json реально есть в банке (проверено
 * curl-ом; у string_ensemble_1 его нет — one-shot сэмплы с естественным
 * затуханием, лишний 404 не нужен).
 */
export const SFONT_PRESETS: Partial<Record<PresetId, SfontSpec>> = {
  epiano: { instrument: "electric_piano_1", releaseSec: 0.3, loadLoopData: false, gain: 1.15 },
  guitar: { instrument: "acoustic_guitar_steel", releaseSec: 0.35, loadLoopData: false, gain: 1.7 },
  strings: { instrument: "string_ensemble_1", releaseSec: 0.5, loadLoopData: false, gain: 1.25 },
  flute: { instrument: "flute", releaseSec: 0.35, loadLoopData: true, gain: 1.25 },
};

export class SoundFontSource implements InstrumentSource {
  readonly presetId: PresetId;
  private sf: SmplrSoundfont | null = null;
  /** Пресетный gain-узел (баланс громкости); null при gain 1/undefined. */
  private presetGain: GainNode | null = null;
  /** Гейт-фейд голосов этого пресета (ampRelease), сек. */
  private readonly releaseSec: number;
  /** StopFn на каждый запущенный голос, стек по питчу (репичи). */
  private readonly stops = new Map<number, Array<(time?: number) => void>>();

  constructor(
    presetId: PresetId,
    spec: SfontSpec,
    ctx: AudioContext,
    notify: SfontLoadNotify,
    destination?: AudioNode,
  ) {
    this.presetId = presetId;
    this.releaseSec = spec.releaseSec;
    // Баланс громкости пресетов (PIANO-21, по слуху игрока): свои GainNode
    // перед мастер-ом — soundfont-банку завышать volume (>100) не надёжно.
    let output: AudioNode = destination ?? ctx.destination;
    if (spec.gain !== undefined && spec.gain !== 1) {
      const presetGain = ctx.createGain();
      presetGain.gain.value = spec.gain;
      presetGain.connect(output);
      output = presetGain;
      this.presetGain = presetGain;
    }
    const sf = Soundfont(ctx, {
      instrument: spec.instrument,
      volume: 100,
      loadLoopData: spec.loadLoopData,
      destination: output,
      onLoadProgress: (progress) => {
        if (progress.total > 0) notify("loading", progress.loaded / progress.total);
      },
    });
    this.sf = sf;
    void sf.ready
      .then(() => notify("ready", 1))
      .catch((err: unknown) => {
        console.error(`Не удалось загрузить сэмплы ${spec.instrument}:`, err);
        notify("error", null);
      });
  }

  noteOn(pitch: number, velocity: number, timeSec: number): void {
    if (!this.sf) return;
    const stop = this.sf.start({ note: pitch, velocity, time: timeSec, ampRelease: this.releaseSec });
    const stack = this.stops.get(pitch) ?? [];
    stack.push(stop);
    this.stops.set(pitch, stack);
  }

  noteOff(pitch: number, timeSec: number, _fadeSec: number): void {
    // smplr применяет собственный фейд (ampRelease) — сэмпл не обрывается.
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
    this.allOff(0, this.releaseSec);
    this.sf?.dispose();
    this.sf = null;
    this.presetGain?.disconnect();
    this.presetGain = null;
  }
}
