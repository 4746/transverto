# Safe Label Sync Design

## Scope

Task 10 replaces the legacy eager `ctv label:sync` implementation with a safe,
plan-first synchronization workflow. The command gains `--dry-run`, `--source`,
repeatable `--to`, repeatable `--include` and `--exclude`,
`--extra keep|report|remove`, `--auto-translate`, `--engine`, `--fallback`,
`--no-fallback`, and `--write`.

The legacy `--noReport` and `--silent` flags are removed without compatibility
aliases. Remote TMS integration, CSV import, new tests, and test-infrastructure
changes are outside this task.

## Command Semantics

The configured `langCodeDefault` is the source unless `--source <lang>` is
provided. Source selection never depends on the order of `languages`. Without
`--to`, every configured language other than the selected source is a target;
repeated `--to` selects targets in configuration order after rejecting duplicate,
unknown, or source-language values.

`--include` and `--exclude` use the same exact or edge-wildcard syntax as
`ctv status`: exact keys, `*`, `prefix*`, and `*suffix`. Values inside one filter
group are ORed, and exclude patterns take precedence. Filters apply before plan
construction. Keys that do not match remain byte-semantically untouched in the
in-memory dictionary and are never reported as sync actions.

The default `--extra report` retains target-only keys and reports them. `keep`
retains them without treating them as reportable drift, while `remove` plans
their deletion. Missing target keys are added with an empty string when
auto-translation is disabled. With `--auto-translate`, they become translation
actions whose source text comes from the selected source dictionary.

`--dry-run` performs all local validation and constructs the exact same initial
plan as a write run, but makes no engine call and writes no files. Translation
actions remain explicitly visible as pending actions. In non-TTY environments,
mutation requires `--write`. In a TTY, omitting `--write` shows the plan and asks
for confirmation before applying it. Supplying `--write` is non-interactive.

## Architecture

`src/commands/label/sync.ts` is a thin oclif adapter. It parses flags, resolves
batch and engine overrides, invokes the planner and optional translation batch,
renders the report, coordinates confirmation, and sets exit codes.

`src/shared/sync.repository.ts` loads and strictly validates configuration and
language dictionaries. Each dictionary root must be an object and every leaf
must be a string. It retains the exact bytes read for optimistic concurrency
checks and exposes structured dictionaries without mutating them.

`src/shared/sync-planner.ts` is a pure planner. It accepts loaded snapshots and
normalized options and returns a deeply read-only plan. Actions use the closed
set `add`, `remove`, `keep`, `translate`, `skip`, and `conflict`. Every action
identifies its language and key and carries only the values and reason needed to
execute or report it. Sorting follows target configuration order, then key.

`src/shared/sync-executor.ts` projects accepted actions onto clones of the loaded
dictionaries, verifies every input snapshot immediately before writing,
generates the enum once from the source dictionary, and submits all changed
dictionaries plus the enum as a single `applyFileTransaction` call.

`src/shared/sync-report.ts` converts the plan and execution outcomes into both a
stable ANSI-free JSON envelope and human-readable output. Per-language summaries
contain `added`, `removed`, `kept`, `translated`, `skipped`, `conflicts`,
`failed`, and `remaining` counters. JSON also contains the ordered action list,
selected source/targets, policy, dry-run/write state, and written files.

A shared key-pattern module is extracted from `status.service.ts`; both status
and sync consume it so validation and matching semantics cannot drift. Existing
JSON/key-path/file-transaction utilities are reused or factored into focused
shared modules only where necessary for sync and the following mutation tasks.

## Planning Rules

For every selected target and filtered source key:

- An existing string leaf produces `keep` and is never overwritten.
- A missing leaf produces `add` with `""` when auto-translation is off.
- A missing leaf produces `translate` when auto-translation is on.
- A leaf/object path collision produces `conflict`.

For every filtered target key absent from the source:

- `extra=keep` produces `keep` with an extra-kept reason.
- `extra=report` produces `keep` with an extra-reported reason.
- `extra=remove` produces `remove`.

Structural conflicts block all writes. Duplicate actions are forbidden by a
planner invariant. The planner freezes the plan and nested action records so the
same plan object can be rendered, translated, and executed without mutation.
Translation outcomes are tracked separately and never rewrite the initial plan.

## Auto-Translation

Only `translate` actions create `ITranslationRequestPlan` values. Requests keep
target order followed by key order and use the selected source language.
`TranslationService` provides cache and fallback behavior; `TranslationBatchService`
provides skip classification, placeholder checks, bounded retries, concurrency,
delay, and item/character limits. Batch settings come only from the shared
validated `config.batch`; sync does not introduce duplicate CLI controls.

`--engine`, `--fallback`, and `--no-fallback` have the same meanings and mutual
exclusion rules as `ctv translate`. Profile, language, and flag validation occurs
before any network request. Dry-run does not instantiate or call an engine.

Safe translation results are attached as execution outcomes. A failed request,
placeholder conflict, automatically skipped source, or limit/dry-run remaining
request leaves that target key absent. Other safe actions may still be applied,
but all resulting file changes are committed in one transaction. Any such
non-success outcome is reported and causes exit code 1.

## Write Safety

Repository snapshots are exact file bytes. Immediately before mutation, the
executor rereads every source and selected target file and compares bytes. Any
difference or disappearance aborts the whole write before the first mutation.
The source is checked even when sync does not alter it because it determines the
plan and generated enum.

The executor applies actions to structured clones. It serializes changed JSON
deterministically with two-space indentation and a trailing newline. It includes
the generated enum in the same file transaction and calls the generator once.
No-op files are omitted from the transaction. `applyFileTransaction` restores
all previously written targets if a later write fails, preventing partial file
updates.

## Errors and Exit Codes

Invalid usage, configuration, JSON, dictionary shape, pattern, language,
profile, or incompatible flags exit 2 before network access or writes. A stale
snapshot or file-transaction failure also exits 2 and emits a sanitized error.

Structural planning conflicts prevent all writes and exit 1 after the report.
Translation failures, placeholder conflicts, skipped values, or remaining work
are reported per language; failures, conflicts, and remaining work produce exit
1, while automatic skip alone does not. A clean dry-run or successful write
exits 0.

## Verification

No tests or test-infrastructure changes are added. Verification consists of:

- `npm run build`;
- `npm run lint`;
- `node bin/run.js label:sync --help`;
- manual fixtures for default source selection and explicit `--source`;
- repeated `--to`, include/exclude filters, and all three extra policies;
- parity checks between dry-run JSON actions and the initial plan from write;
- non-TTY rejection without `--write`;
- atomic multi-file write and one enum update;
- auto-translate dry-run proving no network call;
- a stale-snapshot scenario proving no file changes are committed.

