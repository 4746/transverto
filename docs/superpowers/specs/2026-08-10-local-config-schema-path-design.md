# Local `.ctv.config.json` Schema Path Design

## Goal

Allow `.ctv.config.json` to reference either Transverto's official public JSON Schema URL or an arbitrary relative local JSON Schema path.

## Accepted values

The existing public URL remains valid. A local value is valid when it starts with `./` or `../`, uses forward slashes, ends with `.json`, and contains no whitespace, query string, or fragment.

Accepted examples:

```json
"$schema": "./schemas/ctv.json"
```

```json
"$schema": "../../node_modules/@cli107/transverto/schema/ctv.config.schema.json"
```

Absolute filesystem paths, `file://` URLs, other HTTP URLs, paths without an explicit relative prefix, backslashes, non-JSON files, query strings, and fragments remain invalid.

## Schema structure

Replace the current `const` under `properties.$schema` with `oneOf`. One branch retains the exact official URL as a `const`; the other requires a string matching the relative-local-path pattern. The branches are disjoint, and the schema's own `$id` remains the official public URL.

## Generated configuration and compatibility

`ctv init` continues to emit the official public URL through `CTV_CONFIG_SCHEMA_URL`. No TypeScript runtime or serialization changes are required. Existing generated configurations remain valid, while users may manually switch to a relative local path for offline editor support.

## Documentation and verification

- Extend the Ajv test with accepted `./`, `../`, and multi-level relative paths.
- Add negative cases for absolute paths, `file://`, arbitrary HTTP URLs, missing prefixes, backslashes, non-JSON extensions, whitespace, query strings, and fragments.
- Add a README example using `./node_modules/@cli107/transverto/schema/ctv.config.schema.json`.
- Run focused schema tests, the full test/lint suite, build, and npm pack dry-run verification.
