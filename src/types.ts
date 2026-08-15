/**
 * Minimal project interface for analyzers and AST tools.
 * Enables testing with in-memory implementations.
 */
export interface ProjectContext {
  getProjectFiles(): string[];
  getFileContent(filePath: string): string | undefined;
  getProjectRoot(): string;
  /**
   * Resolves a module specifier to a project-relative file using the
   * compiler's own resolution, which understands tsconfig "paths" aliases and
   * package entry points that plain path matching cannot.
   */
  resolveModule?(specifier: string, containingFile: string): string | undefined;
}

// ── Module Dependency Types ──

export interface ModuleDependency {
  /** The specifier exactly as written in the source. */
  module: string;
  /** Project-relative path it resolves to, absent for unresolved specifiers. */
  resolvedFile?: string;
  /** True when the module lives outside the project, e.g. in node_modules. */
  external: boolean;
  line: number;
  kind: 'import' | 'export' | 'dynamic-import' | 'require';
}

export interface ModuleDependents {
  file: string;
  line: number;
  text?: string;
}

export interface ModuleDependenciesResult {
  file: string;
  imports?: ModuleDependency[];
  importedBy?: ModuleDependents[];
  metrics: {
    efferentCoupling: number;
    afferentCoupling: number;
    instability: number;
  };
}

// ── Complexity Analysis Types ──

export interface FunctionComplexity {
  name: string;
  kind: 'function' | 'method' | 'arrow' | 'getter' | 'setter' | 'constructor';
  file: string;
  line: number;
  endLine: number;
  cyclomaticComplexity: number;
  linesOfCode: number;
  parameterCount: number;
}

export interface FileComplexity {
  file: string;
  totalLinesOfCode: number;
  blankLines: number;
  commentLines: number;
  functions: FunctionComplexity[];
  averageComplexity: number;
  maxComplexity: number;
}

export interface ComplexityAnalysisResult {
  totalFiles: number;
  totalFunctions: number;
  totalLOC: number;
  averageComplexity: number;
  mostComplexFunctions: FunctionComplexity[];
  largestFiles: { file: string; linesOfCode: number; functionCount: number; maxComplexity: number }[];
}

// ── Coupling Analysis Types ──

export interface FileCouplingMetrics {
  file: string;
  efferentCoupling: number;
  afferentCoupling: number;
  instability: number;
  efferentModules: string[];
  afferentModules: string[];
}

export interface CouplingAnalysisResult {
  totalFiles: number;
  averageInstability: number;
  mostUnstable: FileCouplingMetrics[];
  mostCoupled: FileCouplingMetrics[];
}

// ── Indirection Hotspot Types ──

export interface SymbolNode {
  name: string;
  kind: string;
  file: string;
  line: number;
  column: number;
  containerName?: string;
}

export interface CallChainStep {
  name: string;
  file: string;
  line: number;
}

export interface IndirectionOffender {
  symbol: SymbolNode;
  score: number;
  directCallers: number;
  indirectCallers: number;
  maxChainDepth: number;
  avgChainDepth: number;
  worstChains: CallChainStep[][];
}

export interface IndirectionHotspotsResult {
  totalSymbols: number;
  candidates: number;
  offenders: IndirectionOffender[];
  skip: number;
  take: number;
}

export interface IndirectionHotspotsParams {
  maxDepth?: number;
  minDirectCallers?: number;
  maxChainsPerOffender?: number;
  take?: number;
  skip?: number;
  includeTests?: boolean;
}

// ── Duplication Detection Types ──

export interface DuplicateFragment {
  file: string;
  startLine: number;
  endLine: number;
  linesOfCode: number;
  snippet: string;
}

export interface DuplicateGroup {
  hash: string;
  nodeKind: string;
  fragments: DuplicateFragment[];
  /**
   * Always 1: fragments are grouped by an exact structural hash, so every
   * member of a group has identical structure. This is not a similarity score.
   */
  similarity: number;
}

export interface DuplicationAnalysisResult {
  totalGroups: number;
  totalDuplicateFragments: number;
  totalDuplicateLines: number;
  filesAffected: number;
  groups: DuplicateGroup[];
}

/**
 * Symbol kinds supported by the `find` tool.
 * Maps to TypeScript's SyntaxKind but uses human-readable names for AI agents.
 *
 * @example
 * // Filter to only classes and interfaces
 * const kinds: SymbolKind[] = ['class', 'interface'];
 */
export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'variable'
  | 'const'
  | 'property'
  | 'method'
  | 'parameter'
  | 'import'
  | 'export'
  | 'string'
  | 'comment';

/**
 * Search scope for AST queries.
 * - `project`: Search all files in tsconfig
 * - `file`: Search single file
 * - `directory`: Search all TS files in directory
 */
export type SearchScope = 'project' | 'file' | 'directory';

/**
 * Position in a source file. 1-based line/column for human readability.
 *
 * @example
 * const pos: FilePosition = { file: 'src/index.ts', line: 10, column: 5 };
 */
export interface FilePosition {
  file: string;
  line: number;
  column: number;
  /**
   * The source line, trimmed. Carrying it here spares the caller a file read
   * just to see what the position actually points at.
   */
  text?: string;
}

/**
 * Result from the `find` tool. Represents a symbol found in the AST.
 *
 * @example
 * // A found interface
 * const result: FindResult = {
 *   name: 'UserService',
 *   kind: 'interface',
 *   file: 'src/services.ts',
 *   line: 15,
 *   column: 1,
 *   snippet: 'export interface UserService {',
 *   exported: true
 * };
 */
export interface FindResult {
  name: string;
  kind: SymbolKind;
  file: string;
  line: number;
  column: number;
  snippet: string;
  exported: boolean;
}

/**
 * Parameters for the `find` tool.
 *
 * @example
 * // Find all exported interfaces matching *Service
 * const params: FindParams = {
 *   query: '*Service',
 *   kinds: ['interface'],
 *   scope: 'project',
 *   exported: true
 * };
 */
export interface FindParams {
  query?: string;
  kinds?: SymbolKind[];
  scope?: SearchScope;
  path?: string;
  exported?: boolean;
}

/**
 * Parameters for position-based tools (hover, definition, etc.).
 */
export interface PositionParams {
  file: string;
  line: number;
  column: number;
}

/**
 * Diagnostic severity levels matching TypeScript's DiagnosticCategory.
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'suggestion' | 'message';

/**
 * Source of a diagnostic — which tool produced it.
 */
export type DiagnosticSource = 'typescript' | 'eslint';

/**
 * A diagnostic (error/warning) from TypeScript or ESLint.
 */
export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  message: string;
  code: number | string;
  severity: DiagnosticSeverity;
  source: DiagnosticSource;
  ruleId?: string;
}

/**
 * Symbol information returned by `get_symbols`.
 */
export interface SymbolInfo {
  name: string;
  kind: string;
  line: number;
  column: number;
  containerName?: string;
}

/**
 * Completion item from `get_completions`.
 */
export interface CompletionItem {
  name: string;
  kind: string;
  sortText?: string;
  insertText?: string;
}

/**
 * Signature help from `get_signature`.
 */
export interface SignatureInfo {
  label: string;
  documentation?: string;
  parameters: Array<{
    label: string;
    documentation?: string;
  }>;
  activeParameter?: number;
}

/**
 * Rich context returned by `analyze_position`.
 * Bundles multiple pieces of info for a single position.
 */
export interface PositionAnalysis {
  hover?: string;
  definition?: FilePosition;
  references?: ReferenceInfo[];
  diagnostics?: Diagnostic[];
  signature?: SignatureInfo;
}

/**
 * Kind of reference to a symbol.
 */
export type ReferenceKind = 'definition' | 'read' | 'write';

/**
 * Extended reference info with kind.
 */
export interface ReferenceInfo extends FilePosition {
  kind: ReferenceKind;
  isDefinition: boolean;
  /** Surrounding source lines, present only when contextLines was requested. */
  context?: { startLine: number; lines: string[] };
}

/**
 * Import information for a file.
 */
export interface ImportInfo {
  moduleSpecifier: string;
  isTypeOnly: boolean;
  namedImports?: string[];
  defaultImport?: string;
  namespaceImport?: string;
  line: number;
}

/**
 * Hierarchical outline item for a file.
 */
export interface OutlineItem {
  name: string;
  kind: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  children?: OutlineItem[];
}

/**
 * A location that would be renamed.
 *
 * TypeScript supplies prefixText/suffixText where a bare substitution would
 * change meaning. The clearest case is a shorthand property: renaming the
 * binding in `{ timeout }` yields prefixText "timeout: " so the object keeps
 * its key. Anyone applying these edits by hand needs them too.
 */
export interface RenameLocation extends FilePosition {
  originalText: string;
  newText: string;
  prefixText?: string;
  suffixText?: string;
}

/**
 * Call hierarchy item.
 */
export interface CallHierarchyItem {
  name: string;
  kind: string;
  file: string;
  line: number;
  column: number;
  selectionLine: number;
  selectionColumn: number;
  text?: string;
}

/**
 * Call hierarchy call (incoming or outgoing).
 */
export interface CallHierarchyCall {
  from?: CallHierarchyItem;
  to?: CallHierarchyItem;
  fromRanges: Array<{ line: number; column: number }>;
}

/**
 * Type hierarchy item.
 */
export interface TypeHierarchyItem {
  name: string;
  kind: 'class' | 'interface';
  file: string;
  line: number;
  column: number;
  text?: string;
}

/**
 * Result of applying a rename operation.
 */
export interface RenameResult {
  success: boolean;
  filesModified: string[];
  totalChanges: number;
}

/**
 * Summary of diagnostics across multiple files.
 */
export interface AllDiagnosticsResult {
  files: Record<string, Diagnostic[]>;
  summary: {
    errors: number;
    warnings: number;
    suggestions: number;
    messages: number;
    total: number;
    returned: number;
    truncated: boolean;
  };
  /** Compiler option problems; present only when tsconfig has errors. */
  config?: Diagnostic[];
  /** Files the compiler could not analyse; present only when some were skipped. */
  skippedFiles?: string[];
}

/**
 * Formatting options for format_document.
 */
export interface FormatOptions {
  indentSize?: number;
  tabSize?: number;
  convertTabsToSpaces?: boolean;
  insertSpaceAfterCommaDelimiter?: boolean;
  insertSpaceAfterSemicolonInForStatements?: boolean;
  insertSpaceBeforeAndAfterBinaryOperators?: boolean;
  insertSpaceAfterKeywordsInControlFlowStatements?: boolean;
  insertSpaceAfterFunctionKeywordForAnonymousFunctions?: boolean;
  insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets?: boolean;
  insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces?: boolean;
  placeOpenBraceOnNewLineForFunctions?: boolean;
  placeOpenBraceOnNewLineForControlBlocks?: boolean;
}

/**
 * Result of formatting a document.
 */
export interface FormatResult {
  formatted: boolean;
  changeCount: number;
  file: string;
  /** Only present when the caller asked for it; the file itself is on disk. */
  content?: string;
}

/**
 * A single text replacement, expressed in 1-based line/column so an agent
 * can read it without doing offset arithmetic.
 */
export interface TextEdit {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  newText: string;
}

/** Edits grouped by the file they apply to. */
export interface FileEdits {
  file: string;
  edits: TextEdit[];
}

/**
 * A fix TypeScript itself proposes for a diagnostic, such as adding a missing
 * import or removing unused code.
 */
export interface CodeFix {
  fixName: string;
  description: string;
  /** Present when the same fix can be applied to every occurrence in the file. */
  fixAllDescription?: string;
  changes: FileEdits[];
}

/** Result of applying a code fix or organizing imports. */
export interface ApplyEditsResult {
  applied: boolean;
  filesModified: string[];
  totalEdits: number;
  description?: string;
}

/** Result of organize_imports, which can preview or apply. */
export interface OrganizeImportsResult extends ApplyEditsResult {
  changes: FileEdits[];
}

/**
 * Workspace symbol from get_workspace_symbols.
 */
export interface WorkspaceSymbol {
  name: string;
  kind: string;
  file: string;
  line: number;
  column: number;
  containerName?: string;
  text?: string;
}

