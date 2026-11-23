/**
 * Полноэкранный экран «Азбуки» (SPEC §4.9, ADR-007 п.6): список уроков
 * (карточки .mel-card со статусом 🔒/открыт/✓) и экран урока — канвас
 * нотации (NotationRenderer) + DOM (вопрос, кнопки выбора, счёт, навигация).
 *
 * Движок хода урока — primer/engine.ts (чистая логика); экран только
 * рисует и слушает. Звук карточек внедряется сеттером setAudio (main передаёт
 * AudioEngine: показ ноты → короткое noteOn/noteOff). Ответ клавишей —
 * handlePitch (main прокидывает питчи KeyboardInput.onNoteOn при открытом
 * экране; основная игра при этом продолжает звучать).
 *
 * Вход: open() (показ списка сразу, шрифт Bravura — ensureBravura с
 * индикатором); выход — кнопка «Назад к пианино» → deps.onBack().
 */
import { ensureBravura, NotationRenderer } from "../notation/index";
import { THIN_BARLINE_THICKNESS_SPACES, layoutMeasure } from "../notation/geometry";
import { el, gameButton, requireEl } from "../ui/dom";
import { PrimerEngine } from "./engine";
import { LESSONS } from "./lessons";
import { PrimerProgressStore } from "./progress";
import { PRIMER_PASS_PERCENT } from "./types";
import type { PrimerCard, PrimerLesson, StaffItem, StaffNote } from "./types";

/** Звук карточек: main передаёт AudioEngine (noteOn/noteOff достаточно). */
export interface PrimerAudio {
  noteOn(pitch: number): void;
  noteOff(pitch: number): void;
}

export interface PrimerScreenDeps {
  /** Корень экрана (#primer, в разметке hidden). */
  root: HTMLElement;
  /** Канвас нотации урока (#primerCanvas). */
  canvas: HTMLCanvasElement;
  /** «Назад к пианино»: main прячет экран и возвращает игру. */
  onBack(): void;
}

export interface PrimerScreenApi {
  open(): Promise<void>;
  close(): void;
  isOpen(): boolean;
  /** Нажат питч игровой клавиатуры (судится только на питч-карточке в фазе вопроса). */
  handlePitch(pitch: number): void;
  setAudio(audio: PrimerAudio | null): void;
}

/** Длительность звучания показанной ноты, мс (короткая, по ТЗ 0.6 с). */
const NOTE_SOUND_MS = 600;

export function initPrimerScreen(deps: PrimerScreenDeps): PrimerScreenApi {
  const { root, canvas } = deps;
  const renderer = new NotationRenderer(canvas);
  const engine = new PrimerEngine();
  const progress = new PrimerProgressStore();

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
  let audio: PrimerAudio | null = null;
  let soundTimer: number | null = null;
  /** Питч, звучащий сейчас от карточки (глушится stopSound — без зависших нот). */
  let soundingPitch: number | null = null;
  /** Обещание загрузки Bravura: карточки рисуются только после него. */
  let fontReady: Promise<void> = Promise.resolve();

  backBtn.addEventListener("click", () => deps.onBack());
  window.addEventListener("resize", () => {
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

  /** Показ ноты → короткое звучание (тот же движок, что и игра). */
  function playCardSound(card: PrimerCard): void {
    stopSound();
    const note = card.staff.find((item): item is StaffNote => item.kind === "note");
    if (!note || !audio) return;
    audio.noteOn(note.pitch);
    soundingPitch = note.pitch;
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
    listEl.hidden = false;
    lessonEl.hidden = true;
    listEl.replaceChildren();
    for (const lesson of LESSONS) {
      listEl.appendChild(buildLessonCard(lesson));
    }
  }

  function buildLessonCard(lesson: PrimerLesson): HTMLElement {
    const unlocked = progress.isUnlocked(lesson, LESSONS);
    const best = progress.bestPercent(lesson.id);
    const passed = best >= PRIMER_PASS_PERCENT;

    const card = el("div", "mel-card primer-card");
    const main = el("button", "mel-main");
    main.type = "button";
    main.addEventListener("mousedown", (event) => event.preventDefault()); // Space остаётся педалью
    if (!unlocked) main.disabled = true;

    const titleRow = el("span", "mel-title-row");
    titleRow.append(
      el("span", "mel-title", `${lesson.order}. ${lesson.title}`),
      el(
        "span",
        `mel-badge ${passed ? "primer-badge-done" : unlocked ? "primer-badge-open" : "primer-badge-locked"}`,
        passed ? "✓ пройден" : unlocked ? "открыт" : "🔒 закрыт",
      ),
    );
    const metaLine = el("span", "mel-meta");
    metaLine.append(
      el("span", undefined, lesson.description),
      el("span", undefined, best > 0 ? `Лучший: ${best}%` : "Попыток не было"),
    );
    main.append(titleRow, metaLine);
    main.addEventListener("click", () => void startLesson(lesson));
    card.appendChild(main);
    return card;
  }

  // --- Экран урока ---

  async function startLesson(lesson: PrimerLesson): Promise<void> {
    await fontReady.catch(() => undefined); // шрифт мог ещё грузиться (или упасть — рисуем как есть)
    if (!openFlag) return; // пока грузился шрифт, экран закрыли
    currentLesson = lesson;
    engine.start(lesson);
    listEl.hidden = true;
    lessonEl.hidden = false;
    lessonTitle.textContent = `${lesson.order}. ${lesson.title}`;
    lessonDesc.textContent = lesson.description;
    showCurrentCard();
  }

  /** Пересоздать буфер канваса и задать геометрию стана под размер карточки. */
  function syncCanvasGeometry(): void {
    renderer.resize();
    const { height } = renderer.size;
    const staffSpace = Math.min(30, Math.max(14, Math.round(height / 8)));
    renderer.setStaffGeometry(Math.round(height * 0.3), staffSpace);
  }

  function showCurrentCard(): void {
    const card = engine.currentCard;
    if (!card) return;
    syncCanvasGeometry();
    const highlight = engine.currentPhase === "feedback" ? (engine.verdict?.highlightPitch ?? null) : null;
    drawCard(card, highlight);

    promptEl.textContent = card.prompt;
    choicesEl.replaceChildren();
    feedbackEl.className = "primer-feedback";
    if (card.answer === null) {
      feedbackEl.textContent = card.explanation;
    } else if (engine.currentPhase === "feedback" && engine.verdict) {
      showVerdict(engine.verdict);
    } else if (card.answer.type === "pitch") {
      feedbackEl.textContent = "";
      choicesEl.appendChild(el("p", "primer-keyhint", "Ответ — клавишей пианино (диапазон C4–B5)"));
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
  }

  function submitChoice(index: number): void {
    const verdict = engine.answerChoice(index);
    if (!verdict) return;
    disableChoices();
    showVerdict(verdict);
    const card = engine.currentCard;
    if (card) drawCard(card, verdict.highlightPitch);
    updateScoreLine();
    buildNav(card); // после вердикта появляется «Далее»
  }

  function handlePitch(pitch: number): void {
    if (!openFlag || currentLesson === null) return;
    const verdict = engine.answerPitch(pitch);
    if (!verdict) return;
    disableChoices();
    showVerdict(verdict);
    const card = engine.currentCard;
    if (card) drawCard(card, verdict.highlightPitch);
    updateScoreLine();
    buildNav(card); // после вердикта появляется «Далее»
  }

  function disableChoices(): void {
    for (const node of choicesEl.querySelectorAll("button")) (node as HTMLButtonElement).disabled = true;
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

    promptEl.textContent = "Урок завершён";
    choicesEl.replaceChildren();
    const nextLesson = LESSONS.find((entry) => entry.order === lesson.order + 1) ?? null;
    feedbackEl.className = `primer-feedback ${result.passed ? "ok" : "error"}`;
    feedbackEl.textContent =
      result.passed
        ? `Урок пройден! Открыт следующий урок.`
        : `Нужно ≥${PRIMER_PASS_PERCENT}% — попробуй ещё раз.`;
    scoreEl.textContent = `Лучший результат: ${progress.bestPercent(lesson.id)}% · верных ${result.correct}/${result.total} · лучший стрик ${result.bestStreak}`;

    navEl.replaceChildren();
    const listBtn = gameButton("К списку уроков", showList, "btn");
    navEl.appendChild(listBtn);
    const retryBtn = gameButton("Повторить урок", () => void startLesson(lesson), "btn primary");
    navEl.appendChild(retryBtn);
    if (result.passed && nextLesson) {
      const nextBtn = gameButton(`Следующий урок: ${nextLesson.title}`, () => void startLesson(nextLesson), "btn");
      navEl.appendChild(nextBtn);
    }
    listBtn.focus();
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
      renderer.drawLabel(label, width / 2, height - ss * 0.7, { sizePx: Math.round(ss * 0.95), color: "#e9e7e2" });
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

  function close(): void {
    if (!openFlag) return;
    openFlag = false;
    stopSound();
    root.hidden = true;
  }

  return { open, close, isOpen, handlePitch, setAudio };
}
