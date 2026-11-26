/**
 * Smoke-проверка слоя импорта и библиотеки без тестового фреймворка
 * (в духе smoke очереди 1). Запуск: npm run smoke:import.
 *
 * MIDI-файл собирается руками в байты (SMF: MThd + MTrk, meta-темп 0x51,
 * meta-размер 0x58), MusicXML — мини-строка; DOMParser в node подменяется
 * linkedom. Проверяются: питчи/времена/партии рук каскадом (имя → канал →
 * сплит), размер такта 0x58/<time> и дефолт 4/4 (PIANO-22), MusicXML
 * (divisions/темп/пауза/аккорд/staff), встроенная библиотека,
 * LibraryStore (list/get/setBest/addUserFile/remove, сниффинг).
 */
import { DOMParser } from "linkedom";

import { buildBuiltinMelody, parseNotesString, parsePitchName } from "../src/import/builtin";
import { parseMidi, pickSplitPoint } from "../src/import/midi";
import { ImportError } from "../src/import/shared";
import { parseMusicXml, pitchToMidi } from "../src/import/musicxml";
import { BUILTIN_SPECS } from "../src/library/builtin-data";
import { LibraryStore } from "../src/library/store";
import type { Melody } from "../src/core/types";

// linkedom: подмена глобального DOMParser до первого вызова parseMusicXml
// (код приложения читает глобал в момент вызова, не при загрузке модуля).
const globalStub = globalThis as unknown as Record<string, unknown>;
globalStub.DOMParser = DOMParser;

let checks = 0;
function assert(condition: boolean, message: string): void {
  checks += 1;
  if (!condition) throw new Error(`ПРОВАЛ: ${message}`);
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message} (ожидалось ${String(expected)}, получено ${String(actual)})`);
}
function assertApprox(actual: number, expected: number, message: string, eps = 1e-6): void {
  assert(Math.abs(actual - expected) < eps, `${message} (ожидалось ~${expected}, получено ${actual})`);
}
function assertRejects(fn: () => unknown, messagePart: string, message: string): void {
  try {
    fn();
    assert(false, `${message}: ошибки не было`);
  } catch (error) {
    assert(error instanceof ImportError, `${message}: не ImportError`);
    assert((error as Error).message.includes(messagePart), `${message}: текст «${(error as Error).message}» без «${messagePart}»`);
  }
}

// --- Генерация SMF-байтов вручную (research 02: MThd 6 байт, VLQ, FF 51 темп) ---

function vlq(value: number): number[] {
  const bytes = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes;
}

function chunk(type: string, payload: number[]): number[] {
  const header = [...type].map((c) => c.charCodeAt(0));
  const length = payload.length;
  return [
    ...header,
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...payload,
  ];
}

interface TrackEvent {
  delta: number;
  bytes: number[];
}

function trackChunk(events: TrackEvent[]): number[] {
  const payload: number[] = [];
  for (const event of events) payload.push(...vlq(event.delta), ...event.bytes);
  return chunk("MTrk", payload);
}

const PPQ = 480;
const TEMPO_120: number[] = [0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]; // 500000 µs = 120 BPM
const END_OF_TRACK: number[] = [0xff, 0x2f, 0x00];

function metaEvent(type: number, data: number[]): number[] {
  return [0xff, type, data.length, ...data];
}

function noteOn(pitch: number, velocity: number, channel: number): number[] {
  return [0x90 | channel, pitch, velocity];
}

function noteOff(pitch: number, channel: number): number[] {
  return [0x80 | channel, pitch, 0];
}

function midiFile(format: number, trackChunks: number[][]): ArrayBuffer {
  const count = trackChunks.length;
  const header = chunk("MThd", [
    (format >> 8) & 0xff,
    format & 0xff,
    (count >> 8) & 0xff,
    count & 0xff,
    (PPQ >> 8) & 0xff,
    PPQ & 0xff,
  ]);
  const bytes = [...header];
  for (const track of trackChunks) bytes.push(...track);
  return new Uint8Array(bytes).buffer;
}

// --- MIDI: имя трека → right ---

function namedTrackMidi(): ArrayBuffer {
  const conductor = trackChunk([
    { delta: 0, bytes: TEMPO_120 },
    { delta: 0, bytes: END_OF_TRACK },
  ]);
  const melody = trackChunk([
    { delta: 0, bytes: metaEvent(0x03, [..."Right Hand"].map((c) => c.charCodeAt(0))) },
    { delta: 0, bytes: noteOn(60, 100, 0) },
    { delta: 240, bytes: noteOff(60, 0) }, // четверть*0.5? 240 тиков = 0.25 c при 120 BPM
    { delta: 240, bytes: noteOn(64, 90, 0) },
    { delta: 480, bytes: noteOff(64, 0) },
    { delta: 0, bytes: END_OF_TRACK },
  ]);
  return midiFile(1, [conductor, melody]);
}

// --- MIDI: каналы 3/4 → left/right ---

function channelTracksMidi(): ArrayBuffer {
  const conductor = trackChunk([
    { delta: 0, bytes: TEMPO_120 },
    { delta: 0, bytes: END_OF_TRACK },
  ]);
  const left = trackChunk([
    { delta: 0, bytes: noteOn(48, 80, 3) },
    { delta: 480, bytes: noteOff(48, 3) },
    { delta: 0, bytes: noteOn(50, 80, 3) },
    { delta: 480, bytes: noteOff(50, 3) },
    { delta: 0, bytes: END_OF_TRACK },
  ]);
  const right = trackChunk([
    { delta: 0, bytes: noteOn(72, 90, 4) },
    { delta: 480, bytes: noteOff(72, 4) },
    { delta: 0, bytes: END_OF_TRACK },
  ]);
  return midiFile(1, [conductor, left, right]);
}

// --- MIDI: один трек, обе руки вперемешку → сплит по питчу ---

function mixedTrackMidi(): ArrayBuffer {
  const pitches = [40, 45, 48, 50, 55, 57, 60, 62, 64, 67, 69, 72];
  const events: TrackEvent[] = [{ delta: 0, bytes: TEMPO_120 }];
  for (const pitch of pitches) {
    events.push({ delta: 0, bytes: noteOn(pitch, 90, 0) });
    events.push({ delta: 480, bytes: noteOff(pitch, 0) });
  }
  events.push({ delta: 0, bytes: END_OF_TRACK });
  return midiFile(0, [trackChunk(events)]);
}

function emptyMidi(): ArrayBuffer {
  const track = trackChunk([
    { delta: 0, bytes: TEMPO_120 },
    { delta: 0, bytes: END_OF_TRACK },
  ]);
  return midiFile(0, [track]);
}

// --- MIDI: meta 0x58 (размер такта) → timeSignature мелодии (PIANO-22) ---

/** 3/4 в SMF-байтах: nn=3 доли, dd=2 → знаменатель 2^2=4; cc=24, bb=8 — служебные. */
const TIMESIG_3_4: number[] = [3, 2, 0x18, 0x08];

function timeSignatureMidi(withTimeSignature: boolean): ArrayBuffer {
  const conductor = trackChunk([
    { delta: 0, bytes: TEMPO_120 },
    ...(withTimeSignature ? [{ delta: 0, bytes: metaEvent(0x58, TIMESIG_3_4) }] : []),
    { delta: 0, bytes: END_OF_TRACK },
  ]);
  const melody = trackChunk([
    { delta: 0, bytes: noteOn(60, 100, 0) },
    { delta: 480, bytes: noteOff(60, 0) },
    { delta: 0, bytes: END_OF_TRACK },
  ]);
  return midiFile(1, [conductor, melody]);
}

const SCORE_PARTWISE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>Проверка XML</work-title></work>
  <identification><creator type="composer">Тестовый композитор</creator></identification>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
      <direction><sound tempo="90"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note>
      <note><rest/><duration>2</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>E</step><alter>-1</alter><octave>4</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note>
      <note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

const SCORE_TIMEWISE = `<?xml version="1.0" encoding="UTF-8"?>
<score-timewise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <measure number="1">
    <part id="P1">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><staff>2</staff></note>
    </part>
  </measure>
</score-timewise>`;

function findNote(melody: Melody, pitch: number): Melody["notes"][number] {
  const note = melody.notes.find((n) => n.pitch === pitch);
  assert(note !== undefined, `нота ${pitch} найдена`);
  return note as Melody["notes"][number];
}

// --- 1. MIDI ---

function testMidi(): void {
  console.log("MIDI:");
  const named = parseMidi(namedTrackMidi(), { fallbackTitle: "Тест" });
  assertEqual(named.notes.length, 2, "именованный трек: число нот");
  assert(named.notes.every((n) => n.handPart === "right"), "именованный трек: партия right по имени «Right Hand»");
  const c4 = findNote(named, 60);
  assertApprox(c4.startTimeSec, 0, "C4: старт 0 c");
  assertApprox(c4.durationSec, 0.25, "C4: длительность 0.25 c (240 тиков при 120 BPM)");
  const e4 = findNote(named, 64);
  assertApprox(e4.startTimeSec, 0.5, "E4: старт 0.5 c (480 тиков)");
  assertApprox(e4.durationSec, 0.5, "E4: длительность 0.5 c");
  assertEqual(named.tempoMap.length, 1, "темповая карта: одна точка");
  assertEqual(named.tempoMap[0].bpm, 120, "темп 120 из meta-события");
  assertApprox(e4.velocity, 90, "velocity 90 перенесена (0.709*127≈90)");
  assert(named.splitPoint === undefined, "splitPoint нет, когда руки определены именем");
  assertEqual(named.timeSignature.numerator, 4, "нет 0x58 → дефолт 4/4 (числитель)");
  assertEqual(named.timeSignature.denominator, 4, "нет 0x58 → дефолт 4/4 (знаменатель)");

  // Размер из meta 0x58: 3/4 в conductor-треке; без него — дефолт 4/4.
  const triple = parseMidi(timeSignatureMidi(true), { fallbackTitle: "Тест" });
  assertEqual(triple.timeSignature.numerator, 3, "0x58 nn=3 → числитель 3");
  assertEqual(triple.timeSignature.denominator, 4, "0x58 dd=2 → знаменатель 2^2=4");
  const plain = parseMidi(timeSignatureMidi(false));
  assertEqual(plain.timeSignature.numerator, 4, "MIDI без 0x58 → дефолт 4/4");
  assertEqual(plain.timeSignature.denominator, 4, "MIDI без 0x58 → дефолт 4/4");

  const channels = parseMidi(channelTracksMidi());
  assertEqual(channels.notes.length, 3, "каналы: число нот");
  assert(channels.notes.filter((n) => n.pitch < 60).every((n) => n.handPart === "left"), "канал 3 → left");
  assert(channels.notes.filter((n) => n.pitch >= 60).every((n) => n.handPart === "right"), "канал 4 → right");
  assert(channels.splitPoint === undefined, "splitPoint нет, когда руки определены каналом");

  const mixed = parseMidi(mixedTrackMidi());
  assertEqual(mixed.notes.length, 12, "сплит: число нот");
  assertEqual(mixed.splitPoint, 60, "сплит: порог по медиане = 60");
  assertEqual(pickSplitPoint([60, 61, 62]), 60, "сплит: мало нот → порог по умолчанию 60");
  for (const note of mixed.notes) {
    assertEqual(note.handPart, note.pitch < 60 ? "left" : "right", `сплит: нота ${note.pitch} в своей партии`);
  }

  assertRejects(() => parseMidi(emptyMidi()), "нет нот", "пустой MIDI даёт ошибку");
  assertRejects(() => parseMidi(new Uint8Array([1, 2, 3]).buffer), "не MIDI", "мусор даёт ошибку");
  console.log("  OK: каскад имя→канал→сплит, времена в секундах, темп, ошибки");
}

// --- 2. MusicXML ---

function testMusicXml(): void {
  console.log("MusicXML:");
  assertEqual(pitchToMidi("C", 0, 4), 60, "pitchToMidi C4");
  assertEqual(pitchToMidi("E", -1, 4), 63, "pitchToMidi Eb4");
  assertEqual(pitchToMidi("B", 0, 3), 59, "pitchToMidi B3");
  assertEqual(pitchToMidi("B", 1, 3), 60, "pitchToMidi B#3 (энгармонизм C4)");
  assertEqual(parsePitchName("Bb2"), 46, "DSL Bb2");
  assertEqual(parsePitchName("F#4"), 66, "DSL F#4");
  assertEqual(parseNotesString("C4 E4/0.5 R/1 F4+G4/2").length, 4, "DSL: аккорд и пауза");

  const partwise = parseMusicXml(SCORE_PARTWISE);
  assertEqual(partwise.notes.length, 4, "partwise: число нот (пауза пропущена, аккорд развёрнут)");
  assertEqual(partwise.title, "Проверка XML", "partwise: work-title");
  assertEqual(partwise.composer, "Тестовый композитор", "partwise: creator");
  const c4 = findNote(partwise, 60);
  assertApprox(c4.startTimeSec, 0, "partwise C4: старт 0");
  assertApprox(c4.durationSec, 2 / 3, "partwise C4: четверть = 2/3 c при 90 BPM");
  assertEqual(c4.handPart, "right", "partwise C4: staff 1 → right");
  const eb4 = findNote(partwise, 63);
  assertApprox(eb4.startTimeSec, 4 / 3, "partwise Eb4: C4+пауза подвинули курсор (4/3 c)");
  const g4 = findNote(partwise, 67);
  assertApprox(g4.startTimeSec, 4 / 3, "partwise G4: аккорд звучит одновременно");
  const g3 = findNote(partwise, 55);
  assertApprox(g3.startTimeSec, 2, "partwise G3: второй такт с 2 c (6 тиков по 1/3 c)");
  assertApprox(g3.durationSec, 4 / 3, "partwise G3: полтакта = 4/3 c");
  assertEqual(g3.handPart, "left", "partwise G3: staff 2 → left");
  assertEqual(partwise.tempoMap[0].bpm, 90, "partwise: темп из <sound tempo>");
  assertEqual(partwise.tempoMap[0].timeSec, 0, "partwise: темп с 0 c");
  assertEqual(partwise.timeSignature.numerator, 3, "partwise: <beats>3</beats> → числитель 3");
  assertEqual(partwise.timeSignature.denominator, 4, "partwise: <beat-type>4</beat-type> → знаменатель 4");

  const noTempo = parseMusicXml(SCORE_PARTWISE.replace('<direction><sound tempo="90"/></direction>', ""));
  assertEqual(noTempo.tempoMap[0].bpm, 120, "без темпа в файле — дефолт 120 BPM");

  const brokenTime = parseMusicXml(
    SCORE_PARTWISE.replace("<time><beats>3</beats><beat-type>4</beat-type></time>", "<time><beats>два</beats><beat-type>0</beat-type></time>"),
  );
  assertEqual(brokenTime.timeSignature.numerator, 4, "битый <time> → дефолт 4/4");
  assertEqual(brokenTime.timeSignature.denominator, 4, "битый <time> → дефолт 4/4");

  const timewise = parseMusicXml(SCORE_TIMEWISE);
  assertEqual(timewise.notes.length, 1, "timewise: число нот");
  const c5 = findNote(timewise, 72);
  assertApprox(c5.startTimeSec, 0, "timewise: старт 0");
  assertApprox(c5.durationSec, 2, "timewise: 4 divisions = 2 c при 120 BPM");
  assertEqual(c5.handPart, "left", "timewise: staff 2 → left");
  assertEqual(timewise.timeSignature.numerator, 4, "timewise: без <time> — дефолт 4/4");

  assertRejects(
    () => parseMusicXml("<html><body>не ноты</body></html>"),
    "не MusicXML",
    "чужой корень даёт ошибку",
  );
  assertRejects(
    () => parseMusicXml('<?xml version="1.0"?><score-partwise version="3.1"><part-list/></score-partwise>'),
    "нет нот",
    "MusicXML без нот даёт ошибку",
  );
  console.log("  OK: divisions/темп/пауза/аккорд/staff, partwise и timewise, ошибки");
}

// --- 3. Встроенная библиотека ---

function testBuiltins(): void {
  console.log("Встроенная библиотека:");
  assert(BUILTIN_SPECS.length >= 10, `мелодий ≥ 10 (сейчас ${BUILTIN_SPECS.length})`);
  const ids = new Set<string>();
  for (const spec of BUILTIN_SPECS) {
    const melody = buildBuiltinMelody(spec);
    ids.add(melody.id);
    assert(melody.notes.length > 0, `«${spec.title}»: есть ноты`);
    assert(melody.notes.every((n) => n.pitch >= 0 && n.pitch <= 127), `«${spec.title}»: питчи 0–127`);
    assert(melody.notes.every((n) => n.durationSec > 0), `«${spec.title}»: длительности положительные`);
    assert(melody.notes.every((n) => n.handPart === "left" || n.handPart === "right"), `«${spec.title}»: партии корректны`);
    assert(melody.notes.some((n) => n.handPart === "left") && melody.notes.some((n) => n.handPart === "right"), `«${spec.title}»: обе руки`);
    const sorted = [...melody.notes].every(
      (n, i, arr) => i === 0 || arr[i - 1].startTimeSec <= n.startTimeSec,
    );
    assert(sorted, `«${spec.title}»: ноты отсортированы по времени`);
    assert(melody.durationSec > 0, `«${spec.title}»: длительность положительная`);
    assertEqual(melody.tempoMap[0].bpm, spec.bpm, `«${spec.title}»: BPM из описания`);
    assertEqual(melody.timeSignature.numerator, 4, `«${spec.title}»: размер дефолт 4/4`);
    assertEqual(melody.timeSignature.denominator, 4, `«${spec.title}»: размер дефолт 4/4`);
    assert(melody.splitPoint === undefined, `«${spec.title}»: splitPoint не нужен (руки явные)`);
  }
  assertEqual(ids.size, BUILTIN_SPECS.length, "id встроенных мелодий уникальны");
  console.log(`  OK: ${BUILTIN_SPECS.length} мелодий, обе руки, инварианты нот`);
}

// --- 4. LibraryStore ---

async function testStore(): Promise<void> {
  console.log("LibraryStore:");
  const store = new LibraryStore();
  await store.ready();
  const list = store.list();
  assert(list.length >= 10, `список ≥ 10 записей (${list.length})`);
  assert(list.every((m) => m.source === "builtin" || m.source === "user"), "источники корректны");
  assert(list.every((m) => m.durationSec > 0), "длительности в метаданных");
  const ode = store.get("builtin:ode-to-joy");
  assert(ode.title.includes("Ода к радости"), "get(builtin:ode-to-joy) возвращает мелодию");
  assert(ode.notes.length >= 25, "Ода к радости: ноты мелодии + аккомпанемент");

  store.setBest("builtin:ode-to-joy", 87.5);
  assertEqual(store.list().find((m) => m.id === "builtin:ode-to-joy")?.bestScore, 87.5, "bestScore записан и виден в списке");
  assertRejects(() => store.setBest("builtin:ode-to-joy", 150), "Некорректный счёт", "bestScore > 100 отвергается");
  let removedBuiltin = false;
  try {
    await store.remove("builtin:ode-to-joy");
  } catch (error) {
    removedBuiltin = error instanceof ImportError;
  }
  assert(removedBuiltin, "remove встроенной мелодии запрещён");

  // addUserFile: сниффинг MIDI по 'MThd'.
  const midiMeta = await store.addUserFile(new File([namedTrackMidi()], "проверка.mid"));
  assert(midiMeta.id.startsWith("user:"), "user-мелодия получила user-id");
  assertEqual(midiMeta.source, "user", "источник user");
  assertEqual(midiMeta.title, "проверка", "заголовок из имени файла");
  assertEqual(store.get(midiMeta.id).notes.length, 2, "user-мелодия доступна через get");

  // addUserFile: сниффинг XML по корню score-partwise.
  const xmlMeta = await store.addUserFile(
    new File([new TextEncoder().encode(SCORE_PARTWISE)], "проверка.musicxml"),
  );
  assertEqual(store.get(xmlMeta.id).title, "Проверка XML", "XML-мелодия разобрана и сохранена");

  assertEqual(store.list().filter((m) => m.source === "user").length, 2, "в списке две user-записи");

  // Неизвестный формат → понятная ошибка.
  let sniffFailed = false;
  try {
    await store.addUserFile(new File([new TextEncoder().encode("мусор")], "файл.txt"));
  } catch (error) {
    sniffFailed = error instanceof ImportError && error.message.includes("не MIDI и не MusicXML");
  }
  assert(sniffFailed, "чужой формат даёт понятную ошибку");

  await store.remove(midiMeta.id);
  assert(store.list().every((m) => m.id !== midiMeta.id), "remove убрал user-мелодию из списка");
  assertRejects(() => store.get(midiMeta.id), "не найдена", "get удалённого даёт ошибку");
  console.log("  OK: list/get/addUserFile/setBest/remove, сниффинг MThd и XML");
}

async function main(): Promise<void> {
  testMidi();
  testMusicXml();
  testBuiltins();
  await testStore();
  console.log(`SMOKE OK: ${checks} проверок пройдено`);
}

try {
  await main();
} catch (error) {
  console.error("SMOKE FAIL:", error);
  throw error;
}
