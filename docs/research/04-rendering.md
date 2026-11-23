# Research 04 — Рендеринг: падающие ноты, экранная клавиатура, синхронизация

Вопрос: чем рисовать поток падающих нот (30–60 видимых нот @ 60fps) и как держать его в такте аудио-часам.

Метод: WebSearch + точечные WebFetch. Дата: 2026-11-23.

---

## Q1. Canvas 2D vs DOM/CSS transform vs WebGL

Статус: заполнено (взято из поисковой выборки; WebFetch до web.dev/MDN сетево заблокирован в этой сессии).

### Факты

1. **Конвейер рендера браузера** (web.dev, [Rendering performance](https://web.dev/articles/rendering-performance)): JavaScript → Style → Layout → Paint → Composite. Анимация геометрии (`top`/`left`/`width`/`height`) выполняет layout+paint **каждый кадр**; `transform` и `opacity` обслуживаются композитором на GPU без layout/paint.
2. **Бюджет кадра** (MDN, [Animation performance and frame rate](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Animation_performance_and_frame_rate)): при 60fps на кадр приходится **16.7 мс** на JS + style + layout + paint; JS реально получает ~10 мс из них.
3. **Цена DOM-анимации многих элементов** (обсуждения [Canvas vs DOM](https://www.reddit.com/r/html5/comments/2vnrvm/performance_of_the_canvas_vs_performance_of_the/), [SO: CSS vs canvas при перемещении изображения](https://stackoverflow.com/questions/4842872/performance-of-moving-image-on-web-page-via-css-vs-html5-canvas)): каждый двигающийся DOM-узел требует обновления свойств элемента и style recalc; canvas — один DOM-узел с immediate-mode перерисовкой. DOM держится на десятках–сотнях двигающихся узлов, дальше начинается дёрганье.
4. **Потолок Canvas 2D**: простые фигуры/спрайты через rAF — порядка **1 000–10 000 объектов @ 60fps** на типичном железе (бенчмарк частиц: падение FPS от ~1 700 объектов на чистом JS; [SO: particle rendering](https://stackoverflow.com/questions/13405063/maximixing-the-speed-of-particle-rendering-on-html5-canvas)); WebGL рекомендуют за пределами ~2 000–10 000 объектов ([SVG vs Canvas vs WebGL](https://www.svggenie.com/blog/svg-vs-canvas-vs-webgl-performance-2025)).
5. **Оптимизация canvas** (web.dev, [Improving HTML5 canvas performance](https://web.dev/articles/canvas-performance); MDN [Optimizing canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)): статичный фон рисовать один раз / на отдельном слое; offscreen-канвасы; слоение канвасов (статика + динамика); избегать субпиксельных координат.

### Вывод для PIANO

Наш максимум — **30–60 видимых нот** (прямоугольники с закруглением + подсветка) + линия удара + ~17 экранных клавиш. Это **на 1–2 порядка ниже лимитов Canvas 2D** (~1000+ объектов). Сравнение:

- **DOM/CSS transform**: технически потянет (каждая нота — div с `transform: translateY`), но: высота ноты меняется от длительности, wait-mode замирает/возобновляет, подсветка и партия руки меняют цвет/геометрию — для каждой ноты нужно обновлять содержимое, а не только transform → layout/paint возвращаются. Плюс 60 узлов в DOM + рассинхрон с аудио-часами, если анимировать CSS-анимацией (она не знает про `AudioContext.currentTime`).
- **WebGL/three.js**: нужен для 3D-клавиатуры, тысяч объектов, видео-экспорта. У нас 2D и десятки объектов — сложность (шейдеры, буферы, камера) не окупается.
- **Canvas 2D**: один узел, полный кадр за ~десятки `fillRect`, мгновенный wait-mode (просто не двигать кадр), естественная синхронизация с аудио-часами (позиция = функция времени, а не анимация «сама по себе»).

**Вывод: Canvas 2D с запасом ≥20× по нагрузке. WebGL не нужен.**

## Q2. Синхронизация rAF + AudioContext.currentTime

Статус: заполнено (взято из поисковой выборки).

### Факты

1. **Канонический источник** — Chris Wilson, «A Tale of Two Clocks» (перенесён на [web.dev/articles/audio-clock](https://web.dev/articles/audio-clock)): «*requestAnimationFrame() will give you the smoothest, most precise graphic and audio synchronization*» — читать `audioContext.currentTime` **внутри rAF-цикла**, а не брать `Date.now()`/`setTimeout`: JS-часы неточны и дают дёрганье. *(цитата из поисковой выборки)*
2. **Аудио-часы идут на такте аудиохардвара** — непрерывные, sample-accurate; `Date.now()`/`performance.now()` идут по системным часам и дрейфуют относительно фактического вывода звука (спека-дискуссия [WebAudio/web-audio-api#340 — Map AudioContext times to DOM timestamps](https://github.com/WebAudio/web-audio-api/issues/340)).
3. **Паттерн «позиция = f(now.currentTime)»**: в каждом rAF-кадре вычислять `elapsed = ctx.currentTime − t0` и **заново считать позицию каждой ноты** из её (момент, длительность), а не инкрементировать смещение «+v·dt» — инкремент накапливает дрейф против звука. Пауза/возобновление (в т.ч. wait-mode) естественны: `t0` сдвигается на время паузы ([SO: Latency issue — sync audio beeps](https://stackoverflow.com/questions/78858905/latency-issue-how-to-perfectly-sync-audio-beeps-using-web-audio-api-and-visu)).
4. **Продвинутые реализации** калибруют `AudioContext.currentTime` против `performance.now()` (интерполяция трёх часов: аудио-часы + performance.now() + таймстамп rAF — доклад «Near-Realtime Animations with Synchronized Audio», ClubEngine/Firefox). Для десктопного MacBook с нашим масштабом калибровка не требуется — аудио-часы читаются напрямую каждый кадр.
5. Согласуется с решением [01-audio-engine.md](01-audio-engine.md): lookahead-планировщик Wilson'а планирует звук вперёд по тому же `ctx.currentTime` — визуал, читающий те же часы каждый кадр, **не может разойтись со звуком по определению** (один источник истины, инвариант №2 из GLOSSARY).

### Как это ложится на сценарий PIANO

- `t_муз = (ctx.currentTime − t0) × множитель_скорости` — музыкальное время; множитель 0.25–1.0 меняет только коэффициент, часы те же.
- Позиция ноты над линией удара: `y = y_линии − (moment_ноты − t_муз) × px_per_second` — чистая функция от аудио-часов, каждый кадр заново.
- **Wait-mode**: воспроизведение стоит → `ctx.currentTime` почти не идёт (или `t0` подменяется) → кадр статичен без спецлогики в рендере; нажатие сдвигает `t0`.
- Ноты для отрисовки отбираются окном `t_муз ± экранная_высота/px_per_second` — не перебор всех нот композиции.

**Вывод: rAF-цикл читает `AudioContext.currentTime` каждый кадр; позиция ноты — чистая функция времени, никаких инкрементов.**

## Q3. Open-source Synthesia-подобные web-проекты

Статус: заполнено (взято из поисковой выборки; README напрямую не читались — WebFetch до github.com заблокирован. Лицензии, не подтверждённые сниппетом, помечены «проверить в репо»).

| Проект | Платформа | Чем рендерит | Лицензия | URL |
|--------|-----------|--------------|----------|-----|
| **ekkx/notefall** — «Make piano videos from MIDI in the browser» | браузер | React + **three.js/WebGL** (3D-клавиатура, отражения), теги `webgl`, `threejs` | не подтверждена — проверить в репо | https://github.com/ekkx/notefall |
| **Bewelge/MIDIano** — «A JavaScript MIDI-Player», webapp, падающие полосы поверх клавиатуры | браузер | **canvas** (визуализация на канвасе) | не подтверждена — проверить в репо | https://github.com/Bewelge/MIDIano |
| **tzmcion/ReactPianoPlayer** — Web MIDI Player с визуализацией | браузер | **TypeScript + React** (DOM-клавиатура + визуализация) | **MIT** (подтверждено сниппетом) | https://github.com/tzmcion/ReactPianoPlayer |
| **imlishiyuan/piano-fx** — falling-notes с частицами, MP4-экспорт, «100% client-side» | браузер | **Vue 3 + Vite + Web Audio + WebCodecs** | не подтверждена — проверить в репо | https://github.com/imlishiyuan/piano-fx |
| **PolyMeilex/Neothesia** — «Flashy Synthesia Like Software» | **десктоп, не web** (референс) | **Rust + wgpu** (GPU-конвейер); в релизах правили «DPI scaling in the waterfall note renderer» | **GPL-3.0** (по сниппету «historically licensed under GPLv3»; форк Anonoei/ophthalmic — GPLv3, gin66/rusthesia — GPL-3.0-or-later) | https://github.com/PolyMeilex/Neothesia |

Дополнительные находки: [notwaldorf/midi-visualizer](https://github.com/notwaldorf/midi-visualizer) — web component; [Bbalduzz/keyfall](https://github.com/Bbalduzz/keyfall) — GLSL-шейдеры; [kosua20/MIDIVisualizer](https://github.com/kosua20/MIDIVisualizer) — OpenGL, десктоп. Коммерческие (не OSS): SeeMusic, Piano VFX Liquid, Synthesia.

### Вывод для PIANO

- Чёткое разделение в экосистеме: **2D-визуализация падающих нот = canvas** (MIDIano, piano-fx); **3D-«красивости» для YouTube-видео = three.js/WebGL** (notefall); **максимальный GPU = wgpu/shaders** (Neothesia, keyfall — десктоп/шейдеры).
- Ни один web-проект не рисует падающие ноты через DOM-анимации: DOM используют только для клавиатуры и обычного UI (ReactPianoPlayer).
- GPL-проекты (Neothesia) — только референс поведения, не источник кода. MIT-совместимые кандидаты для сверки идей: ReactPianoPlayer.

**Вывод: наш путь (2D canvas + rAF) — мейнстрим среди web Synthesia-подобных. WebGL в экосистеме появляется только ради 3D-видео, что не наш случай.**

## Q4. Раскладка экранных клавиш: фиксированная ширина vs фортепианная геометрия

Статус: заполнено (взято из поисковой выборки).

### Факты

1. **Реальная фортепианная геометрия**: 88 клавиш = 52 белые + 36 чёрные ([Piano Secrets — Piano Keyboard Layout](https://pianosecrets.com/piano-keyboard-layout)). Чёрные клавиши **уже и короче** белых; в веб-практике отношение ширины чёрной к белой берут **~0.58–0.7** (у реального инструмента ≈13.7 мм против 23.5 мм ≈ 0.58; популярный web-пример [Simple Piano Keyboard / sw1227](https://codepen.io/sw1227/pen/pXMPvm) использует «[Width] white : black = 1 : 0.7»).
2. **Web-практика раскладки** (та же выборка + [SO: flexible piano keyboard](https://stackoverflow.com/questions/58824958/how-to-create-a-completely-flexible-piano-keyboard-with-html-css)): белые — **равной ширины** (`flex: 1` или переменная `--white-key-width`), чёрные — **absolute поверх** на границах белых. Т.е. все берут «равные белые + фортепианная ширина/высота чёрных», а не точную геометрию рояля с разными белыми.
3. **Главная гоча**: чёрные не образуют равномерную сетку — группы 2 и 3 (C♯/D♯ сидят между 3 белыми, F♯/G♯/A♯ — между 4); позиции чёрных считаются от границ белых клавиш, отсюда типичная ошибка «чёрные разной ширины в разных октавах» при чистом flexbox.
4. **Synthesia-подобные рендеры** (из описаний найденных проектов Q3): колонка нот выравнивается по клавише, для чёрных — по центру чёрной клавиши; ширина колонки = ширина клавиши (у чёрных уже).

### Вывод для PIANO

- Экранные клавиши C4–E5 (белые) — **равная ширина**; чёрные (W E T Y U O P) — ширина **~0.6 белой**, высота **~60–65%** белой, absolute-позиционирование по границам белых (центр чёрной = граница между белыми — упрощение, общепринятое в web-реализациях).
- **Колонка нот** наследует x и ширину своей экранной клавиши — чёрные получают уже и более узкие коридоры автоматически. Это же фиксирует «связку нота ↔ экранная клавиша» (инвариант №3) в одной функции раскладки.
- Фиксированную ширину «клавиша = пиксель шага» без геометрии чёрных не брать: чёрные колонки станут неотличимы от белых и перекроют соседние.

**Вывод: равные белые + чёрные 0.6×ширины и ~60–65% высоты; раскладка вычисляется из одного списка нот октавы, колонка нот = геометрия клавиши.**

## Q5. Retina/HiDPI: canvas и devicePixelRatio

Статус: заполнено (взято из поисковой выборки).

### Факты

1. **MDN, [Window: devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio)**: «*a `<canvas>` can appear too blurry on retina screens*» — MDN прямо показывает, как через `window.devicePixelRatio` добавить плотность пикселей для резкого рендера. *(цитата из поисковой выборки)*
2. **Стандартный рецепт** (MDN + «[The Canvas API, Part 3: A Retina-Ready, Responsive Canvas](https://www.joshwcomeau.com/react/the-perils-of-rehydration/)»-класс рецептов из выборки): буфер канваса (`canvas.width/height`) = CSS-размер × dpr, затем `ctx.scale(dpr, dpr)` — рисуем в CSS-пикселях как обычно:

   ```
   canvas.width  = Math.round(cssWidth * devicePixelRatio)
   canvas.height = Math.round(cssHeight * devicePixelRatio)
   canvas.style.width  = cssWidth + 'px'
   canvas.style.height = cssHeight + 'px'
   ctx.scale(devicePixelRatio, devicePixelRatio)
   ```

3. **Гоча целых**: `canvas.width` — целое, дробное обрезается ([MDN: HTMLCanvasElement.width](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/width)) → округлять через `Math.round`, иначе на части экранов появится 1px-полоса.
4. **MDN [Optimizing canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)**: лучший случай — вообще не масштабировать канвас; не делать буфер больше физического размера (дорисовка лишних пикселей впустую).
5. **dpr меняется**: перетаскивание окна на внешний монитор → пересчитать по `resize` и/или `matchMedia('(resolution: …)')`; Neothesia прямо правил «DPI scaling in the waterfall note renderer» (см. Q3) — типовой баг этого шага.

### Вывод для PIANO

MacBook — Retina, `devicePixelRatio = 2`. Без шага 2 края нот и линия удара будут мыльными — **шаг обязателен**, выполняется один раз при resize: размер буфера × dpr, `ctx.scale(dpr, dpr)`, вся логика рисования живёт в CSS-пикселях и про dpr больше не думает.

**Вывод: обязательный шаг настройки канваса при resize; рисование — всегда в CSS-пикселях.**

---

## Итоговая рекомендация

**Рендер: Canvas 2D, два слоя, rAF-цикл от аудио-часов.**

1. **Технология — Canvas 2D.** Нагрузка (30–60 нот + ~17 экранных клавиш) на 1–2 порядка ниже лимитов canvas (~1000+ объектов @ 60fps). DOM/CSS-transform отпадает: изменяемые высоты нот, wait-mode, подсветка и цвет партии заставят каждый кадр трогать layout/paint; WebGL/three.js не окупается без 3D/видео-экспорта (он появляется в экосистеме только ради этого — Q1, Q3).
2. **Два слоя канвасов** (практика web.dev/canvas-performance): нижний — экранные клавиши + подписи физической клавиатуры (перерисовка только при смене подсветки/маппинга/октавного сдвига); верхний — колонка нот, линия удара, подсветка (полный кадр каждый rAF). Один большой канвас допустим как упрощение, два слоя дешевле.
3. **Время — только `AudioContext.currentTime`** каждый rAF-кадр: `t_муз = (ctx.currentTime − t0) × множитель_скорости`; позиция ноты — чистая функция `(moment − t_муз) × px_per_second` над линией удара, без инкрементов (Q2, инвариант №2, синхронно с lookahead-планировщиком из 01-audio-engine.md). Wait-mode = статичный кадр + сдвиг `t0` при возобновлении.
4. **Раскладка** (Q4): белые равной ширины, чёрные ≈0.6×ширины и ≈60–65% высоты, absolute по границам белых; одна функция раскладки — источник геометрии и для клавиш, и для колонок нот.
5. **Retina** (Q5): при resize буфер = CSS-размер × `devicePixelRatio` (Math.round), `ctx.scale(dpr, dpr)`; рисование в CSS-пикселях. Без этого шага на MacBook всё мыльное.
6. **Чего не делать**: CSS-анимации для нот (не знают аудио-часов, дрейф + layout), WebGL «на вырост» (техдолг без выгоды), инкрементальные смещения нот (дрейф против звука), буфер канваса без dpr.

Открытые хвосты: лицензии ekkx/notefall, Bewelge/MIDIano, imlishiyuan/piano-fx не подтверждены сниппетами — проверить в репозиториях перед заимствованием идей/кода (ReactPianoPlayer — MIT, подтверждено).
