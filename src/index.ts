#!/usr/bin/env node

import * as path from 'path';
import { startServer } from './server.js';

/**
 * CLI entry point for the TypeScript Language MCP server.
 *
 * Usage:
 *   ts-language-mcp [project-root]
 *
 * If no project root is provided, uses current working directory.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Simple argument parsing
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log('ts-language-mcp v1.0.0');
    process.exit(0);
  }

  // First non-flag argument is the project root
  const projectRoot = args.find((arg) => !arg.startsWith('-')) ?? process.cwd();
  const resolvedRoot = path.resolve(projectRoot);

  try {
    await startServer(resolvedRoot);
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
  PROJECT_ROOT    Path to TypeScript project (default: current directory)

OPTIONS:
  -h, --help      Show this help message
  -v, --version   Show version number

EXAMPLES:
  ts-language-mcp                     # Use current directory
  ts-language-mcp ./my-project        # Use specific project
  ts-language-mcp /absolute/path      # Use absolute path

MCP TOOLS:
  get_hover           Type info at position
  get_definition      Jump to definition
  get_references      Find all usages
  get_diagnostics     Get errors/warnings
  get_symbols         List file symbols
  get_completions     Code completions
  get_signature       Function signature help
  analyze_position    Combined analysis
  find                AST-based search

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
