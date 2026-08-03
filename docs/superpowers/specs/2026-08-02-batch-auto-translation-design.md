# Batch Auto-Translation Design

## Scope

Task 8 adds controlled batch execution to `ctv translate`. Batch behavior applies to every request set produced by repeated `--key`, repeated `--to`, or both. Positional text and stdin remain single source values; the command does not add `--file` and does not split stdin into lines.

The implementation adds configuration and CLI overrides for concurrency, request spacing, limits, retries, and interactive confirmation. It also skips values that should not be translated and prevents placeholder-damaging translations from being written. Web review and cost estimation remain out of scope.

## Configuration and CLI

The optional top-level `batch` configuration has these effective defaults:

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

`concurrency` must be a positive integer. `delayMs` and `retry` must be non-negative integers. `maxItems` and `maxChars` must be positive integers or `null`; `null` disables the corresponding limit. An absent `batch` object receives the defaults so existing v2 configuration remains valid. New configurations created by `ctv init` explicitly contain the default `batch` object.

`ctv translate` adds `--concurrency`, `--delay-ms`, `--retry`, `--max-items`, `--max-chars`, and `--confirm`. A supplied CLI value overrides only the corresponding configuration value. Existing `--dry-run` remains the planning-only mode.

`--confirm` is valid only with `--write` in a TTY. Invalid flag combinations and invalid batch configuration fail with usage exit code 2 before network or file writes.

## Components

### Translation batch service

`src/shared/translation-batch.service.ts` owns request classification, limits, scheduling, retry, placeholder validation, and stable ordered outcomes. It consumes ordered `ITranslationRequestPlan` values and delegates individual attempts to the existing `TranslationService`, preserving its cache and fallback behavior.

The service is independent of oclif prompts and dictionary writes. This boundary allows Task 10's sync implementation to reuse the same pipeline.

### Placeholder utility

`src/shared/placeholder.ts` extracts and compares these placeholder forms:

- `{{name}}`
- `{count}`
- `%s`
- `%1$s`

Comparison uses an exact multiset: placeholder order may change, but spelling and occurrence count must match. A mismatch produces a conflict rather than a writable result.

### Translate command

`src/commands/translate.ts` continues to validate input mode and build requests. It resolves effective batch options, invokes the batch service, optionally prompts for accepted results, writes only safe accepted key results through `TranslationProjectService`, formats output, and selects the exit code.

### Output contracts

The stable translate envelope retains `dryRun`, `requests`, `results`, and `written`, and adds structured `skipped`, `conflicts`, `failed`, `remaining`, and `summary` fields. Each non-result outcome contains its original request. Failure records also contain the sanitized error category, message, and total attempt count.

## Planning and Limits

Planning preserves the original request order: key input order first, then target input order, matching the existing project planner.

Before limits are applied, each source value is classified. The following values are skipped without a network call:

- `empty`: empty or whitespace-only;
- `number`: a standalone signed number using common grouping or decimal separators;
- `url`: one absolute HTTP or HTTPS URL;
- `token_only`: after supported placeholders are removed, only whitespace or punctuation remains.

Skipped requests do not consume `maxItems` or `maxChars`.

The limits select the longest initial prefix of translatable requests that satisfies both constraints. `maxItems` counts selected requests, and `maxChars` counts their source-text characters. Once the next request would exceed either limit, that request and every later translatable request become `remaining`. If the first translatable request alone exceeds `maxChars`, the selected batch is empty.

## Scheduling and Retry

The batch service uses a bounded worker pool. `concurrency` limits all active translation attempts. Completed outcomes are reordered to input order before they are returned.

`delayMs` is a global minimum interval between the starts of attempts. It applies to calls into `TranslationService`; cached calls may therefore also be spaced, because cache lookup and provider access intentionally remain encapsulated in that service.

Only `rate_limit`, `timeout`, `network`, and `provider_unavailable` errors are retried. `retry` counts additional attempts, so the default permits three total attempts. Backoff is bounded exponential backoff. Its base is `max(delayMs, 100)` milliseconds, doubles for each retry, and is capped at 30 seconds. Non-recoverable errors immediately become `failed` outcomes. A successful request is never submitted again.

An individual failure or conflict does not stop other workers or requests.

## Placeholder Conflicts and Confirmation

After a successful translation, source and target placeholder multisets are compared. A mismatch becomes a `conflict`, is excluded from `results`, and can never be written automatically.

With `--confirm --write`, translation completes before prompting. Safe results are shown one at a time in stable input order with `accept` and `skip` choices. Accepted results remain in `results`; rejected results move to `skipped` with a distinct confirmation reason. Automatic and interactive skips are distinguishable in structured output.

Without `--confirm`, every safe result is accepted. Preview mode without `--write` still returns all safe results but does not mutate dictionaries.

## Writes, Summary, and Exit Codes

When `--write` is present, all accepted safe results are passed to the existing all-or-nothing dictionary transaction once. If no results are accepted, no dictionary file is rewritten. Conflicts, failures, skips, and remaining requests are never written.

The summary assigns each request exactly one terminal status:

- `translated`: accepted successful non-cache result;
- `cached`: accepted successful cache result;
- `skipped`: automatically or interactively skipped;
- `conflict`: placeholder mismatch;
- `failed`: translation failed after its allowed attempts;
- `remaining`: not executed because of a batch limit or dry-run.

The six counts sum to the number of planned requests. `failed` or `conflict` makes the command exit with code 1 after human or JSON output is produced. `skipped` and `remaining` alone do not make the command fail. Usage and configuration errors exit with code 2.

## Dry Run

`--dry-run` validates configuration, profiles, flags, languages, dictionaries, and keys, then performs classification and limit planning without calling `TranslationService.translate` and without writing files. It returns empty `results`, `conflicts`, and `failed` arrays while reporting deterministic `skipped` and `remaining` entries. Selected requests are `remaining` with reason `dry_run`; requests excluded by a limit are `remaining` with reason `limit`. This keeps the summary exhaustive without labeling unexecuted requests as translations.

## Documentation and Verification

README and generated CLI help document configuration defaults, CLI precedence, limits, skip rules, retries, confirmation, exit behavior, and the expanded JSON envelope.

Per `PLAN.md`, Task 8 does not add tests or modify test infrastructure. Manual verification covers:

- `npm run build` and `npm run lint`;
- command help and numeric/config validation;
- network-free, write-free dry runs;
- stable output under concurrency;
- prefix behavior for both limits;
- automatic skip categories;
- recoverable-only bounded retry;
- placeholder conflicts excluded from writes;
- non-TTY rejection of `--confirm`;
- accepted-only atomic writes in a temporary project.

