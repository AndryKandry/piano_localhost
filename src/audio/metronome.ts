/**
 * Метроном (SPEC §4.3): синт-тик без сэмплов — осциллятор с мгновенной атакой
 * и экспоненциальным затуханием ~20 мс. Первая доля такта — выше (2000 Гц),
 * остальные — 800 Гц. Планирование на аудио-часах (ADR-002, инвариант
 * GLOSSARY #2): тик, назначенный на будущее аудио-время, звучит точно в него
 * независимо от дрожания JS-таймера.
 *
 * Собственный gain-узел перед мастером движка: уровень тиков фиксирован
 * (0.5), «Громкость» настроек (SPEC §4.8) действует на них как на весь звук.
 * Реализует MetronomeTarget из плеера структурно (как AudioEngine —
 * AudioNoteTarget): аудиослой не зависит от плеера.
 */

/** Уровень тиков до мастера (задача PIANO-15: ~0.5 — метроном не глушит ноты). */
const METRONOME_LEVEL = 0.5;
/** Пик огибающей одного тика до gain-узла. */
const TICK_PEAK = 0.8;
/** Частота акцентного тика — 1-я доля такта (Гц). */
const ACCENT_HZ = 2000;
/** Частота обычного тика (Гц). */
const BEAT_HZ = 800;
/** Длительность клика: экспоненциальное затухание до тишины, сек. */
const TICK_FADE_SEC = 0.02;
/** Хвост после рампы: на нуле огибающей осциллятор глушится, сек. */
const TICK_TAIL_SEC = 0.01;
/** Технический ноль для exponentialRamp (ноль запрещён). */
const SILENCE = 0.0001;

export class Metronome {
  private readonly ctx: AudioContext;
  /** Уровень тиков; подключён к мастер-гейну движка. */
  private readonly gain: GainNode;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = METRONOME_LEVEL;
    this.gain.connect(destination);
  }

  /**
   * Тик на аудио-времени timeSec (MetronomeTarget). Прошедшие доли звучат
   * немедленно (тик гейта wait-mode при открытии); будущее — точно в срок.
   */
  tick(timeSec: number, accent: boolean): void {
    const at = Math.max(timeSec, this.ctx.currentTime);
    const osc = this.ctx.createOscillator();
    osc.type = "square"; // богатый гармониками клик, слышимый на колонках ноутбука
    osc.frequency.value = accent ? ACCENT_HZ : BEAT_HZ;
    const env = this.ctx.createGain();
    const g = env.gain;
    g.setValueAtTime(TICK_PEAK, at); // мгновенная атака — «щелчок»
    g.exponentialRampToValueAtTime(SILENCE, at + TICK_FADE_SEC);
    osc.connect(env);
    env.connect(this.gain);
    osc.start(at);
    osc.stop(at + TICK_FADE_SEC + TICK_TAIL_SEC);
    // Узлы тика одноразовые: после остановки отсоединяем, граф не копится.
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };
  }

  dispose(): void {
    this.gain.disconnect();
  }
}
