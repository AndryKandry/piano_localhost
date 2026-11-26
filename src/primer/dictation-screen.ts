/**
 * Экран «Музыкального диктанта» (PIANO-17) — режим тренировки слуха ВНУТРИ
 * «Азбуки»: свой контейнер #primerDictation по паттерну #primerNotebook,
 * вход — карточка «Музыкальный диктант» в секции «Слух» списка уроков,
 * выход — кнопка «К списку уроков». main про диктант не знает: питчи приходят
 * тем же мостом PrimerScreen.handlePitch, диктант живёт внутри primer-экрана
 * (флаг primerOpen не дублируется).
 *
 * Диктант (GLOSSARY): Азбука играет последовательность, игрок повторяет
 * нажатиями клавиш, проверка — по заполнении ввода или кнопкой «Проверить».
 * Стана на экране нет — нот видеть нельзя, проверяется слух; середина экрана
 * — статус, фидбек и итог-панель с разбором позиций. Клавиатура пианино
 * снизу — по паттерну клавиатуры карточек/тетради (deps.mapping/pressedPitches
 * снаружи), pressed подсвечивается; подсветки «жми-сейчас» НЕТ — она
 * подсказывала бы ответ (next всегда пуст).
 *
 * Звук — планируемый (инвариант GLOSSARY #2): план planDictationPlayback
 * (0.5 с вступление, нота 0.5 с + пауза 0.5 с) экран планирует через
 * deps.playback.playNote на аудио-часах; педаль и живой ввод не влияют.
 * Повтор («Прослушать ещё раз») — сколько угодно до проверки; репланы не
 * накладываются: новый план стартует не раньше, чем прозвучит текущий.
 * Фаза «слушай» кончается по аудио-часам (updateKeyboard вызывается кадром —
 * в нём и сверка); первое нажатие открывает ввод раньше плана — игрок готов.
 *
 * Машина состояний: listen → input → result (проверка; «Новый диктант»/
 * уровень начинают заново). Лучший % уровня — в прогресс Азбуки под ключом
 * dictation-level-N (тот же PrimerProgressStore, что у уроков и тетради).
 */
import { computeKeyboardLayout, pitchName, pitchNameRuStep, type KeyboardLayout } from "../core/layout";
import { KeyboardRenderer } from "../render/keyboard";
import { el, gameButton, requireEl } from "../ui/dom";
import {
  DICTATION_LEAD_IN_SEC,
  DICTATION_LEVELS,
  DictationSession,
  dictationProgressKey,
  generateDictation,
  planDictationPlayback,
  type DictationCheck,
  type DictationLevel,
  type DictationSequence,
} from "./dictation";
import { PrimerProgressStore } from "./progress";
import { PRIMER_PASS_PERCENT } from "./types";
import { DEFAULT_VELOCITY } from "../core/types";
import type { PrimerKeyboardMapping } from "./screen";

/**
 * Планируемый звук диктанта: main передаёт AudioEngine + аудио-часы (узкий
 * интерфейс вместо целого движка — primer не знает про пресеты и педаль).
 * playNote планирует ноту на аудио-часах, как автоплей.
 */
export interface PrimerPlayback {
  playNote(pitch: number, velocity: number, timeSec: number, durationSec: number): void;
  /** Аудио-часы (GLOSSARY #2) — единственный источник времени диктанта. */
  currentTime(): number;
}

export interface DictationScreenDeps {
  /** Маппинг основной игры: раскладка и подписи клавиатуры диктанта. */
  mapping: PrimerKeyboardMapping;
  /** Зажатые сейчас питчи игровой клавиатуры (main: input.pressedPitches()). */
  pressedPitches(): ReadonlySet<number>;
  /** Прогресс Азбуки (общий инстанс с экраном уроков — бейдж «Слуха»). */
  progress: PrimerProgressStore;
  /** Планируемый звук (engine.playNote + аудио-часы), см. PrimerPlayback. */
  playback: PrimerPlayback;
  /** «К списку уроков»: primer прячет диктант и показывает список. */
  onBack(): void;
}

export interface DictationScreenApi {
  open(): void;
  close(): void;
  isActive(): boolean;
  /** Нажат питч игровой клавиатуры (ввод/проверка — в фазе input). */
  handlePitch(pitch: number): void;
  /** Ежекадровое обновление клавиатуры (main.drawFrame при открытом primer);
   *  заодно сверяет фазу «слушай» с аудио-часами. */
  updateKeyboard(): void;
  /** Маппинг сместился — раскладка клавиатуры устарела. */
  invalidateKeyboardLayout(): void;
  /** Перерисовать экран (окно изменилось) — клавиатура одна канва. */
  redraw(): void;
}

export function initDictationScreen(deps: DictationScreenDeps): DictationScreenApi {
  const { progress, playback } = deps;
  const rootEl = requireEl<HTMLElement>("primerDictation");
  const levelsEl = requireEl<HTMLElement>("primerDictLevels");
  const statusEl = requireEl<HTMLElement>("primerDictStatus");
  const feedbackEl = requireEl<HTMLElement>("primerDictFeedback");
  const resultEl = requireEl<HTMLElement>("primerDictResult");
  const newBtn = requireEl<HTMLButtonElement>("primerDictNew");
  const listenBtn = requireEl<HTMLButtonElement>("primerDictListen");
  const checkBtn = requireEl<HTMLButtonElement>("primerDictCheck");
  const backBtn = requireEl<HTMLButtonElement>("primerDictBack");
  const kbCanvas = requireEl<HTMLCanvasElement>("primerDictKbCanvas");

  const kbRenderer = new KeyboardRenderer(kbCanvas);
  const judge = new DictationSession();

  let active = false;
  let level: DictationLevel = 1;
  let sequence: DictationSequence | null = null;
  /** Итог последней проверки (для статуса и итог-панели; вне result — null). */
  let lastCheck: DictationCheck | null = null;
  /**
   * Аудио-время, когда прозвучит текущий план (null — ничего не запланировано):
   * конец фазы «слушай» и точка отсчёта репланов (новый план не раньше).
   * Очистка — при проверке и новом диктанте; ранний ввод план не отменяет:
   * он ещё звучит и репланы обязаны ждать его конца.
   */
  let listenUntil: number | null = null;

  // --- Состояние клавиатуры (паттерн клавиатуры карточек, screen.ts) ---
  let kbLayout: KeyboardLayout | null = null;
  let kbLayoutDirty = true;
  let kbStateKey: string | null = null;
  let kbVisible = false;

  const levelButtons = DICTATION_LEVELS.map((value) => {
    const button = gameButton(String(value), () => switchLevel(value), "btn primer-dict-level");
    levelsEl.appendChild(button);
    return button;
  });
  newBtn.addEventListener("click", () => startDictation());
  listenBtn.addEventListener("click", () => playSequence());
  checkBtn.addEventListener("click", () => checkDictation());
  backBtn.addEventListener("click", () => deps.onBack());
  // Resize окна ведёт screen.ts (маршрутизирует в redraw() по активному режиму).

  function isActive(): boolean {
    return active;
  }

  // --- Машина состояний: listen → input → result → (новый/уровень) → listen ---

  function open(): void {
    if (active) return;
    active = true;
    rootEl.hidden = false;
    startDictation();
  }

  function close(): void {
    if (!active) return;
    active = false;
    rootEl.hidden = true;
    kbVisible = false;
    kbCanvas.hidden = true;
  }

  function switchLevel(next: DictationLevel): void {
    level = next;
    startDictation();
  }

  function startDictation(): void {
    sequence = generateDictation(level, Math.random);
    judge.start(sequence);
    lastCheck = null;
    listenUntil = null;
    syncLevelButtons();
    syncButtons();
    resultEl.hidden = true;
    setFeedback(null);
    // Слушать первый раз — сразу же, без «прослушать» руками.
    playSequence();
    updateStatus();
    updateKeyboard();
  }

  function syncLevelButtons(): void {
    levelButtons.forEach((button, i) => button.classList.toggle("active", (DICTATION_LEVELS[i] ?? 0) === level));
  }

  /** Доступность кнопок по фазе: проверка — только на вводе, реплики — до проверки. */
  function syncButtons(): void {
    checkBtn.disabled = judge.currentPhase !== "input";
    listenBtn.disabled = judge.currentPhase === "result";
  }

  /**
   * Запланировать проигрывание на аудио-часах (инвариант #2): нота i —
   * base + offsetSec плана. Реплан во время звучания не накладывается:
   * base не раньше конца текущего плана. Повтор — сколько угодно до проверки.
   */
  function playSequence(): void {
    if (!active || sequence === null || judge.currentPhase === "result") return;
    const plan = planDictationPlayback(sequence.notes);
    const base = Math.max(playback.currentTime(), listenUntil ?? 0) + DICTATION_LEAD_IN_SEC;
    for (const entry of plan.entries) {
      playback.playNote(entry.pitch, DEFAULT_VELOCITY, base + entry.offsetSec, entry.durationSec);
    }
    listenUntil = base + plan.totalSec;
    if (judge.currentPhase === "listen") setFeedback("Слушай последовательность, затем повтори её нажатиями клавиш");
    updateStatus();
    syncButtons();
  }

  /** Конец «слушай» по аудио-часам (или первое нажатие — игрок готов). */
  function beginInput(): void {
    if (judge.currentPhase !== "listen") return;
    judge.beginInput();
    setFeedback(null);
    syncButtons();
    updateStatus();
  }

  function handlePitch(pitch: number): void {
    if (!active) return;
    if (judge.currentPhase === "listen") beginInput();
    const outcome = judge.addPitch(pitch);
    if (!outcome.accepted) return; // фаза не ввода или ввод заполнен — игнор
    if (outcome.isFull) {
      checkDictation(); // завершение ввода — автопроверка (SPEC PIANO-17)
      return;
    }
    updateStatus();
    updateKeyboard();
  }

  function checkDictation(): void {
    const check = judge.check();
    if (!check) return;
    lastCheck = check;
    listenUntil = null;
    progress.recordResult({
      lessonId: dictationProgressKey(judge.level),
      percent: check.percent,
      correct: check.correctCount,
      total: check.total,
      bestStreak: check.bestRun,
      passed: check.percent >= PRIMER_PASS_PERCENT,
    });
    showVerdict(check);
    updateStatus();
    syncButtons();
    updateKeyboard(); // фаза result — клавиатура прячется
  }

  /** Вердикт + разбор позиций (GLOSSARY: разбор диктанта). */
  function showVerdict(check: DictationCheck): void {
    const perfect = check.correctCount === check.total;
    setFeedback(perfect ? `Верно ${check.correctCount}/${check.total} — все позиции точные!` : firstMistakeLine(check), perfect ? "ok" : "error");
    const lines = check.positions.map((verdict) => {
      const expected = `${pitchName(verdict.expectedPitch)} (${pitchNameRuStep(verdict.expectedPitch)})`;
      if (verdict.correct) {
        return el("p", "primer-dict-pos ok", `Позиция ${verdict.position + 1}: ${expected} — верно`);
      }
      const played =
        verdict.playedPitch === null
          ? "не сыграно"
          : `ты сыграл ${pitchName(verdict.playedPitch)} (${pitchNameRuStep(verdict.playedPitch)})`;
      return el("p", "primer-dict-pos error", `Позиция ${verdict.position + 1}: ${played} — было ${expected}`);
    });
    resultEl.replaceChildren(el("p", "primer-dict-result-title", perfect ? "Идеальный диктант!" : "Диктант записан"), ...lines);
    resultEl.hidden = false;
  }

  /** Строка первой ошибки — в фидбек (полный разбор в итог-панели). */
  function firstMistakeLine(check: DictationCheck): string {
    const wrong = check.positions.find((verdict) => !verdict.correct);
    if (!wrong) return `Верно ${check.correctCount}/${check.total}`;
    const expected = `${pitchName(wrong.expectedPitch)} (${pitchNameRuStep(wrong.expectedPitch)})`;
    const played =
      wrong.playedPitch === null
        ? "позиция не заполнена"
        : `ты сыграл ${pitchName(wrong.playedPitch)} (${pitchNameRuStep(wrong.playedPitch)})`;
    return `Верно ${check.correctCount}/${check.total}. Позиция ${wrong.position + 1}: ${played} — было ${expected}`;
  }

  // --- Статус и фидбек ---

  function updateStatus(): void {
    const total = judge.noteCount;
    if (total === 0) {
      statusEl.textContent = "";
      return;
    }
    if (judge.currentPhase === "listen") {
      statusEl.textContent = `Ноты: ${total} · слушай…`;
      return;
    }
    if (judge.currentPhase === "input") {
      statusEl.textContent = `Ноты: ${total} · введено ${judge.enteredCount}/${total}`;
      return;
    }
    const best = progress.bestPercent(dictationProgressKey(judge.level));
    statusEl.textContent = lastCheck
      ? `Ноты: ${total} · верно ${lastCheck.correctCount}/${total} (${lastCheck.percent}%) · лучший результат уровня: ${best}%`
      : `Ноты: ${total}`;
  }

  function setFeedback(text: string | null, kind: "ok" | "error" | null = null): void {
    feedbackEl.className = text === null ? "primer-feedback" : `primer-feedback ${kind ?? ""}`;
    feedbackEl.textContent = text ?? "";
  }

  // --- Клавиатура диктанта (паттерн клавиатуры карточек) ---

  function updateKeyboard(): void {
    if (!active) return;
    // Фаза «слушай» кончается по аудио-часам (updateKeyboard — ежекадровый мост).
    if (judge.currentPhase === "listen" && listenUntil !== null && playback.currentTime() >= listenUntil) {
      beginInput();
    }

    const visible = judge.currentPhase !== "result";
    if (visible !== kbVisible) {
      kbVisible = visible;
      kbCanvas.hidden = !visible;
      kbStateKey = null;
    }
    if (!visible) return;

    if (kbRenderer.resize()) {
      kbLayoutDirty = true;
      kbStateKey = null;
    }
    if (kbLayoutDirty || kbLayout === null) {
      const { width, height } = kbRenderer.size;
      kbLayout = computeKeyboardLayout(width, height, deps.mapping.pitches());
      kbLayoutDirty = false;
    }

    // Подсветки «жми-сейчас» нет — проверяется слух (next всегда пуст).
    const pressed = deps.pressedPitches();
    const stateKey = [...pressed].sort().join(",");
    if (stateKey === kbStateKey) return;
    kbStateKey = stateKey;
    kbRenderer.render(kbLayout, {
      pressed,
      labelByPitch: deps.mapping.labels(),
      showNoteNames: true, // учебный контекст азбуки: подписи «C4 (до)»
      next: new Set<number>(),
    });
  }

  function invalidateKeyboardLayout(): void {
    kbLayoutDirty = true;
    kbStateKey = null;
  }

  return { open, close, isActive, handlePitch, updateKeyboard, invalidateKeyboardLayout, redraw: updateKeyboard };
}
