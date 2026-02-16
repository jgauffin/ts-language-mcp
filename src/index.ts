#!/usr/bin/env node

import * as path from 'path';
import * as fs from 'fs';
import { startServer, ServerOptions } from './server.js';

/** Flags that take a value argument. */
const VALUE_FLAGS = new Set(['--name', '--description']);

/** All recognised flags (including boolean ones). */
const KNOWN_FLAGS = new Set([
  ...VALUE_FLAGS,
  '--help', '-h',
  '--version', '-v',
]);

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

  // Validate that every flag-like argument is recognised
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('-') && !KNOWN_FLAGS.has(arg)) {
      console.error(
        `Unknown option: "${arg}". ` +
        `Valid options: ${[...KNOWN_FLAGS].join(', ')}`
      );
      process.exit(1);
    }
    // Skip the value that follows a value-flag
    if (VALUE_FLAGS.has(arg)) {
      i++;
    }
  }

  // Parse named options
  const options: ServerOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && i + 1 < args.length) {
      options.name = args[++i];
    } else if (args[i] === '--description' && i + 1 < args.length) {
      options.description = args[++i];
    }
  }

  // First non-flag argument is the project root
  const projectRoot = args.find((arg, idx) => {
    if (arg.startsWith('-')) return false;
    // Skip values that follow a value-flag
    const prev = args[idx - 1];
    if (prev && VALUE_FLAGS.has(prev)) return false;
    return true;
  }) ?? process.cwd();
  const resolvedRoot = path.resolve(projectRoot);

  // Validate that the project root exists
  if (!fs.existsSync(resolvedRoot)) {
    console.error(
      `Project root does not exist: "${resolvedRoot}" ` +
      `(resolved from "${projectRoot}")`
    );
    process.exit(1);
  }

  try {
    await startServer(resolvedRoot, options);
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
