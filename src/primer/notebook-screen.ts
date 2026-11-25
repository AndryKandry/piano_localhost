/**
 * Экран «Нотной тетради» (SPEC §4.10, PIANO-12) — режим практики ВНУТРИ
 * «Азбуки»: свой контейнер #primerNotebook по паттерну #primerLesson,
 * вход — карточка «Нотная тетрадь» в секции «Практика» списка уроков,
 * выход — кнопка «К списку уроков». main про тетрадь не знает: питчи
 * приходят тем же мостом PrimerScreen.handlePitch, тетрадь живёт внутри
 * primer-экрана (флаг primerOpen не дублируется).
 *
 * Тетрадь (GLOSSARY: нотная тетрадь, чтение с листа): 8 тактов 4/4 на ДВУХ
 * строках стана по 4 такта (перенос строки — как в тетради; размер — в начале
 * каждой строки). Текущая нота — accent-подсветка + свечение + маркер позиции
 * над станом; сыгранные — обычные чернила; будущие — приглушены (alpha 0.4);
 * промахи — точки --error под нотой. Время не лимитировано: позиция стоит,
 * пока нота не взята верно.
 *
 * Рендер — тот же NotationRenderer (расширен опциональным topY для второй
 * строки: существующие вызовы не сломаны); клавиатура снизу — второй инстанс
 * KeyboardRenderer по паттерну клавиатуры карточек (deps.mapping/pressedPitches
 * приходят снаружи, primer не знает про KeyboardInput). «Жми-сейчас» — текущая
 * нота тетради. Звук — от нажатия игровой клавиатуры (main: engine.noteOn),
 * отдельного звука тетради нет.
 *
 * Машина состояний: playing (уровень выбирается сегментом в топбаре — это и
 * есть config) → finished (итог-панель; «Новая тетрадь»/уровень начинают
 * заново). Лучший результат уровня — в прогресс Азбуки под ключом
 * notebook-level-N (тот же PrimerProgressStore, что у уроков).
 */
import {
  THIN_BARLINE_THICKNESS_SPACES,
  layoutMeasure,
  pitchToY,
  stemDirection,
  stemTipY,
} from "../notation/geometry";
import { ensureBravura, NotationRenderer, type GlyphDrawOptions } from "../notation/index";
import { computeKeyboardLayout, type KeyboardLayout } from "../core/layout";
import { KeyboardRenderer } from "../render/keyboard";
import { el, gameButton, requireEl } from "../ui/dom";
import {
  NOTEBOOK_LEVELS,
  NotebookJudge,
  generateNotebook,
  notebookProgressKey,
  type NotebookLevel,
  type NotebookSheet,
} from "./notebook";
import { PrimerProgressStore } from "./progress";
import { PRIMER_PASS_PERCENT } from "./types";
import type { PrimerKeyboardMapping } from "./screen";

export interface NotebookScreenDeps {
  /** Маппинг основной игры: раскладка и подписи клавиатуры тетради. */
  mapping: PrimerKeyboardMapping;
  /** Зажатые сейчас питчи игровой клавиатуры (main: input.pressedPitches()). */
  pressedPitches(): ReadonlySet<number>;
  /** Прогресс Азбуки (общий инстанс с экраном уроков — бейдж «Практики»). */
  progress: PrimerProgressStore;
  /** «К списку уроков»: primer прячет тетрадь и показывает список. */
  onBack(): void;
}

export interface NotebookScreenApi {
  open(): Promise<void>;
  close(): void;
  isActive(): boolean;
  /** Нажат питч игровой клавиатуры (судится в фазе playing). */
  handlePitch(pitch: number): void;
  /** Ежекадровое обновление клавиатуры (main.drawFrame при открытом primer). */
  updateKeyboard(): void;
  /** Маппинг сместился — раскладка клавиатуры устарела. */
  invalidateKeyboardLayout(): void;
  /** Перерисовать тетрадь (окно изменилось, видимость клавиатуры сменилась). */
  redraw(): void;
}

/** Фаза тетради: чтение → итог. Выбор уровня (config) — сегмент топбара. */
type NotebookPhase = "playing" | "finished";

/** Позиция нарисованной ноты: x центра головки + верхняя линия её строки. */
interface NotePosition {
  x: number;
  topY: number;
}

export function initNotebookScreen(deps: NotebookScreenDeps): NotebookScreenApi {
  const { progress } = deps;
  const rootEl = requireEl<HTMLElement>("primerNotebook");
  const canvas = requireEl<HTMLCanvasElement>("primerNbCanvas");
  const kbCanvas = requireEl<HTMLCanvasElement>("primerNbKbCanvas");
  const levelsEl = requireEl<HTMLElement>("primerNbLevels");
  const statusEl = requireEl<HTMLElement>("primerNbStatus");
  const feedbackEl = requireEl<HTMLElement>("primerNbFeedback");
  const resultEl = requireEl<HTMLElement>("primerNbResult");
  const newBtn = requireEl<HTMLButtonElement>("primerNbNew");
  const backBtn = requireEl<HTMLButtonElement>("primerNbBack");

  const renderer = new NotationRenderer(canvas);
  const kbRenderer = new KeyboardRenderer(kbCanvas);
  const judge = new NotebookJudge();

  let active = false;
  let phase: NotebookPhase = "playing";
  let level: NotebookLevel = 1;
  let sheet: NotebookSheet | null = null;
  /** x/y каждой ноты последней отрисовки — маркер позиции и отметки промахов. */
  let positions: NotePosition[] = [];

  // --- Состояние клавиатуры (паттерн клавиатуры карточек, screen.ts) ---
  let kbLayout: KeyboardLayout | null = null;
  let kbLayoutDirty = true;
  let kbStateKey: string | null = null;
  let kbVisible = false;

  const levelButtons = NOTEBOOK_LEVELS.map((value) => {
    const button = gameButton(String(value), () => switchLevel(value), "btn primer-nb-level");
    levelsEl.appendChild(button);
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
  }

  function switchLevel(next: NotebookLevel): void {
    level = next;
    startSheet();
  }

  function startSheet(): void {
    sheet = generateNotebook(level, Math.random);
    judge.start(sheet);
    phase = "playing";
    syncLevelButtons();
    resultEl.hidden = true;
    setFeedback(null);
    drawSheet();
    updateStatus();
    updateKeyboard();
  }

  function syncLevelButtons(): void {
    levelButtons.forEach((button, i) => button.classList.toggle("active", (NOTEBOOK_LEVELS[i] ?? 0) === level));
  }

  function handlePitch(pitch: number): void {
    if (!active || phase !== "playing") return;
    const outcome = judge.handlePitch(pitch);
    if (!outcome) return;
    if (!outcome.correct) {
      // Отметка промаха на ноте, позиция не двигается (wait-семантика).
      setFeedback("Мимо — это другая клавиша. Смотри на подсвеченную ноту", "error");
      drawSheet();
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
    updateKeyboard();
  }

  function finishSheet(): void {
    const result = judge.result();
    phase = "finished";
    if (!result) return;
    const key = notebookProgressKey(result.level);
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
      el("p", "primer-nb-result-title", "Тетрадь дочитана!"),
      el(
        "p",
        "primer-nb-result-line",
        `Верно с первой: ${result.firstTryPercent}% · стрик ${result.bestStreak} · лучший результат уровня: ${best}%`,
      ),
    );
    resultEl.hidden = false;
    updateKeyboard(); // фаза finished — клавиатура прячется, стан выше
  }

  // --- Статус и фидбек ---

  function updateStatus(): void {
    const total = judge.totalCount;
    if (total === 0) {
      statusEl.textContent = "";
      return;
    }
    if (phase === "finished") {
      const result = judge.result();
      statusEl.textContent = result
        ? `Нот: ${total} · верно с первой: ${result.firstTryCount}/${total} · лучший результат уровня: ${progress.bestPercent(notebookProgressKey(result.level))}%`
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
    // Вертикаль: две системы (стан 4ss + по 2.5ss на добавочные C4/B5) + зазор.
    const ss = Math.max(11, Math.min(20, Math.round(height / 20)));
    const systemH = ss * 9;
    const gap = ss * 2;
    const headroom = Math.round(ss * 2.5);
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
      const areaStart = x0 + ss * 0.4 + timeSigW;
      const areaWidth = Math.max(0, barlineX - ss * 0.2 - areaStart);
      const slots = layoutMeasure(
        measure.items.map((note) => note.duration),
        areaStart,
        areaWidth,
      );
      const xs = slots.map((slot) => slot.x);

      // Ребро пары восьмых: плашка горизонтальна по среднему кончику штилей —
      // оба штиля дорисовываются до неё (opts.stemTipY). Разные направления
      // штилей (через среднюю линию) — пары без ребра, у каждой флаг.
      const beams: Array<{ i: number; beamY: number; dir: "up" | "down" }> = [];
      for (let i = 0; i + 1 < measure.items.length; i += 1) {
        const a = measure.items[i];
        const b = measure.items[i + 1];
        if (!a || !b || a.eighthGroup !== true || b.eighthGroup !== true) continue;
        const dir = stemDirection(a.pitch);
        if (dir !== stemDirection(b.pitch)) continue;
        beams.push({ i, beamY: (stemTipY(a.pitch, topY, ss) + stemTipY(b.pitch, topY, ss)) / 2, dir });
      }

      measure.items.forEach((note, i) => {
        const x = xs[i] ?? areaStart;
        const flatIndex = positions.length;
        const beam = beams.find((entry) => entry.i === i);
        renderer.drawNote(note.pitch, note.duration, x, {
          ...stateOpts(flatIndex, topY),
          ...(beam ? { inBeam: true, stemTipY: beam.beamY } : {}),
        });
        positions.push({ x, topY });
      });
      for (const beam of beams) {
        const x1 = xs[beam.i];
        const x2 = xs[beam.i + 1];
        if (x1 === undefined || x2 === undefined) continue;
        // Плашка между штилями: вверх — штиль справа от головки, вниз — слева.
        const off = beam.dir === "up" ? ss * 0.55 : -ss * 0.55;
        renderer.drawBeam(x1 + off, beam.beamY, x2 + off, beam.beamY);
      }
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

  // --- Клавиатура тетради (паттерн клавиатуры карточек) ---

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

    // «Жми-сейчас» — текущая нота тетради (wait-семантика чтения с листа).
    const next = new Set<number>();
    const expected = judge.expectedPitch;
    if (expected !== null) next.add(expected);

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
