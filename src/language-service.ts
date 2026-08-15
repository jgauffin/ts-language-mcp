import ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import { createRequire } from 'module';
import type { ESLint, Linter } from 'eslint';
import type {
  FilePosition,
  Diagnostic,
  DiagnosticSeverity,
  SymbolInfo,
  CompletionItem,
  SignatureInfo,
  PositionAnalysis,
  ReferenceInfo,
  ReferenceKind,
  ImportInfo,
  OutlineItem,
  RenameLocation,
  CallHierarchyCall,
  TypeHierarchyItem,
  RenameResult,
  AllDiagnosticsResult,
  FormatOptions,
  FormatResult,
  WorkspaceSymbol,
  ProjectContext,
  CodeFix,
  FileEdits,
  ApplyEditsResult,
  OrganizeImportsResult,
  ModuleDependency,
  ModuleDependents,
  ModuleDependenciesResult,
} from './types.js';
import { normalizePath } from './paths.js';
import { FileManager } from './file-manager.js';
import { getOffset, getLineColumn } from './position-utils.js';

const DEFAULT_DIAGNOSTICS_LIMIT = 50;
const MAX_DIAGNOSTICS_LIMIT = 500;
const SEVERITY_RANK: Record<DiagnosticSeverity, number> = {
  error: 0,
  warning: 1,
  suggestion: 2,
  message: 3,
};

/**
 * Wraps TypeScript's Language Service to provide code intelligence.
 * Delegates file management to FileManager and implements ProjectContext
 * so analyzers can depend on the minimal interface.
 *
 * @example
 * const service = new TypeScriptLanguageService('/path/to/project');
 * const hover = service.getHover('src/index.ts', 10, 5);
 */
export class TypeScriptLanguageService implements ProjectContext {
  private service: ts.LanguageService;
  private fileManager: FileManager;
  private projectRoot: string;
  private compilerOptions: ts.CompilerOptions;
  private tsConfigFileNames: string[] | null;
  private eslint: ESLint | null = null;
  private eslintNotified = false;
  private eslintErrorNotified = false;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot).replace(/[\\\/]+$/, '');
    const config = this.loadProjectConfig();
    this.compilerOptions = config.options;
    this.tsConfigFileNames = config.fileNames;
    // Re-resolving on every refresh keeps the project in step with tsconfig
    // edits, and costs one config read in place of a full directory walk.
    this.fileManager = new FileManager(
      this.projectRoot,
      () => this.loadProjectConfig().fileNames
    );
    this.service = this.createLanguageService();
    this.eslint = this.loadEslint();
  }

  /**
   * Loads tsconfig.json from the project root. Returns compiler options and,
   * when a tsconfig is present, the fully-resolved list of files it includes.
   * Only checks the project root directory — does NOT walk up to parent directories.
   */
  private loadProjectConfig(): { options: ts.CompilerOptions; fileNames: string[] | null } {
    const configPath = path.join(this.projectRoot, 'tsconfig.json');

    if (fs.existsSync(configPath)) {
      const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
      if (configFile.error) {
        console.error(
          `Warning: failed to read tsconfig.json: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`
        );
        return { options: this.defaultCompilerOptions(), fileNames: null };
      }

      const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        this.projectRoot
      );
      if (parsed.errors.length > 0) {
        for (const err of parsed.errors) {
          console.error(
            `Warning: tsconfig.json: ${ts.flattenDiagnosticMessageText(err.messageText, '\n')}`
          );
        }
      }
      return { options: parsed.options, fileNames: parsed.fileNames };
    }

    return { options: this.defaultCompilerOptions(), fileNames: null };
  }

  /**
   * Attempts to load ESLint from the target project's node_modules.
   * ESLint is optional — absence is not an error; TS diagnostics still flow.
   */
  private loadEslint(): ESLint | null {
    try {
      const require = createRequire(path.join(this.projectRoot, 'package.json'));
      const eslintModule = require('eslint') as typeof import('eslint');
      const instance = new eslintModule.ESLint({
        cwd: this.projectRoot,
        errorOnUnmatchedPattern: false,
      });
      return instance;
    } catch {
      if (!this.eslintNotified) {
        console.error(
          'Info: ESLint not found in target project — skipping lint diagnostics.'
        );
        this.eslintNotified = true;
      }
      return null;
    }
  }

  private defaultCompilerOptions(): ts.CompilerOptions {
    return {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      esModuleInterop: true,
      allowJs: true,
      checkJs: false,
    };
  }

  /**
   * Creates the LanguageService with a custom host.
   * The host bridges TS compiler with our file management.
   */
  private createLanguageService(): ts.LanguageService {
    const host: ts.LanguageServiceHost = {
      getScriptFileNames: () => this.fileManager.getAbsolutePaths(),
      getScriptVersion: (fileName) => this.fileManager.getScriptVersion(fileName),
      getScriptSnapshot: (fileName) => {
        const content = this.fileManager.getScriptSnapshot(fileName);
        if (content !== undefined) {
          return ts.ScriptSnapshot.fromString(content);
        }
        return undefined;
      },
      getCurrentDirectory: () => this.projectRoot,
      getCompilationSettings: () => this.compilerOptions,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    };

    return ts.createLanguageService(host, ts.createDocumentRegistry());
  }

  /**
   * Resolves a file path and returns its content, or undefined.
   */
  private getContentForPath(filePath: string): string | undefined {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    return this.fileManager.getFileEntry(absolutePath)?.content;
  }

  /**
   * Converts 1-based line/column to 0-based offset for a project file.
   *
   * Out-of-range coordinates are an error rather than a clamp: silently
   * analysing the first character of the file hands back a confident answer
   * to a question the caller did not ask.
   */
  private toOffset(filePath: string, line: number, column: number): number {
    const content = this.getContentForPath(filePath);
    if (content === undefined) {
      throw new Error(`File is not part of the project: "${filePath}".`);
    }

    const lines = content.split('\n');
    if (!Number.isInteger(line) || line < 1 || line > lines.length) {
      throw new Error(
        `Line ${line} is out of range for ${filePath} (${lines.length} lines).`
      );
    }

    // A column one past the last character is valid: it addresses end of line.
    const lineLength = lines[line - 1].replace(/\r$/, '').length;
    if (!Number.isInteger(column) || column < 1 || column > lineLength + 1) {
      throw new Error(
        `Column ${column} is out of range for ${filePath}:${line} ` +
        `(line has ${lineLength} characters).`
      );
    }

    return getOffset(content, line, column);
  }

  /**
   * Converts 0-based offset to 1-based line/column for a project file.
   */
  private toLineColumn(filePath: string, offset: number): { line: number; column: number } {
    const content = this.getContentForPath(filePath);
    if (!content) return { line: 1, column: 1 };
    return getLineColumn(content, offset);
  }

  /**
   * The trimmed source line at a position, so navigation results show what
   * they point at instead of only where it is.
   */
  private lineText(filePath: string, line: number): string | undefined {
    const content = this.getContentForPath(filePath);
    if (content === undefined) return undefined;
    return content.split('\n')[line - 1]?.trim();
  }

  /**
   * The lines surrounding a position, for callers that ask for context.
   */
  private surroundingLines(
    filePath: string,
    line: number,
    contextLines: number
  ): { startLine: number; lines: string[] } | undefined {
    const content = this.getContentForPath(filePath);
    if (content === undefined || contextLines <= 0) return undefined;

    const all = content.split('\n');
    const start = Math.max(1, line - contextLines);
    const end = Math.min(all.length, line + contextLines);

    return { startLine: start, lines: all.slice(start - 1, end) };
  }

  // ── Delegated file management ──

  loadFile(filePath: string): void {
    this.fileManager.loadFile(filePath);
  }

  updateFile(filePath: string, content: string): void {
    this.fileManager.updateFile(filePath, content);
  }

  refreshChangedFiles(): void {
    this.fileManager.refreshChangedFiles();
  }

  // ── ProjectContext implementation ──

  getProjectRoot(): string {
    return this.projectRoot;
  }

  getProjectFiles(): string[] {
    return this.fileManager.getProjectFiles();
  }

  getFileContent(filePath: string): string | undefined {
    return this.fileManager.getFileContent(filePath);
  }

  // ── Other public accessors ──

  getCompilerOptions(): ts.CompilerOptions {
    return this.compilerOptions;
  }

  getProgram(): ts.Program | undefined {
    return this.service.getProgram();
  }

  // ── Language intelligence methods ──

  getHover(filePath: string, line: number, column: number): string | undefined {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.toOffset(filePath, line, column);

    const quickInfo = this.service.getQuickInfoAtPosition(absolutePath, offset);
    if (!quickInfo) return undefined;

    const displayParts = quickInfo.displayParts ?? [];
    const documentation = quickInfo.documentation ?? [];

    const typeInfo = displayParts.map((p) => p.text).join('');
    const docs = documentation.map((d) => d.text).join('\n');

    return docs ? `${typeInfo}\n\n${docs}` : typeInfo;
  }

  /**
   * All declarations of the symbol at a position.
   *
   * Returning every one matters for overloads, merged declarations, and
   * `declare` plus implementation pairs, where the first hit is often not
   * the one the caller wants.
   */
  getDefinitions(filePath: string, line: number, column: number): FilePosition[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.toOffset(filePath, line, column);

    const definitions = this.service.getDefinitionAtPosition(absolutePath, offset);
    if (!definitions) return [];

    return definitions.map((def) => {
      const pos = this.toLineColumn(def.fileName, def.textSpan.start);
      const file = normalizePath(path.relative(this.projectRoot, def.fileName));
      return {
        file,
        line: pos.line,
        column: pos.column,
        text: this.lineText(def.fileName, pos.line),
      };
    });
  }

  getDefinition(
    filePath: string,
    line: number,
    column: number
  ): FilePosition | undefined {
    return this.getDefinitions(filePath, line, column)[0];
  }

  getReferences(
    filePath: string,
    line: number,
    column: number,
    contextLines = 0
  ): ReferenceInfo[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.toOffset(filePath, line, column);

    // findReferences groups by symbol and marks which entries are declarations.
    // getReferencesAtPosition returns plain ReferenceEntry values, which carry
    // no isDefinition flag, so the documented "definition" kind never appeared.
    const referencedSymbols = this.service.findReferences(absolutePath, offset);
    if (!referencedSymbols) return [];

    const results: ReferenceInfo[] = [];
    for (const symbol of referencedSymbols) {
      for (const ref of symbol.references) {
        const pos = this.toLineColumn(ref.fileName, ref.textSpan.start);
        const isDefinition = ref.isDefinition ?? false;

        let kind: ReferenceKind = 'read';
        if (isDefinition) {
          kind = 'definition';
        } else if (ref.isWriteAccess) {
          kind = 'write';
        }

        results.push({
          file: normalizePath(path.relative(this.projectRoot, ref.fileName)),
          line: pos.line,
          column: pos.column,
          kind,
          isDefinition,
          text: this.lineText(ref.fileName, pos.line),
          ...(contextLines > 0
            ? { context: this.surroundingLines(ref.fileName, pos.line, contextLines) }
            : {}),
        });
      }
    }

    return results;
  }

  /**
   * Returns diagnostics (errors/warnings) for a file from TypeScript and,
   * if available, ESLint. Results are sorted by severity and capped.
   */
  async getDiagnostics(
    filePath: string,
    options?: { includeEslint?: boolean; limit?: number; includeSuggestions?: boolean }
  ): Promise<Diagnostic[]> {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const relativePath = normalizePath(path.relative(this.projectRoot, absolutePath));
    const includeEslint = options?.includeEslint ?? true;
    const limit = clampLimit(options?.limit);

    const syntactic = this.service.getSyntacticDiagnostics(absolutePath);
    const semantic = this.service.getSemanticDiagnostics(absolutePath);
    // Suggestions carry unused-local and unused-import hints, which are useful
    // but noisy enough that they stay opt-in.
    const suggestions = options?.includeSuggestions
      ? this.service.getSuggestionDiagnostics(absolutePath)
      : [];

    const tsDiagnostics: Diagnostic[] = [...syntactic, ...semantic, ...suggestions].map((diag) => {
      const pos = diag.start
        ? this.toLineColumn(absolutePath, diag.start)
        : { line: 1, column: 1 };

      return {
        file: relativePath,
        line: pos.line,
        column: pos.column,
        message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
        code: diag.code,
        severity: this.mapDiagnosticCategory(diag.category),
        source: 'typescript',
      };
    });

    const eslintDiagnostics = includeEslint
      ? await this.getEslintDiagnostics(absolutePath, relativePath)
      : [];

    return sortAndLimitDiagnostics([...tsDiagnostics, ...eslintDiagnostics], limit);
  }

  private async getEslintDiagnostics(
    absolutePath: string,
    relativePath: string
  ): Promise<Diagnostic[]> {
    if (!this.eslint) return [];

    const fileEntry = this.fileManager.getFileEntry(absolutePath);
    const content = fileEntry?.content ?? (fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf-8') : null);
    if (content === null) return [];

    try {
      const isIgnored = await this.eslint.isPathIgnored(absolutePath);
      if (isIgnored) return [];

      const results = await this.eslint.lintText(content, { filePath: absolutePath });
      const out: Diagnostic[] = [];
      for (const result of results) {
        for (const msg of result.messages) {
          if (!msg.fatal && msg.ruleId === null) continue;
          out.push(mapEslintMessage(msg, relativePath));
        }
      }
      return out;
    } catch (err) {
      const msg = (err as Error).message;
      const noConfig = /could not find config file/i.test(msg);
      if (noConfig) {
        if (!this.eslintErrorNotified) {
          console.error(
            'Info: ESLint found but no config discovered — skipping lint diagnostics.'
          );
          this.eslintErrorNotified = true;
        }
        this.eslint = null;
      } else if (!this.eslintErrorNotified) {
        console.error(`Warning: ESLint failed on ${relativePath}: ${msg}`);
        this.eslintErrorNotified = true;
      }
      return [];
    }
  }

  private mapDiagnosticCategory(category: ts.DiagnosticCategory): DiagnosticSeverity {
    switch (category) {
      case ts.DiagnosticCategory.Error:
        return 'error';
      case ts.DiagnosticCategory.Warning:
        return 'warning';
      case ts.DiagnosticCategory.Suggestion:
        return 'suggestion';
      default:
        return 'message';
    }
  }

  getSymbols(filePath: string): SymbolInfo[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);

    const navTree = this.service.getNavigationTree(absolutePath);
    const symbols: SymbolInfo[] = [];

    const walk = (item: ts.NavigationTree, containerName?: string): void => {
      if (item.kind !== ts.ScriptElementKind.moduleElement) {
        const pos = this.toLineColumn(absolutePath, item.spans[0]?.start ?? 0);
        symbols.push({
          name: item.text,
          kind: item.kind,
          line: pos.line,
          column: pos.column,
          containerName,
        });
      }

      if (item.childItems) {
        for (const child of item.childItems) {
          walk(child, item.text);
        }
      }
    };

    walk(navTree);
    return symbols;
  }

  getCompletions(
    filePath: string,
    line: number,
    column: number
  ): CompletionItem[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.toOffset(filePath, line, column);

    const completions = this.service.getCompletionsAtPosition(
      absolutePath,
      offset,
      undefined
    );

    if (!completions) return [];

    return completions.entries.slice(0, 50).map((entry) => ({
      name: entry.name,
      kind: entry.kind,
      sortText: entry.sortText,
      insertText: entry.insertText,
    }));
  }

  getSignature(
    filePath: string,
    line: number,
    column: number
  ): SignatureInfo | undefined {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.toOffset(filePath, line, column);

    const sigHelp = this.service.getSignatureHelpItems(absolutePath, offset, {});
    if (!sigHelp || sigHelp.items.length === 0) return undefined;

    const item = sigHelp.items[0];

    return {
      label: item.prefixDisplayParts
        .concat(
          item.parameters.flatMap((p, i) =>
            i > 0
              ? [{ text: ', ', kind: 'punctuation' }, ...p.displayParts]
              : p.displayParts
          )
        )
        .concat(item.suffixDisplayParts)
        .map((p) => p.text)
        .join(''),
      documentation: item.documentation.map((d) => d.text).join(''),
      parameters: item.parameters.map((p) => ({
        label: p.displayParts.map((d) => d.text).join(''),
        documentation: p.documentation.map((d) => d.text).join(''),
      })),
      activeParameter: sigHelp.argumentIndex,
    };
  }

  /**
   * Bundles multiple analyses for a position into one call.
   * Useful for AI agents to get full context efficiently.
   */
  async analyzePosition(
    filePath: string,
    line: number,
    column: number
  ): Promise<PositionAnalysis> {
    return {
      hover: this.getHover(filePath, line, column),
      definition: this.getDefinition(filePath, line, column),
      references: this.getReferences(filePath, line, column),
      diagnostics: await this.getDiagnostics(filePath),
      signature: this.getSignature(filePath, line, column),
    };
  }

  getImplementations(
    filePath: string,
    line: number,
    column: number
  ): FilePosition[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.toOffset(filePath, line, column);

    const implementations = this.service.getImplementationAtPosition(absolutePath, offset);
    if (!implementations) return [];

    return implementations.map((impl) => {
      const pos = this.toLineColumn(impl.fileName, impl.textSpan.start);
      return {
        file: normalizePath(path.relative(this.projectRoot, impl.fileName)),
        line: pos.line,
        column: pos.column,
        text: this.lineText(impl.fileName, pos.line),
      };
    });
  }

  getImports(filePath: string): ImportInfo[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const content = this.fileManager.getFileEntry(absolutePath)?.content;
    if (!content) return [];

    const sourceFile = ts.createSourceFile(
      absolutePath,
      content,
      ts.ScriptTarget.Latest,
      true
    );

    const imports: ImportInfo[] = [];

    sourceFile.statements.forEach((stmt) => {
      if (ts.isImportDeclaration(stmt)) {
        const moduleSpecifier = (stmt.moduleSpecifier as ts.StringLiteral).text;
        const importClause = stmt.importClause;
        const { line } = sourceFile.getLineAndCharacterOfPosition(stmt.getStart());

        const info: ImportInfo = {
          moduleSpecifier,
          isTypeOnly: importClause?.isTypeOnly ?? false,
          line: line + 1,
        };

        if (importClause) {
          if (importClause.name) {
            info.defaultImport = importClause.name.text;
          }

          if (importClause.namedBindings) {
            if (ts.isNamespaceImport(importClause.namedBindings)) {
              info.namespaceImport = importClause.namedBindings.name.text;
            } else if (ts.isNamedImports(importClause.namedBindings)) {
              info.namedImports = importClause.namedBindings.elements.map((el) =>
                el.propertyName ? `${el.propertyName.text} as ${el.name.text}` : el.name.text
              );
            }
          }
        }

        imports.push(info);
      }
    });

    return imports;
  }

  getOutline(filePath: string): OutlineItem[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const navTree = this.service.getNavigationTree(absolutePath);

    const convertItem = (item: ts.NavigationTree): OutlineItem | null => {
      if (item.kind === ts.ScriptElementKind.moduleElement) {
        return null;
      }

      const startPos = this.toLineColumn(absolutePath, item.spans[0]?.start ?? 0);
      const endPos = this.toLineColumn(
        absolutePath,
        (item.spans[0]?.start ?? 0) + (item.spans[0]?.length ?? 0)
      );

      const outlineItem: OutlineItem = {
        name: item.text,
        kind: item.kind,
        line: startPos.line,
        column: startPos.column,
        endLine: endPos.line,
        endColumn: endPos.column,
      };

      if (item.childItems && item.childItems.length > 0) {
        outlineItem.children = item.childItems
          .map(convertItem)
          .filter((c): c is OutlineItem => c !== null);
      }

      return outlineItem;
    };

    if (navTree.kind === ts.ScriptElementKind.moduleElement && navTree.childItems) {
      return navTree.childItems
        .map(convertItem)
        .filter((c): c is OutlineItem => c !== null);
    }

    const result = convertItem(navTree);
    return result ? [result] : [];
  }

  /**
   * Raw rename locations straight from TypeScript.
   *
   * providePrefixAndSuffixTextForRename is what makes TypeScript report the
   * extra text a site needs; without it shorthand properties and aliased
   * imports come back as bare substitutions and get rewritten incorrectly.
   */
  private findRawRenameLocations(
    filePath: string,
    line: number,
    column: number
  ): { locations: readonly ts.RenameLocation[]; displayName: string } {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.toOffset(filePath, line, column);

    const renameInfo = this.service.getRenameInfo(absolutePath, offset);
    if (!renameInfo.canRename) return { locations: [], displayName: '' };

    const locations = this.service.findRenameLocations(absolutePath, offset, false, false, {
      providePrefixAndSuffixTextForRename: true,
    });

    return { locations: locations ?? [], displayName: renameInfo.displayName };
  }

  getRenameLocations(
    filePath: string,
    line: number,
    column: number,
    newName: string
  ): RenameLocation[] {
    const { locations, displayName } = this.findRawRenameLocations(filePath, line, column);

    return locations.map((loc) => {
      const pos = this.toLineColumn(loc.fileName, loc.textSpan.start);
      return {
        file: normalizePath(path.relative(this.projectRoot, loc.fileName)),
        line: pos.line,
        column: pos.column,
        text: this.lineText(loc.fileName, pos.line),
        originalText: displayName,
        newText: newName,
        ...(loc.prefixText ? { prefixText: loc.prefixText } : {}),
        ...(loc.suffixText ? { suffixText: loc.suffixText } : {}),
      };
    });
  }

  getCallHierarchy(
    filePath: string,
    line: number,
    column: number,
    direction: 'incoming' | 'outgoing'
  ): CallHierarchyCall[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.toOffset(filePath, line, column);

    const preparedItems = this.service.prepareCallHierarchy(absolutePath, offset);
    if (!preparedItems) return [];

    const items = Array.isArray(preparedItems) ? preparedItems : [preparedItems];
    if (items.length === 0) return [];
    const results: CallHierarchyCall[] = [];

    if (direction === 'incoming') {
      const incoming = this.service.provideCallHierarchyIncomingCalls(absolutePath, offset);
      for (const call of incoming) {
        const fromPos = this.toLineColumn(call.from.file, call.from.selectionSpan.start);
        const fromEndPos = this.toLineColumn(
          call.from.file,
          call.from.span.start
        );
        results.push({
          from: {
            name: call.from.name,
            kind: call.from.kind,
            file: normalizePath(path.relative(this.projectRoot, call.from.file)),
            line: fromEndPos.line,
            column: fromEndPos.column,
            selectionLine: fromPos.line,
            selectionColumn: fromPos.column,
            text: this.lineText(call.from.file, fromPos.line),
          },
          fromRanges: call.fromSpans.map((span) => {
            const pos = this.toLineColumn(call.from.file, span.start);
            return { line: pos.line, column: pos.column };
          }),
        });
      }
    } else {
      const outgoing = this.service.provideCallHierarchyOutgoingCalls(absolutePath, offset);
      for (const call of outgoing) {
        const toPos = this.toLineColumn(call.to.file, call.to.selectionSpan.start);
        const toEndPos = this.toLineColumn(call.to.file, call.to.span.start);
        results.push({
          to: {
            name: call.to.name,
            kind: call.to.kind,
            file: normalizePath(path.relative(this.projectRoot, call.to.file)),
            line: toEndPos.line,
            column: toEndPos.column,
            selectionLine: toPos.line,
            selectionColumn: toPos.column,
            text: this.lineText(call.to.file, toPos.line),
          },
          fromRanges: call.fromSpans.map((span) => {
            const pos = this.toLineColumn(absolutePath, span.start);
            return { line: pos.line, column: pos.column };
          }),
        });
      }
    }

    return results;
  }

  getTypeHierarchy(
    filePath: string,
    line: number,
    column: number,
    direction: 'supertypes' | 'subtypes'
  ): TypeHierarchyItem[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.toOffset(filePath, line, column);
    const program = this.service.getProgram();
    if (!program) return [];

    const sourceFile = program.getSourceFile(absolutePath);
    if (!sourceFile) return [];

    const checker = program.getTypeChecker();

    const findNode = (node: ts.Node): ts.Node | undefined => {
      if (offset >= node.getStart() && offset < node.getEnd()) {
        const child = ts.forEachChild(node, findNode);
        return child || node;
      }
      return undefined;
    };

    const node = findNode(sourceFile);
    if (!node) return [];

    let declaration: ts.ClassDeclaration | ts.InterfaceDeclaration | undefined;
    let current: ts.Node | undefined = node;
    while (current) {
      if (ts.isClassDeclaration(current) || ts.isInterfaceDeclaration(current)) {
        declaration = current;
        break;
      }
      current = current.parent;
    }

    if (!declaration || !declaration.name) return [];

    const results: TypeHierarchyItem[] = [];

    if (direction === 'supertypes') {
      for (const clause of declaration.heritageClauses ?? []) {
        for (const typeNode of clause.types) {
          const symbol = this.resolveHeritageSymbol(checker, typeNode.expression);
          const decl = symbol?.getDeclarations()?.[0];
          if (!decl) continue;

          results.push(this.toTypeHierarchyItem(decl, symbol.getName()));
        }
      }
      return results;
    }

    // Subtypes: compare against the target's own declaration rather than its
    // name, so an unrelated type that happens to share the name is not a match.
    const targetSymbol = checker.getSymbolAtLocation(declaration.name);
    const targetDeclarations = new Set<ts.Node>(
      targetSymbol?.getDeclarations() ?? [declaration]
    );

    const projectFiles = new Set(
      this.fileManager.getAbsolutePaths().map((p) => normalizePath(p))
    );

    for (const sf of program.getSourceFiles()) {
      if (sf.isDeclarationFile) continue;
      if (!projectFiles.has(normalizePath(sf.fileName))) continue;

      const findSubtypes = (n: ts.Node): void => {
        if ((ts.isClassDeclaration(n) || ts.isInterfaceDeclaration(n)) && n.name) {
          for (const clause of n.heritageClauses ?? []) {
            for (const typeNode of clause.types) {
              const symbol = this.resolveHeritageSymbol(checker, typeNode.expression);
              const matches = symbol
                ?.getDeclarations()
                ?.some((d) => targetDeclarations.has(d));
              if (matches) {
                results.push(this.toTypeHierarchyItem(n, n.name.text));
              }
            }
          }
        }
        ts.forEachChild(n, findSubtypes);
      };

      findSubtypes(sf);
    }

    return results;
  }

  /**
   * Resolves the symbol behind a heritage clause expression, following import
   * aliases so `import type { Shape }` resolves to the original declaration.
   */
  private resolveHeritageSymbol(
    checker: ts.TypeChecker,
    expression: ts.Expression
  ): ts.Symbol | undefined {
    let symbol = checker.getSymbolAtLocation(expression);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
      symbol = checker.getAliasedSymbol(symbol);
    }
    return symbol ?? checker.getTypeAtLocation(expression).getSymbol();
  }

  /**
   * Builds a hierarchy item from a declaration, using that declaration's own
   * source file for the line map. Borrowing another file's line map is what
   * previously produced positions pointing at unrelated lines.
   */
  private toTypeHierarchyItem(declaration: ts.Node, name: string): TypeHierarchyItem {
    const declSourceFile = declaration.getSourceFile();
    const target =
      (declaration as ts.ClassDeclaration | ts.InterfaceDeclaration).name ?? declaration;
    const pos = declSourceFile.getLineAndCharacterOfPosition(target.getStart());

    return {
      name,
      kind: ts.isClassDeclaration(declaration) ? 'class' : 'interface',
      file: normalizePath(path.relative(this.projectRoot, declSourceFile.fileName)),
      line: pos.line + 1,
      column: pos.character + 1,
      text: this.lineText(declSourceFile.fileName, pos.line + 1),
    };
  }

  applyRename(
    filePath: string,
    line: number,
    column: number,
    newName: string
  ): RenameResult {
    const { locations } = this.findRawRenameLocations(filePath, line, column);

    if (locations.length === 0) {
      return { success: false, filesModified: [], totalChanges: 0 };
    }

    const changesByFile = new Map<string, ts.RenameLocation[]>();
    for (const loc of locations) {
      const existing = changesByFile.get(loc.fileName) ?? [];
      existing.push(loc);
      changesByFile.set(loc.fileName, existing);
    }

    const filesModified: string[] = [];

    for (const [absolutePath, fileLocations] of changesByFile) {
      const relativePath = normalizePath(path.relative(this.projectRoot, absolutePath));
      const content = this.fileManager.getFileContent(relativePath);
      if (content === undefined) continue;

      // Apply back to front so earlier spans keep their offsets. Working from
      // the compiler's own spans avoids re-deriving positions from line/column.
      const sorted = [...fileLocations].sort((a, b) => b.textSpan.start - a.textSpan.start);

      let result = content;
      for (const loc of sorted) {
        const start = loc.textSpan.start;
        const end = start + loc.textSpan.length;
        const replacement = `${loc.prefixText ?? ''}${newName}${loc.suffixText ?? ''}`;
        result = result.substring(0, start) + replacement + result.substring(end);
      }

      this.fileManager.writeFile(relativePath, result);
      filesModified.push(relativePath);
    }

    return {
      success: true,
      filesModified,
      totalChanges: locations.length,
    };
  }

  /**
   * Returns diagnostics for all files in the project.
   */
  async getAllDiagnostics(
    severity?: DiagnosticSeverity,
    options?: { includeEslint?: boolean; limit?: number; includeSuggestions?: boolean }
  ): Promise<AllDiagnosticsResult> {
    const includeEslint = options?.includeEslint ?? true;
    const includeSuggestions = options?.includeSuggestions ?? false;
    const limit = clampLimit(options?.limit);
    // Config errors otherwise only reach stderr at startup, where no agent sees them.
    const configDiagnostics = this.getCompilerOptionsDiagnostics();

    const all: Diagnostic[] = [];
    const skipped: string[] = [];

    for (const relativePath of this.fileManager.getProjectFiles()) {
      let diagnostics: Diagnostic[];
      try {
        diagnostics = await this.getDiagnostics(relativePath, {
          includeEslint,
          includeSuggestions,
          limit: MAX_DIAGNOSTICS_LIMIT,
        });
      } catch (error) {
        // One unanalyzable file must not blank out the whole project report.
        skipped.push(relativePath);
        continue;
      }

      for (const diag of diagnostics) {
        if (severity && diag.severity !== severity) continue;
        all.push(diag);
      }
    }

    const summary = {
      errors: 0,
      warnings: 0,
      suggestions: 0,
      messages: 0,
      total: all.length,
      returned: 0,
      truncated: false,
    };
    for (const diag of all) {
      switch (diag.severity) {
        case 'error':
          summary.errors++;
          break;
        case 'warning':
          summary.warnings++;
          break;
        case 'suggestion':
          summary.suggestions++;
          break;
        case 'message':
          summary.messages++;
          break;
      }
    }

    const sorted = sortAndLimitDiagnostics(all, limit);
    summary.returned = sorted.length;
    summary.truncated = sorted.length < all.length;

    const files: Record<string, Diagnostic[]> = {};
    for (const diag of sorted) {
      if (!files[diag.file]) files[diag.file] = [];
      files[diag.file].push(diag);
    }

    return {
      files,
      summary,
      ...(configDiagnostics.length > 0 ? { config: configDiagnostics } : {}),
      // Surfaced rather than swallowed, so a partial report is visibly partial.
      ...(skipped.length > 0 ? { skippedFiles: skipped } : {}),
    };
  }

  formatDocument(
    filePath: string,
    options?: FormatOptions,
    includeContent = false
  ): FormatResult {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const fileEntry = this.fileManager.getFileEntry(absolutePath);

    if (!fileEntry) {
      return { formatted: false, changeCount: 0, file: filePath };
    }

    const formatOptions = toFormatSettings(options);

    const edits = this.service.getFormattingEditsForDocument(absolutePath, formatOptions);

    if (edits.length === 0) {
      return {
        formatted: true,
        changeCount: 0,
        file: filePath,
        ...(includeContent ? { content: fileEntry.content } : {}),
      };
    }

    let content = fileEntry.content;
    const sortedEdits = [...edits].sort((a, b) => b.span.start - a.span.start);

    for (const edit of sortedEdits) {
      const before = content.substring(0, edit.span.start);
      const after = content.substring(edit.span.start + edit.span.length);
      content = before + edit.newText + after;
    }

    this.fileManager.writeFile(filePath, content);

    // The formatted file is on disk, so returning its full text by default
    // would just be an expensive copy of something the agent can read.
    return {
      formatted: true,
      changeCount: edits.length,
      file: filePath,
      ...(includeContent ? { content } : {}),
    };
  }

  // ── Module dependencies ──

  /**
   * Resolves a module specifier through the compiler, so tsconfig "paths"
   * aliases, package entry points and extensionless imports all land on the
   * real file. Returns a project-relative path, or undefined for anything
   * outside the project.
   */
  resolveModule(specifier: string, containingFile: string): string | undefined {
    const absoluteContaining = path.resolve(this.projectRoot, containingFile);
    const resolved = ts.resolveModuleName(
      specifier,
      absoluteContaining,
      this.compilerOptions,
      ts.sys
    ).resolvedModule;

    if (!resolved || resolved.isExternalLibraryImport) return undefined;

    const relative = normalizePath(path.relative(this.projectRoot, resolved.resolvedFileName));
    return relative.startsWith('..') ? undefined : relative;
  }

  /**
   * What a file imports and what imports it.
   */
  getModuleDependencies(
    filePath: string,
    options?: {
      direction?: 'imports' | 'importedBy' | 'both';
      includeExternal?: boolean;
    }
  ): ModuleDependenciesResult {
    const direction = options?.direction ?? 'both';
    const includeExternal = options?.includeExternal ?? false;

    const imports = this.collectModuleDependencies(filePath, includeExternal);
    const importedBy = this.collectDependents(filePath);

    const internalImports = imports.filter((i) => !i.external);
    const efferent = new Set(internalImports.map((i) => i.resolvedFile ?? i.module)).size;
    const afferent = new Set(importedBy.map((d) => d.file)).size;

    return {
      file: filePath,
      ...(direction !== 'importedBy' ? { imports } : {}),
      ...(direction !== 'imports' ? { importedBy } : {}),
      metrics: {
        efferentCoupling: efferent,
        afferentCoupling: afferent,
        instability:
          efferent + afferent > 0
            ? Math.round((efferent / (efferent + afferent)) * 100) / 100
            : 0,
      },
    };
  }

  /**
   * Every module specifier in a file, including dynamic imports and require
   * calls that a statements-only scan would miss.
   */
  private collectModuleDependencies(
    filePath: string,
    includeExternal: boolean
  ): ModuleDependency[] {
    const content = this.getContentForPath(filePath);
    if (content === undefined) return [];

    const absolutePath = path.resolve(this.projectRoot, filePath);
    const sourceFile = ts.createSourceFile(absolutePath, content, ts.ScriptTarget.Latest, true);
    const found: ModuleDependency[] = [];

    const record = (specifier: string, node: ts.Node, kind: ModuleDependency['kind']): void => {
      const resolvedFile = this.resolveModule(specifier, filePath);
      const external = resolvedFile === undefined;
      if (external && !includeExternal) return;

      found.push({
        module: specifier,
        ...(resolvedFile ? { resolvedFile } : {}),
        external,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        kind,
      });
    };

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        record(node.moduleSpecifier.text, node, 'import');
      } else if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        record(node.moduleSpecifier.text, node, 'export');
      } else if (ts.isCallExpression(node)) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            record(arg.text, node, 'dynamic-import');
          } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
            record(arg.text, node, 'require');
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return found;
  }

  /** Files that import this module, straight from the compiler. */
  private collectDependents(filePath: string): ModuleDependents[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);

    let references: readonly ts.ReferenceEntry[];
    try {
      references = this.service.getFileReferences(absolutePath);
    } catch {
      return [];
    }

    return references.map((ref) => {
      const pos = this.toLineColumn(ref.fileName, ref.textSpan.start);
      return {
        file: normalizePath(path.relative(this.projectRoot, ref.fileName)),
        line: pos.line,
        text: this.lineText(ref.fileName, pos.line),
      };
    });
  }

  // ── Code actions ──

  /**
   * Diagnostic codes reported at (or on the same line as) a position, plus the
   * span they cover. getCodeFixesAtPosition needs explicit codes, and an agent
   * pointing at a reported error should not have to look them up first.
   */
  private diagnosticsAt(
    absolutePath: string,
    offset: number
  ): { codes: number[]; start: number; end: number } {
    const diagnostics = [
      ...this.service.getSyntacticDiagnostics(absolutePath),
      ...this.service.getSemanticDiagnostics(absolutePath),
    ];

    const covering = diagnostics.filter(
      (d) => d.start !== undefined && offset >= d.start && offset <= d.start + (d.length ?? 0)
    );

    const matched = covering.length > 0 ? covering : this.diagnosticsOnLine(absolutePath, offset, diagnostics);
    if (matched.length === 0) {
      return { codes: [], start: offset, end: offset };
    }

    const start = Math.min(...matched.map((d) => d.start ?? offset));
    const end = Math.max(...matched.map((d) => (d.start ?? offset) + (d.length ?? 0)));
    return { codes: [...new Set(matched.map((d) => d.code))], start, end };
  }

  private diagnosticsOnLine(
    absolutePath: string,
    offset: number,
    diagnostics: ts.Diagnostic[]
  ): ts.Diagnostic[] {
    const target = this.toLineColumn(absolutePath, offset).line;
    return diagnostics.filter(
      (d) => d.start !== undefined && this.toLineColumn(absolutePath, d.start).line === target
    );
  }

  /**
   * Fixes TypeScript proposes for the problems at a position.
   */
  getCodeFixes(
    filePath: string,
    line: number,
    column: number,
    errorCodes?: number[]
  ): CodeFix[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.toOffset(filePath, line, column);

    const found = this.diagnosticsAt(absolutePath, offset);
    const codes = errorCodes && errorCodes.length > 0 ? errorCodes : found.codes;
    if (codes.length === 0) return [];

    const fixes = this.service.getCodeFixesAtPosition(
      absolutePath,
      found.start,
      found.end,
      codes,
      toFormatSettings(),
      {}
    );

    return fixes.map((fix) => ({
      fixName: fix.fixName,
      description: fix.description,
      ...(fix.fixAllDescription ? { fixAllDescription: fix.fixAllDescription } : {}),
      changes: this.toFileEdits(fix.changes),
    }));
  }

  /**
   * Applies one of the fixes from getCodeFixes and writes the result to disk.
   */
  applyCodeFix(
    filePath: string,
    line: number,
    column: number,
    fixName: string,
    applyToAll = false
  ): ApplyEditsResult {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.toOffset(filePath, line, column);

    const found = this.diagnosticsAt(absolutePath, offset);
    if (found.codes.length === 0) {
      throw new Error(
        `No diagnostics at ${filePath}:${line}:${column}, so there is nothing to fix.`
      );
    }

    const fixes = this.service.getCodeFixesAtPosition(
      absolutePath,
      found.start,
      found.end,
      found.codes,
      toFormatSettings(),
      {}
    );

    const fix = fixes.find((f) => f.fixName === fixName);
    if (!fix) {
      const available = fixes.map((f) => f.fixName);
      throw new Error(
        `No fix named "${fixName}" at ${filePath}:${line}:${column}. ` +
        (available.length > 0
          ? `Available: ${available.join(', ')}.`
          : 'No fixes are available at this position.')
      );
    }

    let changes: readonly ts.FileTextChanges[] = fix.changes;
    if (applyToAll && fix.fixId !== undefined) {
      changes = this.service.getCombinedCodeFix(
        { type: 'file', fileName: absolutePath },
        fix.fixId,
        toFormatSettings(),
        {}
      ).changes;
    }

    const { filesModified, totalEdits } = this.writeFileTextChanges(changes);
    return { applied: totalEdits > 0, filesModified, totalEdits, description: fix.description };
  }

  /**
   * Sorts and prunes a file's imports using TypeScript's own organizer.
   */
  organizeImports(filePath: string, apply = false): OrganizeImportsResult {
    const absolutePath = path.resolve(this.projectRoot, filePath);

    const changes = this.service.organizeImports(
      { type: 'file', fileName: absolutePath },
      toFormatSettings(),
      {}
    );

    if (!apply) {
      const totalEdits = changes.reduce((sum, c) => sum + c.textChanges.length, 0);
      return {
        applied: false,
        filesModified: [],
        totalEdits,
        changes: this.toFileEdits(changes),
      };
    }

    const preview = this.toFileEdits(changes);
    const { filesModified, totalEdits } = this.writeFileTextChanges(changes);
    return { applied: totalEdits > 0, filesModified, totalEdits, changes: preview };
  }

  /**
   * Jumps to the declaration of a symbol's type rather than of the symbol.
   */
  getTypeDefinition(filePath: string, line: number, column: number): FilePosition[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.toOffset(filePath, line, column);

    const definitions = this.service.getTypeDefinitionAtPosition(absolutePath, offset);
    if (!definitions) return [];

    return definitions.map((def) => {
      const pos = this.toLineColumn(def.fileName, def.textSpan.start);
      return {
        file: normalizePath(path.relative(this.projectRoot, def.fileName)),
        line: pos.line,
        column: pos.column,
        text: this.lineText(def.fileName, pos.line),
      };
    });
  }

  /** Compiler option problems, which otherwise only reach stderr at startup. */
  getCompilerOptionsDiagnostics(): Diagnostic[] {
    return this.service.getCompilerOptionsDiagnostics().map((diag) => ({
      file: diag.file ? normalizePath(path.relative(this.projectRoot, diag.file.fileName)) : 'tsconfig.json',
      line: 1,
      column: 1,
      message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
      code: diag.code,
      severity: this.mapDiagnosticCategory(diag.category),
      source: 'typescript' as const,
    }));
  }

  /** Converts compiler text changes into line/column edits for display. */
  private toFileEdits(changes: readonly ts.FileTextChanges[]): FileEdits[] {
    return changes.map((change) => ({
      file: normalizePath(path.relative(this.projectRoot, change.fileName)),
      edits: change.textChanges.map((edit) => {
        const start = this.toLineColumn(change.fileName, edit.span.start);
        const end = this.toLineColumn(change.fileName, edit.span.start + edit.span.length);
        return {
          line: start.line,
          column: start.column,
          endLine: end.line,
          endColumn: end.column,
          newText: edit.newText,
        };
      }),
    }));
  }

  /** Applies compiler text changes to disk, back to front within each file. */
  private writeFileTextChanges(changes: readonly ts.FileTextChanges[]): {
    filesModified: string[];
    totalEdits: number;
  } {
    const filesModified: string[] = [];
    let totalEdits = 0;

    for (const change of changes) {
      const relativePath = normalizePath(path.relative(this.projectRoot, change.fileName));
      const content = this.fileManager.getFileContent(relativePath);
      if (content === undefined) continue;

      const sorted = [...change.textChanges].sort((a, b) => b.span.start - a.span.start);

      let result = content;
      for (const edit of sorted) {
        const start = edit.span.start;
        result = result.substring(0, start) + edit.newText + result.substring(start + edit.span.length);
      }

      this.fileManager.writeFile(relativePath, result);
      filesModified.push(relativePath);
      totalEdits += change.textChanges.length;
    }

    return { filesModified, totalEdits };
  }

  /**
   * Fuzzy symbol search. Positions point at the symbol's name, which makes
   * them directly usable as input to the position-based tools.
   *
   * @param file - Optional project-relative path to search within.
   */
  getWorkspaceSymbols(
    query: string,
    maxResults: number = 100,
    file?: string
  ): WorkspaceSymbol[] {
    const scopedTo = file ? path.resolve(this.projectRoot, file) : undefined;
    const items = this.service.getNavigateToItems(query, maxResults, scopedTo);

    // NavigateToItem spans cover the whole declaration, so they start at
    // "export" rather than the name. Callers feed these positions straight
    // back into the position tools, which only resolve on the identifier.
    const nameSpans = new Map<string, Map<number, number>>();

    return items.map(item => {
      const start = this.toNameSpanStart(item.fileName, item.textSpan.start, nameSpans);
      const pos = this.toLineColumn(item.fileName, start);
      return {
        name: item.name,
        kind: item.kind,
        file: normalizePath(path.relative(this.projectRoot, item.fileName)),
        line: pos.line,
        column: pos.column,
        containerName: item.containerName || undefined,
        text: this.lineText(item.fileName, pos.line),
      };
    });
  }


  /**
   * Maps a declaration span start to the start of that declaration's name,
   * using the navigation tree which reports both. Falls back to the original
   * offset when no matching entry exists.
   */
  private toNameSpanStart(
    fileName: string,
    spanStart: number,
    cache: Map<string, Map<number, number>>
  ): number {
    let perFile = cache.get(fileName);
    if (!perFile) {
      perFile = new Map<number, number>();
      try {
        const collect = (item: ts.NavigationTree): void => {
          if (item.nameSpan) {
            for (const span of item.spans) {
              perFile!.set(span.start, item.nameSpan.start);
            }
          }
          item.childItems?.forEach(collect);
        };
        collect(this.service.getNavigationTree(fileName));
      } catch {
        // A file the compiler cannot parse keeps its original offsets.
      }
      cache.set(fileName, perFile);
    }

    return perFile.get(spanStart) ?? spanStart;
  }
}

/**
 * Format settings shared by the formatter and every code action, so applied
 * fixes come out looking like the rest of the file.
 */
function toFormatSettings(options?: FormatOptions): ts.FormatCodeSettings {
  return {
    indentSize: options?.indentSize ?? 2,
    tabSize: options?.tabSize ?? 2,
    convertTabsToSpaces: options?.convertTabsToSpaces ?? true,
    insertSpaceAfterCommaDelimiter: options?.insertSpaceAfterCommaDelimiter ?? true,
    insertSpaceAfterSemicolonInForStatements: options?.insertSpaceAfterSemicolonInForStatements ?? true,
    insertSpaceBeforeAndAfterBinaryOperators: options?.insertSpaceBeforeAndAfterBinaryOperators ?? true,
    insertSpaceAfterKeywordsInControlFlowStatements: options?.insertSpaceAfterKeywordsInControlFlowStatements ?? true,
    insertSpaceAfterFunctionKeywordForAnonymousFunctions: options?.insertSpaceAfterFunctionKeywordForAnonymousFunctions ?? false,
    insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: options?.insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets ?? false,
    insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces: options?.insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces ?? false,
    placeOpenBraceOnNewLineForFunctions: options?.placeOpenBraceOnNewLineForFunctions ?? false,
    placeOpenBraceOnNewLineForControlBlocks: options?.placeOpenBraceOnNewLineForControlBlocks ?? false,
  };
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || limit === undefined) return DEFAULT_DIAGNOSTICS_LIMIT;
  if (limit < 1) return 1;
  if (limit > MAX_DIAGNOSTICS_LIMIT) return MAX_DIAGNOSTICS_LIMIT;
  return Math.floor(limit);
}

function sortAndLimitDiagnostics(diagnostics: Diagnostic[], limit: number): Diagnostic[] {
  const sorted = [...diagnostics].sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.column - b.column;
  });
  return sorted.slice(0, limit);
}

function mapEslintMessage(msg: Linter.LintMessage, relativePath: string): Diagnostic {
  const severity: DiagnosticSeverity = msg.severity === 2 ? 'error' : 'warning';
  return {
    file: relativePath,
    line: Math.max(1, msg.line ?? 1),
    column: Math.max(1, msg.column ?? 1),
    message: msg.message,
    code: msg.ruleId ?? 'eslint',
    severity,
    source: 'eslint',
    ruleId: msg.ruleId ?? undefined,
  };
}
