# Translation Status Design

## Scope

Task 9 adds a read-only `ctv status` command that compares configured target
language dictionaries with the configured source language. It reports missing,
extra, empty, unchanged, and placeholder-mismatched translations, supports
structured filters, produces human and stable JSON output, and can fail CI based
on finding severity.

The command performs no writes, type generation, engine resolution, or network
calls. Coverage percentages, history, and source-code scanning remain out of
scope. Per `PLAN.md`, the task does not add tests or change test infrastructure.

## Command Interface

`ctv status` accepts these repeatable filters:

- `--language <code>` selects configured target languages;
- `--problem missing|extra|empty|same|placeholder` selects problem types;
- `--include <pattern>` includes matching finding keys;
- `--exclude <pattern>` excludes matching finding keys.

It also accepts `--json` and `--fail-on error|warning|never`. The default is
`--fail-on error`.

Without `--language`, every configured language except `langCodeDefault` is
analyzed in configuration order. Each explicit language must be configured and
must not be the source language. Duplicate filter values are normalized without
changing their first occurrence order.

Invalid flags, unknown languages, the source language supplied as a target,
invalid patterns, invalid configuration, unreadable dictionaries, malformed
JSON, non-object roots, and non-string leaves are reported as command errors and
exit with code 2. These failures do not produce a partial status report.

## Key Pattern Semantics

Key patterns are case-sensitive and support an exact key or one wildcard at an
edge:

- `home.title` matches only that exact key;
- `home.*` matches keys beginning with `home.`;
- `*.title` matches keys ending with `.title`;
- `*` matches every key.

A pattern may contain at most one `*`. Any wildcard in the middle, including
`home.*.title`, is invalid and produces exit code 2. No other glob syntax is
supported.

Multiple include patterns are ORed. Multiple exclude patterns are ORed. A key
must match at least one include pattern when includes are supplied, and it must
not match any exclude pattern. Language, problem, include, and exclude filters
are applied as ANDed filter groups to structured findings before summary or
formatting.

## Components

### Status entities

`src/shared/entities/status.ts` defines the public report contract, finding and
summary shapes, problem types, severities, filter options, and fail thresholds.
It contains no oclif or filesystem behavior.

Each finding has these stable fields:

- `problem`: `missing`, `extra`, `empty`, `same`, or `placeholder`;
- `severity`: `error`, `warning`, or `info`;
- `language`: target language code;
- `key`: flattened leaf key;
- `sourceValue`: source string or `null` when the key is extra;
- `value`: target string or `null` when the key is missing;
- `sourcePlaceholders`: sorted source placeholders for placeholder findings,
  otherwise `null`;
- `valuePlaceholders`: sorted target placeholders for placeholder findings,
  otherwise `null`.

The explicit nullable fields keep the JSON shape identical for every problem
type.

### Status analysis service

`src/shared/status.service.ts` owns project loading, strict dictionary
validation, flattening string leaves, comparison, structured filtering,
deterministic sorting, summary calculation, and exit-threshold evaluation. The
service is read-only and independent of oclif and terminal formatting.

The service reuses `comparePlaceholders` from `src/shared/placeholder.ts`. It
does not use legacy `LabelBaseCommand` or `UTIL.flattenObject`, because those
utilities permit weakly typed leaves and contain behavior inappropriate for a
strict read-only report.

### Status command

`src/commands/status.ts` defines flags, calls the analysis service, renders the
human table or JSON report, and exits with the service-selected code. It does
not duplicate analysis or filtering rules.

## Analysis Rules

The source dictionary is the file for `langCodeDefault`. Every selected target
is compared independently against its flattened string-leaf map.

Findings use these rules and default severities:

- `missing` (`error`): a source leaf key is absent from the target;
- `extra` (`info`): a target leaf key is absent from the source;
- `empty` (`warning`): an existing target value is empty or whitespace-only;
- `same` (`info`): an existing, non-empty target value exactly equals the
  source value;
- `placeholder` (`error`): an existing target value does not preserve the exact
  source placeholder multiset.

Placeholder comparison recognizes `{{name}}`, `{count}`, `%s`, and `%1$s` using
the Task 8 utility. Placeholder order may differ, but spelling and occurrence
count must match. An empty or whitespace-only value may therefore produce both
`empty` and `placeholder` when the source contains placeholders. A value may
also produce both `same` and another applicable finding; findings are
independent facts rather than mutually exclusive statuses.

Missing and extra values do not additionally produce empty, same, or
placeholder findings. Source values are not themselves reported as empty; the
command evaluates target translation state relative to the source.

Findings are ordered by selected language order, then key using Unicode string
comparison, then problem order: `missing`, `extra`, `empty`, `same`,
`placeholder`. Filtering preserves that order.

## Report and Human Output

The stable JSON report has this envelope:

```json
{
  "source": "en",
  "languages": ["uk", "de"],
  "findings": [],
  "summary": {
    "total": 0,
    "bySeverity": {"error": 0, "warning": 0, "info": 0},
    "byProblem": {
      "missing": 0,
      "extra": 0,
      "empty": 0,
      "same": 0,
      "placeholder": 0
    }
  },
  "failOn": "error",
  "exitCode": 0
}
```

`languages` contains the selected target languages even when filtering leaves
one of them with no findings. `findings` and every summary counter describe the
same filtered set. JSON output contains no ANSI sequences and does not depend on
TTY state.

Human output uses a compact table with severity, problem, language, key, and a
short detail column, followed by the same total and severity/problem counts. A
clean filtered report prints an explicit no-problems message and zero summary.
Color is presentation-only and does not affect structured values.

## Exit Codes

`--fail-on error` exits 1 when at least one filtered error exists.
`--fail-on warning` exits 1 when at least one filtered warning or error exists.
`--fail-on never` always exits 0 after a valid analysis. Findings of lower
severity never trigger failure. The chosen exit code is included in JSON and is
applied only after the complete report has been emitted.

Usage, configuration, and dictionary validation failures exit 2. They are
distinct from translation findings and are not affected by `--fail-on never`.

## Documentation and Verification

README and generated CLI help document problem definitions, severities, pattern
syntax, repeatable-filter behavior, stable JSON, and CI exit semantics.

Manual verification covers:

- `npm run build` and `npm run lint`;
- `ctv status --help`;
- all five finding types and their severities;
- `--language`, `--problem`, edge-wildcard include/exclude, and rejected middle
  wildcard patterns;
- summary equality with the filtered findings;
- stable ANSI-free JSON;
- `error`, `warning`, and `never` exit thresholds;
- malformed input producing exit 2;
- filesystem state remaining unchanged and no engine calls being made.
