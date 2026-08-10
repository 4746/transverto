# README Product Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give README readers an immediate English overview of Transverto's purpose, main capabilities, supported language-code styles, and typical label workflow.

**Architecture:** Keep the existing generated command reference and detailed configuration documentation intact. Add a hand-written product description, feature summary, and workflow above the generated TOC, then let oclif regenerate the TOC while excluding unrelated version-link changes caused by the user's pending `package.json` version edit.

**Tech Stack:** Markdown, oclif README generator, npm, PowerShell verification.

## Global Constraints

- Write the new overview in English.
- Preserve all existing detailed README sections and generated command documentation.
- Show both `en,es,de,fr,uk` and `en-US,en-GB,es-ES,es-419,de-DE,fr-FR,pt-BR,pt-PT,uk-UA` initialization styles.
- Include `label:add`, `label:get`, `label:suggest`, `translate --key`, and safe `label:delete --dry-run` examples.
- Explain that `label:suggest` requires an AI engine profile and `label:delete --dry-run` does not write.
- Do not stage or commit the user's pre-existing `package.json` version edit or oclif-generated version-link changes derived from it.

---

### Task 1: Add the product overview and workflow

**Files:**
- Modify: `README.md:1-35`

**Interfaces:**
- Produces: hand-written `## What Transverto does` and `## Typical workflow` sections.
- Preserves: `<!-- toc -->`, `<!-- tocstop -->`, `<!-- commands -->`, and `<!-- commandsstop -->` generator markers.

- [ ] **Step 1: Prove the overview is currently absent**

Run:

```powershell
$readme = Get-Content -Raw README.md
if ($readme.Contains('## What Transverto does') -or $readme.Contains('## Typical workflow')) { exit 1 }
if (-not $readme.Contains('Label management command.')) { exit 1 }
```

Expected: exit 0, confirming both overview headings are absent and the uninformative sentence is still present.

- [ ] **Step 2: Replace the introduction and add the exact overview copy**

Keep the title and badges, replace `Label management command.`, and insert this Markdown after the badges and before `<!-- toc -->`:

````markdown
Transverto is a CLI for managing JSON translation dictionaries, keeping languages synchronized, and translating content with local or hosted AI models. It combines safe key and language operations with validation, previews, atomic writes, status reporting, CSV exchange, and generated TypeScript types.

## What Transverto does

- Manage translation keys and configured languages across JSON dictionaries.
- Translate text or dictionary keys with LM Studio, Google AI, OpenRouter, or another OpenAI-compatible API.
- Preview changes and protect writes with dry runs, atomic updates, conflict detection, and placeholder validation.
- Search labels, inspect translation status, diagnose projects, and synchronize missing values safely.
- Import and export translations through CSV workflows with explicit conflict policies.
- Cache translation results and generate TypeScript language/key types from the source dictionary.

## Typical workflow

Install Transverto in your project:

```shell
npm install --save-dev @cli107/transverto
```

Initialize a project with simple language codes:

```shell
npx ctv init --minimal \
  --languages en,es,de,fr,uk \
  --source en
```

Or use regional locale codes when translations differ by country or region:

```shell
npx ctv init --minimal \
  --languages en-US,en-GB,es-ES,es-419,de-DE,fr-FR,pt-BR,pt-PT,uk-UA \
  --source en-US
```

Transverto supports both styles, so a project can keep general translations or maintain country-specific variants.

```shell
npx ctv label:add home.title --text "Welcome"
npx ctv label:get home --mode prefix
npx ctv label:suggest "Welcome to your dashboard" --count 5
npx ctv translate --key home.title --to uk --write
npx ctv label:delete home.legacy --dry-run
```

`label:suggest` requires a configured AI engine profile. The `label:delete` example uses `--dry-run`, so it previews the deletion without changing files.

Continue with [Usage](#usage), [AI engine profiles](#ai-engine-profiles), or the complete [Commands](#commands) reference.
````

- [ ] **Step 3: Verify the documented command names and flags exist**

Run:

```powershell
node bin/run.js init --help
node bin/run.js label:add --help
node bin/run.js label:get --help
node bin/run.js label:suggest --help
node bin/run.js translate --help
node bin/run.js label:delete --help
```

Expected: every command exits 0; output includes `--languages`, `--source`, `--text`, `--mode`, `--count`, `--key`, `--write`, and `--dry-run` in their respective help pages.

- [ ] **Step 4: Regenerate and verify the table of contents**

Run: `npm exec -- oclif readme`

Expected: the hand-written overview survives, and the generated TOC includes:

```markdown
* [What Transverto does](#what-transverto-does)
* [Typical workflow](#typical-workflow)
```

Because the working `package.json` already contains the user's version bump, oclif may also rewrite generated `See code` links. Stage only the overview and TOC hunks with `git add -p README.md`, reject version-link hunks, then run `git restore README.md` to discard only unstaged generator side effects while retaining the staged overview in the index and worktree.

- [ ] **Step 5: Verify README structure after regeneration cleanup**

Run:

```powershell
$readme = Get-Content -Raw README.md
foreach ($text in @(
  '## What Transverto does',
  '## Typical workflow',
  '--languages en,es,de,fr,uk',
  '--languages en-US,en-GB,es-ES,es-419,de-DE,fr-FR,pt-BR,pt-PT,uk-UA',
  'npx ctv label:get home --mode prefix',
  'npx ctv label:suggest "Welcome to your dashboard" --count 5',
  'npx ctv label:delete home.legacy --dry-run'
)) {
  if (-not $readme.Contains($text)) { Write-Error "Missing README text: $text"; exit 1 }
}
```

Expected: exit 0.

- [ ] **Step 6: Run repository verification**

Run: `npm run build`

Expected: TypeScript compilation exits 0.

Run: `npm run lint`

Expected: ESLint exits 0.

Run: `git diff --cached --check`

Expected: no whitespace errors.

- [ ] **Step 7: Commit only README changes**

Confirm `git diff --cached --name-only` prints only `README.md`, then commit:

```bash
git commit -m "docs: add Transverto product overview"
```

Run `git status --short` and confirm only the user's pre-existing `package.json` version edit remains.
