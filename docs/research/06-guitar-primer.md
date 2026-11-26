# Research 06: Гитарный раздел «Азбуки» — строй, педагогика, тренажёры, табы vs стан

Дата: 2026-11-26. Роль: research-агент консилиума. Вопрос: как научить игрока читать ноты
ДЛЯ ГИТАРЫ в веб-приложении (игрок тренируется на клавиатуре роя; живая гитара — у него).

Метод: WebSearch (9 запросов) + WebFetch — **точечные WebFetch заблокированы** (домен-верификация
не прошла для douglasniedt.com, classicalguitarcorner.com, hubguitar.com: «Unable to verify if
domain is safe to fetch»). Поэтому все цитаты — из сниппетов поисковой выдачи, помечено «сниппет».
Отмечено «не подтверждено» там, где первичной проверки не было.

## 1. Строй и соответствие нот (MIDI)

**Стандартный строй подтверждён** (сниппеты midi-calculator.com, inspure.com, kn0wl3dge.com и
практика TAB→MIDI конвертеров):

| Струна | Нота | MIDI | Частота | Интервал к предыдущей |
|---|---|---|---|---|
| 6 (нижняя, low E) | E2 | **40** | 82.41 Hz | — |
| 5 | A2 | **45** | 110.00 Hz | +5 |
| 4 | D3 | **50** | 146.83 Hz | +5 |
| 3 | G3 | **55** | 196.00 Hz | +5 |
| 2 | B3 | **59** | 246.94 Hz | +4 |
| 1 (верхняя, high E) | E4 | **64** | 329.63 Hz | +5 |

Строй = четыре чистых кварты (по 5 полутонов) с одной большой терцией (4 полутона) между 3-й и 2-й
струнами — асимметрия терции важна для логики грифа.
Базовая формула MIDI: `n = 69 + 12·log₂(f/440)`, A4 = 69, C4 = 60 — совпадает с нашим глоссарием.

**Формула лада подтверждена** (практика TAB→MIDI конвертеров, сниппет): таблица вида
`STRING_MIDI_OFFSETS = {6: 40, 5: 45, 4: 50, 3: 55, 2: 59, 1: 64}`, нота на ладу f струны s =
`open_midi(s) + f`. music21 (Python) строит стандартную гитару так же: `instrument.Guitar()`,
открытые струны 40–64 (сниппет).

### Критичный факт: гитара — транспонирующий инструмент (октава ВНИЗ)

**«Music for guitar is written one octave higher than the pitch it actually plays»** (сниппет
Wikipedia: [Clef](https://en.wikipedia.org/wiki/Clef), [Guitar](https://en.wikipedia.org/wiki/Guitar),
[Scientific pitch notation](https://en.wikipedia.org/wiki/Scientific_pitch_notation); учебник
[Fundamentals, Function, and Form, Milne Publishing/SUNY Geneseo](https://milnepublishing.geneseo.edu/fundamentals-function-form/)).

- Записывается гитара в **скрипичном ключе**; некоторые издательства добавляют маленькую «8»
  под ключом («octave treble clef»), но **чаще всего «8» НЕ пишут** — октаву просто подразумевают.
- Зачем: в басовом ключе «истинные» высоты ушли бы почти целиком под стан с кучей добавочных
  линеек; скрипичный ключ на октаву выше держит диапазон на стане (исторически — экономия
  линий/бумаги, конвенция тянется от печатных табулатур XVI века).
- Аналоги: контрабас (тоже звучит октавой ниже записи), тенор (ключ с «8»).

**Следствия для PIANO** (позиции на стане пересчитаны по правилам чтения стана — наш рендер
уже умеет добавочные линейки):

| Открытая струна | Звучит (MIDI) | **Записана как** | Позиция на стане (скрипичный ключ) |
|---|---|---|---|
| 1 | E4 = 64 | **E5** | 4-й промежуток (верхний) |
| 2 | B3 = 59 | **B4** | 3-я линия (средняя) |
| 3 | G3 = 55 | **G4** | 2-я линия |
| 4 | D3 = 50 | **D4** | промежуток под нижней линией |
| 5 | A2 = 45 | **A3** | 2-я добавочная линейка снизу |
| 6 | E2 = 40 | **E3** | промежуток под 3-й добавочной линейкой |

**Вывод.** Азбука для гитары переиспользует наш стан без изменений: вопрос показывается в
ЗАПИСАННОЙ высоте, ответ на роя — записанная высота (та же клавиша, что и сейчас; судья,
геометрия, прогресс не трогаем). Расхождение появляется только в воспроизведении: чтобы звучать
«как настоящая гитара», сэмплу надо отдавать `midi − 12` (звучащая высота). Решение для тикета:
хранить `writtenMidi` (ответ/рендер) и `soundingMidi = writtenMidi − 12` (аудио).

## 2. Педагогика чтения нот для гитары

### Классические школы (все учат читать стан, начиная с I позиции)

**Frederick Noad, «Solo Guitar Playing», Book 1** (4-е изд., стандарт самоучителя):
программа университетского курса ([UTD syllabus](https://dox.utdallas.edu/syl108664), сниппет):
> «Begin learning the natural notes in the first position of the guitar **from the first down to
> the sixth string**» — натуральные ноты I позиции учат **по струнам сверху вниз**, начиная с 1-й
> (верхней) E, потом 2-я B и т.д.; затем диезы/бемоли и ключевые знаки.

Noad Book 2 (сниппет Scribd/reddit): **«the position is always identified by the location of the
first finger»** — определение позиции: позиция = лад, в котором стоит 1-й палец. → I позиция =
1-й палец на I ладу, доступны лады 0–4 (открытые струны + I–IV лады).

**Christopher Parkening, «Guitar Method Vol. 1»** (Hal Leonard; сниппеты листингов/reddit
[r/classicalguitar](https://www.reddit.com/r/classicalguitar/comments/napdhz/used_parkenings_method_volume_1_to_finally_learn)):
«rudiments of classical technique, **note reading** and music theory… pieces, exercises and duets».
Используется взрослыми именно «чтобы наконец научиться читать» — чтение с I позиции.

**Aaron Shearer, «Classic Guitar Technique» / «The Shearer Method»**: бесплатные 25 стр. превью
Book 1 ([aaronshearerfoundation.org, PDF](https://www.aaronshearerfoundation.org/wp-content/uploads/2022/09/Shearer-Method-Book-I-preview.pdf));
обзоры Books 1–4 — [thisisclassicalguitar.com](https://www.thisisclassicalguitar.com/shearer-guitar-method-books-1-4).
Shearer — самый «методичный» из классиков (дробление навыка, именование нот вслух).

**Bradford Werner, «Classical Guitar Method Book 1»** — бесплатный 102-стр. PDF
([thisisclassicalguitar.com](https://www.thisisclassicalguitar.com/free-classical-guitar-method-book-pdf)):
«for absolute beginners or guitarists **learning to read music for the first time**».

### Общий порядок (совпадает у всех школ)

1. **Открытые струны** — запомнить имена E-A-D-G-B-E («Mel Bay-style "one string at a time"»,
   сниппеты [GuitarTricks](https://www.guitartricks.com/blog/the-easiest-guitar-notes-for-beginners), TrueFire).
2. **Ноты 1-й струны**: E (открытая), F (I лад), G (III лад) — читаются как E5, F5, G5 на стане.
3. **2-я струна**: B (откр.), C (I), D (III) → B4, C5, D5. И далее вниз: 3-я (G4, A4),
   4-я (D4, E4, F4), 5-я (A3, B3, C4), 6-я (E3, F3, G3).
4. Ноты **именованием вслух / пропеванием** при каждом извлечении (все школы).
5. После I позиции — II, V, VII позиции и «прижатые» лады выше (Noad Book 2; точная
   последовательность позиций между школами расходится — **не подтверждено** в деталях).

**Когда прижатые лады vs открытые:** прижатые лады вводятся СРАЗУ внутри каждой струны
(например, 1-я струна = E откр. + F на I + G на III), а не отдельным этапом после всех открытых.
Отдельный этап — не лады, а **новые позиции** (за пределы ладов 0–4).

### Ближайший аналог нашему приложению: Douglas Niedt «Ultimate Note Recognition Trainer»

[douglasniedt.com](https://douglasniedt.com/ultimate-note-recognition-trainer.html) (сниппеты,
WebFetch заблокирован): бесплатный курс + **десять браузерных тренажёров**; учит «recognize the
notes **on, above, and below the musical staff**»; заявленное отличие — «teaches the names of the
notes on the fretboard **AND makes the connection to what each note looks like on the musical
staff**». Порядок: сначала основы нотации → письменные упражнения → тренажёры (100+ упражнений).
Компаньон «Ultimate Fretboard Trainer» строит знание грифа от **шести опорных точек**.

**Вывод.** Наша механика «карточка: нота на стане → ответ клавишей» совпадает с нишей Niedt/
musictheory.net; для гитарного раздела порядок уроков берём классический: открытые струны →
струны 1→6 внутри I позиции (по 2–3 ноты на струну) → затем остальные элементы.

## 3. Как показывают в тренажёрах

| Тренажёр | Стан | Табы | Гриф-диаграмма | Что одновременно |
|---|---|---|---|---|
| [Songsterr](https://www.songsterr.com) | нет (только табы; не подтверждено, что есть вид со станом) | 6 линий, верхняя = high E; цифра = лад; 0 = открытая | нет | вертикальный курсор-«каретка» едет слева направо (piano-roll/Guitar Hero-стиль), автоскролл, loop, tempo, «Solo» (звук трека глушится, курсор едет) |
| [Yousician](https://help.yousician.com) (сниппеты) | **да, обычный стан** | свой вид: цифры падают по струнам к «hit line» | **да**: цветной гриф внизу экрана, цветные точки = пальцы | стан + падающие ноты + гриф ОДНОВРЕМЕННО; кружки летят к линии, зелёный/красный результат; слушает через микрофон |
| [Fender Play](https://www.fender.com/play) (сниппеты [Google Play](https://play.google.com/store/apps/details?id=com.fender.play), [App Store](https://apps.apple.com/us/app/fender-play-learn-guitar/id1226057939)) | **стан не показан** (осознанно) | скроллящиеся табы — основной способ чтения; отдельный урок «Read Tablature» | да: аккордовые диаграммы (сетка грифа) | видео + табы + диаграммы; split-screen «руки + графика» |
| [musictheory.net — Fretboard Note Identification](https://www.musictheory.net/exercises/fretboard) (сниппет) | **да: нота на стане — вопрос** | нет | **да: гриф — ответ** (клик по струне/ладу) | **настройки: ограничить диапазон ладов и струн, выбор ключа** — closest analog нашему «Азбуке наоборот» |
| [Douglas Niedt trainers](https://douglasniedt.com/ultimate-note-recognition-trainer.html) (сниппеты) | да (вопрос на стане) | нет | да (ответ на грифе) | 10 тренажёров по областям стана «on, above, below staff» |
| [StringKick](https://www.stringkick.com/fretboard-note-trainer), [FaChords](https://www.fachords.com/tools/fretboard-trainer), [GuitarOrb](https://www.guitarorb.com/guitar-notes), [Fretonomy](https://www.fretonomy.com) (сниппеты) | не во всех | нет | да | «guided path»: сначала одна струна, потом больше; гриф-игры, у Fretonomy — приём с микрофона |

**Паттерны:**
1. **Ритм-игры** (Songsterr, Yousician) — курсор/падение нот во времени, табы или стан опционально.
2. **Квизы** (musictheory.net, Niedt, StringKick) — статичная карточка «нота на стане → укажи
   струну/лад на грифе» (или наоборот); ОБЯЗАТЕЛЬНО есть ограничение диапазона в настройках.
3. Одновременный показ «стан ↔ таб ↔ гриф» делает только Yousician; образовательные квизы
   держат **две** проекции (стан и гриф), табы не используют вовсе — табы в квизах избыточны,
   потому что гриф-диаграмма и есть «табы по вертикали».

**Вывод для PIANO.** Наш формат «Азбуки» (карточка + ответ) — паттерн №2. Для гитарного раздела:
вопрос = нота на станe (как сейчас), ответ = клавиша роя (как сейчас); третий слой —
**гриф-диаграмма как подсказка/объяснение** («эта записанная нота = 2-я струна, I лад»), а
таб-строка опциональна в уроках-объяснениях, не в карточках.

## 4. «Одна нота — много мест на грифе»: выбор позиции

**Корень проблемы** (сниппет
[Lessonface forum](https://www.lessonface.com/forums/guitar/126453-why-guitarists-are-notoriously-bad-reading-standard-notation)):
> «the same pitch appears in **multiple places on the fretboard**, giving guitar a *much* harder
> sight-reading learning curve than piano or most other instruments» — поэтому «guitarists are
> notoriously bad at reading standard notation».

**Де-факто стандарт v1 обучения — фиксированная I позиция:**
- Все классические методы (Noad, Parkening, Shearer, Werner) проводят новичка через натуральные
  ноты I позиции (лады 0–4) целиком, прежде чем двигать руку (см. §2).
- В тренажёрах это реализовано как **ограничение диапазона**: musictheory.net — «restrict the
  range of frets and strings used in the exercise» (настройки упражнения); Niedt — разбивка по
  областям стана; StringKick — «start with one string, then add more». То есть стандарт не
  «алгоритм выбора лада», а **жёсткий whitelist струн/ладов на уровень сложности**.

**Ключевой факт для нашей модели — в I позиции неоднозначность почти нулевая.** Натуральные ноты
I позиции (лады 0–4) покрывают записанный диапазон E3…G5. Проверка по формуле §1: среди натуральных
нот ровно **один** дубликат — записанная **B4** (2-я открытая = 3-я струна IV лад, обе звучат B3);
все остальные позиции на стане ↔ струна/лад взаимно однозначны. Школы дубликат снимают конвенцией:
в I позиции B играют на **открытой 2-й** (вариант 3.IV — сознательный цветовой приём, не для
новичка). (Таблица построена из формулы §1; соответствие — стандарт всех методов §2.)

| Записана | Струна.лад | | Записана | Струна.лад |
|---|---|---|---|---|
| E3 | 6 откр. | | A4 | 3.II |
| F3 | 6.I | | B4 | 2 откр. |
| G3 | 6.III | | C5 | 2.I |
| A3 | 5 откр. | | D5 | 2.III |
| B3 | 5.II | | E5 | 1 откр. |
| C4 | 5.III | | F5 | 1.I |
| D4 | 4 откр. | | G5 | 1.III |
| E4 | 4.II | | | |
| F4 | 4.III | | | |
| G4 | 3 откр. | | | |

(звучащая высота = записанная − 12: например записанная C4 = 5-я струна III лад = звучит C3 = MIDI 48.)

Значит для v1 **не нужен алгоритм «ближайший лад»** — достаточно карты «позиция на стане →
string.fret» I позиции (+ фиксированное правило для единственного дубликата B4: открытая 2-я).
Полная многозначность грифа («одна нота — много мест») проявится только при выходе за лады 0–4
(например, записанная E5 = 1-я открытая И 2-я V лад — но V лад уже вне I позиции).
Алгоритм выбора позиции — задача v2 (тикет-кандидат).

## 5. Табы vs стандартная нотация для новичка

**За табы** (сниппеты
[Pickup Music](https://www.pickupmusic.com/blog/guitar-tab-vs-sheet-music-which-is-best-for-you),
[musiciangoods.com](https://musiciangoods.com/en-us/blogs/guitar/guitar-tab-vs-standard-notation),
[Forbes Music](https://www.forbesmusic.com/learning-chronicles-guitar-tabs-vs-reading-music)):
- мгновенность — «you can play almost any song within minutes as a complete beginner»;
  критично для мотивации первых месяцев;
- табы показывают ГДЕ играть, не требуя знания имён нот;
- профессионалы могут делать карьеру без стана («Paul McCartney» — пример из дискуссий).

**За стан** ([privateguitarnyc.com](https://privateguitarnyc.com/blog/reading-standard-notation-guitar),
[r/classicalguitar «Benefits of Standard Notation Over Tabs»](https://www.reddit.com/r/classicalguitar/comments/ao1s7d/benefits_of_standard_notation_over_tabs),
Pickup Music, сниппеты):
- универсальный музыкальный язык: доступ ко всему репертуару, общение с другими музыкантами,
  связь с теорией/гармонией;
- **«you can genuinely sight-read standard notation… which simply isn't possible with TAB»** —
  по табам нельзя читать с листа незнакомую пьесу (нет длительностей: ритм надо знать заранее);
- стан заставляет знать ИМЕНА нот («forces you to know the names of the notes you're playing»);
- аппликатура субъективна: «TAB dictates *where*, notation lets *you* decide how» (r/classicalguitar).

**Честная оговорка педагогов:** гитарная кривая чтения стана объективно круче фортепианной
(многозначность грифа, Lessonface §4); «reading music» (расшифровка для разучивания) достижима
быстро, а «sight-reading» (беглое чтение с листа) — годы даже у упорных
([Classical Guitar Shed](https://classicalguitarshed.com/reading-music-vs-sight-reading), сниппет).
Отсюда компромисс «start with TAB, add notation gradually» в поп-сегменте (Fender Play так и
устроен: стан не даёт вообще).

**Связь с нашей целью:** игрок ХОЧЕТ читать ноты для гитары → мы осознанно на «классической»
стороне, и весь консилиум классических школ (Noad/Parkening/Shearer/Werner/Niedt) поддерживает
именно обучение стану с I позиции. Табы в нашем приложении — не конкуренты, а слой-подсказка:
гриф-диаграмма отвечает на «где на гитаре», стан учит «что это за нота». Роя при этом остаётся
честным измерителем «имени ноты» — то, чего у табов нет в принципе.

## 6. Выводы для тикетов PIANO

1. **Модель данных.** `string: 1..6, fret: 0..4` → `soundingMidi = OPEN_MIDI[string] + fret`
   (`OPEN_MIDI = {1:64, 2:59, 3:55, 4:50, 5:45, 6:40}`); `writtenMidi = soundingMidi + 12`
   (конвенция гитарной записи, §1). Роя-ответ судится по `writtenMidi` — вся механика Азбуки,
   судья и прогресс переиспользуются без изменений.
2. **Аудио.** Гитарный сэмпл играть на `soundingMidi` (звучащая высота = настоящая гитара),
   иначе гитарный тембр будет на октаву выше реального инструмента игрока.
3. **Порядок уроков (классика, §2):** открытые струны (E5, B4, G4, D4, A3, E3 — записанные!) →
   1-я струна (F5, G5) → 2-я (C5, D5) → 3-я (A4) → 4-я (E4, F4) → 5-я (B3, C4) → 6-я (F3, G3);
   ноты по струнам «сверху вниз», как у Noad. Диезы/бемоли — после натуральных.
4. **Новый UI-компонент: гриф-диаграмма** (вертикальный гриф, лады 0–4, точки на string.fret) —
   показывается как пояснение/подсказка на карточке; вопрос и ответ остаются «стан → роя».
   Таб-строка — опция для уроков-объяснений, не для карточек (квиз-тренажёры табы не используют, §3).
5. **Карта string.fret ↔ writtenMidi** для I позиции (§4) — статичный словарь; единственный
   дубликат B4 резолвится в «2-я открытая».
6. **Не подтверждено / v2:** точная последовательность II/V/VII позиций между школами; вид со
   станом у Songsterr; алгоритм выбора позиции для произвольного MIDI; нестандартные строи
   (drop D и пр.).

### Источники

- Строй/MIDI: сниппеты midi-calculator.com, inspure.com, kn0wl3dge.com, практика music21
  (`instrument.Guitar()`); Wikipedia [Scientific pitch notation](https://en.wikipedia.org/wiki/Scientific_pitch_notation).
- Октавная транспозиция: Wikipedia [Clef](https://en.wikipedia.org/wiki/Clef),
  [Guitar](https://en.wikipedia.org/wiki/Guitar); [Fundamentals, Function, and Form (Milne/SUNY)](https://milnepublishing.geneseo.edu/fundamentals-function-form/).
- Методики: [UTD syllabus Noad](https://dox.utdallas.edu/syl108664),
  [Shearer Method Book I preview PDF](https://www.aaronshearerfoundation.org/wp-content/uploads/2022/09/Shearer-Method-Book-I-preview.pdf),
  [Shearer Books 1–4 обзор](https://www.thisisclassicalguitar.com/shearer-guitar-method-books-1-4),
  [Werner free method](https://www.thisisclassicalguitar.com/free-classical-guitar-method-book-pdf),
  [Parkening Vol.1 reddit-отзыв](https://www.reddit.com/r/classicalguitar/comments/napdhz/used_parkenings_method_volume_1_to_finally_learn),
  [ClassicalGuitarCorner guide](https://www.classicalguitarcorner.com/how-to-read-guitar-sheet-music) (сниппет),
  [GuitarTricks easiest notes](https://www.guitartricks.com/blog/the-easiest-guitar-notes-for-beginners).
- Тренажёры: [musictheory.net fretboard](https://www.musictheory.net/exercises/fretboard),
  [Niedt Ultimate Trainer](https://douglasniedt.com/ultimate-note-recognition-trainer.html),
  Songsterr ([songsterr.com](https://www.songsterr.com)), [Yousician help](https://help.yousician.com),
  [Fender Play](https://www.fender.com/play) + [Google Play](https://play.google.com/store/apps/details?id=com.fender.play) + [App Store](https://apps.apple.com/us/app/fender-play-learn-guitar/id1226057939),
  [StringKick](https://www.stringkick.com/fretboard-note-trainer), [FaChords](https://www.fachords.com/tools/fretboard-trainer),
  [GuitarOrb](https://www.guitarorb.com/guitar-notes), [Fretonomy](https://www.fretonomy.com).
- Табы vs стан: [Pickup Music](https://www.pickupmusic.com/blog/guitar-tab-vs-sheet-music-which-is-best-for-you),
  [Lessonface forum](https://www.lessonface.com/forums/guitar/126453-why-guitarists-are-notoriously-bad-reading-standard-notation),
  [r/classicalguitar](https://www.reddit.com/r/classicalguitar/comments/ao1s7d/benefits_of_standard_notation_over_tabs),
  [hubGuitar](https://hubguitar.com/articles/tab-or-notation), [privateguitarnyc](https://privateguitarnyc.com/blog/reading-standard-notation-guitar),
  [musiciangoods](https://musiciangoods.com/en-us/blogs/guitar/guitar-tab-vs-standard-notation),
  [Classical Guitar Shed](https://classicalguitarshed.com/reading-music-vs-sight-reading),
  [Forbes Music](https://www.forbesmusic.com/learning-chronicles-guitar-tabs-vs-reading-music).
