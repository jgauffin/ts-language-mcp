import type ts from 'typescript';

/**
 * Minimal project interface for analyzers and AST tools.
 * Enables testing with in-memory implementations.
 */
export interface ProjectContext {
  getProjectFiles(): string[];
  getFileContent(filePath: string): string | undefined;
  getProjectRoot(): string;
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
}

/**
 * A span of text in a source file.
 */
export interface FileSpan extends FilePosition {
  endLine: number;
  endColumn: number;
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
  documentation?: string;
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
export type ReferenceKind = 'definition' | 'read' | 'write' | 'implementation';

/**
 * Extended reference info with kind.
 */
export interface ReferenceInfo extends FilePosition {
  kind: ReferenceKind;
  isDefinition: boolean;
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
 */
export interface RenameLocation extends FilePosition {
  originalText: string;
  newText: string;
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
}

/**
 * Parameters for batch_analyze tool.
 */
export interface BatchAnalyzeParams {
  positions: PositionParams[];
  include?: Array<'hover' | 'definition' | 'references' | 'diagnostics' | 'signature'>;
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
  content?: string;
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
}

/**
 * Maps SymbolKind to TypeScript SyntaxKind values.
 * Used internally by ast-finder to filter nodes.
 */
export const SYMBOL_KIND_TO_SYNTAX: Record<SymbolKind, ts.SyntaxKind[]> = {
  function: [256, 259, 218, 219], // FunctionDeclaration, FunctionExpression, ArrowFunction
  class: [263],
  interface: [264],
  type: [265],
  enum: [266],
  variable: [260],
  const: [260], // Differentiated by flag check
  property: [172, 303],
  method: [174, 173],
  parameter: [169],
  import: [272, 273],
  export: [277, 278],
  string: [11, 15, 228], // StringLiteral, NoSubstitutionTemplateLiteral, TemplateExpression
  comment: [], // Comments are trivia, handled specially in ast-finder
};
