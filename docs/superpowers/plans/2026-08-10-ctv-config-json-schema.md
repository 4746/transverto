# `.ctv.config.json` JSON Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a strict JSON Schema for `.ctv.config.json` and make `ctv init` reference it automatically so editors provide completion, documentation, and early validation.

**Architecture:** Keep the schema as a hand-authored Draft 2020-12 artifact under `schema/`, with a shared URL constant used by generated configuration objects and tests. Runtime validation remains authoritative for cross-field relationships; schema tests use Ajv only as a development dependency. Existing configuration files remain loadable because `$schema` is optional in the TypeScript interface, while newly generated files always receive it from `CONFIG_DEFAULT` and `buildConfig`.

**Tech Stack:** TypeScript 6, Node.js 24 test runner, JSON Schema Draft 2020-12, Ajv 8, oclif, npm.

## Global Constraints

- The public schema URL is exactly `https://raw.githubusercontent.com/4746/transverto/main/schema/ctv.config.schema.json`.
- Set `additionalProperties: false` at the root and in fixed-shape objects.
- Permit dynamic property names only in `engines`, and validate every engine profile strictly.
- Keep existing `.ctv.config.json` files without `$schema` readable by the CLI.
- Keep runtime validation authoritative for relationships JSON Schema cannot express: source language membership, engine/fallback key lookup, and primary/fallback inequality.
- Preserve the user's pre-existing `package.json` version edit; do not include that unrelated hunk in feature commits.

---

## File map

- Create `schema/ctv.config.schema.json`: published editor contract for the configuration file.
- Create `test/unit/config-schema.test.mjs`: Ajv-based positive and negative schema tests.
- Modify `src/shared/constants.ts`: own the canonical public schema URL.
- Modify `src/shared/config.ts`: model optional schema metadata and include it in defaults.
- Modify `src/shared/config-builder.ts`: emit `$schema` first in newly built configurations.
- Modify `test/e2e/init.test.mjs`: verify automatic reference and serialized key order.
- Modify `test/helpers/project-fixture.mjs`: make representative test configurations schema-valid.
- Modify `test/e2e/language-remove.test.mjs`: prove config-rewriting commands preserve metadata.
- Modify `package.json`: add Ajv as a dev dependency and publish the `/schema` directory.
- Modify `README.md`: show the automatic `$schema` property in the example.

### Task 1: Emit schema metadata from `ctv init`

**Files:**
- Modify: `src/shared/constants.ts`
- Modify: `src/shared/config.ts`
- Modify: `src/shared/config-builder.ts`
- Modify: `test/e2e/init.test.mjs`
- Modify: `test/helpers/project-fixture.mjs`

**Interfaces:**
- Produces: `CTV_CONFIG_SCHEMA_URL: string` exported by `src/shared/constants.ts`.
- Produces: optional `IConfig.$schema?: string` for legacy-load compatibility.
- Produces: `buildConfig(input): IConfig` with `$schema` inserted first and set to `CTV_CONFIG_SCHEMA_URL`.

- [ ] **Step 1: Write failing init assertions**

Import `CTV_CONFIG_SCHEMA_URL` from the built constants module and inspect both parsed and raw configuration output:

```js
import {CTV_CONFIG_SCHEMA_URL} from '../../dist/shared/constants.js'

// In "init creates a minimal project with configured language files":
const configText = await fs.promises.readFile(project.configFile, 'utf8')
const config = JSON.parse(configText)
assert.equal(config.$schema, CTV_CONFIG_SCHEMA_URL)
assert.match(configText, /^\{\n  "\$schema":/)
```

- [ ] **Step 2: Run the focused e2e test and verify failure**

Run: `npm run build && node --test test/e2e/init.test.mjs`

Expected: FAIL because `CTV_CONFIG_SCHEMA_URL` and `config.$schema` do not exist yet.

- [ ] **Step 3: Add the shared URL and optional config property**

Add to `src/shared/constants.ts`:

```ts
export const CTV_CONFIG_SCHEMA_URL =
  'https://raw.githubusercontent.com/4746/transverto/main/schema/ctv.config.schema.json'
```

Import it into `src/shared/config.ts`, add the optional interface field, and make it the first default property:

```ts
import {CTV_CONFIG_SCHEMA_URL} from './constants.js'

export interface IConfig {
  $schema?: string
  // existing properties remain unchanged
}

export const CONFIG_DEFAULT: IConfig & {batch: ITranslationBatchConfig} = {
  $schema: CTV_CONFIG_SCHEMA_URL,
  // existing defaults remain unchanged
}
```

Import the constant into `src/shared/config-builder.ts` and explicitly emit it first:

```ts
return {
  $schema: CTV_CONFIG_SCHEMA_URL,
  basePath: validated.translationsPath,
  // remaining existing properties
}
```

Add the same first property to `createConfig()` in `test/helpers/project-fixture.mjs` by importing the built constant:

```js
import {CTV_CONFIG_SCHEMA_URL} from '../../dist/shared/constants.js'

export const createConfig = (options = {}) => ({
  $schema: CTV_CONFIG_SCHEMA_URL,
  // existing fixture properties
})
```

- [ ] **Step 4: Run the focused tests and verify success**

Run: `npm run build && node --test test/e2e/init.test.mjs test/unit/project-fixture.test.mjs`

Expected: all tests PASS, and generated configuration begins with `$schema`.

- [ ] **Step 5: Commit only Task 1 files**

```bash
git add src/shared/constants.ts src/shared/config.ts src/shared/config-builder.ts test/e2e/init.test.mjs test/helpers/project-fixture.mjs
git commit -m "feat: add schema reference to generated config"
```

### Task 2: Add and validate the strict Draft 2020-12 schema

**Files:**
- Create: `schema/ctv.config.schema.json`
- Create: `test/unit/config-schema.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `CTV_CONFIG_SCHEMA_URL` and `createConfig()` from Task 1.
- Produces: a Draft 2020-12 schema whose `$id` equals `CTV_CONFIG_SCHEMA_URL`.
- Produces: Ajv 8 as a development-only validation dependency.

- [ ] **Step 1: Install the development validator without changing runtime dependencies**

Run: `npm install --save-dev ajv@^8.17.1`

Inspect `git diff -- package.json` and preserve the pre-existing version change. During the later commit, stage only the Ajv hunk from `package.json`, leaving the version hunk unstaged.

- [ ] **Step 2: Write the failing schema test**

Create `test/unit/config-schema.test.mjs`:

```js
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'

import Ajv2020 from 'ajv/dist/2020.js'

import {CTV_CONFIG_SCHEMA_URL} from '../../dist/shared/constants.js'
import {createConfig} from '../helpers/project-fixture.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))
const schemaFile = path.resolve(directory, '../../schema/ctv.config.schema.json')
const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'))
const validate = new Ajv2020({allErrors: true}).compile(schema)

const assertValid = value => {
  assert.equal(validate(value), true, JSON.stringify(validate.errors, null, 2))
}

const assertInvalid = value => {
  assert.equal(validate(value), false)
  assert.ok(validate.errors?.length)
}

test('schema identity matches generated configuration metadata', () => {
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema')
  assert.equal(schema.$id, CTV_CONFIG_SCHEMA_URL)
  assert.equal(createConfig().$schema, CTV_CONFIG_SCHEMA_URL)
})

test('schema accepts minimal and configured engine profiles', () => {
  assertValid(createConfig())
  assertValid(createConfig({
    engine: 'local',
    engines: {
      local: {
        baseUrl: 'http://localhost:1234/v1',
        model: 'local-model',
        provider: 'openai-compatible',
      },
    },
    fallback: null,
  }))
  assertValid(createConfig({
    engine: 'cloud',
    engines: {
      cloud: {
        apiKeyEnv: 'CTV_GOOGLE_AI_API_KEY',
        model: 'gemini-model',
        provider: 'google-ai',
        reasoning: true,
        temperature: 0.5,
        timeoutMs: 30_000,
      },
    },
  }))
})

test('schema rejects invalid fields and values', () => {
  const invalid = [
    {...createConfig(), unexpected: true},
    createConfig({batch: {concurrency: 1, delayMs: 0, maxChars: null, maxItems: null, mode: 'per-language', retry: 2, unexpected: true}}),
    createConfig({languages: ['EN']}),
    createConfig({basePath: '/absolute/path'}),
    createConfig({labelSuggestionCount: 0}),
    createConfig({cache: {maxEntries: 0, ttlMs: null}}),
    createConfig({engine: 'x', engines: {x: {model: 'm', provider: 'unknown'}}}),
    createConfig({engine: 'x', engines: {x: {baseUrl: 'ftp://example.com', model: 'm', provider: 'openai-compatible'}}}),
    createConfig({engine: 'x', engines: {x: {apiKeyEnv: 'INVALID-NAME', model: 'm', provider: 'google-ai'}}}),
    createConfig({engine: 'x', engines: {x: {apiKeyEnv: 'KEY', model: 'm', provider: 'google-ai', temperature: 3}}}),
    createConfig({engine: 'x', engines: {x: {model: 'm', provider: 'google-ai'}}}),
    createConfig({engine: 'x', engines: {x: {model: 'm', provider: 'openai-compatible'}}}),
  ]

  for (const value of invalid) assertInvalid(value)
})
```

- [ ] **Step 3: Run the schema test and verify failure**

Run: `npm run build && node --test test/unit/config-schema.test.mjs`

Expected: FAIL with `ENOENT` because `schema/ctv.config.schema.json` does not exist.

- [ ] **Step 4: Create the schema contract**

Create `schema/ctv.config.schema.json` with this structure and exact constraints:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://raw.githubusercontent.com/4746/transverto/main/schema/ctv.config.schema.json",
  "title": "Transverto configuration",
  "description": "Configuration for Transverto translation files, batching, caching, and AI engine profiles.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "$schema", "basePath", "basePathEnum", "batch", "cache", "engine", "engines",
    "fallback", "labelSuggestionCount", "labelSuggestionShowInvalid", "labelValidation",
    "langCodeDefault", "languages", "nameEnum"
  ],
  "properties": {
    "$schema": {
      "const": "https://raw.githubusercontent.com/4746/transverto/main/schema/ctv.config.schema.json",
      "description": "Enables editor validation and completion for this file."
    },
    "basePath": {
      "$ref": "#/$defs/projectPath",
      "description": "Project-relative directory containing one JSON dictionary per language.",
      "default": "dist/i18n",
      "examples": ["dist/i18n"]
    },
    "basePathEnum": {
      "allOf": [{"$ref": "#/$defs/projectPath"}, {"pattern": "\\.ts$"}],
      "description": "Project-relative path of the generated TypeScript language types.",
      "default": "dist/i18n/language.ts",
      "examples": ["dist/i18n/language.ts"]
    },
    "batch": {"$ref": "#/$defs/batch"},
    "cache": {"$ref": "#/$defs/cache"},
    "engine": {"$ref": "#/$defs/profileReference"},
    "engines": {
      "type": "object",
      "description": "Named AI translation engine profiles.",
      "propertyNames": {"pattern": "^[a-z0-9][a-z0-9._-]*$"},
      "additionalProperties": {"$ref": "#/$defs/engineProfile"},
      "default": {}
    },
    "fallback": {"$ref": "#/$defs/profileReference"},
    "labelSuggestionCount": {
      "type": "integer", "minimum": 1, "default": 5,
      "description": "Number of localization-key suggestions to request."
    },
    "labelSuggestionShowInvalid": {
      "type": "boolean", "default": false,
      "description": "Whether label suggestions that fail labelValidation are shown."
    },
    "labelValidation": {
      "type": "string", "minLength": 1,
      "default": "^[a-z0-9\\.\\_]{2,100}$",
      "description": "JavaScript regular expression used to validate localization keys."
    },
    "langCodeDefault": {"$ref": "#/$defs/languageCode"},
    "languages": {
      "type": "array", "minItems": 1, "uniqueItems": true,
      "items": {"$ref": "#/$defs/languageCode"},
      "default": ["en"], "examples": [["en", "uk"]],
      "description": "Configured language codes in output order."
    },
    "nameEnum": {
      "type": "string", "minLength": 1, "default": "LanguageLabel",
      "description": "Base name used for generated TypeScript language types."
    }
  },
  "$defs": {
    "projectPath": {
      "type": "string", "minLength": 1,
      "allOf": [
        {"not": {"pattern": "^(?:[A-Za-z]:[\\\\/]|[\\\\/])"}},
        {"not": {"pattern": "(^|[\\\\/])\\.\\.($|[\\\\/])"}}
      ]
    },
    "languageCode": {
      "type": "string", "pattern": "^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$",
      "examples": ["en", "uk", "en-US", "zh-Hans"]
    },
    "profileReference": {
      "description": "Configured engine profile name, or null to disable it.",
      "oneOf": [{"type": "string", "minLength": 1}, {"type": "null"}],
      "default": null
    },
    "batch": {
      "type": "object", "additionalProperties": false,
      "required": ["concurrency", "delayMs", "maxChars", "maxItems", "mode", "retry"],
      "properties": {
        "concurrency": {"type": "integer", "minimum": 1, "default": 1},
        "delayMs": {"type": "integer", "minimum": 0, "default": 0},
        "maxChars": {"oneOf": [{"type": "integer", "minimum": 1}, {"type": "null"}], "default": null},
        "maxItems": {"oneOf": [{"type": "integer", "minimum": 1}, {"type": "null"}], "default": null},
        "mode": {"enum": ["per-language", "multi-language"], "default": "per-language"},
        "retry": {"type": "integer", "minimum": 0, "default": 2}
      }
    },
    "cache": {
      "type": "object", "additionalProperties": false,
      "required": ["maxEntries", "ttlMs"],
      "properties": {
        "maxEntries": {"type": "integer", "minimum": 1, "default": 1000},
        "ttlMs": {"oneOf": [{"type": "integer", "minimum": 1}, {"type": "null"}], "default": 2592000000}
      }
    },
    "engineProfile": {
      "type": "object", "additionalProperties": false,
      "required": ["model", "provider"],
      "properties": {
        "apiKeyEnv": {"type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*$", "examples": ["CTV_OPENROUTER_API_KEY"]},
        "baseUrl": {"type": "string", "pattern": "^https?://", "examples": ["http://localhost:1234/v1"]},
        "labelSuggestionPrompt": {"type": "string"},
        "model": {"type": "string", "minLength": 1},
        "provider": {"enum": ["lmstudio", "google-ai", "openrouter", "openai-compatible"]},
        "reasoning": {"type": "boolean"},
        "systemPrompt": {"type": "string"},
        "temperature": {"type": "number", "minimum": 0, "maximum": 2},
        "timeoutMs": {"type": "integer", "minimum": 1, "default": 30000}
      },
      "allOf": [
        {
          "if": {"properties": {"provider": {"enum": ["google-ai", "openrouter"]}}, "required": ["provider"]},
          "then": {"required": ["apiKeyEnv"]}
        },
        {
          "if": {"properties": {"provider": {"const": "openai-compatible"}}, "required": ["provider"]},
          "then": {"required": ["baseUrl"]}
        }
      ]
    }
  }
}
```

- [ ] **Step 5: Run the schema tests and verify success**

Run: `npm run build && node --test test/unit/config-schema.test.mjs`

Expected: all three schema tests PASS.

- [ ] **Step 6: Commit the schema, tests, and only the Ajv package hunk**

Stage the two whole new files, then stage only the `ajv` addition from `package.json` with interactive patch staging so the existing version edit remains unstaged:

```bash
git add schema/ctv.config.schema.json test/unit/config-schema.test.mjs
git add -p package.json
git diff --cached --check
git commit -m "feat: add ctv configuration schema"
```

### Task 3: Publish, document, and preserve the schema reference

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `test/e2e/language-remove.test.mjs`

**Interfaces:**
- Consumes: `CTV_CONFIG_SCHEMA_URL` and schema artifact from Tasks 1–2.
- Produces: npm tarballs containing `schema/ctv.config.schema.json`.
- Guarantees: language configuration rewrites retain the existing `$schema` value.

- [ ] **Step 1: Add a failing preservation assertion**

In `test/e2e/language-remove.test.mjs`, import the constant and extend the first successful removal test:

```js
import {CTV_CONFIG_SCHEMA_URL} from '../../dist/shared/constants.js'

const config = await readJson(project.configFile)
assert.deepEqual(config.languages, ['en', 'uk'])
assert.equal(config.$schema, CTV_CONFIG_SCHEMA_URL)
```

- [ ] **Step 2: Run the focused preservation test**

Run: `npm run build && node --test test/e2e/language-remove.test.mjs`

Expected: PASS if Task 1's fixture and existing spread-based rewrite preserve metadata. If it fails, update `LanguageProjectService.withConfig()` to return `{...this.config, ...changes}` without selecting known fields, then rerun until PASS.

- [ ] **Step 3: Add schema publication and README documentation**

Add `/schema` to the existing `files` array in `package.json`:

```json
"files": [
  "/bin",
  "/dist",
  "/schema",
  "/oclif.manifest.json"
]
```

Add `$schema` as the first property of the README example:

```json
{
  "$schema": "https://raw.githubusercontent.com/4746/transverto/main/schema/ctv.config.schema.json",
  "basePath": "dist/i18n"
}
```

Keep all other fields already present in the example.

- [ ] **Step 4: Verify the distributable contains the schema**

Run: `npm pack --dry-run --json`

Expected: the JSON file list contains `schema/ctv.config.schema.json`.

- [ ] **Step 5: Run complete verification**

Run: `npm test`

Expected: build, all Node tests, and lint PASS.

Run: `npm run build`

Expected: TypeScript compilation PASS with no diagnostics.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 6: Commit documentation, publication, and preservation coverage**

Stage README and the preservation test. Stage only the `/schema` files-array hunk from `package.json`, leaving the user's version hunk unstaged:

```bash
git add README.md test/e2e/language-remove.test.mjs
git add -p package.json
git diff --cached --check
git commit -m "docs: publish ctv config schema"
```

After the commit, run `git status --short` and confirm that only the user's pre-existing `package.json` version edit remains.
