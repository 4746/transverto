# Multi-language Batch Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `batch.mode: "multi-language"` pipeline that translates one source text into all uncached target languages with one AI call while retaining the current default, cache identities, fallback/retry behavior, and safe incomplete-response recovery.

**Architecture:** Extend the engine and service layers with an explicit multi-target request instead of overloading the single-target contract. Keep per-language outcomes at the batch boundary, group only identical `from + key + sourceText` requests, defer fresh cache writes until incomplete packages are resolved, and inject terminal decisions from commands through a callback so shared services remain UI-independent.

**Tech Stack:** TypeScript 6, Node.js 24, oclif 4, OpenAI-compatible `/chat/completions`, Node test runner, filesystem-backed JSON cache.

## Global Constraints

- `batch.mode` accepts exactly `per-language` and `multi-language`.
- `per-language` is the default; omitted `batch.mode` must preserve current behavior.
- One provider package contains exactly one source text/key and one or more target languages.
- Do not combine multiple source texts or localization keys in one provider call.
- Keep `TranslationEngine.translate()` and the single-language prompt response format unchanged.
- Use a dedicated multi-language prompt that requests a top-level JSON object of `language -> translation` without Markdown or metadata.
- Do not require provider-specific structured-output options such as `response_format`.
- Cache lookup and storage remain per target language with the existing cache identity.
- A full-package failure retains the current primary/fallback/error classification and outer retry behavior.
- An incomplete response never triggers per-language calls without an interactive user's approval.
- If prompting is unavailable, cancel the entire translation operation, write no target files, and cache no fresh results.
- Canceling `label:add` does not roll back its already-written source value.
- `maxItems` and `maxChars` apply before grouping; `concurrency`, `delayMs`, and `retry` operate on packages in multi-language mode.
- Preserve stable configured-language order in requests, results, and reports.
- Add no runtime dependency.

---

## File structure

- `src/shared/entities/translation.engine.ts`: engine requests, raw multi-language response, and normalized service-attempt contracts.
- `src/shared/entities/translation-batch.ts`: mode, incomplete metadata, decisions, reasons, and output envelope.
- `src/shared/translation-batch.config.ts`: mode default and validation.
- `src/shared/multi-language-response.ts`: strict JSON-object parsing and per-target structural classification.
- `src/shared/engines/openai-compatible.engine.ts`: dedicated batch prompt plus shared HTTP completion transport.
- `src/shared/translation.service.ts`: per-target cache lookup, package primary/fallback, placeholder validation, result normalization, and explicit cache commit.
- `src/shared/translation-batch.service.ts`: grouping, package scheduling/retries, serialized decisions, recovery, cancellation, and final cache commit.
- `src/shared/translation-incomplete.prompt.ts`: reusable command-layer prompt adapter.
- `src/commands/translate.ts` and `src/commands/label/sync.ts`: inject interactive decisions, suppress writes on cancellation, and render incomplete metadata.
- `src/shared/sync-report.ts`: human sync rendering for incomplete packages.
- `test/unit/*.test.mjs`: focused config, parser, service, and scheduler behavior.
- `test/e2e/translate.test.mjs` and `test/e2e/label-mutations.test.mjs`: observable request count, fallback, non-TTY cancellation, and `label:add` integration.
- `test/helpers/project-fixture.mjs`: explicit default mode in generated fixtures.
- `README.md`: configuration and operational semantics.

---

### Task 1: Add configuration mode and domain contracts

**Files:**
- Modify: `src/shared/entities/translation-batch.ts`
- Modify: `src/shared/entities/translation.engine.ts`
- Modify: `src/shared/translation-batch.config.ts`
- Modify: `src/shared/translation-batch.service.ts`
- Modify: `src/commands/translate.ts`
- Modify: `test/helpers/project-fixture.mjs`
- Create: `test/unit/translation-batch.config.test.mjs`

**Interfaces:**
- Produces: `TTranslationBatchMode`, `IMultiLanguageTranslationRequestPlan`, `IMultiLanguageEngineResponse`, `IMultiLanguageTranslationAttempt`, `IIncompleteTranslationBatch`, and `TIncompleteBatchDecision`.
- Produces: `resolveTranslationBatchConfig(...).mode: 'per-language' | 'multi-language'` for all later tasks.

- [ ] **Step 1: Write failing configuration tests**

Create `test/unit/translation-batch.config.test.mjs`:

```js
import assert from 'node:assert/strict'
import {test} from 'node:test'

import {
  resolveTranslationBatchConfig,
  TRANSLATION_BATCH_DEFAULTS,
} from '../../dist/shared/translation-batch.config.js'

test('batch mode defaults to per-language', () => {
  assert.equal(TRANSLATION_BATCH_DEFAULTS.mode, 'per-language')
  assert.equal(resolveTranslationBatchConfig(undefined).mode, 'per-language')
  assert.equal(resolveTranslationBatchConfig({concurrency: 2}).mode, 'per-language')
})

test('batch mode accepts multi-language', () => {
  assert.equal(resolveTranslationBatchConfig({mode: 'multi-language'}).mode, 'multi-language')
})

test('batch mode rejects unknown values', () => {
  assert.throws(
    () => resolveTranslationBatchConfig({mode: 'provider-native'}),
    /batch\.mode must be "per-language" or "multi-language"/,
  )
})
```

- [ ] **Step 2: Build and verify the tests fail for the missing mode**

Run:

```powershell
npm run build
node --test test/unit/translation-batch.config.test.mjs
```

Expected: FAIL because `TRANSLATION_BATCH_DEFAULTS.mode` is undefined and `mode` is currently an unknown key.

- [ ] **Step 3: Add the mode and incomplete-response types**

In `src/shared/entities/translation-batch.ts`, add these exact contracts and add `mode` to `ITranslationBatchConfig`:

```ts
export type TTranslationBatchMode = 'multi-language' | 'per-language'
export type TIncompleteBatchDecision = 'cancel' | 'per-language'
export type TIncompleteTargetReason =
  | 'empty'
  | 'malformed_json'
  | 'missing'
  | 'non_string'
  | 'not_object'
  | 'placeholder'

export interface IIncompleteTarget {
  reason: TIncompleteTargetReason
  target: string
}

export interface IIncompleteTranslationBatch {
  decision: TIncompleteBatchDecision
  from: string
  invalid: IIncompleteTarget[]
  key?: string
  requestedTargets: string[]
  sourceText: string
  unexpectedTargets: string[]
  validTargets: string[]
}

export interface ITranslationBatchConfig {
  concurrency: number
  delayMs: number
  maxChars: null | number
  maxItems: null | number
  mode: TTranslationBatchMode
  retry: number
}
```

Extend `TTranslationRemainingReason` and `ITranslationBatchOutput`:

```ts
export type TTranslationRemainingReason = 'dry_run' | 'incomplete_batch' | 'limit'

export interface ITranslationBatchOutput {
  conflicts: ITranslationConflict[]
  failed: ITranslationFailed[]
  incomplete: IIncompleteTranslationBatch[]
  remaining: ITranslationRemaining[]
  results: ITranslationResult[]
  skipped: ITranslationSkipped[]
  summary: ITranslationBatchSummary
}
```

In `src/shared/entities/translation.engine.ts`, add:

```ts
import type {
  IIncompleteTarget,
} from './translation-batch.js'

export interface IMultiLanguageTranslationRequestPlan {
  from: string
  key?: string
  sourceText: string
  targets: string[]
}

export interface IMultiLanguageEngineResponse {
  issues: IIncompleteTarget[]
  translations: Record<string, string>
  unexpectedTargets: string[]
}

export interface IMultiLanguageTranslationAttempt extends IMultiLanguageEngineResponse {
  request: IMultiLanguageTranslationRequestPlan
  results: ITranslationResult[]
}

export interface TranslationEngine {
  translate(request: ITranslationRequestPlan): Promise<string>
  translateBatch?(request: IMultiLanguageTranslationRequestPlan): Promise<IMultiLanguageEngineResponse>
}
```

The method is optional at the base engine boundary so this contracts commit remains buildable
before Task 2 implements it. `TranslationService.translateBatch()` must reject a missing method as
a configuration error before use.

- [ ] **Step 4: Validate and default the new setting**

In `src/shared/translation-batch.config.ts`, add `mode: 'per-language'` to defaults, add `mode` to `BATCH_CONFIG_KEYS`, and validate it before returning:

```ts
const validateMode = (value: unknown): ITranslationBatchConfig['mode'] => {
  if (value !== 'per-language' && value !== 'multi-language') {
    throw new Error('batch.mode must be "per-language" or "multi-language".')
  }

  return value
}

return {
  concurrency: validateInteger('concurrency', merged.concurrency, 1),
  delayMs: validateInteger('delayMs', merged.delayMs, 0),
  maxChars: validateLimit('maxChars', merged.maxChars),
  maxItems: validateLimit('maxItems', merged.maxItems),
  mode: validateMode(merged.mode),
  retry: validateInteger('retry', merged.retry, 0),
}
```

Add `mode: 'per-language'` to the test fixture's `batch` object in `test/helpers/project-fixture.mjs`.

Add `incomplete: []` to the output assembled by `TranslationBatchService.execute()`. In
`Translate.confirmResults`, preserve the field in the recomputed outcome:

```ts
const outcomes = {
  conflicts: batch.conflicts,
  failed: batch.failed,
  incomplete: batch.incomplete,
  remaining: batch.remaining,
  results,
  skipped,
}
```

- [ ] **Step 5: Run the focused tests**

Run:

```powershell
npm run build
node --test test/unit/translation-batch.config.test.mjs
```

Expected: all three tests PASS.

- [ ] **Step 6: Commit the configuration and contracts**

```powershell
git add src/shared/entities/translation-batch.ts src/shared/entities/translation.engine.ts src/shared/translation-batch.config.ts src/shared/translation-batch.service.ts src/commands/translate.ts test/helpers/project-fixture.mjs test/unit/translation-batch.config.test.mjs
git commit -m "feat: define multi-language batch contracts"
```

---

### Task 2: Implement the dedicated prompt and strict response parser

**Files:**
- Create: `src/shared/multi-language-response.ts`
- Modify: `src/shared/engines/openai-compatible.engine.ts`
- Create: `test/unit/multi-language-response.test.mjs`

**Interfaces:**
- Consumes: `IMultiLanguageTranslationRequestPlan` and `IMultiLanguageEngineResponse` from Task 1.
- Produces: `parseMultiLanguageCompletion(content, targets)` and `OpenAICompatibleEngine.translateBatch(request)`.

- [ ] **Step 1: Write parser tests for complete and partial responses**

Create `test/unit/multi-language-response.test.mjs`:

```js
import assert from 'node:assert/strict'
import {test} from 'node:test'

import {parseMultiLanguageCompletion} from '../../dist/shared/multi-language-response.js'

test('parses requested translations in requested order', () => {
  assert.deepEqual(
    parseMultiLanguageCompletion('{"de":"Sprache","uk":"Мова"}', ['uk', 'de']),
    {
      issues: [],
      translations: {uk: 'Мова', de: 'Sprache'},
      unexpectedTargets: [],
    },
  )
})

test('classifies missing, empty, non-string, and unexpected targets', () => {
  assert.deepEqual(
    parseMultiLanguageCompletion('{"uk":"Мова","de":"","fr":5,"xx":"extra"}', ['uk', 'de', 'fr', 'es']),
    {
      issues: [
        {reason: 'empty', target: 'de'},
        {reason: 'non_string', target: 'fr'},
        {reason: 'missing', target: 'es'},
      ],
      translations: {uk: 'Мова'},
      unexpectedTargets: ['xx'],
    },
  )
})

test('classifies malformed and non-object completions for every target', () => {
  assert.deepEqual(
    parseMultiLanguageCompletion('```json\n{}\n```', ['uk', 'de']).issues,
    [
      {reason: 'malformed_json', target: 'uk'},
      {reason: 'malformed_json', target: 'de'},
    ],
  )
  assert.deepEqual(
    parseMultiLanguageCompletion('[]', ['uk']).issues,
    [{reason: 'not_object', target: 'uk'}],
  )
})
```

- [ ] **Step 2: Build and verify the parser tests fail**

Run:

```powershell
npm run build
node --test test/unit/multi-language-response.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `multi-language-response.js`.

- [ ] **Step 3: Implement the parser**

Create `src/shared/multi-language-response.ts` with a plain-object guard, one `JSON.parse`, requested-order iteration, trimmed non-empty string acceptance, and unexpected-key collection:

```ts
import type {IMultiLanguageEngineResponse} from './entities/translation.engine.js'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const allInvalid = (
  targets: string[],
  reason: 'malformed_json' | 'not_object',
): IMultiLanguageEngineResponse => ({
  issues: targets.map(target => ({reason, target})),
  translations: {},
  unexpectedTargets: [],
})

export const parseMultiLanguageCompletion = (
  content: string,
  targets: string[],
): IMultiLanguageEngineResponse => {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return allInvalid(targets, 'malformed_json')
  }

  if (!isPlainObject(parsed)) return allInvalid(targets, 'not_object')
  const requested = new Set(targets)
  const issues: IMultiLanguageEngineResponse['issues'] = []
  const translations: Record<string, string> = {}

  for (const target of targets) {
    if (!Object.hasOwn(parsed, target)) issues.push({reason: 'missing', target})
    else if (typeof parsed[target] !== 'string') issues.push({reason: 'non_string', target})
    else if (parsed[target].trim().length === 0) issues.push({reason: 'empty', target})
    else translations[target] = parsed[target].trim()
  }

  return {
    issues,
    translations,
    unexpectedTargets: Object.keys(parsed).filter(target => !requested.has(target)),
  }
}
```

- [ ] **Step 4: Add a failing engine test for the dedicated batch prompt**

Add this import and test to `test/unit/multi-language-response.test.mjs`:

```js
import {OpenAICompatibleEngine} from '../../dist/shared/engines/openai-compatible.engine.js'

test('engine uses one JSON-only completion for all requested targets', async () => {
  const requests = []
  const fetchImplementation = async (url, init) => {
    requests.push({body: JSON.parse(init.body), url})
    return new Response(JSON.stringify({
      choices: [{message: {content: '{"uk":"Мова","de":"Sprache"}'}}],
    }), {headers: {'content-type': 'application/json'}, status: 200})
  }
  const engine = new OpenAICompatibleEngine({
    baseUrl: 'http://fixture.test/v1',
    model: 'fixture-model',
    name: 'fixture',
    provider: 'openai-compatible',
    timeoutMs: 1000,
  }, fetchImplementation)

  const result = await engine.translateBatch({
    from: 'en', key: 'label.language', sourceText: 'Language', targets: ['uk', 'de'],
  })

  assert.equal(requests.length, 1)
  const system = requests[0].body.messages[0].content
  assert.match(system, /Return exactly one JSON object/)
  assert.match(system, /uk, de/)
  assert.deepEqual(result.translations, {uk: 'Мова', de: 'Sprache'})
})
```

Expected before engine implementation: FAIL because `engine.translateBatch` is undefined.

- [ ] **Step 5: Refactor the engine transport and add the batch prompt**

In `src/shared/engines/openai-compatible.engine.ts`:

1. Keep `buildSystemPrompt` semantically unchanged.
2. Add `buildBatchSystemPrompt(request)` containing the existing UI-localization guidance plus the exact JSON-only contract.
3. Extract the shared authentication, `/chat/completions` fetch, status classification, response parsing, and non-empty content validation into `private async completion(systemPrompt, userContent): Promise<string>`.
4. Implement both public methods:

```ts
async translate(request: ITranslationRequestPlan): Promise<string> {
  return this.completion(buildSystemPrompt(request), request.sourceText)
}

async translateBatch(
  request: IMultiLanguageTranslationRequestPlan,
): Promise<IMultiLanguageEngineResponse> {
  const content = await this.completion(
    buildBatchSystemPrompt(request),
    request.sourceText,
  )
  return parseMultiLanguageCompletion(content, request.targets)
}
```

The batch prompt must include this output instruction verbatim so the engine assertion is stable:

```ts
`Return exactly one JSON object with one property for every requested target language.`,
`Use each requested language code as the property name and its translated text as the string value.`,
`Do not return Markdown fences, explanations, metadata, nested objects, arrays, or unrequested language codes.`,
```

- [ ] **Step 6: Run parser and engine tests**

Run:

```powershell
npm run build
node --test test/unit/multi-language-response.test.mjs
```

Expected: all parser and engine tests PASS.

- [ ] **Step 7: Commit parser and engine support**

```powershell
git add src/shared/multi-language-response.ts src/shared/engines/openai-compatible.engine.ts test/unit/multi-language-response.test.mjs
git commit -m "feat: add multi-language engine prompt"
```

---

### Task 3: Add cache-aware package execution to TranslationService

**Files:**
- Modify: `src/shared/translation.service.ts`
- Create: `test/unit/multi-language-translation.service.test.mjs`

**Interfaces:**
- Consumes: `TranslationEngine.translateBatch()` and `IMultiLanguageTranslationAttempt`.
- Produces: `TranslationService.translateBatch(request): Promise<IMultiLanguageTranslationAttempt>`.
- Produces: `TranslationService.cacheResults(results: ITranslationResult[]): Promise<void>` for Task 4's final commit gate.

- [ ] **Step 1: Write failing cache and placeholder tests**

Create `test/unit/multi-language-translation.service.test.mjs`. Use `startOpenAiServer`, `createConfig`, and `createTemporaryProject` to exercise the real service against a local endpoint:

```js
import assert from 'node:assert/strict'
import path from 'node:path'
import {test} from 'node:test'

import {TranslationService} from '../../dist/shared/translation.service.js'
import {startOpenAiServer} from '../helpers/http-server.mjs'
import {createConfig, createTemporaryProject} from '../helpers/project-fixture.mjs'

const serviceFor = (project, baseUrl, overrides = {}) => TranslationService.fromConfig(
  createConfig({
    engine: 'fixture',
    engines: {fixture: {baseUrl, model: 'fixture-model', provider: 'openai-compatible'}},
    ...overrides,
  }),
  {cacheFile: path.join(project.cacheRoot, 'translations.json')},
)

test('translateBatch returns fresh results without caching before commit', async testContext => {
  const server = await startOpenAiServer(testContext, () => ({
    body: {choices: [{message: {content: '{"uk":"Привіт {name}","de":"Hallo {name}"}'}}]},
    status: 200,
  }))
  const project = await createTemporaryProject(testContext)
  const service = serviceFor(project, server.baseUrl)
  const request = {from: 'en', key: 'hello', sourceText: 'Hello {name}', targets: ['uk', 'de']}

  const first = await service.translateBatch(request)
  const second = await service.translateBatch(request)
  assert.equal(server.requests.length, 2)
  assert.equal(first.results.every(result => !result.cached), true)
  assert.deepEqual(first.issues, [])

  await service.cacheResults(first.results)
  const cached = await service.translateBatch(request)
  assert.equal(server.requests.length, 2)
  assert.equal(cached.results.every(result => result.cached), true)
  assert.equal(second.results.length, 2)
})

test('translateBatch converts placeholder mismatches into target issues', async testContext => {
  const server = await startOpenAiServer(testContext, () => ({
    body: {choices: [{message: {content: '{"uk":"Привіт","de":"Hallo {name}"}'}}]},
    status: 200,
  }))
  const project = await createTemporaryProject(testContext)
  const attempt = await serviceFor(project, server.baseUrl).translateBatch({
    from: 'en', sourceText: 'Hello {name}', targets: ['uk', 'de'],
  })

  assert.deepEqual(attempt.issues, [{reason: 'placeholder', target: 'uk'}])
  assert.deepEqual(attempt.results.map(result => result.to), ['de'])
})
```

- [ ] **Step 2: Build and verify the service tests fail**

Run:

```powershell
npm run build
node --test test/unit/multi-language-translation.service.test.mjs
```

Expected: FAIL because `TranslationService.translateBatch` and `cacheResults` do not exist.

- [ ] **Step 3: Implement multi-target validation and cache lookup**

Add validation that requires non-empty `from`, `sourceText`, and `targets`; rejects duplicate targets and a target equal to `from`; then resolve cache hits in requested order. Reuse the existing `identity`, `getCached`, and `result` helpers by creating one `ITranslationRequestPlan` per target.

Use this public signature:

```ts
async translateBatch(
  request: IMultiLanguageTranslationRequestPlan,
): Promise<IMultiLanguageTranslationAttempt>
```

For each target, check the primary cache first and the fallback cache second, matching `translate()`. Build one engine request containing only targets that missed both caches. If all targets are cached, return without calling an engine.

- [ ] **Step 4: Implement package primary/fallback and normalization**

Add a private helper with this signature:

```ts
private async translateBatchWith(
  runtime: ITranslationRuntime,
  request: IMultiLanguageTranslationRequestPlan,
  fallbackFrom?: string,
): Promise<IMultiLanguageTranslationAttempt>
```

Call `runtime.engine.translateBatch(request)`, compare placeholders for every structurally valid translation, convert matches to `ITranslationResult` through `this.result(...)`, and convert mismatches to `{reason: 'placeholder', target}`. Preserve request target order in `results` and issue order.

In the public method, use the same fallback gate as `translate()`:

```ts
try {
  fresh = await this.translateBatchWith(this.primary, uncachedRequest)
} catch (error) {
  const translationError = toTranslationError(error, 'provider_response', undefined, {
    profile: this.primary.profile,
  })
  if (!this.fallback || !isRecoverableTranslationError(translationError)) throw translationError
  fresh = await this.translateBatchWith(this.fallback, uncachedRequest, this.primary.profile.name)
}
```

Do not invoke fallback for returned `issues`; those go to the decision layer.

- [ ] **Step 5: Add explicit deferred cache commit**

Implement:

```ts
async cacheResults(results: ITranslationResult[]): Promise<void> {
  for (const result of results) {
    if (result.cached) continue
    const runtime = result.engine === this.primary.profile.name ? this.primary : this.fallback
    if (!runtime || runtime.profile.model !== result.model) {
      throw new TranslationError('configuration', `Unknown result engine "${result.engine}".`)
    }
    await this.cache.set(this.identity(runtime.profile, result), result.translatedText)
  }
}
```

Wrap cache failures through `toTranslationError(error, 'configuration')`, as the single-language method does. Leave `translate()`'s immediate cache behavior unchanged.

- [ ] **Step 6: Add a fallback package test**

Append:

```js
test('translateBatch sends a recoverable full-package failure to fallback', async testContext => {
  const primary = await startOpenAiServer(testContext, () => ({
    body: {error: {message: 'primary unavailable'}}, status: 500,
  }))
  const fallback = await startOpenAiServer(testContext, () => ({
    body: {choices: [{message: {content: '{"uk":"Мова","de":"Sprache"}'}}]}, status: 200,
  }))
  const project = await createTemporaryProject(testContext)
  const service = TranslationService.fromConfig(createConfig({
    engine: 'primary',
    fallback: 'fallback',
    engines: {
      primary: {baseUrl: primary.baseUrl, model: 'primary-model', provider: 'openai-compatible'},
      fallback: {baseUrl: fallback.baseUrl, model: 'fallback-model', provider: 'openai-compatible'},
    },
  }), {cacheFile: path.join(project.cacheRoot, 'translations.json')})

  const attempt = await service.translateBatch({
    from: 'en', sourceText: 'Language', targets: ['uk', 'de'],
  })

  assert.equal(primary.requests.length, 1)
  assert.equal(fallback.requests.length, 1)
  assert.equal(attempt.results.every(result => result.engine === 'fallback'), true)
  assert.equal(attempt.results.every(result => result.fallback.from === 'primary'), true)
})
```

- [ ] **Step 7: Run service tests**

Run:

```powershell
npm run build
node --test test/unit/multi-language-translation.service.test.mjs
```

Expected: all cache, placeholder, and fallback tests PASS.

- [ ] **Step 8: Commit service support**

```powershell
git add src/shared/translation.service.ts test/unit/multi-language-translation.service.test.mjs
git commit -m "feat: add cache-aware multi-language service"
```

---

### Task 4: Group and recover packages in TranslationBatchService

**Files:**
- Modify: `src/shared/translation-batch.service.ts`
- Create: `test/unit/multi-language-batch.service.test.mjs`
- Modify: `test/e2e/translate.test.mjs`

**Interfaces:**
- Consumes: `translateBatch`, `translate`, and `cacheResults` from Task 3.
- Produces: `ITranslationBatchExecutionOptions.onIncomplete?: (batch) => Promise<'cancel' | 'per-language'>`.
- Produces: stable `ITranslationBatchOutput.incomplete` metadata and `remaining.reason === 'incomplete_batch'` on cancellation.

- [ ] **Step 1: Write failing unit and e2e grouping tests**

Create `test/unit/multi-language-batch.service.test.mjs` with a fake executor:

```js
import assert from 'node:assert/strict'
import {test} from 'node:test'

import {TranslationBatchService} from '../../dist/shared/translation-batch.service.js'

const config = overrides => ({
  concurrency: 2,
  delayMs: 0,
  maxChars: null,
  maxItems: null,
  mode: 'multi-language',
  retry: 0,
  ...overrides,
})

const requests = [
  {from: 'en', key: 'language', sourceText: 'Language', to: 'uk'},
  {from: 'en', key: 'language', sourceText: 'Language', to: 'de'},
]

test('groups one source and multiple targets into one package', async () => {
  const packages = []
  const cached = []
  const executor = {
    cacheResults: async results => cached.push(...results),
    translate: async () => assert.fail('single translation was not expected'),
    translateBatch: async request => {
      packages.push(request)
      return {
        issues: [],
        request,
        results: request.targets.map(to => ({
          cached: false,
          engine: 'fixture',
          from: request.from,
          key: request.key,
          model: 'fixture-model',
          provider: 'openai-compatible',
          sourceText: request.sourceText,
          to,
          translatedText: `${to}: Language`,
        })),
        translations: {},
        unexpectedTargets: [],
      }
    },
  }

  const output = await new TranslationBatchService(executor).execute(requests, {
    config: config(), dryRun: false,
  })

  assert.deepEqual(packages.map(item => item.targets), [['uk', 'de']])
  assert.deepEqual(output.results.map(item => item.to), ['uk', 'de'])
  assert.equal(cached.length, 2)
  assert.deepEqual(output.incomplete, [])
})
```

Append the public CLI acceptance test to `test/e2e/translate.test.mjs`:

```js
test('multi-language mode uses one request and a JSON-only batch prompt', async testContext => {
  const server = await startOpenAiServer(testContext, () => ({
    body: openAiResponse(JSON.stringify({uk: 'Мова', de: 'Sprache'})),
    status: 200,
  }))
  const project = await createProject(testContext, {
    config: translationConfig(server.baseUrl, {batch: {mode: 'multi-language'}}),
  })
  const result = await runCli(project, [
    'translate', 'Language', '--from', 'en', '--to', 'uk', '--to', 'de', '--json',
  ])

  assert.equal(result.exitCode, 0, result.stderr)
  assert.equal(server.requests.length, 1)
  assert.deepEqual(parseJsonOutput(result).results.map(item => item.to), ['uk', 'de'])
})
```

- [ ] **Step 2: Build and verify the grouping test fails**

Run:

```powershell
npm run build
node --test test/unit/multi-language-batch.service.test.mjs
node --test --test-name-pattern "multi-language mode uses one request" test/e2e/translate.test.mjs
```

Expected: the unit test FAILS because execution still calls `translate()` twice; the e2e test
FAILS because the local server receives two requests.

- [ ] **Step 3: Add package grouping and scheduling**

Extend the executor and options interfaces:

```ts
interface ITranslationExecutor {
  cacheResults?(results: ITranslationResult[]): Promise<void>
  translate(request: ITranslationRequestPlan): Promise<ITranslationResult>
  translateBatch?(request: IMultiLanguageTranslationRequestPlan): Promise<IMultiLanguageTranslationAttempt>
}

export interface ITranslationBatchExecutionOptions {
  config: ITranslationBatchConfig
  dryRun: boolean
  onIncomplete?: (
    batch: Omit<IIncompleteTranslationBatch, 'decision'>,
  ) => Promise<TIncompleteBatchDecision>
}
```

Group selected entries by a collision-safe nested map or JSON tuple of `from`, `key ?? null`, and `sourceText`; do not use delimiter concatenation. Each group retains original indices so final per-language outcomes use `sortValues`.

Reuse `createStartScheduler`. In `multi-language` mode, worker count is `min(config.concurrency, groups.length)` and each scheduled attempt invokes `translateBatch` once. Keep the existing per-language path unchanged.

- [ ] **Step 4: Add failing recovery and cancellation tests**

Append two tests:

```js
test('recovers only invalid targets when approved', async () => {
  const singles = []
  const executor = {
    cacheResults: async () => {},
    translate: async request => {
      singles.push(request.to)
      return {
        ...request, cached: false, engine: 'fixture', model: 'fixture-model',
        provider: 'openai-compatible', translatedText: 'Sprache',
      }
    },
    translateBatch: async request => ({
      issues: [{reason: 'missing', target: 'de'}],
      request,
      results: [{
        cached: false, engine: 'fixture', from: 'en', key: 'language',
        model: 'fixture-model', provider: 'openai-compatible', sourceText: 'Language',
        to: 'uk', translatedText: 'Мова',
      }],
      translations: {},
      unexpectedTargets: [],
    }),
  }

  const output = await new TranslationBatchService(executor).execute(requests, {
    config: config(),
    dryRun: false,
    onIncomplete: async () => 'per-language',
  })

  assert.deepEqual(singles, ['de'])
  assert.deepEqual(output.results.map(item => item.to), ['uk', 'de'])
  assert.equal(output.incomplete[0].decision, 'per-language')
})

test('cancel discards every result and fresh cache write', async () => {
  let cacheCommits = 0
  const executor = {
    cacheResults: async () => { cacheCommits += 1 },
    translate: async () => assert.fail('single recovery must not run'),
    translateBatch: async request => ({
      issues: [{reason: 'missing', target: 'de'}],
      request,
      results: [],
      translations: {},
      unexpectedTargets: [],
    }),
  }

  const output = await new TranslationBatchService(executor).execute(requests, {
    config: config(), dryRun: false,
  })

  assert.equal(cacheCommits, 0)
  assert.deepEqual(output.results, [])
  assert.equal(output.remaining.length, 2)
  assert.equal(output.remaining.every(item => item.reason === 'incomplete_batch'), true)
  assert.equal(output.incomplete[0].decision, 'cancel')
})
```

- [ ] **Step 5: Implement serialized decisions and per-language recovery**

For every incomplete attempt, construct metadata from requested targets, successful result targets, issues, and unexpected targets. Serialize `onIncomplete` calls with a promise chain so prompts never overlap. If no callback is supplied, resolve `cancel` without invoking singles.

On `per-language`, retain valid package results and pass only issue targets to the existing `processRequest` method. Do not retry a structurally incomplete completion as a package.

On any `cancel`, finish/drain active workers but return no selected results or conflicts/failures from the operation; convert every selected request to `remaining: {reason: 'incomplete_batch', request}`. Preserve skip and limit outcomes created before selection.

- [ ] **Step 6: Defer cache commit until the global decision gate passes**

After all packages finish:

```ts
if (!cancelled) {
  const freshResults = processed.results
    .map(entry => entry.value)
    .filter(result => !result.cached)
  await this.executor.cacheResults?.(freshResults)
}
```

Never call `cacheResults` from individual workers. This guarantees that a later canceled package cannot leave earlier fresh package entries in cache.

- [ ] **Step 7: Add retry, grouping-boundary, and scheduler coverage**

Append tests asserting:

```js
test('separates different keys even when source text matches', async () => {
  const packages = []
  const executor = {
    cacheResults: async () => {},
    translate: async () => assert.fail('single translation was not expected'),
    translateBatch: async request => {
      packages.push(request)
      return {
        issues: [],
        request,
        results: request.targets.map(to => ({
          cached: false, engine: 'fixture', from: request.from, key: request.key,
          model: 'fixture-model', provider: 'openai-compatible',
          sourceText: request.sourceText, to, translatedText: `${to}: Save`,
        })),
        translations: {},
        unexpectedTargets: [],
      }
    },
  }
  await new TranslationBatchService(executor).execute([
    {from: 'en', key: 'button.save', sourceText: 'Save', to: 'uk'},
    {from: 'en', key: 'menu.save', sourceText: 'Save', to: 'de'},
  ], {config: config(), dryRun: false})
  assert.deepEqual(packages.map(item => item.key), ['button.save', 'menu.save'])
})
```

Import `TranslationError` from `../../dist/shared/entities/translation-error.js`, then append this
retry test using the same result factory as the first grouping test:

```js
test('retries the complete target package after a recoverable error', async () => {
  let attempts = 0
  const seenTargets = []
  const executor = {
    cacheResults: async () => {},
    translate: async () => assert.fail('single translation was not expected'),
    translateBatch: async request => {
      attempts += 1
      seenTargets.push([...request.targets])
      if (attempts === 1) throw new TranslationError('rate_limit', 'slow down')
      return {
        issues: [], request, translations: {}, unexpectedTargets: [],
        results: request.targets.map(to => ({
          cached: false, engine: 'fixture', from: request.from, key: request.key,
          model: 'fixture-model', provider: 'openai-compatible',
          sourceText: request.sourceText, to, translatedText: `${to}: Language`,
        })),
      }
    },
  }

  await new TranslationBatchService(executor, {sleep: async () => {}}).execute(requests, {
    config: config({retry: 1}), dryRun: false,
  })
  assert.deepEqual(seenTargets, [['uk', 'de'], ['uk', 'de']])
})
```

Add a scheduler test with `concurrency: 1`, two distinct keys, `delayMs: 25`, injected
`now: () => clock`, and `sleep: async milliseconds => { sleeps.push(milliseconds); clock += milliseconds }`;
assert `sleeps.filter(value => value > 0)` equals `[25]`. Add `maxItems: 1` and `maxChars: 8`
variants of the grouping test; assert each sends only `uk` and leaves the `de` request with reason
`limit`. These exact assertions prove planning precedes grouping.

- [ ] **Step 8: Run batch unit tests and the previously failing e2e test**

Run:

```powershell
npm run build
node --test test/unit/multi-language-batch.service.test.mjs
node --test --test-name-pattern "multi-language mode uses one request" test/e2e/translate.test.mjs
```

Expected: all focused tests PASS, including exactly one HTTP call for two targets.

- [ ] **Step 9: Commit batch orchestration**

```powershell
git add src/shared/translation-batch.service.ts test/unit/multi-language-batch.service.test.mjs test/e2e/translate.test.mjs
git commit -m "feat: orchestrate multi-language packages"
```

---

### Task 5: Wire interactive decisions, cancellation-safe writes, and reports

**Files:**
- Create: `src/shared/translation-incomplete.prompt.ts`
- Modify: `src/commands/translate.ts`
- Modify: `src/commands/label/sync.ts`
- Modify: `src/shared/sync-report.ts`
- Modify: `test/e2e/translate.test.mjs`
- Modify: `test/e2e/label-mutations.test.mjs`

**Interfaces:**
- Consumes: `onIncomplete` callback and `ITranslationBatchOutput.incomplete` from Task 4.
- Produces: `createIncompleteDecisionHandler({interactive, output})` returning `undefined` or an async decision callback.
- Produces: exit code `1` and zero target writes for canceled packages.

- [ ] **Step 1: Add a non-TTY cancellation e2e test**

Append to `test/e2e/translate.test.mjs`:

```js
test('non-interactive incomplete package cancels without cache or target writes', async testContext => {
  const server = await startOpenAiServer(testContext, () => ({
    body: openAiResponse(JSON.stringify({uk: 'Мова'})),
    status: 200,
  }))
  const project = await createProject(testContext, {
    config: translationConfig(server.baseUrl, {
      batch: {mode: 'multi-language'},
      languages: ['en', 'uk', 'de'],
    }),
    dictionaries: {en: {label: 'Language'}, uk: {}, de: {}},
  })
  const ukBefore = await readBytes(project.file('uk'))
  const deBefore = await readBytes(project.file('de'))
  const args = [
    'translate', '--key', 'label', '--from', 'en', '--to', 'uk', '--to', 'de',
    '--write', '--json',
  ]

  const first = await runCli(project, args)
  const second = await runCli(project, args)

  assert.equal(first.exitCode, 1)
  assert.equal(parseJsonOutput(first).incomplete[0].decision, 'cancel')
  assert.equal(parseJsonOutput(first).remaining.length, 2)
  assert.equal(server.requests.length, 2)
  assert.deepEqual(await readBytes(project.file('uk')), ukBefore)
  assert.deepEqual(await readBytes(project.file('de')), deBefore)
})
```

The second run proves that the valid `uk` partial result was not cached.

- [ ] **Step 2: Add the reusable prompt adapter**

Create `src/shared/translation-incomplete.prompt.ts`:

```ts
import {select} from '@inquirer/prompts'

import type {
  IIncompleteTranslationBatch,
  TIncompleteBatchDecision,
} from './entities/translation-batch.js'

type TPendingIncompleteBatch = Omit<IIncompleteTranslationBatch, 'decision'>

export const createIncompleteDecisionHandler = (options: {
  interactive: boolean
  output: NodeJS.WritableStream
}): undefined | ((batch: TPendingIncompleteBatch) => Promise<TIncompleteBatchDecision>) => {
  if (!options.interactive) return

  return async batch => select<TIncompleteBatchDecision>({
    choices: [
      {name: 'cancel translation', value: 'cancel'},
      {name: 'continue missing or invalid languages one by one', value: 'per-language'},
    ],
    message: [
      'Batch translation is incomplete.',
      `Valid: ${batch.validTargets.join(', ') || 'none'}.`,
      `Missing or invalid: ${batch.invalid.map(item => `${item.target} (${item.reason})`).join(', ') || 'none'}.`,
    ].join(' '),
  }, {output: options.output})
}
```

- [ ] **Step 3: Inject decisions into both commands**

In `translate.ts` and `label/sync.ts`, create the handler after flag validation:

```ts
const onIncomplete = createIncompleteDecisionHandler({
  interactive: !this.jsonEnabled() && Boolean(process.stdin.isTTY && process.stdout.isTTY),
  output: process.stdout,
})
```

Pass `onIncomplete` only when defined:

```ts
await new TranslationBatchService(translationService).execute(requests, {
  config: batchConfig,
  dryRun: flags['dry-run'],
  ...(onIncomplete ? {onIncomplete} : {}),
})
```

Do not create a handler for dry-run because no engine is called.

- [ ] **Step 4: Prevent all sync writes after cancellation**

In `label/sync.ts`, derive:

```ts
const batchCancelled = Boolean(
  batch?.incomplete.some(item => item.decision === 'cancel'),
)
```

Require `!batchCancelled` in both the optional plan confirmation and `SyncExecutor.apply` branches. This prevents translation and unrelated sync actions from writing after the user cancels the operation. `label:add` still retains its source-file mutation because it happened before `label:sync`.

In `translate.ts`, canceled output already has no results; additionally set exit code `1` when any incomplete entry has decision `cancel`. Preserve `incomplete` in `confirmResults` when recomputing the summary:

The `outcomes` object already includes `incomplete: batch.incomplete` from Task 1; keep it there and
return `{...outcomes, summary: summarizeTranslationBatch(outcomes)}`.

- [ ] **Step 5: Render incomplete metadata**

In `translate.ts`, before remaining items, render one line per incomplete package:

```ts
for (const item of output.incomplete) {
  this.log(`Incomplete batch (${item.decision}): ${item.from}${item.key ? ` ${item.key}` : ''}; valid=${item.validTargets.join(', ') || 'none'}; invalid=${item.invalid.map(issue => `${issue.target}:${issue.reason}`).join(', ') || 'none'}`)
}
```

In `formatSyncReport`, prepend equivalent `INCOMPLETE` lines from `report.batch?.incomplete ?? []`. JSON output needs no command-specific transformation because it already contains the batch envelope.

- [ ] **Step 6: Add a `label:add` one-request integration test**

Append to `test/e2e/label-mutations.test.mjs` and import `startOpenAiServer`:

```js
test('label:add translates one source value to all targets in one package', async testContext => {
  const server = await startOpenAiServer(testContext, () => ({
    body: {choices: [{message: {content: '{"uk":"Мова","de":"Sprache"}'}}]},
    status: 200,
  }))
  const project = await createProject(testContext, {
    config: createConfig({
      batch: {mode: 'multi-language'},
      engine: 'fixture',
      engines: {
        fixture: {
          baseUrl: server.baseUrl,
          model: 'fixture-model',
          provider: 'openai-compatible',
        },
      },
      languages: ['en', 'uk', 'de'],
    }),
  })

  const result = await runCli(project, [
    'label:add', 'label.language', '-f', 'en', '-t', 'Language', '--silent',
  ])

  assert.equal(result.exitCode, 0, result.stderr)
  assert.equal(server.requests.length, 1)
  assert.equal((await readJson(project.file('en'))).label.language, 'Language')
  assert.equal((await readJson(project.file('uk'))).label.language, 'Мова')
  assert.equal((await readJson(project.file('de'))).label.language, 'Sprache')
})
```

- [ ] **Step 7: Run focused command tests**

Run:

```powershell
npm run build
node --test test/e2e/translate.test.mjs
node --test --test-name-pattern "label:add translates one source value" test/e2e/label-mutations.test.mjs
```

Expected: all translate tests PASS; `label:add` makes one HTTP request and writes all three dictionaries.

- [ ] **Step 8: Commit CLI integration and reports**

```powershell
git add src/shared/translation-incomplete.prompt.ts src/commands/translate.ts src/commands/label/sync.ts src/shared/sync-report.ts test/e2e/translate.test.mjs test/e2e/label-mutations.test.mjs
git commit -m "feat: handle incomplete translation packages"
```

---

### Task 6: Document the mode and run full verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: completed configuration and runtime behavior.
- Produces: user-facing setup, semantics, recovery, and provider-response documentation.

- [ ] **Step 1: Update every batch configuration example**

Add `"mode": "per-language"` to the default examples near the engine setup, translation workflow, and complete example config. Add an opt-in example:

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

- [ ] **Step 2: Document exact operational semantics**

Add prose stating:

```markdown
`mode: "per-language"` is the default and sends one provider request per target language.
`mode: "multi-language"` groups one source text/key across uncached targets and requests a
JSON object keyed by language code. Limits are applied before grouping; concurrency, delay,
and retry apply to packages. A partial or invalid package is never completed with individual
calls automatically: an interactive run asks whether to cancel or recover only problem
languages, while a non-interactive run cancels without target-file or fresh-cache writes.
```

Document that full recoverable provider failures still use the configured fallback and that
`label:add` retains the source value if target translation is canceled.

- [ ] **Step 3: Run the complete test and quality suite**

Run:

```powershell
npm test
npm run build
git diff --check
```

Expected: all Node tests pass, posttest ESLint passes, TypeScript build exits 0, and `git diff --check` reports no whitespace errors.

- [ ] **Step 4: Exercise both modes through the CLI fixtures**

Run the focused tests once more as explicit acceptance evidence:

```powershell
node --test --test-name-pattern "multi-language mode uses one request|non-interactive incomplete package|label:add translates one source value" test/e2e/translate.test.mjs test/e2e/label-mutations.test.mjs
```

Expected: the complete package, cancellation, and `label:add` acceptance tests PASS.

- [ ] **Step 5: Review the final diff and preserve unrelated work**

Run:

```powershell
git status --short
git diff -- src test README.md
```

Expected: only files named by this plan are modified; no `.ctv.config.json` credentials or unrelated user files appear in the diff.

- [ ] **Step 6: Commit documentation**

```powershell
git add README.md
git commit -m "docs: explain multi-language batch translation"
```
