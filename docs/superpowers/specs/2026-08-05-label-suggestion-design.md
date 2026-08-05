# Label Suggestion Command Design

## Goal

Add a `ctv label:suggest TEXT` command that uses the configured AI engine to
suggest English localization keys for arbitrary input text. Input may be in any
language. Every accepted suggestion must match the project's
`labelValidation` regular expression.

## Command interface

```text
ctv label:suggest "Обрати тип QR-коду"
ctv label:suggest "Обрати тип QR-коду" --count 10 --engine lmstudio
ctv label:suggest "Обрати тип QR-коду" --json
```

The positional `TEXT` argument is required. The command supports these options:

- `--count <integer>` overrides the configured number of requested suggestions.
  It must be a positive integer.
- `--engine <name>` overrides the active engine profile for this invocation.
- `--json` uses oclif's standard machine-readable output mode.

The suggestion count is resolved in this order:

1. `--count`
2. `.ctv.config.json` field `labelSuggestionCount`
3. built-in default `5`

The engine is resolved in this order:

1. `--engine`
2. `.ctv.config.json` field `engine`

## Configuration

Two project-level fields are added:

```json
{
  "labelSuggestionCount": 5,
  "labelSuggestionShowInvalid": false
}
```

`labelSuggestionCount` must be a positive integer. It is not capped.
`labelSuggestionShowInvalid` must be a boolean.

Each engine profile may define a feature-specific system prompt:

```json
{
  "engines": {
    "lmstudio": {
      "provider": "lmstudio",
      "model": "local-model",
      "labelSuggestionPrompt": "Suggest concise localization keys for web interfaces."
    }
  }
}
```

`labelSuggestionPrompt` is the system message used only by label suggestion
requests. When absent, the command uses a built-in label-suggestion system
prompt. It does not replace the command-generated user message containing the
input and technical output constraints. Existing translation requests continue
to use `systemPrompt` and are unaffected.

## Architecture and data flow

The feature consists of small, separate units:

1. `label:suggest` parses flags, reads project configuration, resolves the engine
   profile, invokes the suggestion service, and renders text or JSON output.
2. A label-suggestion service builds the request, makes one engine call, parses
   the response, removes duplicates, and partitions candidates into valid and
   invalid lists.
3. The OpenAI-compatible engine exposes a label-suggestion completion operation
   while reusing its existing authentication, request options, timeout, and
   provider error handling.
4. A response parser accepts exactly one JSON array of strings. Markdown fences,
   objects, non-string elements, and non-JSON prose are rejected.

The generated user prompt includes:

- the original input text;
- an instruction to understand or translate non-English input internally;
- a requirement that every proposed key be English;
- the requested number of unique candidates;
- the literal `labelValidation` pattern;
- a requirement to return only one JSON array of strings.

The feature uses one AI request. It does not perform a separate translation
request and does not retry merely because filtering leaves fewer than the
requested number of valid suggestions.

## Validation and output

After parsing, candidates are trimmed and deduplicated while preserving model
order. Duplicate values are discarded and are not treated as invalid
suggestions. Every remaining candidate is tested against a fresh regular
expression created from `labelValidation` without stateful global matching.

Normal text output lists valid suggestions first, one per line. When
`labelSuggestionShowInvalid` is `true` and invalid values exist, it appends an
`Invalid suggestions:` section below the valid list. Invalid suggestions are
unique model results that fail `labelValidation`; they are displayed verbatim
apart from surrounding whitespace trimming.

JSON output has this shape when invalid suggestions are hidden:

```json
{
  "suggestions": ["select_qr_code_type", "select_qrcode_type"]
}
```

When `labelSuggestionShowInvalid` is `true`, it additionally includes the
`invalidSuggestions` array, including when that array is empty:

```json
{
  "suggestions": ["select_qr_code_type"],
  "invalidSuggestions": ["Select QR code type"]
}
```

Returning zero valid suggestions is a successful command result when the model
returned a valid, non-empty JSON array; optional invalid output explains what
was filtered. An empty JSON array or an empty completion is an engine-response
error because it supplies no proposals.

## Error handling

Configuration and input errors exit as usage errors, including:

- missing text;
- non-positive or non-integer count;
- invalid configured count or show-invalid value;
- invalid `labelValidation` regular expression;
- missing or unknown engine profile.

Provider, authentication, network, timeout, HTTP, empty-completion, and response
parsing failures use the existing engine error categories and exit as execution
errors. The command does not write translation dictionaries, generated types,
or the translation cache.

## Testing

Unit tests cover:

- configuration defaults and validation for the two project-level fields;
- validation and resolution of `labelSuggestionPrompt`;
- selection of the feature-specific system prompt;
- user-prompt inclusion of text, count, English-only behavior, and regex;
- strict JSON-array parsing;
- stable deduplication and regex partitioning;
- hidden and visible invalid suggestion output.

End-to-end tests use the local OpenAI-compatible fixture server to cover:

- default engine and count resolution;
- `--engine` and `--count` overrides;
- non-English input;
- text and JSON rendering;
- invalid engine responses and invalid command/config values.

README and generated command documentation will describe the new command and
configuration fields.
