/**
 * Полноэкранный экран «Азбуки» (SPEC §4.9, ADR-007 п.6): список уроков
 * (карточки .mel-card со статусом «закрыт»/«открыт»/«✓ пройден») и экран
 * урока — канвас нотации (NotationRenderer) + DOM (вопрос, кнопки выбора,
 * счёт, навигация).
 *
 * Движок хода урока — primer/engine.ts (чистая логика); экран только
 * рисует и слушает. Звук карточек внедряется сеттером setAudio (main передаёт
 * AudioEngine: показ ноты → короткое noteOn/noteOff). Ответ клавишей —
 * handlePitch (main прокидывает питчи KeyboardInput.onNoteOn при открытом
 * экране; основная игра при этом продолжает звучать).
 *
 * Клавиатура карточек (SPEC §4.9): на карточках с ответом-клавишей внизу
 * урока — второй инстанс KeyboardRenderer (переиспользование, без копий) на
 * #primerKbCanvas. Маппинг и зажатые питчи приходят снаружи (deps.mapping,
 * deps.pressedPitches) — primer не знает про KeyboardInput; раскладка
 * перестраивается от живого маппинга (октавный сдвиг — invalidateKeyboardLayout).
 * До ответа подсказки нет; после вердикта верная клавиша подсвечена «жми-сейчас».
 *
 * Вход: open() (показ списка сразу, шрифт Bravura — ensureBravura с
 * индикатором); выход — кнопка «Назад к пианино» → deps.onBack().
 *
 * Список уроков включает секцию «Практика» (SPEC §4.10): карточка «Нотной
 * тетради» открывает режим практики — notebook-screen.ts, живёт ВНУТРИ этого
 * экрана (тот же мост handlePitch/updateKeyboard, main про тетрадь не знает).
 * Рядом секция «Слух» (PIANO-17): карточка «Музыкального диктанта» открывает
 * dictation-screen.ts по тому же паттерну, и секция «Гитара» (research 06):
 * уроки Г1–Г6 — своя цепочка гейтов, звук показа на звучащей высоте
 * (cardSoundPitch), диаграмма грифа на #primerGfCanvas (updateGf); под
 * уроками — карточка «Гитарной тетради» (PIANO-20): guitar-notebook-screen.ts
 * по паттерну тетради, подсказка «Клавиатура | Гриф | Нет».
 */
import { ensureBravura, NotationRenderer, NOTATION_INK } from "../notation/index";
import { THIN_BARLINE_THICKNESS_SPACES, layoutMeasure, pitchToStaffPos } from "../notation/geometry";
import { computeKeyboardLayout, pitchName, type KeyboardLayout } from "../core/layout";
import { KeyboardRenderer } from "../render/keyboard";
import { FretboardRenderer } from "../render/fretboard";
import { el, gameButton, requireEl } from "../ui/dom";
import { PrimerEngine } from "./engine";
import { LESSONS } from "./lessons";
import { cardSoundPitch, fretboardHighlight, GUITAR_LESSONS } from "./guitar-lessons";
import { initNotebookScreen, type NotebookScreenApi } from "./notebook-screen";
import { initDictationScreen, type DictationScreenApi, type PrimerPlayback } from "./dictation-screen";
import { initGuitarNotebookScreen, type GuitarNotebookScreenApi } from "./guitar-notebook-screen";
import type { SettingsStore } from "../core/settings";
import { NOTEBOOK_LEVELS, notebookProgressKey } from "./notebook";
import { DICTATION_LEVELS, dictationProgressKey } from "./dictation";
import { GUITAR_NOTEBOOK_LEVELS, guitarNotebookProgressKey } from "./guitar-notebook";
import { PrimerProgressStore } from "./progress";
import { PRIMER_PASS_PERCENT } from "./types";
import type { PrimerCard, PrimerLesson, StaffItem, StaffNote } from "./types";

/** Звук карточек: main передаёт AudioEngine (noteOn/noteOff достаточно). */
export interface PrimerAudio {
  noteOn(pitch: number): void;
  noteOff(pitch: number): void;
}

/**
 * Срез маппинга основной игры для клавиатуры карточек (main передаёт
 * PitchMapping): primer не знает про input и полный класс — только питчи
 * диапазона и подписи физ. клавиш (инвариант GLOSSARY #3: связка
 * «нота ↔ экранная клавиша ↔ физическая клавиша» считается в маппинге).
 */
export interface PrimerKeyboardMapping {
  /** Питчи текущего диапазона по возрастанию (для раскладки клавиш). */
  pitches(): number[];
  /** Подпись физической клавиши по питчу («Tab», «[», «Del»…). */
  labels(): Map<number, string>;
}

export interface PrimerScreenDeps {
  /** Корень экрана (#primer, в разметке hidden). */
  root: HTMLElement;
  /** Канвас нотации урока (#primerCanvas). */
  canvas: HTMLCanvasElement;
  /** Канвас экранной клавиатуры карточек (#primerKbCanvas, в разметке hidden). */
  kbCanvas: HTMLCanvasElement;
  /** Канвас гриф-диаграммы гитарных уроков (#primerGfCanvas, в разметке hidden). */
  gfCanvas: HTMLCanvasElement;
  /** Маппинг основной игры: раскладка и подписи клавиатуры карточек. */
  mapping: PrimerKeyboardMapping;
  /** Зажатые сейчас питчи игровой клавиатуры (main: input.pressedPitches()). */
  pressedPitches(): ReadonlySet<number>;
  /** Настройки: подсветка клавиатуры тетради и карточек (SPEC §4.8/4.10). */
  settings: SettingsStore;
  /** Планируемый звук диктанта (engine.playNote + аудио-часы, PIANO-17). */
  dictationPlayback: PrimerPlayback;
  /** «Назад к пианино»: main прячет экран и возвращает игру. */
  onBack(): void;
}

export interface PrimerScreenApi {
  open(): Promise<void>;
  close(): void;
  isOpen(): boolean;
  /** Открыть «Нотную тетрадь» (SPEC §4.10): список прячется, режим практики. */
  openNotebook(): Promise<void>;
  /** Открыть «Музыкальный диктант» (PIANO-17): список прячется, режим слуха. */
  openDictation(): Promise<void>;
  /** Открыть «Гитарную тетрадь» (PIANO-20): список прячется, режим практики. */
  openGuitarNotebook(): Promise<void>;
  /** Нажат питч игровой клавиатуры (судится карточкой или тетрадью). */
  handlePitch(pitch: number): void;
  setAudio(audio: PrimerAudio | null): void;
  /**
   * Ежекадровое обновление клавиатуры карточек (main.drawFrame при открытом
   * экране): видимость по виду ответа, нажатия, подсветка верной клавиши.
   * Рендер — по dirty-ключу состояния, как у основной клавиатуры.
   */
  updateKeyboard(): void;
  /** Маппинг сместился (Z/X, сброс при входе) — раскладка клавиатуры устарела. */
  invalidateKeyboardLayout(): void;
}

/** Длительность звучания показанной ноты, мс (короткая, по ТЗ 0.6 с). */
const NOTE_SOUND_MS = 600;

export function initPrimerScreen(deps: PrimerScreenDeps): PrimerScreenApi {
  const { root, canvas, kbCanvas, gfCanvas } = deps;
  const renderer = new NotationRenderer(canvas);
  const kbRenderer = new KeyboardRenderer(kbCanvas);
  const gfRenderer = new FretboardRenderer(gfCanvas);
  const engine = new PrimerEngine();
  const progress = new PrimerProgressStore();
  /** «Нотная тетрадь» (SPEC §4.10) — режим практики внутри азбуки. */
  const notebook: NotebookScreenApi = initNotebookScreen({
    mapping: deps.mapping,
    pressedPitches: deps.pressedPitches,
    progress,
    settings: deps.settings,
    onBack: showList,
  });
  /** «Музыкальный диктант» (PIANO-17) — режим слуха внутри азбуки. */
  const dictation: DictationScreenApi = initDictationScreen({
    mapping: deps.mapping,
    pressedPitches: deps.pressedPitches,
    progress,
    playback: deps.dictationPlayback,
    onBack: showList,
  });
  /** «Гитарная тетрадь» (PIANO-20) — режим практики внутри азбуки. */
  const guitarNotebook: GuitarNotebookScreenApi = initGuitarNotebookScreen({
    mapping: deps.mapping,
    pressedPitches: deps.pressedPitches,
    progress,
    settings: deps.settings,
    onBack: showList,
  });

  // --- DOM-элементы экрана (разметка в index.html) ---
  const backBtn = requireEl<HTMLButtonElement>("primerBack");
  const fontStatus = requireEl<HTMLElement>("primerFontStatus");
  const listEl = requireEl<HTMLElement>("primerList");
  const lessonEl = requireEl<HTMLElement>("primerLesson");
  const lessonTitle = requireEl<HTMLElement>("primerLessonTitle");
  const lessonDesc = requireEl<HTMLElement>("primerLessonDesc");
  const promptEl = requireEl<HTMLElement>("primerPrompt");
  const choicesEl = requireEl<HTMLElement>("primerChoices");
  const feedbackEl = requireEl<HTMLElement>("primerFeedback");
  const scoreEl = requireEl<HTMLElement>("primerScore");
  const navEl = requireEl<HTMLElement>("primerNav");

  let openFlag = false;
  let currentLesson: PrimerLesson | null = null;
  /** Серия урока: цепочка гейтов и «следующий урок» — нотная или гитарная. */
  let activeLessons: readonly PrimerLesson[] = LESSONS;
  let audio: PrimerAudio | null = null;
  let soundTimer: number | null = null;
  /** Питч, звучащий сейчас от карточки (глушится stopSound — без зависших нот). */
  let soundingPitch: number | null = null;
  /** Обещание загрузки Bravura: карточки рисуются только после него. */
  let fontReady: Promise<void> = Promise.resolve();

  // --- Состояние клавиатуры карточек (SPEC §4.9) ---
  /** Раскладка клавиатуры карточек (пересоздаётся при resize и сдвиге октавы). */
  let kbLayout: KeyboardLayout | null = null;
  let kbLayoutDirty = true;
  /** Ключ последнего нарисованного состояния: рендер по dirty-ключу, как в main. */
  let kbStateKey: string | null = null;
  /** Кэш видимости: DOM-атрибут hidden пишется только при смене. */
  let kbVisible = false;
  /** Видимость гриф-диаграммы (гитарные уроки) — тот же паттерн кэша. */
  let gfVisible = false;

  backBtn.addEventListener("click", () => deps.onBack());
  window.addEventListener("resize", () => {
    if (dictation.isActive()) {
      dictation.redraw();
      return;
    }
    if (notebook.isActive()) {
      notebook.redraw();
      return;
    }
    if (guitarNotebook.isActive()) {
      guitarNotebook.redraw();
      return;
    }
    if (openFlag && currentLesson !== null && engine.currentPhase !== "finished") showCurrentCard();
  });

  function isOpen(): boolean {
    return openFlag;
  }

  function setAudio(next: PrimerAudio | null): void {
    audio = next;
  }

  function stopSound(): void {
    if (soundTimer !== null) {
      window.clearTimeout(soundTimer);
      soundTimer = null;
    }
    if (soundingPitch !== null) {
      audio?.noteOff(soundingPitch);
      soundingPitch = null;
    }
  }

  /**
   * Показ ноты → короткое звучание (тот же движок, что и игра). Питч —
   * cardSoundPitch: гитарные уроки звучат октавой ниже записи (research 06
   * §1), глушится тот же питч, что и звучал.
   */
  function playCardSound(card: PrimerCard): void {
    stopSound();
    const lesson = currentLesson;
    const note = card.staff.find((item): item is StaffNote => item.kind === "note");
    if (!note || !audio || !lesson) return;
    const pitch = cardSoundPitch(lesson, note.pitch);
    audio.noteOn(pitch);
    soundingPitch = pitch;
    soundTimer = window.setTimeout(() => {
      soundTimer = null;
      if (soundingPitch !== null) {
        audio?.noteOff(soundingPitch);
        soundingPitch = null;
      }
    }, NOTE_SOUND_MS);
  }

  // --- Список уроков ---

  function showList(): void {
    stopSound();
    currentLesson = null;
    notebook.close(); // из тетради вернулись к списку (SPEC §4.10: выход — как из урока)
    dictation.close(); // из диктанта — так же (PIANO-17)
    guitarNotebook.close(); // из гитарной тетради — так же (PIANO-20)
    listEl.hidden = false;
    lessonEl.hidden = true;
    listEl.replaceChildren();
    for (const lesson of LESSONS) {
      listEl.appendChild(buildLessonCard(lesson, LESSONS));
    }
    listEl.appendChild(buildPracticeSection());
    listEl.appendChild(buildEarSection());
    listEl.appendChild(buildGuitarSection());
  }

  /**
   * Секция «Практика» (SPEC §4.10): под уроками — карточка «Нотной тетради»
   * с бейджем лучшего % по всем уровням (прогресс notebook-level-N).
   */
  function buildPracticeSection(): HTMLElement {
    const section = el("div", "primer-practice");
    section.appendChild(el("h3", "primer-section-title", "Практика"));
    const best = Math.max(0, ...NOTEBOOK_LEVELS.map((level) => progress.bestPercent(notebookProgressKey(level))));
    const passed = best >= PRIMER_PASS_PERCENT;

    const card = el("div", "mel-card primer-card");
    const main = el("button", "mel-main");
    main.type = "button";
    main.addEventListener("mousedown", (event) => event.preventDefault()); // Space остаётся педалью

    const titleRow = el("span", "mel-title-row");
    titleRow.append(
      el("span", "mel-title", "Нотная тетрадь (чтение с листа)"),
      el("span", `mel-badge ${best > 0 ? (passed ? "primer-badge-done" : "primer-badge-open") : "primer-badge-open"}`, best > 0 ? `${best}%` : "практика"),
    );
    const metaLine = el("span", "mel-meta");
    metaLine.append(
      el("span", undefined, "Сыграй подряд 8 сгенерированных тактов — 4 уровня: от четвертей первой октавы до восьмых в обеих"),
      el("span", undefined, best > 0 ? `Лучший: ${best}%` : "Попыток не было"),
    );
    main.append(titleRow, metaLine);
    main.addEventListener("click", () => void openNotebook());
    card.appendChild(main);
    section.appendChild(card);
    return section;
  }

  /**
   * Секция «Слух» (PIANO-17): под «Практикой» — карточка «Музыкального
   * диктанта» с бейджем лучшего % по всем уровням (прогресс dictation-level-N).
   */
  function buildEarSection(): HTMLElement {
    const section = el("div", "primer-practice");
    section.appendChild(el("h3", "primer-section-title", "Слух"));
    const best = Math.max(0, ...DICTATION_LEVELS.map((level) => progress.bestPercent(dictationProgressKey(level))));
    const passed = best >= PRIMER_PASS_PERCENT;

    const card = el("div", "mel-card primer-card");
    const main = el("button", "mel-main");
    main.type = "button";
    main.addEventListener("mousedown", (event) => event.preventDefault()); // Space остаётся педалью

    const titleRow = el("span", "mel-title-row");
    titleRow.append(
      el("span", "mel-title", "Музыкальный диктант (тренировка слуха)"),
      el("span", `mel-badge ${best > 0 ? (passed ? "primer-badge-done" : "primer-badge-open") : "primer-badge-open"}`, best > 0 ? `${best}%` : "слух"),
    );
    const metaLine = el("span", "mel-meta");
    metaLine.append(
      el("span", undefined, "Услышь последовательность и повтори её нажатиями — 4 уровня: от 2 нот до 5 с диезами"),
      el("span", undefined, best > 0 ? `Лучший: ${best}%` : "Попыток не было"),
    );
    main.append(titleRow, metaLine);
    main.addEventListener("click", () => void openDictation());
    card.appendChild(main);
    section.appendChild(card);
    return section;
  }

  /**
   * Номер урока в списке и заголовке: нотные — «1»…«6», гитарные — «Г1»…«Г6»
   * (research 06: своя последовательность, номера не смешиваются).
   */
  function lessonNumber(lesson: PrimerLesson): string {
    return lesson.section === "guitar" ? `Г${lesson.order}` : String(lesson.order);
  }

  function buildLessonCard(lesson: PrimerLesson, series: readonly PrimerLesson[]): HTMLElement {
    const unlocked = progress.isUnlocked(lesson, series);
    const best = progress.bestPercent(lesson.id);
    const passed = best >= PRIMER_PASS_PERCENT;

    const card = el("div", "mel-card primer-card");
    const main = el("button", "mel-main");
    main.type = "button";
    main.addEventListener("mousedown", (event) => event.preventDefault()); // Space остаётся педалью
    if (!unlocked) main.disabled = true;

    const titleRow = el("span", "mel-title-row");
    titleRow.append(
      el("span", "mel-title", `${lessonNumber(lesson)}. ${lesson.title}`),
      el(
        "span",
        `mel-badge ${passed ? "primer-badge-done" : unlocked ? "primer-badge-open" : "primer-badge-locked"}`,
        passed ? "✓ пройден" : unlocked ? "открыт" : "закрыт",
      ),
    );
    const metaLine = el("span", "mel-meta");
    metaLine.append(
      el("span", undefined, lesson.description),
      el("span", undefined, best > 0 ? `Лучший: ${best}%` : "Попыток не было"),
    );
    main.append(titleRow, metaLine);
    main.addEventListener("click", () => void startLesson(lesson, series));
    card.appendChild(main);
    return card;
  }

  /**
   * Секция «Гитара» (research 06): уроки Г1–Г6, независимая от нотной
   * цепочка гейтов — гейты считаются по GUITAR_LESSONS. Под уроками —
   * карточка «Гитарной тетради» (PIANO-20, SPEC §4.13) по паттерну секции
   * «Практика»: бейдж лучшего % по всем уровням (прогресс
   * guitar-notebook-level-N).
   */
  function buildGuitarSection(): HTMLElement {
    const section = el("div", "primer-practice");
    section.appendChild(el("h3", "primer-section-title", "Гитара"));
    for (const lesson of GUITAR_LESSONS) {
      section.appendChild(buildLessonCard(lesson, GUITAR_LESSONS));
    }
    section.appendChild(buildGuitarNotebookCard());
    return section;
  }

  /** Карточка «Гитарной тетради» — практика чтения с листа в I позиции. */
  function buildGuitarNotebookCard(): HTMLElement {
    const section = el("div", "primer-practice");
    const best = Math.max(0, ...GUITAR_NOTEBOOK_LEVELS.map((level) => progress.bestPercent(guitarNotebookProgressKey(level))));
    const passed = best >= PRIMER_PASS_PERCENT;

    const card = el("div", "mel-card primer-card");
    const main = el("button", "mel-main");
    main.type = "button";
    main.addEventListener("mousedown", (event) => event.preventDefault()); // Space остаётся педалью

    const titleRow = el("span", "mel-title-row");
    titleRow.append(
      el("span", "mel-title", "Гитарная тетрадь (чтение с листа)"),
      el("span", `mel-badge ${best > 0 ? (passed ? "primer-badge-done" : "primer-badge-open") : "primer-badge-open"}`, best > 0 ? `${best}%` : "чтение"),
    );
    const metaLine = el("span", "mel-meta");
    metaLine.append(
      el("span", undefined, "Сыграй подряд 8 тактов в I позиции — 4 уровня: от открытых струн до всей I позиции с диезами. Подсказка: клавиатура, гриф или чистое чтение"),
      el("span", undefined, best > 0 ? `Лучший: ${best}%` : "Попыток не было"),
    );
    main.append(titleRow, metaLine);
    main.addEventListener("click", () => void openGuitarNotebook());
    card.appendChild(main);
    section.appendChild(card);
    return section;
  }

  // --- Экран урока ---

  async function startLesson(lesson: PrimerLesson, series: readonly PrimerLesson[]): Promise<void> {
    await fontReady.catch(() => undefined); // шрифт мог ещё грузиться (или упасть — рисуем как есть)
    if (!openFlag) return; // пока грузился шрифт, экран закрыли
    currentLesson = lesson;
    activeLessons = series; // «следующий урок» на экране итога — из своей серии
    engine.start(lesson);
    listEl.hidden = true;
    lessonEl.hidden = false;
    lessonTitle.textContent = `${lessonNumber(lesson)}. ${lesson.title}`;
    lessonDesc.textContent = lesson.description;
    showCurrentCard();
  }

  /**
   * Диапазон карточки в позициях стана (notation/geometry): lowest/highest
   * нота + подсветка вердикта (она дорисовывается отдельно). null — нот нет
   * (итог урока, пустая карточка) — стан центрируется по умолчанию.
   */
  function cardPitchExtent(): { minPos: number; maxPos: number } | null {
    if (engine.currentPhase === "finished") return null;
    const card = engine.currentCard;
    if (!card) return null;
    const pitches = card.staff
      .filter((item): item is StaffNote => item.kind === "note")
      .map((note) => note.pitch);
    const highlight = currentHighlightPitch();
    if (highlight !== null) pitches.push(highlight);
    if (pitches.length === 0) return null;
    const positions = pitches.map((pitch) => pitchToStaffPos(pitch));
    return {
      minPos: Math.min(...positions),
      maxPos: Math.max(...positions),
    };
  }

  /**
   * Пересоздать буфер канваса и задать геометрию стана под размер карточки.
   * Базовая раскладка (стан на 30% высоты) рассчитана на ноты у стана; у
   * гитарных уроков низкие ноты уходят на добавочные линейки до 3–4 под
   * станом (E3 при видимых клавиатуре и грифе не влезает) — тогда staffSpace
   * ужимается под диапазон, а стан поднимается, чтобы весь контент поместился.
   */
  function syncCanvasGeometry(): void {
    renderer.resize();
    const { height } = renderer.size;
    const extent = cardPitchExtent();
    let staffSpace = Math.min(30, Math.max(14, Math.round(height / 8)));
    // top — y ВЕРХНЕЙ линии стана (pitchToY отсчитывает от TOP_LINE_POS = 8).
    let top = Math.round(height * 0.3);
    if (extent) {
      // Контент в «спейсах»: над верхней линией, сам стан (4) и ниже нижней
      // (clamp ≥ 0: ноты внутри стана контента сверху не добавляют).
      const above = Math.max(0, (extent.maxPos - 8) / 2);
      const below = Math.max(0, (0 - extent.minPos) / 2);
      const contentBottom = top + 4 * staffSpace + below * staffSpace;
      if (contentBottom + staffSpace * 0.6 > height) {
        // Ужать staffSpace под диапазон и поднять стан (паддинг 0.6 сверху).
        const units = above + 4 + below + 1.2;
        staffSpace = Math.min(30, Math.max(10, Math.floor(height / units)));
        top = Math.round(staffSpace * (0.6 + above));
      }
    }
    renderer.setStaffGeometry(top, staffSpace);
  }

  function showCurrentCard(): void {
    const card = engine.currentCard;
    if (!card) return;
    syncCanvasGeometry();
    drawCard(card, currentHighlightPitch());
    updateGf(card);

    promptEl.textContent = card.prompt;
    choicesEl.replaceChildren();
    feedbackEl.className = "primer-feedback";
    if (card.answer === null) {
      feedbackEl.textContent = card.explanation;
    } else if (engine.currentPhase === "feedback" && engine.verdict) {
      showVerdict(engine.verdict);
    } else if (card.answer.type === "pitch") {
      feedbackEl.textContent = "";
      choicesEl.appendChild(el("p", "primer-keyhint", keyhintText()));
    } else {
      feedbackEl.textContent = "";
      const answer = card.answer;
      answer.options.forEach((option, index) => {
        const button = gameButton(option, () => submitChoice(index), "btn primer-choice");
        choicesEl.appendChild(button);
      });
    }

    const total = engine.cardCount;
    scoreEl.textContent =
      total > 0 ? `Отвечено ${engine.answeredCount}/${total} · стрик ${engine.currentStreak}` : "";
    buildNav(card);
    playCardSound(card);
    // Синхронно (без кадра задержки): вид ответа мог смениться — клавиатура
    // появляется/прячется и стан перерисовывается под новую высоту.
    updateKeyboard();
  }

  /**
   * Подсказка диапазона ответа — по живому маппингу (октавный сдвиг Z/X
   * меняет диапазон; у гитарного Г5 ответы ниже C4 — без сдвига не сыграть).
   */
  function keyhintText(): string {
    const pitches = deps.mapping.pitches();
    const low = pitches[0] ?? 60;
    const high = pitches[pitches.length - 1] ?? 83;
    return `Ответ — клавишей пианино (${pitchName(low)}–${pitchName(high)}), Z/X — октавный сдвиг`;
  }

  function submitChoice(index: number): void {
    const verdict = engine.answerChoice(index);
    if (!verdict) return;
    markChoices(index, verdict.correct);
    disableChoices();
    showVerdict(verdict);
    const card = engine.currentCard;
    if (card) {
      drawCard(card, verdict.highlightPitch);
      updateGf(card);
    }
    updateScoreLine();
    buildNav(card); // после вердикта появляется «Далее»
  }

  function handlePitch(pitch: number): void {
    if (!openFlag) return;
    // Диктант (PIANO-17) — режим внутри азбуки: питчи судит DictationSession.
    if (dictation.isActive()) {
      dictation.handlePitch(pitch);
      return;
    }
    // Тетрадь (SPEC §4.10) — режим внутри азбуки: питчи судит NotebookJudge.
    if (notebook.isActive()) {
      notebook.handlePitch(pitch);
      return;
    }
    // Гитарная тетрадь (PIANO-20) — режим внутри азбуки: тот же NotebookJudge.
    if (guitarNotebook.isActive()) {
      guitarNotebook.handlePitch(pitch);
      return;
    }
    if (currentLesson === null) return;
    const verdict = engine.answerPitch(pitch);
    if (!verdict) return;
    disableChoices();
    showVerdict(verdict);
    const card = engine.currentCard;
    if (card) {
      drawCard(card, verdict.highlightPitch);
      updateGf(card);
    }
    updateScoreLine();
    buildNav(card); // после вердикта появляется «Далее»
  }

  function disableChoices(): void {
    for (const node of choicesEl.querySelectorAll("button")) (node as HTMLButtonElement).disabled = true;
  }

  /**
   * Вердикт на кнопках выбора (DS §3.12 [цель]): выбранный неверный — рамка
   * --error (.wrong), верный — рамка --ok (.correct, в т.ч. когда верным был
   * другой вариант), остальные приглушены (.dim — opacity 0.4, как disabled).
   * Верный вариант остаётся виден: ответ — часть объяснения, а не только
   * вердикт словом. Для ответа клавишей верное показывают стан и подсветка
   * клавиши — кнопок нет, разметка не нужна.
   */
  function markChoices(chosenIndex: number, correct: boolean): void {
    const card = engine.currentCard;
    const correctIndex = card?.answer?.type === "choice" ? card.answer.correctIndex : null;
    choicesEl.querySelectorAll("button").forEach((node, index) => {
      const button = node as HTMLButtonElement;
      if (index === chosenIndex) button.classList.add(correct ? "correct" : "wrong");
      else if (index === correctIndex) button.classList.add("correct");
      else button.classList.add("dim");
    });
  }

  function showVerdict(verdict: { correct: boolean; explanation: string }): void {
    feedbackEl.className = `primer-feedback ${verdict.correct ? "ok" : "error"}`;
    feedbackEl.textContent = `${verdict.correct ? "Верно! " : "Неверно. "}${verdict.explanation}`;
  }

  function updateScoreLine(): void {
    const total = engine.cardCount;
    if (total > 0) scoreEl.textContent = `Отвечено ${engine.answeredCount}/${total} · стрик ${engine.currentStreak}`;
  }

  /** Кнопки навигации под карточкой: «Далее» (факт/вердикт) или ничего (вопрос ждёт ответа). */
  function buildNav(card: PrimerCard | null): void {
    navEl.replaceChildren();
    if (!card) return;
    const isFact = card.answer === null;
    const inFeedback = engine.currentPhase === "feedback";
    if (!isFact && !inFeedback) return;
    const nextBtn = gameButton("Далее", () => advance(), "btn primary");
    navEl.appendChild(nextBtn);
    nextBtn.focus();
  }

  function advance(): void {
    engine.advance();
    if (engine.currentPhase === "finished") showResult();
    else showCurrentCard();
  }

  function showResult(): void {
    stopSound();
    const result = engine.finish();
    const lesson = currentLesson;
    if (!result || !lesson) return;
    progress.recordResult(result);
    syncCanvasGeometry();
    drawStaffContent([], null, null); // чистый стан под итог
    updateGf(null); // диаграмма грифа — только на карточках урока

    promptEl.textContent = "Урок завершён";
    choicesEl.replaceChildren();
    const nextLesson = activeLessons.find((entry) => entry.order === lesson.order + 1) ?? null;
    feedbackEl.className = `primer-feedback ${result.passed ? "ok" : "error"}`;
    feedbackEl.textContent =
      result.passed
        ? `Урок пройден! Открыт следующий урок.`
        : `Нужно ≥${PRIMER_PASS_PERCENT}% — попробуй ещё раз.`;
    scoreEl.textContent = `Лучший результат: ${progress.bestPercent(lesson.id)}% · верных ${result.correct}/${result.total} · лучший стрик ${result.bestStreak}`;

    navEl.replaceChildren();
    const listBtn = gameButton("К списку уроков", showList, "btn");
    navEl.appendChild(listBtn);
    const retryBtn = gameButton("Повторить урок", () => void startLesson(lesson, activeLessons), "btn primary");
    navEl.appendChild(retryBtn);
    if (result.passed && nextLesson) {
      const nextBtn = gameButton(
        `Следующий урок: ${lessonNumber(nextLesson)}. ${nextLesson.title}`,
        () => void startLesson(nextLesson, activeLessons),
        "btn",
      );
      navEl.appendChild(nextBtn);
    }
    listBtn.focus();
    updateKeyboard(); // клавиатура прячется — стан перерисуется на всю высоту
  }

  // --- Рисование карточки на стане ---

  function drawCard(card: PrimerCard, highlightPitch: number | null): void {
    drawStaffContent(card.staff, card.label ?? null, highlightPitch);
  }

  function drawStaffContent(
    items: readonly StaffItem[],
    label: string | null,
    highlightPitch: number | null,
  ): void {
    const { width, height } = renderer.size;
    const ss = renderer.staffSpace;
    renderer.clear();
    const margin = Math.round(ss * 1.2);
    renderer.drawStaff(margin, width - margin * 2);
    drawItems(items, highlightPitch, margin, ss);

    // Питч-подсветка без ноты на стане («сыграй»-карточка): показать верную ноту.
    if (highlightPitch !== null && !items.some((item) => item.kind === "note" && item.pitch === highlightPitch)) {
      renderer.drawNote(highlightPitch, "quarter", width / 2, { highlight: true });
    }
    if (label) {
      renderer.drawLabel(label, width / 2, height - ss * 0.7, { sizePx: Math.round(ss * 0.95), color: NOTATION_INK });
    }
  }

  /**
   * Раскладка элементов по x. Тактовые черты делят элементы на такты — слоты
   * внутри такта считает geometry.layoutMeasure; карточка без черт распределяет
   * ноты/паузы равномерно. Скрипичный ключ рисует drawStaff (левый край).
   */
  function drawItems(items: readonly StaffItem[], highlightPitch: number | null, margin: number, ss: number): void {
    const { width } = renderer.size;
    const left = margin + ss * 2.8; // место под ключ
    const right = width - margin;
    const usable = right - left;
    if (usable <= ss * 2) return;

    // Такты: черта закрывает сегмент; хвостовая пустота — только финальная черта.
    const segments: StaffItem[][] = [[]];
    for (const item of items) {
      if (item.kind === "barline") segments.push([]);
      else (segments[segments.length - 1] as StaffItem[]).push(item);
    }
    const filled = segments.filter((segment) => segment.length > 0);

    if (segments.length === 1) {
      drawSegment(filled[0] ?? [], left, right, highlightPitch, false, ss, null);
      return;
    }
    const measureWidth = usable / Math.max(1, filled.length);
    filled.forEach((segment, i) => {
      const segStart = left + i * measureWidth;
      const segEnd = segStart + measureWidth;
      // Черта закрывает такт: внутренние — по границе, последняя — у края стана.
      drawSegment(segment, segStart, segEnd, highlightPitch, true, ss, segEnd - (THIN_BARLINE_THICKNESS_SPACES * ss) / 2);
    });
  }

  /** Один такт/сегмент: размер (если есть) у начала, ноты/паузы — слотами layoutMeasure. */
  function drawSegment(
    segment: readonly StaffItem[],
    segStart: number,
    segEnd: number,
    highlightPitch: number | null,
    compact: boolean,
    ss: number,
    barlineX: number | null,
  ): void {
    const timeSig = segment.find((item) => item.kind === "timeSignature");
    const timeSigWidth = timeSig ? ss * 2.2 : 0;
    if (timeSig && timeSig.kind === "timeSignature") {
      renderer.drawTimeSignature(timeSig.numerator, timeSig.denominator, segStart + ss * 0.8);
    }
    const notesAndRests = segment.filter((item) => item.kind === "note" || item.kind === "rest");
    const areaStart = segStart + ss * 0.4 + timeSigWidth;
    const areaWidth = Math.max(0, segEnd - areaStart - ss * 0.4);

    if (notesAndRests.length > 0) {
      if (compact) {
        const slots = layoutMeasure(
          notesAndRests.map((item) => item.duration),
          areaStart,
          areaWidth,
        );
        notesAndRests.forEach((item, i) => drawItem(item, slots[i]?.x ?? areaStart, highlightPitch));
      } else {
        // Без тактовых черт: равномерно по всей ширине.
        const step = areaWidth / notesAndRests.length;
        notesAndRests.forEach((item, i) => drawItem(item, areaStart + step * (i + 0.5), highlightPitch));
      }
    }
    if (barlineX !== null) renderer.drawBarline(barlineX);
  }

  function drawItem(item: StaffItem, x: number, highlightPitch: number | null): void {
    if (item.kind === "note") {
      const highlight = item.highlight === true || item.pitch === highlightPitch;
      renderer.drawNote(item.pitch, item.duration, x, { highlight });
    } else if (item.kind === "rest") {
      renderer.drawRest(item.duration, x, { highlight: item.highlight === true });
    }
  }

  // --- Гриф-диаграмма гитарных уроков (research 06 §3, §6 п.4) ---

  /**
   * Диаграмма — третий слой карточки-подсказки «стан ↔ гриф», ввода не
   * принимает и ничего не судит: вопрос и ответ остаются «стан → роя».
   * Видна только в гитарных уроках (section «guitar») вне экрана итога.
   */
  function gfShouldBeVisible(): boolean {
    return (
      openFlag &&
      currentLesson?.section === "guitar" &&
      engine.currentPhase !== "finished" &&
      !notebook.isActive() &&
      !guitarNotebook.isActive() &&
      !dictation.isActive()
    );
  }

  /**
   * Перерисовать диаграмму: до ответа — приглушённый общий гриф (dim); после
   * вердикта и на фактах — кружок «струна.лад» с цифрой лада. card = null —
   * скрыть (итог урока). Пересоздание буфера чистит канвас — рисуем всегда.
   */
  function updateGf(card: PrimerCard | null): void {
    const visible = card !== null && gfShouldBeVisible();
    if (visible !== gfVisible) {
      gfVisible = visible;
      gfCanvas.hidden = !visible;
    }
    if (!visible || !card) return;
    gfRenderer.resize();
    const reveal = card.answer === null || engine.currentPhase === "feedback";
    const highlight = reveal ? fretboardHighlight(card) : null;
    gfRenderer.render({ highlight, dim: highlight === null });
  }

  // --- Клавиатура карточек (SPEC §4.9) ---

  /** Питч подсветки на стане: после вердикта — верная нота, до ответа — нет. */
  function currentHighlightPitch(): number | null {
    return engine.currentPhase === "feedback" ? (engine.verdict?.highlightPitch ?? null) : null;
  }

  /**
   * Клавиатура нужна на карточках с ответом-клавишей (GLOSSARY: ответ
   * клавишей): в фазе вопроса — ждать нажатие, в фазе фидбека — показать
   * верную клавишу. Факты/выбор/список/итог — скрыта: стан забирает место.
   */
  function keyboardShouldBeVisible(): boolean {
    if (dictation.isActive()) return false; // клавиатурой диктанта ведёт dictation-screen
    if (notebook.isActive()) return false; // клавиатурой тетради ведёт notebook-screen
    if (guitarNotebook.isActive()) return false; // клавиатурой гитарной тетради ведёт её экран
    const card = engine.currentCard;
    return (
      openFlag &&
      currentLesson !== null &&
      engine.currentPhase !== "finished" &&
      card !== null &&
      card.answer !== null &&
      card.answer.type === "pitch"
    );
  }

  /** Стан перерисовать под актуальный размер (высота меняется с клавиатурой). */
  function resyncStaff(): void {
    if (dictation.isActive()) return; // экраном диктанта ведёт dictation-screen
    if (notebook.isActive()) return; // станом тетради ведёт notebook-screen
    if (guitarNotebook.isActive()) return; // станом гитарной тетради ведёт её экран
    if (!openFlag || currentLesson === null) return; // список уроков — стана нет
    syncCanvasGeometry();
    if (engine.currentPhase === "finished") {
      drawStaffContent([], null, null); // чистый стан экрана итога
      return;
    }
    const card = engine.currentCard;
    if (!card) return;
    drawCard(card, currentHighlightPitch());
  }

  function invalidateKeyboardLayout(): void {
    kbLayoutDirty = true;
    kbStateKey = null;
    notebook.invalidateKeyboardLayout();
    dictation.invalidateKeyboardLayout();
    guitarNotebook.invalidateKeyboardLayout();
  }

  function updateKeyboard(): void {
    if (dictation.isActive()) {
      dictation.updateKeyboard();
      return;
    }
    if (notebook.isActive()) {
      notebook.updateKeyboard();
      return;
    }
    if (guitarNotebook.isActive()) {
      guitarNotebook.updateKeyboard();
      return;
    }
    updateLessonKeyboard();
  }

  /** Клавиатура карточек урока (тетрадь вела бы свою — см. updateKeyboard). */
  function updateLessonKeyboard(): void {
    const visible = keyboardShouldBeVisible();
    if (visible !== kbVisible) {
      kbVisible = visible;
      kbCanvas.hidden = !visible;
      kbStateKey = null;
      resyncStaff(); // высота стана зависит от клавиатуры (flex)
    }
    if (!visible) return;

    // Пересоздание буфера чистит канвас: раскладка и рисунок устарели.
    if (kbRenderer.resize()) {
      kbLayoutDirty = true;
      kbStateKey = null;
    }
    if (kbLayoutDirty || kbLayout === null) {
      const { width, height } = kbRenderer.size;
      kbLayout = computeKeyboardLayout(width, height, deps.mapping.pitches());
      kbLayoutDirty = false;
    }

    // До ответа подсказки нет; после вердикта — верная клавиша «жми-сейчас».
    const next = new Set<number>();
    const highlightPitch = currentHighlightPitch();
    if (highlightPitch !== null) next.add(highlightPitch);

    const pressed = deps.pressedPitches();
    const stateKey = `${[...pressed].sort().join(",")}|${[...next].sort().join(",")}`;
    if (stateKey === kbStateKey) return;
    kbStateKey = stateKey;
    kbRenderer.render(kbLayout, {
      pressed,
      labelByPitch: deps.mapping.labels(),
      showNoteNames: true, // SPEC §4.9: в азбуке подписи «C4 (до)» — учебный контекст
      next,
    });
  }

  // --- Вход/выход ---

  async function open(): Promise<void> {
    if (openFlag) return;
    openFlag = true;
    root.hidden = false;
    showList();
    fontStatus.hidden = false;
    fontStatus.className = "primer-font-status";
    fontStatus.textContent = "Шрифт нот загружается…";
    fontReady = ensureBravura();
    try {
      await fontReady;
      if (!openFlag) return;
      fontStatus.hidden = true;
    } catch (error) {
      if (!openFlag) return;
      fontStatus.className = "primer-font-status error";
      fontStatus.textContent = "Шрифт нот не загрузился — проверь сеть и обнови страницу";
      console.error("Не удалось загрузить шрифт Bravura", error);
    }
  }

  /**
   * Режим «Нотной тетради» (SPEC §4.10): список уроков прячется, тетрадь
   * рисует свои две строки стана и свою клавиатуру. Внутри открытого
   * primer-экрана — main про тетрадь не знает (флаг primerOpen один).
   */
  async function openNotebook(): Promise<void> {
    if (!openFlag) return;
    await fontReady.catch(() => undefined);
    if (!openFlag) return;
    listEl.hidden = true;
    lessonEl.hidden = true;
    await notebook.open();
  }

  /**
   * Режим «Музыкального диктанта» (PIANO-17): список уроков прячется,
   * диктант ведёт свой статус и свою клавиатуру. Внутри открытого
   * primer-экрана — main про диктант не знает (флаг primerOpen один).
   * Стана и шрифта у диктанта нет — ждать Bravura не нужно.
   */
  async function openDictation(): Promise<void> {
    if (!openFlag) return;
    listEl.hidden = true;
    lessonEl.hidden = true;
    dictation.open();
  }

  /**
   * Режим «Гитарной тетради» (PIANO-20): список уроков прячется, тетрадь
   * рисует свой стан (I позиции), свою клавиатуру и свою диаграмму грифа.
   * Внутри открытого primer-экрана — main про неё не знает.
   */
  async function openGuitarNotebook(): Promise<void> {
    if (!openFlag) return;
    await fontReady.catch(() => undefined); // стан рисуется только со шрифтом
    if (!openFlag) return;
    listEl.hidden = true;
    lessonEl.hidden = true;
    await guitarNotebook.open();
  }

  function close(): void {
    if (!openFlag) return;
    openFlag = false;
    stopSound();
    notebook.close();
    dictation.close();
    guitarNotebook.close();
    root.hidden = true;
  }

  return {
    open,
    close,
    isOpen,
    openNotebook,
    openDictation,
    openGuitarNotebook,
    handlePitch,
    setAudio,
    updateKeyboard,
    invalidateKeyboardLayout,
  };
}
