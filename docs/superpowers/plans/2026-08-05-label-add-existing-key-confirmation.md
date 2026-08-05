# `label:add` Existing-Key Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a default-`No` confirmation before `label:add` updates an exact key that already exists in any configured dictionary, and fail safely when that confirmation is required non-interactively.

**Architecture:** Add a pure snapshot inspection operation beside `LabelAddPlanner`, plus a small prompt-policy module with an injectable confirmation function. `LabelAdd` will load one snapshot before asking for source text, reject structural conflicts, run the overwrite gate, and then reuse that snapshot in the unchanged planner/translation/atomic-executor pipeline.

**Tech Stack:** TypeScript 6, Node.js 24, oclif 4, `@inquirer/prompts`, Node test runner, ESLint.

## Global Constraints

- The confirmation prompt is `Key "<key>" already exists. Overwrite it?` with `default: false`.
- An exact string leaf in any configured language requires confirmation.
- Structural path conflicts remain errors and cannot be confirmed.
- Interactive rejection exits successfully without printing `Done!` and without asking for source text.
- `--silent` or non-TTY existing-key use exits with code 2 before provider, cache, or project writes.
- No `--force`, `--overwrite`, JSON, or dry-run flag is added.
- `fromLangCode`, `langCodeDefault`, translation, preservation, generated-types, cache, and transaction semantics remain unchanged.
- Preserve the user's unrelated `package.json` worktree change; never stage it in these commits.

---

### Task 1: Exact-key snapshot inspection

**Files:**
- Modify: `src/shared/label-add-planner.ts`
- Modify: `test/unit/label-add-planner.test.mjs`

**Interfaces:**
- Consumes: `ILabelAddProjectSnapshot`, `ILabelAddConflict`, and `inspectSyncPath(dictionary, key)`.
- Produces: `inspectLabelAddKey(snapshot: ILabelAddProjectSnapshot, key: string): ILabelAddKeyInspection`, where `ILabelAddKeyInspection` has readonly `conflicts` and `existing` language arrays.

- [ ] **Step 1: Write failing unit tests for exact leaves, missing keys, and path conflicts**

Append tests that establish detection across all configured languages and keep leaf existence separate from structural conflicts:

```js
import {
  inspectLabelAddKey,
  LabelAddPlanner,
} from '../../dist/shared/label-add-planner.js'

test('inspects an exact key across every configured language', () => {
  const inspection = inspectLabelAddKey(snapshotFor({
    de: {title: {data: 'Daten'}},
    en: {},
    uk: {title: {data: 'Дані'}},
  }), 'title.data')

  assert.deepEqual(inspection.existing, ['uk', 'de'])
  assert.deepEqual(inspection.conflicts, [])
})

test('does not report siblings as an existing exact key', () => {
  const inspection = inspectLabelAddKey(snapshotFor({
    de: {},
    en: {title: {other: 'Other'}},
    uk: {},
  }), 'title.data')

  assert.deepEqual(inspection.existing, [])
  assert.deepEqual(inspection.conflicts, [])
})

test('reports incompatible paths separately from existing leaves', () => {
  const inspection = inspectLabelAddKey(snapshotFor({
    de: {title: {data: {nested: 'value'}}},
    en: {title: 'Title'},
    uk: {title: {data: 'Дані'}},
  }), 'title.data')

  assert.deepEqual(inspection.existing, ['uk'])
  assert.deepEqual(inspection.conflicts, [
    {key: 'title.data', language: 'en', reason: 'path_conflict'},
    {key: 'title.data', language: 'de', reason: 'path_conflict'},
  ])
})
```

- [ ] **Step 2: Build and run the focused test to verify it fails**

Run:

```powershell
npm run build
node --test test/unit/label-add-planner.test.mjs
```

Expected: build or test failure because `inspectLabelAddKey` is not exported.

- [ ] **Step 3: Implement the immutable inspection result**

Add the interface and export in `src/shared/label-add-planner.ts`:

```ts
export interface ILabelAddKeyInspection {
  readonly conflicts: readonly ILabelAddConflict[]
  readonly existing: readonly string[]
}

export const inspectLabelAddKey = (
  snapshot: ILabelAddProjectSnapshot,
  key: string,
): ILabelAddKeyInspection => {
  const conflicts: ILabelAddConflict[] = []
  const existing: string[] = []

  for (const dictionary of snapshot.dictionaries) {
    const state = inspectSyncPath(dictionary.dictionary, key)
    if (state.kind === 'leaf') existing.push(dictionary.code)
    else if (state.kind !== 'missing') {
      conflicts.push({key, language: dictionary.code, reason: 'path_conflict'})
    }
  }

  return Object.freeze({
    conflicts: Object.freeze(conflicts),
    existing: Object.freeze(existing),
  })
}
```

Update the existing imports so `ILabelAddConflict` is imported from `./entities/label-add.js`. Do not change `LabelAddPlanner.create` behavior: source values are still assigned, existing non-source leaves are still preserved, and missing targets are still translated or filled.

- [ ] **Step 4: Run the focused unit tests**

Run:

```powershell
npm run build
node --test test/unit/label-add-planner.test.mjs
```

Expected: all planner tests pass.

- [ ] **Step 5: Commit the inspection unit**

```powershell
git add src/shared/label-add-planner.ts test/unit/label-add-planner.test.mjs
git commit -m "feat: inspect existing label add keys"
```

---

### Task 2: Overwrite confirmation policy

**Files:**
- Create: `src/shared/label-add-overwrite.prompt.ts`
- Create: `test/unit/label-add-overwrite.prompt.test.mjs`

**Interfaces:**
- Consumes: `confirm` from `@inquirer/prompts` through a default adapter.
- Produces: `confirmLabelAddOverwrite(options: ILabelAddOverwritePromptOptions, ask?: TLabelAddOverwritePrompt): Promise<boolean>`.
- `ILabelAddOverwritePromptOptions` contains `interactive: boolean`, `key: string`, and optional `output: NodeJS.WritableStream`.
- `TLabelAddOverwritePrompt` receives `{default: false, message: string}` and a prompt context, allowing tests to verify exact prompt configuration without a real terminal.

- [ ] **Step 1: Write failing policy tests**

Create `test/unit/label-add-overwrite.prompt.test.mjs`:

```js
import assert from 'node:assert/strict'
import {test} from 'node:test'

import {confirmLabelAddOverwrite} from '../../dist/shared/label-add-overwrite.prompt.js'

test('configures an interactive overwrite prompt with No as the default', async () => {
  let received
  const answer = await confirmLabelAddOverwrite(
    {interactive: true, key: 'title.data'},
    async (config, context) => {
      received = {config, context}
      return false
    },
  )

  assert.equal(answer, false)
  assert.deepEqual(received.config, {
    default: false,
    message: 'Key "title.data" already exists. Overwrite it?',
  })
  assert.equal(received.context.output, process.stdout)
})

test('returns an accepted interactive overwrite', async () => {
  const answer = await confirmLabelAddOverwrite(
    {interactive: true, key: 'title.data'},
    async () => true,
  )

  assert.equal(answer, true)
})

test('rejects a required overwrite confirmation non-interactively', async () => {
  let asked = false
  await assert.rejects(
    confirmLabelAddOverwrite(
      {interactive: false, key: 'title.data'},
      async () => {
        asked = true
        return true
      },
    ),
    /Translation key "title\.data" already exists; overwriting it requires interactive confirmation/,
  )
  assert.equal(asked, false)
})
```

- [ ] **Step 2: Build and run the focused test to verify it fails**

Run:

```powershell
npm run build
node --test test/unit/label-add-overwrite.prompt.test.mjs
```

Expected: build or module-resolution failure because the prompt module does not exist.

- [ ] **Step 3: Implement the prompt adapter and non-interactive guard**

Create `src/shared/label-add-overwrite.prompt.ts`:

```ts
import {confirm} from '@inquirer/prompts'

export interface ILabelAddOverwritePromptOptions {
  interactive: boolean
  key: string
  output?: NodeJS.WritableStream
}

export type TLabelAddOverwritePrompt = typeof confirm

export const confirmLabelAddOverwrite = async (
  options: ILabelAddOverwritePromptOptions,
  ask: TLabelAddOverwritePrompt = confirm,
): Promise<boolean> => {
  if (!options.interactive) {
    throw new Error(
      `Translation key "${options.key}" already exists; overwriting it requires interactive confirmation.`,
    )
  }

  return ask(
    {
      default: false,
      message: `Key "${options.key}" already exists. Overwrite it?`,
    },
    {output: options.output ?? process.stdout},
  )
}
```

If the exact `typeof confirm` context type rejects `NodeJS.WritableStream`, use `NodeJS.WriteStream` for `output`; do not weaken it to `any`.

- [ ] **Step 4: Run the focused unit tests**

Run:

```powershell
npm run build
node --test test/unit/label-add-overwrite.prompt.test.mjs
```

Expected: all three prompt-policy tests pass.

- [ ] **Step 5: Commit the prompt policy**

```powershell
git add src/shared/label-add-overwrite.prompt.ts test/unit/label-add-overwrite.prompt.test.mjs
git commit -m "feat: guard label add overwrites"
```

---

### Task 3: Integrate the gate before source-text and translation work

**Files:**
- Modify: `src/commands/label/add.ts`
- Modify: `test/e2e/label-mutations.test.mjs`

**Interfaces:**
- Consumes: `inspectLabelAddKey(snapshot, key)` from Task 1 and `confirmLabelAddOverwrite({interactive, key, output})` from Task 2.
- Produces: `label:add` orchestration that loads one snapshot, checks conflicts and existing leaves, then either cancels/fails or continues through the existing planner and executor.

- [ ] **Step 1: Add a failing non-interactive end-to-end test**

Append to `test/e2e/label-mutations.test.mjs`:

```js
test('label:add rejects an existing key non-interactively without side effects', async testContext => {
  const project = await createProject(testContext, {dictionaries: dictionaries()})
  await writeText(project.typesFile, 'original types\n')
  const before = await Promise.all(['en', 'uk'].map(language => readBytes(project.file(language))))
  const typesBefore = await readBytes(project.typesFile)

  const result = await runCli(project, [
    'label:add', 'home.keep', '--fromLangCode', 'uk',
    '--translation', 'Нове значення', '--noAutoTranslate', '--silent',
  ])

  assert.equal(result.exitCode, 2)
  assert.match(result.stderr, /Translation key "home\.keep" already exists/)
  assert.deepEqual(await readBytes(project.file('en')), before[0])
  assert.deepEqual(await readBytes(project.file('uk')), before[1])
  assert.deepEqual(await readBytes(project.typesFile), typesBefore)
})

test('label:add detects an existing key outside fromLangCode', async testContext => {
  const project = await createProject(testContext, {
    dictionaries: {de: {}, en: {title: {data: 'Data'}}, uk: {}},
  })
  const before = await Promise.all(['en', 'uk', 'de'].map(language => readBytes(project.file(language))))

  const result = await runCli(project, [
    'label:add', 'title.data', '--fromLangCode', 'uk',
    '--translation', 'Дані', '--noAutoTranslate', '--silent',
  ])

  assert.equal(result.exitCode, 2)
  assert.match(result.stderr, /Translation key "title\.data" already exists/)
  for (const [index, language] of ['en', 'uk', 'de'].entries()) {
    assert.deepEqual(await readBytes(project.file(language)), before[index])
  }
})
```

- [ ] **Step 2: Run the focused end-to-end tests to verify they fail**

Run:

```powershell
npm run build
node --test test/e2e/label-mutations.test.mjs
```

Expected: the new tests fail because the command currently overwrites the source or treats the target leaf as preserved.

- [ ] **Step 3: Move snapshot loading and add the confirmation gate**

In `src/commands/label/add.ts`:

1. Import `inspectLabelAddKey` and `confirmLabelAddOverwrite`.
2. Resolve label and source language as today.
3. Load `snapshot` before calling `getTranslation`.
4. Run `inspectLabelAddKey(snapshot, this.label)`.
5. Format and throw structural conflicts before any overwrite prompt.
6. When `inspection.existing.length > 0`, call:

```ts
const accepted = await confirmLabelAddOverwrite({
  interactive: !this.silent && Boolean(process.stdin.isTTY && process.stdout.isTTY),
  key: this.label,
  output: process.stdout,
})
if (!accepted) return
```

7. Only after acceptance call `getTranslation(flags.translation, this.fromLangCode)` and log it when not silent.
8. Create the unchanged `LabelAddPlanner` plan from the already loaded `snapshot`; do not reload files.

Keep snapshot loading, key inspection, confirmation, source-text resolution, and plan creation inside the existing exit-code-2 error boundary. Extract the repeated structural-conflict formatting into a private method only if that prevents duplicate code; do not refactor unrelated command behavior.

- [ ] **Step 4: Run label-add unit and end-to-end coverage**

Run:

```powershell
npm run build
node --test test/unit/label-add-planner.test.mjs test/unit/label-add-overwrite.prompt.test.mjs test/unit/label-add-executor.test.mjs test/e2e/label-basic.test.mjs test/e2e/label-mutations.test.mjs
```

Expected: all tests pass. Existing default-source and non-default-source additions remain green, proving the gate did not change current language planning for new keys.

- [ ] **Step 5: Commit the command integration**

```powershell
git add src/commands/label/add.ts test/e2e/label-mutations.test.mjs
git commit -m "feat: confirm existing keys in label add"
```

---

### Task 4: Full regression verification

**Files:**
- Modify only if verification exposes a defect in the files from Tasks 1–3.
- Verify: repository-wide build, tests, and lint.

**Interfaces:**
- Consumes: all implementation and tests from Tasks 1–3.
- Produces: evidence that the feature passes the complete repository quality gates without staging unrelated changes.

- [ ] **Step 1: Run the full test suite**

Run:

```powershell
npm test
```

Expected: build, all Node tests, and post-test lint pass with exit code 0.

- [ ] **Step 2: Inspect the final diff and worktree boundaries**

Run:

```powershell
git status --short
git diff --check
git diff HEAD~3 -- src/commands/label/add.ts src/shared/label-add-planner.ts src/shared/label-add-overwrite.prompt.ts test/unit/label-add-planner.test.mjs test/unit/label-add-overwrite.prompt.test.mjs test/e2e/label-mutations.test.mjs
```

Expected: no whitespace errors; only the planned feature files appear in the three implementation commits; the pre-existing `package.json` modification remains unstaged and uncommitted.

- [ ] **Step 3: Commit only verification-driven fixes, if any**

If Step 1 required a correction, rerun the focused failing test and `npm test`, then stage only the corrected feature files and commit:

```powershell
git add src/commands/label/add.ts src/shared/label-add-planner.ts src/shared/label-add-overwrite.prompt.ts test/unit/label-add-planner.test.mjs test/unit/label-add-overwrite.prompt.test.mjs test/e2e/label-mutations.test.mjs
git commit -m "fix: complete label add overwrite guard"
```

If no correction was needed, do not create an empty commit.
