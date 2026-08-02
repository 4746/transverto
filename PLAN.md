# Transverto v2.0.0 — послідовний план реалізації

## Як працювати з планом

Завдання виконуються по черзі в окремих чатах. У новому чаті достатньо написати: **«Виконай завдання N з PLAN.md»**.

Виконавець кожного завдання повинен:

1. Перевірити, що активна гілка — `v2.0.0`.
2. Прочитати поточне завдання, `README.md`, `package.json` і пов'язані source-файли.
3. Врахувати результат попередніх завдань і не реалізовувати наступні.
4. Оновити CLI help та README, якщо змінився публічний API.
5. Запустити `npm run build`, `npm run lint` і вручну перевірити основні CLI-сценарії.
6. Не додавати тести й не змінювати тестову інфраструктуру.
7. У фіналі перелічити зміни, результати перевірок та відомі обмеження.

## Спільні правила v2.0.0

- Мінімальна версія runtime: `"node": ">=24.15"`. Усі dependencies, devDependencies, TypeScript settings і development scripts мають бути сумісними з Node 24.15+.
- Сумісність із v1.x не обов'язкова; compatibility layers та deprecated aliases не потрібні без практичної причини.
- Breaking changes дозволені, якщо вони спрощують API або потрібні новій функціональності.
- Команди підтримують TTY/non-TTY, стабільний `--json` без ANSI та визначені exit codes.
- Масові зміни спочатку формують plan: `--dry-run` нічого не записує, non-TTY write потребує `--write` або `--force`.
- Спільну логіку config, dictionaries, glob, reports і file writes розміщувати у `src/shared`.
- JSON записувати атомарно через temporary file у тій самій директорії.
- Не виконувати прихованих network calls.
- Тести та тестова інфраструктура не входять до scope.

## Порядок виконання

1. Node 24.15+ і оновлення dependencies
2. `ctv init`
3. `ctv doctor`
4. Керування мовами
5. `ctv translate`
6. Кеш
7. Fallback engines
8. Batch auto-translation
9. `ctv status`
10. Безпечний sync
11. Масові операції з ключами
12. Розширений `label:get`
13. `import:csv`

## Етап 1 — надійний базовий workflow

### 1. Діагностика проєкту: `ctv doctor`

- Перевіряти наявність і коректність `.ctv.config.json`.
- Валідувати `languages`, `langCodeDefault`, `engine`, `basePath` і `basePathEnum`.
- Перевіряти наявність мовних файлів та автоматично пропонувати створення відсутніх.
- Виявляти пошкоджений JSON, дублікати шляхів ключів і конфлікти типів, наприклад коли `menu` одночасно є рядком і батьківським об'єктом.
- Перевіряти доступність вибраного рушія перекладу та наявність обов'язкових параметрів.
- Повертати зрозумілий підсумок із рівнями `error`, `warning` та `info`.
- Додати `--json` для машинного читання результату.

### 2. Безпечна синхронізація мов

- Додати до `ctv label:sync` режим `--dry-run`, який показує заплановані зміни без запису файлів.
- Додати явний вибір еталонної мови через `--source <lang>` замість залежності від порядку мов у конфігурації.
- Додати політику для зайвих ключів: `keep`, `report` або `remove`.
- Додати фільтри `--include <pattern>` і `--exclude <pattern>` для синхронізації окремих просторів ключів.
- Дозволити синхронізувати лише вибрані цільові мови через повторюваний прапорець `--to <lang>`.
- Показувати підсумок: скільки ключів додано, пропущено, видалено та перекладено для кожної мови.

### 3. Перевірка стану перекладів: `ctv status`

- Показувати відсутні й зайві ключі для кожної мови відносно еталонної.
- Виявляти порожні рядки, значення лише з пробілів і значення, що не змінилися після копіювання з еталонної мови.
- Виявляти невідповідність плейсхолдерів: `{{name}}`, `{count}`, `%s` та подібних конструкцій.
- Додати фільтрацію за мовою, префіксом ключа й типом проблеми.
- Підтримати табличний і JSON-вивід.
- Повертати ненульовий exit code, якщо знайдено проблеми заданого рівня, щоб команду можна було використовувати в CI/CD.

### 4. Покращення `ctv init`

- Додати інтерактивний майстер вибору мов, мови за замовчуванням, рушія та шляхів.
- Додати `--minimal` для створення найпростішої конфігурації без інтерактивних питань.
- Додати `--languages en,uk,de`, `--source en` і `--engine bing|google|terra` для скриптового запуску.
- За підтвердженням створювати відсутні мовні JSON-файли та директорію для згенерованих типів.
- Не записувати секрети до конфігурації: для API-ключів генерувати посилання на назви змінних середовища.

## Етап 2 — продуктивна робота з ключами

### 5. Масові операції з ключами

- Додати `ctv label:rename <old> <new>` для атомарного перейменування ключа в усіх мовах.
- Додати `ctv label:move <prefix> <new-prefix>` для перенесення цілої гілки ключів.
- Розширити `label:delete` підтримкою шаблонів і обов'язковим підтвердженням масового видалення.
- Додати спільні прапорці `--dry-run`, `--language`, `--include` та `--exclude` для масових операцій.
- Перед записом виявляти конфлікти цільових ключів і не перезаписувати значення без явного `--overwrite`.
- Після успішної операції автоматично оновлювати згенеровані TypeScript-типи.

### 6. Розширений пошук: `ctv label:get`

- Додати пошук за точним ключем, префіксом, glob-шаблоном і текстом перекладу.
- Додати нечутливий до регістру режим і обмеження результатів.
- Дозволити вибрати одну або кілька мов.
- Додати компактний режим, у якому один ключ відображається одним рядком із колонками мов.
- Зберегти `--json` зі стабільною структурою результату для використання в інших інструментах.

### 8. Керування мовами

- Додати `ctv language:list` зі станом файлу та статистикою заповнення.
- Додати `ctv language:add <code>` зі створенням файлу й оновленням конфігурації.
- Додати `ctv language:remove <code>` з попередженням про файл, який буде виключено або видалено.
- Додати `ctv language:rename <old> <new>` з перейменуванням файлу та оновленням конфігурації.
- Після кожної зміни мов автоматично оновлювати згенерований enum.

## Етап 3 — обмін перекладами

### 9. Імпорт CSV: `ctv import:csv`

- Імпортувати назад формат, який створює поточна команда `export:csv`.
- Дозволити явно зіставити колонки CSV з кодами мов.
- Підтримати імпорт лише колонок `*_new`, щоб перекладачі могли повернути відредаговані значення.
- Додати політики для невідомих ключів, порожніх клітинок і перезапису наявних перекладів.
- Додати `--dry-run` із підсумком змін і конфліктів.
- Після імпорту синхронізувати структуру JSON та оновлювати TypeScript-типи.

## Етап 4 — керований машинний переклад

### 12. Уніфікована команда перекладу

- Зробити публічну команду `ctv translate` замість прихованих команд конкретних рушіїв.
- Дозволити тимчасово вибирати рушій через `--engine` без зміни конфігурації.
- Підтримати переклад рядка, stdin, файлу та набору ключів.
- Додати переклад одразу в кілька мов через повторюваний `--to`.
- Надавати однаковий формат відповіді незалежно від рушія.
- Після перенесення можливостей видалити окремі engine-команди; aliases для v1.x не створювати.

### 13. Контроль автоперекладу

- Додати обмеження паралельності, затримку між запитами та повторні спроби з наростаючою паузою.
- Додати `--max-items` і `--max-chars` для контролю обсягу одного запуску.
- Показувати попередню оцінку кількості запитів і символів.
- Не надсилати на переклад значення, що складаються лише з плейсхолдерів, URL, чисел або службових токенів.
- Перевіряти збереження плейсхолдерів у результаті; небезпечні результати позначати як конфлікт і не записувати автоматично.
- Додати режим підтвердження перекладів перед записом.

### 14. Резервні рушії та стійкість

- Дозволити визначати ланцюжок рушіїв, наприклад `terra -> google -> bing`.
- Перемикатися на наступний рушій лише для помилок мережі, лімітів або недоступності сервісу.
- Не приховувати причину збою: показувати, який рушій виконав кожен переклад.
- Додати таймаут запиту та зрозумілу класифікацію помилок.
- Дозволити вимкнути fallback для середовищ, де важлива повна відтворюваність.

### 15. Розширене керування кешем

- Розділяти кеш за рушієм, вихідною мовою, цільовою мовою та нормалізованим текстом.
- Додати `ctv cache:list`, `ctv cache:clear` і `ctv cache:prune`.
- Додати TTL та максимальний розмір кешу в конфігурацію.
- Показувати кількість записів, розподіл за рушіями та дату найстарішого запису.
- Дозволити очистити кеш лише для вибраного рушія або мовної пари.

## Завдання для окремих чатів

Нижче наведено робочу чергу. Номер завдання в цій секції має пріоритет над старою нумерацією функціональних пунктів вище.

### Завдання 1 — перейти на Node 24.15+ та оновити dependencies

**Залежності:** немає. Це блокуюче завдання для всієї функціональної черги.

**Основні файли:** `package.json`, `package-lock.json`, `.gitignore`, `tsconfig.json`, `.nvmrc`, `bin/*`, development scripts, `README.md`; за потреби ESLint/oclif config-файли.

**Зробити:**

- У `package.json` встановити точну нижню межу `"engines": {"node": ">=24.15"}`; додати `.nvmrc` із `24.15.0` та продублювати вимогу в README.
- Оновити всі direct `dependencies` і `devDependencies` до актуальних stable major-версій, сумісних із Node 24.15+. Для кожного major upgrade переглянути `engines`, peer dependencies та migration notes.
- Оновити `@types/node` до stable major 24. Не залишати Node 18 types у проєкті з runtime Node 24.
- Оновити TypeScript і `tsconfig.json` під Node 24 ESM: використовувати актуальні `module`/`moduleResolution` для Node ESM і target, який підтримується Node 24.15; не додавати transpilation для старих Node.
- Перевірити oclif core, CLI, help plugin, ESLint stack, `ts-node`, Mocha, Inquirer, Got, Listr2, json2csv, Chalk та fs-extra. Несумісний або покинутий development tool оновити чи замінити; не тримати стару версію лише заради v1.
- Перевірити фактичні imports і видалити dependencies, які більше ніде не використовуються. Не переносити runtime dependency у devDependencies або навпаки без перевірки packaged CLI.
- Прибрати `package-lock.json` із `.gitignore`, створити lockfile актуальним npm для відтворюваного встановлення та не редагувати його вручну.
- Оновити npm scripts, bin launchers та source imports лише там, де цього вимагають нові APIs або ESM semantics.
- Не запускати автоматичний `npm audit fix --force`. Вразливості виправляти через свідоме оновлення top-level package; невиправлені findings перелічити у фінальному звіті.

**Обов'язкові перевірки без тестів:**

- `node --version` повертає `v24.15.0` або новішу версію.
- Чисте `npm install` за lockfile завершується без peer-dependency conflicts.
- `npm outdated` не показує навмисно залишених major-версій без письмового пояснення.
- `npm run build`, `npm run lint`, `node bin/run.js --version`, `node bin/run.js --help` і `npm pack --dry-run` завершуються успішно.
- Вміст dry-run package містить `bin`, compiled `dist`, manifest і type declarations, але не містить source-only або локальних службових файлів.

**Критерії готовності:** у repository явно зафіксовано Node `>=24.15`; Node types і TypeScript config відповідають Node 24; dependencies оновлені й узгоджені; lockfile committed; CLI збирається, запускається та пакується на Node 24.15+.

**Не робити:** функціональні зміни команд, тести, підтримку Node 20/22, dependency downgrade заради v1.x.

### Завдання 2 — покращити `ctv init`

**Залежності:** завдання 1.

**Основні файли:** `src/commands/init.ts`, `src/shared/config.ts`, новий config builder/validator у `src/shared`, `README.md`.

**Зробити:** додати interactive wizard і flags `--minimal`, `--languages`, `--source`, `--engine`, `--translations-path`, `--types-path`, `--no-files`, `--force`; валідовувати languages/source/paths; створювати config, language JSON і directories; не перезаписувати existing files без `--force`; не зберігати API secrets. Якщо вводиться v2 config schema, перевести всі наявні commands одразу без dual-schema compatibility.

**Критерії готовності:** interactive та non-interactive flows створюють еквівалентний валідний проєкт; `--minimal` одразу дозволяє label-команди; partial existing project не пошкоджується; help/README актуальні.

**Не робити:** v1 config migration, network engine check, profiles.

### Завдання 3 — додати `ctv doctor`

**Залежності:** завдання 1–2.

**Основні файли:** новий `src/commands/doctor.ts`, diagnostic models/service у `src/shared`, `README.md`.

**Зробити:** read-only checks config syntax/semantics, languages/source, engine, paths, language files, root object, leaf types і leaf/object conflicts; JSON diagnostic з `code`, `severity`, `message`, `file`, `details`; exit `0/1/2`; network check лише через `--check-engine` з timeout і без secrets.

**Критерії готовності:** команда нічого не змінює; без flag немає network; diagnostic codes однакові у table/JSON; broken JSON показує точний file/reason.

**Не робити:** auto-fix і language completeness comparison.

### Завдання 4 — додати керування мовами

**Залежності:** завдання 1–3.

**Основні файли:** нові commands у `src/commands/language`, config/file services у `src/shared`, поточний generator enum, `README.md`.

**Зробити:** `language:list`, `language:add`, `language:remove`, `language:rename`; list показує role/path/existence/leaf count; add створює `{}` або copy-from; remove фізично видаляє лише з `--delete-file` плюс confirmation/force; source language не видаляється без заміни; rename перевіряє code/file conflicts до write; після mutation оновлюється enum.

**Критерії готовності:** config і files не залишаються частково оновленими; випадкове видалення файла неможливе; `list --json` стабільний.

**Не робити:** locale metadata, profiles, нові type formats.

### Завдання 5 — створити єдину `ctv translate`

**Залежності:** завдання 1–4.

**Основні файли:** новий `src/commands/translate.ts`, `src/shared/entities/translation.engine.ts`, engine adapters/factory, старі `src/commands/translate/*.ts`, `README.md`.

**Зробити:** один input із positional text/`--stdin`/`--file`/`--key`; repeatable `--to`, `--from`, `--engine`, `--dry-run`, `--write`, `--json`; уніфікувати engine interface та result `{sourceText, translatedText, from, to, engine, key?}`; перевіряти flags/languages до network; oversized file відхиляти; `--key` за замовчуванням лише preview; видалити старі provider commands без aliases.

**Критерії готовності:** усі engines мають одну result shape; multi-target зберігає порядок; preview не пише; README не містить старих commands.

**Не робити:** retry, fallback, rate limits.

### Завдання 6 — переробити кеш

**Залежності:** завдання 1, 5.

**Основні файли:** `src/shared/engines/translate.engine.ts`, новий cache service/repository, cache entities/config, `src/commands/cache.ts` або topic commands, `README.md`.

**Зробити:** прибрати global cache state; key враховує engine/from/to/exact normalized text без `toLowerCase`; entry містить timestamps; додати `cache:list`, `cache:clear`, `cache:prune`, filters, TTL і maxEntries; corruption не стирати мовчки; старий `cache -c` видалити; prune виконує expired, потім LRU.

**Критерії готовності:** engines/language pairs не ділять entry; TTL/limit реально діють; filtered clear не зачіпає інші records; cache writes атомарні.

**Не робити:** Redis, SQLite, network cache.

### Завдання 7 — додати fallback engines

**Залежності:** завдання 1, 5–6.

**Основні файли:** engine adapters/factory, translation error entities, config, `src/commands/translate.ts`, `README.md`.

**Зробити:** error categories `configuration`, `authentication`, `validation`, `rate_limit`, `timeout`, `network`, `provider_unavailable`, `provider_response`; ordered fallback config, repeatable `--fallback`, `--no-fallback`, timeout; fallback лише для recoverable categories; cache прив'язати до actual engine; JSON містить ordered attempts.

**Критерії готовності:** chain детермінований; authentication/validation/configuration не запускають fallback; timeout не зависає; actual engine видно в output/cache.

**Не робити:** cost routing і load balancing.

### Завдання 8 — контролювати batch auto-translation

**Залежності:** завдання 1, 5–7.

**Основні файли:** новий batch service та placeholder utility у `src/shared`, `src/commands/translate.ts`, config, `README.md`.

**Зробити:** flags `--concurrency`, `--delay-ms`, `--max-items`, `--max-chars`, `--retry`, `--confirm`, `--dry-run`; стабільний input order; retry лише recoverable errors з bounded exponential backoff; пропускати empty/numbers/URLs/token-only; перевіряти `{{name}}`, `{count}`, `%s`, `%1$s`; mismatch не записувати; summary translated/cached/skipped/conflict/failed/remaining.

**Критерії готовності:** dry-run не використовує network; limits не перевищуються при concurrency; retry не дублює success; placeholder conflicts не записуються.

**Не робити:** web review і cost estimate.

### Завдання 9 — додати `ctv status`

**Залежності:** завдання 1–4 і placeholder utility із завдання 8.

**Основні файли:** новий `src/commands/status.ts`, read-only analysis service/entities у `src/shared`, `README.md`.

**Зробити:** findings missing/extra/empty/same/placeholder; repeatable `--language`, `--problem`, `--include`, `--exclude`, `--json`, `--fail-on error|warning|never`; severity defaults: missing/placeholder error, empty warning, extra/same info; filters застосовуються до structured findings до formatting.

**Критерії готовності:** немає writes або engine calls; summary дорівнює filtered findings; exit code визначається `--fail-on`; JSON стабільний.

**Не робити:** coverage percentage/history і code scan.

### Завдання 10 — зробити sync безпечним

**Залежності:** завдання 1, 4, 8–9.

**Основні файли:** `src/commands/label/sync.ts`, нові sync planner/executor/report components у `src/shared`, file repository, `README.md`.

**Зробити:** `--dry-run`, `--source`, repeatable `--to`, `--include`, `--exclude`, `--extra keep|report|remove`, `--auto-translate`, `--write`; immutable plan add/remove/keep/translate/skip/conflict; source не залежить від порядку languages; missing без auto-translate отримує empty value; extra default report; до write перевіряти, що files не змінилися; атомарно записувати й один раз оновлювати enum.

**Критерії готовності:** dry-run і write будують однаковий plan; необрані дані не змінюються; failure не залишає partial update; summary розбитий по мовах.

**Не робити:** remote TMS і CSV import.

### Завдання 11 — масові операції з ключами

**Залежності:** завдання 1, 4, 9–10.

**Основні файли:** нові `src/commands/label/rename.ts`, `move.ts`; `delete.ts`; shared mutation planner/repository; `README.md`.

**Зробити:** `label:rename <old> <new>`, `label:move <old-prefix> <new-prefix>`, glob-aware `label:delete`; shared `--language`, `--include`, `--exclude`, `--dry-run`, `--overwrite`/`--force`; existing target у будь-якій мові зупиняє всю операцію без overwrite; pattern delete показує full key list; changes готуються in-memory, атомарно пишуться, enum оновлюється один раз.

**Критерії готовності:** conflict не дає partial changes; dry-run відповідає write; move не зачіпає схожі prefixes; JSON містить changes/conflicts.

**Не робити:** `add-many`, `replace-many`, regex mutation.

### Завдання 12 — розширити `ctv label:get`

**Залежності:** завдання 1, 9–11.

**Основні файли:** `src/commands/label/get.ts`, новий search service/shared glob utility, `README.md`.

**Зробити:** `--mode exact|prefix|glob|text`, repeatable `--language`, `--ignore-case`, `--limit`, `--compact`, `--json`; exact — leaf, prefix — exact плюс descendants, glob — shared matcher, text — substring у values; sort key + config language order; limit після sort, JSON містить total/truncated; missing query у non-TTY — usage error.

**Критерії готовності:** modes однозначно documented; JSON не залежить від terminal; compact не губить missing values; command read-only.

**Не робити:** fuzzy і source-code search.

### Завдання 13 — додати `ctv import:csv`

**Залежності:** завдання 1, 4, 9–12.

**Основні файли:** новий `src/commands/import/csv.ts`, CSV parser/import planner у `src/shared`, `src/commands/export/csv.ts`, `README.md`.

**Зробити:** `--dry-run`, repeatable `--map`, `--use-new-columns`, policies `--unknown-key`, `--empty`, `--existing`, `--write`; перевіряти label column, duplicate labels/mappings і unknown languages до plan; rows перетворювати на add/update/skip/conflict без write; new columns брати лише непорожні; підтримувати тільки string leaves; після confirmation атомарно застосувати plan, виконати status analysis та оновити enum; export зробити deterministic із unique headers і standard escaping.

**Критерії готовності:** export → edit `*_new` → import працює напряму; dry-run точний; duplicates/conflicts зупиняють operation до write; failure не лишає partial dictionaries.

**Не робити:** add-many, replace-many, JSON/XLIFF/XLSX, auto-translate після import.

## Майбутній backlog — зараз не реалізовувати

- **Звіти про покриття:** можливий `ctv report` після стабілізації `ctv status`.
- **Виявлення ключів у source code:** можливий `ctv scan` після визначення framework patterns і dynamic-key policy.
- **Гнучка генерація типів:** можливий `ctv types:generate`; до того лишається поточний enum/type.
- **Профілі конфігурації:** можливі `--config`, profiles і `config:show` після появи реального multi-config use case.

## Свідомо виключено

- Пакетні `label:add-many` і `label:replace-many`.
- Інші формати імпорту/експорту: JSON, XLIFF, XLSX.
- `ctv watch`.
- GUI, cloud sync, remote TMS integrations і власний translation server.
