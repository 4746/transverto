# Critical CLI Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the obsolete Mocha tests with deterministic `node:test` coverage for Transverto's critical CLI workflows.

**Architecture:** Build the TypeScript application first, then test the public CLI by spawning `bin/run.js` inside isolated temporary projects. Reuse small fixture and local-HTTP-server helpers across end-to-end suites, and directly import compiled modules only for parsing and transaction edge cases that are clearer at unit level.

**Tech Stack:** Node.js 24 `node:test`, `node:assert/strict`, native `child_process`, `fs`, `http`, oclif CLI, TypeScript production build.

## Global Constraints

- Cover only `init`, `status`, `doctor`, critical `label:*` workflows, `import:csv`, `export:csv`, and `translate`.
- Do not contact external network services; translation tests use a loopback HTTP server.
- Every end-to-end test owns a unique temporary project and must not mutate repository files.
- Verify observable contracts: exit code, JSON report, filesystem effects, preserved files, rollback, and idempotency where applicable.
- Do not snapshot decorative tables or complete help text.
- Retain the behavioural guarantees in the existing safe-sync test while reorganizing it.
- Apply production changes only when a new critical test exposes a real regression, and keep each such fix minimal.

---

## File Structure

- `test/helpers/project-fixture.mjs`: temporary project creation, safe cleanup, CLI spawning, JSON and byte helpers.
- `test/helpers/http-server.mjs`: deterministic loopback OpenAI-compatible server and request accounting.
- `test/e2e/init.test.mjs`: project bootstrap and overwrite safety.
- `test/e2e/project-health.test.mjs`: `status` and `doctor` success/failure contracts.
- `test/e2e/label-basic.test.mjs`: `label:add`, `label:get`, and `label:replace` user workflows.
- `test/e2e/label-mutations.test.mjs`: delete, rename, move, conflicts, dry-run, and atomic writes.
- `test/e2e/label-sync.test.mjs`: reorganized safe-sync regression coverage.
- `test/e2e/csv.test.mjs`: deterministic export and safe import round trips and failures.
- `test/e2e/translate.test.mjs`: local-provider success, placeholder conflict, cache, and provider failure.
- `test/unit/csv-parser.test.mjs`: quoted CSV and malformed-input rules.
- `test/unit/atomic-file.test.mjs`: duplicate targets, stale preconditions, and rollback.
- `src/commands/label/add.ts`: remove obsolete nested `label:sync` flags if the new add test confirms the current regression.
- `package.json`, `package-lock.json`: switch scripts and remove obsolete Mocha/ts-node test dependencies.
- Delete the old `test/commands/**/*.test.ts`, `test/init.ts`, and `test/tsconfig.json` only after replacement coverage exists.

---

### Task 1: Shared isolated test harness

**Files:**
- Create: `test/helpers/project-fixture.mjs`
- Create: `test/helpers/http-server.mjs`
- Test: `test/unit/project-fixture.test.mjs`

**Interfaces:**
- Produces: `createConfig(overrides)`, `createProject(testContext, options)`, `runCli(project, args, options)`, `parseJsonOutput(result)`, `readJson(file)`, `readBytes(file)`, `writeText(file, contents)`, and `pathExists(file)`.
- Produces: `startOpenAiServer(testContext, handler)` returning `{baseUrl, requests}`; the handler receives parsed request JSON and returns `{status, body}`.

- [ ] **Step 1: Write a failing helper contract test**

Create `test/unit/project-fixture.test.mjs` with a test that imports the not-yet-created helper, creates a project, asserts `.ctv.config.json`, `en.json`, and `uk.json` exist below `os.tmpdir()`, and registers cleanup through `testContext.after`.

```js
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import {test} from 'node:test'

import {createProject, pathExists, readJson} from '../helpers/project-fixture.mjs'

test('createProject isolates a complete fixture below the OS temp directory', async t => {
  const project = await createProject(t, {dictionaries: {en: {hello: 'Hello'}, uk: {}}})
  assert.equal(project.root.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`), true)
  assert.equal(pathExists(project.configFile), true)
  assert.deepEqual(await readJson(project.file('en')), {hello: 'Hello'})
  assert.deepEqual(await readJson(project.file('uk')), {})
})
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run: `node --test test/unit/project-fixture.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `test/helpers/project-fixture.mjs`.

- [ ] **Step 3: Implement the shared project fixture**

Move the useful behaviour from `test/e2e/helpers/project-fixture.mjs` into `test/helpers/project-fixture.mjs`. Keep the guarded cleanup, add `configFile`, and extend `runCli` with controlled stdin and environment overrides:

```js
export async function runCli(project, arguments_, {
  env = {},
  input = null,
  timeoutMs = 10_000,
} = {}) {
  // Spawn process.execPath with [cliFile, ...arguments_], cwd: project.root,
  // FORCE_COLOR=0, NO_COLOR=1, and the supplied env.
  // Use stdin='ignore' for null input and stdin='pipe' otherwise.
  // Collect stdout/stderr, kill on timeout, and resolve
  // {exitCode, signal, stderr, stdout}.
}
```

Use `transverto-critical-tests-` as the only accepted cleanup prefix. Resolve both the fixture and temp roots before comparing them, and throw before `fs.promises.rm` if either safety condition fails.

- [ ] **Step 4: Implement the local provider helper**

Create an HTTP server bound to `127.0.0.1` on an ephemeral port. Parse JSON request bodies, append them to `requests`, call the supplied handler, serialize its body, and register `server.close()` through `testContext.after`. Return `baseUrl` ending in `/v1` so it can be copied directly into a Transverto engine profile.

- [ ] **Step 5: Run the helper test**

Run: `node --test test/unit/project-fixture.test.mjs`

Expected: PASS, with the fixture cleanup completing without repository changes.

- [ ] **Step 6: Commit the harness**

```bash
git add test/helpers/project-fixture.mjs test/helpers/http-server.mjs test/unit/project-fixture.test.mjs
git commit -m "test: add isolated CLI test harness"
```

---

### Task 2: Project initialization and health

**Files:**
- Create: `test/e2e/init.test.mjs`
- Create: `test/e2e/project-health.test.mjs`

**Interfaces:**
- Consumes: fixture helpers from Task 1.
- Produces: behavioural coverage for `init`, `status`, and `doctor`.

- [ ] **Step 1: Write initialization tests**

Cover these exact cases in `test/e2e/init.test.mjs`:

1. Run `init --minimal --languages en,uk --source en`; assert exit `0`, config values `languages: ['en', 'uk']` and `langCodeDefault: 'en'`, and empty `en.json`/`uk.json` files.
2. Save config and language-file bytes, rerun without `--force`, assert exit `2` and byte-for-byte preservation.
3. Change both files, run the same command with `--force`, assert exit `0` and that config/language files are recreated.

Use an empty temporary directory rather than `createProject`, because `init` itself must create the project. Register its path with the same guarded cleanup helper.

- [ ] **Step 2: Run initialization tests**

Run: `npm run build && node --test test/e2e/init.test.mjs`

Expected: all three cases PASS; if current output differs, assert durable file state and exit codes rather than decorative wording.

- [ ] **Step 3: Write status and doctor tests**

Create fixtures with source `en` and target `uk`:

```js
const dictionaries = {
  en: {empty: 'Empty', greeting: 'Hello {name}', ready: 'Ready'},
  uk: {extra: 'Зайве', greeting: 'Привіт', ready: 'Ready'},
}
```

Assert `status --json` reports missing/extra/placeholder/same findings, exits `1` at the default threshold, and honors `--language uk --problem placeholder --fail-on never`. For `doctor --json`, assert a valid fixture has no error diagnostics and exit `0`; then corrupt `uk.json`, assert exit `1`, and assert the JSON diagnostic report contains an error code tied to the language file. Do not use `--check-engine`.

- [ ] **Step 4: Run project-health tests**

Run: `node --test test/e2e/project-health.test.mjs`

Expected: PASS with no network listener or external credentials.

- [ ] **Step 5: Commit project-health coverage**

```bash
git add test/e2e/init.test.mjs test/e2e/project-health.test.mjs
git commit -m "test: cover project initialization and health"
```

---

### Task 3: Basic label workflows

**Files:**
- Create: `test/e2e/label-basic.test.mjs`
- Modify if the regression is reproduced: `src/commands/label/add.ts`

**Interfaces:**
- Consumes: fixture helpers from Task 1.
- Produces: observable coverage for add, get, and replace.

- [ ] **Step 1: Write the add/get/replace regression test**

Use dictionaries `{en: {home: {title: 'Hello'}}, uk: {home: {title: 'Привіт'}}}` and assert:

```js
const add = await runCli(project, [
  'label:add', 'home.subtitle', '--fromLangCode', 'en',
  '--translation', 'Welcome', '--no-auto-translate', '--silent',
])
assert.equal(add.exitCode, 0)
assert.equal((await readJson(project.file('en'))).home.subtitle, 'Welcome')
assert.equal((await readJson(project.file('uk'))).home.subtitle, '')

const get = await runCli(project, ['label:get', 'home', '--mode', 'prefix', '--json'])
assert.equal(get.exitCode, 0)
assert.deepEqual(parseJsonOutput(get).results.map(item => item.key), [
  'home.subtitle', 'home.title',
])

const replace = await runCli(project, [
  'label:replace', 'home.title', '--langCode', 'uk', '--translation', 'Вітаю',
])
assert.equal(replace.exitCode, 0)
assert.equal((await readJson(project.file('uk'))).home.title, 'Вітаю')
```

Add a second case proving an invalid non-interactive key exits `2` and preserves both dictionaries.

- [ ] **Step 2: Run the basic-label test and capture the current regression**

Run: `npm run build && node --test test/e2e/label-basic.test.mjs`

Expected before the minimal fix: FAIL because `label:add` dispatches `label:sync` with obsolete `--silent`/`--noReport` flags after modifying the source dictionary.

- [ ] **Step 3: Apply the minimal nested-sync fix**

In `src/commands/label/add.ts`, replace the obsolete arguments with modern non-interactive sync flags:

```ts
const parameters = ['--write']
if (!this.noAutoTranslate) parameters.push('--auto-translate')
await this.config.runCommand('label:sync', parameters)
```

Do not refactor unrelated legacy prompting in this task. If the reproduced failure differs, preserve the test's public contract and make only the smallest production change needed for that contract.

- [ ] **Step 4: Rebuild and rerun the basic-label test**

Run: `npm run build && node --test test/e2e/label-basic.test.mjs`

Expected: PASS; `uk.home.subtitle` is created as an empty synchronized value and invalid input leaves all fixture bytes unchanged.

- [ ] **Step 5: Commit basic label coverage and the regression fix**

```bash
git add test/e2e/label-basic.test.mjs src/commands/label/add.ts
git commit -m "test: cover basic label workflows"
```

---

### Task 4: Atomic label mutations

**Files:**
- Create: `test/e2e/label-mutations.test.mjs`

**Interfaces:**
- Consumes: fixture helpers from Task 1.
- Produces: regression coverage for delete, rename, and move plans and writes.

- [ ] **Step 1: Write dry-run/write equivalence tests**

Create one preview fixture and one write fixture containing nested `account.profile`, `home.legacy`, and unrelated keys in `en` and `uk`. For each command below, compare the preview report's `changes`/`conflicts` to the write report, assert preview bytes are unchanged, and assert only selected write files change:

```text
label:rename account.profile.name account.profile.heading --dry-run/--write --json
label:move account.profile user.profile --dry-run/--write --json
label:delete home.legacy --dry-run/--write --json
```

- [ ] **Step 2: Add collision and non-interactive safety cases**

Assert rename into an occupied key without `--overwrite` exits `1`, reports conflicts, and writes nothing. Assert a mutation invoked with `--json` but without `--dry-run`, `--write`, or `--force` exits `2` and preserves every dictionary. Assert `--language uk` mutates only `uk.json`.

- [ ] **Step 3: Run mutation tests**

Run: `node --test test/e2e/label-mutations.test.mjs`

Expected: PASS with explicit assertions on report operations, keys, languages, written paths, and final dictionaries.

- [ ] **Step 4: Commit mutation coverage**

```bash
git add test/e2e/label-mutations.test.mjs
git commit -m "test: cover atomic label mutations"
```

---

### Task 5: Reorganize safe-sync coverage

**Files:**
- Modify: `test/e2e/label-sync.test.mjs`
- Delete after migration: `test/e2e/helpers/project-fixture.mjs`

**Interfaces:**
- Consumes: `test/helpers/project-fixture.mjs` from Task 1.
- Produces: retained safe-sync and file-transaction behavioural guarantees.

- [ ] **Step 1: Point safe-sync tests at the shared helper**

Change the import from `./helpers/project-fixture.mjs` to `../helpers/project-fixture.mjs`. Keep the existing seven scenarios: preview/write equivalence, target/filter/extra policies, non-TTY safety, structural conflict, stale snapshot, auto-translate dry-run, and rollback.

- [ ] **Step 2: Split the low-level transaction scenario out of e2e**

Move `file transaction restores an earlier mutation when a later write fails` into the atomic unit suite created in Task 8. Remove direct `applyFileTransaction` and `path` imports from `label-sync.test.mjs` after the move.

- [ ] **Step 3: Verify migrated sync coverage**

Run: `npm run build && node --test test/e2e/label-sync.test.mjs`

Expected: six CLI/snapshot tests PASS with the same action counts, exit codes, and byte-level safety guarantees as before.

- [ ] **Step 4: Remove the superseded helper and commit**

Delete `test/e2e/helpers/project-fixture.mjs` only after Step 3 passes.

```bash
git add test/e2e/label-sync.test.mjs test/helpers/project-fixture.mjs
git rm test/e2e/helpers/project-fixture.mjs
git commit -m "test: consolidate safe sync fixtures"
```

---

### Task 6: CSV export and import

**Files:**
- Create: `test/e2e/csv.test.mjs`

**Interfaces:**
- Consumes: fixture helpers from Task 1.
- Produces: deterministic export and atomic import coverage.

- [ ] **Step 1: Write deterministic export tests**

Export dictionaries containing commas, quotes, and embedded newlines with:

```js
const result = await runCli(project, [
  'export:csv', 'en', '--include', 'uk', '--outputFile', 'translations.csv', '--eol', 'lf',
])
```

Assert exit `0`; header `"label","en","en_new","uk","uk_new"`; labels sorted lexicographically; RFC-style doubled quotes; embedded newlines remain inside quoted fields; and a second run produces identical bytes. Add an invalid language case that exits `2` without creating the output.

- [ ] **Step 2: Write import preview/write tests**

Start from the exported file, populate `en_new` and `uk_new`, then run `import:csv translations.csv --use-new-columns --dry-run --json` and the corresponding `--write --json` in identical fixtures. Assert identical planned actions, no preview writes, expected final nested values, and a non-null post-write status report.

- [ ] **Step 3: Add malformed/conflict/atomicity tests**

Cover duplicate headers and an unterminated quote as exit `2` with unchanged dictionaries. Cover a changed existing value under the default `--existing conflict` as exit `1` with no writes. Create a blocked later target path to force executor failure and assert earlier dictionary bytes are restored.

- [ ] **Step 4: Run CSV tests**

Run: `node --test test/e2e/csv.test.mjs`

Expected: PASS; every failure case leaves both language dictionaries unchanged.

- [ ] **Step 5: Commit CSV coverage**

```bash
git add test/e2e/csv.test.mjs
git commit -m "test: cover safe CSV workflows"
```

---

### Task 7: Translation through a deterministic local provider

**Files:**
- Create: `test/e2e/translate.test.mjs`

**Interfaces:**
- Consumes: project and local-server helpers from Task 1.
- Produces: translation success, conflict, cache, write, and failure coverage without external networking.

- [ ] **Step 1: Write the local provider success test**

Start a loopback server whose handler returns an OpenAI-compatible chat completion:

```js
({body}) => ({
  body: {
    choices: [{message: {content: body.messages.at(-1).content.includes('{name}')
      ? 'Привіт {name}'
      : 'Привіт'}}],
  },
  status: 200,
})
```

Create config engine `fixture` with provider `openai-compatible`, the helper's `baseUrl`, model `fixture-model`, timeout `1000`, and no API-key environment requirement. Run `translate 'Hello {name}' --from en --to uk --engine fixture --json`; assert exit `0`, translated text, preserved placeholder, engine metadata, and exactly one local request.

- [ ] **Step 2: Add cache reuse**

Run the identical command twice with the same oclif cache location supplied through the spawned environment. Assert the second report marks the result cached and the server request count remains one.

- [ ] **Step 3: Add project write and placeholder conflict**

Run `translate --key home.title --from en --to uk --engine fixture --write --json`; assert `uk.json` receives the safe result and the report lists the written file. Configure the handler to omit `{name}` for a second fixture; assert exit `1`, one placeholder conflict, and unchanged target bytes.

- [ ] **Step 4: Add provider failure**

Return HTTP `500`, configure batch retry `0`, and assert exit `1`, `summary.failed === 1`, exactly one request, and no file mutation. The server binds only to `127.0.0.1`; no DNS name or external URL appears in the test.

- [ ] **Step 5: Run translation tests**

Run: `node --test test/e2e/translate.test.mjs`

Expected: PASS with local request counts `1`, `1 after cached rerun`, and `1` for the no-retry failure.

- [ ] **Step 6: Commit translation coverage**

```bash
git add test/e2e/translate.test.mjs
git commit -m "test: cover deterministic translation workflows"
```

---

### Task 8: Targeted parser and transaction unit tests

**Files:**
- Create: `test/unit/csv-parser.test.mjs`
- Create: `test/unit/atomic-file.test.mjs`

**Interfaces:**
- Consumes: `parseCsv(input, delimiter)` from `dist/shared/csv-parser.js`.
- Consumes: `applyFileTransaction(mutations, options)` from `dist/shared/atomic-file.js`.
- Produces: direct edge-case diagnostics for CSV grammar and atomic-write invariants.

- [ ] **Step 1: Write CSV parser unit tests**

Assert BOM stripping, custom delimiter support, escaped quotes, CRLF, embedded newlines, and a trailing empty record. Assert explicit errors for empty files, invalid delimiters, empty/duplicate headers, unexpected/unterminated quotes, and row-width mismatches. Use exact inputs and expected records, for example:

```js
assert.deepEqual(parseCsv('\uFEFFlabel,text\r\na,"line 1\nline 2"\r\n'), {
  headers: ['label', 'text'],
  rows: [{label: 'a', text: 'line 1\nline 2'}],
})
assert.throws(() => parseCsv('a,a\n1,2'), /duplicate headers: a/)
```

- [ ] **Step 2: Write atomic-file unit tests**

Cover successful create/update/delete; duplicate mutation targets rejected before writes; stale preconditions rejected before writes; missing mutation content; and rollback of an earlier mutation when a later path is blocked by a file. Use `testContext.after` with guarded fixture cleanup and compare rollback bytes exactly.

- [ ] **Step 3: Run focused unit tests**

Run: `npm run build && node --test test/unit/csv-parser.test.mjs test/unit/atomic-file.test.mjs test/unit/project-fixture.test.mjs`

Expected: PASS with no repository-file mutations.

- [ ] **Step 4: Commit focused unit coverage**

```bash
git add test/unit/csv-parser.test.mjs test/unit/atomic-file.test.mjs
git commit -m "test: cover parser and transaction invariants"
```

---

### Task 9: Remove legacy tests and make the new suite authoritative

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Delete: `test/init.ts`
- Delete: `test/tsconfig.json`
- Delete: `test/commands/cache.test.ts`
- Delete: `test/commands/init.test.ts`
- Delete: `test/commands/export/csv.test.ts`
- Delete: `test/commands/label/add.test.ts`
- Delete: `test/commands/label/delete.test.ts`
- Delete: `test/commands/label/get.test.ts`
- Delete: `test/commands/label/replace.test.ts`
- Delete: `test/commands/label/sync.test.ts`
- Delete: `test/commands/translate/bing.test.ts`
- Delete: `test/commands/translate/google.test.ts`

**Interfaces:**
- Consumes: all new suites from Tasks 1–8.
- Produces: `npm test` as the single authoritative test command.

- [ ] **Step 1: Run the new suite before deleting legacy coverage**

Run: `npm run build && node --test "test/**/*.test.mjs"`

Expected: all new tests PASS. Stop and fix failures within the owning task before deleting anything.

- [ ] **Step 2: Switch scripts and dependency declarations**

Set scripts to:

```json
{
  "lint": "eslint ./src ./test",
  "test": "npm run build && node --test \"test/**/*.test.mjs\"",
  "test:e2e": "npm run build && node --test \"test/e2e/**/*.test.mjs\""
}
```

Remove `@oclif/test`, `@types/mocha`, `mocha`, and `ts-node` from `devDependencies`. Remove the obsolete `ts-node` block from `tsconfig.json` only after `rg -n "ts-node" . -g "!node_modules/**" -g "!docs/superpowers/**"` confirms no remaining runtime or development usage.

- [ ] **Step 3: Regenerate the lockfile without running package lifecycle scripts**

Run: `npm install --package-lock-only --ignore-scripts`

Expected: exit `0`; root dependency entries and now-unreachable packages are removed from `package-lock.json`.

- [ ] **Step 4: Delete the obsolete test files**

Delete exactly the legacy files listed in this task. Verify `rg --files test` lists only `test/e2e/*.test.mjs`, `test/unit/*.test.mjs`, and `test/helpers/*.mjs`.

- [ ] **Step 5: Run the authoritative test command**

Run: `npm test`

Expected: exit `0`, zero failed tests, zero cancelled tests, and zero skipped critical scenarios.

- [ ] **Step 6: Run lint and build independently**

Run: `npm run lint`

Expected: exit `0` with no ESLint errors.

Run: `npm run build`

Expected: exit `0` with a newly generated `dist/`.

- [ ] **Step 7: Check repository cleanliness and dependency removal**

Run: `git diff --check`

Expected: exit `0`.

Run: `rg -n '"(@oclif/test|@types/mocha|mocha|ts-node)"' package.json package-lock.json`

Expected: no matches. If a transitive dependency still legitimately includes one of these packages, verify it is not a root dependency and document the remaining owner rather than editing the lockfile manually.

- [ ] **Step 8: Commit the migration**

```bash
git add package.json package-lock.json tsconfig.json test
git commit -m "test: replace legacy suite with node test"
```

---

## Final Verification Checklist

- [ ] Re-read `docs/superpowers/specs/2026-08-03-critical-cli-tests-design.md` and map every completion criterion to a passing test or command above.
- [ ] Run `npm test` fresh and record the test/pass/fail counts.
- [ ] Run `npm run lint` fresh and record exit `0`.
- [ ] Run `npm run build` fresh and record exit `0`.
- [ ] Run `git diff --check` fresh and record exit `0`.
- [ ] Run `git status --short` and confirm only intended implementation changes remain.
