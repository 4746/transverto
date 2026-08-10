# JetBrains Preset Design

## Goal

Add an interactive `ctv preset` command that installs selected Transverto run configurations into a consumer project's `.run` directory. The first supported preset is JetBrains IDEs. A generated preset must work immediately through the project's npm scripts and must not silently replace unrelated project configuration.

## Scope

Version 1 supports these JetBrains run configurations:

- `add`
- `delete`
- `doctor`
- `get`
- `rename`
- `status`
- `suggest`

The command is interactive only. Non-interactive provider, command-selection, or overwrite flags are outside this version's scope. Additional IDE providers are also outside scope, but the catalog must leave a clear extension point for them.

## User Experience

The user runs:

```shell
ctv preset
```

The command then:

1. Shows a `Preset` select prompt. Its only initial choice is `JetBrains`.
2. Shows a checkbox prompt containing all seven supported commands. Every command is checked by default, and the prompt requires at least one selection.
3. Validates the project and calculates the complete file change plan.
4. If one or more selected target XML files already exist, asks one confirmation question for all conflicts. The default answer is `Yes`.
5. Applies the approved plan atomically.
6. Prints how many run configurations were created, overwritten, or preserved, and whether the npm script was added or already present.

If the user declines overwrite confirmation, existing conflicting XML files are preserved while selected non-conflicting files are still created.

Prompt cancellation follows the existing Inquirer/Oclif cancellation behavior and does not write files.

## Package Script Behavior

JetBrains configurations invoke the project's `ctv` npm script, so the command manages the root `package.json` in the current working directory.

- A missing or malformed `package.json` is an error and produces no changes.
- If `scripts` is absent, it is created as an object.
- If `scripts` exists but is not an object, the command fails without changes.
- If `scripts.ctv` is absent, the command adds `"ctv": "ctv"`.
- If `scripts.ctv` is exactly `"ctv"`, it is preserved.
- If `scripts.ctv` has any other value, the command fails without changes. It never silently replaces an existing workflow.

When serialization is necessary, the writer preserves the existing property order, indentation style, and final newline convention as far as JSON parsing and serialization allow.

## Assets and Packaging

The canonical XML files live as static package assets:

```text
presets/
  jetbrains/
    tl_add.run.xml
    tl_delete.run.xml
    tl_doctor.run.xml
    tl_get.run.xml
    tl_rename.run.xml
    tl_status.run.xml
    tl_suggest.run.xml
```

Their contents are based on the supplied, working JetBrains configurations. The npm package's `files` allowlist includes `/presets`, so the CLI reads the same canonical XML in development and after installation. Static assets are preferred over runtime XML generation to keep the IDE configuration inspectable and byte-for-byte testable.

Command arguments in the assets use a consistent npm argument separator and the quoting required for JetBrains `$SelectedText$` substitution. Commands that consume selected editor text quote that macro; `doctor` and `status` do not include it.

## Components

### Preset command

`src/commands/preset.ts` owns the interactive flow only: provider selection, command selection, conflict confirmation, service invocation, and the final human-readable report. It does not contain XML strings or implement filesystem mutation details.

### Preset catalog

A shared catalog defines supported provider IDs, display names, command IDs, asset filenames, and target filenames. The command builds prompts from this catalog rather than duplicating the seven-item list. Unknown provider or command IDs are rejected rather than ignored.

### Preset planner

The planner receives the project root, provider, selected command IDs, and overwrite decision. It reads and validates `package.json`, resolves packaged assets, inspects `.run` targets, and returns:

- all intended file mutations;
- preconditions containing the observed original file states;
- lists of files to create, overwrite, or preserve;
- the package-script outcome (`added` or `preserved`).

Planning performs no writes. A `.run` path that exists but is not a directory, a target path that exists but is not a regular file, or a missing packaged asset is an error.

### Preset executor

The executor applies the planner's mutations through the existing atomic file-transaction utility. Preconditions prevent overwriting files that changed after planning. If a later mutation fails, earlier mutations are rolled back to their original bytes.

## Data Flow

```text
ctv preset
  -> select JetBrains
  -> select commands
  -> initial plan and conflict discovery
  -> optional single overwrite confirmation
  -> final plan
  -> atomic transaction (.run XML files + package.json when needed)
  -> summary
```

All validation that can fail is completed before the transaction begins. The `package.json` update and XML writes belong to the same transaction, so the project cannot be left with only half of the preset installed.

## Error Handling

Expected project errors use a clear message and CLI usage exit code `2`. Filesystem failures during application produce a runtime failure after rollback. Error messages identify the invalid or conflicting path where relevant.

The command makes no changes when:

- `package.json` is missing, malformed, or structurally invalid;
- an existing `scripts.ctv` differs from `ctv`;
- an asset is missing;
- `.run` or a selected target has an incompatible filesystem type;
- a file no longer matches its planning precondition.

Declining overwrite is not an error; it preserves conflicting targets and installs the remaining selection.

## Testing

Unit tests cover:

- catalog completeness and unique provider, command, asset, and target IDs;
- all `package.json` script cases;
- preservation of package formatting conventions;
- create, overwrite, and preserve planning;
- invalid directory and target types;
- missing assets and unknown catalog values;
- transaction preconditions and rollback behavior;
- exact expected contents of all seven static XML assets.

End-to-end coverage exercises the primary interactive flow in a temporary consumer project and verifies the resulting `.run` files and `package.json`. A conflict scenario verifies the single confirmation and the preserve-on-`No` behavior.

Release verification includes the normal build, full test suite, lint, and `npm pack --dry-run --json`, with an assertion or manual check that every `/presets/jetbrains` asset is present in the package.

## Success Criteria

- Running `ctv preset` can install any non-empty subset of the seven JetBrains configurations.
- Pressing Enter through both selection prompts installs the complete preset.
- The resulting run configurations call the local `ctv` npm script and support JetBrains selected-text substitution where applicable.
- Existing XML files are overwritten only after one default-Yes confirmation.
- Conflicting npm scripts are never replaced.
- Failures do not leave partial changes.
- All preset assets ship in the published npm package.
