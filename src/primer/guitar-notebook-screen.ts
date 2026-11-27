/**
 * Экран «Гитарной тетради» (PIANO-20, SPEC §4.13) — режим практики ВНУТРИ
 * «Азбуки» по паттерну нотной тетради (#primerNotebook): свой контейнер
 * #primerGuitarNotebook, вход — карточка «Гитарная тетрадь» в секции
 * «Гитара» списка уроков, выход — «К списку уроков». main про тетрадь не
 * знает: питчи приходят тем же мостом PrimerScreen.handlePitch, тетрадь
 * живёт внутри primer-экрана (флаг primerOpen не дублируется).
 *
 * Тетрадь (GLOSSARY: нотная тетрадь, чтение с листа): те же 8 тактов 4/4 на
 * ДВУХ строках стана по 4 такта, текущая — accent-подсветка + маркер позиции
 * над станом, сыгранные — чернила, будущие — dim (alpha 0.4), промахи — точки
 * --error под нотой. Позиция стоит до верного нажатия (wait-семантика).
 * Отличие от нотной тетради — ДИАПАЗОН: записанные высоты I позиции гитары
 * E3–G♯5 (research 06 §4), низкие ноты уходят на добавочные линейки ПОД
 * станом — вертикальная раскладка системы даёт на них запас (≈10 межлинейных
 * под нижней линией против 2.5 у тетради).
 *
 * Подсказка — выбор игрока, сегмент «Клавиатура | Гриф | Нет» (persist
 * settings.guitarNotebookHint, дефолт «Клавиатура»; SPEC §4.13):
 * - «Клавиатура» — как в тетради: подсветка «жми-сейчас» на текущей ноте;
 * - «Гриф» — диаграмма FretboardRenderer под станом с кружком «струна.лад»
 *   ТЕКУЩЕЙ ноты (writtenToGuitar; research 06 §3: вторая проекция квиза —
 *   ввода не принимает, ничего не судит);
 * - «Нет» — чистое чтение: обе подсказки выключены, стан-подсветка остаётся
 *   (это задание чтения). Клавиатура роя видна во всех режимах — на ней
 *   видны нажатия игрока; «жми-сейчас» рисуется только в режиме «Клавиатура».
 *
 * Звук — только от нажатий игровой клавиатуры (main: engine.noteOn по
 * ЗАПИСАННОЙ высоте — тренировка чтения записи, research 06 §1); отдельного
 * звука тетради и автопрослушки нет (SPEC §4.13).
 *
 * Итог сессии — как в тетради: % «верно с первой», стрик; лучший результат
 * уровня — в прогресс Азбуки под ключом guitar-notebook-level-N (тот же
 * PrimerProgressStore); бейдж лучшего % — в секции «Гитара» списка.
 */
import {
  THIN_BARLINE_THICKNESS_SPACES,
  layoutMeasure,
  pitchToY,
} from "../notation/geometry";
import { ensureBravura, NotationRenderer, type GlyphDrawOptions } from "../notation/index";
import { writtenToGuitar } from "../core/fretboard";
import { computeKeyboardLayout, type KeyboardLayout } from "../core/layout";
import { KeyboardRenderer } from "../render/keyboard";
import { FretboardRenderer } from "../render/fretboard";
import { el, gameButton, requireEl } from "../ui/dom";
import { GUITAR_HINT_MODES, type GuitarHintMode, type SettingsStore } from "../core/settings";
import {
  GUITAR_NOTEBOOK_LEVELS,
  generateGuitarNotebook,
  guitarNotebookProgressKey,
  type GuitarNotebookLevel,
} from "./guitar-notebook";
import { NotebookJudge, type NotebookSheet } from "./notebook";
import { PrimerProgressStore } from "./progress";
import { PRIMER_PASS_PERCENT } from "./types";
import type { PrimerKeyboardMapping } from "./screen";

export interface GuitarNotebookScreenDeps {
  /** Маппинг основной игры: раскладка и подписи клавиатуры тетради. */
  mapping: PrimerKeyboardMapping;
  /** Зажатые сейчас питчи игровой клавиатуры (main: input.pressedPitches()). */
  pressedPitches(): ReadonlySet<number>;
  /** Прогресс Азбуки (общий инстанс с экраном уроков — бейдж секции «Гитара»). */
  progress: PrimerProgressStore;
  /** Настройки: подсказка «Клавиатура | Гриф | Нет» (guitarNotebookHint). */
  settings: SettingsStore;
  /** «К списку уроков»: primer прячет тетрадь и показывает список. */
  onBack(): void;
}

export interface GuitarNotebookScreenApi {
  open(): Promise<void>;
  close(): void;
  isActive(): boolean;
  /** Нажат питч игровой клавиатуры (судится в фазе playing). */
  handlePitch(pitch: number): void;
  /** Ежекадровое обновление клавиатуры (main.drawFrame при открытом primer). */
  updateKeyboard(): void;
  /** Маппинг сместился — раскладка клавиатуры устарела. */
  invalidateKeyboardLayout(): void;
  /** Перерисовать тетрадь (окно изменилось, видимость канвасов сменилась). */
  redraw(): void;
}

/** Фаза тетради: чтение → итог. Выбор уровня/подсказки (config) — сегменты топбара. */
type GuitarNotebookPhase = "playing" | "finished";

/** Позиция нарисованной ноты: x центра головки + верхняя линия её строки. */
interface NotePosition {
  x: number;
  topY: number;
}

/**
 * Вертикаль системы в межлинейных ( research 06 §4: диапазон I позиции E3–G♯5):
 * над верхней линией 2.5 (маркер позиции + G♯5 на 0.5 над линией), стан 4,
 * под нижней 10 (E3 — головка на 7.5 под ВЕРХНЕЙ линией + добавочные до 8 +
 * точки промахов на 9.6). Две системы + зазор 2 → 35 межлинейных.
 */
const ABOVE_SPACES = 2.5;
const BELOW_SPACES = 10;
const SYSTEM_SPACES = ABOVE_SPACES + 4 + BELOW_SPACES;
const SYSTEM_GAP_SPACES = 2;
const TOTAL_SPACES = SYSTEM_SPACES * 2 + SYSTEM_GAP_SPACES;

export function initGuitarNotebookScreen(deps: GuitarNotebookScreenDeps): GuitarNotebookScreenApi {
  const { progress, settings } = deps;
  const rootEl = requireEl<HTMLElement>("primerGuitarNotebook");
  const canvas = requireEl<HTMLCanvasElement>("primerGnbCanvas");
  const gfCanvas = requireEl<HTMLCanvasElement>("primerGnbGfCanvas");
  const kbCanvas = requireEl<HTMLCanvasElement>("primerGnbKbCanvas");
  const levelsEl = requireEl<HTMLElement>("primerGnbLevels");
  const hintsEl = requireEl<HTMLElement>("primerGnbHints");
  const statusEl = requireEl<HTMLElement>("primerGnbStatus");
  const feedbackEl = requireEl<HTMLElement>("primerGnbFeedback");
  const resultEl = requireEl<HTMLElement>("primerGnbResult");
  const newBtn = requireEl<HTMLButtonElement>("primerGnbNew");
  const backBtn = requireEl<HTMLButtonElement>("primerGnbBack");

  const renderer = new NotationRenderer(canvas);
  const gfRenderer = new FretboardRenderer(gfCanvas);
  const kbRenderer = new KeyboardRenderer(kbCanvas);
  const judge = new NotebookJudge(); // тот же судья, что у нотной тетради (SPEC §4.13)

  let active = false;
  let phase: GuitarNotebookPhase = "playing";
  let level: GuitarNotebookLevel = 1;
  let sheet: NotebookSheet | null = null;
  /** x/y каждой ноты последней отрисовки — маркер позиции и отметки промахов. */
  let positions: NotePosition[] = [];

  // --- Состояние клавиатуры (паттерн клавиатуры карточек/тетради) ---
  let kbLayout: KeyboardLayout | null = null;
  let kbLayoutDirty = true;
  let kbStateKey: string | null = null;
  let kbVisible = false;
  /** Видимость диаграммы грифа (подсказка «Гриф») — тот же паттерн кэша. */
  let gfVisible = false;

  const levelButtons = GUITAR_NOTEBOOK_LEVELS.map((value) => {
    const button = gameButton(String(value), () => switchLevel(value), "btn primer-gnb-level");
    button.setAttribute("aria-pressed", "false"); // выбранность ведёт syncLevelButtons (DS §3.2)
    levelsEl.appendChild(button);
    return button;
  });
  const HINT_LABELS: Readonly<Record<GuitarHintMode, string>> = {
    keyboard: "Клавиатура",
    fretboard: "Гриф",
    none: "Нет",
  };
  const hintButtons = GUITAR_HINT_MODES.map((mode) => {
    const button = gameButton(HINT_LABELS[mode], () => switchHint(mode), "btn primer-gnb-hint");
    button.setAttribute("aria-pressed", "false"); // выбранность ведёт syncHintButtons (DS §3.2)
    hintsEl.appendChild(button);
    return button;
  });
  newBtn.addEventListener("click", () => startSheet());
  backBtn.addEventListener("click", () => deps.onBack());
  // Resize окна ведёт screen.ts (маршрутизирует в redraw() по активному режиму).

  function isActive(): boolean {
    return active;
  }

  // --- Машина состояний: playing → finished → (уровень/новая) → playing ---

  async function open(): Promise<void> {
    if (active) return;
    active = true;
    rootEl.hidden = false;
    // Список Азбуки уже дождался шрифта; повторный вызов — то же обещание.
    await ensureBravura().catch(() => undefined);
    if (!active) return;
    startSheet();
  }

  function close(): void {
    if (!active) return;
    active = false;
    rootEl.hidden = true;
    kbVisible = false;
    kbCanvas.hidden = true;
    gfVisible = false;
    gfCanvas.hidden = true;
  }

  function switchLevel(next: GuitarNotebookLevel): void {
    level = next;
    startSheet();
  }

  /**
   * Смена подсказки «Клавиатура | Гриф | Нет» (SPEC §4.13): persist в
   * настройках; клавиатура перерисовывается без/с «жми-сейчас», диаграмма
   * грифа появляется/прячется (высота стана зависит от канвасов — flex).
   */
  function switchHint(mode: GuitarHintMode): void {
    if (settings.get().guitarNotebookHint === mode) return;
    settings.update({ guitarNotebookHint: mode });
    syncHintButtons();
    kbStateKey = null; // форсируем перерисовку клавиатуры без/с подсказкой
    drawSheet();
    updateFretboard();
    updateKeyboard();
  }

  function syncHintButtons(): void {
    // Выбранная подсказка ровно одна: .active + aria-pressed (DS §3.2, как
    // ui/controls.ts syncSeg — ревью UI 2026-11-27, P2)
    const mode = settings.get().guitarNotebookHint;
    hintButtons.forEach((button, i) => {
      const active = GUITAR_HINT_MODES[i] === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function startSheet(): void {
    sheet = generateGuitarNotebook(level, Math.random);
    judge.start(sheet);
    phase = "playing";
    syncLevelButtons();
    syncHintButtons();
    syncPrimary();
    resultEl.hidden = true;
    setFeedback(null);
    drawSheet();
    updateStatus();
    updateFretboard();
    updateKeyboard();
  }

  function syncLevelButtons(): void {
    // Выбранный уровень ровно один: .active + aria-pressed (DS §3.2, как
    // ui/controls.ts syncSeg — ревью UI 2026-11-27, P2)
    levelButtons.forEach((button, i) => {
      const active = (GUITAR_NOTEBOOK_LEVELS[i] ?? 0) === level;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function handlePitch(pitch: number): void {
    if (!active || phase !== "playing") return;
    const outcome = judge.handlePitch(pitch);
    if (!outcome) return;
    if (!outcome.correct) {
      // Отметка промаха на ноте, позиция не двигается (wait-семантика).
      setFeedback("Мимо — это другая клавиша. Смотри на подсвеченную ноту", "error");
      drawSheet();
      updateStatus();
      updateFretboard();
      updateKeyboard();
      return;
    }
    setFeedback(null);
    if (outcome.complete) {
      finishSheet();
      return;
    }
    drawSheet();
    updateStatus();
    updateFretboard();
    updateKeyboard();
  }

  function finishSheet(): void {
    const result = judge.result();
    phase = "finished";
    syncPrimary(); // на результате primary — «Новая тетрадь» (ревью UI 2026-11-27, P1)
    if (!result) return;
    const key = guitarNotebookProgressKey(result.level);
    const best = Math.max(progress.bestPercent(key), result.firstTryPercent);
    progress.recordResult({
      lessonId: key,
      percent: result.firstTryPercent,
      correct: result.firstTryCount,
      total: result.total,
      bestStreak: result.bestStreak,
      passed: result.firstTryPercent >= PRIMER_PASS_PERCENT,
    });
    drawSheet();
    updateStatus();
    setFeedback(null);
    resultEl.replaceChildren(
      el("p", "primer-gnb-result-title", "Гитарная тетрадь дочитана!"),
      el(
        "p",
        "primer-gnb-result-line",
        `Верно с первой: ${result.firstTryPercent}% · стрик ${result.bestStreak} · лучший результат уровня: ${best}%`,
      ),
    );
    resultEl.hidden = false;
    updateFretboard(); // фаза finished — диаграмма прячется
    updateKeyboard(); // фаза finished — клавиатура прячется, стан выше
  }

  // --- Статус и фидбек ---

  /**
   * Primary топбара по фазе (ревью UI 2026-11-27, P1): на результате главное
   * действие — «Новая тетрадь»; во время чтения primary нет (ответ — клавиша
   * роя, не кнопка). Primary на экране одна (DS §3.1).
   */
  function syncPrimary(): void {
    newBtn.classList.toggle("primary", phase === "finished");
  }

  function updateStatus(): void {
    const total = judge.totalCount;
    if (total === 0) {
      statusEl.textContent = "";
      return;
    }
    if (phase === "finished") {
      const result = judge.result();
      statusEl.textContent = result
        ? `Нот: ${total} · верно с первой: ${result.firstTryCount}/${total} · лучший результат уровня: ${progress.bestPercent(guitarNotebookProgressKey(result.level))}%`
        : "";
      return;
    }
    const done = judge.currentIndex;
    const percent = done > 0 ? Math.round((judge.firstTrySoFar / done) * 100) : 0;
    const miss = judge.attemptsCurrent;
    statusEl.textContent = `Нота ${done + 1}/${total} · верно с первой: ${percent}% · стрик ${judge.currentStreak}${
      miss > 0 ? ` · промахи: ${miss}` : ""
    }`;
  }

  function setFeedback(text: string | null, kind: "error" | null = null): void {
    feedbackEl.className = text === null ? "primer-feedback" : `primer-feedback ${kind ?? ""}`;
    feedbackEl.textContent = text ?? "";
  }

  // --- Рисование тетради: две строки стана по 4 такта ---

  function drawSheet(): void {
    if (!sheet) return;
    renderer.resize();
    const { width, height } = renderer.size;
    // Вертикаль: две системы (стан 4ss + 2.5ss над + 10ss под — E3 с тремя
    // добавочными и точки промахов) + зазор; межлинейное ужмётся до 9.
    const ss = Math.max(9, Math.min(18, Math.round(height / TOTAL_SPACES)));
    const systemH = Math.round(ss * SYSTEM_SPACES);
    const gap = Math.round(ss * SYSTEM_GAP_SPACES);
    const headroom = Math.round(ss * ABOVE_SPACES);
    const top1 = Math.max(0, Math.round((height - (systemH * 2 + gap)) / 2)) + headroom;
    const top2 = top1 + systemH + gap;
    renderer.setStaffGeometry(top1, ss);
    renderer.clear();

    const margin = Math.round(ss * 1.2);
    const left = margin + ss * 2.8; // место под ключ
    const usable = width - margin - left;
    if (usable <= ss * 8) {
      positions = [];
      return;
    }

    // Стан: две системы с ключом (drawStaff рисует 5 линий + скрипичный ключ
    // у левого края; «8» под ключом не пишут — research 06 §1).
    const staffW = width - margin * 2;
    renderer.drawStaff(margin, staffW, top1);
    renderer.drawStaff(margin, staffW, top2);

    const measuresPerSystem = 4;
    const measureW = usable / measuresPerSystem;
    positions = [];
    sheet.measures.forEach((measure, mIdx) => {
      const topY = mIdx < measuresPerSystem ? top1 : top2;
      const local = mIdx % measuresPerSystem;
      const x0 = left + local * measureW;
      // Размер 4/4 — в начале каждой строки (как в тетради).
      const timeSigW = local === 0 ? ss * 2.2 : 0;
      if (local === 0) renderer.drawTimeSignature(4, 4, x0 + ss * 0.8, topY);

      const barlineX = x0 + measureW - (THIN_BARLINE_THICKNESS_SPACES * ss) / 2;
      // Внутренний воздух такта: слоты вплотную к чертам сливаются в кучу.
      const areaStart = x0 + ss * 0.4 + timeSigW + ss * 0.3;
      const areaWidth = Math.max(0, barlineX - ss * 0.2 - areaStart - ss * 0.3);
      const slots = layoutMeasure(
        measure.items.map((note) => note.duration),
        areaStart,
        areaWidth,
      );

      measure.items.forEach((note, i) => {
        const x = slots[i]?.x ?? areaStart;
        const flatIndex = positions.length;
        renderer.drawNote(note.pitch, note.duration, x, stateOpts(flatIndex, topY));
        positions.push({ x, topY });
      });
      renderer.drawBarline(barlineX, topY);
    });

    // Текущая позиция — всегда очевидна: маркер над станом + отметки промахов.
    if (phase === "playing") {
      const pos = positions[judge.currentIndex];
      const note = judge.currentNote;
      if (pos && note) {
        renderer.drawPositionMarker(pos.x, pos.topY);
        const miss = judge.attemptsCurrent;
        if (miss > 0) {
          renderer.drawMissDots(pos.x, pitchToY(note.pitch, pos.topY, ss) + ss * 2.1, miss);
        }
      }
    }
  }

  /** Вид ноты по состоянию: сыграна — чернила, текущая — accent, будущая — dim. */
  function stateOpts(flatIndex: number, topY: number): GlyphDrawOptions {
    if (phase === "finished" || flatIndex < judge.currentIndex) return { topY };
    if (flatIndex === judge.currentIndex) return { topY, highlight: true };
    return { topY, dim: true };
  }

  // --- Диаграмма грифа (подсказка «Гриф», research 06 §3) ---

  /**
   * Видна только в режиме «Гриф» во время чтения: кружок-палец на месте
   * ТЕКУЩЕЙ ноты по словарю I позиции (writtenToGuitar) — это и есть
   * подсказка, поэтому без приглушения (dim в уроках — до ответа, здесь
   * игрок сам выбрал показывать место). Ввода не принимает, ничего не судит.
   */
  function updateFretboard(): void {
    const visible = active && phase === "playing" && settings.get().guitarNotebookHint === "fretboard";
    if (visible !== gfVisible) {
      gfVisible = visible;
      gfCanvas.hidden = !visible;
    }
    if (!visible) return;
    gfRenderer.resize(); // пересоздание буфера чистит канвас — рисуем всегда
    const pitch = judge.currentNote?.pitch ?? null;
    gfRenderer.render({ highlight: pitch === null ? null : writtenToGuitar(pitch) });
  }

  // --- Клавиатура тетради (паттерн клавиатуры карточек/тетради) ---

  function updateKeyboard(): void {
    const visible = active && phase === "playing";
    if (visible !== kbVisible) {
      kbVisible = visible;
      kbCanvas.hidden = !visible;
      kbStateKey = null;
      drawSheet(); // высота стана зависит от клавиатуры (flex)
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

    // «Жми-сейчас» — только в режиме «Клавиатура» (SPEC §4.13): «Гриф»
    // подсказывает место на грифе, «Нет» — игрок вспоминает клавишу сам
    // (стан-подсветка остаётся — это задание чтения). Нажатия видны всегда.
    const next = new Set<number>();
    const expected = judge.expectedPitch;
    if (expected !== null && settings.get().guitarNotebookHint === "keyboard") next.add(expected);

    const pressed = deps.pressedPitches();
    const stateKey = `${[...pressed].sort().join(",")}|${[...next].sort().join(",")}`;
    if (stateKey === kbStateKey) return;
    kbStateKey = stateKey;
    kbRenderer.render(kbLayout, {
      pressed,
      labelByPitch: deps.mapping.labels(),
      showNoteNames: true, // учебный контекст азбуки: подписи «C4 (до)»
      next,
    });
  }

  function invalidateKeyboardLayout(): void {
    kbLayoutDirty = true;
    kbStateKey = null;
  }

  return { open, close, isActive, handlePitch, updateKeyboard, invalidateKeyboardLayout, redraw: drawSheet };
}
