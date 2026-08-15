import type { TypeScriptLanguageService } from '../language-service.js';
import type { AstFinder } from '../ast-finder.js';
import { ComplexityAnalyzer } from '../analyzers/complexity-analyzer.js';
import { CouplingAnalyzer } from '../analyzers/coupling-analyzer.js';
import { IndirectionAnalyzer } from '../analyzers/indirection-analyzer.js';
import { DuplicationDetector } from '../analyzers/duplication-detector.js';
import { toYaml } from '../yaml.js';
import { normalizePath } from '../paths.js';
import { SymbolResolver } from '../symbol-resolver.js';
import type { ToolContext, ToolDefinition, ToolHandlerFn, ToolModule } from './context.js';

import { navigationTools } from './navigation.js';
import { intelligenceTools } from './intelligence.js';
import { structureTools } from './structure.js';
import { diagnosticsTools } from './diagnostics.js';
import { refactoringTools } from './refactoring.js';
import { qualityTools } from './quality.js';

export type { ToolContext, ToolDefinition, ToolHandlerFn, ToolModule } from './context.js';
export { TOOL_SCHEMAS } from './schemas.js';

/** Every tool module, in the order tools are advertised to clients. */
const TOOL_MODULES: ToolModule[] = [
  intelligenceTools,
  navigationTools,
  structureTools,
  diagnosticsTools,
  refactoringTools,
  qualityTools,
];

/** Flattened tool definitions for MCP registration. */
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = TOOL_MODULES.flatMap(
  (m) => m.definitions
);

/** Name to handler lookup, replacing a hand-maintained dispatch switch. */
const HANDLERS: Record<string, ToolHandlerFn> = Object.fromEntries(
  TOOL_MODULES.flatMap((m) => Object.entries(m.handlers))
);

/**
 * Tools whose output is JSON rather than YAML. Completions and formatting
 * carry data where YAML's whitespace sensitivity is a liability.
 */
const JSON_TOOLS = new Set(['format_document', 'get_completions']);

/**
 * Handles MCP tool invocations.
 * Routes tool calls to the appropriate tool module.
 *
 * @example
 * const handler = new ToolHandler(languageService, astFinder);
 * await handler.handleTool('get_hover', { file: 'src/index.ts', line: 10, column: 5 });
 */
export class ToolHandler {
  private context: ToolContext;
  private symbolResolver: SymbolResolver;
  private requestQueue: Promise<unknown> = Promise.resolve();
  private lastRefreshTime = 0;
  private static REFRESH_INTERVAL_MS = 2000;

  constructor(languageService: TypeScriptLanguageService, astFinder: AstFinder) {
    this.context = {
      languageService,
      astFinder,
      complexity: new ComplexityAnalyzer(languageService),
      coupling: new CouplingAnalyzer(languageService),
      indirection: new IndirectionAnalyzer(languageService),
      duplication: new DuplicationDetector(languageService),
    };
    this.symbolResolver = new SymbolResolver(languageService);
  }

  /**
   * Replaces a "symbol" argument with the concrete position it names.
   * Runs before validation so downstream handlers only ever see coordinates.
   */
  private resolvePosition(args: Record<string, unknown>): Record<string, unknown> {
    if (typeof args.symbol !== 'string') return args;

    const file = typeof args.file === 'string' ? args.file : undefined;
    if (file) this.validateFilePath(file);

    const position = this.symbolResolver.resolve(args.symbol, file);
    const { symbol, ...rest } = args;

    return { ...rest, file: position.file, line: position.line, column: position.column };
  }

  /**
   * Validates that a file path is relative (not absolute) and exists in the project.
   * Throws a descriptive error if not, guiding the agent to use valid paths.
   */
  private validateFilePath(file: string): void {
    // Detect absolute paths (both Unix and Windows)
    const isAbsolute = file.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(file);
    if (isAbsolute) {
      const projectFiles = this.context.languageService.getProjectFiles();
      const sample = projectFiles.slice(0, 5).join(', ');
      throw new Error(
        `Absolute paths are not accepted. Use a relative path from the project root. ` +
        `Example project files: ${sample}. ` +
        `Use the "get_workspace_symbols" tool or "typescript://project/files" resource to discover files.`
      );
    }

    // Check if the file exists in the project
    if (!this.context.languageService.getFileContent(file)) {
      const projectFiles = this.context.languageService.getProjectFiles();
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
   * Validates the find tool's scope path, which may name a file or a directory.
   */
  private validateSearchPath(searchPath: string): void {
    const normalized = normalizePath(searchPath).replace(/\/+$/, '');
    const projectFiles = this.context.languageService.getProjectFiles();

    const matches = projectFiles.some(
      (f) => f === normalized || f.endsWith(normalized) || f.startsWith(`${normalized}/`)
    );
    if (matches) return;

    const sample = projectFiles.slice(0, 5).join(', ');
    throw new Error(
      `No project file or directory matches path: "${searchPath}". ` +
      `Example project files: ${sample}. ` +
      `Use the "typescript://project/files" resource to discover paths.`
    );
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

  private async executeToolCall(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    try {
      // Always refresh for diagnostic tools to avoid stale results;
      // throttle other tools to avoid re-walking the directory tree on every call.
      const now = Date.now();
      const isDiagnostic = name === 'get_diagnostics' || name === 'get_all_diagnostics';
      if (isDiagnostic || now - this.lastRefreshTime >= ToolHandler.REFRESH_INTERVAL_MS) {
        this.lastRefreshTime = now;
        this.context.languageService.refreshChangedFiles();
      }

      // A symbol name stands in for a position, so resolve it before anything
      // downstream expects line/column to be present.
      let resolvedArgs = this.resolvePosition(args);

      if (name === 'batch_analyze' && Array.isArray(resolvedArgs.positions)) {
        resolvedArgs = {
          ...resolvedArgs,
          positions: resolvedArgs.positions.map((pos) =>
            this.resolvePosition(pos as Record<string, unknown>)
          ),
        };
      }

      // Validate file paths for tools that accept a file parameter
      if (typeof resolvedArgs.file === 'string') {
        this.validateFilePath(resolvedArgs.file);
      }
      // Validate file paths in batch_analyze positions
      if (name === 'batch_analyze' && Array.isArray(resolvedArgs.positions)) {
        for (const pos of resolvedArgs.positions) {
          if (typeof pos === 'object' && pos !== null && typeof (pos as Record<string, unknown>).file === 'string') {
            this.validateFilePath((pos as Record<string, unknown>).file as string);
          }
        }
      }

      // The find tool's own path argument was never validated, so a typo
      // silently returned no matches, which reads as "this does not exist".
      if (name === 'find' && typeof resolvedArgs.path === 'string') {
        this.validateSearchPath(resolvedArgs.path);
      }

      const result = await this.dispatch(name, resolvedArgs);
      const text = JSON_TOOLS.has(name)
        ? JSON.stringify(result, null, 2)
        : toYaml(result);
      return {
        content: [{ type: 'text', text }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // isError lets the client tell a failure from a result. Without it an
      // agent reads "Error: ..." as analysis output.
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  }

  private dispatch(name: string, args: Record<string, unknown>): unknown | Promise<unknown> {
    const handler = HANDLERS[name];
    if (!handler) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return handler(args, this.context);
  }
}
