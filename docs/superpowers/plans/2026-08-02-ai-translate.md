# AI Translate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy web-translation engines with one `ctv translate` command backed by named LM Studio, Google AI Studio, OpenRouter, or generic OpenAI-compatible model profiles.

**Architecture:** A profile validator/factory resolves provider defaults and credentials, `OpenAICompatibleEngine` owns the Chat Completions HTTP contract, and `TranslationService` owns translation prompting and the stable result shape. A separate dictionary service plans key translations and atomically applies `--write`, while the command handles input selection and formatting.

**Tech Stack:** Node.js 24.15+, TypeScript 6 ESM, oclif 4, built-in `fetch`, existing atomic file transaction utilities.

## Global Constraints

- Runtime remains exactly `"node": ">=24.15"`; use Node 24 built-ins and ESM imports ending in `.js`.
- Do not implement `--file` or any file-input translation behavior.
- Do not retain aliases or compatibility parsing for Bing, Google Translate, Terra, or the old config schema.
- Do not add retry, fallback, rate limiting, batch controls, or the redesigned cache.
- Do not add tests or modify test infrastructure, per `PLAN.md`; every task uses build, lint, and focused manual CLI verification instead.
- Validate all flags, profiles, languages, dictionaries, and environment-variable presence before network activity.
- Keep JSON output stable and free of ANSI output.
- Keep API keys out of `.ctv.config.json`, diagnostics, errors, and command output.
- Dictionary writes must be atomic and occur only after every requested translation succeeds.

---

## File Structure

New files:

- `src/shared/engine-profile.ts`: provider presets, profile validation, active-profile resolution, and credential lookup.
- `src/shared/engines/openai-compatible.engine.ts`: non-streaming Chat Completions HTTP adapter.
- `src/shared/translation.service.ts`: deterministic prompt construction and stable translation results.
- `src/shared/translation-project.service.ts`: key-plan creation, dictionary validation, and transactional writes.
- `src/commands/translate.ts`: unified public command and output formatting.

Modified files:

- `src/shared/entities/translation.engine.ts`: AI profile, request, plan, result, and engine contracts.
- `src/shared/config.ts`: `engine: string | null` plus `engines` profile map; remove legacy provider/cache fields.
- `src/shared/config-builder.ts`: build and validate the new schema.
- `src/shared/language.service.ts`: accept optional engine profiles while preserving language mutations.
- `src/commands/init.ts`: collect optional named AI profile settings.
- `src/shared/doctor.service.ts`: diagnose profiles and optionally check the active model endpoint.
- `src/commands/label/sync.ts`: use `TranslationService` for existing auto-translation.
- `package.json` and `package-lock.json`: remove `got` after all legacy adapters are deleted.
- `.ctv.config.json`: move the repository development configuration to the `lmstudio` profile supplied by the user.
- `README.md` and generated `oclif.manifest.json`: document and expose the new command/schema.

Deleted files:

- `src/commands/translate/bing.ts`
- `src/commands/translate/google.ts`
- `src/commands/translate/terra.ts`
- `src/shared/engines/base-engine-bing.ts`
- `src/shared/engines/bing.engine.ts`
- `src/shared/engines/google.engine.ts`
- `src/shared/engines/terra.engine.ts`
- `src/shared/engines/translate.engine.ts`
- `src/shared/entities/bing.config.ts`
- `src/shared/entities/google.config.ts`
- `src/shared/entities/terra.config.ts`
- `src/shared/lang.bing.ts`
- `src/shared/lang.google.ts`
- `src/shared/lang.terra.ts`

### Task 1: Introduce the AI profile schema and validation boundary

**Files:**

- Modify: `src/shared/entities/translation.engine.ts`
- Create: `src/shared/engine-profile.ts`
- Modify: `src/shared/config.ts`
- Modify: `src/shared/config-builder.ts`
- Modify: `src/shared/language.service.ts`

**Interfaces:**

- Produces: `TEngineProvider`, `IEngineProfile`, `IResolvedEngineProfile`, `ITranslationRequestPlan`, `ITranslationResult`, `ITranslateOutput`, and `TranslationEngine`.
- Produces: `validateEngineConfiguration(engine, engines)` and `resolveEngineProfile(config, selectedEngine?, environment?)`.
- Consumed later by the engine factory, translate command, init, doctor, and label sync.

- [ ] **Step 1: Add the new contracts alongside the legacy contracts**

Define these public shapes in `src/shared/entities/translation.engine.ts`:

```ts
export type TEngineProvider =
  | 'google-ai'
  | 'lmstudio'
  | 'openai-compatible'
  | 'openrouter'

export interface IEngineProfile {
  apiKeyEnv?: string
  baseUrl?: string
  model: string
  provider: TEngineProvider
}

export interface IResolvedEngineProfile extends IEngineProfile {
  apiKey?: string
  baseUrl: string
  name: string
}

export interface ITranslationRequestPlan {
  from: string
  key?: string
  sourceText: string
  to: string
}

export interface ITranslationResult extends ITranslationRequestPlan {
  engine: string
  model: string
  translatedText: string
}

export interface ITranslateOutput {
  dryRun: boolean
  requests: ITranslationRequestPlan[]
  results: ITranslationResult[]
  written: string[]
}

export interface TranslationEngine {
  translate(request: ITranslationRequestPlan): Promise<string>
}
```

Keep `TEngineTranslation`, `IParamTranslateText`, and `BaseEngine` in this file during Tasks 1–4 so the still-present legacy adapters compile at each commit boundary. Task 5 deletes both the adapters and these transitional declarations; they are never part of the completed v2 API.

- [ ] **Step 2: Implement provider presets and profile validation**

In `src/shared/engine-profile.ts`, define exact defaults:

```ts
export const ENGINE_PROVIDERS: TEngineProvider[] = [
  'lmstudio',
  'google-ai',
  'openrouter',
  'openai-compatible',
]

export const ENGINE_PROVIDER_DEFAULTS = {
  lmstudio: {baseUrl: 'http://localhost:1234/v1', requiresApiKey: false},
  'google-ai': {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    requiresApiKey: true,
  },
  openrouter: {baseUrl: 'https://openrouter.ai/api/v1', requiresApiKey: true},
  'openai-compatible': {baseUrl: null, requiresApiKey: false},
} as const
```

Validate profile names with `/^[a-z0-9][a-z0-9._-]*$/`, environment names with `/^[A-Za-z_][A-Za-z0-9_]*$/`, non-empty models, supported providers, and absolute `http:`/`https:` URLs. Strip trailing slashes from resolved base URLs. Require `apiKeyEnv` for Google AI and OpenRouter, but require the environment value only in `resolveEngineProfile`, not while building a label-only config.

`validateEngineConfiguration` returns a typed profile map or throws a message naming the exact profile and field. It accepts only `engine === null` or a non-empty string and requires a non-null active engine to exist in the map.

- [ ] **Step 3: Replace the config schema and defaults**

Add the new profile fields to `IConfig`:

```ts
export interface IConfig {
  basePath: string
  basePathEnum: string
  engine: null | string
  engines: Record<string, IEngineProfile>
  labelValidation: string
  langCodeDefault: string
  languages: string[]
  nameEnum?: string
}
```

Set `CONFIG_DEFAULT.engine` to `null` and `CONFIG_DEFAULT.engines` to `{}`. Keep the existing optional `bing`, `google`, `terra`, `engineUseCache`, and `userAgent` declarations only until Task 5 so unchanged legacy sources compile between task commits. Task 5 removes those declarations and defaults together with their only consumers.

- [ ] **Step 4: Extend config building without storing secrets**

Extend `IConfigBuilderInput` with an optional profile object:

```ts
engine?: null | string
engineProfile?: IEngineProfile
```

When no engine is supplied, build `engine: null, engines: {}`. When an engine is supplied, require `engineProfile`, validate `{[engine]: engineProfile}`, and build exactly that one named profile. Preserve the existing language/source/path validation.

- [ ] **Step 5: Update language project loading**

Replace the hard requirement that `parsed.engine` be a string with `validateEngineConfiguration(parsed.engine, parsed.engines)`. Keep language add/remove/rename transactions unchanged and preserve the complete new config when rewriting `.ctv.config.json`.

- [ ] **Step 6: Verify the schema boundary**

Run:

```shell
npm run build
npm run lint
```

Expected: compilation and lint succeed. New code uses only `engine` and `engines`; legacy fields remain referenced exclusively by the provider files scheduled for deletion in Task 5.

- [ ] **Step 7: Commit the schema**

```shell
git add src/shared/entities/translation.engine.ts src/shared/engine-profile.ts src/shared/config.ts src/shared/config-builder.ts src/shared/language.service.ts
git commit -m "refactor: introduce AI engine profiles"
```

### Task 2: Implement OpenAI-compatible translation calls

**Files:**

- Create: `src/shared/engines/openai-compatible.engine.ts`
- Create: `src/shared/translation.service.ts`

**Interfaces:**

- Consumes: `IResolvedEngineProfile`, `ITranslationRequestPlan`, `ITranslationResult`, and `TranslationEngine` from Task 1.
- Produces: `OpenAICompatibleEngine` and `TranslationService.fromConfig(config, selectedEngine?)`.

- [ ] **Step 1: Implement the HTTP adapter**

`OpenAICompatibleEngine` receives an `IResolvedEngineProfile` and optional injectable `fetch` function for manual isolation. Its `translate` method sends:

```ts
{
  messages: [
    {role: 'system', content: systemPrompt},
    {role: 'user', content: request.sourceText},
  ],
  model: profile.model,
  stream: false,
  temperature: 0,
}
```

Use `${profile.baseUrl}/chat/completions`, `Content-Type: application/json`, and `Authorization: Bearer ...` only when `apiKey` exists. The system prompt must state the source and target codes, require only translated text, and preserve placeholders, punctuation, paragraph structure, and formatting.

Accept only a successful HTTP response containing a non-empty string at `choices[0].message.content`. For non-2xx responses, safely read `error.message` when present and throw an error containing status, profile name, and model but never headers or credentials.

- [ ] **Step 2: Implement the provider-independent service**

Expose:

```ts
export class TranslationService {
  static fromConfig(config: IConfig, selectedEngine?: string): TranslationService
  translate(request: ITranslationRequestPlan): Promise<ITranslationResult>
}
```

`fromConfig` calls `resolveEngineProfile`, constructs `OpenAICompatibleEngine`, and stores the resolved profile. `translate` calls the adapter, trims only the response's outer whitespace, rejects an empty translation, and returns the exact stable result shape with `engine` equal to the profile name and `model` equal to the configured model.

- [ ] **Step 3: Verify a real LM Studio request with an isolated one-line script**

After the repository config is migrated in Task 5, run the CLI scenario there. At this task boundary, run build and lint:

```shell
npm run build
npm run lint
```

Expected: both succeed; no provider SDK is added.

- [ ] **Step 4: Commit the AI transport**

```shell
git add src/shared/engines/openai-compatible.engine.ts src/shared/translation.service.ts
git commit -m "feat: add OpenAI-compatible translation service"
```

### Task 3: Add dictionary planning and the unified command

**Files:**

- Create: `src/shared/translation-project.service.ts`
- Create: `src/commands/translate.ts`

**Interfaces:**

- Consumes: Task 1 contracts, `TranslationService`, `applyFileTransaction`, config paths, and existing nested-value utilities.
- Produces: `TranslationProjectService.planKeys(keys, from, targets)` and `TranslationProjectService.write(results)`.

- [ ] **Step 1: Implement safe dictionary loading and key planning**

`TranslationProjectService.load(config, cwd?)` resolves language files from `basePath`. `planKeys` must:

- reject unconfigured source or targets;
- reject a target equal to source;
- reject duplicate keys and targets;
- parse each touched JSON file as an object;
- require every source key to resolve to a string leaf;
- reject a target path when an ancestor is a string or the existing leaf is non-string;
- return requests ordered by key input, then target input.

Use a read-only nested lookup that does not create missing objects. Do not use the current mutating `UTIL.getNestedValue` for validation.

- [ ] **Step 2: Implement all-or-nothing dictionary writes**

`write(results)` clones the loaded target dictionaries, assigns translated values while detecting object/leaf conflicts, serializes each changed dictionary with two-space indentation and one trailing newline, and calls `applyFileTransaction` once. Return written language codes in config language order. Do not rewrite the generated types file because source keys are unchanged.

- [ ] **Step 3: Define the oclif command contract**

In `src/commands/translate.ts`, define:

```ts
static args = {
  text: Args.string({description: 'text to translate'}),
}

static enableJsonFlag = true

static flags = {
  'dry-run': Flags.boolean({description: 'validate and show requests without network or writes'}),
  engine: Flags.string({description: 'named engine profile'}),
  from: Flags.string({description: 'source language code'}),
  key: Flags.string({description: 'translation key', multiple: true}),
  stdin: Flags.boolean({description: 'read source text from stdin'}),
  to: Flags.string({description: 'target language code', multiple: true, required: true}),
  write: Flags.boolean({description: 'write key translations to target dictionaries'}),
}
```

Validate exactly one of positional text, `--stdin`, or non-empty `--key`. Reject `--write` without key mode and reject `--write --dry-run`. Default `from` to `config.langCodeDefault`. For text/stdin, validate language-code syntax but do not require configured dictionaries. For key mode, delegate language and dictionary validation to `TranslationProjectService`.

- [ ] **Step 4: Implement dry-run, execution, and stable output**

Resolve the engine profile before reading stdin or translating. Dry-run returns `{dryRun: true, requests, results: [], written: []}` without constructing a network request. Normal mode processes requests sequentially, awaits `TranslationService.translate`, and writes only after all results succeed.

When JSON is enabled, return `ITranslateOutput` so oclif serializes a stable envelope. Human output prints only `translatedText` for one result; otherwise print `key -> to: translatedText` for key mode and `to: translatedText` for text/stdin.

- [ ] **Step 5: Verify validation and non-writing behavior**

Run:

```shell
npm run build
npm run lint
node bin/run.js translate --help
node bin/run.js translate "Hello" --to uk --dry-run --json
node bin/run.js translate "Hello" --stdin --to uk
node bin/run.js translate "Hello" --to uk --write
```

Expected: build/lint/help succeed; dry-run emits one request and no results/writes; mixed input and invalid write mode fail with exit 2 before network activity.

- [ ] **Step 6: Commit the command**

```shell
git add src/shared/translation-project.service.ts src/commands/translate.ts
git commit -m "feat: add unified translate command"
```

### Task 4: Migrate init and doctor to AI profiles

**Files:**

- Modify: `src/commands/init.ts`
- Modify: `src/shared/doctor.service.ts`

**Interfaces:**

- Consumes: Task 1 profile validation/resolution and provider defaults.
- Produces: v2 init configuration and profile-aware diagnostic codes.

- [ ] **Step 1: Add non-interactive init profile flags**

Add `--provider`, `--model`, `--base-url`, and `--api-key-env`; change `--engine` help to `named engine profile`. If no engine-related flag is present, build a config with no engine. If any profile-detail flag is present, require `--engine`, `--provider`, and `--model`; pass the profile to `buildConfig`. Never resolve or persist the API-key value.

- [ ] **Step 2: Update the interactive wizard**

After languages/source selection, ask `Configure an AI translation profile?` with default `false`. When true, ask for profile name (default equal to provider), provider, model, base URL override, and API-key environment name for Google AI/OpenRouter. Validate every answer with the shared profile validator before any files are created.

- [ ] **Step 3: Replace legacy doctor engine validation**

Remove `TRANSLATION_ENGINES` and `ENGINE_HEALTH_URLS`. Validate `engine` and `engines` through shared helpers, producing:

- `ENGINE_NOT_CONFIGURED` warning when `engine` is null and profiles are empty;
- `CONFIG_ENGINE_INVALID` for an invalid active reference;
- `CONFIG_ENGINE_PROFILE_INVALID` for invalid profile/provider/model/URL/env fields;
- `ENGINE_API_KEY_MISSING` when the active profile requires an unset environment variable.

Do not expose environment values in diagnostic details.

- [ ] **Step 4: Implement opt-in model endpoint health checking**

For `--check-engine`, resolve the active profile and request `${baseUrl}/models` with `Authorization` only when configured and `AbortSignal.timeout(timeoutMs)`. Report `ENGINE_AVAILABLE` for a successful response and `ENGINE_UNAVAILABLE` otherwise. Include only profile, provider, model, status, error name, and timeout in diagnostic details.

- [ ] **Step 5: Verify init and doctor scenarios**

Use a temporary project directory and run:

```shell
node bin/run.js init --minimal
node bin/run.js doctor --json
node bin/run.js init --minimal --force --engine lmstudio --provider lmstudio --model google/gemma-4-12b-qat --base-url http://172.20.16.1:1234/v1
node bin/run.js doctor --json
```

Expected: minimal config has `engine: null` and an empty profile map; doctor reports only the engine warning plus any normal file/type diagnostics; configured init writes the named profile without a secret; doctor validates it without network unless `--check-engine` is supplied.

- [ ] **Step 6: Commit init and doctor migration**

```shell
git add src/commands/init.ts src/shared/doctor.service.ts
git commit -m "feat: configure and diagnose AI engine profiles"
```

### Task 5: Integrate auto-translation and remove legacy engines

**Files:**

- Modify: `src/commands/label/sync.ts`
- Delete: all legacy command, adapter, entity, and language-map files listed in File Structure
- Modify: `.ctv.config.json`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Consumes: `TranslationService.fromConfig` and its stable result contract.
- Removes: `TranslateEngine`, provider-specific adapters, legacy engine entities, and `got`.

- [ ] **Step 1: Switch label sync to the new service**

Replace `TranslateEngine` with a lazily created `TranslationService` only when `--autoTranslate` is true. For a scalar source value, call:

```ts
const result = await this.translationService.translate({
  from: sourceLangCode,
  sourceText: text,
  to: targetLangCode,
})
return result.translatedText
```

Do not require an engine profile for label sync without `--autoTranslate`.

- [ ] **Step 2: Delete the old implementation**

Delete the three provider commands, four legacy engine files, three provider entity files, and three language-map files listed above. Confirm `rg "BingEngine|GoogleEngine|TerraEngine|TranslateEngine|lang\\.(bing|google|terra)|engineUseCache" src` returns no matches.

- [ ] **Step 3: Migrate the repository development config**

Replace the legacy engine fields in `.ctv.config.json` with:

```json
"engine": "lmstudio",
"engines": {
  "lmstudio": {
    "provider": "lmstudio",
    "baseUrl": "http://172.20.16.1:1234/v1",
    "model": "google/gemma-4-12b-qat"
  }
}
```

Keep existing paths, language order, source language, label validation, and enum name unchanged.

- [ ] **Step 4: Remove the unused HTTP dependency**

Run `npm uninstall got` so both package files are updated by npm. Do not edit the lockfile manually. Confirm `rg "from ['\"]got|import got" src` returns no matches.

- [ ] **Step 5: Verify compile, lint, and legacy removal**

Run:

```shell
npm run build
npm run lint
node bin/run.js --help
node bin/run.js translate:bing --help
```

Expected: build and lint succeed; root help includes `translate`; the removed provider command exits as unknown command.

- [ ] **Step 6: Commit integration and cleanup**

```shell
git add src .ctv.config.json package.json package-lock.json
git commit -m "refactor: remove legacy translation engines"
```

### Task 6: Update public documentation and generated CLI metadata

**Files:**

- Modify: `README.md`
- Modify: `oclif.manifest.json`

**Interfaces:**

- Documents: the complete config and CLI contracts produced by Tasks 1–5.

- [ ] **Step 1: Rewrite translation and configuration documentation**

Document LM Studio, Google AI Studio, OpenRouter, and generic compatible profiles; environment-variable authentication; named-profile selection; positional/stdin/key modes; `--dry-run`; preview versus `--write`; JSON envelope; and the explicit absence of `--file`. Remove all Bing/Google Translate/Terra examples and legacy config fields. State that the existing cache command does not cache AI translations until task 6 of `PLAN.md` is implemented.

- [ ] **Step 2: Regenerate oclif documentation and manifest**

Run:

```shell
npm exec -- oclif manifest
npm exec -- oclif readme
```

Review generated README content to ensure only `ctv translate` appears and examples remain accurate. Restore hand-written conceptual sections if the generator preserves only command blocks incorrectly.

- [ ] **Step 3: Verify the packaged public surface**

Run:

```shell
npm run build
npm run lint
node bin/run.js --version
node bin/run.js --help
node bin/run.js translate --help
npm pack --dry-run --json
```

Expected: all commands exit 0; package dry-run includes compiled `dist/commands/translate.js` and declarations, contains no deleted provider command artifacts, and contains no source-only files.

- [ ] **Step 4: Commit documentation and metadata**

```shell
git add README.md oclif.manifest.json
git commit -m "docs: document AI translate command"
```

### Task 7: Run end-to-end manual verification

**Files:**

- Inspect only unless verification reveals an implementation defect.

**Interfaces:**

- Verifies the complete feature against the approved design without adding tests.

- [ ] **Step 1: Confirm runtime and clean static checks**

Run:

```shell
node --version
npm run build
npm run lint
git diff --check
```

Expected: Node is v24.15.0 or newer and all checks succeed.

- [ ] **Step 2: Verify dry-run and validation are network-free**

Snapshot `.ctv.config.json` and all configured dictionaries with hashes, then run dry-run plus invalid mixed-input, duplicate-target, missing-profile, missing-key, and invalid-language scenarios. Recompute hashes and confirm they are unchanged. Each usage/config failure must exit 2; dry-run must exit 0 and return ordered requests with empty results/written arrays.

- [ ] **Step 3: Verify real LM Studio translation**

Run:

```shell
node bin/run.js translate "Hello world" --from en --to uk --engine lmstudio --json
```

Expected: exit 0; result reports engine `lmstudio`, model `google/gemma-4-12b-qat`, source/target codes, source text, and a non-empty Ukrainian translation. If sandbox network isolation blocks the private endpoint, rerun with approved network access and report any external unavailability separately from code verification.

- [ ] **Step 4: Verify multi-target ordering and stdin**

Run a stdin request with `--to uk --to de --json`. Confirm results remain in `uk`, then `de` order and each result has the identical stable shape.

- [ ] **Step 5: Verify key preview and atomic write safely**

Copy the repository config and dictionaries to a temporary project directory. Run key preview and confirm dictionary hashes do not change. Run the same request with `--write`, confirm only selected target values change, and confirm JSON `written` follows config language order. Do not mutate repository dictionaries for this verification.

- [ ] **Step 6: Review final repository state**

Run:

```shell
git status --short
git log --oneline -8
rg "translate:(bing|google|terra)|BingEngine|GoogleEngine|TerraEngine|engineUseCache" README.md src package.json oclif.manifest.json
```

Expected: only intentional changes are present, task commits are visible, and the legacy search has no matches.
