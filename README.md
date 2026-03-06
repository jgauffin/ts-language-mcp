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
| Read entire file to find a function | Jump directly to definition |
| Grep for usage patterns | Get all references with read/write classification |
| Guess at types from context | Get exact types with full generic resolution |
| Hope renames don't break things | Preview and execute renames across files |

Unlike LSP-based alternatives, ts-language-mcp uses the TypeScript compiler API directly — zero config, deeper intelligence (AST search, batch analysis, executable renames, project-wide diagnostics), and no external LSP server required.

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

The target project needs a `tsconfig.json` and TypeScript source files. The server auto-loads compiler options and watches for file changes.

### Resources

- `typescript://project/files` - List all indexed project files
- `typescript://project/config` - Current compiler options
- `typescript://file/{path}` - Read file content

## Tools

| Category | Tool | Description |
|----------|------|-------------|
| **[Navigation](docs/navigation-tools.md)** | `get_definition` | Jump from usage to declaration |
| | `get_references` | Find all usages with read/write classification |
| | `get_implementations` | Find concrete implementations of interfaces |
| | `get_call_hierarchy` | Trace function callers / callees |
| | `get_type_hierarchy` | Navigate inheritance chains |
| **Type Intelligence** | `get_hover` | Type info and JSDoc at a position |
| | `get_signature` | Function parameter help |
| **Code Structure** | `get_symbols` | Flat list of symbols in a file |
| | `get_outline` | Hierarchical file structure |
| | `get_imports` | List all imports with details |
| **Semantic Search** | `find` | AST search by name pattern, kind, scope |
| | `get_workspace_symbols` | Fast fuzzy symbol search |
| **Diagnostics** | `get_diagnostics` | Errors/warnings for a file |
| | `get_all_diagnostics` | Project-wide diagnostics |
| | `get_completions` | Context-aware completions |
| **Refactoring** | `rename_preview` | Preview rename impact |
| | `rename_symbol` | Execute rename across project |
| | `format_document` | Format with built-in formatter |
| **Efficiency** | `analyze_position` | Combined analysis in one call |
| | `batch_analyze` | Analyze multiple positions at once |

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
  ast-finder.ts         # AST traversal for semantic search
  tools.ts              # MCP tool definitions and handlers
  resources.ts          # MCP resource definitions
  types.ts              # Shared type definitions
```

## License

MIT
