# Multi-language batch translation design

## Context

Transverto currently represents every `key × target language` translation as a separate
`ITranslationRequestPlan`. `TranslationBatchService` applies limits, concurrency, delays,
retries, and placeholder validation, but it ultimately invokes `TranslationService.translate()`
once for every target language. Consequently, adding one source label to a project with twenty
target languages can produce twenty AI requests.

`label:add` writes the source value and then invokes `label:sync --auto-translate --write`, so it
already uses the shared translation pipeline. The same pipeline also serves `translate` and
`label:sync --auto-translate` directly.

## Goals

- Add an opt-in mode that translates one source text into multiple target languages in one AI
  request.
- Preserve the current per-language behavior by default.
- Preserve existing cache identities, placeholder validation, reports, primary/fallback
  behavior, retry policy, and target-file write safety.
- Use a dedicated prompt and response parser for multi-language translation.
- Let an interactive user decide how to handle an incomplete package.

## Non-goals

- Sending multiple source texts or multiple localization keys in one AI request.
- Requiring provider-specific structured-output features such as OpenAI `response_format`.
- Automatically falling back to individual requests without user approval.
- Changing the response format of the existing single-language engine method.

## Configuration

Add `mode` to the existing `batch` object:

```json
{
  "batch": {
    "mode": "multi-language",
    "concurrency": 5,
    "delayMs": 0,
    "retry": 2,
    "maxItems": null,
    "maxChars": null
  }
}
```

Allowed values are:

- `per-language`: the current behavior and the default for existing and new configurations.
- `multi-language`: group requests for one source text across target languages.

An omitted `batch.mode` resolves to `per-language`, so existing configuration files remain valid
and behaviorally unchanged. Unknown values fail configuration validation before any network call
or file write.

The remaining settings retain their current meaning:

- `maxItems` and `maxChars` apply to individual planned translations before grouping.
- `concurrency` limits simultaneously active packages in `multi-language` mode and individual
  attempts in `per-language` mode.
- `delayMs` is the minimum delay between package starts in `multi-language` mode.
- `retry` retries a failed package in `multi-language` mode.

For a single `label:add`, only one package exists, so increasing `concurrency` does not create
additional calls.

## Contracts and component boundaries

The existing single-language contract remains unchanged:

```ts
interface ITranslationRequestPlan {
  from: string
  key?: string
  sourceText: string
  to: string
}

interface TranslationEngine {
  translate(request: ITranslationRequestPlan): Promise<string>
}
```

Add an explicit multi-language request rather than overloading `to` or `translate()`:

```ts
interface IMultiLanguageTranslationRequestPlan {
  from: string
  key?: string
  sourceText: string
  targets: string[]
}

type TMultiLanguageTranslation = Record<string, string>
```

`TranslationEngine.translateBatch(request)` performs one provider call and returns the parsed
language-to-text map. `OpenAICompatibleEngine` implements both engine methods.

`TranslationService.translateBatch()` owns engine-profile selection, per-language cache lookup,
primary/fallback behavior, normalization into `ITranslationResult`, and deferred cache writes.
It returns enough information to distinguish cached results, fresh valid results, and response
issues. Fresh package results are not persisted until the complete batch operation has passed the
incomplete-response decision gate.

`TranslationBatchService` continues to own request planning, limits, scheduling, retries,
placeholder validation, stable result order, summaries, and outcome invariants. In
`multi-language` mode it additionally groups selected requests, coordinates incomplete-package
decisions, and invokes individual translation only when an interactive user explicitly requests
recovery.

Commands own terminal interaction. They supply an incomplete-package decision callback only when
an interactive prompt is possible. The service layer never imports prompt or terminal libraries.
The shared callback behavior is used by both `translate` and `label:sync`; `label:add` receives it
through its existing call to `label:sync`.

## Grouping and ordering

After skip and limit planning, selected requests are grouped by the exact tuple:

```text
from + key + sourceText
```

Only target languages vary within a group. Target ordering follows the original request order,
which ultimately follows configured language order. Duplicate target languages remain invalid.

Every provider result is converted back to the existing per-language `ITranslationResult` shape.
Downstream reports, placeholder checks, `TranslationProjectService`, and `SyncExecutor` therefore
continue to consume per-language results and do not receive provider response maps directly.

## Cache behavior

Cache identities remain per language and continue to include profile, model, source language,
target language, and source text.

Before a provider call, `TranslationService.translateBatch()` looks up every target independently:

- If all targets are cached, no provider request is made.
- If some targets are cached, the provider package contains only uncached targets.
- Accepted fresh results are written as individual cache entries.

Fresh cache writes are deferred for the entire `TranslationBatchService.execute()` operation. If
the user cancels any incomplete package, no fresh result from that operation is cached. Existing
cache entries are never removed.

## Dedicated batch prompt

Keep the existing `buildSystemPrompt` unchanged for single-language translation. Add a separate
`buildBatchSystemPrompt` for multi-language requests.

The batch prompt must state:

- The source text is a web or application UI localization string.
- The source language and exact ordered target-language list.
- The localization key is context only and must not be returned or translated.
- Each translation must use natural, concise UI terminology.
- Placeholders, HTML, template expressions, punctuation, capitalization, whitespace, paragraph
  structure, and formatting must be preserved.
- The response must be exactly one JSON object whose keys are the requested language codes and
  whose values are translated strings.
- Markdown fences, explanations, metadata, nested objects, arrays, and unrequested language keys
  are forbidden.

Example expected content:

```json
{
  "uk": "Переклад",
  "de": "Übersetzung"
}
```

The implementation relies on the prompt plus local parsing instead of provider-specific JSON mode,
because all configured providers expose an OpenAI-compatible endpoint but do not necessarily
implement structured-output options consistently.

## Response validation

The parser classifies each requested target independently. A target is valid only when:

- The completion parses as a top-level JSON object.
- The requested language key exists.
- Its value is a non-empty string.
- Its placeholder set matches the source placeholder set.

If the completion is malformed JSON or is not a top-level object, every requested target is
invalid. Missing keys, non-string values, empty strings, and placeholder mismatches invalidate only
their corresponding languages. Unrequested keys are ignored, recorded as warnings, and never
converted into results.

A package is complete when every requested target is valid. A complete package proceeds without a
prompt.

## Incomplete-package interaction

For an incomplete package, the human-readable prompt shows:

- Valid target languages.
- Missing or invalid target languages with concise reasons.
- Ignored, unexpected language keys when present.

The user chooses one of two actions:

1. Cancel the translation operation.
2. Keep valid package results and translate only missing or invalid targets through the existing
   per-language pipeline.

Incomplete-package prompts are serialized so concurrent packages can never create overlapping
terminal prompts.

If prompting is impossible because stdin or stdout is not a TTY, the operation always chooses
cancel. JSON and other non-interactive invocations never guess or automatically send individual
requests.

Cancellation applies to the complete command operation, not only to one package:

- No target translation files are written.
- No fresh package or individual results are cached.
- The command exits with code `1`.
- JSON output includes structured `incomplete` metadata and a decision of `cancel`.
- Affected requests are represented as remaining work with reason `incomplete_batch`, preserving
  the batch accounting invariant.

For `label:add`, cancellation does not roll back the source value that was written before
`label:sync` started. It prevents target translations and fresh cache entries only.

If the user selects per-language recovery:

- Valid package results are retained in memory.
- Only invalid or missing targets use `TranslationService.translate()`.
- Individual calls retain their current cache, primary/fallback, retry, and error behavior.
- Successful package and recovery results are cached and may be written to target files.
- If some recovery calls still fail, successful results are handled according to current partial
  success semantics, failures appear in the report, and the command exits with code `1`.
- JSON output records the incomplete package and a decision of `per-language`.

## Provider failures, fallback, and retries

A transport error, timeout, authentication failure, rate limit, HTTP error, empty completion, or
other full-package failure follows the same error classification used by single-language requests.

The existing semantics are preserved: `TranslationService` tries the configured primary profile,
uses the configured fallback profile for recoverable failures, and exposes any remaining error to
the outer batch retry policy. In multi-language mode, each such attempt contains the whole set of
uncached targets for that package.

An incomplete but parseable response is handled by the incomplete-package decision flow rather
than silently invoking fallback or individual translation.

## Reporting and exits

Add structured incomplete-package metadata to batch and command JSON output. Each entry contains:

- The source request identity (`from`, optional `key`, and `sourceText`).
- Requested, valid, invalid, and unexpected targets.
- A reason for every invalid target.
- The decision: `cancel` or `per-language`.

Human output presents the same information concisely. Existing per-language result, conflict,
failure, skip, remaining, and summary fields remain the authoritative final outcomes.

A canceled incomplete batch or failed recovery exits with code `1`. Configuration and invalid CLI
usage continue to exit with code `2`. A complete package or fully successful recovery exits with
code `0`.

## Command coverage

The mode applies uniformly to:

- `label:add`, through its existing `label:sync --auto-translate --write` call.
- `label:sync --auto-translate`.
- `translate` with multiple target languages or keys.

Each distinct source text/key becomes its own package. This design never combines multiple source
texts or keys into one provider call.

## Verification strategy

Unit and end-to-end tests must verify:

- An omitted mode and explicit `per-language` mode retain one provider call per target.
- `multi-language` sends one provider call for one source text with multiple targets.
- Multiple keys produce separate provider packages.
- The single and batch prompt builders use their respective output contracts.
- Target ordering and response-to-request mapping are deterministic.
- Complete, partial, malformed, non-object, empty-value, non-string, unexpected-key, and
  placeholder-conflict responses are classified correctly.
- Interactive cancel performs no target-file or fresh-cache writes.
- Non-TTY incomplete responses cancel without individual provider calls.
- Interactive per-language recovery calls only missing or invalid targets.
- Recovery retains valid package results and reports remaining individual failures.
- Full-package primary/fallback and retry behavior matches the current policy.
- Fully cached packages perform no provider call, and partially cached packages request only misses.
- Accepted results create the same per-language cache identities as the current mode.
- `maxItems` and `maxChars` are applied before grouping.
- `concurrency` and `delayMs` schedule packages rather than languages in multi-language mode.
- Existing configurations and existing per-language tests continue to pass unchanged.

