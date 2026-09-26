#!/usr/bin/env node

import * as path from 'path';
import * as fs from 'fs';
import { startServer } from './server.js';
import { getVersion } from './version.js';
import { parseCliArgs } from './cli-args.js';
import { TOOL_DEFINITIONS } from './tools/index.js';

/**
 * CLI entry point for the TypeScript Language MCP server.
 *
 * Usage:
 *   ts-language-mcp [project-root]
 *
 * If no project root is provided, uses current working directory.
 */
async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));

  if (!parsed.ok) {
    console.error(parsed.error);
    process.exit(1);
  }

  if (parsed.mode === 'help') {
    printHelp();
    return;
  }

  if (parsed.mode === 'version') {
    console.log(`ts-language-mcp v${getVersion()}`);
    return;
  }

  const resolvedRoot = path.resolve(parsed.projectRoot);

  // Validate that the project root exists
  if (!fs.existsSync(resolvedRoot)) {
    console.error(
      `Project root does not exist: "${resolvedRoot}" ` +
      `(resolved from "${parsed.projectRoot}")`
    );
    process.exit(1);
  }

  try {
    await startServer(resolvedRoot, parsed.options);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
ts-language-mcp - TypeScript Language Server for AI Agents via MCP

USAGE:
  ts-language-mcp [OPTIONS] [PROJECT_ROOT]

ARGUMENTS:
  PROJECT_ROOT          Path to TypeScript project (default: current directory)

OPTIONS:
  -h, --help            Show this help message
  -v, --version         Show version number
  --name <name>         Custom server name (default: ts-language-mcp)
  --description <text>  Server description

EXAMPLES:
  ts-language-mcp                     # Use current directory
  ts-language-mcp ./my-project        # Use specific project
  ts-language-mcp /absolute/path      # Use absolute path

MCP TOOLS:
  ${TOOL_DEFINITIONS.length} tools across navigation, type intelligence, code structure,
  semantic search, diagnostics, refactoring and code quality.
  Names: ${TOOL_DEFINITIONS.map((t) => t.name).join(', ')}

  See https://github.com/jgauffin/ts-language-mcp#tools for details.

MCP RESOURCES:
  typescript://project/files    List project files
  typescript://project/config   Compiler options
  typescript://file/{path}      File content
`);
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
