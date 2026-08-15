# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-08-15

A release focused on agent accuracy: removing the places where the server
returned a confident answer to a question the caller did not ask, and removing
the places where an agent had to guess.

Major version because several tool result shapes changed and two tools that
previously only pretended to change files now really do. See Breaking below.

### Breaking

- `get_definition` now returns `definitions` (all declarations) and `count`
  alongside the existing `definition` field. Overloads, merged declarations and
  `declare` plus implementation pairs previously collapsed to the first hit.
- `format_document` no longer returns the formatted file content by default. It
  writes to disk instead; pass `includeContent: true` to get the text back. The
  result gained a `file` field.
- `get_diagnostics` now returns `{ diagnostics, total, returned, truncated }`
  rather than a bare `{ diagnostics }`. It previously capped at 50 silently.
- `get_references`, `find` and `get_symbols` now return paged results with
  `total`, `returned`, `offset` and `truncated`.
- `resources/list` no longer enumerates every project file. Single files remain
  addressable through the `typescript://file/{path}` template.
- Tool failures now set `isError: true`. Clients that treated every response as
  a success will start seeing errors reported as errors.
- `rename_symbol` and `format_document` now modify files on disk. They
  previously reported success for changes that never left memory.
- Removed the unused exports `SYMBOL_KIND_TO_SYNTAX`, `BatchAnalyzeParams`,
  `FileSpan` and `pathsEqual`, the never-populated `CompletionItem.documentation`
  field, and the never-emitted `implementation` member of `ReferenceKind`.

### Added

- **Address symbols by name.** Every position-based tool accepts
  `symbol: "UserService.getUser"` in place of `line` and `column`, including each
  entry in `batch_analyze`. An ambiguous name returns an error listing the
  candidates instead of silently choosing one.
- **`get_code_fixes`** and **`apply_code_fix`**: the fixes TypeScript itself
  proposes for an error, such as adding a missing import with the correct module
  path. `applyToAll` fixes every occurrence in a file.
- **`organize_imports`**: sorts imports and drops unused ones. Previews by
  default, writes with `apply: true`.
- **`get_type_definition`**: jumps to a symbol's type rather than to the symbol.
- **`get_module_dependencies`**: what a file imports and what imports it,
  resolved through the compiler so tsconfig `paths` aliases and package entry
  points work. Covers static imports, re-exports, dynamic `import()` and
  `require()`, and reports efferent/afferent coupling and instability.
- Navigation results carry the source line they point at, so finding something
  no longer requires a follow-up file read. Applies to references, definitions,
  implementations, rename locations, call and type hierarchies, and workspace
  symbols. `get_references` also takes `contextLines` for surrounding lines.
- `includeSuggestions` on both diagnostics tools, surfacing unused locals and
  unused imports.
- `get_all_diagnostics` now reports tsconfig problems under `config`, which
  previously only reached stderr at startup, and lists any unanalyzable files
  under `skippedFiles` rather than dropping them.
- `rename_preview` reports the `prefixText`/`suffixText` a location needs, so
  edits applied by hand stay correct.
- `.mts`, `.cts`, `.mjs` and `.cjs` files are now indexed.
- `docs/refactoring-tools.md`.

### Fixed

- **The server no longer breaks on projects whose tsconfig excludes JavaScript.**
  `refreshChangedFiles` re-walked the whole project root and pulled in files the
  tsconfig excluded. Those files became compiler roots it could not produce
  source files for, so `get_all_diagnostics`, `find_indirection_hotspots` and
  `get_diagnostics` on a `.js` file failed for the entire project. The file set
  is now re-resolved from tsconfig on every refresh.
- **Renames no longer corrupt shorthand properties and aliased imports.** The
  rename request asked TypeScript not to supply prefix/suffix text, so
  `{ timeout }` was rewritten as `{ timeoutMs }`, silently changing an object's
  key, instead of `{ timeout: timeoutMs }`.
- **`get_type_hierarchy` no longer reports fabricated file paths.** Subtype
  lookup parsed every file under the literal name `temp.ts` and reported paths
  derived from it. It also matched heritage clauses by name text, so an
  unrelated type sharing a name was reported as a subtype, and it converted
  supertype positions using the wrong file's line map.
- **The YAML serializer no longer corrupts values.** Strings such as `"true"`,
  `"null"` and `"123"` were emitted unquoted and parsed back as a boolean, null
  or number, reachable through `find` on string literals. Nested arrays were
  emitted as malformed YAML, which affected `find_indirection_hotspots`'s
  `worstChains`, its primary payload.
- **Out-of-range positions are an error rather than a clamp.** A line past the
  end of a file silently resolved to offset 0 and returned an analysis of the
  file's first character.
- `get_references` now emits the `definition` kind its description always
  promised; the underlying API it used carried no such flag.
- `get_workspace_symbols` positions now point at the symbol's name rather than
  the start of its declaration, making them usable as input to position tools.
- A single unanalyzable file no longer aborts `get_all_diagnostics` or
  `find_indirection_hotspots`.
- The `find` tool's `path` argument is validated; a typo previously returned no
  matches, which reads as "this symbol does not exist".
- `quality_report` now reports the most-coupled files it already computed and
  then discarded.
- Coupling analysis resolves modules through the compiler, so projects using
  tsconfig `paths` aliases get correct numbers.
- `--version` and the MCP handshake report the real package version, which had
  drifted to `1.0.0` while the package was at `1.2.0`.
- `--help` no longer advertises a stale subset of the tools.

### Changed

- `src/tools.ts` was split into `src/tools/` modules grouped by domain, with a
  registry replacing the hand-maintained dispatch switch.
- Removed `src/package.json`, a stale duplicate of the root manifest.
- `detect_duplication` no longer claims to find near-duplicates. It matches
  exact structure ignoring identifiers and literals, so renamed copies are found
  but a copy with an extra statement is not.
- README corrected: the server does not watch the filesystem, it re-checks
  changed files on request.

## [1.2.0] - 2026-04-13

Released to npm but never tagged in git, so the link below spans commits rather
than tags.

### Added

- ESLint diagnostics merged into `get_diagnostics` and `get_all_diagnostics`,
  loaded from the target project when available.
- Code quality tools: `calculate_metrics`, `detect_duplication`,
  `find_indirection_hotspots` and `quality_report`.

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

[Unreleased]: https://github.com/jgauffin/ts-language-mcp/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/jgauffin/ts-language-mcp/compare/6ac6ec7...v2.0.0
[1.2.0]: https://github.com/jgauffin/ts-language-mcp/compare/v1.1.0...6ac6ec7
[1.1.0]: https://github.com/jgauffin/ts-language-mcp/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/jgauffin/ts-language-mcp/releases/tag/v1.0.1
[1.0.0]: https://github.com/jgauffin/ts-language-mcp/releases/tag/v1.0.0
