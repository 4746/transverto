# Batch Auto-Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reusable, bounded batch execution to `ctv translate`, including config/CLI controls, deterministic limits and ordering, recoverable retries, skip rules, placeholder safety, interactive acceptance, stable summaries, and accepted-only atomic writes.

**Architecture:** Keep single-request cache/fallback/provider behavior in `TranslationService`. Add a provider-independent `TranslationBatchService` that classifies and schedules ordered requests, plus a focused placeholder utility and a batch-config resolver. The oclif command owns prompts, output, exit codes, and dictionary writes, so the batch service remains reusable by Task 10.

**Tech Stack:** Node.js 24.15+, TypeScript 6 ESM, oclif 4, `@inquirer/prompts`, existing atomic JSON transaction and AI translation services.

## Global Constraints

- Runtime remains Node.js `>=24.15`; do not add compatibility code for older Node versions.
- Do not add dependencies, tests, or changes to test infrastructure; `PLAN.md` explicitly excludes tests for this task.
- Do not add `--file`, split stdin, perform web review, or estimate cost.
- Preserve request order as key input order followed by target input order.
- CLI values override individual `.ctv.config.json` batch fields.
- `retry: 2` means two retries after the first attempt.
- `maxItems: null` and `maxChars: null` disable their limits.
- Writes remain one atomic transaction and contain only accepted, placeholder-safe results.
- Dry-run performs no translation calls and no writes.

---

## File Structure

- Create `src/shared/entities/translation-batch.ts`: batch config, outcome, and summary contracts.
- Create `src/shared/translation-batch.config.ts`: defaults, runtime validation, and CLI override resolution.
- Create `src/shared/placeholder.ts`: placeholder extraction/multiset comparison and source skip classification.
- Create `src/shared/translation-batch.service.ts`: prefix limiting, bounded scheduling/retry, ordered outcomes, and summary calculation.
- Modify `src/shared/entities/translation.engine.ts`: expand `ITranslateOutput` with batch arrays and summary.
- Modify `src/shared/config.ts`: expose optional batch input and effective defaults.
- Modify `src/shared/config-builder.ts`: write default batch settings into new configs.
- Modify `src/commands/translate.ts`: flags, batch execution, TTY confirmation, partial output/write behavior, and exit codes.
- Modify `.ctv.config.json`: add the default `batch` object without changing existing profiles or project fields.
- Modify `README.md`: document batch configuration, flags, semantics, output, and generated command help.

---

### Task 1: Define and validate batch configuration and output contracts

**Files:**

- Create: `src/shared/entities/translation-batch.ts`
- Create: `src/shared/translation-batch.config.ts`
- Modify: `src/shared/entities/translation.engine.ts`
- Modify: `src/shared/config.ts`
- Modify: `src/shared/config-builder.ts`
- Modify: `.ctv.config.json`

**Interfaces:**

- Produces `ITranslationBatchConfig`, `ITranslationBatchOverrides`, outcome types, and `ITranslationBatchSummary`.
- Produces `TRANSLATION_BATCH_DEFAULTS` and `resolveTranslationBatchConfig(value, overrides)`.
- Expands `ITranslateOutput` for Tasks 3–4.

- [ ] **Step 1: Add focused batch contracts**

Create `src/shared/entities/translation-batch.ts` with these public shapes:

```ts
import type {
  ITranslationRequestPlan,
  ITranslationResult,
} from './translation.engine.js'
import type {TTranslationErrorCategory} from './translation-error.js'

export interface ITranslationBatchConfig {
  concurrency: number
  delayMs: number
  maxChars: null | number
  maxItems: null | number
  retry: number
}

export type ITranslationBatchOverrides = Partial<ITranslationBatchConfig>
export type TTranslationSkipReason = 'confirmation' | 'empty' | 'number' | 'token_only' | 'url'
export type TTranslationRemainingReason = 'dry_run' | 'limit'

export interface ITranslationSkipped {
  reason: TTranslationSkipReason
  request: ITranslationRequestPlan
  result?: ITranslationResult
}

export interface ITranslationConflict {
  request: ITranslationRequestPlan
  result: ITranslationResult
  sourcePlaceholders: string[]
  translatedPlaceholders: string[]
}

export interface ITranslationFailed {
  attempts: number
  category: TTranslationErrorCategory
  message: string
  request: ITranslationRequestPlan
}

export interface ITranslationRemaining {
  reason: TTranslationRemainingReason
  request: ITranslationRequestPlan
}

export interface ITranslationBatchSummary {
  cached: number
  conflict: number
  failed: number
  remaining: number
  skipped: number
  translated: number
}

export interface ITranslationBatchOutput {
  conflicts: ITranslationConflict[]
  failed: ITranslationFailed[]
  remaining: ITranslationRemaining[]
  results: ITranslationResult[]
  skipped: ITranslationSkipped[]
  summary: ITranslationBatchSummary
}
```

- [ ] **Step 2: Add defaults and strict runtime resolution**

Create `src/shared/translation-batch.config.ts`:

```ts
import type {
  ITranslationBatchConfig,
  ITranslationBatchOverrides,
} from './entities/translation-batch.js'

export const TRANSLATION_BATCH_DEFAULTS: ITranslationBatchConfig = {
  concurrency: 1,
  delayMs: 0,
  maxChars: null,
  maxItems: null,
  retry: 2,
}

export function resolveTranslationBatchConfig(
  value: unknown,
  overrides: ITranslationBatchOverrides = {},
): ITranslationBatchConfig
```

Validate that `value` is absent or a plain object containing only `concurrency`, `delayMs`, `maxChars`, `maxItems`, and `retry`. Merge defaults, config, then defined overrides. Reject non-integers; require `concurrency > 0`, `delayMs >= 0`, `retry >= 0`, and limits to be `null` or `> 0`. Error messages must name `batch.<field>`.

- [ ] **Step 3: Expand the stable translate envelope**

In `src/shared/entities/translation.engine.ts`, import the batch outcome types and replace `ITranslateOutput` with:

```ts
export interface ITranslateOutput {
  conflicts: ITranslationConflict[]
  dryRun: boolean
  failed: ITranslationFailed[]
  remaining: ITranslationRemaining[]
  requests: ITranslationRequestPlan[]
  results: ITranslationResult[]
  skipped: ITranslationSkipped[]
  summary: ITranslationBatchSummary
  written: string[]
}
```

Use `import type` where required to avoid runtime cycles.

- [ ] **Step 4: Add batch defaults to config creation**

In `src/shared/config.ts`, add:

```ts
batch?: Partial<ITranslationBatchConfig>
```

to `IConfig`. Change the existing default declaration exactly to:

```ts
export const CONFIG_DEFAULT: IConfig & {batch: ITranslationBatchConfig} = {
```

Then insert this property after `basePathEnum` in the existing object:

```ts
batch: {...TRANSLATION_BATCH_DEFAULTS},
```

In `buildConfig`, emit a cloned full default object:

```ts
batch: {...CONFIG_DEFAULT.batch},
```

Keep `batch` optional on `IConfig` so existing v2 config files remain valid while `CONFIG_DEFAULT.batch` is typed as a complete config.

- [ ] **Step 5: Migrate the repository config without touching profiles**

Add only this top-level section to `.ctv.config.json`, preserving every existing field verbatim:

```json
"batch": {
  "concurrency": 1,
  "delayMs": 0,
  "retry": 2,
  "maxItems": null,
  "maxChars": null
}
```

- [ ] **Step 6: Verify the schema boundary**

Run:

```powershell
npm run build
npm run lint
$task8Repo = (Get-Location).Path
$task8Temp = Join-Path ([IO.Path]::GetTempPath()) ("transverto-task8-init-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $task8Temp | Out-Null
Push-Location $task8Temp
node (Join-Path $task8Repo 'bin/run.js') init --minimal --force --no-files
Get-Content .ctv.config.json
Pop-Location
```

Expected: build/lint exit 0; the temporary `.ctv.config.json` contains the complete default `batch` object; the repository config is unchanged except for the intentional migration in Step 5.

- [ ] **Step 7: Commit configuration and contracts**

```powershell
git add src/shared/entities/translation-batch.ts src/shared/entities/translation.engine.ts src/shared/translation-batch.config.ts src/shared/config.ts src/shared/config-builder.ts .ctv.config.json
git commit -m "feat: define batch translation configuration"
```

---

### Task 2: Implement placeholder safety and source classification

**Files:**

- Create: `src/shared/placeholder.ts`

**Interfaces:**

- Produces `extractPlaceholders(text): string[]`.
- Produces `comparePlaceholders(source, translated): IPlaceholderComparison`.
- Produces `classifySkippedSource(text): TAutomaticSkipReason | undefined`.

- [ ] **Step 1: Implement exact placeholder extraction**

Create `src/shared/placeholder.ts` with:

```ts
export type TAutomaticSkipReason = 'empty' | 'number' | 'token_only' | 'url'

export interface IPlaceholderComparison {
  matches: boolean
  source: string[]
  translated: string[]
}

const PLACEHOLDER_PATTERN = /{{[^{}\r\n]+}}|{[^{}\r\n]+}|%(?:\d+\$)?s/gu

export const extractPlaceholders = (text: string): string[] =>
  [...text.matchAll(PLACEHOLDER_PATTERN)].map(match => match[0]).sort()

export const comparePlaceholders = (
  sourceText: string,
  translatedText: string,
): IPlaceholderComparison => {
  const source = extractPlaceholders(sourceText)
  const translated = extractPlaceholders(translatedText)
  return {
    matches: source.length === translated.length && source.every((value, index) => value === translated[index]),
    source,
    translated,
  }
}
```

Sorting makes order irrelevant while retaining duplicate counts.

- [ ] **Step 2: Implement deterministic skip classification**

In the same file, implement classification in this order: trimmed empty, standalone number, absolute HTTP/HTTPS URL, token-only. Use these exact primitives:

```ts
const STANDALONE_NUMBER_PATTERN = /^[+-]?(?:\d+(?:[.,]\d+)?|\d{1,3}(?:[ ,.'’]\d{3})+(?:[.,]\d+)?)$/u
const TOKEN_ONLY_REMAINDER_PATTERN = /^[\p{P}\p{S}\s]*$/u

const isAbsoluteHttpUrl = (value: string): boolean => {
  if (/\s/u.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function classifySkippedSource(text: string): TAutomaticSkipReason | undefined
```

`classifySkippedSource` trims once, applies the checks in the stated order, and uses `trimmed.replace(PLACEHOLDER_PATTERN, '')` for the token-only remainder.

- [ ] **Step 3: Verify utilities with an isolated compiled script**

Run `npm run build`, then run a one-line `node --input-type=module -e` script importing `dist/shared/placeholder.js`. Check that reordered `{{name}}`/`%1$s` matches, a missing duplicate does not match, and these inputs classify correctly: whitespace as `empty`, `-1,234.50` as `number`, `https://example.com/a` as `url`, `{{name}} — %s` as `token_only`, and `Hello {{name}}` as translatable.

Expected: script exits 0 and prints the expected arrays/categories.

- [ ] **Step 4: Run static checks and commit**

```powershell
npm run lint
git add src/shared/placeholder.ts
git commit -m "feat: validate translation placeholders"
```

---

### Task 3: Implement ordered batch planning, scheduling, and retry

**Files:**

- Create: `src/shared/translation-batch.service.ts`

**Interfaces:**

- Consumes `TranslationService.translate(request): Promise<ITranslationResult>` structurally.
- Consumes `ITranslationBatchConfig`, placeholder helpers, and recoverable error classification.
- Produces `TranslationBatchService.execute(requests, options): Promise<ITranslationBatchOutput>`.
- Produces `summarizeTranslationBatch(output): ITranslationBatchSummary` for command-side confirmation changes.

- [ ] **Step 1: Define injectable execution boundaries**

Start `src/shared/translation-batch.service.ts` with:

```ts
interface ITranslationExecutor {
  translate(request: ITranslationRequestPlan): Promise<ITranslationResult>
}

interface ITranslationBatchDependencies {
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}

export interface ITranslationBatchExecutionOptions {
  config: ITranslationBatchConfig
  dryRun: boolean
}

export class TranslationBatchService {
  constructor(
    private readonly executor: ITranslationExecutor,
    dependencies: ITranslationBatchDependencies = {},
  )

  execute(
    requests: ITranslationRequestPlan[],
    options: ITranslationBatchExecutionOptions,
  ): Promise<ITranslationBatchOutput>
}
```

Default `now` to `Date.now` and `sleep` to a `setTimeout` promise. The injection points permit deterministic isolated verification without adding tests.

- [ ] **Step 2: Classify and apply prefix limits**

Index every request before classification. Put automatic skips directly into indexed skipped outcomes. Apply `maxItems` and cumulative `sourceText.length` only to translatable requests. Select the longest initial translatable prefix; after the first overflow, mark every later translatable request `remaining: limit`, even if a later item would fit.

For dry-run, convert selected requests to `remaining: dry_run` and do not call the executor. Return arrays sorted by original index, then strip internal indexes.

- [ ] **Step 3: Implement global start spacing and bounded worker pool**

Use at most `Math.min(config.concurrency, selected.length)` workers sharing a monotonically updated `nextStartAt`. Reserve a start slot synchronously before awaiting sleep:

```ts
const startedAt = Math.max(now(), nextStartAt)
nextStartAt = startedAt + config.delayMs
await sleep(Math.max(0, startedAt - now()))
```

Workers claim the next selected index from one shared counter. Store each terminal outcome with its original request index; never push completion-order output directly to public arrays.

- [ ] **Step 4: Implement recoverable-only retry**

For each selected request, call the executor until success, a non-recoverable error, or `config.retry` is exhausted. Convert unknown thrown values with `toTranslationError(error, 'provider_response')`. Retry only when `isRecoverableTranslationError(error)` is true.

Before retry number `retryIndex` (starting at zero), wait:

```ts
Math.min(30_000, Math.max(config.delayMs, 100) * (2 ** retryIndex))
```

Then reserve the next global start slot. Record total attempts in `ITranslationFailed`. Do not retry any successful result.

- [ ] **Step 5: Detect placeholder conflicts after success**

Call `comparePlaceholders(request.sourceText, result.translatedText)`. On mismatch, emit `ITranslationConflict` containing the result and both sorted placeholder arrays. Otherwise emit the result. Conflicts do not cancel workers.

- [ ] **Step 6: Produce exhaustive stable summary**

Export:

```ts
export function summarizeTranslationBatch(
  output: Omit<ITranslationBatchOutput, 'summary'>,
): ITranslationBatchSummary
```

Count non-cached results as `translated`, cached results as `cached`, and use array lengths for the other four statuses. Assert or throw if the six counts do not equal the original request count inside `execute`; this catches lost outcomes before command output or writes.

- [ ] **Step 7: Verify scheduling and failure isolation with an isolated script**

After `npm run build`, run a temporary `node --input-type=module` script that constructs the service with a fake executor and injected zero-cost sleep/clock. Cover:

- concurrency never exceeds the configured value;
- returned results preserve input order after out-of-order completion;
- a recoverable error succeeds on retry without repeating earlier successes;
- a validation/provider-response error records one attempt;
- one placeholder mismatch becomes a conflict;
- `maxItems` and `maxChars` produce a prefix and `remaining: limit`;
- dry-run makes zero executor calls and reports selected requests as `remaining: dry_run`.

Expected: script exits 0 using `node:assert/strict` and writes no repository files.

- [ ] **Step 8: Run static checks and commit**

```powershell
npm run build
npm run lint
git add src/shared/translation-batch.service.ts
git commit -m "feat: execute controlled translation batches"
```

---

### Task 4: Integrate batch execution, confirmation, output, and safe writes

**Files:**

- Modify: `src/commands/translate.ts`

**Interfaces:**

- Consumes `resolveTranslationBatchConfig`, `TranslationBatchService`, and `summarizeTranslationBatch`.
- Produces the complete CLI contract and stable `ITranslateOutput`.

- [ ] **Step 1: Add CLI flags and typed flag input**

Add integer flags:

```ts
'concurrency': Flags.integer({description: 'maximum simultaneous translation attempts'}),
'delay-ms': Flags.integer({description: 'minimum milliseconds between attempt starts'}),
'max-chars': Flags.integer({description: 'maximum source characters in this batch'}),
'max-items': Flags.integer({description: 'maximum requests in this batch'}),
retry: Flags.integer({description: 'recoverable retries after the first attempt'}),
confirm: Flags.boolean({description: 'accept or skip each safe result before writing'}),
```

Keep `--dry-run` and every existing input/engine/fallback/write flag. Add help examples for config overrides and `--confirm --write`.

- [ ] **Step 2: Validate confirmation and resolve config before work**

Extend flag validation so `--confirm` requires `--write`, rejects `--dry-run`, and requires both `process.stdin.isTTY` and `process.stdout.isTTY`. Resolve effective settings with:

```ts
const batchConfig = resolveTranslationBatchConfig(this.cliConfig.batch, {
  ...(flags.concurrency === undefined ? {} : {concurrency: flags.concurrency}),
  ...(flags['delay-ms'] === undefined ? {} : {delayMs: flags['delay-ms']}),
  ...(flags['max-chars'] === undefined ? {} : {maxChars: flags['max-chars']}),
  ...(flags['max-items'] === undefined ? {} : {maxItems: flags['max-items']}),
  ...(flags.retry === undefined ? {} : {retry: flags.retry}),
})
```

Do this in the existing usage/config error block so failures exit 2 before stdin, network, or write.

- [ ] **Step 3: Replace the sequential loop with the batch service**

After requests are built, call:

```ts
const batch = await new TranslationBatchService(translationService).execute(requests, {
  config: batchConfig,
  dryRun: flags['dry-run'],
})
```

Remove the old early dry-run envelope and sequential `for` loop. Translation failures are now structured batch outcomes rather than thrown command errors; truly unexpected service/invariant errors still use exit 1.

- [ ] **Step 4: Add stable TTY accept/skip prompts**

Import `select` from `@inquirer/prompts`. For `--confirm`, iterate `batch.results` in stable order and ask:

```ts
const decision = await select<'accept' | 'skip'>({
  choices: [
    {name: 'accept', value: 'accept'},
    {name: 'skip', value: 'skip'},
  ],
  message: `${result.key} -> ${result.to}: ${result.translatedText}`,
})
```

Move skipped decisions to `batch.skipped` with `reason: 'confirmation'`, `request` copied from the result, and `result` attached. Recalculate summary with `summarizeTranslationBatch`.

- [ ] **Step 5: Write only accepted safe results once**

Use:

```ts
const written = flags.write && batch.results.length > 0
  ? await projectService.write(batch.results)
  : []
```

Build the full output as `{...batch, dryRun: flags['dry-run'], requests, written}`. No failed, conflict, skipped, or remaining entry reaches `TranslationProjectService.write`.

- [ ] **Step 6: Emit output before setting partial-failure exit status**

Expand human output to print automatic/manual skips, conflicts, failures with attempts, remaining reasons, accepted results, written languages, and one summary line. JSON returns the stable envelope without ANSI.

After output has been prepared, set `process.exitCode = 1` when `summary.failed > 0 || summary.conflict > 0`; do not call `this.error`, because that would discard the structured output. Skips and remaining keep exit 0.

- [ ] **Step 7: Verify network-free and usage scenarios**

Run:

```powershell
npm run build
npm run lint
node bin/run.js translate --help
node bin/run.js translate "Hello" --to uk --dry-run --json
node bin/run.js translate "123" --to uk --dry-run --json
node bin/run.js translate "Hello" --to uk --max-items 0 --dry-run --json
'' | node bin/run.js translate --key hello.world --to uk --confirm --write
```

Expected: help shows all flags; dry-runs perform no network/write and contain exhaustive summaries; invalid `--max-items 0` exits 2; piped/non-TTY confirm exits 2 before network/write.

- [ ] **Step 8: Verify accepted-only write in a temporary project**

Copy config and language dictionaries to a temporary directory. Start a local OpenAI-compatible HTTP stub on `127.0.0.1` with an ephemeral port; its `/chat/completions` handler reads the last user message and returns `{choices: [{message: {content: source.includes('{{name}}') ? 'Broken' : 'Безпечний переклад'}}]}`. Point one temporary engine profile at the stub, configure two source keys (one plain and one containing `{{name}}`), and run both keys with `--write`. Hash/inspect dictionaries before and after. Keep the stub and copied dictionaries outside the repository and stop the stub after verification.

Expected: command exits 1 because of the conflict; the safe accepted value is written once; the conflicted value is unchanged; no repository dictionary changes.

- [ ] **Step 9: Commit the CLI integration**

```powershell
git add src/commands/translate.ts
git commit -m "feat: control batch auto-translation"
```

---

### Task 5: Document and verify the complete Task 8 surface

**Files:**

- Modify: `README.md`

**Interfaces:**

- Documents all public config, flags, output, status, and exit behavior introduced by Tasks 1–4.

- [ ] **Step 1: Document batch configuration and precedence**

Add the `batch` object to both README config examples. Explain defaults, validation, `null` limits, and that CLI flags override individual fields for one run.

- [ ] **Step 2: Document execution semantics**

In Translation workflow, document stable order, prefix limits, automatic skip categories, global delay, recoverable-only retry, placeholder multiset validation, partial failures, `--confirm --write`, accepted-only atomic writes, and the deliberate absence of `--file`/stdin splitting.

- [ ] **Step 3: Document JSON output and exit codes**

Expand the envelope example with `skipped`, `conflicts`, `failed`, `remaining`, and the six-field `summary`. State that failures/conflicts exit 1 after output, usage/config errors exit 2, and skips/remaining alone exit 0. Explain `remaining.reason` values `limit` and `dry_run`.

- [ ] **Step 4: Regenerate command documentation**

Run:

```powershell
npm exec -- oclif readme
```

Review the generated `ctv translate` block. Preserve the handwritten conceptual sections and confirm all new flags/examples are present exactly once.

- [ ] **Step 5: Run final static and CLI verification**

Run:

```powershell
node --version
npm run build
npm run lint
node bin/run.js --help
node bin/run.js translate --help
git diff --check
git status --short
```

Expected: Node is v24.15.0 or newer; build/lint/help/diff checks exit 0; status contains only intended Task 8 documentation changes before the documentation commit.

- [ ] **Step 6: Run final behavior verification**

In an isolated temporary project/stub environment, verify multi-key/multi-target stable ordering under concurrency, delay start spacing, both limits, all automatic skips, cache counting, recoverable retry, non-recoverable single attempt, conflict exit 1, partial accepted write, dry-run hashes unchanged, and non-TTY confirm exit 2. Do not mutate repository dictionaries and do not depend on the private LM Studio endpoint for deterministic checks.

- [ ] **Step 7: Confirm forbidden scope is absent**

Run searches proving there is no new file input, web review, cost estimate, or test change:

```powershell
git diff --name-only 2c417a0
git diff 2c417a0 -- test package.json
rg "Flags\.(string|file).*file|cost estimate|web review" src/commands/translate.ts src/shared README.md
```

Expected: no test/package changes; no new file-input implementation; any README mention of `--file` only states that it is unsupported.

- [ ] **Step 8: Commit documentation**

```powershell
git add README.md
git commit -m "docs: explain batch translation controls"
```

- [ ] **Step 9: Review final repository state**

```powershell
git status --short
git log --oneline -8
```

Expected: working tree is clean; the design, configuration/contracts, placeholder utility, batch service, CLI integration, and documentation commits are visible.

