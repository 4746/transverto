CLI transverto
=================

Label management command.

[![NPM version](http://img.shields.io/npm/v/@cli107/transverto.svg?style=flat-square)](http://npmjs.org/package/@cli107/transverto)
[![GitHub license](https://img.shields.io/github/license/4746/transverto)](https://github.com/4746/transverto/blob/main/LICENSE)


<!-- toc -->
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->

# Usage
```shell
npm install @cli107/transverto --save-dev
```

```shell
ctv --help
```

# Commands
<!-- commands -->
* [`ctv cache`](#ctv-cache)
* [`ctv export:csv [LANGCODE]`](#ctv-exportcsv-langcode)
* [`ctv help [COMMANDS]`](#ctv-help-commands)
* [`ctv init`](#ctv-init)
* [`ctv label [ADD] [DELETE] [GET] [REPLACE] [SYNC]`](#ctv-label-add-delete-get-replace-sync)
* [`ctv label:add [LABEL]`](#ctv-labeladd-label)
* [`ctv label:delete LABEL`](#ctv-labeldelete-label)
* [`ctv label:get [LABEL]`](#ctv-labelget-label)
* [`ctv label:replace LABEL`](#ctv-labelreplace-label)
* [`ctv label:sync`](#ctv-labelsync)

## `ctv cache`

Cache management command. 

```
USAGE
  $ ctv cache [-c]

FLAGS
  -c, --clear

DESCRIPTION
  Cache management command.
  Cache dir: C:\Users\User\AppData\Local\ctv

EXAMPLES
  $ ctv cache

  $ ctv cache --help
```

_See code: [src/commands/cache.ts](https://github.com/4746/transverto/blob/v1.1.0/src/commands/cache.ts)_

## `ctv export:csv [LANGCODE]`

Export translations to file.

```
USAGE
  $ ctv export:csv [LANGCODE] [-d <value>] [--eol cr|crlf|lf] [-i <value>] [-o <value>] [--withBOM]

ARGUMENTS
  LANGCODE  The language code. If not specified, all available translations are exported.

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

_See code: [src/commands/export/csv.ts](https://github.com/4746/transverto/blob/v1.1.0/src/commands/export/csv.ts)_

## `ctv help [COMMANDS]`

Display help for ctv.

```
USAGE
  $ ctv help [COMMANDS] [-n]

ARGUMENTS
  COMMANDS  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for ctv.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v6.0.12/src/commands/help.ts)_

## `ctv init`

Create a default configuration file

```
USAGE
  $ ctv init [-f]

FLAGS
  -f, --force  overwrite an existing file

DESCRIPTION
  Create a default configuration file

EXAMPLES
  $ ctv init

  $ ctv init --help

  $ ctv init --force
```

_See code: [src/commands/init.ts](https://github.com/4746/transverto/blob/v1.1.0/src/commands/init.ts)_

## `ctv label [ADD] [DELETE] [GET] [REPLACE] [SYNC]`

Label management command.

```
USAGE
  $ ctv label [ADD] [DELETE] [GET] [REPLACE] [SYNC]

ARGUMENTS
  ADD      Adds a new label.
  DELETE   Deletes a label.
  GET      Retrieves the labels.
  REPLACE  Replaces a label with the given value.
  SYNC     A command to update labels synchronously.

DESCRIPTION
  Label management command.
```

_See code: [src/commands/label/index.ts](https://github.com/4746/transverto/blob/v1.1.0/src/commands/label/index.ts)_

## `ctv label:add [LABEL]`

Add a new label

```
USAGE
  $ ctv label:add [LABEL] [-f <value>] [--noAutoTranslate] [--silent] [-t <value>]

ARGUMENTS
  LABEL  A label key

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

_See code: [src/commands/label/add.ts](https://github.com/4746/transverto/blob/v1.1.0/src/commands/label/add.ts)_

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

_See code: [src/commands/label/delete.ts](https://github.com/4746/transverto/blob/v1.1.0/src/commands/label/delete.ts)_

## `ctv label:get [LABEL]`

Display a list of translations for the specified label

```
USAGE
  $ ctv label:get [LABEL] [--json] [-f <value>]

ARGUMENTS
  LABEL  A label key

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

_See code: [src/commands/label/get.ts](https://github.com/4746/transverto/blob/v1.1.0/src/commands/label/get.ts)_

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

_See code: [src/commands/label/replace.ts](https://github.com/4746/transverto/blob/v1.1.0/src/commands/label/replace.ts)_

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

_See code: [src/commands/label/sync.ts](https://github.com/4746/transverto/blob/v1.1.0/src/commands/label/sync.ts)_
<!-- commandsstop -->

---

### Example config file `.ctv.config.json`
```json
{
  "basePath": "dist/i18n",
  "basePathEnum": "dist/i18n/language.ts",
  "bing": {
    "userAgent": "..."
  },
  "engine": "bing",
  "engineUseCache": false,
  "labelValidation": "^[a-z0-9\\.\\-\\_]{3,100}$",
  "languages": [
    "en"
  ],
  "nameEnum": "LanguageLabel",
  "userAgent": "..."
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
