# Safe Sync E2E Test Design

## Goal

Persist the manual Task 10 verification scenarios as repeatable end-to-end tests
under `test/e2e`. Tests must execute the packaged CLI behavior in child
processes without reading, modifying, or deleting repository project data.

This explicit user request overrides Task 10's earlier restriction against
adding tests.

## Runner

Use the Node.js 24 built-in `node:test` runner and `node:assert/strict`.
Tests use `.mjs`, so they need no TypeScript loader, Mocha configuration, or
new dependency. Add:

```json
{
  "scripts": {
    "test:e2e": "npm run build && node --test test/e2e/*.e2e.mjs"
  }
}
```

The existing `npm test` and old Mocha suite remain unchanged. They contain
legacy tests that operate in the repository root; folding them into this work
would expand scope and risk the repository's `.ctv.config.json`.

## Fixture Harness

`test/e2e/helpers/project-fixture.mjs` exports focused helpers to:

- create a unique project with `fs.promises.mkdtemp` under `os.tmpdir()`;
- write a complete minimal `.ctv.config.json` and language dictionaries;
- invoke `bin/run.js` with `process.execPath`, an explicit fixture `cwd`,
  inherited environment, and color disabled;
- return exact `exitCode`, `stdout`, and `stderr`;
- parse successful or error JSON output;
- read dictionaries and compute exact file bytes or hashes;
- recursively remove only the resolved unique fixture directory in cleanup.

Every test registers cleanup immediately after fixture creation. Cleanup checks
that the resolved directory is inside `os.tmpdir()` and has the suite prefix
before recursive removal.

The harness never invokes `ctv init`: it writes deterministic fixture inputs
directly so tests cover sync rather than init behavior.

## Scenarios

`test/e2e/label-sync.e2e.mjs` covers:

1. Identical fixtures produce identical ordered initial `actions` for
   `--dry-run --json` and `--write --json`; missing keys become empty strings,
   reported extras remain, and the enum is generated once.
2. Explicit source selection, repeated targets, configuration-order targets,
   include/exclude filters, and unchanged unselected dictionary bytes.
3. `--extra keep`, `report`, and `remove` produce the documented action
   reasons and selective writes.
4. Non-TTY mutation without `--write` and a non-string dictionary leaf exit 2
   before writes with stable JSON errors.
5. A leaf/object path conflict exits 1 and leaves every dictionary and the types
   file unchanged.
6. A snapshot modified between planning and execution is rejected, preserves
   the external content, and does not create the enum.
7. Auto-translate dry-run uses an unreachable endpoint plus configured batch
   limits, finishes without a network attempt, writes nothing, and reports
   deterministic `dry_run`, `limit`, and automatic skip outcomes.
8. A forced second-file transaction failure restores the already replaced first
   file.

Direct service imports in scenarios 6 and 8 come from freshly built `dist`.
All other scenarios execute the CLI as a child process.

## Assertions and Portability

Assertions check output structure and behavior, not incidental absolute temp
paths or timing narrower than a generous no-network threshold. Fixtures use
Node path and filesystem APIs and therefore run on Windows, macOS, and Linux.

Child process completion has a bounded timeout. On timeout, the harness kills
the process and fails with captured stdout/stderr. Engine fixtures bind no
server and use the loopback discard port only as a sentinel; dry-run must finish
without connecting.

## Verification

Run:

```shell
npm run test:e2e
npm run build
npm run lint
```

The E2E command must report all scenarios passing. Build must exit 0. Lint may
retain only the two pre-existing `doctor.service.ts` warnings and must contain
no errors or new warnings.
