# Engine request options design

## Goal

Allow every named translation engine profile to configure its system prompt,
temperature, and whether model reasoning should be disabled. The active engine
profile must control the request without changing existing configurations.

## Configuration

`IEngineProfile` gains three optional fields:

```typescript
interface IEngineProfile {
  // Existing fields omitted.
  reasoning?: boolean
  systemPrompt?: string
  temperature?: number
}
```

Example:

```json
{
  "engine": "lmstudio",
  "engines": {
    "lmstudio": {
      "provider": "lmstudio",
      "model": "local-model",
      "systemPrompt": "You are a concise translation assistant.",
      "temperature": 0.2,
      "reasoning": false
    },
    "google-ai": {
      "provider": "google-ai",
      "model": "gemini-model",
      "apiKeyEnv": "CTV_GOOGLE_AI_API_KEY",
      "systemPrompt": "Follow the localization instructions exactly.",
      "temperature": 0,
      "reasoning": false
    }
  }
}
```

Validation rules:

- `systemPrompt`, when present, must be a string. Its content is preserved.
- `temperature`, when present, must be a finite number from `0` through `2`.
- `reasoning`, when present, must be a boolean.
- Existing profiles remain valid. Their effective system prompt is empty, their
  effective temperature is `0`, and they do not send a reasoning override.

`reasoning: false` is the required disabling behavior. `reasoning: true` asks
the provider to use its normal enabled/default reasoning behavior; it does not
select a particular effort level.

## Request construction

`buildSystemPrompt` and `buildBatchSystemPrompt` continue to construct the full
translation task, including source text and target languages. That task is sent
as the `user` message. The `system` message content comes from the resolved
profile's `systemPrompt`, falling back to an empty string for compatibility with
the current request structure.

`completion` uses the resolved profile's temperature instead of the hard-coded
value:

```text
temperature = profile.temperature ?? 0
```

When `reasoning` is absent, no reasoning-related property is included. When it
is `false`, request construction maps the single configuration option to the
provider's OpenAI-compatible dialect:

| Provider | Request property |
| --- | --- |
| `openrouter` | `reasoning: {enabled: false}` |
| `google-ai` | `reasoning_effort: "none"` |
| `lmstudio` | `reasoning_effort: "none"` |
| `openai-compatible` | `reasoning_effort: "none"` |

For `reasoning: true`, OpenRouter receives `reasoning: {enabled: true}`. Other
providers receive no reasoning override and therefore use the selected model's
default behavior. This avoids inventing an effort level such as `medium` that
the user did not choose.

The generic `openai-compatible` mapping follows the OpenAI-style
`reasoning_effort` convention. A custom endpoint that does not accept that
parameter may reject the request; the existing provider error handling surfaces
that response.

## Provider limitations

The client can request disabled reasoning but cannot guarantee it for models
whose provider makes reasoning mandatory. For example, some Gemini models do
not permit reasoning to be turned off. Such a provider rejection remains a
normal translated `TranslationError`; the client does not silently retry with
reasoning enabled because that would violate the configured intent.

## Scope of changes

- Extend `IEngineProfile` and resolved profile typing.
- Validate and preserve the three fields in `engine-profile.ts`.
- Use the resolved fields in `openai-compatible.engine.ts`.
- Document the fields in the README configuration example/reference.
- Add focused unit coverage for validation, defaults, message construction,
  temperature, omission of unspecified reasoning, and provider-specific
  disabling payloads.

No new `ctv init` flags or interactive questions are added. These advanced
request options are configured directly in the JSON profile, keeping the CLI
setup flow focused.

## Error handling and compatibility

Invalid configuration fails during the existing engine-profile validation
stage with a message naming the profile and field. HTTP errors caused by an
unsupported provider/model option follow the existing response classification.

No existing required field, default endpoint, credential behavior, timeout, or
translation-response parsing changes. Fallback profiles resolve and apply their
own request options independently.

## Verification

Tests will assert:

1. Valid values survive profile validation and resolution.
2. Invalid system prompt, temperature, and reasoning values are rejected.
3. An old profile produces an empty system message, temperature `0`, and no
   reasoning property.
4. Single and multi-language requests use the active profile's system prompt.
5. Configured temperature reaches the request body.
6. `reasoning: false` produces the expected payload for OpenRouter and the
   OpenAI-style providers.
7. A fallback engine uses its own settings rather than the primary profile's.

The implementation is complete only after the build, lint, and relevant unit
tests pass.
