# Research 03 — Ограничения клавиатуры (подсветка, event.code, rollover, браузер)

Дата: 2026-11-23. Роль: architect. Статус: research.

Вопросы:
1. Физическая подсветка клавиш MacBook — публичный API?
2. event.code vs event.key (W3C UI Events), event.repeat.
3. Rollover / NKRO / ghosting — сколько одновременных нажатий держит клавиатура MacBook.
4. Ограничения браузера: неперехватываемые комбинации, preventDefault, фокус.

---

## 1. Физическая подсветка клавиш MacBook

**Вердикт: публичного API адресной (per-key) подсветки в macOS НЕТ.** Публично управляется только общая яркость.

Факты:

1. Все доступные интерфейсы управляют подсветкой **глобально** — одно значение яркости на всю клавиатуру. macOS в настройках предоставляет только слайдер «Keyboard brightness» и тумблер «Adjust keyboard brightness in low light» (подтверждает проект Dim Keys — https://dimkeys.com).
2. Программное управление яркостью (включая адресную) живёт в **приватных** IOKit user client'ах: `AppleKeyboardBacklight`, `AppleSMC`. Open-source проект pirate/mac-keyboard-brightness прямо указывает, что использует private IOKit APIs (`AppleSMC`), часто требуя root на Apple Silicon.
   URL: https://github.com/pirate/mac-keyboard-brightness
   Цитата (README): проект «Programmatically control Mac keyboard & display brightness», полагается на private IOKit API (AppleSMC).
3. Детект наличия подсветки — через приватную инфраструктуру: `ioreg -c IOResources -d 3 | grep '"KeyboardBacklight"'` (Stack Overflow: https://stackoverflow.com/questions/70360160/detecting-if-mac-has-a-backlit-keyboard).
4. `hidutil` — публичная утилита, но только для ремапа клавиш HID, illumination не трогает.
5. Per-key RGB существует только у сторонних клавиатур и управляется vendor SDK (Logitech G HUB SDK, Razer Chroma, Corsair iCUE) — не Apple IOKit, и недоступно из браузера.

Вывод: «подсветка только экранных клавиш» подтверждено. Физическая адресная подсветка недоступна ни публичным API, ни из браузера; приватные хаки (SMC) — root + нестабильно + не для веб-приложения. Это фиксирует ADR-001 и глоссарий (Avoid: «подсветка клавиатуры ноутбука»).

## 2. event.code vs event.key

Специфицировано в W3C **UI Events KeyboardEvent code Values** (https://www.w3.org/TR/uievents-code, ред. 2025-04-22) и родительской спеке UI Events (https://www.w3.org/TR/uievents/).

Факты:

1. Спека: «The `code` value contains information about the key event that can be used to identify the **physical key** being pressed by the user». Значения (`KeyA`, `Semicolon`, …) названы по позициям US QWERTY и НЕ зависят от раскладки, локали и модификаторов.
2. Родительская спека UI Events прямо требует `code` для этой задачи: «To identify these events as coming from the same **physical key**, you will need to make use of the **code attribute**».
3. MDN (https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code): «the `code` value identifies the physical key being pressed regardless of keyboard layout — e.g., `KeyW` is always the key in the same physical position». `key` — это сгенерированный символ, он меняется с раскладкой/модификаторами. `keyCode` устарел (deprecated).
4. **Почему `code` правилен при русской раскладке:** на русской раскладке физическая клавиша `KeyA` даёт `key === 'ф'`, `key === 'F'` при Cmd, `'а'` в Caps Lock — а `code` во всех случаях `KeyA`. Маппинг по `key` сломался бы при переключении раскладки ОС; по `code` — работает. Это подтверждает инвариант 1 глоссария.

**event.repeat / auto-repeat:** MDN (https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/repeat): `repeat` = `true`, если keydown вызван автоповтором удерживаемой клавиши; `false` на первом keydown и всегда `false` на `keyup`. **Да, фильтровать надо:** onset ноты должен играть только `keydown` c `repeat === false`; иначе удержание клавиши даст серию рестартов звука (и ложные «попадания» по окну). Дополнительно держать множество зажатых `code` (keyup может не прийти — см. раздел 4).

Честные оговорки:
- Встречаются известные баги `code` на отдельных браузерах/модификаторах (например, пустой `code` у некоторых клавиш) — **не подтверждено документацией в этом research**, требует ручной проверки на целевых браузерах (Chrome/Safari/Firefox macOS).
- WebFetch w3.org/MDN был заблокирован сетью окружения; цитаты получены через поисковые выборки, URL спек приведены — содержимое сверять не потребовалось beyond цитат выше.

## 3. Rollover / NKRO / ghosting

**Apple официально НЕ публикует rollover-спецификации встроенных клавиатур MacBook** (после 12" MacBook 2015 цифры из спеков исчезли) — подтверждение: отсутствие официальных чисел в результатах поиска по support.apple.com; все цифры — из независимых тестов и розничных спеков. Именно это «Apple молчит» — подтверждено.

Независимые данные (надёжность — средняя, это не лабораторные протоколы, а обзоры/тестеры):

| Устройство | Заявленный rollover | Источник |
|---|---|---|
| MacBook Pro 13"/16" Intel (~2016+) | 10 клавиш | розничные спеки, обзоры |
| MacBook Air 2017–2020 | 10 клавиш | розничные спеки |
| MacBook Pro M1 Pro/Max (2021+) | 8 клавиш (из 10 нажатых) | YouTube-тест Parker Burton |
| Magic Keyboard (внешняя) | 6 клавиш; с Touch ID — 8 | спеки Apple-аксессуаров |

Механика ghosting: мембранная матрица MacBook разведена по диагонали; при некоторых **конкретных 3-клавишных** комбинациях замыкается ложная цепь и третья клавиша «фантомит» или теряется (статья Kinesis «Ghosting Phenomenon»). Rollover — метрика успеха; ghosting — ошибка, и он возможен **ниже** формального лимита rollover. Живой пример мембраны: нажали 11 клавиш — зарегистрировано 5 (SwitchandClick). Инструменты теста: UdK KeyTester (матрица клавиш), keyboardtester.com.

**Риск для аккордов 3–5 нот:** умеренный. 3–5 клавиш заведомо ниже заявленных 8–10 rollover, НО из-за диагональной матрицы конкретные тройки наших клавиш могут не регистрироваться одновременно. Вывод: (а) подтвердить на целевых моделях тестом (UdK KeyTester / keyboardtester.com) именно наш набор `A S D F G H J K L ; ' W E T Y U O P Z X`; (б) в дизайн не закладывать геймплей, ломающийся от потери 1 ноты в аккорде (автодополнение/терпимость). Точная цифра rollover для конкретной модели — **не подтверждено документацией Apple**, только независимыми тестами.

## 4. Ограничения браузера

1. **Зарезервированные комбинации не перехватываются.** `preventDefault()` игнорируется для browser-level: Ctrl/Cmd+N, T, W (Stack Overflow: https://stackoverflow.com/questions/32390157/shortcut-key-commands-in-chrome-not-preventing-default-action — «Chrome executes default browser actions … despite preventDefault()») и для OS-level: Cmd+Tab, Alt+Tab, Cmd+Space, Cmd+Q — они либо не диспатчат keydown вообще, либо диспатчат с `cancelable === false` (разборы dev.to «React: Overriding Browser's Keyboard Shortcuts», багзилла). Для нашего приложения это некритично: маппинг не содержит Cmd-комбо.
2. **preventDefault для `;` и `'` — обязателен.** Сами клавиши браузерных действий не вызывают, но в Firefox `'` и `/` открывают Quick Find — это предотвращается `preventDefault()` на keydown (общеизвестное поведение; в этом research конкретным URL не подкреплено — пометить на ручную проверку). Правило: `preventDefault()` на keydown **для всех клавиш маппинга**, когда страница в фокусе.
3. **Escape** — browser/OS не резервируют для страницы (кроме выхода из fullscreen, перехватить нельзя). **Tab** — перехватывается preventDefault'ом, но ломает клавиатурную a11y; использовать только если фокус-навигация в приложении переопределена осознанно.
4. **Фокус и «залипшие» ноты:** keydown/keyup диспатчатся только когда окно в фокусе; при уходе (Cmd+Tab, сворачивание) keyup пропадает — звучащие ноты «залипнут». Стандартное поведение браузеров; митигируется: на `window blur`/`visibilitychange` принудительно глушить все зажатые клавиши (PANIC/all-notes-off).
5. Для kiosk-сценариев существует **Keyboard Lock API** (перехват системных клавиш в fullscreen) — поддержка только Chrome desktop; не нужен MVP, зафиксировать как опцию.

## Итоговые выводы

1. **Физическая подсветка: невозможна, подтверждено.** Публичного API нет; только приватные IOKit/SMC (root, нестабильно, вне браузера). Единственный носитель подсветки — экранные клавиши (глоссарий/ADR-001 подтверждены).
2. **Маппинг по `event.code` — spec-backed** (W3C uievents-code); `key` меняется с раскладкой → неверен. Фильтр `event.repeat` обязателен; держать реестр зажатых клавиш.
3. **Полифония 3–5 нот:** лимит rollover сообществом оценён в 8–10 — формально запас есть, но Apple цифр не публикует, а диагональная мембрана даёт ghosting на конкретных тройках клавиш ниже лимита. Обязательно: ручной rollover-тест нашего набора клавиш; дизайн толерантен к потере одной ноты аккорда.
4. **Браузер:** `preventDefault()` на все клавиши маппинга (вкл. `;` `'`), не опираться на Cmd/OS-комбо, Tab не захватывать, на `blur` глушить все ноты.
