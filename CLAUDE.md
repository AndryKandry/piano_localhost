# PIANO — Ноутбук-пианино

Клавиатура ноутбука как фортепиано: подсветка нужных клавиш, игра по нотам/клавишам
(аналог гитарных табов), загрузка мелодий, автопроигрывание, смена тембра (синтезатор).

## Meta

- **Dev approach:** `DEV_APPROACH: domain-first`
- **TaskBoard:** доска `PIANO` (сервер 127.0.0.1:8642, `taskb` CLI)
- **Формат отчётов:** `./dev-report/<slug>-<YYYY-MM-DD>.md`

## Domain-first артефакты

| Артефакт | Путь |
|----------|------|
| Глоссарий | `docs/GLOSSARY.md` |
| ADR | `docs/adr/` |
| Research | `docs/research/` |
| Спека | `docs/SPEC.md` |

## Agents

### Consilium
| Role        | Agent            |
|-------------|------------------|
| architect   | architect        |
| frontend    | frontend         |
| ui          | ui               |
| security    | security         |
| devops      | devops           |
| api         | api              |
| diagnostics | diagnostics      |

### Executing
| Agent            | Scope        |
|------------------|--------------|
| (см. виджет ниже — заполнить после выбора стека) | |

### Models
| Role | Model |
|------|-------|
| architect | opus |
| security | opus |
| frontend | sonnet |
| * | sonnet |
