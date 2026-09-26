import type { LanguageIntelligence } from '../types.js';
import type { AstFinder } from '../ast-finder.js';

/**
 * What a multi-config project can additionally say about a file: whether any
 * tsconfig governs it, and how to explain the answer when none does. A
 * single-config service has no such distinction to report, so this is separate
 * from the language surface every service implements.
 */
export interface MultiConfigProject {
  isFileUnconfigured(filePath: string): boolean;
  fileExistsOnDisk(filePath: string): boolean;
  unconfiguredWarning(filePath: string): string;
  /** True when the working tree has moved to different code since the last refresh. */
  hasGitStateChanged(): boolean;
  /** Calls back when the working tree moves; returns a function to stop. */
  watchForBranchChanges(onChange: () => void): () => void;
}
import type { ComplexityAnalyzer } from '../analyzers/complexity-analyzer.js';
import type { CouplingAnalyzer } from '../analyzers/coupling-analyzer.js';
import type { IndirectionAnalyzer } from '../analyzers/indirection-analyzer.js';
import type { DuplicationDetector } from '../analyzers/duplication-detector.js';

/**
 * Everything a tool handler needs to do its work.
 * Passed to each handler so tool modules stay free of construction concerns.
 */
export interface ToolContext {
  languageService: LanguageIntelligence;
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
