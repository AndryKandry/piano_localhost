/**
 * Smoke-проверка логики очереди 3 без браузера: судья, чистая функция
 * позиции, wait-mode, планировщик, режимы партий. Запуск: npm run smoke:player.
 *
 * AudioContext в node недоступен — время подменяется фиктивным часом
 * (TimeSource), звук — моком AudioNoteTarget. Планировщик тикается вручную:
 * setInterval не срабатывает внутри синхронного теста. Рендер (canvas) здесь
 * не тестируется: он чистый потребитель тех же данных.
 */
import { Judge, groupNotes, DEFAULT_HIT_WINDOW_SEC, MIN_HIT_WINDOW_SEC, MAX_HIT_WINDOW_SEC } from "../src/player/judge";
import { Player, MIN_MULTIPLIER, MAX_MULTIPLIER } from "../src/player/player";
import { Scheduler, SCHEDULER_LOOKAHEAD_SEC } from "../src/player/scheduler";
import type { Melody, Note } from "../src/core/types";

let checks = 0;
function assert(condition: boolean, message: string): void {
  checks += 1;
  if (!condition) throw new Error(`ПРОВАЛ: ${message}`);
}
function assertApprox(actual: number, expected: number, message: string, eps = 1e-9): void {
  assert(Math.abs(actual - expected) < eps, `${message} (ожидалось ~${expected}, получено ${actual})`);
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message} (ожидалось ${String(expected)}, получено ${String(actual)})`);
}

// --- Моки ---

class FakeClock {
  t = 0;
  currentTime(): number {
    return this.t;
  }
}

interface PlayedNote {
  pitch: number;
  velocity: number;
  timeSec: number;
  durationSec: number;
}

class MockEngine {
  readonly calls: PlayedNote[] = [];
  playNote(pitch: number, velocity: number, timeSec: number, durationSec: number): void {
    this.calls.push({ pitch, velocity, timeSec, durationSec });
  }
}

/** Белый-ящичный доступ к планировщику плеера — для ручного тика в тесте. */
function schedulerOf(player: Player): Scheduler {
  return (player as unknown as { scheduler: Scheduler }).scheduler;
}

function note(pitch: number, startTimeSec: number, durationSec = 0.5, handPart: "right" | "left" = "right"): Note {
  return { pitch, startTimeSec, durationSec, handPart, velocity: 90 };
}

function melody(notes: readonly Note[], durationSec?: number): Melody {
  return {
    id: "smoke",
    title: "Smoke",
    composer: "Smoke",
    notes: [...notes],
    tempoMap: [{ timeSec: 0, bpm: 120 }],
    durationSec: durationSec ?? Math.max(1, ...notes.map((n) => n.startTimeSec + n.durationSec)) + 0.5,
  };
}

// --- 1. Судья: окно ±150 мс, вердикты, стрик, аккорд-митигация ---

function testJudge(): void {
  console.log("Судья:");
  assertApprox(DEFAULT_HIT_WINDOW_SEC, 0.15, "окно по умолчанию ±150 мс");

  const judge = new Judge();
  judge.setHitWindowSec(0.05);
  assertApprox(judge.hitWindowSec, MIN_HIT_WINDOW_SEC, "окно клампится к минимуму 50 мс");
  judge.setHitWindowSec(0.999);
  assertApprox(judge.hitWindowSec, MAX_HIT_WINDOW_SEC, "окно клампится к максимуму 300 мс");
  judge.setHitWindowSec(0.15);

  // Попадание в окне: |Δ|=0.1 ≤ 0.15.
  judge.reset([note(60, 1)]);
  assertEqual(judge.onPress(60, 0.9).kind, "hit", "нажатие в окне — hit");
  assertEqual(judge.result.hitGroups, 1, "группа засчитана");
  assertEqual(judge.result.streak, 1, "стрик 1");

  // Рано: |Δ|=0.2 > 0.15, но в двойном окне.
  judge.reset([note(60, 1)]);
  assertEqual(judge.onPress(60, 0.8).kind, "early", "раннее нажатие — early");
  assertEqual(judge.result.errors[0]?.kind, "early", "ошибка «рано» зафиксирована");
  assertEqual(judge.result.streak, 0, "ошибка сбросила стрик");

  // Поздно: окно истекло (miss), затем правильный питч в двойном окне.
  judge.reset([note(60, 1)]);
  judge.update(1.2); // 1 + 0.15 < 1.2 → группа пропущена
  assertEqual(judge.result.errors[0]?.kind, "miss", "истёкшая группа — miss");
  assertEqual(judge.onPress(60, 1.2).kind, "late", "нажатие по пропущенной — late");

  // Не та клавиша рядом с ожидаемой нотой — «мимо».
  judge.reset([note(60, 1)]);
  assertEqual(judge.onPress(67, 1.0).kind, "wrong", "чужой питч при ожидании — wrong");
  // Лишняя нота: рядом ничего не ждут.
  judge.reset([note(60, 1)]);
  assertEqual(judge.onPress(60, 5.0).kind, "extra", "нажатие в пустоте — extra");

  // Счёт и процент: 1 из 2 групп → 50%.
  judge.reset([note(60, 1), note(62, 2)]);
  judge.onPress(60, 1.0);
  judge.update(3.0);
  assertEqual(judge.result.hitGroups, 1, "вторая группа пропущена");
  assertApprox(judge.result.hitPercent, 50, "hitPercent = 50%");
  assertEqual(judge.result.bestStreak, 1, "лучший стрик 1");

  // Аккорд-митигация ghosting (SPEC §6): ≥1 нота аккорда — аккорд засчитан.
  const chord = [note(60, 0), note(64, 0), note(67, 0.01)];
  assertEqual(groupNotes(chord).length, 1, "ноты в пределах 30 мс — один аккорд");
  judge.reset(chord);
  const verdict = judge.onPress(64, 0);
  assertEqual(verdict.kind, "hit", "нажатие одной ноты аккорда — hit");
  assert(verdict.group?.hit === true, "аккорд засчитан по одной ноте (митигация ghosting)");
  assertEqual(verdict.group?.pending.size, 2, "две ноты аккорда остались ненажатыми (не караем)");

  // Строгий режим: ждём все ноты аккорда.
  const strict = new Judge(0.15, true);
  strict.reset(chord);
  assert(strict.onPress(64, 0).group?.hit === false, "строгий судья не засчитал аккорд по одной ноте");
  strict.onPress(60, 0);
  assert(strict.onPress(67, 0).group?.hit === true, "строгий судья засчитал аккорд всеми нотами");

  // expectedPitches: подсветка wait-mode (инвариант #5).
  judge.reset([note(60, 1), note(64, 1), note(62, 3)]);
  const expected = judge.expectedPitches();
  assert(expected.has(60) && expected.has(64) && !expected.has(62), "ожидается следующий аккорд, не будущие ноты");
  console.log("  OK: окно/вердикты/стрик/аккорды/подсветка ожидаемой группы");
}

// --- 2. Чистая функция позиции (ADR-004 п.2) ---

function testSongTime(): void {
  console.log("Позиция:");
  const clock = new FakeClock();
  const engine = new MockEngine();
  const player = new Player(clock, engine);

  clock.t = 10;
  // Длинная мелодия: кламп к длительности не должен мешать проверкам формулы.
  player.loadMelody(melody([note(60, 0), note(62, 1)], 100));
  player.setMultiplier(0.5);
  player.start();

  // Пример из задания: t0=10, now=12, множитель 0.5 → songTime = 1.0.
  clock.t = 12;
  assertApprox(player.songTime(), 1.0, "songTime = (12 − 10) × 0.5 = 1.0");
  // Чистота: повторный вызов в тот же момент времени даёт то же значение.
  assertApprox(player.songTime(), 1.0, "повторный вызов не инкрементирует");

  // Смена множителя на ходу: пересчёт якоря, позиция непрерывна.
  player.setMultiplier(1.0);
  assertApprox(player.songTime(), 1.0, "смена множителя не сдвинула позицию");
  clock.t = 14;
  assertApprox(player.songTime(), 3.0, "после смены ×1.0: 1 + (14 − 12) × 1 = 3.0");

  // Пауза: время замерло, часы идут.
  player.pause();
  clock.t = 100;
  assertApprox(player.songTime(), 3.0, "на паузе позиция замерла");
  assertEqual(player.audioTimeFor(10), null, "на паузе будущие ноты не планируются");
  player.start();
  clock.t = 101;
  assertApprox(player.songTime(), 4.0, "возобновление с той же позиции");

  // Конец мелодии: позиция покоится на длительности.
  player.stop();
  clock.t = 200;
  player.start();
  clock.t = 300;
  assertApprox(player.songTime(), 100, "за концом мелодии позиция клампится к длительности");

  // Клампы множителя.
  player.setMultiplier(5);
  assertApprox(player.speedMultiplier, MAX_MULTIPLIER, "множитель не выше 1.0");
  player.setMultiplier(0.01);
  assertApprox(player.speedMultiplier, MIN_MULTIPLIER, "множитель не ниже 0.25");
  player.stepMultiplier(-0.06);
  assertApprox(player.speedMultiplier, MIN_MULTIPLIER, "шаг вниз упирается в 0.25");

  player.dispose();
  console.log("  OK: чистая функция, смена множителя, пауза/возобновление, клампы");
}

// --- 3. Wait-mode: стоит до правильного нажатия, ошибки не двигают ---

function testWaitMode(): void {
  console.log("Wait-mode:");
  const clock = new FakeClock();
  const engine = new MockEngine();
  const player = new Player(clock, engine);
  const tick = (): void => schedulerOf(player).tick();

  // Правая рука: аккорд C4+E4 на 0, D4 на 1, C4 на 2; левая — аккомпанемент.
  const m = melody([note(60, 0), note(64, 0), note(62, 1), note(60, 2), note(48, 1.5, 0.4, "left")], 3.5);
  player.loadMelody(m);
  player.setMode("learn");
  player.setHandMode("right");
  player.setWaitMode(true);
  clock.t = 0;
  player.start();

  // Время замерло на первом гейте (t=0), часы идут.
  clock.t = 5;
  assertApprox(player.songTime(), 0, "стоит на первом аккорде, несмотря на часы");
  const expected = player.expectedPitches();
  assert(expected.has(60) && expected.has(64), "подсвечены обе ноты ожидаемого аккорда");

  // Ошибочное нажатие не двигает время.
  assertEqual(player.onKeyPress(67)?.kind, "wrong", "чужая клавиша — wrong");
  assertApprox(player.songTime(), 0, "ошибка не двигает вперёд");

  // Автопартия за гейтом не планируется (audioTimeFor = null).
  tick();
  assertEqual(engine.calls.length, 0, "автопартия за гейтом молчит");

  // Правильное нажатие одной ноты аккорда открывает гейт (митигация ghosting).
  assertEqual(player.onKeyPress(64)?.kind, "hit", "правильная нота аккорда — hit");
  clock.t = 5.4;
  const t1 = player.songTime();
  assert(t1 > 0 && t1 < 1, `время тронулось с места (получено ${t1})`);

  // Нота левой партии за СЛЕДУЮЩИМ гейтом (song 1) всё ещё не планируется.
  tick();
  assertEqual(engine.calls.length, 0, "автопартия за следующим гейтом молчит");

  // До следующего гейта (t=1) время снова замерло.
  clock.t = 7;
  assertApprox(player.songTime(), 1.0, "замерло на ноте D4");
  assertEqual(player.onKeyPress(62)?.kind, "hit", "D4 — hit");

  // Гейт открыт: нота левой партии (song 1.5 → стена 7.5) входит в lookahead.
  clock.t = 7.45;
  tick();
  assertEqual(engine.calls.length, 1, "нота автопартии спланирована после открытия гейта");

  clock.t = 9;
  assertApprox(player.songTime(), 2.0, "замерло на ноте C4");
  assertEqual(player.onKeyPress(60)?.kind, "hit", "C4 — hit");
  clock.t = 11;
  assertApprox(player.songTime(), 3.5, "после последнего гейта доигрывает до конца");
  player.update();
  assert(player.isFinished, "мелодия пройдена");
  assertApprox(player.score().hitPercent, 100, "все группы засчитаны — 100%");
  const leftCall = engine.calls[0];
  assert(leftCall !== undefined && leftCall.pitch === 48, "нота левой партии спланирована");
  assertApprox(leftCall?.timeSec ?? -1, 7.5, "нота левой партии прозвучала после открытия гейта");

  player.dispose();
  console.log("  OK: замерло/тронулось/ошибки не двигают/аккорд по одной ноте/финиш");
}

// --- 4. Планировщик: lookahead по аудио-часам, множитель, пауза ---

function testScheduler(): void {
  console.log("Планировщик:");
  const clock = new FakeClock();
  const engine = new MockEngine();
  const host = {
    audioTimeFor: (songTime: number): number | null => 100 + songTime / 0.5, // ×0.5
    wallDurationSec: (d: number): number => d / 0.5,
  };
  const scheduler = new Scheduler(clock, engine, host);
  scheduler.setNotes([note(48, 2, 0.5, "left"), note(50, 4, 0.5, "left")]);

  clock.t = 100;
  scheduler.tick();
  assertEqual(engine.calls.length, 0, "нота на +4 c стены вне окна lookahead");

  clock.t = 103.95; // горизонт 104.05 ≥ 104 (songTime 2 → стена 104)
  scheduler.tick();
  assertEqual(engine.calls.length, 1, "нота спланирована при входе в окно");
  const call = engine.calls[0];
  assertApprox(call?.timeSec ?? -1, 104, "точное абсолютное время на аудио-часах");
  assertApprox(call?.durationSec ?? -1, 1.0, "длительность в стене = песня / множитель");

  // Опоздавшая сверх LATE_SKIP не играется, курсор идёт дальше.
  clock.t = 110;
  scheduler.tick();
  assertEqual(engine.calls.length, 1, "безнадёжно опоздавшая нота пропущена");

  // Пауза: audioTimeFor = null → планирование останавливается.
  const paused = { audioTimeFor: (): number | null => null, wallDurationSec: (d: number): number => d };
  const scheduler2 = new Scheduler(clock, engine, paused);
  scheduler2.setNotes([note(48, 0)]);
  clock.t = 200;
  scheduler2.tick();
  assertEqual(engine.calls.length, 1, "на паузе/гейте ничего не планируется");
  assert(SCHEDULER_LOOKAHEAD_SEC === 0.1, "окно планирования 100 мс (ADR-002)");

  scheduler.dispose();
  scheduler2.dispose();
  console.log("  OK: lookahead 100 мс, абсолютные времена, длительность ×множитель, пауза");
}

// --- 5. Режимы партий и автоплей ---

function testParties(): void {
  console.log("Партии:");
  const clock = new FakeClock();
  const engine = new MockEngine();
  const player = new Player(clock, engine);
  const tick = (): void => schedulerOf(player).tick();
  const m = melody([note(60, 0, 0.5, "right"), note(62, 1, 0.5, "right"), note(48, 0, 0.5, "left"), note(50, 1, 0.5, "left")]);
  player.loadMelody(m);

  // Правая рука нажимается, левая — автопартия.
  player.setMode("learn");
  player.setHandMode("right");
  assert(player.isPlayableNote(m.notes[0] as Note) && !player.isPlayableNote(m.notes[2] as Note), "right: правая нажимается, левая — авто");
  clock.t = 100;
  player.start();
  clock.t = 100.2;
  tick();
  const pitches = engine.calls.map((c) => c.pitch);
  assert(pitches.every((p) => p < 60), "в right планируется только левая партия");
  assertEqual(pitches.filter((p) => p === 48).length, 1, "нота C3 левой спланирована один раз");

  // Обе руки — всё нажимается, автопартии нет.
  engine.calls.length = 0;
  player.setHandMode("both");
  assert(player.isPlayableNote(m.notes[3] as Note), "both: левая тоже нажимается");
  tick();
  assertEqual(engine.calls.length, 0, "both: автопартии нет");

  // Автоплей — всё играет компьютер.
  player.setMode("autoplay");
  clock.t = 100.95; // оставшиеся ноты (song 1 → стена 101) входят в окно lookahead
  tick();
  assertEqual(engine.calls.length, 2, "autoplay: оставшиеся ноты спланированы");
  assertEqual(player.onKeyPress(60), null, "autoplay: нажатия не судятся");

  // Свободная игра — нажимаемых партий не существует.
  player.setMode("free");
  assertEqual(player.isPlayableNote(m.notes[0] as Note), false, "free: партий не существует");
  player.dispose();
  console.log("  OK: right/both/autoplay/free — состав автопартии корректен");
}

async function main(): Promise<void> {
  testJudge();
  testSongTime();
  testWaitMode();
  testScheduler();
  testParties();
  console.log(`SMOKE OK: ${checks} проверок пройдено`);
}

try {
  await main();
} catch (error) {
  console.error("SMOKE FAIL:", error);
  throw error;
}
