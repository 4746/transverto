# Label add failure diagnostics design

## Goal

Make `ctv label:add` print every underlying translation-engine failure instead
of replacing the details with the generic message `Translation batch contains
failed items and is not complete.`

## Root cause

The engine produces a specific `TranslationError`. `TranslationBatchService`
preserves its category and message in each `ITranslationFailed`, together with
the target request and attempt count. The details are lost only after batch
execution: `LabelAddExecutor` correctly rejects an incomplete batch with a
generic invariant error, and `LabelAdd` prints only that error.

The executor remains responsible for validating completeness and applying the
atomic file transaction. Human-readable diagnostics belong to the command
layer, which still has access to the complete batch.

## Console behavior

When `LabelAddExecutor.apply()` fails and `batch.failed` is non-empty,
`label:add` writes a multiline message to stderr:

```text
Translation failed; label was not added:
- de [provider_unavailable] after 3 attempts: Engine profile "lmstudio" (...) returned HTTP 500: model not found
- uk [timeout] after 3 attempts: Engine profile "lmstudio" (...) request failed: timeout
```

There is one line for every `ITranslationFailed`. Each line contains:

- target language from `failed.request.to`;
- failure category;
- attempt count, using `attempt` for one and `attempts` for all other counts;
- the original engine/provider message.

The formatter preserves batch order. Tests must not require a particular order
when failures were produced concurrently.

If `batch.failed` is empty, `label:add` continues to render the caught error as
it does today. This preserves existing messages for conflicts, skipped items,
remaining items, incomplete model output, repository failures, and atomic-write
failures.

The detailed message is written even when `--silent` is enabled because
`--silent` suppresses progress output, not errors.

## Architecture

Add a private command-level formatter in `src/commands/label/add.ts` that
accepts `ITranslationFailed[]` and returns the complete multiline string. The
existing catch block chooses that formatted message when the batch contains
failures; otherwise it uses the existing `errorMessage(error)` fallback.

No changes are made to:

- `TranslationError` or `ITranslationFailed`;
- engine request/response handling;
- retry or fallback behavior;
- `TranslationBatchService` ordering and aggregation;
- `LabelAddExecutor` completeness validation;
- exit codes, cache behavior, or atomic rollback.

This keeps the fix local to the command that currently hides the preserved
diagnostics and avoids coupling the executor to console presentation.

## Error handling and safety

The command keeps exit code `1` for translation/runtime failures. It does not
write dictionaries, generated types, or translation cache entries when the
batch contains failures. Configuration errors thrown before a batch exists
continue through the existing specific `errorMessage` path.

Provider messages are printed verbatim from `ITranslationFailed.message`.
Current engine messages contain profile/model/status context but do not include
API keys. No stack trace or error cause object is exposed.

## Verification

An E2E test will make multiple target-language requests fail with distinct
provider messages and assert that:

1. the process exits with code `1`;
2. stderr contains the failure heading;
3. every failed target, category, attempt count, and original provider message
   is present, regardless of concurrent ordering;
4. the old generic-only message is not the reported diagnostic;
5. all language dictionaries and generated types remain byte-for-byte
   unchanged.

A focused formatter/unit test is unnecessary because the E2E test exercises
the complete data path where the regression occurred. The implementation is
complete after the focused E2E test, lint, build, and full test suite pass.
