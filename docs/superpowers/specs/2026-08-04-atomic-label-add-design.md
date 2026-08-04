# Atomic `label:add` Design

## Goal

Make `ctv label:add` treat `--fromLangCode` as the actual translation source and commit the new label to every configured dictionary plus `TLanguageLabel` as one all-or-nothing operation.

## Current Problem

`label:add` writes the entered value to the selected language file before it invokes `label:sync`. The nested sync command receives no `--source`, so it uses `langCodeDefault`. A key entered in a non-default language is therefore classified as an extra target key: it is not translated to the other dictionaries and does not enter the types generated from the default dictionary. Translation failure can also leave the initially selected dictionary changed while the other project files remain unchanged.

## Command Semantics

- `--fromLangCode` identifies the language of `--translation`; it defaults to `langCodeDefault` as it does today.
- The entered value replaces the label value in the selected source dictionary.
- An existing string value for the same label in any other dictionary is preserved.
- Every configured dictionary in which the label is missing is a target.
- With automatic translation enabled, every missing target must receive a valid translation before any project file is written.
- With `--noAutoTranslate`, every missing target receives an empty string and the operation requires no translation engine.
- A structural path conflict in any configured dictionary rejects the complete operation. For example, adding `btn.world` conflicts when `btn` or `btn.world` has an incompatible object/string shape.
- A missing or invalid configured dictionary rejects the operation before any write. `label:add` will no longer create one missing language file interactively because that would permit an incomplete configured project.
- Human-facing command syntax and the final `Done!` message remain unchanged.

## Architecture

The command becomes an orchestrator over three focused components instead of writing a source file and invoking `label:sync`:

1. `LabelAddRepository` loads the configuration-bound snapshot: every configured dictionary, its original bytes, and the generated-types file state.
2. `LabelAddPlanner` validates the requested key across all dictionaries and produces an immutable plan containing source assignment, preserved values, missing targets, conflicts, and translation requests.
3. `LabelAddExecutor` combines a complete translation outcome with the plan, constructs every final dictionary in memory, generates types from the final `langCodeDefault` dictionary, and applies changed files through `applyFileTransaction` with snapshot preconditions.

The shared entity definitions live in `src/shared/entities/label-add.ts`. The command owns engine selection, batching, interactive incomplete-response recovery, and user output, matching the existing `label:sync` orchestration pattern.

## Data Flow

1. Parse and validate the label, source language, and source text.
2. Load all dictionaries and types without changing the filesystem.
3. Create the label-add plan.
4. If the plan contains a structural conflict, report an error and stop.
5. When `--noAutoTranslate` is absent, send one request per missing target through `TranslationBatchService`. Existing batch mode, retry, fallback, concurrency, limits, and incomplete-package prompting remain in effect.
6. Require a complete usable outcome. Any failed, conflicting, remaining, skipped, cancelled, missing, or duplicate translation rejects the operation.
7. Build the final dictionaries in memory. Set the entered source value, preserve existing target strings, and set only missing target values from translations or to `""` under `--noAutoTranslate`.
8. Generate types from the final default-language dictionary.
9. Commit all changed dictionaries and the types file in one file transaction.
10. Print `Done!` only after the transaction succeeds.

## Atomicity and Cache Boundary

No configured dictionary or generated-types file changes unless planning and all required translation work succeed. The transaction uses original-byte preconditions, so concurrent edits detected after planning also reject the operation without overwriting them. A filesystem failure during the commit restores already-applied project files using the existing transaction rollback.

Provider requests cannot be rolled back. Translation cache reads are allowed while planning translations, but `label:add` must not persist fresh cache entries before the project transaction succeeds. Fresh results may be cached after a successful project commit as a best-effort optimization; a cache-write failure does not invalidate the already successful project mutation and must not make the command report that the label add failed.

## Error Handling

- Configuration, dictionary-read, JSON, validation, or path-conflict errors happen before translation and writing.
- Batch incompleteness can use the existing interactive choice to recover missing targets per-language. The operation proceeds only if recovery produces the complete target set.
- Non-interactive incomplete packages default to cancellation and leave all project files unchanged.
- Translation failures, placeholder conflicts, batch limits, and skipped source classifications leave all project files unchanged and produce a non-zero command result.
- File precondition or transactional write failures leave the project at its original snapshot.

## Testing

End-to-end coverage will prove:

- a new label entered in a non-default language is translated into the default and every other configured language;
- the new label appears in `TLanguageLabel` generated from the final default dictionary;
- existing values in non-source dictionaries are preserved;
- `--noAutoTranslate` writes empty strings only to missing targets;
- an incomplete multi-language package, per-language failure, placeholder conflict, batch limit, skipped source, or structural conflict changes no dictionary and no types file;
- a missing configured dictionary fails without creating or modifying project files;
- a concurrent snapshot change prevents the transaction from overwriting user edits;
- default-language additions continue to work;
- only fresh translation results from a successful addition are eligible for post-commit caching.

Unit tests will cover plan validation and executor completeness invariants. End-to-end tests will cover CLI orchestration, provider batching, generated types, and rollback behavior.

## Out of Scope

- Changing `label:sync` semantics or its default source selection.
- Retranslating existing target values.
- Adding dry-run or JSON output flags to `label:add`.
- Making provider calls reversible.
