import * as path from 'path';
import * as fs from 'fs';
import { TypeScriptLanguageService } from './language-service.js';
import { normalizePath } from './paths.js';
import type {
  Diagnostic,
  DiagnosticSeverity,
  AllDiagnosticsResult,
  FilePosition,
  ReferenceInfo,
  SymbolInfo,
  CompletionItem,
  SignatureInfo,
  PositionAnalysis,
  ImportInfo,
  OutlineItem,
  RenameLocation,
  RenameResult,
  CallHierarchyCall,
  TypeHierarchyItem,
  FormatOptions,
  FormatResult,
  WorkspaceSymbol,
  CodeFix,
  ApplyEditsResult,
  OrganizeImportsResult,
  ModuleDependenciesResult,
} from './types.js';

/** Directories that never hold project sources worth a config scan. */
const SKIP_DIRS = ['node_modules', 'dist', 'build', 'coverage', 'out'];

/**
 * Directories holding sample projects for a test suite. Their tsconfigs
 * describe fixtures, not this project, so treating them as real projects would
 * pull throwaway code into every project-wide report.
 */
const FIXTURE_DIRS = ['fixtures', '__fixtures__', 'testdata', '__mocks__'];

/** How deep below the root to look for nested tsconfigs. */
const MAX_CONFIG_DEPTH = 4;

/**
 * Routes each request to the tsconfig that actually governs the file.
 *
 * A repository commonly splits its sources across several tsconfigs — the
 * classic case being tests, which sit outside the root config and declare
 * their runner's globals in a config of their own. Checking such a file
 * against the root config reports every one of those globals as an undefined
 * name, so the answer describes a project that does not exist.
 *
 * Behaviour is unchanged for the single-tsconfig case: one project is
 * discovered and every call goes to it.
 */
export class ProjectRegistry extends TypeScriptLanguageService {
  private projects: TypeScriptLanguageService[] = [];
  private fallback: TypeScriptLanguageService | null = null;
  private rootDir: string;
  private discoveredConfigs: string[];

  constructor(projectRoot: string) {
    super(projectRoot);
    this.rootDir = path.resolve(projectRoot).replace(/[\\\/]+$/, '');
    this.discoveredConfigs = this.discoverConfigs();

    // Every config gets its own service, the root one included. Delegating to
    // a sibling rather than to `super` keeps each override a plain fan-out; a
    // registry that also acted as its own root project would re-enter its own
    // overrides and recurse without end.
    const rootConfig = path.join(this.rootDir, 'tsconfig.json');
    const configs = this.discoveredConfigs.length > 0 ? this.discoveredConfigs : [rootConfig];

    for (const configPath of configs) {
      this.projects.push(new TypeScriptLanguageService(this.rootDir, configPath));
    }
  }

  /** Every tsconfig at or below the root, nearest ones first. */
  private discoverConfigs(): string[] {
    const found: string[] = [];

    const walk = (dir: string, depth: number): void => {
      if (depth > MAX_CONFIG_DEPTH) return;

      const candidate = path.join(dir, 'tsconfig.json');
      if (fs.existsSync(candidate)) found.push(candidate);

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (SKIP_DIRS.includes(entry.name) || entry.name.startsWith('.')) continue;
        if (FIXTURE_DIRS.includes(entry.name)) continue;
        walk(path.join(dir, entry.name), depth + 1);
      }
    };

    walk(this.rootDir, 0);
    return found;
  }

  /** Every discovered project, the root one first. */
  private allProjects(): TypeScriptLanguageService[] {
    return this.projects;
  }

  /**
   * The project whose config lists this file, or undefined when none does.
   * Deeper configs win, so tests/tsconfig.json beats a root config that also
   * happens to match.
   */
  private findGoverning(filePath: string): TypeScriptLanguageService | undefined {
    const target = cacheKeyFor(this.rootDir, filePath);

    let best: TypeScriptLanguageService | undefined;
    let bestDepth = -1;

    for (const project of this.allProjects()) {
      const owns = project
        .getProjectFiles()
        .some((f) => cacheKeyFor(this.rootDir, f) === target);
      if (!owns) continue;

      const depth = normalizePath(project.getConfigPath()).split('/').length;
      if (depth > bestDepth) {
        best = project;
        bestDepth = depth;
      }
    }

    return best;
  }

  /**
   * A project for files no config governs, using inferred options.
   *
   * Refusing to answer would be the safer-looking choice, but it leaves the
   * caller with nothing; answering with a stated caveat lets them judge the
   * result. Built lazily because most projects never need it.
   */
  private unconfiguredProject(): TypeScriptLanguageService {
    if (!this.fallback) {
      this.fallback = new TypeScriptLanguageService(
        this.rootDir,
        path.join(this.rootDir, '__no_tsconfig__.json')
      );
    }
    return this.fallback;
  }

  /**
   * The service to answer for this file: its governing project, or the
   * inferred-options fallback.
   */
  serviceFor(filePath: string): TypeScriptLanguageService {
    const governing = this.findGoverning(filePath);
    if (governing) return governing;

    const fallback = this.unconfiguredProject();
    fallback.loadFile(filePath);
    return fallback;
  }

  /** True when no discovered tsconfig lists this file. */
  isFileUnconfigured(filePath: string): boolean {
    return this.findGoverning(filePath) === undefined;
  }

  /**
   * Explains that a file is analysed without a governing config, and names the
   * config that would most likely need to cover it.
   *
   * Listing every config found would bury the actionable part, so this points
   * at the nearest one above the file — the config a developer would edit.
   */
  unconfiguredWarning(filePath: string): string {
    const nearest = this.nearestConfigAbove(filePath);
    const suggestion = nearest
      ? `The nearest tsconfig is ${nearest}; add this file to its "include", ` +
        `or give the directory its own tsconfig.`
      : `No tsconfig covers this directory.`;

    return (
      `"${filePath}" is not covered by any tsconfig, so it was analysed with ` +
      `inferred compiler options. Unresolved-name errors may therefore be false ` +
      `positives — global declarations a real config would supply are missing. ` +
      suggestion
    );
  }

  /** The closest discovered config at or above a file, project-relative. */
  private nearestConfigAbove(filePath: string): string | undefined {
    const fileDir = normalizePath(path.dirname(path.resolve(this.rootDir, filePath)));

    let best: string | undefined;
    let bestLength = -1;

    for (const configPath of this.discoveredConfigs) {
      const configDir = normalizePath(path.dirname(configPath));
      const within = fileDir === configDir || fileDir.startsWith(`${configDir}/`);
      if (!within || configDir.length <= bestLength) continue;

      best = normalizePath(path.relative(this.rootDir, configPath));
      bestLength = configDir.length;
    }

    return best;
  }

  /** True when the file exists on disk anywhere under the root. */
  fileExistsOnDisk(filePath: string): boolean {
    return fs.existsSync(path.resolve(this.rootDir, filePath));
  }

  // ── Project-wide operations, merged across configs ──

  override getProjectFiles(): string[] {
    const seen = new Set<string>();
    const files: string[] = [];

    for (const project of this.allProjects()) {
      for (const file of project.getProjectFiles()) {
        const key = cacheKeyFor(this.rootDir, file);
        if (seen.has(key)) continue;
        seen.add(key);
        files.push(file);
      }
    }

    return files;
  }

  override getFileContent(filePath: string): string | undefined {
    for (const project of this.allProjects()) {
      const content = project.getFileContent(filePath);
      if (content !== undefined) return content;
    }
    return undefined;
  }

  override refreshChangedFiles(): void {
    for (const project of this.allProjects()) {
      project.refreshChangedFiles();
    }
  }

  override async getAllDiagnostics(
    severity?: DiagnosticSeverity,
    options?: { includeEslint?: boolean; limit?: number; includeSuggestions?: boolean }
  ): Promise<AllDiagnosticsResult> {
    const merged: AllDiagnosticsResult = {
      files: {},
      summary: {
        errors: 0,
        warnings: 0,
        suggestions: 0,
        messages: 0,
        total: 0,
        returned: 0,
        truncated: false,
      },
    };

    const config: Diagnostic[] = [];
    const skipped: string[] = [];
    const seenFiles = new Set<string>();

    for (const project of this.allProjects()) {
      const result = await project.getAllDiagnostics(severity, options);

      for (const [file, diagnostics] of Object.entries(result.files)) {
        const key = cacheKeyFor(this.rootDir, file);
        if (seenFiles.has(key)) continue;
        seenFiles.add(key);
        merged.files[file] = diagnostics;
      }

      merged.summary.errors += result.summary.errors;
      merged.summary.warnings += result.summary.warnings;
      merged.summary.suggestions += result.summary.suggestions;
      merged.summary.messages += result.summary.messages;
      merged.summary.total += result.summary.total;
      merged.summary.returned += result.summary.returned;
      merged.summary.truncated ||= result.summary.truncated;

      if (result.config) config.push(...result.config);
      if (result.skippedFiles) skipped.push(...result.skippedFiles);
    }

    return {
      ...merged,
      ...(config.length > 0 ? { config } : {}),
      ...(skipped.length > 0 ? { skippedFiles: skipped } : {}),
    };
  }

  override getWorkspaceSymbols(
    query: string,
    maxResults: number = 100,
    file?: string
  ): WorkspaceSymbol[] {
    if (file) return this.serviceFor(file).getWorkspaceSymbols(query, maxResults, file);

    const results: WorkspaceSymbol[] = [];
    const seen = new Set<string>();

    for (const project of this.allProjects()) {
      for (const symbol of project.getWorkspaceSymbols(query, maxResults)) {
        const key = `${cacheKeyFor(this.rootDir, symbol.file)}:${symbol.line}:${symbol.column}:${symbol.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(symbol);
      }
    }

    return results.slice(0, maxResults);
  }

  // ── File-scoped operations, routed to the governing project ──

  override getHover(filePath: string, line: number, column: number): string | undefined {
    return this.serviceFor(filePath).getHover(filePath, line, column);
  }

  override getDefinitions(filePath: string, line: number, column: number): FilePosition[] {
    return this.serviceFor(filePath).getDefinitions(filePath, line, column);
  }

  override getDefinition(
    filePath: string,
    line: number,
    column: number
  ): FilePosition | undefined {
    return this.serviceFor(filePath).getDefinition(filePath, line, column);
  }

  override getReferences(
    filePath: string,
    line: number,
    column: number,
    contextLines = 0
  ): ReferenceInfo[] {
    return this.serviceFor(filePath).getReferences(filePath, line, column, contextLines);
  }

  override async getDiagnostics(
    filePath: string,
    options?: { includeEslint?: boolean; limit?: number; includeSuggestions?: boolean }
  ): Promise<Diagnostic[]> {
    return this.serviceFor(filePath).getDiagnostics(filePath, options);
  }

  override getSymbols(filePath: string): SymbolInfo[] {
    return this.serviceFor(filePath).getSymbols(filePath);
  }

  override getCompletions(filePath: string, line: number, column: number): CompletionItem[] {
    return this.serviceFor(filePath).getCompletions(filePath, line, column);
  }

  override getSignature(
    filePath: string,
    line: number,
    column: number
  ): SignatureInfo | undefined {
    return this.serviceFor(filePath).getSignature(filePath, line, column);
  }

  override async analyzePosition(
    filePath: string,
    line: number,
    column: number
  ): Promise<PositionAnalysis> {
    return this.serviceFor(filePath).analyzePosition(filePath, line, column);
  }

  override getImplementations(filePath: string, line: number, column: number): FilePosition[] {
    return this.serviceFor(filePath).getImplementations(filePath, line, column);
  }

  override getImports(filePath: string): ImportInfo[] {
    return this.serviceFor(filePath).getImports(filePath);
  }

  override getOutline(filePath: string): OutlineItem[] {
    return this.serviceFor(filePath).getOutline(filePath);
  }

  override getRenameLocations(
    filePath: string,
    line: number,
    column: number,
    newName: string
  ): RenameLocation[] {
    return this.serviceFor(filePath).getRenameLocations(filePath, line, column, newName);
  }

  override applyRename(
    filePath: string,
    line: number,
    column: number,
    newName: string
  ): RenameResult {
    const result = this.serviceFor(filePath).applyRename(filePath, line, column, newName);
    // Other projects may hold the same files; bring them back in line with disk.
    if (result.success) this.refreshChangedFiles();
    return result;
  }

  override getCallHierarchy(
    filePath: string,
    line: number,
    column: number,
    direction: 'incoming' | 'outgoing'
  ): CallHierarchyCall[] {
    return this.serviceFor(filePath).getCallHierarchy(filePath, line, column, direction);
  }

  override getTypeHierarchy(
    filePath: string,
    line: number,
    column: number,
    direction: 'supertypes' | 'subtypes'
  ): TypeHierarchyItem[] {
    return this.serviceFor(filePath).getTypeHierarchy(filePath, line, column, direction);
  }

  override formatDocument(
    filePath: string,
    options?: FormatOptions,
    includeContent = false
  ): FormatResult {
    const result = this.serviceFor(filePath).formatDocument(filePath, options, includeContent);
    if (result.changeCount > 0) this.refreshChangedFiles();
    return result;
  }

  override getCodeFixes(
    filePath: string,
    line: number,
    column: number,
    errorCodes?: number[]
  ): CodeFix[] {
    return this.serviceFor(filePath).getCodeFixes(filePath, line, column, errorCodes);
  }

  override applyCodeFix(
    filePath: string,
    line: number,
    column: number,
    fixName: string,
    applyToAll = false
  ): ApplyEditsResult {
    const result = this.serviceFor(filePath).applyCodeFix(
      filePath,
      line,
      column,
      fixName,
      applyToAll
    );
    if (result.applied) this.refreshChangedFiles();
    return result;
  }

  override organizeImports(filePath: string, apply = false): OrganizeImportsResult {
    const result = this.serviceFor(filePath).organizeImports(filePath, apply);
    if (result.applied) this.refreshChangedFiles();
    return result;
  }

  override getTypeDefinition(filePath: string, line: number, column: number): FilePosition[] {
    return this.serviceFor(filePath).getTypeDefinition(filePath, line, column);
  }

  override getModuleDependencies(
    filePath: string,
    options?: {
      direction?: 'imports' | 'importedBy' | 'both';
      includeExternal?: boolean;
    }
  ): ModuleDependenciesResult {
    return this.serviceFor(filePath).getModuleDependencies(filePath, options);
  }
}

/**
 * One spelling for a path, so the same file named relatively, absolutely or
 * with either slash collapses to a single key.
 */
function cacheKeyFor(root: string, filePath: string): string {
  const absolute = normalizePath(path.resolve(root, filePath));
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}
