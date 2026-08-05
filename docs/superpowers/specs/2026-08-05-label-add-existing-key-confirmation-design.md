# Existing-Key Confirmation for `label:add`

## Goal

Prevent `ctv label:add` from silently updating a translation key that already
exists. Interactive users must explicitly confirm the operation, with `No` as
the default. Non-interactive use must fail without network calls or file
changes when confirmation would be required.

## Existing-Key Detection

After resolving the requested label and `fromLangCode`, `label:add` loads its
normal project snapshot and inspects the exact key in every configured
dictionary.

- A string leaf at the exact key in any configured language means that the key
  already exists and requires confirmation.
- A missing exact key does not require confirmation, even if unrelated sibling
  keys exist.
- An incompatible object/string shape remains a structural path conflict. It is
  an error and cannot be accepted through the overwrite confirmation.

## Interactive Behavior

When the exact key exists and stdin and stdout are TTYs, the command prompts:

```text
Key "title.data" already exists. Overwrite it?
```

The prompt defaults to `No`.

- `No`, including accepting the default, cancels the operation successfully.
  The command does not ask for replacement text, call a translation engine,
  write translation cache entries, or change project files.
- `Yes` continues through the current `label:add` planning, translation, and
  atomic execution pipeline.

The confirmation happens before an absent `--translation` value is prompted
for, so a rejected overwrite does not ask the user for unused replacement
text.

## Non-Interactive Behavior

When the exact key exists and either stdin or stdout is not a TTY, the command
fails with exit code 2 and a message explaining that overwriting the existing
key requires interactive confirmation. This applies to `--silent`, CI, piped
input, and other non-interactive execution. No bypass or force flag is added in
this change.

The failure occurs before translation-engine calls, cache writes, or project
file writes.

## Language Semantics

Confirmation is only a safety gate. Accepting it does not change the current
meaning of `fromLangCode` or `langCodeDefault`:

- the entered source text replaces the exact key in `fromLangCode`;
- existing string values in other language dictionaries are preserved;
- missing values in other languages are translated when automatic translation
  is enabled;
- missing values receive an empty string with `--noAutoTranslate`;
- generated types continue to be built from the final `langCodeDefault`
  dictionary.

The same pipeline is used whether `fromLangCode` equals `langCodeDefault` or
differs from it. The confirmation must not introduce a special translation or
write path for either case.

## Architecture and Data Flow

1. Parse flags and resolve configuration, label, and source language.
2. Load the `LabelAddRepository` snapshot before prompting for source text.
3. Inspect the exact key in every snapshot dictionary and retain the same
   snapshot for planning and execution.
4. If the key exists, enforce the interactive/non-interactive behavior above.
5. If accepted or if the key is absent, resolve the source text.
6. Create the existing `LabelAddPlanner` plan, execute required translations,
   and apply the plan atomically through `LabelAddExecutor`.

Existing-key detection should be a small pure helper or planner operation so
its definition can be unit-tested independently. The command remains
responsible for TTY detection and prompting.

## Error Handling and Atomicity

- Snapshot-loading and structural errors remain exit-code-2 command errors.
- Declining an interactive overwrite is cancellation, not failure, and exits
  successfully without printing `Done!`.
- A required confirmation in non-interactive mode is an exit-code-2 error.
- Provider, batch, placeholder, cache, precondition, and transactional behavior
  after acceptance remains unchanged.
- The loaded snapshot is reused after confirmation, so existing byte
  preconditions continue to reject concurrent file edits before commit.

## Testing

Unit and end-to-end tests will cover:

- exact-key detection across every configured language;
- no confirmation for a genuinely missing key;
- interactive acceptance followed by the existing add pipeline;
- interactive default rejection with no source-text prompt, provider request,
  cache write, dictionary write, or generated-type write;
- non-interactive existing-key failure with exit code 2 and no side effects;
- accepted overwrite when `fromLangCode === langCodeDefault`;
- accepted overwrite when `fromLangCode !== langCodeDefault`;
- preservation of existing non-source values and translation or empty-string
  creation only for missing targets;
- structural path conflicts remaining non-confirmable errors.

## Out of Scope

- Changing `fromLangCode`, `langCodeDefault`, translation, or synchronization
  semantics.
- Retranslating existing non-source values.
- Adding `--force`, `--overwrite`, JSON, or dry-run behavior to `label:add`.
- Changing the prompts or overwrite policies of other label commands.
