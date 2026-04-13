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
  CallHierarchyItem,
  CallHierarchyCall,
  TypeHierarchyItem,
  RenameResult,
  AllDiagnosticsResult,
  FormatOptions,
  FormatResult,
  WorkspaceSymbol,
} from './types.js';
import { normalizePath } from './tools.js';

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
 * Manages file state, project configuration, and translates TS APIs
 * into simpler structures for MCP consumption.
 *
 * @example
 * const service = new TypeScriptLanguageService('/path/to/project');
 * const hover = service.getHover('src/index.ts', 10, 5);
 */
export class TypeScriptLanguageService {
  private service: ts.LanguageService;
  private files: Map<string, { content: string; version: number; mtime: number }> = new Map();
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
    this.service = this.createLanguageService();
    this.indexProjectFiles();
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
      getScriptFileNames: () => Array.from(this.files.keys()),
      getScriptVersion: (fileName) =>
        this.files.get(fileName)?.version.toString() ?? '0',
      getScriptSnapshot: (fileName) => {
        const file = this.files.get(fileName);
        if (file) {
          return ts.ScriptSnapshot.fromString(file.content);
        }
        // Fallback to disk for files not yet loaded (e.g., node_modules)
        if (fs.existsSync(fileName)) {
          return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf-8'));
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
   * Indexes project files for analysis. Prefers the tsconfig's resolved file
   * list so include/exclude/files are honored; falls back to a directory
   * walker when no tsconfig is present.
   */
  private indexProjectFiles(): void {
    if (this.tsConfigFileNames && this.tsConfigFileNames.length > 0) {
      for (const fileName of this.tsConfigFileNames) {
        this.loadFile(fileName);
      }
      return;
    }
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    this.walkDirectory(this.projectRoot, extensions);
  }

  private walkDirectory(dir: string, extensions: string[]): void {
    // Skip common non-source directories and hidden directories (starting with '.')
    const skipDirs = ['node_modules', 'dist', 'build', 'coverage'];

    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!skipDirs.includes(entry.name) && !entry.name.startsWith('.')) {
          this.walkDirectory(fullPath, extensions);
        }
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        this.loadFile(fullPath);
      }
    }
  }

  /**
   * Loads a file into the service. Call when file content changes.
   */
  loadFile(filePath: string): void {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    if (!fs.existsSync(absolutePath)) return;

    const content = fs.readFileSync(absolutePath, 'utf-8');
    const mtime = fs.statSync(absolutePath).mtimeMs;
    const existing = this.files.get(absolutePath);

    this.files.set(absolutePath, {
      content,
      version: (existing?.version ?? 0) + 1,
      mtime,
    });
  }

  /**
   * Updates file content without disk I/O. Useful for unsaved changes.
   */
  updateFile(filePath: string, content: string): void {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const existing = this.files.get(absolutePath);

    this.files.set(absolutePath, {
      content,
      version: (existing?.version ?? 0) + 1,
      mtime: 0, // In-memory update, no disk mtime
    });
  }

  /**
   * Re-reads any tracked files whose mtime has changed on disk.
   * Also picks up new files and removes deleted ones.
   */
  refreshChangedFiles(): void {
    // Remove deleted files (collect keys first to avoid mutating during iteration)
    const trackedPaths = Array.from(this.files.keys());
    for (const absolutePath of trackedPaths) {
      try {
        if (!fs.existsSync(absolutePath)) {
          this.files.delete(absolutePath);
        }
      } catch {
        // Permission error or inaccessible path — remove it
        this.files.delete(absolutePath);
      }
    }

    // Walk the project to find new files and check mtimes of existing ones
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    this.refreshDirectory(this.projectRoot, extensions);
  }

  private refreshDirectory(dir: string, extensions: string[]): void {
    const skipDirs = ['node_modules', 'dist', 'build', '.git', 'coverage'];

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // Directory may have been deleted between existsSync check and readdir
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!skipDirs.includes(entry.name)) {
          this.refreshDirectory(fullPath, extensions);
        }
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        try {
          const existing = this.files.get(fullPath);
          if (!existing) {
            // New file
            this.loadFile(fullPath);
          } else {
            const currentMtime = fs.statSync(fullPath).mtimeMs;
            if (currentMtime !== existing.mtime) {
              this.loadFile(fullPath);
            }
          }
        } catch {
          // File may have been deleted between readdir and stat/read
          this.files.delete(fullPath);
        }
      }
    }
  }

  /**
   * Converts 1-based line/column to 0-based offset.
   */
  private getOffset(filePath: string, line: number, column: number): number {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const file = this.files.get(absolutePath);
    if (!file) return 0;

    const lines = file.content.split('\n');
    let offset = 0;

    for (let i = 0; i < line - 1 && i < lines.length; i++) {
      offset += lines[i].length + 1; // +1 for newline
    }

    return offset + (column - 1);
  }

  /**
   * Converts 0-based offset to 1-based line/column.
   */
  private getLineColumn(
    filePath: string,
    offset: number
  ): { line: number; column: number } {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const file = this.files.get(absolutePath);
    if (!file) return { line: 1, column: 1 };

    const content = file.content;
    let line = 1;
    let lastNewline = -1;

    for (let i = 0; i < offset && i < content.length; i++) {
      if (content[i] === '\n') {
        line++;
        lastNewline = i;
      }
    }

    return { line, column: offset - lastNewline };
  }

  /**
   * Returns hover information (type, docs) at position.
   */
  getHover(filePath: string, line: number, column: number): string | undefined {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.getOffset(filePath, line, column);

    const quickInfo = this.service.getQuickInfoAtPosition(absolutePath, offset);
    if (!quickInfo) return undefined;

    const displayParts = quickInfo.displayParts ?? [];
    const documentation = quickInfo.documentation ?? [];

    const typeInfo = displayParts.map((p) => p.text).join('');
    const docs = documentation.map((d) => d.text).join('\n');

    return docs ? `${typeInfo}\n\n${docs}` : typeInfo;
  }

  /**
   * Returns definition location for symbol at position.
   */
  getDefinition(
    filePath: string,
    line: number,
    column: number
  ): FilePosition | undefined {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.getOffset(filePath, line, column);

    const definitions = this.service.getDefinitionAtPosition(absolutePath, offset);
    if (!definitions || definitions.length === 0) return undefined;

    const def = definitions[0];
    const pos = this.getLineColumn(def.fileName, def.textSpan.start);

    return {
      file: normalizePath(path.relative(this.projectRoot, def.fileName)),
      line: pos.line,
      column: pos.column,
    };
  }

  /**
   * Returns all references to symbol at position with reference kind.
   */
  getReferences(
    filePath: string,
    line: number,
    column: number
  ): ReferenceInfo[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.getOffset(filePath, line, column);

    const references = this.service.getReferencesAtPosition(absolutePath, offset);
    if (!references) return [];

    return references.map((ref) => {
      const pos = this.getLineColumn(ref.fileName, ref.textSpan.start);
      let kind: ReferenceKind = 'read';
      const isDefinition = (ref as { isDefinition?: boolean }).isDefinition ?? false;
      if (isDefinition) {
        kind = 'definition';
      } else if (ref.isWriteAccess) {
        kind = 'write';
      }

      return {
        file: normalizePath(path.relative(this.projectRoot, ref.fileName)),
        line: pos.line,
        column: pos.column,
        kind,
        isDefinition,
      };
    });
  }

  /**
   * Returns diagnostics (errors/warnings) for a file from TypeScript and,
   * if available, ESLint. Results are sorted by severity and capped.
   */
  async getDiagnostics(
    filePath: string,
    options?: { includeEslint?: boolean; limit?: number }
  ): Promise<Diagnostic[]> {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const relativePath = normalizePath(path.relative(this.projectRoot, absolutePath));
    const includeEslint = options?.includeEslint ?? true;
    const limit = clampLimit(options?.limit);

    const syntactic = this.service.getSyntacticDiagnostics(absolutePath);
    const semantic = this.service.getSemanticDiagnostics(absolutePath);

    const tsDiagnostics: Diagnostic[] = [...syntactic, ...semantic].map((diag) => {
      const pos = diag.start
        ? this.getLineColumn(absolutePath, diag.start)
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

    const fileInfo = this.files.get(absolutePath);
    const content = fileInfo?.content ?? (fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf-8') : null);
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

  /**
   * Returns symbols (functions, classes, etc.) in a file.
   */
  getSymbols(filePath: string): SymbolInfo[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);

    const navTree = this.service.getNavigationTree(absolutePath);
    const symbols: SymbolInfo[] = [];

    const walk = (item: ts.NavigationTree, containerName?: string): void => {
      // Skip the root module node
      if (item.kind !== ts.ScriptElementKind.moduleElement) {
        const pos = this.getLineColumn(absolutePath, item.spans[0]?.start ?? 0);
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

  /**
   * Returns completions at position.
   */
  getCompletions(
    filePath: string,
    line: number,
    column: number
  ): CompletionItem[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.getOffset(filePath, line, column);

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

  /**
   * Returns signature help at position (for function calls).
   */
  getSignature(
    filePath: string,
    line: number,
    column: number
  ): SignatureInfo | undefined {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.getOffset(filePath, line, column);

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

  /**
   * Returns all indexed file paths (relative to project root).
   */
  getProjectFiles(): string[] {
    return Array.from(this.files.keys()).map((f) =>
      normalizePath(path.relative(this.projectRoot, f))
    );
  }

  /**
   * Returns the loaded compiler options.
   */
  getCompilerOptions(): ts.CompilerOptions {
    return this.compilerOptions;
  }

  /**
   * Returns file content if loaded.
   */
  getFileContent(filePath: string): string | undefined {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    return this.files.get(absolutePath)?.content;
  }

  /**
   * Returns the underlying program for AST access.
   */
  getProgram(): ts.Program | undefined {
    return this.service.getProgram();
  }

  /**
   * Returns implementations of interface/abstract method at position.
   */
  getImplementations(
    filePath: string,
    line: number,
    column: number
  ): FilePosition[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.getOffset(filePath, line, column);

    const implementations = this.service.getImplementationAtPosition(absolutePath, offset);
    if (!implementations) return [];

    return implementations.map((impl) => {
      const pos = this.getLineColumn(impl.fileName, impl.textSpan.start);
      return {
        file: normalizePath(path.relative(this.projectRoot, impl.fileName)),
        line: pos.line,
        column: pos.column,
      };
    });
  }

  /**
   * Returns all imports in a file.
   */
  getImports(filePath: string): ImportInfo[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const content = this.files.get(absolutePath)?.content;
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
          // Default import
          if (importClause.name) {
            info.defaultImport = importClause.name.text;
          }

          // Named imports or namespace import
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

  /**
   * Returns hierarchical outline of a file.
   */
  getOutline(filePath: string): OutlineItem[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const navTree = this.service.getNavigationTree(absolutePath);

    const convertItem = (item: ts.NavigationTree): OutlineItem | null => {
      // Skip the root module node
      if (item.kind === ts.ScriptElementKind.moduleElement) {
        // Return children directly
        return null;
      }

      const startPos = this.getLineColumn(absolutePath, item.spans[0]?.start ?? 0);
      const endPos = this.getLineColumn(
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

    // If root is module, return its children
    if (navTree.kind === ts.ScriptElementKind.moduleElement && navTree.childItems) {
      return navTree.childItems
        .map(convertItem)
        .filter((c): c is OutlineItem => c !== null);
    }

    const result = convertItem(navTree);
    return result ? [result] : [];
  }

  /**
   * Returns locations that would be affected by renaming symbol at position.
   */
  getRenameLocations(
    filePath: string,
    line: number,
    column: number,
    newName: string
  ): RenameLocation[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.getOffset(filePath, line, column);

    const renameInfo = this.service.getRenameInfo(absolutePath, offset);
    if (!renameInfo.canRename) return [];

    const locations = this.service.findRenameLocations(
      absolutePath,
      offset,
      false, // findInStrings
      false, // findInComments
      false  // providePrefixAndSuffixTextForRename
    );

    if (!locations) return [];

    return locations.map((loc) => {
      const pos = this.getLineColumn(loc.fileName, loc.textSpan.start);
      return {
        file: normalizePath(path.relative(this.projectRoot, loc.fileName)),
        line: pos.line,
        column: pos.column,
        originalText: renameInfo.displayName,
        newText: newName,
      };
    });
  }

  /**
   * Returns call hierarchy for symbol at position.
   */
  getCallHierarchy(
    filePath: string,
    line: number,
    column: number,
    direction: 'incoming' | 'outgoing'
  ): CallHierarchyCall[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.getOffset(filePath, line, column);

    const preparedItems = this.service.prepareCallHierarchy(absolutePath, offset);
    if (!preparedItems) return [];

    // prepareCallHierarchy can return a single item or an array
    const items = Array.isArray(preparedItems) ? preparedItems : [preparedItems];
    if (items.length === 0) return [];
    const results: CallHierarchyCall[] = [];

    if (direction === 'incoming') {
      const incoming = this.service.provideCallHierarchyIncomingCalls(absolutePath, offset);
      for (const call of incoming) {
        const fromPos = this.getLineColumn(call.from.file, call.from.selectionSpan.start);
        const fromEndPos = this.getLineColumn(
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
          },
          fromRanges: call.fromSpans.map((span) => {
            const pos = this.getLineColumn(call.from.file, span.start);
            return { line: pos.line, column: pos.column };
          }),
        });
      }
    } else {
      const outgoing = this.service.provideCallHierarchyOutgoingCalls(absolutePath, offset);
      for (const call of outgoing) {
        const toPos = this.getLineColumn(call.to.file, call.to.selectionSpan.start);
        const toEndPos = this.getLineColumn(call.to.file, call.to.span.start);
        results.push({
          to: {
            name: call.to.name,
            kind: call.to.kind,
            file: normalizePath(path.relative(this.projectRoot, call.to.file)),
            line: toEndPos.line,
            column: toEndPos.column,
            selectionLine: toPos.line,
            selectionColumn: toPos.column,
          },
          fromRanges: call.fromSpans.map((span) => {
            const pos = this.getLineColumn(absolutePath, span.start);
            return { line: pos.line, column: pos.column };
          }),
        });
      }
    }

    return results;
  }

  /**
   * Returns type hierarchy for type at position.
   */
  getTypeHierarchy(
    filePath: string,
    line: number,
    column: number,
    direction: 'supertypes' | 'subtypes'
  ): TypeHierarchyItem[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.getOffset(filePath, line, column);
    const program = this.service.getProgram();
    if (!program) return [];

    const sourceFile = program.getSourceFile(absolutePath);
    if (!sourceFile) return [];

    const checker = program.getTypeChecker();

    // Find the node at position
    const findNode = (node: ts.Node): ts.Node | undefined => {
      if (offset >= node.getStart() && offset < node.getEnd()) {
        const child = ts.forEachChild(node, findNode);
        return child || node;
      }
      return undefined;
    };

    const node = findNode(sourceFile);
    if (!node) return [];

    // Find class or interface declaration
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
      // Get heritage clauses (extends, implements)
      if (declaration.heritageClauses) {
        for (const clause of declaration.heritageClauses) {
          for (const typeNode of clause.types) {
            const type = checker.getTypeAtLocation(typeNode.expression);
            const symbol = type.getSymbol();
            if (symbol) {
              const declarations = symbol.getDeclarations();
              if (declarations && declarations.length > 0) {
                const decl = declarations[0];
                const declFile = decl.getSourceFile().fileName;
                const pos = sourceFile.getLineAndCharacterOfPosition(decl.getStart());
                results.push({
                  name: symbol.getName(),
                  kind: ts.isClassDeclaration(decl) ? 'class' : 'interface',
                  file: normalizePath(path.relative(this.projectRoot, declFile)),
                  line: pos.line + 1,
                  column: pos.character + 1,
                });
              }
            }
          }
        }
      }
    } else {
      // Find subtypes - search all files for classes/interfaces that extend/implement this
      const targetName = declaration.name.text;
      for (const [, fileInfo] of this.files) {
        const sf = ts.createSourceFile(
          'temp.ts',
          fileInfo.content,
          ts.ScriptTarget.Latest,
          true
        );

        const findSubtypes = (n: ts.Node) => {
          if (ts.isClassDeclaration(n) || ts.isInterfaceDeclaration(n)) {
            if (n.heritageClauses) {
              for (const clause of n.heritageClauses) {
                for (const typeNode of clause.types) {
                  const typeName = typeNode.expression.getText();
                  if (typeName === targetName && n.name) {
                    const pos = sf.getLineAndCharacterOfPosition(n.getStart());
                    results.push({
                      name: n.name.text,
                      kind: ts.isClassDeclaration(n) ? 'class' : 'interface',
                      file: normalizePath(path.relative(this.projectRoot, sf.fileName)),
                      line: pos.line + 1,
                      column: pos.character + 1,
                    });
                  }
                }
              }
            }
          }
          ts.forEachChild(n, findSubtypes);
        };

        findSubtypes(sf);
      }
    }

    return results;
  }

  /**
   * Applies a rename operation, modifying files in memory.
   * Returns summary of changes made.
   */
  applyRename(
    filePath: string,
    line: number,
    column: number,
    newName: string
  ): RenameResult {
    const locations = this.getRenameLocations(filePath, line, column, newName);

    if (locations.length === 0) {
      return { success: false, filesModified: [], totalChanges: 0 };
    }

    // Group locations by file
    const changesByFile = new Map<string, RenameLocation[]>();
    for (const loc of locations) {
      const existing = changesByFile.get(loc.file) ?? [];
      existing.push(loc);
      changesByFile.set(loc.file, existing);
    }

    const filesModified: string[] = [];

    // Apply changes to each file
    for (const [file, fileLocations] of changesByFile) {
      const absolutePath = path.resolve(this.projectRoot, file);
      const fileInfo = this.files.get(absolutePath);
      if (!fileInfo) continue;

      let content = fileInfo.content;

      // Sort locations in reverse order (by offset) to preserve positions
      const sortedLocations = [...fileLocations].sort((a, b) => {
        if (a.line !== b.line) return b.line - a.line;
        return b.column - a.column;
      });

      // Apply each change
      for (const loc of sortedLocations) {
        const offset = this.getOffset(file, loc.line, loc.column);
        const before = content.substring(0, offset);
        const after = content.substring(offset + loc.originalText.length);
        content = before + newName + after;
      }

      // Update the file in memory
      this.updateFile(file, content);
      filesModified.push(file);
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
    options?: { includeEslint?: boolean; limit?: number }
  ): Promise<AllDiagnosticsResult> {
    const includeEslint = options?.includeEslint ?? true;
    const limit = clampLimit(options?.limit);

    const all: Diagnostic[] = [];
    for (const absolutePath of this.files.keys()) {
      const relativePath = normalizePath(path.relative(this.projectRoot, absolutePath));
      const diagnostics = await this.getDiagnostics(relativePath, {
        includeEslint,
        limit: MAX_DIAGNOSTICS_LIMIT,
      });
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

    return { files, summary };
  }

  /**
   * Formats a document and returns the result.
   */
  formatDocument(filePath: string, options?: FormatOptions): FormatResult {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const fileInfo = this.files.get(absolutePath);

    if (!fileInfo) {
      return { formatted: false, changeCount: 0 };
    }

    // Build TypeScript format options
    const formatOptions: ts.FormatCodeSettings = {
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

    // Get formatting edits
    const edits = this.service.getFormattingEditsForDocument(absolutePath, formatOptions);

    if (edits.length === 0) {
      return { formatted: true, changeCount: 0, content: fileInfo.content };
    }

    // Apply edits in reverse order to preserve positions
    let content = fileInfo.content;
    const sortedEdits = [...edits].sort((a, b) => b.span.start - a.span.start);

    for (const edit of sortedEdits) {
      const before = content.substring(0, edit.span.start);
      const after = content.substring(edit.span.start + edit.span.length);
      content = before + edit.newText + after;
    }

    // Update file in memory
    this.updateFile(filePath, content);

    return {
      formatted: true,
      changeCount: edits.length,
      content,
    };
  }

  /**
   * Searches for symbols across the workspace using TypeScript's navigateToItems API.
   * Faster than AST traversal for simple name lookups.
   */
  getWorkspaceSymbols(query: string, maxResults: number = 100): WorkspaceSymbol[] {
    const items = this.service.getNavigateToItems(query, maxResults);

    return items.map(item => {
      const pos = this.getLineColumn(item.fileName, item.textSpan.start);
      return {
        name: item.name,
        kind: item.kind,
        file: normalizePath(path.relative(this.projectRoot, item.fileName)),
        line: pos.line,
        column: pos.column,
        containerName: item.containerName || undefined,
      };
    });
  }
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
