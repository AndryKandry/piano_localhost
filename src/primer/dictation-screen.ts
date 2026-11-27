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
 * — статус, ряд позиций ввода (2–5 ячеек по числу нот, без имён нот), фидбек
 * и итог-панель с разбором позиций. Клавиатура пианино
 * снизу — по паттерну клавиатуры карточек/тетради (deps.mapping/pressedPitches
 * снаружи), pressed подсвечивается; подсветки «жми-сейчас» НЕТ — она
 * подсказывала бы ответ (next всегда пуст).
 *
 * Звук — планируемый (инвариант GLOSSARY #2): план planDictationPlayback
 * (0.5 с вступление, нота 0.5 с + пауза 0.5 с) экран планирует через
 * deps.playback.playNote на аудио-часах; педаль и живой ввод не влияют.
 * Повтор («Прослушать ещё раз») — сколько угодно до проверки; при playback с
 * отменой (PIANO-23) прежний план глушится и новый звучит немедленно, без
 * отмены — как раньше: новый план стартует не раньше, чем прозвучит текущий.
 * Уход с диктанта (close) и новый диктант/уровень глушат зависший хвост.
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
  /**
   * Отмена запланированных нот со стартом ≥ fromSec (PIANO-23): хвост
   * предыдущего плана (уход с диктанта, новый диктант, «Прослушать ещё раз»)
   * глушится, репланы не ждут конца текущего плана. Опционален для обратной
   * совместимости: без него экран живёт по-старому — реплан не раньше конца
   * текущего плана, уход оставляет хвост доигрывать.
   */
  cancelScheduled?(fromSec: number): void;
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
  const slotsEl = requireEl<HTMLElement>("primerDictSlots");
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
   * конец фазы «слушай»; без отмены (PIANO-23) ещё и точка отсчёта репланов
   * (новый план не раньше). Очистка — при проверке, закрытии и новом диктанте;
   * ранний ввод план не отменяет: он ещё звучит и репланы (в старом режиме)
   * обязаны ждать его конца.
   */
  let listenUntil: number | null = null;

  // --- Состояние клавиатуры (паттерн клавиатуры карточек, screen.ts) ---
  let kbLayout: KeyboardLayout | null = null;
  let kbLayoutDirty = true;
  let kbStateKey: string | null = null;
  let kbVisible = false;

  const levelButtons = DICTATION_LEVELS.map((value) => {
    const button = gameButton(String(value), () => switchLevel(value), "btn primer-dict-level");
    button.setAttribute("aria-pressed", "false"); // выбранность ведёт syncLevelButtons (DS §3.2)
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
    // Уход в середине прослушивания — запланированный хвост глушится
    // (PIANO-23, SPEC §4.11). Опционально: старый playback молча доиграет его.
    playback.cancelScheduled?.(playback.currentTime());
    listenUntil = null;
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
    buildSlots(); // ряд позиций ввода — под длину нового диктанта (2–5)
    resultEl.hidden = true;
    setFeedback(null);
    // Слушать первый раз — сразу же, без «прослушать» руками.
    playSequence();
    updateStatus();
    updateKeyboard();
  }

  function syncLevelButtons(): void {
    // Выбранный уровень ровно один: .active + aria-pressed (DS §3.2, как
    // ui/controls.ts syncSeg — ревью UI 2026-11-27, P2)
    levelButtons.forEach((button, i) => {
      const active = (DICTATION_LEVELS[i] ?? 0) === level;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  /**
   * Доступность и primary по фазе (ревью UI 2026-11-27, P1): главное действие
   * экрана — «Проверить» на вводе, «Новый диктант» на результате; disabled
   * primary не остаётся. В фазе «слушай» primary нет — действовать ещё рано.
   */
  function syncButtons(): void {
    const phase = judge.currentPhase;
    checkBtn.disabled = phase !== "input";
    listenBtn.disabled = phase === "result";
    checkBtn.classList.toggle("primary", phase === "input");
    newBtn.classList.toggle("primary", phase === "result");
  }

  /**
   * Запланировать проигрывание на аудио-часах (инвариант #2): нота i —
   * base + offsetSec плана. Повтор — сколько угодно до проверки. С отменой
   * (PIANO-23) хвост прошлого плана глушится и новый звучит немедленно;
   * без неё — по-старому: base не раньше конца текущего плана, чтобы реплан
   * не накладывался.
   */
  function playSequence(): void {
    if (!active || sequence === null || judge.currentPhase === "result") return;
    const plan = planDictationPlayback(sequence.notes);
    const now = playback.currentTime();
    let base: number;
    if (playback.cancelScheduled) {
      playback.cancelScheduled(now);
      base = now + DICTATION_LEAD_IN_SEC;
    } else {
      base = Math.max(now, listenUntil ?? 0) + DICTATION_LEAD_IN_SEC;
    }
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
    syncSlots(); // открылся ввод — появилась текущая позиция
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
    syncSlots(); // ряд позиций обновляется мгновенно, по событию ввода (§4)
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
    syncSlots(); // фаза result — маркер текущей позиции снимается
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

  // --- Ряд позиций ввода (ревью UI 2026-11-27, P1) ---

  /**
   * Ячейки позиций (2–5 по числу нот) — рабочая середина экрана: фокус и
   * память о длине последовательности. Имён нот нет — ответ не раскрывается;
   * виден только объём ввода. aria-hidden в разметке: счёт («введено 2/5»)
   * уже озвучивается статусом.
   */
  let slotEls: HTMLElement[] = [];

  function buildSlots(): void {
    const nodes: HTMLElement[] = [];
    for (let i = 0; i < judge.noteCount; i += 1) nodes.push(el("span", "primer-dict-slot", String(i + 1)));
    slotEls = nodes;
    slotsEl.replaceChildren(...nodes);
    slotsEl.hidden = judge.noteCount === 0;
    syncSlots();
  }

  /** Состояния ячеек — мгновенно, по событию (§4): введена / текущая / пустая. */
  function syncSlots(): void {
    const entered = judge.enteredCount;
    for (let i = 0; i < slotEls.length; i += 1) {
      const node = slotEls[i] as HTMLElement;
      node.classList.toggle("filled", i < entered);
      node.classList.toggle("current", judge.currentPhase === "input" && i === entered);
    }
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
