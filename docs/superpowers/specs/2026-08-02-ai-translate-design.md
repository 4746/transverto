# AI Translate Design

## Goal

Replace the legacy Bing, Google Translate, and Terra provider commands with one `ctv translate` command backed by configurable AI model profiles. The command supports positional text, stdin, and translation dictionary keys while exposing one stable result shape and safe preview/write behavior.

File input through `--file` is explicitly excluded from this release.

## Scope

This change:

- removes `translate:bing`, `translate:google`, and `translate:terra` without aliases;
- removes the legacy provider adapters, provider-specific language maps, provider configuration entities, and global translation cache wrapper;
- adds configurable LM Studio, Google AI Studio, OpenRouter, and generic OpenAI-compatible profiles;
- adds the public `ctv translate` command;
- updates `init`, `doctor`, `label:sync --autoTranslate`, configuration validation, CLI help, and README for the new configuration schema;
- keeps retry, fallback, rate limiting, batch controls, and the redesigned cache outside this task.

No compatibility layer for the v1 engine configuration is provided.

## Configuration

The configuration stores an optional active profile name in `engine` and named profiles in `engines`:

```json
{
  "engine": "lmstudio",
  "engines": {
    "lmstudio": {
      "provider": "lmstudio",
      "baseUrl": "http://172.20.16.1:1234/v1",
      "model": "google/gemma-4-12b-qat"
    },
    "google-ai": {
      "provider": "google-ai",
      "model": "gemini-3.6-flash",
      "apiKeyEnv": "GEMINI_API_KEY"
    },
    "openrouter": {
      "provider": "openrouter",
      "model": "openrouter/free",
      "apiKeyEnv": "OPENROUTER_API_KEY"
    }
  }
}
```

Generated default profile names match their provider names. Profile names remain user-defined so one provider can have multiple endpoints or models, such as `lmstudio-gemma` and `lmstudio-llama`.

The profile contract is:

```ts
type TEngineProvider =
  | 'lmstudio'
  | 'google-ai'
  | 'openrouter'
  | 'openai-compatible'

interface IEngineProfile {
  apiKeyEnv?: string
  baseUrl?: string
  model: string
  provider: TEngineProvider
}

interface IConfig {
  engine: null | string
  engines: Record<string, IEngineProfile>
  // Existing project and language fields remain unchanged.
}
```

Provider defaults and validation rules are:

- `lmstudio`: default base URL `http://localhost:1234/v1`; API key optional.
- `google-ai`: default base URL `https://generativelanguage.googleapis.com/v1beta/openai`; `apiKeyEnv` required.
- `openrouter`: default base URL `https://openrouter.ai/api/v1`; `apiKeyEnv` required.
- `openai-compatible`: explicit absolute HTTP(S) `baseUrl` required; API key optional.
- Every configured profile requires a non-empty `model` and valid profile/provider names.
- `apiKeyEnv` stores only an environment-variable name. Secrets are never written to configuration or diagnostics.
- A project may have `engine: null` and `engines: {}`. Label-only workflows remain valid, while translation reports a configuration error before any network request.

The obsolete `bing`, `google`, `terra`, and `engineUseCache` fields are removed from the v2 schema.

## Architecture

`OpenAICompatibleEngine` owns the HTTP protocol. It receives a fully resolved profile, sends a non-streaming request to `<baseUrl>/chat/completions`, authenticates with a bearer token when configured, validates the response shape, and returns the assistant text. It uses the Node 24 built-in `fetch`; the `got` dependency is removed if no remaining source file uses it.

Provider preset resolution supplies default base URLs and authentication requirements. `EngineFactory` resolves the selected profile name, applies its provider preset, reads the requested API key from the environment, and constructs `OpenAICompatibleEngine`. It validates everything it can before the first request.

`TranslationService` is provider-independent. It creates a deterministic translation prompt, invokes the engine, rejects empty responses, and returns the public result object. The prompt instructs the model to return only the translation and preserve placeholders, punctuation, whitespace structure, and formatting. Response content is trimmed at its outer boundary; no heuristic removal of quotes or code fences is performed.

The stable successful result contract is:

```ts
interface ITranslationResult {
  engine: string
  from: string
  key?: string
  model: string
  sourceText: string
  to: string
  translatedText: string
}
```

`engine` is the selected profile name, not the provider name. This makes the actual user-selected configuration visible when multiple profiles use the same provider.

The old global cache is not copied into the new service. Cache behavior will be introduced by task 6 around this stable service boundary.

## Command Interface

The command syntax is:

```text
ctv translate [TEXT] --to <lang> [--to <lang> ...]
  [--stdin]
  [--key <path> ...]
  [--from <lang>]
  [--engine <profile>]
  [--dry-run]
  [--write]
  [--json]
```

Input rules:

- Exactly one input mode is allowed: positional `TEXT`, `--stdin`, or one or more `--key` flags.
- `--file` is not implemented or accepted.
- Positional and stdin input must contain at least one non-whitespace character.
- `--stdin` reads UTF-8 input until EOF.
- `--key` is repeatable. Each key must resolve to a string leaf in the source dictionary.
- `--to` is repeatable and required. Duplicate targets are rejected.
- `--from` defaults to `langCodeDefault`.
- `--engine` defaults to the active profile named by config `engine`.
- `--write` is valid only with `--key` and conflicts with `--dry-run`.
- `--dry-run` validates the config, profile, environment-variable presence, languages, dictionaries, and keys, then prints the planned requests without network calls or writes.

For positional text and stdin, language codes must pass the project language-code syntax validator. They need not be listed in config because no dictionary is read or written.

For key mode, `--from` and every `--to` must be configured project languages. A target equal to the source language is rejected. The source and target dictionary roots must be valid JSON objects, and touched values must be string leaves or missing target leaves.

## Ordering and Output

Requests are processed sequentially in deterministic order. For key mode, keys retain command-line order and targets retain `--to` order; each key is expanded across all targets before the next key. Text and stdin mode produce one result per target in `--to` order.

Human output prints only the translated text when there is one result. Multiple results include the target language and, in key mode, the key so values remain identifiable.

JSON output uses a stable envelope:

```ts
interface ITranslateOutput {
  dryRun: boolean
  results: ITranslationResult[]
  requests: ITranslationRequestPlan[]
  written: string[]
}
```

Normal execution populates `results`; dry-run populates `requests` and leaves `results` empty. `written` contains target language codes whose dictionaries were committed, in config language order, and is empty for preview modes.

## Key Preview and Writes

Key translation is preview-only by default: network requests run and results are displayed, but dictionaries are unchanged.

With `--write`, the command first completes every requested translation in memory. If any request or validation fails, nothing is written. After all results succeed, it clones the affected target dictionaries, sets each translated string at its key path, and commits all changed dictionaries through the existing atomic file transaction utility. Existing target values for the explicitly selected keys are replaced because `--write` is explicit authorization to update them.

Generated TypeScript types are not rewritten because the source dictionary key set does not change. Missing keys may be added only to target dictionaries and already exist in the source dictionary from which types are generated.

## Init and Doctor

`ctv init` adopts the new schema. Non-interactive engine setup uses `--engine <profile>`, `--provider`, `--model`, `--base-url`, and `--api-key-env`. Supplying any profile-detail flag requires a complete valid profile selection. `--minimal` without engine flags writes `engine: null` and `engines: {}` so label commands work immediately without inventing a model name.

Interactive init asks whether to configure translation. If accepted, it asks for profile name, provider, model, optional base URL override, and environment-variable name when required. It never asks for or persists an API key.

`ctv doctor` validates the active profile reference and every configured profile. Missing translation configuration is a warning for a label-only project; malformed profiles and a missing active profile are errors. A required environment variable that is not set is an error.

`doctor --check-engine` resolves the active profile and makes an authenticated request to its OpenAI-compatible models endpoint with the existing timeout. It reports reachability and status without logging request headers, API-key contents, or response bodies that could contain sensitive data. No network call occurs without `--check-engine`.

## Existing Command Integration

`label:sync --autoTranslate` switches from the removed `TranslateEngine` to `TranslationService`, using config `langCodeDefault` as the source, each target dictionary language as the target, and the configured active engine profile. Its existing CLI behavior otherwise remains unchanged in this task.

The legacy `cache` command remains until task 6, but the new translation path does not read or write the old global cache. README must describe this limitation so users do not assume `ctv cache` affects AI translations yet.

## Errors and Exit Behavior

Usage and configuration failures exit with code 2 before network activity. Provider/network/response failures exit with code 1. Successful preview, dry-run, and writes exit with code 0.

Errors identify the profile and model but never include secret values. Invalid HTTP response status reports the status code and provider error message when safely extractable. Malformed or empty completion responses are provider-response errors. Retry, fallback, and error-category expansion remain deferred to tasks 7 and 8.

## Verification

No tests or test infrastructure are added, as required by `PLAN.md`. Verification consists of:

- `npm run build`;
- `npm run lint`;
- `node bin/run.js translate --help`;
- `node bin/run.js --help` confirming only `ctv translate` is public;
- validation failures for missing input, mixed input modes, duplicate targets, invalid profiles, missing environment variables, and invalid key languages;
- `--dry-run` confirming no network request and no file writes;
- key preview confirming dictionaries remain byte-for-byte unchanged;
- key `--write` confirming all selected target dictionaries update atomically;
- multi-target JSON confirming stable ordering and result shape;
- a real positional translation through the configured LM Studio profile at `http://172.20.16.1:1234/v1` using model `google/gemma-4-12b-qat` when that endpoint is reachable from the execution environment.

## Documentation

README and generated CLI help document the new config schema, provider defaults, environment-variable setup, all input modes except the excluded `--file`, preview/write safety, JSON output, and LM Studio, Google AI Studio, and OpenRouter examples. They contain no references to the removed provider commands or legacy engine configuration.
