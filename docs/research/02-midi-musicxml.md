# Research 02 — MIDI / MusicXML → внутренняя модель мелодии

Вопрос: как из MIDI/MusicXML получить `{pitch, startTime, duration, handPart, velocity}` + темп, и что для этого брать из библиотек.

Статус: в работе (заполняется по ходу research).

## 1. Формат MIDI-файла (SMF)

Источник: [MIDI.org — Standard MIDI Files Specification](https://midi.org/standard-midi-files-specification) + сводка поиска (2026-11-23).

**Структура — чанки.** Файл = один Header-чанк `MThd` + один или несколько Track-чанков `MTrk`. Каждый чанк: 4-символьный тип, 32-битная big-endian длина, данные.

**MThd — ровно 6 байт:**

| Offset | Размер | Поле |
|---|---|---|
| 8 | 2 | Format: 0, 1 или 2 |
| 10 | 2 | Число треков |
| 12 | 2 | Division = ticks per quarter note (PPQ/TPQ) |

- Division: бит 15 = 0 → биты 0–14 = тиков на четверть (типичные 480, 960); бит 15 = 1 → SMPTE-время. Ноль запрещён.
- **Format 0** — всё в одном треке (может быть несколько каналов); **Format 1** — партия = отдельные треки (для рук это ключевой случай); Format 2 — независимые треки (редкий).

**MTrk** = `MTrk` + длина + события. Три типа событий: MIDI channel events, Sysex (`F0`/`F7`), **meta-events (`FF`)**.

**Delta-time** — переменной длины (VLQ): до 4 байт по 7 бит, старший бит — признак продолжения. Это тики, не секунды.

**Tempo — meta-event `FF 51 03 tttttt`:** 3 байта = **микросекунды на четверть** (MPQN), big-endian. Формулы:
- `BPM = 60 000 000 / MPQN`; `MPQN = 60 000 000 / BPM`
- `микросекунд на тик = MPQN / PPQ`
- Пример `07 A1 20` → 500 000 µs → 120 BPM. **Если tempo-события нет — дефолт 120 BPM (500 000 µs).**
- Соседние: `FF 58 04` — размер такта, `FF 2F 00` — End of Track (обязателен).

**Почему темп в meta-событии трека, а не в заголовке.** В MThd нет поля темпа — это факт спецификации. Причина конструктивная: темп в MIDI — это **темп-карта (последовательность изменений во времени)**, а не одна константа файла. Meta-события привязаны к delta-time, поэтому `FF 51` может стоять в любой точке трека и менять скорость с этого момента; тик события задаёт момент смены. Синтезаторы MIDI (live) не имеют понятия «файл» — темп приходит как real-time сообщение `FF` (0xFF status) по ходу потока; SMF унаследовал тот же механизм: событие в потоке, а не атрибут заголовка. (Точная цитата спецификации midi.org по этому пункту не получена — fetch не прошёл; факт «темпа нет в MThd, формат события FF 51 03 — подтверждён». Для нашего приложения это не критично: парсер отдаёт tempo-карту готовой.)

## 2. @tonejs/midi — API и результат

Источники: npm-метаданные и содержимое пакета `@tonejs/midi@2.0.28` (README.md, d.ts, скомпилированный код) — прочитаны напрямую из tarball 2026-11-23. Npm/GitHub-страницы из этой среды не открылись (домен заблокирован), поэтому всё ниже — из самого пакета, что надёжнее README.

**Метаданные пакета:**
- Версия `2.0.28`, последняя публикация **2022-04-07** — стабилен, 4+ года без правок (зрелый, «заморожен в рабочем состоянии»).
- Описание: «Convert binary midi into JSON». Зависимости: `array-flatten`, `midi-file` (парсер байтов).
- Вес: UMD-бандл `build/Midi.js` = **32KB без минификации** (deps включены; подключается одним `<script src="unpkg.com/@tonejs/midi">` — README, стр. 29). unpacked-размер пакета целиком 287KB (там ещё src/ и maps).
- Типы TypeScript в комплекте (`.d.ts`) — можно верифицировать контракт без рантайма.

**API загрузки — ВАЖНОЕ УТОЧНЕНИЕ против изначального допущения:**
- `Midi.fromUrl(url): Promise<Midi>` — static, есть.
- `new Midi(midiArray?: ArrayLike<number> | ArrayBuffer)` — загрузка из байтов идёт **через конструктор**. **Методов `Midi.fromString` / `Midi.fromArrayBuffer` НЕ СУЩЕСТВУЕТ** (проверено по `dist/Midi.d.ts`). File → `await file.arrayBuffer()` → `new Midi(buf)`.

**Структура результата** (цитаты из README «Format» + d.ts):

```
header: { name, tempos: {ticks, bpm, time?}[], timeSignatures, keySignatures, ppq }
duration: number            // секунды до конца последней ноты
tracks: [{
  name, channel, instrument: {number, name, percussion},
  notes: [{
    midi,                    // 0-127, напр. 60
    time,                    // секунды — УЖЕ посчитаны из тиков по tempo-карте
    duration,                // секунды между noteOn и noteOff
    ticks, durationTicks,    // сырые тики тоже остаются
    velocity,                // нормализована 0-1
    name ("C4"), pitch, octave
  }],
  controlChanges,            // напр. [64] = sustain
  endOfTrackTicks
}]
```

- `track.channel` есть на треке; README: «channel … 9 and 10 are reserved for percussion».
- `header.ppq` — геттер «The number of ticks per quarter note» (в README фигурирует как `PPQ` — d.ts точнее).
- `header.setTempo(bpm)` — перезаписывает всю tempo-карту одним значением (для нас не нужно: наш множитель скорости живёт в плеере, не в файле).

## 3. Партия руки из MIDI

Источники: [PianoBooster issue #228](https://github.com/pianobooster/PianoBooster/issues/228), [Synthesia — Splitting the piano part](https://synthesiagame.com/support/guide/assignHands), [music.stackexchange 7725](https://music.stackexchange.com/questions/7725/is-there-any-algorithmic-way-to-split-a-piano-midi-into-left-and-right-hand-part), сводка поиска 2026-11-23.

**Единой конвенции НЕТ.** Встречающиеся варианты в порядке частоты:
1. **Format 1, рука = отдельный MIDI-трек** (иногда треки подписаны «Right Hand»/«Left Hand» — `track.name` в @tonejs/midi). Самый чистый случай.
2. **Историческая конвенция каналов: левая = канал 3, правая = канал 4** (PianoBooster #228). В @tonejs/midi `track.channel` доступен.
3. **Обе руки в одном треке** (Format 0, или запись с цифрового пианино «merged») — инфа о руках потеряна, только эвристики.

**Что делает Synthesia при одной партии «Piano two hands»:** НЕ угадывает автоматически — даёт инструмент **«Split From Here»**: пользователь кликает точку разделения между руками и подгоняет её вручную («click near the middle between the hands, adjust the split point until it looks accurate»). Т.е. ручной сплит по питчу — индустриальный ответ на неразрешимый случай.

**Эвристики автосплита (если обе руки в одном треке):**
- Порог по питчу (напр. среднее C или середина между кластерами низких/высоких нот) — просто, ломается на перекрестье рук. Важно: **перекрестья — не ошибка файла, а норма игры**, поэтому любая жёсткая граница по питчу даёт артефакты.
- Научный уровень: RNN (Hadjakos et al. 2019 «Detecting Hands in Piano MIDI Data»), HMM + Viterbi (Nakamura et al.) — вне скоупа веб-приложения.

**Вывод для проекта:** каскад — (1) треки с различимыми именами → маппинг; (2) один трек + каналы 3/4 → по каналам; (3) иначе сплит по питчу с границей по умолчанию + возможность ручной коррекции порога в UI. Случай «одна рука в файле» → вторая партия просто пустая.

## 4. MusicXML и JS-парсеры

Источник: сводка поиска по спецификации MusicXML ([musicxml.com tutorial](https://www.musicxml.com/musicxml/tutorial/structure-of-musicxml-files), [W3C schema note](https://www.w3.org/2021/06/musicxml40/musicxml-spec/note)) + пакет `opensheetmusicdisplay@3.0.0` из tarball.

**Отличия от MIDI:** MusicXML — нотная запись (нотация, такты, ключи, лига/запятая), а не поток событий. Время в **divisions** (тиков на четверть, аналог PPQ, объявляется в `<attributes>` каждого такта), а не в delta-times. Питч: `<pitch><step>D</step><alter>-1</alter><octave>4</octave></pitch>` — тонально-точный (ми-b vs ре# различимы), у MIDI питч один на обе orthography. Длительность в `<duration>` в divisions.

**Ключевое для «партии руки»: MusicXML кодирует руки ЯВНО**, в отличие от MIDI:
- Иерархия `score-partwise → part-list (score-part id="P1") → part → measure → note`.
- Обе руки одного фортепиано = обычно **одна `<part>`, две `<staff>`**: `<staff>1</staff>` = верхний нотоносец (правая), `<staff>2</staff>` = нижний (левая); на одном нотоносце руки различаются `<voice>`. ([документация MusicXML про staves/voices](https://www.musicxml.com/musicxml/tutorial/structure-of-musicxml-files))
- Разные по длине партии = отдельные `<part>`.

**Парсер opensheetmusicdisplay (OSMD):**
- Версия 3.0.0, **активно развивается** (последняя публикация 2026-11-21),.unpack 2.6MB, deps: `jszip`, `vexflow`.
- Вес бандла: `build/opensheetmusicdisplay.min.js` = **1.4MB** минифицированный — на порядок тяжелее @tonejs/midi.
- Цитата из README: «OpenSheetMusicDisplay renders MusicXML sheet music in the browser. It is the missing link between MusicXML and VexFlow»; «**OSMD is a renderer, not a full interactive sheet music editor**»; и прямо на картинке: «**OSMD on its own does not support playback**».

**Вывод для проекта:** OSMD — это движок отрисовки нотных листов, который нам не нужен: у нас падающие ноты, не грим нотной бумаги. Тащить 1.4MB ради парсинга — несоразмерно. MusicXML — хорошо структурированный XML: путь к модели «нота+время+длительность+партия» — свой экстрактор на `DOMParser`: пройтись по `part/measure/note`, взять `pitch` (step+alter+octave → MIDI-номер), `duration × divisions`, накопить смещение такта, руку взять из `<staff>` (1=правая, 2=левая). Отдельный лёгкий JS-парсер MusicXML «только в ноты» в этом research **не подтверждён** (не искался кандидатом с проверкой кода) — если такой найдётся, использовать его вместо самописного. Темп в MusicXML живёт в `<sound tempo="...">` / `<metronome>` — если файла нет, дефолт как у MIDI.

## 5. Ticks → секунды при tempo-изменениях

**Формула** (подтверждена кодом `@tonejs/midi/dist/Header.js`, строки 142–156 — процитировано дословно):

```js
// tempo = последний tempo-event с tempo.ticks <= ticks; tempoTime = его время в секундах
elapsedBeats = (ticks - tempo.ticks) / ppq;
seconds = tempoTime + (60 / tempo.bpm) * elapsedBeats;
// если tempo-событий нет вовсе: seconds = (60 / 120) * (ticks / ppq)  — дефолт 120 BPM
```

То есть секунда ноты = сумма кусков: каждый сегмент между сменами темпа вносит `длительность_в_долях × 60/bpm_этого_сегмента`. Обратно `secondsToTicks()` — тем же бинарным поиском по `tempos`.

**Готовое в @tonejs/midi — ДА, всё уже посчитано:**
- `note.time` и `note.duration` — **уже в секундах**, с учётом tempo-карты (Note.d.ts: «The time of the event in seconds», «The duration … in seconds»); `ticks`/`durationTicks` сохранены рядом.
- `header.tempos: {ticks, bpm, time?}[]` — карта темпов, `time` заполняется при `update()`.
- `header.ticksToSeconds(ticks)` / `header.secondsToTicks(s)` / `header.ticksToMeasures(ticks)` — публичные методы, если понадобится пересчёт.
- Следствие: **свой конвертер тиков писать не надо.** Для «множитель скорости» (0.25–1.0) достаточно умножать `note.time`/`note.duration` на коэффициент при планировании в аудио-часах — BPM файла не трогаем (инвариант глоссария).

## Вывод

1. **MIDI-парсер: `@tonejs/midi@2.0.28`.** 32KB unminified, TS-типы, стабилен с 2022. Загрузка: `new Midi(await file.arrayBuffer())` (статических `fromString`/`fromArrayBuffer` нет — только `fromUrl` и конструктор). Модель готова под наш домен: `track.channel/instrument/name` для партии руки, `notes[].midi/time/duration/velocity` в секундах.
2. **Внутренняя модель мелодии** — да, как в вопросе: `{pitch: midiNumber, startTimeSec, durationSec, handPart: 'right'|'left', velocity}` + `tempoMap`/`bpm`. Секунды брать прямо из `note.time/duration`; сырые тики хранить не обязательно. Множитель скорости — коэффициент плеера поверх секунд, файл не переписывать.
3. **Партия руки** — каскад: имя трека → канал (левая=3/правая=4) → дефолт-сплит по питчу + ручная коррекция порога (как в Synthesia «Split From Here»). Никогда не считать границу по питчу истиной в последней инстанции: перекрестья рук легитимны.
4. **MusicXML** — другой формат данных (нотация, divisions вместо delta-times), зато руки кодируются явно: `<staff>1/2` в одной part или отдельные part. **OSMD (1.4MB) не брать** — это рендерер нотных листов, playback сам не умеет, нам не нужно. Если MusicXML нужен — свой `DOMParser`-экстрактор (десятки строк, схема выше) или искать специализированный лёгкий парсер (не подтверждён этим research).

**Не подтверждено / осталось:**
- Дословная цитата midi.org о причине размещения темпа в meta-событии (домен заблокирован из среды). Факт размещения — подтверждён сводкой по спецификации; конструктивная причина (темп-карта во времени + унаследованный от live-синтезаторов механизм событий) помечена как аргументированное рассуждение, не цитата.
- Лёгкий специализированный JS-парсер MusicXML (только ноты, без рендера) — кандидат не проверялся.
