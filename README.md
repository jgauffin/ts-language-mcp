# ts-language-mcp

[![npm version](https://img.shields.io/npm/v/ts-language-mcp.svg)](https://www.npmjs.com/package/ts-language-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub issues](https://img.shields.io/github/issues/jgauffin/ts-language-mcp)](https://github.com/jgauffin/ts-language-mcp/issues)
[![GitHub stars](https://img.shields.io/github/stars/jgauffin/ts-language-mcp)](https://github.com/jgauffin/ts-language-mcp/stargazers)

A TypeScript code intelligence server for AI coding agents via MCP (Model Context Protocol).

## Why Use This?

AI coding agents working with TypeScript treat code as text — reading entire files, grepping for patterns, guessing at types. **ts-language-mcp** exposes TypeScript's own compiler intelligence through MCP tools:

| Raw File Access | ts-language-mcp |
|-----------------|-----------------|
| Read entire file to find a function | Ask for it by name, no coordinates needed |
| Grep for usage patterns | Get all references with read/write classification and their source lines |
| Guess at types from context | Get exact types with full generic resolution |
| Hope renames don't break things | Preview and execute renames across files |
| Hand-write the fix for a compiler error | Apply the compiler's own quick fix |

Unlike LSP-based alternatives, ts-language-mcp uses the TypeScript compiler API directly — zero config, deeper intelligence (AST search, batch analysis, executable renames, project-wide diagnostics), and no external LSP server required.

### Built for agents, not editors

- **Address symbols by name.** Every position-based tool accepts `symbol: "UserService.getUser"` instead of a line and column. An ambiguous name returns the candidates rather than silently picking one, and an out-of-range coordinate is an error rather than a quiet answer about the wrong code.
- **Results carry their source line.** References, definitions, implementations and hierarchy results include the code they point at, so there is no follow-up file read just to see what was found.
- **Fixes come from the compiler.** `get_code_fixes` and `organize_imports` surface TypeScript's own edits, including the correct import path, instead of leaving an agent to guess one.
- **Large results say they are large.** Tools that can return unbounded lists report `total`, `returned` and `truncated` rather than quietly cutting off.

## Quick Start

```bash
# Analyze current directory
npx ts-language-mcp

# Analyze specific project
npx ts-language-mcp /path/to/typescript/project

# Custom server name
npx ts-language-mcp --name my-ts-server /path/to/project
```

### MCP Client Configuration

**Claude Code:**

```bash
claude mcp add typescript -- npx ts-language-mcp /path/to/your/project
```

**Claude Desktop, Cline, etc.:**

```json
{
  "mcpServers": {
    "typescript": {
      "command": "npx",
      "args": ["ts-language-mcp", "/path/to/your/project"]
    }
  }
}
```

The target project needs a `tsconfig.json` and TypeScript source files. The server auto-loads compiler options, honours `include`/`exclude`, and re-checks changed files on each request (throttled; there is no filesystem watcher).

### Resources

- `typescript://project/files` - List all indexed project files
- `typescript://project/config` - Current compiler options
- `typescript://file/{path}` - Read a single file's content

## Tools

Tools marked **by name** accept `symbol` in place of `line`/`column`.

| Category | Tool | Description |
|----------|------|-------------|
| **[Navigation](docs/navigation-tools.md)** | `get_definition` | Jump from usage to declaration (**by name**, returns all declarations) |
| | `get_type_definition` | Jump to a symbol's *type* rather than the symbol (**by name**) |
| | `get_references` | Find all usages with read/write classification (**by name**, paged) |
| | `get_implementations` | Find concrete implementations of interfaces (**by name**) |
| | `get_call_hierarchy` | Trace function callers / callees (**by name**) |
| | `get_type_hierarchy` | Navigate inheritance chains (**by name**) |
| **Type Intelligence** | `get_hover` | Type info and JSDoc (**by name**) |
| | `get_signature` | Function parameter help (**by name**) |
| **Code Structure** | `get_symbols` | Flat list of symbols in a file (paged) |
| | `get_outline` | Hierarchical file structure |
| | `get_imports` | List all imports with details |
| **Semantic Search** | `find` | AST search by name pattern, kind, scope (paged) |
| | `get_workspace_symbols` | Fast fuzzy symbol search |
| **Diagnostics** | `get_diagnostics` | Errors/warnings for a file, TypeScript + ESLint |
| | `get_all_diagnostics` | Project-wide diagnostics, including tsconfig errors |
| | `get_completions` | Context-aware completions |
| **[Refactoring](docs/refactoring-tools.md)** | `get_code_fixes` | The compiler's own fixes for an error (**by name**) |
| | `apply_code_fix` | Apply a fix and write it to disk (**by name**) |
| | `organize_imports` | Sort imports and drop unused ones |
| | `rename_preview` | Preview rename impact (**by name**) |
| | `rename_symbol` | Execute rename across project, written to disk (**by name**) |
| | `format_document` | Format with built-in formatter, written to disk |
| **Code Quality** | `calculate_metrics` | Cyclomatic complexity and LOC per function/file |
| | `detect_duplication` | Structurally duplicated code blocks |
| | `find_indirection_hotspots` | Symbols reached through deep call chains |
| | `get_module_dependencies` | What a file imports and what imports it |
| | `quality_report` | Top offenders across all quality categories |
| **Efficiency** | `analyze_position` | Combined analysis in one call (**by name**) |
| | `batch_analyze` | Analyze multiple positions at once (**by name**) |

### Writes to disk

`rename_symbol`, `format_document`, `apply_code_fix` and `organize_imports` (with `apply: true`) modify files on disk. Everything else is read-only; `rename_preview` and `organize_imports` without `apply` show the edits without making them.

## Development

```bash
npm test          # Run tests (watch)
npm run test:run  # Run tests once
npm run build     # Build
npm run dev       # Watch mode
```

## Architecture

```
src/
  index.ts              # CLI entry point
  server.ts             # MCP server setup
  language-service.ts   # TypeScript Language Service wrapper
  file-manager.ts       # In-memory file cache, tsconfig-scoped refresh
  symbol-resolver.ts    # Resolves symbol names to file positions
  ast-finder.ts         # AST traversal for semantic search
  position-utils.ts     # Line/column to offset conversion
  paths.ts              # Cross-platform path normalization
  yaml.ts               # Token-efficient result serializer
  version.ts            # Package version, read from package.json
  types.ts              # Shared type definitions
  resources.ts          # MCP resource definitions
  tools/
    index.ts            # Tool registry, request queue, path validation
    schemas.ts          # Shared JSON Schema fragments
    paginate.ts         # limit/offset with truncation reporting
    navigation.ts       # definitions, references, hierarchies
    intelligence.ts     # hover, signatures, completions, batch analysis
    structure.ts        # symbols, outline, imports, search
    diagnostics.ts      # TypeScript + ESLint diagnostics
    refactoring.ts      # renames, formatting, code fixes
    quality.ts          # complexity, duplication, coupling, dependencies
  analyzers/
    complexity-analyzer.ts, coupling-analyzer.ts,
    duplication-detector.ts, indirection-analyzer.ts
```

## License

MIT
