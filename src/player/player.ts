/**
 * Player — машина состояний плеера (SPEC §4.3, §4.4).
 *
 * Позиция песни — ЧИСТАЯ функция аудио-часов (ADR-004 п.2):
 *   songTime = anchorSong + (clock.currentTime() − anchorClock) × множитель
 * Никаких инкрементов — дрейф невозможен по построению. Пауза, wait-mode и
 * смена множителя = пересчёт якоря (anchorSong/anchorClock), формула та же.
 *
 * Wait-mode: время замерло на старте следующей ожидаемой группы (гейта) и
 * трогается с места только правильным нажатием (SPEC §4.3: ошибки не двигают
 * вперёд). Правильное нажатие при этом озвучивается мгновенно обычным
 * noteOn — плеер звуком не занимается, только временем.
 *
 * Партии (SPEC §4.4): ненажимаемая партия — автопартия, планируется
 * Scheduler'ом через engine.playNote. В автоплее автопартия — все ноты.
 *
 * Метроном (SPEC §4.3, PIANO-15): тики по долям (четвертям) темповой карты
 * планируются тем же Scheduler'ом — гейт wait-mode и множитель скорости
 * действуют на них как на автопартию. Включается только в обучении/автоплее
 * с загруженной мелодией: в свободной игре темпа нет, тикать не по чему.
 */
import type { TimeSource } from "../core/clock";
import type { HandPart, Melody, Note } from "../core/types";
import { Judge, type PressVerdict, type ScoreResult } from "./judge";
import { Scheduler, metronomeTicks, type SchedulerHost } from "./scheduler";

/** Узкий интерфейс времени (живёт в core/clock): реэкспорт для потребителей плеера. */
export type { TimeSource };

/** Что плееру нужно от звука: только планируемая нота (ADR-002). */
export interface AudioNoteTarget {
  playNote(pitch: number, velocity: number, timeSec: number, durationSec: number): void;
}

/** Что плееру нужно от метронома: тик на аудио-времени (SPEC §4.3). */
export interface MetronomeTarget {
  /** Тик в секундах аудио-часов; accent — 1-я доля такта (выше тоном). */
  tick(timeSec: number, accent: boolean): void;
}

export type PlayerMode = "free" | "learn" | "autoplay";
export type HandMode = "both" | "right" | "left";

export const MIN_MULTIPLIER = 0.25;
export const MAX_MULTIPLIER = 1.0;
export const MULTIPLIER_STEP = 0.05;

export const PLAYER_MODE_NAMES: Record<PlayerMode, string> = {
  free: "свободная игра",
  learn: "обучение",
  autoplay: "автоплей",
};

export const HAND_MODE_NAMES: Record<HandMode, string> = {
  both: "обе",
  right: "правая рука",
  left: "левая рука",
};

export class Player implements SchedulerHost {
  private readonly judge = new Judge();
  private readonly scheduler: Scheduler;
  private melody: Melody | null = null;
  private sortedNotes: readonly Note[] = [];
  private mode: PlayerMode = "free";
  private handMode: HandMode = "both";
  private waitMode = false;
  /** Метроном вкл/выкл (чекбокс панели, persist SPEC §4.8). Дефолт — выкл. */
  private metronomeOn = false;
  /** Звук тиков (Metronome движка); null — метроном не подключён. */
  private metronome: MetronomeTarget | null;
  private multiplier = 1;
  private running = false;
  private finished = false;
  /** Якорь позиции: songTime = anchorSong + (now − anchorClock) × multiplier. */
  private anchorClock = 0;
  private anchorSong = 0;

  /** Засчитанное нажатие (для вспышки на линии удара). */
  onNoteHit: ((pitch: number) => void) | null = null;
  /** Мелодия пройдена до конца — итоговый счёт (SPEC §3.7). */
  onFinished: ((result: ScoreResult) => void) | null = null;

  constructor(
    private readonly clock: TimeSource,
    engine: AudioNoteTarget,
    metronome: MetronomeTarget | null = null,
  ) {
    this.metronome = metronome;
    this.scheduler = new Scheduler(clock, engine, this);
    this.scheduler.setMetronome(metronome);
    this.scheduler.start();
  }

  dispose(): void {
    this.scheduler.dispose();
  }

  // --- Подготовка ---

  loadMelody(melody: Melody): void {
    this.melody = melody;
    this.sortedNotes = [...melody.notes].sort((a, b) => a.startTimeSec - b.startTimeSec);
    this.resetRun();
  }

  /** Старт с текущей позиции (после loadMelody — с нуля). */
  start(): void {
    if (!this.melody || this.running) return;
    if (this.finished) this.resetRun();
    this.running = true;
    this.anchorClock = this.clock.currentTime();
    this.scheduler.resync(this.anchorSong);
  }

  /** Пауза: время замерло на текущей позиции. */
  pause(): void {
    if (!this.running) return;
    this.anchorSong = this.songTime();
    this.anchorClock = this.clock.currentTime();
    this.running = false;
  }

  /** Стоп: позиция в ноль, счёт сброшен. */
  stop(): void {
    this.resetRun();
  }

  /** Сброс мелодии (например, её запись удалили из библиотеки). */
  unload(): void {
    this.melody = null;
    this.sortedNotes = [];
    this.resetRun();
  }

  private resetRun(): void {
    this.running = false;
    this.finished = false;
    this.anchorSong = 0;
    this.anchorClock = this.clock.currentTime();
    this.rebuildJudgement();
    this.rebuildSchedule();
    this.rebuildMetronome();
  }

  // --- Время (чистые функции, ADR-004 п.2) ---

  /** Позиция песни в секундах мелодии. Чистая функция аудио-часов. */
  songTime(): number {
    if (!this.running) return this.anchorSong;
    const raw = this.anchorSong + (this.clock.currentTime() - this.anchorClock) * this.multiplier;
    const gate = this.currentGate();
    const capped = gate !== null && raw >= gate ? gate : raw; // wait-mode: замерли на гейте
    // Конец мелодии: позиция покоится на длительности (HUD, нотное поле, финиш).
    return this.melody ? Math.min(capped, this.melody.durationSec) : capped;
  }

  /**
   * Аудио-время для музыкального момента — планирование автопартии.
   * null, когда отображение в будущее недостоверно: пауза или нота за гейтом
   * wait-mode (такая нота прозвучит, когда гейт откроется нажатием).
   */
  audioTimeFor(songTime: number): number | null {
    if (!this.running || !this.melody) return null;
    const gate = this.currentGate();
    if (gate !== null && songTime >= gate - 1e-9) return null;
    return this.anchorClock + (songTime - this.anchorSong) / this.multiplier;
  }

  /** Длительность ноты в секундах стены при текущем множителе. */
  wallDurationSec(songDurationSec: number): number {
    return songDurationSec / this.multiplier;
  }

  /** Гейт wait-mode: момент старта следующей ожидаемой группы; null — не активен. */
  private currentGate(): number | null {
    if (!this.running || !this.waitMode || this.mode !== "learn") return null;
    const group = this.judge.nextGroup;
    if (!group) return null;
    // Гейт не может быть позади текущей позиции (защита от переключения на ходу).
    return Math.max(group.timeSec, this.anchorSong);
  }

  // --- Режимы ---

  setMode(mode: PlayerMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.reanchor();
  }

  setHandMode(handMode: HandMode): void {
    if (this.handMode === handMode) return;
    this.handMode = handMode;
    this.reanchor();
  }

  setWaitMode(on: boolean): void {
    if (this.waitMode === on) return;
    this.waitMode = on;
    this.reanchor();
  }

  /** Смена режима на ходу: позиция сохраняется, судья и план перестраиваются. */
  private reanchor(): void {
    if (!this.melody) return;
    this.anchorSong = this.songTime();
    this.anchorClock = this.clock.currentTime();
    this.rebuildJudgement();
    this.rebuildSchedule();
    this.rebuildMetronome();
    this.scheduler.resync(this.anchorSong);
  }

  // --- Метроном (SPEC §4.3, PIANO-15) ---

  /** Подключить/заменить звук метронома (null — отключить); сетка долей та же. */
  setMetronome(target: MetronomeTarget | null): void {
    this.metronome = target;
    this.scheduler.setMetronome(target);
    this.rebuildMetronome();
    this.scheduler.resync(this.anchorSong);
  }

  /**
   * Вкл/выкл метронома (чекбокс «Метроном»). Время и судью не трогает —
   * только план тиков; course пересинхронизируется с текущей позицией.
   */
  setMetronomeOn(on: boolean): void {
    if (this.metronomeOn === on) return;
    this.metronomeOn = on;
    this.rebuildMetronome();
    this.scheduler.resync(this.anchorSong);
  }

  get isMetronomeOn(): boolean {
    return this.metronomeOn;
  }

  /**
   * План тиков: доли (четверти) темповой карты до конца мелодии. Только в
   * обучении/автоплее с мелодией и включённым метрономом; в свободной игре
   * темпа нет — тиков нет. За гейтом wait-mode план не урезается: гейт
   * отсекает планирование в audioTimeFor, тик открывшейся доли звучит при
   * открытии гейта (тот же механизм, что у нот автопартии).
   */
  private rebuildMetronome(): void {
    const usable =
      this.metronomeOn && this.metronome !== null && this.melody !== null && this.mode !== "free";
    this.scheduler.setTicks(
      usable && this.melody ? metronomeTicks(this.melody.tempoMap, this.melody.durationSec) : [],
    );
  }

  /** Нажимаемая ли партия ноты в текущем режиме (SPEC §4.4). */
  isPlayableNote(note: Note): boolean {
    if (this.mode !== "learn") return false;
    if (this.handMode === "both") return true;
    const wanted: HandPart = this.handMode === "right" ? "right" : "left";
    return note.handPart === wanted;
  }

  /** Судья судит только ноты нажимаемой партии, ещё не истёкшие по позиции. */
  private rebuildJudgement(): void {
    const notes = this.sortedNotes
      .filter((n) => this.isPlayableNote(n))
      .filter((n) => n.startTimeSec + this.judge.hitWindowSec >= this.anchorSong - 1e-9);
    this.judge.reset(notes);
  }

  /** Автопартия: ненажимаемое в обучении; всё — в автоплее; ничего — в свободной. */
  private rebuildSchedule(): void {
    const auto =
      this.mode === "autoplay"
        ? this.sortedNotes
        : this.mode === "learn"
          ? this.sortedNotes.filter((n) => !this.isPlayableNote(n))
          : [];
    this.scheduler.setNotes(auto);
  }

  // --- Множитель скорости (SPEC §4.3: 0.25–1.0, не меняет BPM файла) ---

  setMultiplier(value: number): void {
    const clamped = Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, value));
    if (Math.abs(clamped - this.multiplier) < 1e-9) return;
    if (this.running) {
      // Плавная смена: позиция непрерывна, якорь пересчитан (ADR-004 п.2).
      this.anchorSong = this.songTime();
      this.anchorClock = this.clock.currentTime();
    }
    this.multiplier = clamped;
  }

  stepMultiplier(delta: number): void {
    // Округляем к шагу 0.05, чтобы накопление погрешности не уводило множитель.
    const stepped = Math.round((this.multiplier + delta) / MULTIPLIER_STEP) * MULTIPLIER_STEP;
    this.setMultiplier(stepped);
  }

  // --- Окно попадания (SPEC §4.3: ±50–300 мс) ---

  setHitWindowMs(ms: number): void {
    this.judge.setHitWindowSec(ms / 1000);
  }

  // --- Ввод ---

  /**
   * Нажатие клавиши (звук уже озвучен движком — плеер только судит и двигает
   * время). Возвращает вердикт для HUD/эффектов; null — не про судью.
   */
  onKeyPress(pitch: number): PressVerdict | null {
    if (this.mode !== "learn" || !this.running) return null;
    // Позиция ДО судейства: судья, засчитав группу, уже сдвигает следующий
    // гейт — якориться надо на замерзшей позиции нажатого гейта, не следующего.
    const frozenAt = this.songTime();
    const verdict = this.judge.onPress(pitch, frozenAt);
    if (verdict.kind === "hit") {
      this.onNoteHit?.(pitch);
      if (this.waitMode && verdict.group?.hit) this.openGate(frozenAt);
    }
    return verdict;
  }

  /** Гейт покрыт: время трогается с замерзшей позиции нажатого гейта. */
  private openGate(frozenAt: number): void {
    this.anchorSong = frozenAt;
    this.anchorClock = this.clock.currentTime();
  }

  /** Ход времени: вызывается каждый кадр (истечение окон, финиш). */
  update(): void {
    if (!this.running || !this.melody || this.finished) return;
    const t = this.songTime();
    this.judge.update(t);
    if (t >= this.melody.durationSec) {
      this.finished = true;
      this.onFinished?.(this.score());
    }
  }

  // --- Состояние для рендера ---

  score(): ScoreResult {
    return this.judge.result;
  }

  /** Питчи ожидаемой группы — подсветка «жми-сейчас» в wait-mode (инвариант #5). */
  expectedPitches(): ReadonlySet<number> {
    if (this.mode !== "learn" || !this.running) return new Set<number>();
    return this.judge.expectedPitches();
  }

  /** Питчи несыгранных нот нажимаемой партии — подсветка вне wait-mode. */
  pendingPlayablePitches(): ReadonlySet<number> {
    if (this.mode !== "learn" || !this.running) return new Set<number>();
    return this.judge.pendingPlayablePitches();
  }

  get currentMode(): PlayerMode {
    return this.mode;
  }

  get handPartyMode(): HandMode {
    return this.handMode;
  }

  get isWaitMode(): boolean {
    return this.waitMode;
  }

  get speedMultiplier(): number {
    return this.multiplier;
  }

  get currentMelody(): Melody | null {
    return this.melody;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  get hitWindowSec(): number {
    return this.judge.hitWindowSec;
  }
}
