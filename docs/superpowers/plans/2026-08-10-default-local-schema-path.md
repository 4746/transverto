# Default Local Schema Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ctv init` always reference the JSON Schema shipped in the project's local `@cli107/transverto` installation while allowing users to replace `$schema` with any string.

**Architecture:** A renamed shared constant owns the generated local path and remains the single source used by defaults, config building, fixtures, and assertions. The JSON Schema validates `$schema` only as a string; its `$id` remains the public artifact identifier. Runtime behavior outside configuration generation does not change.

**Tech Stack:** TypeScript 6, Node.js 24 test runner, JSON Schema Draft 2020-12, Ajv 8, npm.

## Global Constraints

- The generated value is exactly `./node_modules/@cli107/transverto/schema/ctv.config.schema.json`.
- Rename `CTV_CONFIG_SCHEMA_URL` to `CTV_CONFIG_SCHEMA_PATH`; leave no old-name references.
- Do not constrain user-provided `$schema` strings with `const`, `enum`, `oneOf`, `pattern`, or URI format.
- Keep the schema `$id` equal to `https://raw.githubusercontent.com/4746/transverto/main/schema/ctv.config.schema.json`.
- Preserve the user's pre-existing `package.json` version edit and do not include it in the feature commit.

---

### Task 1: Generate and document the fixed local schema path

**Files:**
- Modify: `src/shared/constants.ts`
- Modify: `src/shared/config.ts`
- Modify: `src/shared/config-builder.ts`
- Modify: `schema/ctv.config.schema.json`
- Modify: `test/helpers/project-fixture.mjs`
- Modify: `test/e2e/init.test.mjs`
- Modify: `test/e2e/language-remove.test.mjs`
- Modify: `test/unit/config-schema.test.mjs`
- Modify: `README.md`

**Interfaces:**
- Produces: `CTV_CONFIG_SCHEMA_PATH: string` with the exact local npm path.
- Removes: `CTV_CONFIG_SCHEMA_URL` and all imports of that name.
- Preserves: schema `$id` as the public raw GitHub URL.

- [ ] **Step 1: Update tests first to express the new contract**

Replace imports of `CTV_CONFIG_SCHEMA_URL` with:

```js
import {CTV_CONFIG_SCHEMA_PATH} from '../../dist/shared/constants.js'
```

Update init, fixture, preservation, and identity assertions to use `CTV_CONFIG_SCHEMA_PATH`. Add the exact-value assertion to `test/unit/config-schema.test.mjs`:

```js
assert.equal(
  CTV_CONFIG_SCHEMA_PATH,
  './node_modules/@cli107/transverto/schema/ctv.config.schema.json',
)
assert.equal(createConfig().$schema, CTV_CONFIG_SCHEMA_PATH)
```

Add schema behavior coverage:

```js
test('schema accepts user-defined schema references as strings', () => {
  assertValid(createConfig({$schema: 'user-controlled-reference'}))
  assertInvalid(createConfig({$schema: 42}))
})
```

- [ ] **Step 2: Run focused tests and verify the red state**

Run: `npm run build && node --test test/e2e/init.test.mjs test/e2e/language-remove.test.mjs test/unit/config-schema.test.mjs`

Expected: FAIL because `CTV_CONFIG_SCHEMA_PATH` is not exported yet.

- [ ] **Step 3: Rename the constant and change its generated value**

Replace the old constant in `src/shared/constants.ts`:

```ts
export const CTV_CONFIG_SCHEMA_PATH =
  './node_modules/@cli107/transverto/schema/ctv.config.schema.json'
```

In `src/shared/config.ts` and `src/shared/config-builder.ts`, import `CTV_CONFIG_SCHEMA_PATH` and assign:

```ts
$schema: CTV_CONFIG_SCHEMA_PATH,
```

In `test/helpers/project-fixture.mjs`, import the renamed constant and assign the same expression as the first fixture property.

- [ ] **Step 4: Remove the schema-value restriction**

Change only `schema/ctv.config.schema.json` at `properties.$schema`:

```json
"$schema": {
  "type": "string",
  "description": "Enables editor validation, completion, and hover documentation for this file."
}
```

Do not modify the top-level schema `$id`.

- [ ] **Step 5: Update the README example**

Replace the first property of the `.ctv.config.json` example with:

```json
"$schema": "./node_modules/@cli107/transverto/schema/ctv.config.schema.json"
```

- [ ] **Step 6: Run focused verification**

Run: `npm run build && node --test test/e2e/init.test.mjs test/e2e/language-remove.test.mjs test/unit/config-schema.test.mjs`

Expected: all focused tests PASS, generated config begins with the exact local path, custom strings validate, and a numeric `$schema` fails.

- [ ] **Step 7: Verify no old constant name remains**

Run: `rg -n "CTV_CONFIG_SCHEMA_URL|raw.githubusercontent.com/4746/transverto/main/schema/ctv.config.schema.json" src test README.md schema/ctv.config.schema.json`

Expected: no `CTV_CONFIG_SCHEMA_URL` matches. The raw URL appears only as the schema `$id`.

- [ ] **Step 8: Run complete verification**

Run: `npm test`

Expected: build, all Node tests, and lint PASS.

Run: `npm pack --dry-run --json --ignore-scripts`

Expected: package contents include `schema/ctv.config.schema.json`.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 9: Commit feature files without the existing version hunk**

Stage every file listed in this task except `package.json`, then commit:

```bash
git add README.md schema/ctv.config.schema.json src/shared/constants.ts src/shared/config.ts src/shared/config-builder.ts test/helpers/project-fixture.mjs test/e2e/init.test.mjs test/e2e/language-remove.test.mjs test/unit/config-schema.test.mjs
git diff --cached --check
git commit -m "feat: use local config schema path"
```

Run `git status --short` and confirm that only the user's pre-existing `package.json` version edit remains.
