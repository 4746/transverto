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
      "apiKeyEnv": "GEMINI_API_KEY"
    },
    "openrouter": {
      "provider": "openrouter",
      "model": "openrouter/free",
      "apiKeyEnv": "OPENROUTER_API_KEY"
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
$env:GEMINI_API_KEY = "..."

# bash/zsh
export GEMINI_API_KEY="..."
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
* [`ctv init`](#ctv-init)
* [`ctv label [ADD] [DELETE] [GET] [REPLACE] [SYNC]`](#ctv-label-add-delete-get-replace-sync)
* [`ctv label:add [LABEL]`](#ctv-labeladd-label)
* [`ctv label:delete LABEL`](#ctv-labeldelete-label)
* [`ctv label:get [LABEL]`](#ctv-labelget-label)
* [`ctv label:replace LABEL`](#ctv-labelreplace-label)
* [`ctv label:sync`](#ctv-labelsync)
* [`ctv language:add CODE`](#ctv-languageadd-code)
* [`ctv language:list`](#ctv-languagelist)
* [`ctv language:remove CODE`](#ctv-languageremove-code)
* [`ctv language:rename FROM TO`](#ctv-languagerename-from-to)
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

_See code: [src/commands/cache/clear.ts](https://github.com/4746/transverto/blob/v1.3.1/src/commands/cache/clear.ts)_

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

_See code: [src/commands/cache/list.ts](https://github.com/4746/transverto/blob/v1.3.1/src/commands/cache/list.ts)_

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

_See code: [src/commands/cache/prune.ts](https://github.com/4746/transverto/blob/v1.3.1/src/commands/cache/prune.ts)_

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

_See code: [src/commands/doctor.ts](https://github.com/4746/transverto/blob/v1.3.1/src/commands/doctor.ts)_

## `ctv export:csv [LANGCODE]`

Export translations to file.

```
USAGE
  $ ctv export:csv [LANGCODE] [-d <value>] [--eol cr|crlf|lf] [-i <value>] [-o <value>] [--withBOM]

ARGUMENTS
  [LANGCODE]  The language code. If not specified, all available translations are exported.

FLAGS
  -d, --delimiter=<value>   [default: ,] delimiter of columns.
  -i, --include=<value>     include language code
  -o, --outputFile=<value>  [default: dist/output.csv] Path to save the file
      --eol=<option>        [default: lf]
                            <options: cr|crlf|lf>
      --withBOM             [default: false] with BOM character

DESCRIPTION
  Export translations to file.

EXAMPLES
  $ ctv export:csv

  $ ctv export:csv en

  $ ctv export:csv en --include=uk

  $ ctv export:csv en --outputFile=dist/output.csv

  $ ctv export:csv --delimiter=,

  $ ctv export:csv --eol=lf
```

_See code: [src/commands/export/csv.ts](https://github.com/4746/transverto/blob/v1.3.1/src/commands/export/csv.ts)_

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

_See code: [src/commands/init.ts](https://github.com/4746/transverto/blob/v1.3.1/src/commands/init.ts)_

## `ctv label [ADD] [DELETE] [GET] [REPLACE] [SYNC]`

Label management command.

```
USAGE
  $ ctv label [ADD] [DELETE] [GET] [REPLACE] [SYNC]

ARGUMENTS
  [ADD]      Adds a new label.
  [DELETE]   Deletes a label.
  [GET]      Retrieves the labels.
  [REPLACE]  Replaces a label with the given value.
  [SYNC]     A command to update labels synchronously.

DESCRIPTION
  Label management command.
```

_See code: [src/commands/label/index.ts](https://github.com/4746/transverto/blob/v1.3.1/src/commands/label/index.ts)_

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

_See code: [src/commands/label/add.ts](https://github.com/4746/transverto/blob/v1.3.1/src/commands/label/add.ts)_

## `ctv label:delete LABEL`

Delete the specified label.

```
USAGE
  $ ctv label:delete LABEL [-r]

ARGUMENTS
  LABEL  A label key

FLAGS
  -r, --noReport

DESCRIPTION
  Delete the specified label.

EXAMPLES
  $ ctv label:delete hello

  $ ctv label:delete hello.world
```

_See code: [src/commands/label/delete.ts](https://github.com/4746/transverto/blob/v1.3.1/src/commands/label/delete.ts)_

## `ctv label:get [LABEL]`

Display a list of translations for the specified label

```
USAGE
  $ ctv label:get [LABEL] [--json] [-f <value>]

ARGUMENTS
  [LABEL]  A label key

FLAGS
  -f, --fromLangCode=<value>  The language code of source text.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Display a list of translations for the specified label

EXAMPLES
  $ ctv label:get

  $ ctv label:get hello.world

  $ ctv label:get hello.world -f="en"

  $ ctv label:get hello.world -fen
```

_See code: [src/commands/label/get.ts](https://github.com/4746/transverto/blob/v1.3.1/src/commands/label/get.ts)_

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

_See code: [src/commands/label/replace.ts](https://github.com/4746/transverto/blob/v1.3.1/src/commands/label/replace.ts)_

## `ctv label:sync`

Synchronizing tags in translation files...

```
USAGE
  $ ctv label:sync [--autoTranslate] [-r] [-s]

FLAGS
  -r, --noReport
  -s, --silent
  --autoTranslate

DESCRIPTION
  Synchronizing tags in translation files...

EXAMPLES
  $ ctv label:sync

  $ ctv label:sync "hello.world" -f="en"
```

_See code: [src/commands/label/sync.ts](https://github.com/4746/transverto/blob/v1.3.1/src/commands/label/sync.ts)_

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

_See code: [src/commands/language/add.ts](https://github.com/4746/transverto/blob/v1.3.1/src/commands/language/add.ts)_

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

_See code: [src/commands/language/list.ts](https://github.com/4746/transverto/blob/v1.3.1/src/commands/language/list.ts)_

## `ctv language:remove CODE`

Remove a language from the project

```
USAGE
  $ ctv language:remove CODE [--delete-file] [-f] [--source lang]

ARGUMENTS
  CODE  language code to remove

FLAGS
  -f, --force        skip deletion confirmation
      --delete-file  also delete the language JSON file
      --source=lang  replacement source language when removing the current source

DESCRIPTION
  Remove a language from the project

EXAMPLES
  $ ctv language:remove uk

  $ ctv language:remove uk --delete-file

  $ ctv language:remove en --source uk --delete-file --force
```

_See code: [src/commands/language/remove.ts](https://github.com/4746/transverto/blob/v1.3.1/src/commands/language/remove.ts)_

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

_See code: [src/commands/language/rename.ts](https://github.com/4746/transverto/blob/v1.3.1/src/commands/language/rename.ts)_

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

_See code: [src/commands/translate.ts](https://github.com/4746/transverto/blob/v1.3.1/src/commands/translate.ts)_
<!-- commandsstop -->

---

### Example config file `.ctv.config.json`
```json
{
  "basePath": "dist/i18n",
  "basePathEnum": "dist/i18n/language.ts",
  "batch": {
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
