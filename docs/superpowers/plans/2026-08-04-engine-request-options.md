# Per-Engine Request Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add profile-specific system prompts, temperatures, and provider-aware reasoning disabling to every OpenAI-compatible translation request.

**Architecture:** Extend the existing engine profile as the single source of request options, validate those options alongside the current endpoint/model settings, and let `OpenAICompatibleEngine` translate the normalized profile into each provider's request dialect. Preserve the current two-message request structure and all old defaults, while tests cover profile resolution, raw request bodies, batch translation, and fallback isolation.

**Tech Stack:** TypeScript 6, Node.js 24 built-in test runner, Fetch API, oclif CLI, JSON configuration.

## Global Constraints

- Existing engine configurations remain valid without modification.
- An omitted system prompt resolves to an empty system message.
- An omitted temperature resolves to `0`; configured temperature must be finite and in the inclusive range `0..2`.
- An omitted reasoning option sends no reasoning override.
- `reasoning: false` maps to `reasoning: {enabled: false}` for OpenRouter and `reasoning_effort: "none"` for Google AI, LM Studio, and generic OpenAI-compatible profiles.
- `reasoning: true` maps to `reasoning: {enabled: true}` for OpenRouter and leaves other providers at their model default.
- Provider/model rejection of mandatory or unsupported reasoning settings uses the existing `TranslationError` path; do not retry with different reasoning settings.
- Do not add `ctv init` flags, interactive questions, dependencies, or unrelated refactors.
- Preserve the user's unrelated `package.json` working-tree change and exclude it from every commit.

---

## File structure

- Modify `src/shared/entities/translation.engine.ts`: declare the three optional profile properties shared by raw and resolved profiles.
- Modify `src/shared/engine-profile.ts`: validate and preserve profile request options.
- Create `test/unit/engine-profile.test.mjs`: focused validation/default/preservation coverage.
- Modify `src/shared/engines/openai-compatible.engine.ts`: build the provider-aware request body.
- Create `test/unit/openai-compatible-engine.test.mjs`: inspect single and batch request payloads without network access.
- Modify `test/unit/multi-language-response.test.mjs`: align the existing batch assertion with the new system/user split.
- Modify `test/unit/multi-language-translation.service.test.mjs`: prove a fallback profile applies its own options.
- Modify `test/e2e/label-mutations.test.mjs`: read the translation task from the user message after the already-approved message-role change.
- Modify `README.md`: document the new JSON fields, defaults, mappings, and provider limitation.

### Task 1: Validate and resolve profile request options

**Files:**
- Create: `test/unit/engine-profile.test.mjs`
- Modify: `src/shared/entities/translation.engine.ts`
- Modify: `src/shared/engine-profile.ts`

**Interfaces:**
- Consumes: existing `validateEngineConfiguration(engine, engines)` and `resolveEngineProfile(config, selectedEngine?, environment?, options?)` functions.
- Produces: `IEngineProfile.systemPrompt?: string`, `IEngineProfile.temperature?: number`, and `IEngineProfile.reasoning?: boolean`; resolved profiles preserve the same optional fields.

- [ ] **Step 1: Write failing profile tests**

Create `test/unit/engine-profile.test.mjs`:

```javascript
import assert from 'node:assert/strict'
import {test} from 'node:test'

import {
  resolveEngineProfile,
  validateEngineConfiguration,
} from '../../dist/shared/engine-profile.js'

test('engine profile preserves request options through validation and resolution', () => {
  const engines = validateEngineConfiguration('fixture', {
    fixture: {
      baseUrl: 'http://fixture.test/v1',
      model: 'fixture-model',
      provider: 'openai-compatible',
      reasoning: false,
      systemPrompt: '  Keep this spacing.  ',
      temperature: 0.25,
    },
  })

  assert.deepEqual(engines.fixture, {
    baseUrl: 'http://fixture.test/v1',
    model: 'fixture-model',
    provider: 'openai-compatible',
    reasoning: false,
    systemPrompt: '  Keep this spacing.  ',
    temperature: 0.25,
  })

  const resolved = resolveEngineProfile(
    {engine: 'fixture', engines},
    undefined,
    {},
    {requireCredentials: false},
  )
  assert.equal(resolved.systemPrompt, '  Keep this spacing.  ')
  assert.equal(resolved.temperature, 0.25)
  assert.equal(resolved.reasoning, false)
})

test('engine profile leaves request options absent for old configurations', () => {
  const resolved = resolveEngineProfile({
    engine: 'fixture',
    engines: {
      fixture: {
        baseUrl: 'http://fixture.test/v1',
        model: 'fixture-model',
        provider: 'openai-compatible',
      },
    },
  }, undefined, {}, {requireCredentials: false})

  assert.equal(Object.hasOwn(resolved, 'systemPrompt'), false)
  assert.equal(Object.hasOwn(resolved, 'temperature'), false)
  assert.equal(Object.hasOwn(resolved, 'reasoning'), false)
})

test('engine profile rejects invalid request options', () => {
  const invalid = [
    ['systemPrompt', 42, /systemPrompt must be a string/],
    ['temperature', Number.NaN, /temperature must be a finite number from 0 through 2/],
    ['temperature', -0.01, /temperature must be a finite number from 0 through 2/],
    ['temperature', 2.01, /temperature must be a finite number from 0 through 2/],
    ['reasoning', 'false', /reasoning must be a boolean/],
  ]

  for (const [field, value, message] of invalid) {
    assert.throws(() => validateEngineConfiguration('fixture', {
      fixture: {
        baseUrl: 'http://fixture.test/v1',
        model: 'fixture-model',
        provider: 'openai-compatible',
        [field]: value,
      },
    }), message)
  }
})
```

- [ ] **Step 2: Build and run the new test to verify failure**

Run:

```powershell
npm run build
node --test test/unit/engine-profile.test.mjs
```

Expected: the test fails because validation currently drops `systemPrompt`, `temperature`, and `reasoning`, and invalid values are not rejected.

- [ ] **Step 3: Add the profile properties to the shared interface**

In `src/shared/entities/translation.engine.ts`, extend `IEngineProfile` without adding duplicate fields to `IResolvedEngineProfile`:

```typescript
export interface IEngineProfile {
  apiKeyEnv?: string
  baseUrl?: string
  model: string
  provider: TEngineProvider
  reasoning?: boolean
  systemPrompt?: string
  temperature?: number
  timeoutMs?: number
}
```

- [ ] **Step 4: Implement exact validation and preservation**

In `src/shared/engine-profile.ts`, add a focused temperature validator beside `validateTimeout`:

```typescript
const validateTemperature = (value: unknown, profileName: string): number | undefined => {
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2) {
    throw new Error(
      `Engine profile "${profileName}" temperature must be a finite number from 0 through 2.`,
    )
  }

  return value
}
```

Change the `validateProfile` destructuring and validation to include the new fields:

```typescript
const {
  apiKeyEnv,
  baseUrl,
  model,
  provider,
  reasoning,
  systemPrompt,
  temperature,
  timeoutMs,
} = rawProfile
const validatedTemperature = validateTemperature(temperature, name)
const validatedTimeout = validateTimeout(timeoutMs, name)

if (systemPrompt !== undefined && typeof systemPrompt !== 'string') {
  throw new Error(`Engine profile "${name}" systemPrompt must be a string.`)
}

if (reasoning !== undefined && typeof reasoning !== 'boolean') {
  throw new Error(`Engine profile "${name}" reasoning must be a boolean.`)
}
```

Preserve the validated values in the returned profile without trimming the system prompt:

```typescript
return {
  ...(typeof apiKeyEnv === 'string' ? {apiKeyEnv} : {}),
  ...(typeof baseUrl === 'string' ? {baseUrl: validateBaseUrl(baseUrl, name)} : {}),
  model: model.trim(),
  provider: provider as TEngineProvider,
  ...(typeof reasoning === 'boolean' ? {reasoning} : {}),
  ...(typeof systemPrompt === 'string' ? {systemPrompt} : {}),
  ...(validatedTemperature === undefined ? {} : {temperature: validatedTemperature}),
  ...(validatedTimeout === undefined ? {} : {timeoutMs: validatedTimeout}),
}
```

- [ ] **Step 5: Rebuild and verify the profile tests pass**

Run:

```powershell
npm run build
node --test test/unit/engine-profile.test.mjs
```

Expected: build succeeds and all three tests pass.

- [ ] **Step 6: Commit the profile contract**

```powershell
git add src/shared/entities/translation.engine.ts src/shared/engine-profile.ts test/unit/engine-profile.test.mjs
git commit -m "feat: add per-engine request options"
```

### Task 2: Construct provider-aware completion requests

**Files:**
- Create: `test/unit/openai-compatible-engine.test.mjs`
- Modify: `src/shared/engines/openai-compatible.engine.ts`
- Modify: `test/unit/multi-language-response.test.mjs`
- Modify: `test/unit/multi-language-translation.service.test.mjs`
- Modify: `test/e2e/label-mutations.test.mjs`

**Interfaces:**
- Consumes: the optional `systemPrompt`, `temperature`, and `reasoning` fields produced by Task 1 on `IResolvedEngineProfile`.
- Produces: `OpenAICompatibleEngine.translate()` and `.translateBatch()` requests with profile-specific messages and sampling settings, plus provider-specific reasoning request properties.

- [ ] **Step 1: Write failing raw-request tests**

Create `test/unit/openai-compatible-engine.test.mjs`:

```javascript
import assert from 'node:assert/strict'
import {test} from 'node:test'

import {OpenAICompatibleEngine} from '../../dist/shared/engines/openai-compatible.engine.js'

const requestBodyFor = async (overrides = {}, batch = false) => {
  const requests = []
  const fetchImplementation = async (_url, init) => {
    requests.push(JSON.parse(init.body))
    const content = batch ? '{"uk":"Мова","de":"Sprache"}' : 'Мова'
    return new Response(JSON.stringify({choices: [{message: {content}}]}), {status: 200})
  }
  const engine = new OpenAICompatibleEngine({
    baseUrl: 'http://fixture.test/v1',
    model: 'fixture-model',
    name: 'fixture',
    provider: 'openai-compatible',
    timeoutMs: 1000,
    ...overrides,
  }, fetchImplementation)

  if (batch) {
    await engine.translateBatch({
      from: 'en', key: 'label.language', sourceText: 'Language', targets: ['uk', 'de'],
    })
  } else {
    await engine.translate({from: 'en', key: 'label.language', sourceText: 'Language', to: 'uk'})
  }

  assert.equal(requests.length, 1)
  return requests[0]
}

test('old profile keeps empty system message, user translation task, and temperature zero', async () => {
  const body = await requestBodyFor()
  assert.equal(body.messages[0].role, 'system')
  assert.equal(body.messages[0].content, '')
  assert.equal(body.messages[1].role, 'user')
  assert.match(body.messages[1].content, /Target language: uk/)
  assert.match(body.messages[1].content, /Source text: Language/)
  assert.equal(body.temperature, 0)
  assert.equal(Object.hasOwn(body, 'reasoning'), false)
  assert.equal(Object.hasOwn(body, 'reasoning_effort'), false)
})

test('profile system prompt and temperature reach single and batch requests', async () => {
  for (const batch of [false, true]) {
    const body = await requestBodyFor({
      systemPrompt: 'Profile-specific system prompt',
      temperature: 0.35,
    }, batch)
    assert.equal(body.messages[0].content, 'Profile-specific system prompt')
    assert.equal(body.temperature, 0.35)
    assert.match(body.messages[1].content, batch
      ? /Return exactly one JSON object/
      : /Return only the translated source text/)
  }
})

test('reasoning false maps to each provider dialect', async () => {
  const cases = [
    ['openrouter', {reasoning: {enabled: false}}],
    ['google-ai', {reasoning_effort: 'none'}],
    ['lmstudio', {reasoning_effort: 'none'}],
    ['openai-compatible', {reasoning_effort: 'none'}],
  ]

  for (const [provider, expected] of cases) {
    const body = await requestBodyFor({provider, reasoning: false})
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(body[key], value)
    if (provider === 'openrouter') assert.equal(Object.hasOwn(body, 'reasoning_effort'), false)
    else assert.equal(Object.hasOwn(body, 'reasoning'), false)
  }
})

test('reasoning true explicitly enables OpenRouter and leaves other providers at defaults', async () => {
  const openrouter = await requestBodyFor({provider: 'openrouter', reasoning: true})
  assert.deepEqual(openrouter.reasoning, {enabled: true})

  for (const provider of ['google-ai', 'lmstudio', 'openai-compatible']) {
    const body = await requestBodyFor({provider, reasoning: true})
    assert.equal(Object.hasOwn(body, 'reasoning'), false)
    assert.equal(Object.hasOwn(body, 'reasoning_effort'), false)
  }
})
```

- [ ] **Step 2: Run the raw-request tests to verify failure**

Run:

```powershell
npm run build
node --test test/unit/openai-compatible-engine.test.mjs
```

Expected: custom system prompt, custom temperature, and reasoning assertions fail because the request body still uses hard-coded values and contains no provider mapping.

- [ ] **Step 3: Add a typed reasoning request helper**

In `src/shared/engines/openai-compatible.engine.ts`, add these request-body types and helper above the class:

```typescript
interface IChatCompletionRequest {
  messages: Array<{content: string; role: 'system' | 'user'}>
  model: string
  reasoning?: {enabled: boolean}
  reasoning_effort?: 'none'
  stream: false
  temperature: number
}

const reasoningRequest = (
  profile: IResolvedEngineProfile,
): Pick<IChatCompletionRequest, 'reasoning' | 'reasoning_effort'> => {
  if (profile.reasoning === undefined) return {}
  if (profile.provider === 'openrouter') {
    return {reasoning: {enabled: profile.reasoning}}
  }

  return profile.reasoning ? {} : {reasoning_effort: 'none'}
}
```

- [ ] **Step 4: Use profile options in translation and completion**

Replace the temporary commented implementations in both public methods:

```typescript
async translate(request: ITranslationRequestPlan): Promise<string> {
  return this.completion(this.profile.systemPrompt ?? '', buildSystemPrompt(request))
}

async translateBatch(request: IMultiLanguageTranslationRequestPlan): Promise<IMultiLanguageEngineResponse> {
  const content = await this.completion(
    this.profile.systemPrompt ?? '',
    buildBatchSystemPrompt(request),
  )
  return parseMultiLanguageCompletion(content, request.targets)
}
```

Inside `completion`, construct the typed body before `fetch`:

```typescript
const requestBody: IChatCompletionRequest = {
  messages: [
    {content: systemPrompt, role: 'system'},
    {content: userContent, role: 'user'},
  ],
  model: this.profile.model,
  ...reasoningRequest(this.profile),
  stream: false,
  temperature: this.profile.temperature ?? 0,
}
```

Then replace the inline `JSON.stringify({...})` object with:

```typescript
body: JSON.stringify(requestBody),
```

- [ ] **Step 5: Align existing prompt-position assertions**

In `test/unit/multi-language-response.test.mjs`, replace the old system-prompt assertions:

```javascript
const system = requests[0].body.messages[0].content
assert.match(system, /Return exactly one JSON object/)
assert.match(system, /uk, de/)
```

with explicit role checks:

```javascript
assert.equal(requests[0].body.messages[0].content, '')
const user = requests[0].body.messages[1].content
assert.match(user, /Return exactly one JSON object/)
assert.match(user, /uk, de/)
```

In both request handlers in `test/e2e/label-mutations.test.mjs` that currently use `request.body.messages[0].content`, change them to:

```javascript
const prompt = request.body.messages.at(-1).content
```

This keeps the handlers coupled to the translation task rather than to a fixed system-message position.

- [ ] **Step 6: Prove fallback profiles keep independent request settings**

In `test/unit/multi-language-translation.service.test.mjs`, extend the existing `translateBatch sends a recoverable full-package failure to fallback` configuration:

```javascript
engines: {
  fallback: {
    baseUrl: fallback.baseUrl,
    model: 'fallback-model',
    provider: 'openrouter',
    reasoning: false,
    systemPrompt: 'Fallback system prompt',
    temperature: 0.4,
  },
  primary: {
    baseUrl: primary.baseUrl,
    model: 'primary-model',
    provider: 'openai-compatible',
    reasoning: false,
    systemPrompt: 'Primary system prompt',
    temperature: 0.1,
  },
},
```

After the request-count assertions, add:

```javascript
assert.equal(primary.requests[0].body.messages[0].content, 'Primary system prompt')
assert.equal(primary.requests[0].body.temperature, 0.1)
assert.equal(primary.requests[0].body.reasoning_effort, 'none')
assert.equal(fallback.requests[0].body.messages[0].content, 'Fallback system prompt')
assert.equal(fallback.requests[0].body.temperature, 0.4)
assert.deepEqual(fallback.requests[0].body.reasoning, {enabled: false})
```

- [ ] **Step 7: Run focused request and fallback tests**

Run:

```powershell
npm run build
node --test test/unit/openai-compatible-engine.test.mjs test/unit/multi-language-response.test.mjs test/unit/multi-language-translation.service.test.mjs
node --test test/e2e/label-mutations.test.mjs
```

Expected: all focused unit and E2E tests pass.

- [ ] **Step 8: Commit request construction and regression coverage**

```powershell
git add src/shared/engines/openai-compatible.engine.ts test/unit/openai-compatible-engine.test.mjs test/unit/multi-language-response.test.mjs test/unit/multi-language-translation.service.test.mjs test/e2e/label-mutations.test.mjs
git commit -m "feat: apply per-engine completion settings"
```

### Task 3: Document configuration and perform full verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the profile field names and provider mappings implemented in Tasks 1 and 2.
- Produces: user-facing configuration examples and operational caveats; no new runtime interface.

- [ ] **Step 1: Update the main configuration example**

In the `engines.lmstudio` object near the first README configuration example, add:

```json
"systemPrompt": "You are a concise translation assistant.",
"temperature": 0.2,
"reasoning": false,
```

Keep the JSON valid by preserving commas around `model` and `timeoutMs`.

- [ ] **Step 2: Add the request-option reference text**

Immediately after the paragraph describing `timeoutMs`, add:

```markdown
Each engine profile can also set `systemPrompt`, `temperature`, and `reasoning`.
`systemPrompt` is sent as the system message, while the generated translation
task is sent as the user message. `temperature` accepts values from `0` through
`2` and defaults to `0`. If `reasoning` is omitted, Transverto leaves the
provider default unchanged. Set `reasoning` to `false` to request disabled
reasoning for that profile.

Reasoning parameters are mapped to each supported provider's API dialect.
Some models require reasoning and may reject attempts to disable it; Transverto
reports that provider error and does not silently retry with reasoning enabled.
```

- [ ] **Step 3: Check generated examples for stale prompt assumptions**

Run:

```powershell
rg -n "systemPrompt|temperature|reasoning|messages\[0\]\.content" README.md test src
```

Expected: the README contains the new fields; no remaining test handler treats `messages[0]` as the generated translation task; source references are limited to the new profile validation/request construction.

- [ ] **Step 4: Run formatting and static verification**

Run:

```powershell
git diff --check
npm run lint
npm run build
```

Expected: no whitespace errors, lint errors, or TypeScript errors.

- [ ] **Step 5: Run the complete test suite**

Run:

```powershell
npm test
```

Expected: build, all Node unit/E2E tests selected by the repository test script, and its post-test lint step pass.

- [ ] **Step 6: Review the final scoped diff**

Run:

```powershell
git status --short
git diff -- src/shared/entities/translation.engine.ts src/shared/engine-profile.ts src/shared/engines/openai-compatible.engine.ts test/unit/engine-profile.test.mjs test/unit/openai-compatible-engine.test.mjs test/unit/multi-language-response.test.mjs test/unit/multi-language-translation.service.test.mjs test/e2e/label-mutations.test.mjs README.md
```

Expected: only the planned feature files are present in the feature diff. The pre-existing `package.json` modification remains unstaged and is not altered.

- [ ] **Step 7: Commit documentation**

```powershell
git add README.md
git commit -m "docs: document engine request options"
```

- [ ] **Step 8: Record final evidence**

Run:

```powershell
git status --short
git log -3 --oneline
```

Expected: the feature commits are present, only the pre-existing `package.json` modification remains in the working tree, and the handoff reports the exact successful verification commands.
