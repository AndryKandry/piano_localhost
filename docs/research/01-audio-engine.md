# Research 01: Аудио-движок (Web Audio, задержка, планировщик, сэмплы, либы)

Дата: 2026-11-23. Роль: architect (research).
Метод: WebSearch по сниппетам. WebFetch в этой сессии заблокирован сетевой политикой (ошибка верификации доменов у MDN/GitHub/html5rocks) — точные цитаты даны по сниппетам поисковой выдачи; прямое чтение первоисточников не выполнялось. Все URL указаны для последующей проверки.

Термины — по docs/GLOSSARY.md: аудио-часы, пресет (тембр), полифония, wait-mode, автоплей, октавный сдвиг.

---

## 1. Задержка Web Audio API (`latencyHint`, `baseLatency`, `outputLatency`)

**Факты (MDN, по сниппетам):**

- `new AudioContext({ latencyHint })` принимает ЛИБО строку из enum `AudioContextLatencyCategory`, ЛИБО **число — предпочтительную максимальную задержку в СЕКУНДАХ** (не мс). Источник: MDN AudioContextOptions (зеркало udn.realityripple.com/docs/Web/API/AudioContextOptions), https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext
- Семантика категорий:
  - `interactive` — «запрашивает минимальную задержку, которую даёт платформа»;
  - `balanced` — баланс между задержкой и энергопотреблением/стабильностью;
  - `playback` — приоритет беспрерывного воспроизведения, «меняет задержку на более глубокий буфер».
- `latencyHint` — **совет, не гарантия**: «hint is only advisory», реальную задержку смотреть в `baseLatency` после создания контекста. Пример из выдачи: Firefox при `playback` может дать `baseLatency` 0.003 c.
- `AudioContext.baseLatency` — double, **в секундах**, задержка прохождения буферов через граф в аудиоподсистему (0.01 = 10 мс). https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/baseLatency
- `AudioContext.outputLatency` — оценка задержки от контекста до аудиоустройства; тестировалась сторонними статьями именно на MacBook со встроенными динамиками (статья 2022 г., «Web Audio API outputLatency testing» — URL в выдаче не полный, помечено как вторичный след).

**Числа:** точные официальные таблицы мс по платформам не получены (web.dev/MDN целиком не открылись) — **не подтверждено**. По совокупности выдачи: Chrome/macOS при `interactive` типично ~5–15 мс (256–512 фреймов при 44.1/48 кГц) на `baseLatency`; полный round-trip (вход→выход) может быть заметно выше — этому посвящён открытый баг Chromium «Web Audio Round-trip Latency Higher Than Expected» (https://issues.chromium.org/40125311) и утилита gilpanal/weblatencytest.

**Достаточно ли < 30–40 мс от нажатия до звука на macOS?**
- Для учебного тренажёра (не концертирующий инструмент) 20–40 мс — на грани комфортного; < 20 мс — комфортно. При `latencyHint: 'interactive'` и событии `keydown`, обрабатываемом немедленно (`AudioContext.currentTime`-планирование без JS-очередей в промежутке), на macOS бюджет обычно укладывается в ~10–25 мс: `baseLatency` (~5–15 мс) + обработчик ввода (единицы мс).
- Критично: (а) контекст создавать/resume по первому жесту пользователя (autoplay policy); (б) не ставить между `keydown` и планированием асинхронных буферов (rAF-очередь и т.п.); (в) декодировать сэмплы заранее (`decodeAudioData` до игры), а не в момент нажатия.

**Вывод:** да, Web Audio на macOS укладывается в < 30–40 мс (обычно < 25 мс при `interactive`); порог достижим без AudioWorklet. Точные измерения для нашего приложения — первой задачей прототипа (замер `baseLatency + outputLatency` на целевом MacBook). Пометка: официальных порогов в мс по категориям в спеке НЕТ — только «as low as possible»-семантика.

---

## 2. Планировщик: lookahead-паттерн «A Tale of Two Clocks» (Chris Wilson)

Первотоисточник: Chris Wilson, «A Tale of Two Clocks», HTML5 Rocks, ныне https://web.dev/articles/audio-scheduling (подтверждено тремя независимыми вторичными источниками в выдаче; сама страница не открыта — WebFetch заблокирован).

**Суть паттерна:**
- Двое часов: JS-таймер (`setInterval`) — неточный, дрейфует и «душится» в фоновой вкладке; и аудио-часы (`AudioContext.currentTime`) — аппаратно точные.
- Решение: таймер **не играет звук**, а лишь опрашивает очередь раз в `timer = 25 мс`; всё, что попадает в окно `scheduleAheadTime = 0.1 c` (100 мс) вперёд от `currentTime`, планируется точными вызовами с абсолютным временем на аудио-часах.
- Числа из статьи (по сниппетам): **setInterval 25 мс, lookahead 100 мс**.
- Почему нельзя «сыграть сейчас» по `setTimeout(0)`: дрейф таймера + джиттер главного потока → слышимая неритмичность; при планировании на аудио-часах точность аппаратная.

Подтверждающие разборы: negabaro.com (lookahead scheduler, drift), polish-design.com.tw (audio clock + visual sync), CSDN (шаг-секвенсер на dual-clock).

**Вывод для PIANO:** паттерн обязателен для **автоплея и автопартии** (равномерный поток нот по аудио-часам; окно 100 мс при тике 25 мс — разумный дефолт, при баг-фиксе «нота должна прозвучать прямо сейчас» — играть немедленно в момент колбэка). Для **wait-mode** lookahead не нужен: нота звучит по факту нажатия физической клавиши. Визуализацию (падающие ноты, линия удара) рисовать от `currentTime` того же контекста — инвариант №2 глоссария (время — только аудио-часы) выполняется автоматически.

---

## 3. Сэмплы фортепиано: Salamander, Splendid Grand; форматы и лицензии

**Salamander Grand Piano (v3)**
- Автор сэмплов: Alexander Holm. Инструмент: Yamaha C5. Лицензия: **CC-BY-3.0** (свободное использование с атрибуцией). Источники: https://github.com/sfzinstruments/SalamanderGrandPiano , https://sfzinstruments.github.io/pianos/salamander
- Исходник: WAV 48 кГц / 24 бит, **~1.18 ГБ**, 16 velocity-слоёв. Для браузера напрямую непригоден.
- Производные: «Slender Salamander» (~300 МБ, фазовое выравнивание + кроссфейд velocity, https://sig-ex.com/2017/11/11/slender-salmander-grand-piano); SF2-банк 36 МиБ (freepats.zenvoid.org).
- **Браузерные нарезки Salamander в npm (готовый формат «по нотам»):**
  - `@audio-samples/piano-mp3-velocity15` — MP3, Salamander V3, **5.47 МБ** (jsDelivr);
  - `@audio-samples/piano-release` — OGG-сэмплы отпускания (release), **918.65 КБ**.
  Это подтверждает практику: mp3/ogg-файлы, разложенные по нотам (и при необходимости по velocity-слоям), подгружаются с CDN.

**Splendid Grand Piano**
- Страница sfzinstruments: рояль Steinway, записан AKAI, **public domain**, объём набора **77 МБ**. https://sfzinstruments.github.io/pianos/splendid_grand_piano (данные по сниппету; атрибуцию инструмента при внедрении перепроверить на самой странице).

**@tonejs/piano (tambien/Piano)**
- «Multisampled Piano implementation using Salamander Grand Piano Sounds»: до 16 velocity-уровней, сэмпл каждой третьей ноты (питч-интерполяция между ними). https://github.com/tambien/Piano

**Вывод:** лицензионно чистые варианты есть на любой бюджет веса: Salamander (CC-BY-3.0, атрибуция Alexander Holm; браузерные нарезки ~5–10 МБ MP3/OGG по нотам) или Splendid (public domain, ~77 МБ исходник, тоже нарезается). Для пресета «Фортепиано» стартовый вариант — браузерная нарезка Salamander c CDN/npm; атрибуцию CC-BY зафиксировать на экране «О проекте».

---

## 4. Tone.js vs голый Web Audio vs smplr

**Tone.js** (https://tonejs.github.io, https://github.com/Tonejs/Tone.js)
- Что даёт: `Transport` — «главный хронометр», единый глобальный транспорт (start/stop/pause), к которому синхронизируются инструменты через `sync()` + `triggerAttack/triggerRelease`; `PolySynth` — автоматическое создание/освобождение голосов (полифония из коробки); `Sampler` — «автоматически интерполирует между набором питч-сэмплов» (объект нота→URL); базовый класс `Instrument`. То есть Transport — это ровно наш планировщик + тактирование, уже написанный.
- Размер: точные КБ **не подтверждено** (bundlephobia-страницы в выдачу не попали, WebFetch заблокирован). Оценка по совокупности: порядка сотен КБ min / десятки КБ gzip; tree-shaking монолитной структуры исторически ограничен. Пометка: перед решением замерить сборку локально (`vite build` с tone в зависимости) — это дешёвый практический тест.
- Зрелость: v14/v15, обширные доки и примеры, де-факто стандарт Web Audio-фреймворков.

**smplr** (danigb, https://github.com/danigb/smplr; автор — также автор soundfont-player)
- «A collection of sampled instruments for Web Audio API ready to be used with no setup required»: из коробки `SplendidGrandPiano`, `DrumMachine` и др. — сэмплы подтягиваются с CDN (danigb.github.io — по вторичному источнику docs.rmhstudios.com, **не подтверждено** первоисточником; `baseUrl` переопределяется, см. проект piano-fx, который держит сэмплы у себя и получает через smplr).
- API: `start(note, {gain})` / `piano.stop()` / `stop(note)`, `volumeToGain` (маппинг MIDI-velocity → linear gain). Сам пакет — компактный загрузчик, полезная нагрузка (сэмплы) не входит в бандл.

**soundfont-player** (danigb, https://github.com/danigb/soundfont-player)
- Предшественник smplr: играет SoundFont-пресеты (наборы от MIDI.js / FluidR), API `gain` (0–1) и `stop(when)`. Компактный лоадер (оценка ~10 КБ, **не подтверждено**). Лицензия пакета — **не подтверждено** (проверить на npm перед внедрением). Даёт массу готовых пресетов (тембров) ценой «soundfont-ного» звучания.

**Сопоставление с нашим кейсом:**
- Нужны: сэмпловое фортепиано + синтезаторные пресеты (осцилляторы — пишутся на голом Web Audio в десятки строк), полифония, СВОЙ планировщик c wait-mode (которого в Tone.Transport нет — Transport предполагает непрерывный поток с BPM, а wait-mode — «стоп до нажатия»), точная привязка визуала к аудио-часам (инвариант глоссария).
- Tone.Transport решает задачу автоплея, но конфликтует с wait-mode и прячет аудио-часы за абстракцией; цена — заметный бандл. PolySynth нам почти не нужен: пресеты синтеза у нас свои, а сэмпловое фортепиано — это Sampler/смplr.
- smplr даёт главное, чего не хочется писать руками: загрузку/кэширование сэмплов по нотам, интерполяцию, stop с фейдом — при минимальном весе и нулевой привязке к чужому транспорту.

**Вывод:** для PIANO оптимум — **голый Web Audio как ядро + smplr для сэмпловых пресетов** (фортепиано и, при желании, другие тембры); синтезаторные пресеты — собственные осцилляторные голоса на Web Audio (полная управляемость, нулевая зависимость). Tone.js целиком не рекомендую: Transport дублирует наш планировщик и мешает wait-mode. Если прототип покажет, что писать собственный сэмпл-загрузчик дорого, Tone.Sampler — запасной вариант.

---

## 5. Note-off с сэмплами: sustain-педаль (Space) и отпускание клавиши

**Общий принцип (подтверждён практикой найденных либ):**
- Обрывать `AudioBufferSourceNode.stop()` «в лоб» нельзя — щелчок на срезе волны. Правильно: гейт через `GainNode` с рампой (exponentialRampToValueAtTime / setTargetAtTime) до нуля, и только потом `stop()` источника.
- Реализация в либах:
  - smplr/soundfont-player: у ноты опция `gain`, завершение — `stop(note)`/`stop(when)`; проект piano-fx на smplr фиксирует «fading within 0.6s» при release — т.е. фейд порядка 0.5–0.6 с (https://github.com/imlishiyuan/piano-fx/blob/main/README.md).
  - @tonejs/piano: готовая педаль — «Press and hold the pedal starting at the given time. While the pedal is down, notes scheduled after the time will be sustained and released once the pedal is [released]» (https://github.com/tambien/Piano). Плюс отдельные release-сэмплы (звук отпускания) — в экосистеме Salamander есть пакет `@audio-samples/piano-release`, OGG, 918 КБ.
- Каноническая семантика педали (подтверждена и VST-практикой, напр. hamlen/SustainPedalVST): ноты, отпущенные при зажатой педали, НЕ гасятся, а копятся в буфере hold-нот; при отпускании педали все hold-ноты получают release.

**Схема для PIANO (архитектурная, без кода продукта):**
- Реестр активных голосов: голос = {нота, GainNode, состояние: sounding | held-key | held-pedal}.
- `keydown` → старт сэмпла (gain по velocity).
- `keyup` → если педаль (Space) зажата → перевод голоса в held-pedal (звук продолжает естественное затухание сэмпла); иначе → release-рампа (~0.3–0.6 с) + stop источника после рампы.
- Space `keyup` (отпускание педали) → release-рампа всем held-pedal голосам.
- Повторное нажатие той же ноты → новый голос (репич), старый уходит в release — так делают сэмплеры; на реальном фортепиано повторное нажатие демпфирует прежний звук (можно гасить старый голос того же питча короткой рампой ~50–100 мс).
- Опционально позже: release-сэмплы (щум молоточка) поверх рампы — пакет @audio-samples/piano-release.

**Вывод:** note-off = GainNode-рампа, а не остановка сэмпла; педаль — буфер hold-нот с release при отпускании Space. У smplr примитивы для этого есть (`stop` с фейдом, per-note gain), готовую педаль имеет только @tonejs/piano (но он тянет Tone.js — см. п. 4).

---

## Итоговая рекомендация стека

1. **Ядро звука — голый Web Audio API**: `AudioContext({latencyHint:'interactive'})`, decodeAudioData заранее, планирование на аудио-часах (инвариант №2 глоссария).
2. **Планировщик — lookahead по «A Tale of Two Clocks»** (тик 25 мс, окно 100 мс) для автоплея/автопартии; wait-mode играет по нажатию без lookahead.
3. **Сэмплы — Salamander Grand Piano (CC-BY-3.0, атрибуция Alexander Holm)** браузерной нарезкой (npm `@audio-samples/*`, ~5–10 МБ MP3/OGG по нотам) через **smplr**; запасной вариант — Splendid (public domain).
4. **Синтезаторные пресеты — собственные осцилляторные голоса** на Web Audio; Tone.js не тянем (Transport конфликтует с wait-mode, вес не оправдан).
5. **Note-off/педаль** — реестр голосов + GainNode-рампы (0.3–0.6 с), педаль Space = буфер hold-нот.

## Открытые пункты (не подтверждено — проверить при прототипе)

- Точные мс `baseLatency`/`outputLatency` на целевом MacBook (замер скриптом).
- Реальный размер бандла tone vs smplr (локальная сборка; bundlephobia в выдачу не попал).
- Лицензия npm-пакета soundfont-player; подтверждение, что smplr подгружает сэмплы с danigb.github.io и состав его инструментов (README GitHub не открылся).
- Наличие Salamander-инструмента непосредственно в smplr (подтверждён только SplendidGrandPiano).

## Источники

- MDN AudioContext / AudioContextOptions / baseLatency: https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext ; https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/baseLatency
- Chris Wilson, A Tale of Two Clocks: https://web.dev/articles/audio-scheduling (разборы: https://www.negabaro.com/en/blog/javascript/web-audio-lookahead-scheduler ; https://polish-design.com.tw/en/note-web-audio-step-sequencer-clock)
- Chromium round-trip latency: https://issues.chromium.org/40125311 ; https://github.com/gilpanal/weblatencytest
- Salamander: https://github.com/sfzinstruments/SalamanderGrandPiano ; https://sfzinstruments.github.io/pianos/salamander ; https://sig-ex.com/2017/11/11/slender-salmander-grand-piano
- Splendid: https://sfzinstruments.github.io/pianos/splendid_grand_piano
- Нарезки Salamander в npm: https://www.jsdelivr.com/package/npm/@audio-samples/piano-mp3-velocity15 ; @audio-samples/piano-release
- smplr: https://github.com/danigb/smplr ; soundfont-player: https://github.com/danigb/soundfont-player/blob/master/README.md
- Tone.js: https://tonejs.github.io ; docs/r13/Sampler ; docs/14.7.34 (PolySynth, Transport, Instrument)
- @tonejs/piano: https://github.com/tambien/Piano
- piano-fx (smplr, фейд 0.6 c, свой baseUrl): https://github.com/imlishiyuan/piano-fx/blob/main/README.md
