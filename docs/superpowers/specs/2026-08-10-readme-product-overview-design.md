# README Product Overview Design

## Goal

Make the top of `README.md` explain within one minute what Transverto is, which problems it solves, and what a typical workflow looks like before readers reach detailed configuration documentation.

## Placement and structure

Keep the title and badges at the top. Replace the current `Label management command.` sentence with a concise product description. After the badges and before the generated table of contents, add two sections:

1. `## What Transverto does`
2. `## Typical workflow`

The existing detailed sections remain unchanged. Add both new sections to the table of contents.

## Product description

Use this copy below the title:

> Transverto is a CLI for managing JSON translation dictionaries, keeping languages synchronized, and translating content with local or hosted AI models. It combines safe key and language operations with validation, previews, atomic writes, status reporting, CSV exchange, and generated TypeScript types.

The description should identify the artifact format, core workflow, AI support, and safety characteristics without claiming to be a general localization platform.

## Feature overview

`## What Transverto does` contains six scan-friendly bullets:

- Manage translation keys and configured languages across JSON dictionaries.
- Translate text or dictionary keys with LM Studio, Google AI, OpenRouter, or another OpenAI-compatible API.
- Preview changes and protect writes with dry runs, atomic updates, conflict detection, and placeholder validation.
- Search labels, inspect translation status, diagnose projects, and synchronize missing values safely.
- Import and export translations through CSV workflows with explicit conflict policies.
- Cache translation results and generate TypeScript language/key types from the source dictionary.

## Typical workflow

Show installation first:

```shell
npm install --save-dev @cli107/transverto
```

Then show two labeled initialization alternatives so readers can see that both simple language codes and regional locale codes are supported:

```shell
# Simple language codes
npx ctv init --minimal \
  --languages en,es,de,fr,uk \
  --source en
```

```shell
# Regional locale codes
npx ctv init --minimal \
  --languages en-US,en-GB,es-ES,es-419,de-DE,fr-FR,pt-BR,pt-PT,uk-UA \
  --source en-US
```

Follow the alternatives with this explanation:

> Transverto supports both simple language codes and regional locale codes, so projects can keep general translations or maintain country-specific variants.

Complete the compact workflow using the simple-language project:

```shell
npx ctv label:add home.title --text "Welcome"
npx ctv translate --key home.title --to uk --write
```

Follow it with one sentence directing readers to `Usage`, `AI engine profiles`, and `Commands` for setup and complete options. Do not duplicate engine configuration or command reference content in the overview.

## Verification

- Check all example commands against current CLI flags and positional arguments.
- Run `npm exec oclif readme` or the existing README generation workflow and confirm the hand-written overview survives regeneration.
- Confirm the generated table of contents includes both new headings.
- Run the repository lint/build checks required by the existing workflow.
