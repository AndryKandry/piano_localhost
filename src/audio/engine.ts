/**
 * Звуковой движок: реестр активных голосов, педаль Space (hold-буфер,
 * GLOSSARY), переключение пресетов, all-notes-off на window.blur (research 03).
 *
 * Живой ввод (клавиатура) идёт через noteOn/noteOff — педаль учитывается.
 * Автоплей и автопартия (очередь плеера) играют через playNote с длительностью:
 * точное планирование на аудио-часах, педаль не учитывается.
 */
import type { AudioClock } from "../core/clock";
import type { LoadState, PresetId } from "../core/types";
import { DEFAULT_VELOCITY } from "../core/types";
import type { InstrumentSource } from "./source";
import { SamplerSource } from "./sampler";
import { SFONT_PRESETS, SoundFontSource } from "./sfont";
import { SynthSource } from "./synth";
import type { SynthPresetId } from "./synth";

/** Гейт-рампа обычного отпускания, сек (research 01: 0.3–0.6). */
const RELEASE_FADE_SEC = 0.35;
/** Короткое глушение при репиче той же ноты, сек (research 01 п.5). */
const RETRIGGER_FADE_SEC = 0.09;
/** Минимальная длительность запланированной ноты, сек. */
const MIN_NOTE_SEC = 0.05;

export type LoadStateListener = (presetId: PresetId, state: LoadState, progress: number | null) => void;

const SYNTH_PRESET_IDS: ReadonlyArray<SynthPresetId> = ["organ", "synthLead", "bass"];

export class AudioEngine {
  private readonly clock: AudioClock;
  /** Мастер-громкость: все источники звучат через него (настройка SPEC §4.8). */
  private readonly master: GainNode;
  private readonly sources = new Map<PresetId, InstrumentSource>();
  /** Живые голоса: питч → источник, который его звучит. */
  private readonly active = new Map<number, InstrumentSource>();
  /** Hold-буфер педали: ноты, отпущенные при зажатой педали. */
  private readonly pedalBuffer = new Map<number, InstrumentSource>();
  private current: PresetId;
  private pedalDown = false;

  /** Индикация загрузки сэмплов (HUD). */
  onLoadState: LoadStateListener | null = null;

  constructor(clock: AudioClock, defaultPreset: PresetId = "piano") {
    this.clock = clock;
    this.current = defaultPreset;
    const ctx = clock.context();
    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(ctx.destination);
    // Спека 4.2: уход со вкладки — тишина (keyup не придёт).
    window.addEventListener("blur", () => this.allNotesOff());
  }

  get preset(): PresetId {
    return this.current;
  }

  get pedalActive(): boolean {
    return this.pedalDown;
  }

  /** Громкость мастера 0–1 (настройка «Громкость»); плавный рамп без щелчка. */
  setVolume(volume: number): void {
    const clamped = Math.min(1, Math.max(0, volume));
    const now = this.clock.currentTime();
    const param = this.master.gain;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(clamped, now, 0.015);
  }

  /**
   * Смена пресета (тембра) на ходу. Зажатые голоса принадлежат старому
   * пресету — глушим их; новые ноты пойдут через новый источник.
   */
  setPreset(id: PresetId): void {
    if (id === this.current && this.sources.has(id)) return;
    this.allNotesOff();
    this.current = id;
    this.ensureSource(id);
  }

  /** Нота нажата. velocity — MIDI 1–127 (по умолчанию — живой ввод). */
  noteOn(pitch: number, velocity: number = DEFAULT_VELOCITY): void {
    if (this.clock.state !== "running") void this.clock.resume();
    const src = this.ensureSource(this.current);
    // Репич: старый голос питча глушим коротко (research 01 п.5).
    const old = this.active.get(pitch) ?? this.pedalBuffer.get(pitch);
    if (old) {
      old.noteOff(pitch, this.clock.currentTime(), RETRIGGER_FADE_SEC);
      this.pedalBuffer.delete(pitch);
    }
    this.active.set(pitch, src);
    src.noteOn(pitch, velocity, this.clock.currentTime());
  }

  /** Нота отпущена: при зажатой педали — в hold-буфер, иначе гейт-рампа. */
  noteOff(pitch: number): void {
    const src = this.active.get(pitch);
    if (!src) return;
    this.active.delete(pitch);
    if (this.pedalDown) {
      this.pedalBuffer.set(pitch, src);
    } else {
      src.noteOff(pitch, this.clock.currentTime(), RELEASE_FADE_SEC);
    }
  }

  /** Педаль Space: отпускание — release всем hold-нотам (research 01 п.5). */
  setPedal(down: boolean): void {
    if (this.pedalDown === down) return;
    this.pedalDown = down;
    if (!down) {
      const t = this.clock.currentTime();
      for (const [pitch, src] of this.pedalBuffer) src.noteOff(pitch, t, RELEASE_FADE_SEC);
      this.pedalBuffer.clear();
    }
  }

  /**
   * Запланированная нота с длительностью — для автоплея/автопартии (очередь
   * плеера). Планируется на аудио-часах, педаль не учитывается.
   */
  playNote(pitch: number, velocity: number, timeSec: number, durationSec: number): void {
    const src = this.ensureSource(this.current);
    src.noteOn(pitch, velocity, timeSec);
    src.noteOff(pitch, timeSec + Math.max(durationSec, MIN_NOTE_SEC), RELEASE_FADE_SEC);
  }

  /** Тишина: всё активное и педальное гасится (window.blur, смена пресета). */
  allNotesOff(): void {
    const t = this.clock.currentTime();
    for (const [pitch, src] of this.active) src.noteOff(pitch, t, RELEASE_FADE_SEC);
    for (const [pitch, src] of this.pedalBuffer) src.noteOff(pitch, t, RELEASE_FADE_SEC);
    this.active.clear();
    this.pedalBuffer.clear();
    this.pedalDown = false;
  }

  /** Ленивое создание источника пресета (сэмплы фортепиано — при первом использовании). */
  private ensureSource(id: PresetId): InstrumentSource {
    let src = this.sources.get(id);
    if (!src) {
      src = this.createSource(id);
      this.sources.set(id, src);
    }
    return src;
  }

  private createSource(id: PresetId): InstrumentSource {
    if (id === "piano") {
      return new SamplerSource(
        this.clock.context(),
        (state, progress) => this.onLoadState?.(id, state, progress),
        this.master,
      );
    }
    const sfSpec = SFONT_PRESETS[id];
    if (sfSpec) {
      return new SoundFontSource(
        id,
        sfSpec,
        this.clock.context(),
        (state, progress) => this.onLoadState?.(id, state, progress),
        this.master,
      );
    }
    if (SYNTH_PRESET_IDS.includes(id as SynthPresetId)) {
      return new SynthSource(id as SynthPresetId, this.clock.context(), this.master);
    }
    throw new Error(`Неизвестный пресет: ${id}`);
  }
}
