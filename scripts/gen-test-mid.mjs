// Генератор тестового .mid для E2E импорта (ручно собранный SMF, как в smoke-import).
// Использование: node scripts/gen-test-mid.mjs /tmp/piano-e2e.mid
import { writeFileSync } from "node:fs";

const vlq = (value) => {
  const bytes = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes;
};
const chunk = (type, payload) => [
  ...[...type].map((c) => c.charCodeAt(0)),
  (payload.length >>> 24) & 0xff,
  (payload.length >>> 16) & 0xff,
  (payload.length >>> 8) & 0xff,
  payload.length & 0xff,
  ...payload,
];
const PPQ = 480;
const trackChunk = (events) =>
  chunk("MTrk", events.flatMap((e) => [...vlq(e.delta), ...e.bytes]));
const metaEvent = (type, data) => [0xff, type, data.length, ...data];
const noteOn = (p, v, ch) => [0x90 | ch, p, v];
const noteOff = (p, ch) => [0x80 | ch, p, 0];

// Трек: имя "Right Hand" → партия right (канал 0), 8 нот C4-мажор
const right = trackChunk([
  { delta: 0, bytes: metaEvent(0x03, [..."Right Hand"].map((c) => c.charCodeAt(0))) },
  { delta: 0, bytes: [0xff, 0x51, 0x03, 0x07, 0xa1, 0x20] }, // 120 BPM
  ...[60, 62, 64, 65, 67, 69, 71, 72].flatMap((p, i) => [
    { delta: i === 0 ? 0 : PPQ, bytes: noteOn(p, 100, 0) },
    { delta: PPQ / 2, bytes: noteOff(p, 0) },
  ]),
  { delta: PPQ, bytes: [0xff, 0x2f, 0x00] },
]);

const header = chunk("MThd", [0, 1, 0, 1, (PPQ >> 8) & 0xff, PPQ & 0xff]);
const bytes = new Uint8Array([...header, ...right]);
const out = process.argv[2] ?? "/tmp/piano-e2e.mid";
writeFileSync(out, bytes);
console.log(`written ${out} (${bytes.length} bytes)`);
