# Critical CLI Tests Design

## Goal

Replace the outdated mixed test suite with a focused, maintainable suite that protects Transverto's critical CLI workflows through real process execution and a small number of targeted unit tests.

## Scope

The new suite covers these critical commands and behaviours:

- `init`, `status`, and `doctor`;
- `label:add`, `label:get`, `label:delete`, `label:replace`, `label:rename`, `label:move`, and `label:sync`;
- `import:csv` and `export:csv`;
- `translate` without external network access;
- shared parsing, planning, filtering, and atomic-write logic only where an end-to-end test would give poor diagnostics or make an edge case impractical to reproduce.

The suite does not attempt exhaustive flag combinations, exact decorative table formatting, or complete help-text snapshots. `cache:*` and `language:*` are outside the initial scope unless a critical workflow directly depends on them.

## Test Architecture

The suite uses Node's built-in `node:test` runner throughout. Tests are divided into three responsibilities:

- `test/e2e/` starts the compiled CLI through `bin/run.js` and verifies behaviour visible to a CLI consumer.
- `test/unit/` imports compiled pure or infrastructure modules and covers narrowly selected edge cases.
- `test/helpers/` owns project fixtures, CLI process execution, local HTTP fakes, JSON parsing, and safe cleanup.

All tests run against compiled output. `npm test` builds the project before running the complete test suite. The lint command includes all new JavaScript test and helper files.

The old Mocha and `@oclif/test` tests are removed after their useful behavioural guarantees have been represented in the new suite. The existing safe-sync end-to-end coverage is retained and reorganized rather than discarded. Mocha, `@oclif/test`, `ts-node`, the old test bootstrap, and the test-specific TypeScript configuration are removed when no production or development workflow still needs them.

## Fixture and Process Isolation

Each end-to-end test creates its own project below the operating system's temporary directory. A fixture contains only the configuration, translation dictionaries, CSV input, cache data, or other files required by that scenario. The CLI process receives the fixture directory as its working directory.

Cleanup is guarded by both an expected temporary-root check and a Transverto-specific directory-name prefix. The helper refuses to recursively remove any path outside that boundary.

Tests do not modify repository configuration or translation files, share mutable fixtures, depend on execution order, require an interactive terminal, or contact an external service. Translation-provider scenarios use a local HTTP server with deterministic responses and connection accounting.

## Behavioural Coverage

### Project health

`init` verifies default configuration creation, refusal to overwrite an existing configuration, and forced replacement. `status` and `doctor` cover both a healthy project and representative invalid configuration or dictionary states, including stable JSON output and exit codes.

### Label workflows

The mutation commands verify resulting dictionary contents instead of only checking command invocation. Coverage includes successful add, replace, delete, rename, and move operations; lookup output; dry-run or explicit-write behaviour where supported; collisions and invalid keys; preservation of unrelated data; and prevention of partial writes.

`label:sync` retains coverage for preview/write plan equivalence, target and key filters, extra-key policies, structural conflicts, stale snapshots, rollback after a later write failure, and dry-run auto-translation without network or file mutation.

### CSV workflows

`import:csv` covers valid imports, dry-run behaviour, duplicate or conflicting rows, invalid CSV input, and atomic failure. `export:csv` covers its stable header and row contract, language selection, deterministic ordering where promised by the command, and correct escaping of commas, quotes, and newlines.

### Translation workflow

`translate` is exercised against a deterministic local provider. Coverage includes a successful translation, placeholder preservation, cache reuse, provider failure, and bounded failure behaviour. Tests prove that no external network dependency is required.

## Assertions and Error Handling

End-to-end scenarios assert the observable contract appropriate to the command:

- process exit codes, including success and user/input or operational failures;
- structured JSON output when the command exposes a machine-readable mode;
- stdout or stderr fragments only when they form a meaningful user contract;
- exact contents of files that must change;
- byte-for-byte preservation of files that must not change;
- absence of generated files after preview or failed operations;
- idempotent second execution where idempotency is expected;
- complete rollback when a multi-file mutation fails.

Tests avoid snapshots of incidental formatting. Unit tests use direct values and explicit error assertions so a failure identifies the broken rule.

## Completion Criteria

The replacement is complete when:

1. the critical scenarios above are represented by deterministic tests;
2. the obsolete Mocha suite and unused test dependencies/configuration are removed;
3. tests are isolated and require no external network access;
4. `npm test` passes from the repository root;
5. the complete lint command passes for source and test files;
6. the production build passes independently;
7. no test leaves repository or temporary fixture state behind.
