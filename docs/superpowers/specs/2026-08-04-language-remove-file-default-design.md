# Delete language files by default

## Problem

`ctv language:remove CODE` currently removes the language from `.ctv.config.json` but preserves its translation JSON file unless the caller supplies `--delete-file`. Although the command prints `Preserved: ...`, this opt-in deletion contract is surprising for a command named `remove` and leaves an unconfigured dictionary behind.

The lower-level `LanguageProjectService.remove` method already supports both deleting and preserving the file through its `deleteFile` option. The mismatch is in the CLI defaults and help text, not in the service transaction.

## CLI contract

Language file deletion becomes the default while remaining guarded against accidental data loss:

| Invocation | Interactive behavior | Non-interactive behavior |
| --- | --- | --- |
| `language:remove es` | Ask for confirmation; delete only when accepted | Exit 2 without changing files or configuration |
| `language:remove es --force` | Delete without confirmation | Delete without confirmation |
| `language:remove es --keep-file` | Remove from configuration and preserve JSON without confirmation | Remove from configuration and preserve JSON |
| `language:remove es --delete-file` | Same deletion behavior as the new default | Requires `--force` |

`--delete-file` remains accepted as a backward-compatible alias so existing scripts continue to work. It is redundant under the new default and will be described accordingly. Supplying both `--keep-file` and `--delete-file` is invalid and must fail before any project mutation.

Removing the configured source language continues to require `--source LANG`. All existing service-level validation remains unchanged.

## Command flow

The command derives one boolean before prompting or loading the project:

```text
deleteFile = !keepFile
```

When `deleteFile` is true and `--force` is absent, the command requires an interactive terminal and asks the existing destructive confirmation question. Declining the prompt prints `No changes made.` and returns without loading or mutating the project.

The command then calls `LanguageProjectService.remove(code, {deleteFile, source})`. Output reports `Deleted:` when deletion was requested and `Preserved:` only for `--keep-file`.

The service retains responsibility for applying the configuration, generated-types, and optional file deletion in one atomic transaction.

## Help and compatibility

Help examples will lead with the new default command, show `--force` for automation, show `--keep-file` for the preservation case, and retain one compatibility example or description for `--delete-file`.

No configuration format or service API changes are required.

## Error handling

- Default deletion in a non-interactive process without `--force` exits 2 before any write.
- Conflicting `--keep-file --delete-file` flags exit 2 before any write.
- A missing or non-file language path continues to fail through `LanguageProjectService.remove` when deletion is requested.
- Preservation via `--keep-file` continues to allow the configured language to be removed even when its JSON file is absent, matching the existing service behavior.

## Tests

End-to-end tests will verify:

1. `language:remove es --force` removes `es` from configuration, deletes `es.json`, and regenerates the types file.
2. `language:remove es --keep-file` removes `es` from configuration but preserves `es.json` without requiring `--force`.
3. Default removal in the non-interactive test harness exits 2 and leaves configuration, dictionaries, and generated types byte-for-byte unchanged.
4. `language:remove es --delete-file --force` remains accepted and deletes the file.
5. `--keep-file --delete-file` is rejected without changing the project.
6. Removing the source language still requires a valid replacement source.

The targeted language-removal tests will run before the complete test, lint, and build verification.
