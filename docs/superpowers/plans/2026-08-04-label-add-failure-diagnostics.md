# Label Add Failure Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ctv label:add` print every preserved translation-engine failure when an automatic-translation batch fails.

**Architecture:** Keep failure collection in `TranslationBatchService` and completeness validation in `LabelAddExecutor` unchanged. Add a command-local formatter in `LabelAdd` and select it in the existing catch block whenever `batch.failed` contains entries, preserving the current fallback rendering for every other error type.

**Tech Stack:** TypeScript 6, Node.js 24 built-in test runner, oclif CLI, existing E2E HTTP/project fixtures.

## Global Constraints

- Print one stderr line for every `ITranslationFailed`.
- Each failure line includes target language, category, attempts, and original engine/provider message.
- Use `attempt` for exactly one attempt and `attempts` for every other count.
- Preserve batch order in production output, but do not require concurrent failures to appear in a fixed order in tests.
- Continue showing the existing caught error when `batch.failed` is empty.
- Keep exit code `1`, `--silent` error visibility, atomic rollback, and deferred-cache behavior unchanged.
- Do not change `TranslationError`, `ITranslationFailed`, engine handling, retry/fallback behavior, `TranslationBatchService`, or `LabelAddExecutor`.
- Do not add dependencies or unrelated refactors.
- Preserve the user's unrelated `package.json` working-tree change and exclude it from every commit.

---

## File structure

- Modify `test/e2e/label-mutations.test.mjs`: reproduce multiple provider failures and verify complete stderr diagnostics plus rollback.
- Modify `src/commands/label/add.ts`: format preserved failures at the CLI presentation boundary.

### Task 1: Render every label-add translation failure

**Files:**
- Modify: `test/e2e/label-mutations.test.mjs`
- Modify: `src/commands/label/add.ts`

**Interfaces:**
- Consumes: `ITranslationBatchOutput.failed: ITranslationFailed[]`, where every item already contains `attempts`, `category`, `message`, and `request.to`.
- Produces: private `translationFailureMessage(failures: ITranslationFailed[]): string` on `LabelAdd`; no public or domain interface changes.

- [ ] **Step 1: Add a failing E2E test for multiple engine failures**

Add this test after the existing per-language rollback test in `test/e2e/label-mutations.test.mjs`:

```javascript
test('label:add reports every translation engine failure', async testContext => {
  const server = await startOpenAiServer(testContext, request => {
    const prompt = request.body.messages.at(-1).content
    const target = prompt.includes('Target language: en') ? 'en' : 'de'
    return {body: {error: {message: `${target} provider down`}}, status: 500}
  })
  const project = await createProject(testContext, {
    config: createConfig({
      batch: {mode: 'per-language', retry: 1}, engine: 'fixture',
      engines: {fixture: {baseUrl: server.baseUrl, model: 'fixture-model', provider: 'openai-compatible'}},
      languages: ['en', 'uk', 'de'],
    }),
  })
  await writeText(project.typesFile, 'original types\n')
  const before = await Promise.all(['en', 'uk', 'de'].map(language => readBytes(project.file(language))))
  const typesBefore = await readBytes(project.typesFile)

  const result = await runCli(project, [
    'label:add', 'btn.world', '--fromLangCode', 'uk', '-t', 'Привіт, світ!', '--silent',
  ])

  assert.equal(result.exitCode, 1)
  assert.match(result.stderr, /Translation failed; label was not added:/)
  assert.match(result.stderr, /- en \[provider_unavailable\] after 2 attempts: .*en provider down/)
  assert.match(result.stderr, /- de \[provider_unavailable\] after 2 attempts: .*de provider down/)
  assert.doesNotMatch(result.stderr, /^Translation batch contains failed items and is not complete\.$/m)
  assert.equal(server.requests.length, 4)
  for (const [index, language] of ['en', 'uk', 'de'].entries()) {
    assert.deepEqual(await readBytes(project.file(language)), before[index])
  }
  assert.deepEqual(await readBytes(project.typesFile), typesBefore)
})
```

The independent regex assertions intentionally do not require `en` and `de` to appear in a particular order because the translation workers run concurrently.

- [ ] **Step 2: Run the focused E2E test to verify the regression**

Run:

```powershell
npm run build
node --test --test-name-pattern="reports every translation engine failure" test/e2e/label-mutations.test.mjs
```

Expected: FAIL because stderr contains only `Translation batch contains failed items and is not complete.` and none of the preserved target/category/provider details.

- [ ] **Step 3: Import the failure type and implement the formatter**

In `src/commands/label/add.ts`, replace the batch type-only import with:

```typescript
import type {
  ITranslationBatchOutput,
  ITranslationFailed,
} from '../../shared/entities/translation-batch.js'
```

Add this private method next to `errorMessage`:

```typescript
private translationFailureMessage(failures: ITranslationFailed[]): string {
  return [
    'Translation failed; label was not added:',
    ...failures.map(failed => {
      const attempts = `${failed.attempts} ${failed.attempts === 1 ? 'attempt' : 'attempts'}`
      return `- ${failed.request.to} [${failed.category}] after ${attempts}: ${failed.message}`
    }),
  ].join('\n')
}
```

This method uses only existing sanitized batch fields and preserves array order.

- [ ] **Step 4: Select detailed diagnostics in the existing catch block**

Replace the current runtime catch body:

```typescript
} catch (error) {
  this.logToStderr(this.errorMessage(error))
  process.exitCode = 1
  return
}
```

with:

```typescript
} catch (error) {
  const message = batch?.failed.length
    ? this.translationFailureMessage(batch.failed)
    : this.errorMessage(error)
  this.logToStderr(message)
  process.exitCode = 1
  return
}
```

Do not move the check into `LabelAddExecutor`: the command is the presentation boundary and the executor must continue to reject every incomplete batch independently.

- [ ] **Step 5: Rebuild and run all label mutation E2E tests**

Run:

```powershell
npm run build
node --test test/e2e/label-mutations.test.mjs
```

Expected: the new diagnostics test and all existing atomic rollback/mutation tests pass.

- [ ] **Step 6: Verify one-attempt grammar without adding another slow E2E scenario**

Temporarily change only the new test's batch config from `retry: 1` to `retry: 0` and its two assertions from `after 2 attempts` to `after 1 attempt`. Run:

```powershell
npm run build
node --test --test-name-pattern="reports every translation engine failure" test/e2e/label-mutations.test.mjs
```

Expected: PASS with `after 1 attempt`. Restore `retry: 1` and `after 2 attempts`, then rerun the same focused command and expect PASS. Use `apply_patch` for both the temporary change and restoration; do not commit the temporary version.

- [ ] **Step 7: Run complete static and behavioral verification**

Run:

```powershell
git diff --check
npm run lint
npm run build
npm test
```

Expected: no whitespace or lint errors, TypeScript build succeeds, and the complete test suite plus post-test lint pass.

- [ ] **Step 8: Review the scoped diff**

Run:

```powershell
git status --short
git diff -- src/commands/label/add.ts test/e2e/label-mutations.test.mjs
```

Expected: only the two planned feature files appear in the feature diff. The pre-existing `package.json` modification remains unstaged and unchanged.

- [ ] **Step 9: Commit the implementation**

```powershell
git add src/commands/label/add.ts test/e2e/label-mutations.test.mjs
git commit -m "fix: show label add engine failures"
```

- [ ] **Step 10: Record final evidence**

Run:

```powershell
git status --short
git log -3 --oneline
```

Expected: the implementation commit is present and only the pre-existing `package.json` modification remains in the working tree.
