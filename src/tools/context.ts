import type { TypeScriptLanguageService } from '../language-service.js';
import type { AstFinder } from '../ast-finder.js';
import type { ComplexityAnalyzer } from '../analyzers/complexity-analyzer.js';
import type { CouplingAnalyzer } from '../analyzers/coupling-analyzer.js';
import type { IndirectionAnalyzer } from '../analyzers/indirection-analyzer.js';
import type { DuplicationDetector } from '../analyzers/duplication-detector.js';

/**
 * Everything a tool handler needs to do its work.
 * Passed to each handler so tool modules stay free of construction concerns.
 */
export interface ToolContext {
  languageService: TypeScriptLanguageService;
  astFinder: AstFinder;
  complexity: ComplexityAnalyzer;
  coupling: CouplingAnalyzer;
  indirection: IndirectionAnalyzer;
  duplication: DuplicationDetector;
}

/**
 * A single tool's implementation. Returns the raw result object;
 * the registry takes care of serializing it.
 */
export type ToolHandlerFn = (
  args: Record<string, unknown>,
  ctx: ToolContext
) => unknown | Promise<unknown>;

/** An MCP tool definition as advertised to clients. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

/** One domain-grouped set of tools. */
export interface ToolModule {
  definitions: readonly ToolDefinition[];
  handlers: Record<string, ToolHandlerFn>;
}
