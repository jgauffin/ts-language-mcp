import type { TypeScriptLanguageService } from './language-service.js';
import type { AstFinder } from './ast-finder.js';
import type { FindParams, PositionParams, DiagnosticSeverity, FormatOptions, IndirectionHotspotsParams } from './types.js';
import { ComplexityAnalyzer } from './analyzers/complexity-analyzer.js';
import { CouplingAnalyzer } from './analyzers/coupling-analyzer.js';
import { IndirectionAnalyzer } from './analyzers/indirection-analyzer.js';
import { DuplicationDetector } from './analyzers/duplication-detector.js';
import type { DuplicationOptions } from './analyzers/duplication-detector.js';
import { toYaml } from './yaml.js';

/**
 * Path utilities for cross-platform compatibility.
 * Always normalizes to forward slashes.
 */

/**
 * Normalizes a path to use forward slashes (cross-platform).
 */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Compares two paths for equality (normalized).
 */
export function pathsEqual(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

/**
 * Checks if a path starts with a prefix (normalized).
 */
export function pathStartsWith(filePath: string, prefix: string): boolean {
  return normalizePath(filePath).startsWith(normalizePath(prefix));
}

/**
 * Checks if a path ends with a suffix (normalized).
 */
export function pathEndsWith(filePath: string, suffix: string): boolean {
  return normalizePath(filePath).endsWith(normalizePath(suffix));
}

/**
 * JSON Schema definitions for MCP tool parameters.
 * These schemas enable AI agents to understand tool inputs.
 */
export const TOOL_SCHEMAS = {
  positionParams: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'Path to the file (relative to project root)' },
      line: { type: 'number', description: 'Line number (1-based)' },
      column: { type: 'number', description: 'Column number (1-based)' },
    },
    required: ['file', 'line', 'column'],
  },

  fileParam: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'Path to the file (relative to project root)' },
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
    },
  },

  renameParams: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'Path to the file (relative to project root)' },
      line: { type: 'number', description: 'Line number (1-based)' },
      column: { type: 'number', description: 'Column number (1-based)' },
      newName: { type: 'string', description: 'The new name for the symbol' },
    },
    required: ['file', 'line', 'column', 'newName'],
  },

  callHierarchyParams: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'Path to the file (relative to project root)' },
      line: { type: 'number', description: 'Line number (1-based)' },
      column: { type: 'number', description: 'Column number (1-based)' },
      direction: {
        type: 'string',
        enum: ['incoming', 'outgoing'],
        description: 'Direction: incoming (who calls this) or outgoing (what this calls)',
      },
    },
    required: ['file', 'line', 'column', 'direction'],
  },

  typeHierarchyParams: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'Path to the file (relative to project root)' },
      line: { type: 'number', description: 'Line number (1-based)' },
      column: { type: 'number', description: 'Column number (1-based)' },
      direction: {
        type: 'string',
        enum: ['supertypes', 'subtypes'],
        description: 'Direction: supertypes (parents) or subtypes (children)',
      },
    },
    required: ['file', 'line', 'column', 'direction'],
  },

  batchAnalyzeParams: {
    type: 'object',
    properties: {
      positions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            line: { type: 'number' },
            column: { type: 'number' },
          },
          required: ['file', 'line', 'column'],
        },
        description: 'Array of positions to analyze',
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
    },
  },

  formatDocumentParams: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'Path to the file (relative to project root)' },
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

  qualityReportParams: {
    type: 'object',
    properties: {
      topN: { type: 'number', description: 'Number of worst offenders per category (default: 20)' },
    },
  },
} as const;

/**
 * Tool definitions for MCP registration.
 * Each tool has a name, description, and input schema.
 */
export const TOOL_DEFINITIONS = [
    {
      name: 'get_hover',
      description:
        'Get type information and documentation for the symbol at a position. ' +
        'Returns the type signature and any JSDoc comments.',
      inputSchema: TOOL_SCHEMAS.positionParams,
    },
    {
      name: 'get_definition',
      description:
        'Find where a symbol is defined. Jump from usage to declaration.',
      inputSchema: TOOL_SCHEMAS.positionParams,
    },
    {
      name: 'get_references',
      description:
        'Find all usages of a symbol across the project. ' +
        'Each reference includes its kind: "definition", "read", or "write".',
      inputSchema: TOOL_SCHEMAS.positionParams,
    },
    {
      name: 'get_diagnostics',
      description:
        'Get TypeScript errors and warnings for a file. Returns compiler diagnostics.',
      inputSchema: TOOL_SCHEMAS.fileParam,
    },
    {
      name: 'get_symbols',
      description:
        'List all symbols (functions, classes, etc.) defined in a file as a flat list. ' +
        'For hierarchical/nested structure, use get_outline instead.',
      inputSchema: TOOL_SCHEMAS.fileParam,
    },
    {
      name: 'get_completions',
      description:
        'Get code completion suggestions at a position. Context-aware suggestions.',
      inputSchema: TOOL_SCHEMAS.positionParams,
    },
    {
      name: 'get_signature',
      description:
        'Get function signature help when cursor is inside a function call\'s parentheses. ' +
        'Shows parameter names, types, and which parameter is active based on cursor position.',
      inputSchema: TOOL_SCHEMAS.positionParams,
    },
    {
      name: 'analyze_position',
      description:
        'Get comprehensive analysis at a position: hover info, definition, references, ' +
        'diagnostics, and signature help in one call.',
      inputSchema: TOOL_SCHEMAS.positionParams,
    },
    {
      name: 'find',
      description:
        'Search for symbols in the AST by name pattern and kind. ' +
        'Supports glob patterns (*Service), regex (/^get/), and filtering by ' +
        'symbol kind (function, class, interface, string, comment, etc.) and export status.',
      inputSchema: TOOL_SCHEMAS.findParams,
    },
    {
      name: 'get_implementations',
      description:
        'Find all implementations of an interface or abstract method. ' +
        'Useful for understanding polymorphic code.',
      inputSchema: TOOL_SCHEMAS.positionParams,
    },
    {
      name: 'get_imports',
      description:
        'List all imports in a file with their details (named imports, defaults, namespaces).',
      inputSchema: TOOL_SCHEMAS.fileParam,
    },
    {
      name: 'get_outline',
      description:
        'Get hierarchical structure/outline of a file. ' +
        'Returns nested symbols with their ranges.',
      inputSchema: TOOL_SCHEMAS.fileParam,
    },
    {
      name: 'rename_preview',
      description:
        'Preview what locations would change when renaming a symbol. ' +
        'Shows all affected files and positions without making changes.',
      inputSchema: TOOL_SCHEMAS.renameParams,
    },
    {
      name: 'get_call_hierarchy',
      description:
        'Get call hierarchy for a function/method. ' +
        'Direction: "incoming" shows who calls this, "outgoing" shows what this calls.',
      inputSchema: TOOL_SCHEMAS.callHierarchyParams,
    },
    {
      name: 'get_type_hierarchy',
      description:
        'Get type hierarchy for a class/interface. ' +
        'Direction: "supertypes" shows parents, "subtypes" shows implementations/extensions.',
      inputSchema: TOOL_SCHEMAS.typeHierarchyParams,
    },
    {
      name: 'batch_analyze',
      description:
        'Get hover, definition, references, diagnostics, and signature for multiple positions in one call. ' +
        'Use the "include" parameter to select which analyses to run (default: all).',
      inputSchema: TOOL_SCHEMAS.batchAnalyzeParams,
    },
    {
      name: 'rename_symbol',
      description:
        'Rename a symbol across the project. Applies changes to all files in memory. ' +
        'Returns summary of files modified and total changes made.',
      inputSchema: TOOL_SCHEMAS.renameParams,
    },
    {
      name: 'get_all_diagnostics',
      description:
        'Get TypeScript errors and warnings for all files in the project. ' +
        'Useful for checking project health after changes. Optionally filter by severity.',
      inputSchema: TOOL_SCHEMAS.allDiagnosticsParams,
    },
    {
      name: 'format_document',
      description:
        'Format a TypeScript/JavaScript file using TypeScript\'s built-in formatter. ' +
        'Applies formatting changes to the file in memory.',
      inputSchema: TOOL_SCHEMAS.formatDocumentParams,
    },
    {
      name: 'get_workspace_symbols',
      description:
        'Fast symbol search across the workspace by name. ' +
        'Faster than the find tool for simple name lookups. Supports fuzzy matching.',
      inputSchema: TOOL_SCHEMAS.workspaceSymbolsParams,
    },
    {
      name: 'calculate_metrics',
      description:
        'Calculate code quality metrics: cyclomatic complexity per function, lines of code per function/file. ' +
        'Identifies complexity hotspots. Omit "file" for project-wide analysis.',
      inputSchema: TOOL_SCHEMAS.metricsParams,
    },
    {
      name: 'find_indirection_hotspots',
      description:
        'Find symbols most heavily accessed through layers of indirection (A → B → C). ' +
        'Returns worst offenders ranked by score with full call chains. ' +
        'Useful for identifying hidden coupling and deeply wrapped dependencies.',
      inputSchema: TOOL_SCHEMAS.indirectionParams,
    },
    {
      name: 'detect_duplication',
      description:
        'Detect duplicate or near-duplicate code blocks by comparing AST structure fingerprints. ' +
        'Finds structurally similar code regardless of variable names or literal values.',
      inputSchema: TOOL_SCHEMAS.duplicationParams,
    },
    {
      name: 'quality_report',
      description:
        'Combined code quality report: worst complexity hotspots, most coupled/unstable modules, ' +
        'and duplicate code blocks — top offenders across all categories in one call.',
      inputSchema: TOOL_SCHEMAS.qualityReportParams,
    },
] as const;

/**
 * Handles MCP tool invocations.
 * Routes tool calls to the appropriate language service methods.
 *
 * @example
 * const handler = new ToolHandler(languageService, astFinder);
 * const result = await handler.handleTool('get_hover', { file: 'src/index.ts', line: 10, column: 5 });
 */
const JSON_TOOLS = new Set([
  'format_document',
  'get_completions',
]);

export class ToolHandler {
  private languageService: TypeScriptLanguageService;
  private astFinder: AstFinder;
  private complexityAnalyzer: ComplexityAnalyzer;
  private couplingAnalyzer: CouplingAnalyzer;
  private indirectionAnalyzer: IndirectionAnalyzer;
  private duplicationDetector: DuplicationDetector;
  private requestQueue: Promise<unknown> = Promise.resolve();
  private lastRefreshTime = 0;
  private static REFRESH_INTERVAL_MS = 2000;

  constructor(languageService: TypeScriptLanguageService, astFinder: AstFinder) {
    this.languageService = languageService;
    this.astFinder = astFinder;
    this.complexityAnalyzer = new ComplexityAnalyzer(languageService);
    this.couplingAnalyzer = new CouplingAnalyzer(languageService);
    this.indirectionAnalyzer = new IndirectionAnalyzer(languageService);
    this.duplicationDetector = new DuplicationDetector(languageService);
  }

  /**
   * Validates that a file path is relative (not absolute) and exists in the project.
   * Throws a descriptive error if not, guiding the agent to use valid paths.
   */
  private validateFilePath(file: string): void {
    // Detect absolute paths (both Unix and Windows)
    const isAbsolute = file.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(file);
    if (isAbsolute) {
      const projectFiles = this.languageService.getProjectFiles();
      const sample = projectFiles.slice(0, 5).join(', ');
      throw new Error(
        `Absolute paths are not accepted. Use a relative path from the project root. ` +
        `Example project files: ${sample}. ` +
        `Use the "get_workspace_symbols" tool or "typescript://project/files" resource to discover files.`
      );
    }

    // Check if the file exists in the project
    if (!this.languageService.getFileContent(file)) {
      const projectFiles = this.languageService.getProjectFiles();
      // Try to find close matches
      const needle = normalizePath(file).toLowerCase();
      const suggestions = projectFiles
        .filter(f => f.toLowerCase().includes(needle.split('/').pop() ?? ''))
        .slice(0, 5);
      const hint = suggestions.length > 0
        ? ` Did you mean: ${suggestions.join(', ')}?`
        : ` Example project files: ${projectFiles.slice(0, 5).join(', ')}.`;
      throw new Error(
        `File not found: "${file}".${hint} ` +
        `Use the "get_workspace_symbols" tool or "typescript://project/files" resource to discover files.`
      );
    }
  }

  /**
   * Dispatches a tool call to the appropriate handler.
   * Serializes concurrent requests via a queue to prevent race conditions
   * on the shared TypeScript language service.
   */
  handleTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    const task = this.requestQueue.then(() => this.executeToolCall(name, args));
    // Update queue to wait for this task (swallow errors so the queue continues)
    this.requestQueue = task.catch(() => {});
    return task;
  }

  private executeToolCall(
    name: string,
    args: Record<string, unknown>
  ): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
    try {
      // Always refresh for diagnostic tools to avoid stale results;
      // throttle other tools to avoid re-walking the directory tree on every call.
      const now = Date.now();
      const isDiagnostic = name === 'get_diagnostics' || name === 'get_all_diagnostics';
      if (isDiagnostic || now - this.lastRefreshTime >= ToolHandler.REFRESH_INTERVAL_MS) {
        this.lastRefreshTime = now;
        this.languageService.refreshChangedFiles();
      }

      // Validate file paths for tools that accept a file parameter
      if (typeof args.file === 'string') {
        this.validateFilePath(args.file);
      }
      // Validate file paths in batch_analyze positions
      if (name === 'batch_analyze' && Array.isArray(args.positions)) {
        for (const pos of args.positions) {
          if (typeof pos === 'object' && pos !== null && typeof (pos as Record<string, unknown>).file === 'string') {
            this.validateFilePath((pos as Record<string, unknown>).file as string);
          }
        }
      }

      const result = this.dispatch(name, args);
      const text = JSON_TOOLS.has(name)
        ? JSON.stringify(result, null, 2)
        : toYaml(result);
      return {
        content: [{ type: 'text', text }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
      };
    }
  }

  private dispatch(name: string, args: Record<string, unknown>): unknown {
    switch (name) {
      case 'get_hover':
        return this.getHover(args as unknown as PositionParams);

      case 'get_definition':
        return this.getDefinition(args as unknown as PositionParams);

      case 'get_references':
        return this.getReferences(args as unknown as PositionParams);

      case 'get_diagnostics':
        return this.getDiagnostics(args as { file: string });

      case 'get_symbols':
        return this.getSymbols(args as { file: string });

      case 'get_completions':
        return this.getCompletions(args as unknown as PositionParams);

      case 'get_signature':
        return this.getSignature(args as unknown as PositionParams);

      case 'analyze_position':
        return this.analyzePosition(args as unknown as PositionParams);

      case 'find':
        return this.find(args as unknown as FindParams);

      case 'get_implementations':
        return this.getImplementations(args as unknown as PositionParams);

      case 'get_imports':
        return this.getImports(args as { file: string });

      case 'get_outline':
        return this.getOutline(args as { file: string });

      case 'rename_preview':
        return this.renamePreview(args as unknown as PositionParams & { newName: string });

      case 'get_call_hierarchy':
        return this.getCallHierarchy(
          args as unknown as PositionParams & { direction: 'incoming' | 'outgoing' }
        );

      case 'get_type_hierarchy':
        return this.getTypeHierarchy(
          args as unknown as PositionParams & { direction: 'supertypes' | 'subtypes' }
        );

      case 'batch_analyze':
        return this.batchAnalyze(
          args as unknown as {
            positions: PositionParams[];
            include?: Array<'hover' | 'definition' | 'references' | 'diagnostics' | 'signature'>;
          }
        );

      case 'rename_symbol':
        return this.renameSymbol(args as unknown as PositionParams & { newName: string });

      case 'get_all_diagnostics':
        return this.getAllDiagnostics(args as { severity?: DiagnosticSeverity });

      case 'format_document':
        return this.formatDocument(args as { file: string; options?: FormatOptions });

      case 'get_workspace_symbols':
        return this.getWorkspaceSymbols(args as { query: string; maxResults?: number });

      case 'calculate_metrics':
        return this.calculateMetrics(args as { file?: string; topN?: number });

      case 'find_indirection_hotspots':
        return this.findIndirectionHotspots(args as IndirectionHotspotsParams);

      case 'detect_duplication':
        return this.detectDuplication(args as { file?: string; minNodes?: number; minStatements?: number });

      case 'quality_report':
        return this.qualityReport(args as { topN?: number });

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private getHover(params: PositionParams) {
    const result = this.languageService.getHover(
      params.file,
      params.line,
      params.column
    );
    return { hover: result ?? null };
  }

  private getDefinition(params: PositionParams) {
    const result = this.languageService.getDefinition(
      params.file,
      params.line,
      params.column
    );
    return { definition: result ?? null };
  }

  private getReferences(params: PositionParams) {
    const result = this.languageService.getReferences(
      params.file,
      params.line,
      params.column
    );
    return { references: result };
  }

  private getDiagnostics(params: { file: string }) {
    const result = this.languageService.getDiagnostics(params.file);
    return { diagnostics: result };
  }

  private getSymbols(params: { file: string }) {
    const result = this.languageService.getSymbols(params.file);
    return { symbols: result };
  }

  private getCompletions(params: PositionParams) {
    const result = this.languageService.getCompletions(
      params.file,
      params.line,
      params.column
    );
    return { completions: result };
  }

  private getSignature(params: PositionParams) {
    const result = this.languageService.getSignature(
      params.file,
      params.line,
      params.column
    );
    return { signature: result ?? null };
  }

  private analyzePosition(params: PositionParams) {
    return this.languageService.analyzePosition(
      params.file,
      params.line,
      params.column
    );
  }

  private find(params: FindParams) {
    const results = this.astFinder.find(params);
    return { matches: results, count: results.length };
  }

  private getImplementations(params: PositionParams) {
    const result = this.languageService.getImplementations(
      params.file,
      params.line,
      params.column
    );
    return { implementations: result, count: result.length };
  }

  private getImports(params: { file: string }) {
    const result = this.languageService.getImports(params.file);
    return { imports: result, count: result.length };
  }

  private getOutline(params: { file: string }) {
    const items = this.languageService.getOutline(params.file);
    return { outline: items };
  }

  private renamePreview(params: PositionParams & { newName: string }) {
    const result = this.languageService.getRenameLocations(
      params.file,
      params.line,
      params.column,
      params.newName
    );
    return { locations: result, count: result.length };
  }

  private getCallHierarchy(params: PositionParams & { direction: 'incoming' | 'outgoing' }) {
    const result = this.languageService.getCallHierarchy(
      params.file,
      params.line,
      params.column,
      params.direction
    );
    return { calls: result, count: result.length };
  }

  private getTypeHierarchy(params: PositionParams & { direction: 'supertypes' | 'subtypes' }) {
    const result = this.languageService.getTypeHierarchy(
      params.file,
      params.line,
      params.column,
      params.direction
    );
    return { types: result, count: result.length };
  }

  private batchAnalyze(params: {
    positions: PositionParams[];
    include?: Array<'hover' | 'definition' | 'references' | 'diagnostics' | 'signature'>;
  }) {
    const include = params.include ?? ['hover', 'definition', 'references', 'diagnostics', 'signature'];

    const results = params.positions.map((pos) => {
      const analysis: Record<string, unknown> = {
        file: pos.file,
        line: pos.line,
        column: pos.column,
      };

      if (include.includes('hover')) {
        analysis.hover = this.languageService.getHover(pos.file, pos.line, pos.column) ?? null;
      }
      if (include.includes('definition')) {
        analysis.definition = this.languageService.getDefinition(pos.file, pos.line, pos.column) ?? null;
      }
      if (include.includes('references')) {
        analysis.references = this.languageService.getReferences(pos.file, pos.line, pos.column);
      }
      if (include.includes('diagnostics')) {
        analysis.diagnostics = this.languageService.getDiagnostics(pos.file);
      }
      if (include.includes('signature')) {
        analysis.signature = this.languageService.getSignature(pos.file, pos.line, pos.column) ?? null;
      }

      return analysis;
    });

    return { results, count: results.length };
  }

  private renameSymbol(params: PositionParams & { newName: string }) {
    const result = this.languageService.applyRename(
      params.file,
      params.line,
      params.column,
      params.newName
    );
    return result;
  }

  private getAllDiagnostics(params: { severity?: DiagnosticSeverity }) {
    const result = this.languageService.getAllDiagnostics(params.severity);
    return result;
  }

  private formatDocument(params: { file: string; options?: FormatOptions }) {
    const result = this.languageService.formatDocument(params.file, params.options);
    return result;
  }

  private getWorkspaceSymbols(params: { query: string; maxResults?: number }) {
    const result = this.languageService.getWorkspaceSymbols(params.query, params.maxResults);
    return { symbols: result, count: result.length };
  }

  private calculateMetrics(params: { file?: string; topN?: number }) {
    if (params.file) {
      return this.complexityAnalyzer.analyzeFile(params.file);
    }
    return this.complexityAnalyzer.analyzeProject({ topN: params.topN });
  }

  private findIndirectionHotspots(params: IndirectionHotspotsParams) {
    return this.indirectionAnalyzer.analyze(params);
  }

  private detectDuplication(params: { file?: string; minNodes?: number; minStatements?: number }) {
    const options: DuplicationOptions = {
      minNodes: params.minNodes,
      minStatements: params.minStatements,
    };
    if (params.file) {
      return { groups: this.duplicationDetector.analyzeFile(params.file, options) };
    }
    return this.duplicationDetector.analyzeProject(options);
  }

  private qualityReport(params: { topN?: number }) {
    const topN = params.topN ?? 20;

    const complexity = this.complexityAnalyzer.analyzeProject({ topN });
    const coupling = this.couplingAnalyzer.analyzeProject({ topN });
    const duplication = this.duplicationDetector.analyzeProject();

    const issues: { file: string; line?: number; category: string; detail: string }[] = [];

    for (const f of complexity.mostComplexFunctions) {
      issues.push({
        file: f.file,
        line: f.line,
        category: 'complexity',
        detail: `${f.name} — cyclomatic complexity ${f.cyclomaticComplexity}, ${f.linesOfCode} LOC`,
      });
    }

    for (const f of coupling.mostUnstable) {
      issues.push({
        file: f.file,
        category: 'coupling',
        detail: `instability ${f.instability} (Ce=${f.efferentCoupling}, Ca=${f.afferentCoupling})`,
      });
    }

    for (const g of duplication.groups) {
      const locations = g.fragments.map(f => `${f.file}:${f.startLine}`).join(', ');
      issues.push({
        file: g.fragments[0].file,
        line: g.fragments[0].startLine,
        category: 'duplication',
        detail: `${g.fragments.length} clones, ${g.fragments[0].linesOfCode} LOC each — ${locations}`,
      });
    }

    return {
      totalFiles: complexity.totalFiles,
      totalFunctions: complexity.totalFunctions,
      totalLOC: complexity.totalLOC,
      issues,
    };
  }
}
