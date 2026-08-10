# JetBrains Preset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive `ctv preset` command that atomically installs a selected set of packaged JetBrains run configurations and makes `label:rename OLD` prompt for the new key in the terminal.

**Architecture:** Ship canonical XML files under `presets/jetbrains`, describe them through a typed catalog, and use a two-stage project service to inspect conflicts before atomically applying package.json and `.run` mutations. Keep prompts in thin oclif commands; reuse the existing atomic transaction utility for preconditions and rollback.

**Tech Stack:** TypeScript 6, Node.js 24, oclif 4, `@inquirer/prompts` 8, Node test runner, npm package allowlist.

## Global Constraints

- Version 1 has one provider ID, `jetbrains`, and exactly seven command IDs: `add`, `delete`, `doctor`, `get`, `rename`, `status`, and `suggest`.
- Every command is selected by default; an empty checkbox selection is invalid.
- Existing selected XML targets use one shared overwrite confirmation with default `Yes`.
- Answering `No` preserves all conflicting XML files but still creates selected non-conflicting files.
- Add `"ctv": "ctv"` only when `scripts.ctv` is absent; preserve the exact value `"ctv"`; reject every different value without writing.
- Treat package.json and XML changes as one atomic transaction with stale-file preconditions and rollback.
- Static XML assets must ship in the published npm package; do not generate XML at runtime.
- The rename asset passes only `$SelectedText$`; `label:rename` requests the new key in an interactive terminal.
- Keep `label:rename OLD NEW` unchanged and reject a missing new key outside a TTY.
- Add no runtime dependency.
- Preserve the user's pre-existing `package.json` version bump. Stage only the feature's `/presets` allowlist hunk when committing package.json.

---

## File Structure

- Create `presets/jetbrains/*.run.xml`: seven canonical JetBrains npm run configurations.
- Create `src/shared/entities/preset.ts`: provider, command, inspection, plan, and report contracts.
- Create `src/shared/preset-catalog.ts`: immutable provider/command catalog and packaged asset path resolution.
- Create `src/shared/preset-project.service.ts`: project inspection, package.json serialization, plan construction, and atomic installation.
- Create `src/shared/label-rename-target.prompt.ts`: optional rename target resolution through Inquirer.
- Create `src/commands/preset.ts`: interactive provider/command/overwrite flow and summary rendering.
- Modify `src/commands/label/rename.ts`: accept an omitted target and call the prompt helper.
- Modify `package.json`: include `/presets` in the published files allowlist.
- Create `test/unit/preset-catalog.test.mjs` and `test/unit/preset-project.service.test.mjs`.
- Create `test/unit/label-rename-target.prompt.test.mjs` and modify `test/e2e/label-mutations.test.mjs`.
- Create `test/e2e/preset.test.mjs`.
- Modify `README.md`: document the preset workflow and regenerate oclif command help.

---

### Task 1: Static Assets and Typed Catalog

**Files:**
- Create: `presets/jetbrains/tl_add.run.xml`
- Create: `presets/jetbrains/tl_delete.run.xml`
- Create: `presets/jetbrains/tl_doctor.run.xml`
- Create: `presets/jetbrains/tl_get.run.xml`
- Create: `presets/jetbrains/tl_rename.run.xml`
- Create: `presets/jetbrains/tl_status.run.xml`
- Create: `presets/jetbrains/tl_suggest.run.xml`
- Create: `src/shared/entities/preset.ts`
- Create: `src/shared/preset-catalog.ts`
- Modify: `package.json`
- Create: `test/unit/preset-catalog.test.mjs`

**Interfaces:**
- Produces `TPresetProviderId = 'jetbrains'` and the seven-value `TPresetCommandId` union.
- Produces `PRESET_PROVIDERS`, `getPresetProvider(id)`, `getPresetCommands(providerId)`, and `resolvePresetAssetPath(providerId, commandId)`.
- Later tasks consume catalog entries shaped as `{assetFile, id, name, targetFile}`.

- [ ] **Step 1: Write the failing catalog and asset test**

Create `test/unit/preset-catalog.test.mjs` with assertions equivalent to:

```js
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {test} from 'node:test'

import {
  getPresetCommands,
  getPresetProvider,
  PRESET_PROVIDERS,
  resolvePresetAssetPath,
} from '../../dist/shared/preset-catalog.js'

const expected = [
  ['add', 'tl:add', String.raw`-- label:add \&quot;$SelectedText$\&quot;`],
  ['delete', 'tl:delete', String.raw`-- label:delete \&quot;$SelectedText$\&quot;`],
  ['doctor', 'tl:doctor', '-- doctor'],
  ['get', 'tl:get', String.raw`-- label:get \&quot;$SelectedText$\&quot;`],
  ['rename', 'tl:rename', String.raw`-- label:rename \&quot;$SelectedText$\&quot;`],
  ['status', 'tl:status', '-- status'],
  ['suggest', 'tl:suggest', String.raw`-- label:suggest \&quot;$SelectedText$\&quot;`],
]

test('catalog exposes one JetBrains provider and seven unique commands', () => {
  assert.deepEqual(PRESET_PROVIDERS.map(({id, name}) => ({id, name})), [
    {id: 'jetbrains', name: 'JetBrains'},
  ])
  assert.equal(getPresetProvider('jetbrains').id, 'jetbrains')
  const commands = getPresetCommands('jetbrains')
  assert.deepEqual(commands.map(({id}) => id), expected.map(([id]) => id))
  assert.equal(new Set(commands.map(({assetFile}) => assetFile)).size, 7)
  assert.equal(new Set(commands.map(({targetFile}) => targetFile)).size, 7)
  assert.throws(() => getPresetProvider('unknown'), /Unknown preset provider/)
})

test('packaged JetBrains assets have exact names and npm arguments', async () => {
  for (const [id, configurationName, argumentsValue] of expected) {
    const file = resolvePresetAssetPath('jetbrains', id)
    assert.equal(path.basename(file), `tl_${id}.run.xml`)
    const xml = await fs.promises.readFile(file, 'utf8')
    assert.match(xml, new RegExp(`name="${configurationName}"`))
    assert.ok(xml.includes(`<arguments value="${argumentsValue}" />`), xml)
    assert.ok(xml.endsWith('\n'))
  }
})
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
npm run build
node --test test/unit/preset-catalog.test.mjs
```

Expected: FAIL because the catalog module and assets do not exist.

- [ ] **Step 3: Add preset types and catalog**

Create `src/shared/entities/preset.ts`:

```ts
export type TPresetProviderId = 'jetbrains'
export type TPresetCommandId = 'add' | 'delete' | 'doctor' | 'get' | 'rename' | 'status' | 'suggest'

export interface IPresetCommandDefinition {
  assetFile: string
  id: TPresetCommandId
  name: string
  targetFile: string
}

export interface IPresetProviderDefinition {
  commands: readonly IPresetCommandDefinition[]
  id: TPresetProviderId
  name: string
}
```

Create `src/shared/preset-catalog.ts` with one frozen provider, the seven definitions in the order from the test, and these exports:

```ts
const PRESETS_ROOT = fileURLToPath(new URL('../../presets/', import.meta.url))

export const PRESET_PROVIDERS: readonly IPresetProviderDefinition[] = Object.freeze([
  {
    commands: Object.freeze([
      {assetFile: 'tl_add.run.xml', id: 'add', name: 'add', targetFile: 'tl_add.run.xml'},
      {assetFile: 'tl_delete.run.xml', id: 'delete', name: 'delete', targetFile: 'tl_delete.run.xml'},
      {assetFile: 'tl_doctor.run.xml', id: 'doctor', name: 'doctor', targetFile: 'tl_doctor.run.xml'},
      {assetFile: 'tl_get.run.xml', id: 'get', name: 'get', targetFile: 'tl_get.run.xml'},
      {assetFile: 'tl_rename.run.xml', id: 'rename', name: 'rename', targetFile: 'tl_rename.run.xml'},
      {assetFile: 'tl_status.run.xml', id: 'status', name: 'status', targetFile: 'tl_status.run.xml'},
      {assetFile: 'tl_suggest.run.xml', id: 'suggest', name: 'suggest', targetFile: 'tl_suggest.run.xml'},
    ]),
    id: 'jetbrains',
    name: 'JetBrains',
  },
])
```

`getPresetProvider` throws `Unknown preset provider: ${id}.`; `getPresetCommands` returns its commands; `resolvePresetAssetPath` rejects an unknown command and joins `PRESETS_ROOT`, provider ID, and `assetFile`.

- [ ] **Step 4: Add the seven canonical XML assets**

Use the supplied files under `E:\gitlab.com\4746\qrwize\mobile\.run` as the canonical structure. Preserve every component/configuration/npm field, but normalize each `<arguments>` value to the exact third column in the test above. In particular, `tl_rename.run.xml` contains only the selected old key and no `$Prompt$` macro.

Each file must remain a standalone shared JetBrains npm run configuration with:

```xml
<package-json value="$PROJECT_DIR$/package.json" />
<command value="run" />
<scripts>
  <script value="ctv" />
</scripts>
<node-interpreter value="project" />
<envs />
<method v="2" />
```

- [ ] **Step 5: Publish assets and run focused verification**

Add `"/presets"` after `"/dist"` in `package.json#files`. Do not alter the existing version value. Then run:

```powershell
npm run build
node --test test/unit/preset-catalog.test.mjs
npm pack --dry-run --json
```

Expected: the test passes and the pack JSON lists all seven `presets/jetbrains/tl_*.run.xml` files.

- [ ] **Step 6: Commit catalog and assets without the version bump**

```powershell
git add presets src/shared/entities/preset.ts src/shared/preset-catalog.ts test/unit/preset-catalog.test.mjs
git add -p package.json
git diff --cached -- package.json
git commit -m "feat: package JetBrains preset assets"
```

At the interactive staging prompt, reject the version hunk and accept only the `/presets` files-allowlist hunk. The staged diff must not contain `"version"`.

---

### Task 2: Atomic Preset Project Service

**Files:**
- Modify: `src/shared/entities/preset.ts`
- Create: `src/shared/preset-project.service.ts`
- Create: `test/unit/preset-project.service.test.mjs`

**Interfaces:**
- Consumes catalog functions and `applyFileTransaction`.
- Produces `inspectPresetProject(input, dependencies?): Promise<IPresetInspection>` where input is `{commands, projectRoot, provider}` and the optional dependency object exposes `readFile` for deterministic missing-asset tests.
- Produces `installPreset(inspection, {overwrite}): Promise<IPresetInstallReport>`.
- `IPresetInstallReport` is `{created: string[]; overwritten: string[]; preserved: string[]; script: 'added' | 'preserved'}`.

- [ ] **Step 1: Write failing project-service tests**

Create temporary-project helpers inside `test/unit/preset-project.service.test.mjs` using `createTemporaryProject`, `readBytes`, `readJson`, and `writeText`. Cover these concrete cases:

```js
test('install creates selected XML and adds the ctv script', async testContext => {
  const project = await createTemporaryProject(testContext)
  await writeText(path.join(project.root, 'package.json'), '{\n  "name": "fixture"\n}\n')
  const inspection = await inspectPresetProject({
    commands: ['add', 'suggest'], projectRoot: project.root, provider: 'jetbrains',
  })
  assert.deepEqual(inspection.conflicts, [])
  assert.deepEqual(await installPreset(inspection, {overwrite: true}), {
    created: ['.run/tl_add.run.xml', '.run/tl_suggest.run.xml'],
    overwritten: [], preserved: [], script: 'added',
  })
  assert.equal((await readJson(path.join(project.root, 'package.json'))).scripts.ctv, 'ctv')
})
```

Add tests that assert:

- an existing `scripts.ctv: 'ctv'` returns `script: 'preserved'` and leaves package bytes unchanged;
- `scripts.ctv: 'different'`, malformed JSON, missing package.json, an array/null package root, or a non-object `scripts` rejects before `.run` exists;
- two existing selected XML files produce exactly two sorted `inspection.conflicts`;
- `{overwrite: true}` replaces both conflicts;
- `{overwrite: false}` preserves both conflicts and creates a third non-conflicting selection;
- minified JSON stays minified, tab-indented JSON keeps tabs, CRLF stays CRLF, and the original final-newline presence is retained;
- `.run` as a file and a target path as a directory reject without package changes;
- duplicate/empty command selections and unknown provider/command IDs reject without changes;
- an injected asset-read `ENOENT` becomes `Preset asset is missing: <path>` and produces no changes;
- changing package.json or a writable XML target after inspection makes installation reject with `File changed after sync planning` and writes nothing.

- [ ] **Step 2: Run the test and verify failure**

```powershell
npm run build
node --test test/unit/preset-project.service.test.mjs
```

Expected: FAIL because the service and its entity contracts do not exist.

- [ ] **Step 3: Add inspection and report contracts**

Extend `src/shared/entities/preset.ts` with:

```ts
export interface IPresetInspectionTarget {
  asset: Buffer
  command: TPresetCommandId
  original: Buffer | null
  relativeTarget: string
  target: string
}

export interface IPresetInspection {
  conflicts: readonly string[]
  packageFile: string
  packageOriginal: Buffer
  packageUpdated: Buffer | null
  projectRoot: string
  script: 'added' | 'preserved'
  targets: readonly IPresetInspectionTarget[]
}

export interface IPresetInstallReport {
  created: string[]
  overwritten: string[]
  preserved: string[]
  script: 'added' | 'preserved'
}
```

- [ ] **Step 4: Implement strict package serialization and inspection**

In `src/shared/preset-project.service.ts`, add focused private helpers:

```ts
const detectIndent = (text: string): number | string | undefined => {
  const match = text.match(/\r?\n([\t ]+)"/)
  return match?.[1] || undefined
}

const serializeLike = (value: unknown, original: string): string => {
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const finalEol = original.endsWith('\n') ? eol : ''
  return JSON.stringify(value, null, detectIndent(original)).replaceAll('\n', eol) + finalEol
}
```

Parse the root as a non-null, non-array object. Treat `scripts` the same way when present. Clone only the root and `scripts` objects before adding `ctv`, so source property order is preserved. If `ctv` already equals `ctv`, set `packageUpdated` to `null`; if it differs, throw `package.json script "ctv" already has a different value.`

For every selected catalog command, read its asset as `Buffer`, inspect `.run`, and record the target's current `Buffer | null`. Sort conflicts and report paths in catalog order. Reject duplicate or empty command input even if called outside the CLI. Accept an optional `{readFile}` dependency defaulting to `fs.promises.readFile`; wrap an `ENOENT` from an asset read as `Preset asset is missing: ${assetPath}.` without hiding other filesystem errors.

- [ ] **Step 5: Implement atomic installation**

Build mutations and matching preconditions from the inspection:

```ts
const mutations: IFileMutation[] = []
const preconditions: IFilePrecondition[] = []

if (inspection.packageUpdated) {
  mutations.push({content: inspection.packageUpdated, file: inspection.packageFile})
  preconditions.push({expected: inspection.packageOriginal, file: inspection.packageFile})
}

for (const target of inspection.targets) {
  if (target.original && !options.overwrite) continue
  mutations.push({content: target.asset, file: target.target})
  preconditions.push({expected: target.original, file: target.target})
}

await applyFileTransaction(mutations, {preconditions})
```

Return relative forward-slash paths in `created`, `overwritten`, and `preserved`. Never mutate the inspection object.

- [ ] **Step 6: Run focused and transaction tests**

```powershell
npm run build
node --test test/unit/preset-project.service.test.mjs test/unit/atomic-file.test.mjs
```

Expected: all project-service cases pass; existing rollback coverage remains green.

- [ ] **Step 7: Commit the service**

```powershell
git add src/shared/entities/preset.ts src/shared/preset-project.service.ts test/unit/preset-project.service.test.mjs
git commit -m "feat: install preset files atomically"
```

---

### Task 3: Interactive Rename Target Fallback

**Files:**
- Create: `src/shared/label-rename-target.prompt.ts`
- Modify: `src/commands/label/rename.ts`
- Create: `test/unit/label-rename-target.prompt.test.mjs`
- Modify: `test/e2e/label-mutations.test.mjs`

**Interfaces:**
- Produces `resolveLabelRenameTarget(input, ask?): Promise<string>` where `ask` defaults to Inquirer's `input` function.
- Input is `{interactive: boolean; newPath?: string; output: NodeJS.WritableStream}`.
- The rename command passes the resolved string into the existing `runLabelMutation` `newPath` field.

- [ ] **Step 1: Write failing prompt-helper tests**

Create `test/unit/label-rename-target.prompt.test.mjs`:

```js
import assert from 'node:assert/strict'
import {PassThrough} from 'node:stream'
import {test} from 'node:test'

import {resolveLabelRenameTarget} from '../../dist/shared/label-rename-target.prompt.js'

test('provided rename target is returned without a prompt', async () => {
  assert.equal(await resolveLabelRenameTarget({
    interactive: false, newPath: 'home.heading', output: new PassThrough(),
  }), 'home.heading')
})

test('missing non-interactive rename target is a usage error', async () => {
  await assert.rejects(resolveLabelRenameTarget({
    interactive: false, output: new PassThrough(),
  }), /Missing target key.*non-interactively/)
})

test('missing interactive rename target is requested in the terminal', async () => {
  const output = new PassThrough()
  let received
  const value = await resolveLabelRenameTarget({interactive: true, output}, async (...args) => {
    received = args
    return 'home.heading'
  })
  assert.equal(value, 'home.heading')
  assert.equal(received[0].message, 'New translation key:')
  assert.equal(received[0].validate(''), 'New translation key is required.')
  assert.equal(received[1].output, output)
})
```

- [ ] **Step 2: Run focused tests and verify failure**

```powershell
npm run build
node --test test/unit/label-rename-target.prompt.test.mjs
```

Expected: FAIL because the prompt helper does not exist.

- [ ] **Step 3: Implement the helper and adapt the command**

Create `src/shared/label-rename-target.prompt.ts`:

```ts
import {input} from '@inquirer/prompts'

export interface IResolveLabelRenameTargetInput {
  interactive: boolean
  newPath?: string
  output: NodeJS.WritableStream
}

export type TLabelRenameTargetPrompt = typeof input

export async function resolveLabelRenameTarget(
  options: IResolveLabelRenameTargetInput,
  ask: TLabelRenameTargetPrompt = input,
): Promise<string> {
  if (options.newPath) return options.newPath
  if (!options.interactive) {
    throw new Error('Missing target key. Pass NEW when running non-interactively.')
  }
  return ask({
    message: 'New translation key:',
    validate: value => value.trim().length > 0 || 'New translation key is required.',
  }, {output: options.output})
}
```

In `src/commands/label/rename.ts`, remove `required: true` from the `new` argument. Immediately after parsing, resolve it:

```ts
let newPath: string
try {
  newPath = await resolveLabelRenameTarget({
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    newPath: args.new,
    output: process.stdout,
  })
} catch (error) {
  this.error(error instanceof Error ? error.message : String(error), {exit: 2})
}
```

Pass `newPath` rather than `args.new` into `runLabelMutation`. Do not change mutation planning or confirmation behavior.

- [ ] **Step 4: Add command regression coverage**

In `test/e2e/label-mutations.test.mjs`, retain the existing two-argument rename success case and add a non-interactive missing-target case:

```js
const result = await runCli(project, ['label:rename', 'home.title'])
assert.equal(result.exitCode, 2)
assert.match(result.stderr, /Missing target key.*non-interactively/)
```

The helper's interactive branch is exercised later by the JetBrains preset manual smoke test because the existing child-process helper intentionally uses piped, non-TTY stdio.

- [ ] **Step 5: Build and run focused tests**

```powershell
npm run build
node --test test/unit/label-rename-target.prompt.test.mjs test/e2e/label-mutations.test.mjs
```

Expected: all tests pass; two-argument rename behavior is unchanged.

- [ ] **Step 6: Commit rename fallback**

```powershell
git add src/shared/label-rename-target.prompt.ts src/commands/label/rename.ts test/unit/label-rename-target.prompt.test.mjs test/e2e/label-mutations.test.mjs
git commit -m "feat: prompt for missing rename target"
```

---

### Task 4: Interactive Preset Command

**Files:**
- Create: `src/commands/preset.ts`
- Create: `test/e2e/preset.test.mjs`

**Interfaces:**
- Consumes the preset catalog and project service from Tasks 1–2.
- Produces public `ctv preset` with no flags or positional arguments.
- Produces `runPresetPrompts(projectRoot, dependencies?): Promise<IPresetInstallReport>`; its narrow dependency interface contains `selectProvider`, `selectCommands`, `confirmOverwrite`, `inspect`, and `install`, with real adapters as defaults.

- [ ] **Step 1: Write failing command-level tests**

Create `test/e2e/preset.test.mjs`. Use temporary projects and invoke the built command. Cover help independently:

```js
test('preset help advertises the interactive installer', async testContext => {
  const project = await createTemporaryProject(testContext)
  const result = await runCli(project, ['preset', '--help'])
  assert.equal(result.exitCode, 0)
  assert.match(result.stdout, /Install IDE run configuration presets/)
})
```

For prompt behavior, test the extracted orchestration through exported `runPresetPrompts` with injected async functions instead of attempting to emulate a TTY. Assert that:

- provider choices contain only `{name: 'JetBrains', value: 'jetbrains'}`;
- all seven checkbox choices have `checked: true` and `required: true`;
- no confirm is called when `inspection.conflicts` is empty;
- one confirm receives default `true` and the total conflict count when conflicts exist;
- its boolean answer is forwarded as `overwrite` to `installPreset`;
- the renderer prints exact counts and `npm script: added|preserved`.

- [ ] **Step 2: Build and verify command-not-found failure**

```powershell
npm run build
node --test test/e2e/preset.test.mjs
```

Expected: FAIL because `ctv preset` and `runPresetPrompts` do not exist.

- [ ] **Step 3: Implement the thin oclif command**

Create `src/commands/preset.ts` using `Command`, `checkbox`, `confirm`, and `select`. Define:

```ts
static description = 'Install IDE run configuration presets'
static examples = ['<%= config.bin %> <%= command.id %>']
```

Export a `runPresetPrompts` helper whose narrow dependency object defaults to real adapters around prompt/catalog/service functions but can be replaced by tests. This avoids exposing Inquirer's generic function types to callers. Its main flow is:

```ts
const provider = await select({
  choices: PRESET_PROVIDERS.map(({id: value, name}) => ({name, value})),
  message: 'Preset:',
})
const commands = await checkbox({
  choices: getPresetCommands(provider).map(({id: value, name}) => ({checked: true, name, value})),
  message: 'Commands:',
  required: true,
})
const inspection = await inspectPresetProject({commands, projectRoot, provider})
const overwrite = inspection.conflicts.length === 0 || await confirm({
  default: true,
  message: `Overwrite ${inspection.conflicts.length} existing JetBrains run configurations?`,
})
return installPreset(inspection, {overwrite})
```

`run()` calls the helper with `process.cwd()`, converts validation/filesystem errors to exit code `2`, and renders:

```text
JetBrains preset installed.
Created: N
Overwritten: N
Preserved: N
npm script: added
```

Use the actual provider display name rather than hard-coding it in the first line. Prompt cancellation must bubble through standard Inquirer/Oclif handling without reaching installation.

- [ ] **Step 4: Run command and service tests**

```powershell
npm run build
node --test test/e2e/preset.test.mjs test/unit/preset-project.service.test.mjs test/unit/preset-catalog.test.mjs
node bin/run.js preset --help
```

Expected: focused tests pass and help shows the new command description and example.

- [ ] **Step 5: Commit the public command**

```powershell
git add src/commands/preset.ts test/e2e/preset.test.mjs
git commit -m "feat: add interactive preset command"
```

---

### Task 5: Documentation and Release Verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Documents `ctv preset`, the JetBrains workflow, conflict behavior, and interactive rename.
- Regenerates the oclif command reference for the public command.

- [ ] **Step 1: Add the hand-written JetBrains workflow**

Add a concise section before the generated command reference:

```markdown
## JetBrains run configurations

Run `ctv preset`, choose **JetBrains**, and keep or adjust the preselected command list. Transverto creates shared `.run/tl_*.run.xml` configurations and adds `"ctv": "ctv"` to the project npm scripts when needed.

In a JetBrains IDE, select a translation key or source phrase, press Shift twice, choose a configuration such as `tl:get` or `tl:suggest`, and run it with Shift+Enter. `tl:rename` uses the selected text as the old key and asks for the new key in the terminal.

When selected run-configuration files already exist, one confirmation controls all overwrites. Answering No preserves those files and still installs non-conflicting selections. An existing nonstandard `scripts.ctv` value is never replaced.
```

- [ ] **Step 2: Regenerate and inspect oclif documentation**

```powershell
npm exec -- oclif readme
rg -n "ctv preset|Install IDE run configuration presets|JetBrains run configurations" README.md
```

Expected: the hand-written workflow remains present and the generated Commands section contains `ctv preset`.

- [ ] **Step 3: Run the complete verification suite**

```powershell
npm test
npm run build
npm run lint
node bin/run.js preset --help
npm pack --dry-run --json
git diff --check
git status --short
```

Expected: test, build, lint, and whitespace checks pass; help advertises `ctv preset`; pack output contains all seven XML assets; git status shows intended feature files/commits and the user's unstaged version bump only.

- [ ] **Step 4: Perform the JetBrains smoke test**

In a disposable npm consumer project with Transverto linked or installed:

1. Run `ctv preset`, press Enter for JetBrains, and press Enter for all seven checked commands.
2. Open the project in WebStorm, select an existing key, run `tl:get`, and verify its translations appear.
3. Select the same key, run `tl:rename`, enter a new key in the terminal prompt, confirm the mutation, and verify all configured dictionaries use the new key.
4. Run `ctv preset` again, answer `No` to the shared overwrite prompt, and verify all seven existing XML files retain their bytes.

- [ ] **Step 5: Commit documentation**

```powershell
git add README.md
git commit -m "docs: explain JetBrains preset workflow"
```

Do not stage the pre-existing package version hunk.
