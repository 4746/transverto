# `.ctv.config.json` JSON Schema Design

## Goal

Provide editor validation, completion, hover documentation, defaults, and examples for Transverto's `.ctv.config.json`. Every configuration created by `ctv init` must opt in automatically through a top-level `$schema` property.

## Schema publication and reference

- Store the schema in the repository at `schema/ctv.config.schema.json`.
- Use JSON Schema Draft 2020-12.
- Publish it through the repository's stable raw URL:
  `https://raw.githubusercontent.com/4746/transverto/main/schema/ctv.config.schema.json`.
- Add that URL as the first `$schema` property in every configuration produced by `ctv init`.
- Include the schema in the published npm package so consumers and tooling can also inspect it locally.

The stable `main` URL intentionally prioritizes immediate access to current configuration help over strict version pinning. Runtime validation remains authoritative when an installed older CLI differs from the current schema.

## Schema coverage

The schema describes every current `IConfig` property:

- Project paths: `basePath` and `basePathEnum`.
- Language setup: `languages` and `langCodeDefault`.
- Generated type naming: `nameEnum`.
- Label validation and suggestion options: `labelValidation`, `labelSuggestionCount`, and `labelSuggestionShowInvalid`.
- Translation batching: `batch.mode`, `concurrency`, `delayMs`, `retry`, `maxItems`, and `maxChars`.
- Translation cache retention: `cache.maxEntries` and `cache.ttlMs`.
- Translation profiles: `engine`, `fallback`, and the named profiles under `engines`.
- Engine profile fields: `provider`, `model`, `baseUrl`, `apiKeyEnv`, `timeoutMs`, `temperature`, `reasoning`, `systemPrompt`, and `labelSuggestionPrompt`.

Each property should include concise editor-facing descriptions. Where useful, it should also expose defaults and examples that match the implementation.

## Validation rules

- Set `additionalProperties: false` at the configuration root and within fixed-shape objects such as `batch`, `cache`, and individual engine profiles.
- Allow arbitrary keys only inside `engines`; constrain profile names with the same pattern used at runtime and validate every value as an engine profile.
- Match existing runtime restrictions for language codes, environment-variable names, engine-profile names, providers, URLs, integer minimums, nullable limits, temperature, and relative project paths.
- Require the fields emitted by `ctv init`, including `$schema`.
- Require `model` and `provider` in each engine profile.
- Express provider-specific requirements where practical: Google AI and OpenRouter profiles require `apiKeyEnv`; openai-compatible profiles require `baseUrl`.

JSON Schema cannot generally enforce that `langCodeDefault` is present in `languages`, that `engine` and `fallback` name keys in `engines`, or that primary and fallback profiles differ. Existing runtime validators remain responsible for these cross-field constraints.

## Code changes

- Export a single schema URL constant from the shared configuration/constants layer.
- Extend `IConfig` with the serialized `$schema` field, or introduce an explicit serialized-config type if that produces a cleaner boundary during implementation.
- Update `CONFIG_DEFAULT`/`buildConfig` so generated configuration objects serialize `$schema` first.
- Add `schema/ctv.config.schema.json` and include `/schema` in the npm `files` allowlist.
- Update the README configuration example to show `$schema` first.

Commands that rewrite an existing configuration must preserve `$schema`. Existing configurations without `$schema` remain readable for backward compatibility; runtime loading must not begin requiring this metadata field.

## Verification

- Validate a representative complete configuration against the schema.
- Validate the minimal configuration emitted by `ctv init` against the schema.
- Add negative cases for unknown root/profile/batch fields, invalid language codes, invalid provider names, invalid URLs, invalid environment-variable names, and out-of-range numbers.
- Extend the `ctv init` end-to-end test to assert the exact `$schema` URL.
- Verify that configuration mutation commands preserve the property.
- Run the project test, lint, and build commands.

## Compatibility and failure behavior

The schema adds editor-time diagnostics only and must not replace CLI validation. Existing `.ctv.config.json` files without `$schema` continue to work. If the public schema URL is temporarily unavailable, editors may lose completion or validation, but Transverto commands continue to operate normally.
