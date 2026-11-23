/**
 * Синтезаторные пресеты — свои осцилляторные голоса на голом Web Audio
 * (ADR-002 п.5): Орган (несколько синусов-гармоник), Синт-лид (saw + lowpass
 * + ADSR), Бас (квадрат + lowpass, октава ниже).
 */
import type { PresetId } from "../core/types";
import type { InstrumentSource } from "./source";

type SynthPresetId = Exclude<PresetId, "piano">;

interface SynthPresetSpec {
  /** Партиалы: множитель частоты, относительная амплитуда, форма волны. */
  partials: ReadonlyArray<{ ratio: number; gain: number; type: OscillatorType }>;
  /** Частота среза lowpass (Гц) и добротность. */
  cutoffHz: number;
  q: number;
  /** Сдвиг в полутонах (Бас — октава ниже). */
  transpose: number;
  /** ADSR по гейну. */
  attackSec: number;
  decaySec: number;
  sustainLevel: number;
  releaseSec: number;
  /** Общий уровень пресета, чтобы не клиповать на полифонии. */
  level: number;
}

const SYNTH_PRESETS: Record<SynthPresetId, SynthPresetSpec> = {
  organ: {
    partials: [
      { ratio: 1, gain: 0.5, type: "sine" },
      { ratio: 2, gain: 0.3, type: "sine" },
      { ratio: 3, gain: 0.16, type: "sine" },
      { ratio: 4, gain: 0.1, type: "sine" },
      { ratio: 6, gain: 0.06, type: "sine" },
      { ratio: 8, gain: 0.04, type: "sine" },
    ],
    cutoffHz: 6000,
    q: 0.7,
    transpose: 0,
    attackSec: 0.012,
    decaySec: 0.03,
    sustainLevel: 1.0,
    releaseSec: 0.1,
    level: 0.5,
  },
  synthLead: {
    partials: [{ ratio: 1, gain: 1, type: "sawtooth" }],
    cutoffHz: 2200,
    q: 1.1,
    transpose: 0,
    attackSec: 0.02,
    decaySec: 0.18,
    sustainLevel: 0.6,
    releaseSec: 0.22,
    level: 0.42,
  },
  bass: {
    partials: [{ ratio: 1, gain: 1, type: "square" }],
    cutoffHz: 700,
    q: 1.2,
    transpose: -12,
    attackSec: 0.008,
    decaySec: 0.15,
    sustainLevel: 0.7,
    releaseSec: 0.16,
    level: 0.6,
  },
};

function midiToFreq(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

const SILENCE = 0.0001;

/** Один голос: осцилляторы → фильтр → гейт-gain → выход. */
class SynthVoice {
  private readonly oscs: OscillatorNode[] = [];
  private readonly gain: GainNode;
  private readonly sustainGain: number;
  private released = false;

  constructor(ctx: AudioContext, destination: AudioNode, spec: SynthPresetSpec, pitch: number, velocity: number, timeSec: number) {
    const freq = midiToFreq(pitch + spec.transpose);
    // Перцептуальная кривая velocity; тихие ноты не исчезают совсем.
    const v = 0.2 + 0.8 * Math.pow(Math.min(1, Math.max(0, velocity / 127)), 1.4);
    const peak = spec.level * v;
    this.sustainGain = spec.level * spec.sustainLevel * v;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = spec.cutoffHz;
    filter.Q.value = spec.q;

    this.gain = ctx.createGain();
    filter.connect(this.gain);
    this.gain.connect(destination);

    const g = this.gain.gain;
    g.setValueAtTime(SILENCE, timeSec);
    g.exponentialRampToValueAtTime(Math.max(peak, SILENCE * 2), timeSec + spec.attackSec);
    g.exponentialRampToValueAtTime(Math.max(this.sustainGain, SILENCE * 2), timeSec + spec.attackSec + spec.decaySec);

    for (const partial of spec.partials) {
      const osc = ctx.createOscillator();
      osc.type = partial.type;
      osc.frequency.value = freq * partial.ratio;
      const partialGain = ctx.createGain();
      partialGain.gain.value = partial.gain;
      osc.connect(partialGain);
      partialGain.connect(filter);
      osc.start(timeSec);
      this.oscs.push(osc);
    }
  }

  /** Гейт-рампа вниз с текущего значения, затем остановка осцилляторов. */
  release(timeSec: number, fadeSec: number): void {
    if (this.released) return;
    this.released = true;
    const tau = Math.max(0.015, fadeSec / 3);
    // Читаем значение ДО cancel — cancelScheduledValues на незавершённом
    // рампе может откатить значение к якорю рампы.
    const current = Math.max(this.gain.gain.value, SILENCE * 2);
    const g = this.gain.gain;
    g.cancelScheduledValues(timeSec);
    g.setValueAtTime(current, timeSec);
    g.setTargetAtTime(SILENCE, timeSec, tau);
    const stopAt = timeSec + fadeSec + tau * 4;
    for (const osc of this.oscs) {
      try {
        osc.stop(stopAt);
      } catch {
        // Осциллятор уже остановлен — не проблема.
      }
    }
  }
}

/** Синтезаторный пресет: реестр голосов по питчу (стек — репичи). */
export class SynthSource implements InstrumentSource {
  readonly presetId: PresetId;
  private readonly spec: SynthPresetSpec;
  private readonly voices = new Map<number, SynthVoice[]>();

  constructor(
    presetId: SynthPresetId,
    private readonly ctx: AudioContext,
    /** Выход голосов — мастер-гейн движка (громкость SPEC §4.8). */
    private readonly destination: AudioNode,
  ) {
    this.presetId = presetId;
    this.spec = SYNTH_PRESETS[presetId];
  }

  noteOn(pitch: number, velocity: number, timeSec: number): void {
    const voice = new SynthVoice(this.ctx, this.destination, this.spec, pitch, velocity, timeSec);
    const stack = this.voices.get(pitch) ?? [];
    stack.push(voice);
    this.voices.set(pitch, stack);
  }

  noteOff(pitch: number, timeSec: number, _fadeSec: number): void {
    // Синтезаторные пресеты гасят голос собственной ADSR-высвой release.
    const stack = this.voices.get(pitch);
    const voice = stack?.pop();
    if (!voice || !stack) return;
    voice.release(timeSec, this.spec.releaseSec);
    if (stack.length === 0) this.voices.delete(pitch);
  }

  allOff(timeSec: number, _fadeSec: number): void {
    for (const stack of this.voices.values()) {
      for (const voice of stack) voice.release(timeSec, this.spec.releaseSec);
    }
    this.voices.clear();
  }

  dispose(): void {
    this.allOff(this.ctx.currentTime, this.spec.releaseSec);
  }
}
