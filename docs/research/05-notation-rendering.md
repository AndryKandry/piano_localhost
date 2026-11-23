# Research 05: Рендер нотной записи для «Азбуки» (Bravura/SMuFL vs VexFlow)

Дата: 2026-11-23. Роль: frontend-консилиум. Вопрос: чем рисовать карточки «Азбуки»
(нотный стан, скрипичный ключ, ноты с длительностями, паузы, тактовые черты, размер 4/4–3/4,
подсветка текущей ноты) на Canvas 2D + TypeScript без UI-фреймворков.

Метод: официальная спека SMuFL (скачана и проgrep-ана локально), метаданные шрифта Bravura
(`Bravura.json` из репозитория Steinberg), npm/jsdelivr/bundlephobia API, WebSearch-сниппеты.
Отмечено «не подтверждено» там, где первичной проверки не было.

## 1. Шрифт Bravura (SMuFL)

**Что это и кто делает.** Bravura — OpenType-шрифт для нотной записи, разработан Daniel Spreadbury
в Steinberg для нотного редактора Dorico; является **официальным референс-шрифтом стандарта
SMuFL (Standard Music Font Layout)**, спека которого развивается в W3C Music Notation CG.
Источники: [github.com/steinbergmedia/bravura](https://github.com/steinbergmedia/bravura),
[официальная спека SMuFL](https://w3c-cg.github.io/smufl/latest/) (переехала с `w3c.github.io/smufl` — редирект подтверждён).

**Лицензия.** SIL Open Font License 1.1, «Bravura» — Reserved Font Name ([LICENSE.txt](https://github.com/steinbergmedia/bravura/blob/master/LICENSE.txt)).
Бесплатно для коммерческого/некоммерческого использования, встраивания и модификации.
Вариант Bravura Text — та же OFL ([redist/bravura-text.md](https://github.com/steinbergmedia/bravura/blob/master/redist/bravura-text.md)).
В репозитории лежат `LICENSE.txt` и `OFL.txt` (подтверждено листингом `redist/` через GitHub API).

**Где взять (подтверждено листингом файлов):**

| Источник | Файл | Размер |
|---|---|---|
| GitHub `steinbergmedia/bravura` → `redist/woff/` | `Bravura.woff2` | **316 KB** (323 416 B) |
| там же | `Bravura.woff` | 414 KB |
| там же | `BravuraText.woff2` | 447 KB (для текстового набора) |
| npm **`@fontsource/bravura`@5.3.0** | `bravura-latin-400-normal.woff2` | **313 KB** + готовые `400.css`/`index.css` |

Fontsource — «Self-host the Bravura font in a neatly bundled NPM package» (npm-описание);
отдаётся и CDN-ами (jsdelivr/unpkg). Прямого npm-пакета `bravura` нет (npm view — пусто).

**Использование в Canvas 2D.** Стандартный путь (общая практика, прямой тест на проде — этап Validation):
1. `FontFace` API: `new FontFace('Bravura', 'url(Bravura.woff2)')` → `await font.load()` → `document.fonts.add(font)`.
2. `ctx.font = '48px Bravura'` + `ctx.fillText(String.fromCodePoint(0xE050), x, y)`.
3. Нюанс: все рабочие кодпоинты SMuFL лежат в BMP (U+E0xx), поэтому escape '\uE050' корректен;
   юникод-параллели вида U+1D11E — вне BMP, только `String.fromCodePoint`.

**Масштаб = размер шрифта.** Спека: «one staff space = 0.25 em»; «dividing the em in four provides
an analogue for a five-line staff» — т.е. **размер шрифта = высота стана (4 межлинейных)**:
межлинейное 12 px → `ctx.font = '48px Bravura'` (спека SMuFL, раздел о дизайне глифов).

**Регистрация глифов относительно baseline** (SMuFL spec, glyph registration — цитаты из спеки):
- глифы «для всего стана» (тактовые черты): «the font baseline lies at the nominal vertical
  position of the **bottom line** of a five-line staff»;
- головки/диезы: «a typical notehead or accidental glyph is registered such that it is
  **vertically centered on the baseline**» — baseline = вертикальная позиция той линии/промежутка,
  куда попадает нота;
- ключ: «the pitch the clef refers to is on the baseline» — G-ключ ставится на линию G4;
- цифры размера: «each digit is two staff spaces tall, i.e. 0.5 em, and vertically centered on the baseline»;
- паузы: baseline = их дефолтная позиция на стане, **кроме целой паузы** — «the whole note (semibreve)
  rest… should hang» (висит под 4-й линией — классика, спека это фиксирует как правило регистрации).

### 1.1. Кодпоинты нужных глифов (SMuFL, PUA)

Все кодпоинты ниже извлечены напрямую из официальных таблиц спеки
([print.html полной версии](https://w3c-cg.github.io/smufl/latest/print.html)); формат строк
спеки: «**U+E050** (and U+1D11E) *gClef* G clef». В скобках — параллельный кодпоинт из блока
Unicode Musical Symbols, если спека его указывает.

| Глиф | Имя SMuFL | Кодпоинт | Unicode-параллель |
|---|---|---|---|
| Скрипичный ключ | `gClef` | **U+E050** | (and U+1D11E) |
| Головка целой | `noteheadWhole` | **U+E0A2** | — |
| Головка половинной | `noteheadHalf` | **U+E0A3** | (and U+1D157) |
| Головка четверти/восьмой (заполненная) | `noteheadBlack` | **U+E0A4** | (and U+1D158) |
| Бревис (целая с чертой, на будущее) | `noteheadDoubleWhole` | U+E0A0 | — |
| Штиль (combining-глиф) | `stem` | U+E210 | (and U+1D165) |
| Флаг восьмой вверх/вниз | `flag8thUp` / `flag8thDown` | **U+E240** / U+E241 | (and U+1D16E) / — |
| Флаг шестнадцатой вверх | `flag16thUp` | U+E242 | (and U+1D16F*) |
| Пауза целая | `restWhole` | **U+E4E3** | (and U+1D13B) |
| Пауза половинная | `restHalf` | **U+E4E4** | (and U+1D13C) |
| Пауза четверть | `restQuarter` | **U+E4E5** | (and U+1D13D) |
| Пауза восьмая | `rest8th` | **U+E4E6** | (and U+1D13E) |
| Тактовая черта | `barlineSingle` | **U+E030** | (and U+1D100) |
| Двойная черта | `barlineDouble` | U+E031 | (and U+1D101) |
| Финальная черта | `barlineFinal` | U+E032 | (and U+1D102) |
| Цифра 3 размера | `timeSig3` | **U+E083** | — |
| Цифра 4 размера | `timeSig4` | **U+E084** | — |
| Цифры 0–9 | `timeSig0`…`timeSig9` | U+E080…U+E089 | — |
| Размер «C» / «¢» | `timeSigCommon` / `timeSigCutCommon` | U+E08A / U+E08B | (and U+1D134 / U+1D135) |
| Диез | `accidentalSharp` | **U+E262** | (and **U+266F**) |
| Бемоль | `accidentalFlat` | **U+E260** | (and **U+266D**) |
| Бекар | `accidentalNatural` | **U+E261** | (and **U+266E**) |
| Точка (дот) | `augmentationDot` | U+E1E7 | (and U+1D16D) |

\* — точный параллельный кодпоинт flag16thUp в выжимке не зафиксирован построчно; флаги восьмых
проверены точно.

**Штили: глифом или линией?** В SMuFL есть глиф `stem` (U+E210, «Combining stem»), но это
*combining*-глиф для спецслучаев. Общая практика нотных рендереров — рисовать штиль как линию
(прямоугольник) толщиной `stemThickness` из метаданных шрифта; длина глифом не задаётся.
**Не подтверждено** построчной цитатой из документации конкретных рендереров — но против «глифом»
и то, что длина штиля вообще отсутствует в `engravingDefaults` (см. раздел 5), и то, что глиф
назван combining. Для азбуки: штиль = `fillRect` шириной 0.12 пробела.

## 2. VexFlow

**Лицензия:** MIT (подтверждено: npm `vexflow` → `license = 'MIT'`; [vexflow.com](https://www.vexflow.com)).
**Стек:** TypeScript, вывод в **HTML Canvas и SVG** (npm-описание пакета). Текущая версия 5.9.0.
GitHub: [0xfe/vexflow](https://github.com/0xfe/vexflow).

**Вес (подтверждено bundlephobia API, vexflow@5.9.0):** **1 353 169 B минифицировано,
761 466 B gzip** — то есть ~1.35 MB / 761 KB gzip. npm `dist.unpackedSize` = 30.5 MB (все сборки).

**Шрифты встроены в JS.** Листинг пакета (jsdelivr API): `build/esm/src/fonts/bravura.js`,
`gonville.js`, `petaluma.js` — контуры глифов Bravura/Gonville/Petaluma **запечены в JS-модули**,
веб-шрифт загружать не нужно; вход `build/esm/entry/vexflow-bravura.js` — дефолтный бандл.
Отсюда и вес: outline-данные сотен глифов едут в JS.

**Одиночная нота / карточки.** API позволяет минимальный набор `Renderer` (backend CANVAS/SVG) →
`Stave` (ширина любая, нотный стан без вёрстки страницы) → `StaveNote` → отрисовка; подсветка —
через `setStyle`/`fillStyle` на конкретной ноте. Базовый пример из README: `Renderer`,
`renderer.getContext()`, `context.setFont('Arial', 10)` (README 0xfe/vexflow, строки 74–76).
Подробный API-путь для карточек (подсветка одной ноты, перекраска) в рамках этого research
**не прогонялся на тестах** — оценка «подходит» основана на структуре API README/docs-сниппетов.

**Verovio** — альтернативный веб-гравёр (MEI/MusicXML), упоминается в контексте SMuFL
([Verovio book, SMuFL fonts](https://book.verovio.org/advanced-topics/smufl.html)); для карточек
не рассматривался как кандидат (тот же класс «полноценной вёрстки нот»).

**Вес против «свой рендер + Bravura»:** VexFlow gzip 761 KB против Bravura woff2 316 KB
(сжатый ещё меньше, ~150–200 KB при типичном brotli — **не подтверждено**, оценка).
Для одной карточки с одной-тремя нотами VexFlow несёт движок вёрстки целых партитур,
который карточка не использует.

## 3. Юникод-символы U+1D100–1D1FF без Bravura

**Что есть.** Блок Unicode «Musical Symbols» U+1D100–U+1D1FF существует, и SMuFL-спека для многих
глифов указывает параллельные кодпоинты (см. таблицу 1.1): ключ U+1D11E, черты U+1D100–1D102,
паузы U+1D13B–1D13E, половинная/чёрная головки U+1D157/U+1D158, общее время U+1D134,
точка U+1D16D, штиль U+1D165 (combining), флаг U+1D16E (combining).

**Чем плохо (по источникам, первичного теста на macOS не ставилось — отмечено):**
1. **SMuFL-шрифты кодируют глифы в PUA (U+E000–U+F8FF).** Bravura Text docs: как набирать кодпоинт
   E050 через Alt+кейпад и предупреждение «if Bravura Text is not the selected font, you may see…
   missing glyph boxes» ([smufl.org/fonts/latest/bravuratext](https://www.smufl.org/fonts/latest/bravuratext) — по сниппету поиска).
2. **Покрытие U+1D1xx системными шрифтами ненадёжно:** сниппет-сводка поиска — браузер при
   отсутствии глифа уходит в системный фолбэк, итог — tofu (□) без установленного символьного
   шрифта (Windows: Segoe UI Symbol). Конкретное поведение macOS Safari/Chrome по блоку
   U+1D100–1D1FF **не подтверждено** (тест не запускался).
3. **Геометрии в блоке нет:** штиль и флаги существуют только как combining-глифы (U+1D165, U+1D16E);
   выносные линейки (ledger lines) как отдельный глиф в таблице параллелей отсутствуют. Ручная
   компоновка таких элементов на canvas — та же работа, что с SMuFL, но с непредсказуемым шрифтом.
4. alphaTab docs: «there are not many fonts beside Bravura» с полным покрытием SMuFL, и фолбэк-
   механизма нет ([alphatab.net, SMuFL font customization](https://alphatab.net/docs/cn/advanced-topics/smufl-font-customization) — по сниппету поиска).

**Где юникод безопасен:** диез/бемоль/бекар имеют параллели в широко поддерживаемом блоке
Miscellaneous Symbols — ♯ U+266F, ♭ U+266D, ♮ U+266E (спека прямо указывает эти параллели);
их можно использовать в текстовых подписях даже без Bravura.

**Вывод:** для продукта рендер U+1D1xx без специального шрифта не брать; опционально — декоративный
𝄞 в тексте, с осознанным риском tofu.

## 4. opensheetmusicdisplay для карточек — кратко

OSMD уже исследован и отвергнут для парсинга (ADR-003; research 02): сборка **1.4 MB min**,
README: «OSMD is a renderer, not a full interactive sheet music editor», «OSMD on its own does not
support playback». Для карточек те же возражения усиливаются:
- OSMD — надстройка **над VexFlow** («the missing link between MusicXML and VexFlow»): тянет тот же
  движок вёрстки + свой слой парсинга MusicXML, который карточке не нужен (упражнения свои);
- он рендерит «лист как документ» с автоматической раскладкой, а карточке нужны 1–3 такта,
  собственные координаты для подсветки/анимации и реакция на клавиатуру в реальном времени;
- вес несоразмерен: 1.4 MB min (OSMD) + VexFlow под ним против 316 KB шрифта.

## 5. Геометрия нотного стана

**Специфицируется в двух местах:**
1. **SMuFL spec** — эмер (em) и регистрация глифов (цитаты в разделе 1):
   межлинейное расстояние = 0.25 em; стан = 4 межлинейных = 1 em; цифры размера 0.5 em;
   целая пауза «висит» под линией; ключ ставится своей точкой отсчёта на referenced-линию.
   URL: [w3c-cg.github.io/smufl/latest](https://w3c-cg.github.io/smufl/latest/).
2. **`engravingDefaults` метаданных шрифта** — рекомендуемые толщины **в межлинейных**
   (спека: «all measurements expressed in staff spaces»). Значения взяты из
   [Bravura.json](https://github.com/steinbergmedia/bravura/blob/master/redist/Bravura.json)
   (скачан, распарсен):

| Ключ | Bravura | Смысл |
|---|---|---|
| `staffLineThickness` | **0.13** | толщина линии стана |
| `stemThickness` | **0.12** | толщина штиля |
| `beamThickness` | 0.5 | толщина ребра |
| `beamSpacing` | 0.25 | зазор между рёбрами |
| `legerLineThickness` | 0.16 | толщина выносной линейки («normally somewhat thicker than a staff line» — спека) |
| `legerLineExtension` | 0.4 | выступ выносной линейки за головку с каждой стороны |
| `thinBarlineThickness` | 0.16 | тонкая тактовая черта |
| `thickBarlineThickness` | 0.5 | толстая (финальная) черта |
| `barlineSeparation` | 0.4 | зазор между чертами двойной/финальной |

**Длина штиля ~3.5 межлинейных** — это **нотографическая практика, не SMuFL**: в
`engravingDefaults` ключа про длину штиля нет (подтверждено списком ключей Bravura.json).
Стандарт подтверждён поиском: MuseScore — «Stem length is almost completely standardized,
it needs to be exactly 3.5 spaces (an octave) in most cases» (форум MuseScore; настройка
Format → Style → Notes, дефолт 3.5); первоисточник практики — Elaine Gould, *Behind Bars:
The Definitive Guide to Music Notation* (Faber Music, 2011).
Направление штиля (ниже средней линии — вверх, выше — вниз) — та же практика
([MuseScore Handbook, Stems and flags](https://handbook.musescore.org/notation/rhythm-meter-and-measures/stems-and-flags)).

**Производные числа для азбуки** (если межлинейное = 12 px): стан 48 px; шрифт Bravura 48 px;
линия 1.56 px; штиль 1.44 px × 42 px (3.5 × 12) вверх/вниз от края головки; выносная линейка
1.92 px с выступом 4.8 px; головка ~12 px высотой (глиф U+E0A4 центрируется на baseline).

## 6. Выводы / рекомендация

**Рекомендация: свой лёгкий рендер на Canvas 2D + шрифт Bravura (SMuFL PUA-кодпоинты).**

1. **Вес:** Bravura woff2 = 316 KB (кэшируемый `FontFace`) против VexFlow 761 KB **gzip**
   JS-кода, который для карточки из 1–3 нот почти целиком мёртвый (движок раскладки партитур).
2. **Контроль подсветки:** карточке нужны покомпонентные координаты (головка, штиль, ключ) для
   подсветки/анимации текущей ноты; при своём рендере каждая координата известна заранее, у
   VexFlow для этого пришлось бы лезть во внутренности `StaveNote`-геометрии.
3. **Скоуп мал и закрыт:** ключ, 3 головки, 4 паузы, 2 цифры, черта, 2–3 флага, дот — ~15 глифов
   из таблицы 1.1; линии (стан, штили, выносные) — `fillRect`/`stroke` по `engravingDefaults`.
4. **Геометрия стандартизована** (раздел 5): em = стан, baseline-регистрация спеки,
   штиль 3.5 пробела по практике Gould/MuseScore.
5. **VexFlow — запасной путь**, если позже понадобится настоящая раскладка многотактовых
   упражнений/листов; тогда брать его целиком (глифы уже встроены, шрифт не нужен), а не гибридом.
6. **OSMD не брать** (раздел 4).
7. **Юникод-блок U+1D1xx без шрифта не использовать** (раздел 3); ♯/♭/♮ (U+266F/266D/266E) в
   тексте — можно.
8. На этапе Validation: фактическая загрузка `FontFace` Bravura и рендер карточки в Canvas на
   проде (включая Safari) — в этом research не прогонялось.

### Не подтверждено (честный список)
- поведение U+1D100–1D1FF в Safari/Chrome на macOS без спецшрифта (сниппеты говорят «ненадёжно», теста нет);
- точный вес brotli-сжатия Bravura.woff2;
- параллельный кодпоинт `flag16thUp` (таблица 1.1, сноска);
- детальный API-путь подсветки ноты в VexFlow (оценка по структуре README/API, не тестом);
- цитата «штили рисуют линией» из документации конкретного рендерера (вывод из отсутствия
  длины штиля в `engravingDefaults` + combining-природы глифа `stem`).

### Источники
- SMuFL spec (W3C Music Notation CG): https://w3c-cg.github.io/smufl/latest/ (полные таблицы глифов: https://w3c-cg.github.io/smufl/latest/print.html; старый адрес w3c.github.io/smufl редиректит)
- Bravura: https://github.com/steinbergmedia/bravura (LICENSE.txt = SIL OFL 1.1; redist/woff/Bravura.woff2 = 316 KB; redist/Bravura.json = engravingDefaults)
- @fontsource/bravura: https://www.npmjs.com/package/@fontsource/bravura (5.3.0, woff2 313 KB)
- VexFlow: https://www.vexflow.com , https://www.npmjs.com/package/vexflow , https://github.com/0xfe/vexflow (MIT; bundlephobia: 1.35 MB min / 761 KB gzip @5.9.0)
- Bravura Text intro: https://www.smufl.org/fonts/latest/bravuratext
- Verovio, SMuFL fonts: https://book.verovio.org/advanced-topics/smufl.html
- alphaTab, SMuFL font customization: https://alphatab.net/docs/cn/advanced-topics/smufl-font-customization
- MuseScore Handbook, Stems and flags: https://handbook.musescore.org/notation/rhythm-meter-and-measures/stems-and-flags
- Elaine Gould, Behind Bars (Faber Music, 2011) — нотографическая практика длины штиля
