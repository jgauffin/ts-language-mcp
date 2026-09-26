# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.3.0] - 2026-09-01

### Fixed

- Branch switches are detected; answers no longer describe the branch you left.
- Compiler options changed by a branch are re-read, and the project rebuilt.
- A tsconfig added or deleted by a branch is picked up.
- A branch switch overrides the 2s refresh throttle.

### Added

- The working tree is watched, so a checkout is picked up while the server is idle.
- Results carry a `notice` when unsaved changes were replaced by content on disk.

### Notes

- Git files are read directly; no `git` binary needed. Projects without git are unaffected.
- Worktrees and submodules supported.

## [2.2.0] - 2026-08-31

### Fixed

- Each file is checked against the tsconfig that governs it, including nested ones such as `tests/tsconfig.json`.
- A file outside the root tsconfig is analysed instead of reported as missing.

### Added

- Results for a file no tsconfig covers carry a `warning` naming the nearest config.

### Notes

- Diagnostics TypeScript genuinely reports are unchanged; real config problems are not suppressed.
- Fixture directories (`fixtures`, `__fixtures__`, `testdata`, `__mocks__`) are skipped during config discovery.

## [2.1.0] - 2026-08-30

### Fixed

- Files are re-parsed after an edit. A path-casing mismatch made the cache report every file as unchanged, so results were stale from the first write and a second `rename_symbol` corrupted files while reporting success.

- **A missing argument is now reported as a missing argument.** Tool arguments
  were never checked against the schema the tool advertises, so `batch_analyze`
  without `positions` failed with `Cannot read properties of undefined (reading
  'map')`, position tools with neither coordinates nor a symbol failed with a
  Node path error, and `rename_symbol` without `newName` renamed the symbol to
  the literal text `undefined` in every file and reported success. Arguments are
  now validated before dispatch, naming the argument and the shape it accepts.

### Added

- `rename_symbol` verifies every span before writing; on failure nothing is written and `reason` explains why.
- `RenameResult.changes`, the per-file occurrence counts behind `totalChanges`.

## [2.0.0] - 2026-08-15

Major version: several tool result shapes changed, and two tools that previously
only pretended to write files now really do.

### Breaking

- `get_definition` returns `definitions` and `count` alongside `definition`; overloads no longer collapse to the first hit.
- `format_document` writes to disk and omits file content by default; pass `includeContent: true`. Gained a `file` field.
- `get_diagnostics` returns `{ diagnostics, total, returned, truncated }`; it previously capped at 50 silently.
- `get_references`, `find` and `get_symbols` return paged results with `total`, `returned`, `offset` and `truncated`.
- `resources/list` no longer enumerates every project file; use the `typescript://file/{path}` template.
- Tool failures set `isError: true`.
- `rename_symbol` and `format_document` modify files on disk.
- Removed unused exports `SYMBOL_KIND_TO_SYNTAX`, `BatchAnalyzeParams`, `FileSpan`, `pathsEqual`, `CompletionItem.documentation` and `ReferenceKind.implementation`.

### Added

- Address symbols by name: `symbol: "UserService.getUser"` in place of `line`/`column` on every position tool. Ambiguous names return the candidates.
- `get_code_fixes` and `apply_code_fix`, with `applyToAll`.
- `organize_imports`; previews by default, writes with `apply: true`.
- `get_type_definition`.
- `get_module_dependencies`, covering static imports, re-exports, dynamic `import()` and `require()`, plus coupling and instability.
- Navigation results carry the source line they point at. `get_references` takes `contextLines`.
- `includeSuggestions` on both diagnostics tools.
- `get_all_diagnostics` reports tsconfig problems under `config` and unanalyzable files under `skippedFiles`.
- `rename_preview` reports the `prefixText`/`suffixText` a location needs.
- `.mts`, `.cts`, `.mjs` and `.cjs` are indexed.
- `docs/refactoring-tools.md`.

### Fixed

- Projects whose tsconfig excludes JavaScript no longer break every program-backed tool.
- Renames no longer corrupt shorthand properties and aliased imports (`{ timeout }` became `{ timeoutMs }`).
- `get_type_hierarchy` no longer reports fabricated paths, matches unrelated same-named types, or misconverts supertype positions.
- The YAML serializer no longer emits `"true"`, `"null"` and `"123"` unquoted, nor malformed nested arrays.
- Out-of-range positions are an error rather than silently resolving to offset 0.
- `get_references` emits the `definition` kind its description promised.
- `get_workspace_symbols` positions point at the symbol's name, usable as input to position tools.
- One unanalyzable file no longer aborts `get_all_diagnostics` or `find_indirection_hotspots`.
- The `find` tool validates its `path` argument.
- `quality_report` reports the most-coupled files it already computed.
- Coupling analysis resolves modules through the compiler, so tsconfig `paths` aliases work.
- `--version` and the MCP handshake report the real package version.
- `--help` no longer advertises a stale subset of the tools.

### Changed

- `src/tools.ts` split into `src/tools/` modules with a registry replacing the dispatch switch.
- Removed `src/package.json`, a stale duplicate of the root manifest.
- `detect_duplication` matches exact structure ignoring identifiers and literals; it no longer claims to find near-duplicates.
- README corrected: the server re-checks changed files on request rather than watching.

## [1.2.0] - 2026-04-13

Released to npm but never tagged in git, so the link below spans commits rather
than tags.

### Added

- ESLint diagnostics merged into `get_diagnostics` and `get_all_diagnostics`.
- `calculate_metrics`, `detect_duplication`, `find_indirection_hotspots` and `quality_report`.

## [1.1.0] - 2026-02-16

### Added

- CLI options `--name` and `--description`.
- File change detection, so edits made outside the server are picked up.

### Changed

- Migrated to the `McpServer` API.

### Fixed

- Outline generation bug.

## [1.0.1] - 2026-01-24

### Added

- Package description and repository metadata.

## [1.0.0] - 2026-01-24

Initial release: TypeScript language intelligence exposed over MCP, covering
navigation, type information, code structure, semantic search, diagnostics,
renames and formatting.

[Unreleased]: https://github.com/jgauffin/ts-language-mcp/compare/v2.3.0...HEAD
[2.3.0]: https://github.com/jgauffin/ts-language-mcp/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/jgauffin/ts-language-mcp/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/jgauffin/ts-language-mcp/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/jgauffin/ts-language-mcp/compare/6ac6ec7...v2.0.0
[1.2.0]: https://github.com/jgauffin/ts-language-mcp/compare/v1.1.0...6ac6ec7
[1.1.0]: https://github.com/jgauffin/ts-language-mcp/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/jgauffin/ts-language-mcp/releases/tag/v1.0.1
[1.0.0]: https://github.com/jgauffin/ts-language-mcp/releases/tag/v1.0.0
