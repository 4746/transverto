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
<!-- usage -->
```sh-session
$ npm install -g @cli107/transverto
$ ctv COMMAND
running command...
$ ctv (--version|-v)
@cli107/transverto/1.0.0 win32-x64 node-v18.19.0
$ ctv --help [COMMAND]
USAGE
  $ ctv COMMAND
...
```
<!-- usagestop -->

# Commands
<!-- commands -->
* [`ctv cache`](#ctv-cache)
* [`ctv help [COMMANDS]`](#ctv-help-commands)
* [`ctv init`](#ctv-init)
* [`ctv label [ADD] [DELETE] [GET] [REPLACE] [SYNC]`](#ctv-label-add-delete-get-replace-sync)
* [`ctv label:add [LABEL]`](#ctv-labeladd-label)
* [`ctv label:delete LABEL`](#ctv-labeldelete-label)
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

_See code: [src/commands/cache.ts](https://github.com/4746/transverto/blob/v1.0.0/src/commands/cache.ts)_

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

_See code: [src/commands/init.ts](https://github.com/4746/transverto/blob/v1.0.0/src/commands/init.ts)_

## `ctv label [ADD] [DELETE] [GET] [REPLACE] [SYNC]`

Represents a label management command.

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
  Represents a label management command.
```

_See code: [src/commands/label/index.ts](https://github.com/4746/transverto/blob/v1.0.0/src/commands/label/index.ts)_

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

_See code: [src/commands/label/add.ts](https://github.com/4746/transverto/blob/v1.0.0/src/commands/label/add.ts)_

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

_See code: [src/commands/label/delete.ts](https://github.com/4746/transverto/blob/v1.0.0/src/commands/label/delete.ts)_

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

_See code: [src/commands/label/replace.ts](https://github.com/4746/transverto/blob/v1.0.0/src/commands/label/replace.ts)_

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

_See code: [src/commands/label/sync.ts](https://github.com/4746/transverto/blob/v1.0.0/src/commands/label/sync.ts)_
<!-- commandsstop -->

---

### Example config file `.ctv.config.json`
```json
{
  "basePath": "dist/i18n",
  "basePathEnum": "dist/i18n/language.ts",
  "bing": {
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0"
  },
  "engine": "bing",
  "engineUseCache": false,
  "labelValidation": "^[a-z0-9\\.\\-\\_]{3,100}$",
  "languages": [
    "en"
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
