/**
 * JSON Schema fragments shared by MCP tool definitions.
 * These schemas enable AI agents to understand tool inputs.
 */

import { PAGINATION_PROPS } from './paginate.js';

/** Shared property definitions reused across schemas. */
export const FILE_PROP = {
  type: 'string',
  description: 'Path to the file (relative to project root)',
} as const;

export const LINE_PROP = { type: 'number', description: 'Line number (1-based)' } as const;
export const COLUMN_PROP = { type: 'number', description: 'Column number (1-based)' } as const;

export const SYMBOL_PROP = {
  type: 'string',
  description:
    'Name of the symbol to target, instead of line/column. Qualify as ' +
    '"Container.member" (e.g. "UserService.getUser") to disambiguate. ' +
    'Combine with "file" to restrict the search to one file. ' +
    'An ambiguous name returns an error listing the candidates.',
} as const;

/**
 * Position tools accept either explicit coordinates or a symbol name.
 * Naming a symbol spares the caller from reading the file to find its
 * coordinates, which is where most position errors come from.
 */
const POSITION_PROPS = {
  file: FILE_PROP,
  line: LINE_PROP,
  column: COLUMN_PROP,
  symbol: SYMBOL_PROP,
} as const;

const EITHER_POSITION_OR_SYMBOL = [
  { required: ['file', 'line', 'column'] },
  { required: ['symbol'] },
] as const;

/**
 * Appended to every tool that accepts a position, so the symbol form is
 * discoverable from the tool list rather than only from the schema.
 */
export const BY_SYMBOL_NOTE =
  ' Target it either by "symbol" name (preferred: no need to know coordinates) ' +
  'or by explicit file/line/column.';

export const TOOL_SCHEMAS = {
  positionParams: {
    type: 'object',
    properties: POSITION_PROPS,
    anyOf: EITHER_POSITION_OR_SYMBOL,
  },

  /** Position tools whose results can grow without bound. */
  pagedPositionParams: {
    type: 'object',
    properties: {
      ...POSITION_PROPS,
      ...PAGINATION_PROPS,
      contextLines: {
        type: 'number',
        description:
          'Include this many source lines either side of each result (default: 0). ' +
          'Every result already carries its own line in "text".',
      },
    },
    anyOf: EITHER_POSITION_OR_SYMBOL,
  },

  fileParam: {
    type: 'object',
    properties: {
      file: FILE_PROP,
    },
    required: ['file'],
  },

  pagedFileParam: {
    type: 'object',
    properties: { file: FILE_PROP, ...PAGINATION_PROPS },
    required: ['file'],
  },

  diagnosticsFileParams: {
    type: 'object',
    properties: {
      file: FILE_PROP,
      includeEslint: {
        type: 'boolean',
        description: 'Include ESLint diagnostics if ESLint is installed in the target project (default: true)',
      },
      includeSuggestions: {
        type: 'boolean',
        description:
          'Include TypeScript suggestion diagnostics such as unused locals and unused imports (default: false).',
      },
      limit: {
        type: 'number',
        description: 'Maximum diagnostics to return, sorted by severity (default: 50, max: 500)',
      },
    },
    required: ['file'],
  },

  findParams: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Name pattern to match (glob with * and ?, or /regex/)',
      },
      kinds: {
        type: 'array',
        items: {
          type: 'string',
          enum: [
            'function', 'class', 'interface', 'type', 'enum',
            'variable', 'const', 'property', 'method', 'parameter',
            'import', 'export', 'string', 'comment',
          ],
        },
        description: 'Symbol kinds to include',
      },
      scope: {
        type: 'string',
        enum: ['project', 'file', 'directory'],
        description: 'Search scope (default: project)',
      },
      path: {
        type: 'string',
        description: 'File or directory path (when scope is file or directory)',
      },
      exported: {
        type: 'boolean',
        description: 'Filter by export status',
      },
      ...PAGINATION_PROPS,
    },
  },

  renameParams: {
    type: 'object',
    properties: {
      ...POSITION_PROPS,
      newName: { type: 'string', description: 'The new name for the symbol' },
    },
    required: ['newName'],
    anyOf: EITHER_POSITION_OR_SYMBOL,
  },

  callHierarchyParams: {
    type: 'object',
    properties: {
      ...POSITION_PROPS,
      direction: {
        type: 'string',
        enum: ['incoming', 'outgoing'],
        description: 'Direction: incoming (who calls this) or outgoing (what this calls)',
      },
    },
    required: ['direction'],
    anyOf: EITHER_POSITION_OR_SYMBOL,
  },

  typeHierarchyParams: {
    type: 'object',
    properties: {
      ...POSITION_PROPS,
      direction: {
        type: 'string',
        enum: ['supertypes', 'subtypes'],
        description: 'Direction: supertypes (parents) or subtypes (children)',
      },
    },
    required: ['direction'],
    anyOf: EITHER_POSITION_OR_SYMBOL,
  },

  batchAnalyzeParams: {
    type: 'object',
    properties: {
      positions: {
        type: 'array',
        items: {
          type: 'object',
          properties: POSITION_PROPS,
          anyOf: EITHER_POSITION_OR_SYMBOL,
        },
        description:
          'Positions to analyze. Each entry takes either file+line+column or a symbol name.',
      },
      include: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['hover', 'definition', 'references', 'diagnostics', 'signature'],
        },
        description: 'Which analyses to include (default: all)',
      },
    },
    required: ['positions'],
  },

  allDiagnosticsParams: {
    type: 'object',
    properties: {
      severity: {
        type: 'string',
        enum: ['error', 'warning', 'suggestion', 'message'],
        description: 'Filter diagnostics by severity (optional)',
      },
      includeEslint: {
        type: 'boolean',
        description: 'Include ESLint diagnostics if ESLint is installed in the target project (default: true)',
      },
      includeSuggestions: {
        type: 'boolean',
        description:
          'Include TypeScript suggestion diagnostics such as unused locals and unused imports (default: false).',
      },
      limit: {
        type: 'number',
        description: 'Maximum diagnostics to return across all files, sorted by severity (default: 50, max: 500)',
      },
    },
  },

  formatDocumentParams: {
    type: 'object',
    properties: {
      file: FILE_PROP,
      includeContent: {
        type: 'boolean',
        description:
          'Return the full formatted text as well (default: false). The file is written to disk either way.',
      },
      options: {
        type: 'object',
        description: 'Formatting options (all optional)',
        properties: {
          indentSize: { type: 'number', description: 'Number of spaces for indentation (default: 2)' },
          tabSize: { type: 'number', description: 'Tab size (default: 2)' },
          convertTabsToSpaces: { type: 'boolean', description: 'Convert tabs to spaces (default: true)' },
          insertSpaceAfterCommaDelimiter: { type: 'boolean' },
          insertSpaceAfterSemicolonInForStatements: { type: 'boolean' },
          insertSpaceBeforeAndAfterBinaryOperators: { type: 'boolean' },
          insertSpaceAfterKeywordsInControlFlowStatements: { type: 'boolean' },
          insertSpaceAfterFunctionKeywordForAnonymousFunctions: { type: 'boolean' },
          placeOpenBraceOnNewLineForFunctions: { type: 'boolean' },
          placeOpenBraceOnNewLineForControlBlocks: { type: 'boolean' },
        },
      },
    },
    required: ['file'],
  },

  codeFixParams: {
    type: 'object',
    properties: {
      ...POSITION_PROPS,
      errorCodes: {
        type: 'array',
        items: { type: 'number' },
        description:
          'TypeScript error codes to fix (optional). Defaults to the diagnostics reported at this position.',
      },
    },
    anyOf: EITHER_POSITION_OR_SYMBOL,
  },

  applyCodeFixParams: {
    type: 'object',
    properties: {
      ...POSITION_PROPS,
      fixName: {
        type: 'string',
        description: 'The fixName of the fix to apply, as returned by get_code_fixes.',
      },
      applyToAll: {
        type: 'boolean',
        description:
          'Apply the same fix to every occurrence in the file (default: false). ' +
          'Only available for fixes that report a fixAllDescription.',
      },
    },
    required: ['fixName'],
    anyOf: EITHER_POSITION_OR_SYMBOL,
  },

  organizeImportsParams: {
    type: 'object',
    properties: {
      file: FILE_PROP,
      apply: {
        type: 'boolean',
        description: 'Write the changes to disk (default: false, which previews the edits).',
      },
    },
    required: ['file'],
  },

  workspaceSymbolsParams: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query for symbol names' },
      maxResults: { type: 'number', description: 'Maximum number of results (default: 100)' },
    },
    required: ['query'],
  },

  metricsParams: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'Path to file (relative to project root). Omit for project-wide analysis.' },
      topN: { type: 'number', description: 'Number of top hotspots to return (default: 20)' },
    },
  },

  indirectionParams: {
    type: 'object',
    properties: {
      maxDepth: { type: 'number', description: 'Max call chain depth to trace (default: 5).' },
      minDirectCallers: { type: 'number', description: 'Minimum direct callers required to be a candidate (default: 3). Lower = more results but slower.' },
      maxChainsPerOffender: { type: 'number', description: 'Max example chains to show per offender (default: 5).' },
      take: { type: 'number', description: 'Number of results to return (default: 30).' },
      skip: { type: 'number', description: 'Number of results to skip for pagination (default: 0).' },
      includeTests: { type: 'boolean', description: 'Include test files in the analysis (default: false).' },
    },
  },

  duplicationParams: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'Path to file (relative to project root). Omit for project-wide analysis.' },
      minNodes: { type: 'number', description: 'Minimum AST node count for a block to be considered (default: 20)' },
      minStatements: { type: 'number', description: 'Minimum statements in a block (default: 3)' },
    },
  },

  moduleDependenciesParams: {
    type: 'object',
    properties: {
      file: FILE_PROP,
      direction: {
        type: 'string',
        enum: ['imports', 'importedBy', 'both'],
        description:
          'Which edges to return: what this file imports, what imports it, or both (default: both).',
      },
      includeExternal: {
        type: 'boolean',
        description: 'Include modules outside the project such as node_modules (default: false).',
      },
    },
    required: ['file'],
  },

  qualityReportParams: {
    type: 'object',
    properties: {
      topN: { type: 'number', description: 'Number of worst offenders per category (default: 20)' },
    },
  },
} as const;
