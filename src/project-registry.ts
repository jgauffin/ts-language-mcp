import * as path from 'path';
import * as fs from 'fs';
import ts from 'typescript';
import { TypeScriptLanguageService } from './language-service.js';
import { GitState } from './git-state.js';
import { normalizePath } from './paths.js';
import type {
  LanguageIntelligence,
  DiagnosticOptions,
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
 * This delegates to per-config services rather than inheriting from one.
 * Inheritance made an un-routed method silently answer from the registry's own
 * root-config state — a program that did not contain the file being asked
 * about, or module resolution missing the governing config's "paths" aliases.
 * Implementing the interface instead means the compiler rejects a method that
 * was never routed, so the mistake cannot recur.
 *
 * Behaviour is unchanged for the single-tsconfig case: one project is
 * discovered and every call goes to it.
 */
export class ProjectRegistry implements LanguageIntelligence {
  private projects: TypeScriptLanguageService[] = [];
  private fallback: TypeScriptLanguageService | null = null;
  private rootDir: string;
  private discoveredConfigs: string[] = [];
  private gitState: GitState;
  /** Config paths in the order projects were built, parallel to `projects`. */
  private projectConfigs: string[] = [];

  constructor(projectRoot: string) {
    this.rootDir = path.resolve(projectRoot).replace(/[\\\/]+$/, '');
    this.gitState = new GitState(this.rootDir);
    this.syncProjects();
  }

  /**
   * Makes the set of projects match the tsconfigs currently on disk.
   *
   * A branch can add or delete a tsconfig, which changes which projects should
   * exist at all. Services for configs that are still present are kept rather
   * than rebuilt, so a checkout that touches one config does not cost a
   * re-index of every other project.
   */
  private syncProjects(): void {
    this.discoveredConfigs = this.discoverConfigs();

    const rootConfig = path.join(this.rootDir, 'tsconfig.json');
    const configs = this.discoveredConfigs.length > 0 ? this.discoveredConfigs : [rootConfig];

    const existing = new Map<string, TypeScriptLanguageService>();
    this.projectConfigs.forEach((configPath, index) => {
      const project = this.projects[index];
      if (project) existing.set(configPath, project);
    });

    this.projects = configs.map(
      (configPath) =>
        existing.get(configPath) ?? new TypeScriptLanguageService(this.rootDir, configPath)
    );
    this.projectConfigs = configs;
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

  /** The project a caller gets when no file narrows the question. */
  private rootProject(): TypeScriptLanguageService {
    return this.projects[0] ?? this.unconfiguredProject();
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

  // ── Project identity and configuration ──

  /**
   * These answer per file, because which tsconfig governs a file decides its
   * options, its program and how its imports resolve. Without a file there is
   * no governing config to consult, so the root project answers.
   */
  getConfigPath(filePath?: string): string {
    return filePath ? this.serviceFor(filePath).getConfigPath() : this.rootProject().getConfigPath();
  }

  isUnconfigured(filePath?: string): boolean {
    return filePath ? this.isFileUnconfigured(filePath) : this.rootProject().isUnconfigured();
  }

  getCompilerOptions(filePath?: string): ts.CompilerOptions {
    return filePath
      ? this.serviceFor(filePath).getCompilerOptions()
      : this.rootProject().getCompilerOptions();
  }

  getProgram(filePath?: string): ts.Program | undefined {
    return filePath
      ? this.serviceFor(filePath).getProgram()
      : this.rootProject().getProgram();
  }

  getProjectRoot(): string {
    return this.rootDir;
  }

  resolveModule(specifier: string, containingFile: string): string | undefined {
    return this.serviceFor(containingFile).resolveModule(specifier, containingFile);
  }

  // ── File cache ──

  /**
   * A file may be listed by more than one config, so every project holding it
   * has to see the change; otherwise one of them keeps serving stale text.
   */
  loadFile(filePath: string): void {
    for (const project of this.projectsHolding(filePath)) {
      project.loadFile(filePath);
    }
  }

  updateFile(filePath: string, content: string): void {
    for (const project of this.projectsHolding(filePath)) {
      project.updateFile(filePath, content);
    }
  }

  /** Every project whose config lists the file, or its governing one alone. */
  private projectsHolding(filePath: string): TypeScriptLanguageService[] {
    const target = cacheKeyFor(this.rootDir, filePath);
    const holders = this.allProjects().filter((project) =>
      project.getProjectFiles().some((f) => cacheKeyFor(this.rootDir, f) === target)
    );

    return holders.length > 0 ? holders : [this.serviceFor(filePath)];
  }

  /**
   * Brings every project back in line with disk.
   *
   * When the working tree has moved to different code, the set of projects is
   * reconciled first: a branch may have added or deleted a tsconfig, and each
   * surviving project then re-reads its own options before syncing its files.
   */
  refreshChangedFiles(): void {
    if (this.gitState.hasChanged()) {
      this.syncProjects();
      // Files this held may now belong to a config that arrived with the
      // branch, so its inferred-option answers are no longer the best available.
      this.fallback = null;
    }

    for (const project of this.allProjects()) {
      project.refreshChangedFiles();
    }
    this.fallback?.refreshChangedFiles();
  }

  /**
   * Whether the working tree has moved since the last refresh.
   *
   * Lets a throttled caller skip its own timer for a checkout without
   * consuming the change; `refreshChangedFiles` is what acts on it.
   */
  hasGitStateChanged(): boolean {
    return this.gitState.isStale();
  }

  /**
   * Refreshes as soon as the working tree moves, rather than waiting for the
   * next request to notice. Returns a function that stops watching.
   *
   * The callback decides how to run the refresh — a caller with in-flight work
   * needs it serialized against that work, which is not something this can
   * know.
   */
  watchForBranchChanges(onChange: () => void): () => void {
    return this.gitState.watch(onChange);
  }

  takeDiscardedEdits(): string[] {
    const seen = new Set<string>();
    const discarded: string[] = [];

    const projects = this.fallback ? [...this.allProjects(), this.fallback] : this.allProjects();
    for (const project of projects) {
      for (const file of project.takeDiscardedEdits()) {
        const key = cacheKeyFor(this.rootDir, file);
        if (seen.has(key)) continue;
        seen.add(key);
        discarded.push(file);
      }
    }

    return discarded;
  }

  // ── Project-wide operations, merged across configs ──

  getProjectFiles(): string[] {
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

  getFileContent(filePath: string): string | undefined {
    for (const project of this.allProjects()) {
      const content = project.getFileContent(filePath);
      if (content !== undefined) return content;
    }
    return undefined;
  }

  async getAllDiagnostics(
    severity?: DiagnosticSeverity,
    options?: DiagnosticOptions
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

  /** Config problems from every discovered project, not just the root one. */
  getCompilerOptionsDiagnostics(): Diagnostic[] {
    const seen = new Set<string>();
    const all: Diagnostic[] = [];

    for (const project of this.allProjects()) {
      for (const diagnostic of project.getCompilerOptionsDiagnostics()) {
        const key = `${diagnostic.file}:${diagnostic.code}:${diagnostic.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(diagnostic);
      }
    }

    return all;
  }

  getWorkspaceSymbols(
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

  getHover(filePath: string, line: number, column: number): string | undefined {
    return this.serviceFor(filePath).getHover(filePath, line, column);
  }

  getDefinitions(filePath: string, line: number, column: number): FilePosition[] {
    return this.serviceFor(filePath).getDefinitions(filePath, line, column);
  }

  getDefinition(
    filePath: string,
    line: number,
    column: number
  ): FilePosition | undefined {
    return this.serviceFor(filePath).getDefinition(filePath, line, column);
  }

  getReferences(
    filePath: string,
    line: number,
    column: number,
    contextLines = 0
  ): ReferenceInfo[] {
    return this.serviceFor(filePath).getReferences(filePath, line, column, contextLines);
  }

  async getDiagnostics(
    filePath: string,
    options?: DiagnosticOptions
  ): Promise<Diagnostic[]> {
    return this.serviceFor(filePath).getDiagnostics(filePath, options);
  }

  getSymbols(filePath: string): SymbolInfo[] {
    return this.serviceFor(filePath).getSymbols(filePath);
  }

  getCompletions(filePath: string, line: number, column: number): CompletionItem[] {
    return this.serviceFor(filePath).getCompletions(filePath, line, column);
  }

  getSignature(
    filePath: string,
    line: number,
    column: number
  ): SignatureInfo | undefined {
    return this.serviceFor(filePath).getSignature(filePath, line, column);
  }

  async analyzePosition(
    filePath: string,
    line: number,
    column: number
  ): Promise<PositionAnalysis> {
    return this.serviceFor(filePath).analyzePosition(filePath, line, column);
  }

  getImplementations(filePath: string, line: number, column: number): FilePosition[] {
    return this.serviceFor(filePath).getImplementations(filePath, line, column);
  }

  getImports(filePath: string): ImportInfo[] {
    return this.serviceFor(filePath).getImports(filePath);
  }

  getOutline(filePath: string): OutlineItem[] {
    return this.serviceFor(filePath).getOutline(filePath);
  }

  getRenameLocations(
    filePath: string,
    line: number,
    column: number,
    newName: string
  ): RenameLocation[] {
    return this.serviceFor(filePath).getRenameLocations(filePath, line, column, newName);
  }

  applyRename(
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

  getCallHierarchy(
    filePath: string,
    line: number,
    column: number,
    direction: 'incoming' | 'outgoing'
  ): CallHierarchyCall[] {
    return this.serviceFor(filePath).getCallHierarchy(filePath, line, column, direction);
  }

  getTypeHierarchy(
    filePath: string,
    line: number,
    column: number,
    direction: 'supertypes' | 'subtypes'
  ): TypeHierarchyItem[] {
    return this.serviceFor(filePath).getTypeHierarchy(filePath, line, column, direction);
  }

  formatDocument(
    filePath: string,
    options?: FormatOptions,
    includeContent = false
  ): FormatResult {
    const result = this.serviceFor(filePath).formatDocument(filePath, options, includeContent);
    if (result.changeCount > 0) this.refreshChangedFiles();
    return result;
  }

  getCodeFixes(
    filePath: string,
    line: number,
    column: number,
    errorCodes?: number[]
  ): CodeFix[] {
    return this.serviceFor(filePath).getCodeFixes(filePath, line, column, errorCodes);
  }

  applyCodeFix(
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

  organizeImports(filePath: string, apply = false): OrganizeImportsResult {
    const result = this.serviceFor(filePath).organizeImports(filePath, apply);
    if (result.applied) this.refreshChangedFiles();
    return result;
  }

  getTypeDefinition(filePath: string, line: number, column: number): FilePosition[] {
    return this.serviceFor(filePath).getTypeDefinition(filePath, line, column);
  }

  getModuleDependencies(
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
