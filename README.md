CLI transverto
=================

Label management command.

[![NPM version](http://img.shields.io/npm/v/@cli107/transverto.svg?style=flat-square)](http://npmjs.org/package/@cli107/transverto)
[![GitHub license](https://img.shields.io/github/license/4746/transverto)](https://github.com/4746/transverto/blob/main/LICENSE)


<!-- toc -->
* [Usage](#usage)
* [AI engine profiles](#ai-engine-profiles)
* [PowerShell](#powershell)
* [bash/zsh](#bashzsh)
* [Translation workflow](#translation-workflow)
* [Safe synchronization](#safe-synchronization)
* [Bulk key operations](#bulk-key-operations)
* [Label search](#label-search)
* [CSV exchange](#csv-exchange)
* [Translation status](#translation-status)
* [Translation cache](#translation-cache)
* [Commands](#commands)
<!-- tocstop -->

# Usage

Transverto 2 requires Node.js 24.15.0 or newer. The repository pins the development runtime in `.nvmrc`.

```shell
npm install @cli107/transverto --save-dev
```

```shell
ctv --help
```

# AI engine profiles

`ctv translate` uses named AI model profiles. The active profile is selected by
`engine`; pass `--engine <name>` to use another configured profile for one run.
Profile names are user-defined, so multiple models or endpoints from the same
provider can coexist.

```json
{
  "batch": {
    "mode": "per-language",
    "concurrency": 1,
    "delayMs": 0,
    "retry": 2,
    "maxItems": null,
    "maxChars": null
  },
  "engine": "lmstudio",
  "fallback": "openrouter",
  "engines": {
    "lmstudio": {
      "provider": "lmstudio",
      "baseUrl": "http://localhost:1234/v1",
      "model": "google/gemma-4-12b-qat",
      "timeoutMs": 30000
    },
    "google-ai": {
      "provider": "google-ai",
      "model": "gemini-3.6-flash",
      "apiKeyEnv": "CTV_GOOGLE_AI_API_KEY"
    },
    "openrouter": {
      "provider": "openrouter",
      "model": "openrouter/free",
      "apiKeyEnv": "CTV_OPENROUTER_API_KEY"
    }
  }
}
```

`fallback` accepts one configured profile name or `null`. It must differ from
the active primary profile; fallback chains and load balancing are not supported.
Each profile can set a positive `timeoutMs`; the default is `30000`.

Supported providers:

- `lmstudio` defaults to `http://localhost:1234/v1` and does not require a key.
- `google-ai` defaults to Google's OpenAI-compatible Gemini endpoint.
- `openrouter` defaults to `https://openrouter.ai/api/v1`.
- `openai-compatible` requires an explicit `baseUrl` and supports any compatible service.

`apiKeyEnv` is an environment-variable name, not a secret. Set the corresponding
variable before running the CLI:

```shell
# PowerShell
$env:CTV_GOOGLE_AI_API_KEY = "..."

# bash/zsh
export CTV_GOOGLE_AI_API_KEY="..."
```

`ctv init --minimal` creates a label-ready project without inventing an engine
or model. Configure a local model non-interactively with:

```shell
ctv init --minimal --engine lmstudio --provider lmstudio \
  --model google/gemma-4-12b-qat --base-url http://localhost:1234/v1
```

# Translation workflow

Translate positional text or stdin, or select one or more dictionary keys:

```shell
ctv translate "Hello" --from en --to uk
echo "Hello" | ctv translate --stdin --to uk --to de
ctv translate --key home.title --key home.subtitle --to uk --to de
ctv translate --key home.title --to uk --concurrency 2 --max-items 10
ctv translate --key home.title --to uk --write --confirm
ctv translate "Hello" --to uk --fallback openrouter
ctv translate "Hello" --to uk --no-fallback
```

`--key` is preview-only unless `--write` is supplied. All accepted translations
finish before target dictionaries are written in one atomic transaction.
`--confirm` requires `--write` and a TTY, then offers `accept` or `skip` for each
safe result in input order. It is rejected before network access in non-TTY use.
`--file` input is intentionally unsupported, and stdin is one source value rather
than a line-delimited batch.

Batch defaults come from `.ctv.config.json`:

```json
{
  "batch": {
    "mode": "per-language",
    "concurrency": 1,
    "delayMs": 0,
    "retry": 2,
    "maxItems": null,
    "maxChars": null
  }
}
```

`concurrency` is the maximum number of active translation attempts. `delayMs` is
the global minimum interval between attempt starts. `retry` counts additional
attempts after the first and applies only to `rate_limit`, `timeout`, `network`,
and `provider_unavailable`. Retry backoff starts at `max(delayMs, 100)`, doubles,
and is capped at 30 seconds. CLI flags `--concurrency`, `--delay-ms`, `--retry`,
`--max-items`, and `--max-chars` override only their matching config value for
one run. `null` disables an item or character limit.

`mode: "per-language"` is the default and sends one provider request per target
language. Set `mode: "multi-language"` to group one source text and localization
key across all uncached target languages and request one JSON object keyed by
language code:

```json
{
  "batch": {
    "mode": "multi-language",
    "concurrency": 1,
    "delayMs": 0,
    "retry": 2,
    "maxItems": null,
    "maxChars": null
  }
}
```

Limits are applied to individual planned translations before grouping. In
multi-language mode, concurrency, delay, and retry apply to whole packages. A
full recoverable provider failure keeps the configured primary/fallback
behavior. A partial or invalid package never starts individual calls
automatically: an interactive run asks whether to cancel or translate only the
problem languages one by one, while a non-interactive or JSON run cancels
without target-file or fresh-cache writes. If this happens during `label:add`,
the source value already added to the source dictionary remains in place.

Requests retain key order followed by target order even when work completes out
of order. Limits select the longest initial translatable prefix. Once the next
request exceeds either limit, it and all later translatable requests are
`remaining`; automatically skipped values do not consume limits. The command
skips empty/whitespace values, standalone numbers, absolute HTTP(S) URLs, and
token-only values without a network call.

The result must preserve the exact multiset of `{{name}}`, `{count}`, `%s`, and
`%1$s` placeholders. Order may change, but spelling and occurrence count may
not. A mismatch is a `conflict`, is never written, and does not stop other batch
items. Individual failures also do not stop the batch. With `--write`, only safe
accepted results are written.

`--dry-run` validates profiles, flags, languages, dictionaries, and keys, then
performs skip and limit planning without calling an engine or writing files.
Eligible requests are `remaining` with reason `dry_run`; limit-excluded requests
use reason `limit`.

JSON output always uses this envelope:

```json
{
  "conflicts": [],
  "failed": [],
  "remaining": [],
  "results": [],
  "skipped": [],
  "summary": {
    "cached": 0,
    "conflict": 0,
    "failed": 0,
    "remaining": 0,
    "skipped": 0,
    "translated": 0
  },
  "dryRun": false,
  "requests": [],
  "written": []
}
```

The six summary counts are mutually exclusive and sum to the request count.
`results` contains only safe accepted values and reports `cached`, `engine`,
`provider`, and `model`; fallback results also include
`"fallback": {"from": "<primary>"}`. Automatic and confirmation skips have
distinct reasons. Failures include their category, sanitized message, and total
attempt count.

The command exits 1 after emitting human or JSON output when any request failed
or conflicted. Skipped or remaining requests alone keep exit 0. Invalid usage or
configuration exits 2 before network/write.

Before any network request, the service checks the primary cache and then the
fallback cache. If both miss, the fallback profile is called only for the four
recoverable categories listed above. `configuration`, `authentication`,
`validation`, and `provider_response` never trigger fallback. `--fallback <name>`
overrides the configured profile for one run; `--no-fallback` disables it.

# Safe synchronization

`ctv label:sync` builds an immutable synchronization plan before changing any
dictionary. The source defaults to `langCodeDefault`; `--source <lang>`
overrides it explicitly, so source selection never depends on the order of
`languages`. Without `--to`, every other configured language is a target.
Repeat `--to` to select targets:

```shell
ctv label:sync --dry-run
ctv label:sync --source en --to uk --to de --dry-run --json
ctv label:sync --include 'home.*' --exclude '*.title' --dry-run
ctv label:sync --extra remove --write
```

`--include` and `--exclude` are repeatable and use the same matcher as
`ctv status`: exact keys, `*`, a leading wildcard such as `*.title`, or a
trailing wildcard such as `home.*`. Excludes take precedence. Unselected keys
and unselected languages are not changed.

Missing target keys receive an empty string by default. Target-only keys use
`--extra report` by default: they are retained and shown in the plan.
`--extra keep` retains them quietly, while `--extra remove` deletes only
matching extras.

Use `--auto-translate` to send missing values through the same
`TranslationService`, cache, fallback, placeholder checks, retries,
concurrency, delay, and limits used by `ctv translate`:

```shell
ctv label:sync --auto-translate --engine lmstudio --fallback openrouter --write
ctv label:sync --auto-translate --no-fallback --dry-run --json
```

Batch controls come from `batch` in `.ctv.config.json`; sync does not define
separate concurrency or limit flags. Auto-translation failures, placeholder
conflicts, skipped values, and limit-remaining requests are never written for
their keys. Other safe changes are still committed together.

`--dry-run` validates the project and emits the same initial `actions` plan
as a write run, without network calls or file writes. Non-interactive mutation
requires `--write`. In a TTY, omitting `--write` shows the plan and asks once
for confirmation. Explicit `--write` is non-interactive.

Immediately before writing, sync verifies the exact bytes of the source, every
selected target, and the generated types file. If any changed after planning,
the operation aborts. Changed dictionaries and the enum are then written in one
rollback-capable transaction, and the enum is generated once.

Human and JSON reports contain per-language counts for `added`, `removed`,
`kept`, `translated`, `skipped`, `conflicts`, `failed`, and
`remaining`. Exit 0 means a clean plan/write, exit 1 means conflicts, failures,
or remaining work, and exit 2 means invalid usage/configuration/input or a
write-safety failure.

# Bulk key operations

`ctv label:rename <old> <new>` renames one exact leaf, while
`ctv label:move <old-prefix> <new-prefix>` moves the exact branch and its
descendants. A move of `home` never affects a similar key such as `homepage`.
`ctv label:delete <pattern>` accepts an exact key or branch, `*`, a leading
wildcard such as `*.deprecated`, or a trailing wildcard such as `admin.*`.

```shell
ctv label:rename home.title home.heading --dry-run --json
ctv label:move account.profile user.profile --language uk --write
ctv label:delete '*.deprecated' --force
```

Repeat `--language`, `--include`, and `--exclude` to limit an operation.
Filters apply to source keys before a rename, move, or delete. Every command
builds its complete in-memory plan first; `--dry-run` returns that plan without
writing. Non-interactive writes require `--write` (or `--force` for delete).

An existing target or structural path collision in any selected language blocks
the entire rename or move. `--overwrite` explicitly permits replacing those
target values or branches. JSON output always includes `changes`, `conflicts`,
and the complete sorted `matchedKeys` list. Successful writes update all changed
dictionaries and the generated TypeScript types in one rollback-capable file
transaction; the types file is generated once.

# Label search

`ctv label:get <query>` is a strictly read-only search across configured
translation dictionaries. The default mode is `prefix`, which returns an exact
leaf plus its descendants. Select a mode explicitly when scripting:

- `--mode exact` matches one leaf key;
- `--mode prefix` matches the exact key and `query.*` descendants;
- `--mode glob` uses the shared exact/leading-wildcard/trailing-wildcard matcher;
- `--mode text` performs a substring search in translation values.

```shell
ctv label:get home.title --mode exact
ctv label:get home --mode prefix --language en --language uk
ctv label:get '*.title' --mode glob --ignore-case --json
ctv label:get welcome --mode text --compact
ctv label:get home --mode prefix --limit 10
```

Repeat `--language` to select languages; output always follows configuration
language order. `--ignore-case` applies to either keys or translation text,
depending on the mode. Results are sorted by key before `--limit` is applied.

Expanded output shows one key/language pair per row. `--compact` shows one row
per key with language columns and displays a missing translation as `—`.
Stable JSON is key-centric and contains `query`, `mode`, `ignoreCase`,
`languages`, `limit`, `results`, `total`, and `truncated`; every result
contains all selected languages in configuration order and represents missing
values as `null`.

When QUERY is omitted in a TTY, the command prompts for it. Non-interactive use
without QUERY exits 2. Search never writes dictionaries, generated types, or
configuration, and never calls a translation engine.

# CSV exchange

`ctv export:csv` writes deterministic rows sorted by label. Columns follow
configuration language order and are emitted once as `<lang>` and
`<lang>_new`; values use standard CSV quoting for delimiters, quotes, and line
breaks. Translators can edit only the `*_new` columns and return the same file:

```shell
ctv export:csv --outputFile translations.csv
ctv import:csv translations.csv --use-new-columns --dry-run
ctv import:csv translations.csv --use-new-columns --write
```

The import validates the `label` column, duplicate headers and labels, column
mappings, configured languages, dictionary structure, and every conflict before
writing. Repeat `--map column=language` to import custom column names. When
`--use-new-columns` is set, automatic mappings use only configured
`<lang>_new` columns and empty cells are always ignored.

Safe defaults are `--unknown-key conflict`, `--empty skip`, and
`--existing conflict`. Unknown keys can instead be `skip` or `add`; empty
regular cells can be `skip`, `clear`, or `conflict`; differing existing
translations can be `skip`, `overwrite`, or `conflict`. Any conflict blocks
the complete write. Non-interactive mutation requires `--write`, while
`--dry-run` returns the exact add/update/skip/conflict plan without changing
files.

After confirmation, changed dictionaries and generated TypeScript types are
written in one rollback-capable transaction. The command then runs the same
read-only status analysis as `ctv status` and includes its severity summary.

# Translation status

`ctv status` compares configured target dictionaries with the source language
from `langCodeDefault`. Without `--language`, it analyzes every configured target
in configuration order. Repeat `--language` to select targets and `--problem` to
select one or more finding types:

- `missing` (`error`): a source key is absent from the target;
- `extra` (`info`): a target key is absent from the source;
- `empty` (`warning`): a target value is empty or whitespace-only;
- `same` (`info`): a non-empty target value exactly equals the source;
- `placeholder` (`error`): `{{name}}`, `{count}`, `%s`, or `%1$s` occurrences do
  not match the source exactly.

```shell
ctv status
ctv status --language uk --problem missing --problem placeholder
ctv status --include 'home.*' --exclude '*.title'
ctv status --json --fail-on warning
ctv status --fail-on never
```

`--include` and `--exclude` are repeatable and accept an exact key, one leading
wildcard (`*.title`), one trailing wildcard (`home.*`), or `*`. A wildcard in the
middle, such as `home.*.title`, is invalid. Values within one filter group are
ORed; language, problem, include, and exclude groups are ANDed. Filters apply to
structured findings before output, so `summary.total` and all summary counters
always describe exactly the emitted findings.

`--json` emits a stable ANSI-free object with `source`, selected `languages`,
`findings`, `summary`, `failOn`, and `exitCode`. By default, `--fail-on error`
exits 1 for filtered errors. `--fail-on warning` exits 1 for warnings or errors,
while `--fail-on never` leaves valid reports at exit 0. Invalid flags,
configuration, or dictionaries exit 2 regardless of the threshold.

Status analysis is strictly read-only: it does not write dictionaries, generate
types, resolve or call translation engines, or make network requests.

# Translation cache

Successful AI translations are cached in the CLI cache directory. Cache keys
include the selected profile name, model, source and target languages, and the
exact NFC-normalized source text. Text case is significant. Provider, base URL,
and API keys are deliberately excluded from the key.

Configure retention in `.ctv.config.json`:

```json
{
  "cache": {
    "ttlMs": 2592000000,
    "maxEntries": 1000
  }
}
```

`ttlMs` is the lifetime from creation; set it to `null` to disable expiration.
After expired entries are removed, `maxEntries` keeps the most recently accessed
entries. Use `ctv cache:list` for statistics and filtering, `ctv cache:clear`
for selective removal, and `ctv cache:prune` for TTL/LRU maintenance. A corrupt
cache file produces an error and is never silently replaced.

# Commands
<!-- commands -->
* [`ctv cache:clear`](#ctv-cacheclear)
* [`ctv cache:list`](#ctv-cachelist)
* [`ctv cache:prune`](#ctv-cacheprune)
* [`ctv doctor`](#ctv-doctor)
* [`ctv export:csv [LANGCODE]`](#ctv-exportcsv-langcode)
* [`ctv help [COMMAND]`](#ctv-help-command)
* [`ctv import:csv FILE`](#ctv-importcsv-file)
* [`ctv init`](#ctv-init)
* [`ctv label [ADD] [DELETE] [GET] [MOVE] [RENAME] [REPLACE] [SYNC]`](#ctv-label-add-delete-get-move-rename-replace-sync)
* [`ctv label:add [LABEL]`](#ctv-labeladd-label)
* [`ctv label:delete PATTERN`](#ctv-labeldelete-pattern)
* [`ctv label:get [QUERY]`](#ctv-labelget-query)
* [`ctv label:move OLD-PREFIX NEW-PREFIX`](#ctv-labelmove-old-prefix-new-prefix)
* [`ctv label:rename OLD NEW`](#ctv-labelrename-old-new)
* [`ctv label:replace LABEL`](#ctv-labelreplace-label)
* [`ctv label:sync`](#ctv-labelsync)
* [`ctv language:add CODE`](#ctv-languageadd-code)
* [`ctv language:list`](#ctv-languagelist)
* [`ctv language:remove CODE`](#ctv-languageremove-code)
* [`ctv language:rename FROM TO`](#ctv-languagerename-from-to)
* [`ctv status`](#ctv-status)
* [`ctv translate [TEXT]`](#ctv-translate-text)

## `ctv cache:clear`

Remove cached AI translations

```
USAGE
  $ ctv cache:clear [--engine <value>] [-f] [--from <value>] [--json] [--model <value>] [--to <value>]

FLAGS
  -f, --force           skip confirmation
      --engine=<value>  clear only an engine profile
      --from=<value>    clear only a source language
      --json            output stable JSON
      --model=<value>   clear only an exact model name
      --to=<value>      clear only a target language

DESCRIPTION
  Remove cached AI translations

EXAMPLES
  $ ctv cache:clear --engine lmstudio --force

  $ ctv cache:clear --from en --to uk --force --json

  $ ctv cache:clear --force
```

_See code: [src/commands/cache/clear.ts](https://github.com/4746/transverto/blob/v2.0.0-beta.3/src/commands/cache/clear.ts)_

## `ctv cache:list`

List cached AI translations and cache statistics

```
USAGE
  $ ctv cache:list [--engine <value>] [--from <value>] [--json] [--model <value>] [--to <value>]

FLAGS
  --engine=<value>  filter by engine profile name
  --from=<value>    filter by source language
  --json            output stable JSON
  --model=<value>   filter by exact model name
  --to=<value>      filter by target language

DESCRIPTION
  List cached AI translations and cache statistics

EXAMPLES
  $ ctv cache:list

  $ ctv cache:list --engine lmstudio --from en --to uk

  $ ctv cache:list --json
```

_See code: [src/commands/cache/list.ts](https://github.com/4746/transverto/blob/v2.0.0-beta.3/src/commands/cache/list.ts)_

## `ctv cache:prune`

Prune expired and least-recently-used cache entries

```
USAGE
  $ ctv cache:prune [--json]

FLAGS
  --json  output stable JSON

DESCRIPTION
  Prune expired and least-recently-used cache entries

EXAMPLES
  $ ctv cache:prune

  $ ctv cache:prune --json
```

_See code: [src/commands/cache/prune.ts](https://github.com/4746/transverto/blob/v2.0.0-beta.3/src/commands/cache/prune.ts)_

## `ctv doctor`

Diagnose Transverto configuration and language files

```
USAGE
  $ ctv doctor [--check-engine] [--json] [--timeout <value>]

FLAGS
  --check-engine     perform an opt-in network availability check for the configured engine
  --json             output a stable JSON diagnostic report
  --timeout=<value>  [default: 3000] engine check timeout in milliseconds

DESCRIPTION
  Diagnose Transverto configuration and language files

EXAMPLES
  $ ctv doctor

  $ ctv doctor --json

  $ ctv doctor --check-engine --timeout 5000
```

_See code: [src/commands/doctor.ts](https://github.com/4746/transverto/blob/v2.0.0-beta.3/src/commands/doctor.ts)_

## `ctv export:csv [LANGCODE]`

Export translations to a deterministic CSV file

```
USAGE
  $ ctv export:csv [LANGCODE] [-d <value>] [--eol cr|crlf|lf] [-i <value>] [-o <value>] [--withBOM]

ARGUMENTS
  [LANGCODE]  The language code. If not specified, all available translations are exported.

FLAGS
  -d, --delimiter=<value>   [default: ,] delimiter of columns
  -i, --include=<value>     include one additional language code
  -o, --outputFile=<value>  [default: dist/output.csv] path to save the file
      --eol=<option>        [default: lf]
                            <options: cr|crlf|lf>
      --withBOM             write a UTF-8 BOM character

DESCRIPTION
  Export translations to a deterministic CSV file

EXAMPLES
  $ ctv export:csv

  $ ctv export:csv en

  $ ctv export:csv en --include=uk

  $ ctv export:csv en --outputFile=dist/output.csv

  $ ctv export:csv --delimiter=,

  $ ctv export:csv --eol=lf
```

_See code: [src/commands/export/csv.ts](https://github.com/4746/transverto/blob/v2.0.0-beta.3/src/commands/export/csv.ts)_

## `ctv help [COMMAND]`

Display help for ctv.

```
USAGE
  $ ctv help [COMMAND...] [-n]

ARGUMENTS
  [COMMAND...]  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for ctv.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/6.2.56/src/commands/help.ts)_

## `ctv import:csv FILE`

Safely import translations from CSV

```
USAGE
  $ ctv import:csv FILE [--json] [-d <value>] [--dry-run] [--empty skip|clear|conflict] [--existing
    conflict|skip|overwrite] [--map <value>...] [--unknown-key conflict|skip|add] [--use-new-columns] [--write]

ARGUMENTS
  FILE  CSV file created by export:csv

FLAGS
  -d, --delimiter=<value>     [default: ,] single CSV delimiter character
      --dry-run               show the import plan without writing files
      --empty=<option>        [default: skip] policy for empty regular cells
                              <options: skip|clear|conflict>
      --existing=<option>     [default: conflict] policy when an imported value differs from an existing translation
                              <options: conflict|skip|overwrite>
      --map=<value>...        map a CSV column to a language as column=language
      --unknown-key=<option>  [default: conflict] policy for labels absent from the source dictionary
                              <options: conflict|skip|add>
      --use-new-columns       auto-map *_new columns and ignore their empty cells
      --write                 apply the plan without interactive confirmation

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Safely import translations from CSV

EXAMPLES
  $ ctv import:csv translations.csv --use-new-columns --dry-run

  $ ctv import:csv translations.csv --map translated_uk=uk --write

  $ ctv import:csv translations.csv --existing overwrite --empty clear --write
```

_See code: [src/commands/import/csv.ts](https://github.com/4746/transverto/blob/v2.0.0-beta.3/src/commands/import/csv.ts)_

## `ctv init`

Create a Transverto project configuration

```
USAGE
  $ ctv init [--api-key-env NAME] [--base-url url] [--engine <value>] [-f] [--languages en,uk,de]
    [--minimal] [--model <value>] [--no-files] [--provider lmstudio|google-ai|openrouter|openai-compatible] [--source
    lang] [--translations-path path] [--types-path path]

FLAGS
  -f, --force                   overwrite existing configuration and language files
      --api-key-env=NAME        environment variable containing the API key
      --base-url=url            OpenAI-compatible API base URL
      --engine=<value>          named engine profile
      --languages=en,uk,de      comma-separated language codes
      --minimal                 create a minimal project without interactive questions
      --model=<value>           model identifier
      --no-files                do not create language files or project directories
      --provider=<option>       AI model provider
                                <options: lmstudio|google-ai|openrouter|openai-compatible>
      --source=lang             source language code
      --translations-path=path  directory for language JSON files
      --types-path=path         path for generated TypeScript types

DESCRIPTION
  Create a Transverto project configuration

EXAMPLES
  $ ctv init

  $ ctv init --minimal

  $ ctv init --languages en,uk,de --source en

  $ ctv init --minimal --engine lmstudio --provider lmstudio --model local-model

  $ ctv init --minimal --no-files

  $ ctv init --force
```

_See code: [src/commands/init.ts](https://github.com/4746/transverto/blob/v2.0.0-beta.3/src/commands/init.ts)_

## `ctv label [ADD] [DELETE] [GET] [MOVE] [RENAME] [REPLACE] [SYNC]`

Label management command.

```
USAGE
  $ ctv label [ADD] [DELETE] [GET] [MOVE] [RENAME] [REPLACE] [SYNC]

ARGUMENTS
  [ADD]      Adds a new label.
  [DELETE]   Deletes a label.
  [GET]      Retrieves the labels.
  [MOVE]     Moves a label branch.
  [RENAME]   Renames a label.
  [REPLACE]  Replaces a label with the given value.
  [SYNC]     A command to update labels synchronously.

DESCRIPTION
  Label management command.
```

_See code: [src/commands/label/index.ts](https://github.com/4746/transverto/blob/v2.0.0-beta.3/src/commands/label/index.ts)_

## `ctv label:add [LABEL]`

Add a new label

```
USAGE
  $ ctv label:add [LABEL] [-f <value>] [--noAutoTranslate] [--silent] [-t <value>]

ARGUMENTS
  [LABEL]  A label key

FLAGS
  -f, --fromLangCode=<value>  The language code of source text.
  -t, --translation=<value>   Translation
  --noAutoTranslate
  --silent

DESCRIPTION
  Add a new label

EXAMPLES
  $ ctv label:add "hello.world" -f="en"

  $ ctv label:add "hello.world" -f en -t "Hello World!"

  $ ctv label:add "hello.world" -fen -t "Hello World!"

  $ ctv label:add "hello.world" -t "Hello World!"
```

_See code: [src/commands/label/add.ts](https://github.com/4746/transverto/blob/v2.0.0-beta.3/src/commands/label/add.ts)_

## `ctv label:delete PATTERN`

Safely delete translation keys across configured languages

```
USAGE
  $ ctv label:delete PATTERN [--json] [--dry-run] [--exclude <value>...] [--include <value>...] [--language
    <value>...] [--write] [-f]

ARGUMENTS
  PATTERN  exact key, branch prefix, or edge-wildcard key pattern

FLAGS
  -f, --force                apply without interactive confirmation
      --dry-run              show the immutable plan without writing files
      --exclude=<value>...   exclude exact or edge-wildcard source key pattern
      --include=<value>...   include exact or edge-wildcard source key pattern
      --language=<value>...  language code to mutate
      --write                apply the plan without interactive confirmation

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Safely delete translation keys across configured languages

EXAMPLES
  $ ctv label:delete home.legacy --dry-run

  $ ctv label:delete "*.deprecated" --language en --language uk --dry-run --json

  $ ctv label:delete "admin.*" --force
```

_See code: [src/commands/label/delete.ts](https://github.com/4746/transverto/blob/v2.0.0-beta.3/src/commands/label/delete.ts)_

## `ctv label:get [QUERY]`

Search translation keys and values across configured languages

```
USAGE
  $ ctv label:get [QUERY] [--json] [--compact] [--ignore-case] [--language <value>...] [--limit <value>]
    [--mode exact|prefix|glob|text]

ARGUMENTS
  [QUERY]  key or translation text to search for

FLAGS
  --compact              show one row per key with language columns
  --ignore-case          match keys or values without case sensitivity
  --language=<value>...  language code to search
  --limit=<value>        maximum number of sorted keys to return
  --mode=<option>        [default: prefix] search mode
                         <options: exact|prefix|glob|text>

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Search translation keys and values across configured languages

EXAMPLES
  $ ctv label:get home.title --mode exact

  $ ctv label:get home --mode prefix --language en --language uk

  $ ctv label:get "*.title" --mode glob --ignore-case --json

  $ ctv label:get welcome --mode text --compact

  $ ctv label:get home --mode prefix --limit 10
```

_See code: [src/commands/label/get.ts](https://github.com/4746/transverto/blob/v2.0.0-beta.3/src/commands/label/get.ts)_

## `ctv label:move OLD-PREFIX NEW-PREFIX`

Atomically move a translation-key branch across configured languages

```
USAGE
  $ ctv label:move OLD-PREFIX NEW-PREFIX [--json] [--dry-run] [--exclude <value>...] [--include <value>...]
    [--language <value>...] [--write] [--overwrite]

ARGUMENTS
  OLD-PREFIX  existing exact branch prefix
  NEW-PREFIX  new exact branch prefix

FLAGS
  --dry-run              show the immutable plan without writing files
  --exclude=<value>...   exclude exact or edge-wildcard source key pattern
  --include=<value>...   include exact or edge-wildcard source key pattern
  --language=<value>...  language code to mutate
  --overwrite            replace existing target values or branches
  --write                apply the plan without interactive confirmation

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Atomically move a translation-key branch across configured languages

EXAMPLES
  $ ctv label:move account.profile user.profile --dry-run

  $ ctv label:move account user --include "account.*" --write

  $ ctv label:move old.section new.section --overwrite --write --json
```

_See code: [src/commands/label/move.ts](https://github.com/4746/transverto/blob/v2.0.0-beta.3/src/commands/label/move.ts)_

## `ctv label:rename OLD NEW`

Atomically rename a translation key across configured languages

```
USAGE
  $ ctv label:rename OLD NEW [--json] [--dry-run] [--exclude <value>...] [--include <value>...] [--language
    <value>...] [--write] [--overwrite]

ARGUMENTS
  OLD  existing exact translation key
  NEW  new exact translation key

FLAGS
  --dry-run              show the immutable plan without writing files
  --exclude=<value>...   exclude exact or edge-wildcard source key pattern
  --include=<value>...   include exact or edge-wildcard source key pattern
  --language=<value>...  language code to mutate
  --overwrite            replace existing target values
  --write                apply the plan without interactive confirmation

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Atomically rename a translation key across configured languages

EXAMPLES
  $ ctv label:rename home.title home.heading --dry-run

  $ ctv label:rename home.title home.heading --language uk --write

  $ ctv label:rename old.key new.key --overwrite --write --json
```

_See code: [src/commands/label/rename.ts](https://github.com/4746/transverto/blob/v2.0.0-beta.3/src/commands/label/rename.ts)_

## `ctv label:replace LABEL`

Replace the label

```
USAGE
  $ ctv label:replace LABEL -t <value> [-f <value>]

ARGUMENTS
  LABEL  A label key

FLAGS
  -f, --langCode=<value>     The language code of source text.
  -t, --translation=<value>  (required) The translation text.

DESCRIPTION
  Replace the label

EXAMPLES
  $ ctv label:replace --help

  $ ctv label:replace hello.world -t="Hello world!!!"

  $ ctv label:replace hello.world -t="Hello world!!!" -fen
```

_See code: [src/commands/label/replace.ts](https://github.com/4746/transverto/blob/v2.0.0-beta.3/src/commands/label/replace.ts)_

## `ctv label:sync`

Safely synchronize configured translation dictionaries

```
USAGE
  $ ctv label:sync [--json] [--auto-translate] [--dry-run] [--engine <value>] [--exclude <value>...] [--extra
    keep|report|remove] [--fallback <value> | --no-fallback] [--include <value>...] [--source <value>] [--to <value>...]
    [--write]

FLAGS
  --auto-translate      translate missing values through the configured batch pipeline
  --dry-run             show the immutable plan without network calls or writes
  --engine=<value>      named engine profile for auto-translation
  --exclude=<value>...  exclude exact or edge-wildcard key pattern
  --extra=<option>      [default: report] policy for target keys absent from the source
                        <options: keep|report|remove>
  --fallback=<value>    single fallback engine profile for auto-translation
  --include=<value>...  include exact or edge-wildcard key pattern
  --no-fallback         disable configured fallback for auto-translation
  --source=<value>      source language code
  --to=<value>...       target language code
  --write               apply the plan without interactive confirmation

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Safely synchronize configured translation dictionaries

EXAMPLES
  $ ctv label:sync --dry-run

  $ ctv label:sync --source en --to uk --to de --dry-run --json

  $ ctv label:sync --include "home.*" --extra remove --write

  $ ctv label:sync --auto-translate --engine lmstudio --write

  $ ctv label:sync --auto-translate --no-fallback --dry-run
```

_See code: [src/commands/label/sync.ts](https://github.com/4746/transverto/blob/v2.0.0-beta.3/src/commands/label/sync.ts)_

## `ctv language:add CODE`

Add a language to the project

```
USAGE
  $ ctv language:add CODE [--copy-from lang]

ARGUMENTS
  CODE  language code to add

FLAGS
  --copy-from=lang  initialize the dictionary from a configured language

DESCRIPTION
  Add a language to the project

EXAMPLES
  $ ctv language:add uk

  $ ctv language:add de --copy-from en
```

_See code: [src/commands/language/add.ts](https://github.com/4746/transverto/blob/v2.0.0-beta.3/src/commands/language/add.ts)_

## `ctv language:list`

List configured languages and dictionary status

```
USAGE
  $ ctv language:list [--json]

FLAGS
  --json  output a stable JSON language list

DESCRIPTION
  List configured languages and dictionary status

EXAMPLES
  $ ctv language:list

  $ ctv language:list --json
```

_See code: [src/commands/language/list.ts](https://github.com/4746/transverto/blob/v2.0.0-beta.3/src/commands/language/list.ts)_

## `ctv language:remove CODE`

Remove a language from the project, deleting its JSON file by default

```
USAGE
  $ ctv language:remove CODE [--delete-file | --keep-file] [-f] [--source lang]

ARGUMENTS
  CODE  language code to remove

FLAGS
  -f, --force        skip deletion confirmation
      --delete-file  delete the language JSON file (default; retained for compatibility)
      --keep-file    preserve the language JSON file
      --source=lang  replacement source language when removing the current source

DESCRIPTION
  Remove a language from the project, deleting its JSON file by default

EXAMPLES
  $ ctv language:remove uk

  $ ctv language:remove uk --force

  $ ctv language:remove uk --keep-file

  $ ctv language:remove en --source uk --force

  $ ctv language:remove uk --delete-file --force
```

_See code: [src/commands/language/remove.ts](https://github.com/4746/transverto/blob/v2.0.0-beta.3/src/commands/language/remove.ts)_

## `ctv language:rename FROM TO`

Rename a configured language and its JSON file

```
USAGE
  $ ctv language:rename FROM TO

ARGUMENTS
  FROM  configured language code
  TO    new language code

DESCRIPTION
  Rename a configured language and its JSON file

EXAMPLES
  $ ctv language:rename en en-US
```

_See code: [src/commands/language/rename.ts](https://github.com/4746/transverto/blob/v2.0.0-beta.3/src/commands/language/rename.ts)_

## `ctv status`

Check target dictionaries for translation problems

```
USAGE
  $ ctv status [--exclude <value>...] [--fail-on error|warning|never] [--include <value>...] [--json]
    [--language <value>...] [--problem missing|extra|empty|same|placeholder...]

FLAGS
  --exclude=<value>...   exclude exact or edge-wildcard key pattern
  --fail-on=<option>     [default: error] exit 1 when filtered findings reach this severity
                         <options: error|warning|never>
  --include=<value>...   include exact or edge-wildcard key pattern
  --json                 output a stable JSON status report
  --language=<value>...  target language code
  --problem=<option>...  problem type
                         <options: missing|extra|empty|same|placeholder>

DESCRIPTION
  Check target dictionaries for translation problems

EXAMPLES
  $ ctv status

  $ ctv status --json

  $ ctv status --language uk --problem missing --problem placeholder

  $ ctv status --include "home.*" --exclude "*.title"

  $ ctv status --fail-on warning
```

_See code: [src/commands/status.ts](https://github.com/4746/transverto/blob/v2.0.0-beta.3/src/commands/status.ts)_

## `ctv translate [TEXT]`

Translate text or configured translation keys with an AI model

```
USAGE
  $ ctv translate [TEXT] --to <value>... [--json] [--concurrency <value>] [--confirm] [--delay-ms <value>]
    [--dry-run] [--engine <value>] [--fallback <value> | --no-fallback] [--from <value>] [--key <value>...] [--max-chars
    <value>] [--max-items <value>] [--retry <value>] [--stdin] [--write]

ARGUMENTS
  [TEXT]  text to translate

FLAGS
  --concurrency=<value>  maximum simultaneous translation attempts
  --confirm              accept or skip each safe result before writing
  --delay-ms=<value>     minimum milliseconds between attempt starts
  --dry-run              validate and show requests without network calls or writes
  --engine=<value>       named engine profile
  --fallback=<value>     single fallback engine profile for this run
  --from=<value>         source language code
  --key=<value>...       translation key
  --max-chars=<value>    maximum source characters in this batch
  --max-items=<value>    maximum requests in this batch
  --no-fallback          disable the configured fallback for this run
  --retry=<value>        recoverable retries after the first attempt
  --stdin                read source text from stdin
  --to=<value>...        (required) target language code
  --write                write key translations to target dictionaries

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Translate text or configured translation keys with an AI model

EXAMPLES
  $ ctv translate "Hello" --from en --to uk

  echo "Hello" | ctv translate --stdin --to uk --to de

  $ ctv translate --key home.title --to uk

  $ ctv translate --key home.title --to uk --write

  $ ctv translate --key home.title --to uk --dry-run --json

  $ ctv translate "Hello" --to uk --fallback openrouter

  $ ctv translate "Hello" --to uk --no-fallback

  $ ctv translate --key home.title --to uk --concurrency 2 --max-items 10

  $ ctv translate --key home.title --to uk --write --confirm
```

_See code: [src/commands/translate.ts](https://github.com/4746/transverto/blob/v2.0.0-beta.3/src/commands/translate.ts)_
<!-- commandsstop -->

---

### Example config file `.ctv.config.json`
```json
{
  "basePath": "dist/i18n",
  "basePathEnum": "dist/i18n/language.ts",
  "batch": {
    "mode": "per-language",
    "concurrency": 1,
    "delayMs": 0,
    "retry": 2,
    "maxItems": null,
    "maxChars": null
  },
  "cache": {
    "maxEntries": 1000,
    "ttlMs": 2592000000
  },
  "engine": "lmstudio",
  "fallback": null,
  "engines": {
    "lmstudio": {
      "provider": "lmstudio",
      "baseUrl": "http://localhost:1234/v1",
      "model": "google/gemma-4-12b-qat",
      "timeoutMs": 30000
    }
  },
  "labelValidation": "^[a-z0-9\\.\\-\\_]{3,100}$",
  "langCodeDefault": "en",
  "languages": [
    "en",
    "uk"
  ],
  "nameEnum": "LanguageLabel"
}
```

---

Example automatically generated file `en.json`
```json
{
  "hello": {
    "world": "Hello World!",
    "world_2": "Hello World 2!",
    "world_3": "Hello World 3!"
  }
}
```

---

Example automatically generated file `language.ts`
```typescript
export enum ELanguageLabel {
  EN = 'en',
}

export type TLanguageLabel = 'hello.world'
  | 'hello.world_2'
  | 'hello.world_3';

export type TLanguageLabelOrString  = TLanguageLabel | string;
export type TLanguageLabelOrNever  = TLanguageLabel | never;
```
