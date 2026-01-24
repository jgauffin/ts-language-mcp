# ts-language-mcp

[![npm version](https://img.shields.io/npm/v/ts-language-mcp.svg)](https://www.npmjs.com/package/ts-language-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub issues](https://img.shields.io/github/issues/jgauffin/ts-language-mcp)](https://github.com/jgauffin/ts-language-mcp/issues)
[![GitHub stars](https://img.shields.io/github/stars/jgauffin/ts-language-mcp)](https://github.com/jgauffin/ts-language-mcp/stargazers)

A TypeScript code intelligence server for AI coding agents via MCP (Model Context Protocol).

## Why Use This?

AI coding agents working with TypeScript projects face a fundamental challenge: **raw file access is inefficient and error-prone**. Reading files line by line, grepping for patterns, or parsing code with regex leads to:

- **Context overload** - Agents must read entire files to find relevant code
- **Missed connections** - No understanding of how symbols relate across files
- **Type blindness** - Cannot see inferred types, generics resolution, or type narrowing
- **Fragile refactoring** - Text-based find/replace breaks when code structure varies

**ts-language-mcp** solves this by exposing TypeScript's own compiler intelligence through MCP tools. Instead of treating code as text, your agent gets:

| Raw File Access | ts-language-mcp |
|-----------------|-----------------|
| Read entire file to find a function | Jump directly to definition |
| Grep for usage patterns | Get all references with read/write classification |
| Guess at types from context | Get exact types with full generic resolution |
| Manual AST parsing | Semantic search by symbol kind and scope |
| Hope renames don't break things | Preview and execute renames across files |
| Run formatter separately | Built-in code formatting |
| Check files one by one | Get all project diagnostics at once |

### Comparison with Similar Tools

| Feature | ts-language-mcp | [@mizchi/lsmcp](https://github.com/mizchi/lsmcp) | [lsp-mcp](https://github.com/jonrad/lsp-mcp) |
|---------|-----------------|--------------------------------------------------|----------------------------------------------|
| TypeScript-native | Yes (direct TS API) | Via LSP | Via LSP |
| Setup complexity | Zero config | Requires LSP server install | Requires LSP server |
| AST search (find) | Built-in with patterns | Limited | No |
| Call hierarchy | Yes | Yes | Depends on LSP |
| Type hierarchy | Yes | No | Depends on LSP |
| Batch analysis | Yes | No | No |
| String/comment search | Yes | No | No |
| Execute renames | Yes | No | No |
| Project-wide diagnostics | Yes | No | No |
| Code formatting | Yes | No | Depends on LSP |
| Multi-language | TypeScript/JavaScript only | Multiple via presets | Any LSP |

**When to use ts-language-mcp:** You're building agents that work primarily with TypeScript/JavaScript and want deep, zero-config integration with full compiler intelligence.

**When to use lsmcp/lsp-mcp:** You need multi-language support or want to leverage existing LSP servers.

## API Reference

### Navigation Tools

#### `get_definition`
**Jump from usage to declaration.** When your agent sees a function call or type reference, this finds where it's defined.

```json
{ "file": "src/handlers.ts", "line": 28, "column": 25 }
```
Returns: `{ "file": "src/services/user-service.ts", "line": 55, "column": 9 }`

*Agent use case: Understanding unfamiliar code by tracing imports and dependencies.*

#### `get_references`
**Find all usages of a symbol across the project.** Each reference is classified as `definition`, `read`, or `write`.

```json
{ "file": "src/types.ts", "line": 5, "column": 13 }
```
Returns locations with kind: helps agents understand data flow and impact of changes.

*Agent use case: Before modifying a function, check all callers to ensure compatibility.*

#### `get_implementations`
**Find concrete implementations of interfaces or abstract methods.**

```json
{ "file": "src/services.ts", "line": 4, "column": 18 }
```
Returns all classes that implement the interface.

*Agent use case: Understanding polymorphic code - "which classes actually implement this interface?"*

### Type Intelligence

#### `get_hover`
**Get type information and documentation at a position.** Returns the same rich info you'd see hovering in VS Code.

```json
{ "file": "src/utils.ts", "line": 10, "column": 5 }
```
Returns: Full type signature, JSDoc comments, inferred types.

*Agent use case: Understanding what a variable actually is, especially with complex generics or inference.*

#### `get_signature`
**Get function signature help when inside a call's parentheses.** Shows parameter names, types, and which parameter is active.

```json
{ "file": "src/app.ts", "line": 42, "column": 28 }
```
Returns: Parameter list with active parameter highlighted.

*Agent use case: Correctly completing function calls with the right argument types.*

#### `get_type_hierarchy`
**Navigate class/interface inheritance.** Direction `supertypes` shows parents; `subtypes` shows implementations.

```json
{ "file": "src/models.ts", "line": 15, "column": 14, "direction": "supertypes" }
```

*Agent use case: Understanding inheritance chains and finding base class methods.*

### Code Structure

#### `get_symbols`
**List all symbols in a file as a flat list.** Quick overview of what's defined.

```json
{ "file": "src/services/user-service.ts" }
```
Returns: All functions, classes, interfaces, etc. with positions.

*Agent use case: Getting a quick inventory of a file's exports.*

#### `get_outline`
**Get hierarchical structure of a file.** Returns nested symbols with their ranges - classes contain methods, etc.

```json
{ "file": "src/services/user-service.ts" }
```
Returns: Tree structure with children, start/end positions.

*Agent use case: Understanding code organization and finding class members.*

#### `get_imports`
**List all imports with full details.** Shows named imports, defaults, namespaces, and type-only imports.

```json
{ "file": "src/handlers.ts" }
```
Returns: Module specifiers, import bindings, line numbers.

*Agent use case: Understanding dependencies before adding new imports.*

### Semantic Search

#### `find`
**AST-based search by name pattern and symbol kind.** Far more precise than grep.

```json
{
  "query": "*Service",
  "kinds": ["interface", "class"],
  "scope": "project",
  "exported": true
}
```

**Parameters:**
- `query` - Glob pattern (`*Service`), regex (`/^get/`), or substring match
- `kinds` - Filter by: `function`, `class`, `interface`, `type`, `enum`, `variable`, `const`, `property`, `method`, `parameter`, `import`, `export`, `string`, `comment`
- `scope` - `project`, `file`, or `directory`
- `path` - Required when scope is `file` or `directory`
- `exported` - Filter to only exported (or non-exported) symbols

*Agent use case: "Find all exported interfaces ending in Service" - precise semantic queries impossible with text search.*

#### `get_workspace_symbols`
**Fast symbol search across the workspace by name.** Uses TypeScript's navigateToItems API for quick fuzzy matching.

```json
{ "query": "User", "maxResults": 50 }
```
Returns: Matching symbols with file, position, and container info.

*Agent use case: Quickly finding symbols by name without full AST traversal - faster than `find` for simple lookups.*

### Diagnostics & Completions

#### `get_diagnostics`
**Get TypeScript compiler errors and warnings for a file.**

```json
{ "file": "src/broken.ts" }
```
Returns: Errors with messages, codes, severity, and positions.

*Agent use case: Checking if generated code compiles, finding issues to fix.*

#### `get_all_diagnostics`
**Get diagnostics for all files in the project.** Useful for checking project health after changes.

```json
{ "severity": "error" }
```
Returns: Diagnostics grouped by file with summary counts.

*Agent use case: Verifying entire project compiles after refactoring, finding all type errors at once.*

#### `get_completions`
**Get context-aware code completion suggestions.**

```json
{ "file": "src/app.ts", "line": 25, "column": 10 }
```
Returns: Valid completions at that position with kinds and documentation.

*Agent use case: Discovering available methods, properties, or imports.*

### Refactoring Support

#### `rename_preview`
**Preview all locations that would change when renaming a symbol.** Does not modify files.

```json
{ "file": "src/types.ts", "line": 5, "column": 13, "newName": "UserId" }
```
Returns: All files and positions that would be affected.

*Agent use case: Safe refactoring - see impact before committing to changes.*

#### `rename_symbol`
**Execute a rename operation across the project.** Applies changes to all files in memory.

```json
{ "file": "src/types.ts", "line": 5, "column": 13, "newName": "UserId" }
```
Returns: `{ "success": true, "filesModified": ["src/types.ts", "src/handlers.ts"], "totalChanges": 5 }`

*Agent use case: Completing the rename workflow after previewing changes.*

#### `get_call_hierarchy`
**Trace function calls up or down.** Direction `incoming` shows callers; `outgoing` shows callees.

```json
{ "file": "src/utils.ts", "line": 15, "column": 10, "direction": "incoming" }
```

*Agent use case: Understanding call chains - "what calls this function?" or "what does this function call?"*

#### `format_document`
**Format a TypeScript/JavaScript file using TypeScript's built-in formatter.**

```json
{ "file": "src/messy.ts", "options": { "indentSize": 4, "convertTabsToSpaces": true } }
```
Returns: `{ "formatted": true, "changeCount": 12, "content": "..." }`

*Agent use case: Ensuring consistent code style after generating or modifying code.*

### Efficiency Tools

#### `analyze_position`
**Combined analysis at a position.** Returns hover, definition, references, diagnostics, and signature in one call.

```json
{ "file": "src/app.ts", "line": 10, "column": 5 }
```

*Agent use case: Getting complete context about a symbol in a single round-trip.*

#### `batch_analyze`
**Analyze multiple positions at once.** Optionally select which analyses to include.

```json
{
  "positions": [
    { "file": "src/a.ts", "line": 5, "column": 10 },
    { "file": "src/b.ts", "line": 12, "column": 3 }
  ],
  "include": ["hover", "definition"]
}
```

*Agent use case: Gathering information about many symbols efficiently.*

## Quick Start

### Installation

```bash
npm install
npm run build
```

### Basic Usage

```bash
# Analyze current directory
npx ts-language-mcp

# Analyze specific project
npx ts-language-mcp /path/to/typescript/project
```

### MCP Client Configuration

Add to your MCP client (Claude Desktop, Cline, etc.):

```json
{
  "mcpServers": {
    "typescript": {
      "command": "node",
      "args": ["/path/to/ts-language-mcp/dist/index.js", "/path/to/your/project"]
    }
  }
}
```

### Project Requirements

The target project needs:
- A `tsconfig.json` file (the server reads compiler options from it)
- TypeScript source files

The server automatically:
- Loads `tsconfig.json` from the project root
- Indexes all files matching the tsconfig's `include` patterns
- Watches for file changes (when content is accessed)

### Resources

The server also exposes MCP resources:

- `typescript://project/files` - List all indexed project files
- `typescript://project/config` - Current compiler options
- `typescript://file/{path}` - Read file content

## Development

```bash
# Run tests
npm test

# Run tests once
npm run test:run

# Build
npm run build

# Watch mode
npm run dev
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
