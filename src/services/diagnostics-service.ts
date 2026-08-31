import ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import { createRequire } from 'module';
import type { ESLint, Linter } from 'eslint';
import { NavigationService } from './navigation-service.js';
import type {
  Diagnostic,
  DiagnosticSeverity,
  DiagnosticOptions,
  AllDiagnosticsResult,
} from '../types.js';

const DEFAULT_DIAGNOSTICS_LIMIT = 50;
const MAX_DIAGNOSTICS_LIMIT = 500;
const SEVERITY_RANK: Record<DiagnosticSeverity, number> = {
  error: 0,
  warning: 1,
  suggestion: 2,
  message: 3,
};

/**
 * Reports what is wrong with the code, from the compiler and — when the target
 * project has one — from ESLint.
 */
export abstract class DiagnosticsService extends NavigationService {
  private eslint: ESLint | null = null;
  private eslintNotified = false;
  private eslintErrorNotified = false;
  private eslintLoaded = false;

  /**
   * Attempts to load ESLint from the target project's node_modules.
   * ESLint is optional — absence is not an error; TS diagnostics still flow.
   *
   * Loaded on first use rather than in a constructor, because a base class
   * cannot run its own initialisation after a subclass constructor body.
   */
  private getEslint(): ESLint | null {
    if (this.eslintLoaded) return this.eslint;
    this.eslintLoaded = true;

    try {
      const require = createRequire(path.join(this.projectRoot, 'package.json'));
      const eslintModule = require('eslint') as typeof import('eslint');
      this.eslint = new eslintModule.ESLint({
        cwd: this.projectRoot,
        errorOnUnmatchedPattern: false,
      });
    } catch {
      if (!this.eslintNotified) {
        console.error(
          'Info: ESLint not found in target project — skipping lint diagnostics.'
        );
        this.eslintNotified = true;
      }
      this.eslint = null;
    }

    return this.eslint;
  }

  /**
   * Returns diagnostics (errors/warnings) for a file from TypeScript and,
   * if available, ESLint. Results are sorted by severity and capped.
   */
  async getDiagnostics(
    filePath: string,
    options?: DiagnosticOptions
  ): Promise<Diagnostic[]> {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const relativePath = this.toRelative(absolutePath);
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
        source: 'typescript' as const,
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
    const eslint = this.getEslint();
    if (!eslint) return [];

    const fileEntry = this.fileManager.getFileEntry(absolutePath);
    const content = fileEntry?.content ?? (fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf-8') : null);
    if (content === null) return [];

    try {
      const isIgnored = await eslint.isPathIgnored(absolutePath);
      if (isIgnored) return [];

      const results = await eslint.lintText(content, { filePath: absolutePath });
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

  protected mapDiagnosticCategory(category: ts.DiagnosticCategory): DiagnosticSeverity {
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

  async getAllDiagnostics(
    severity?: DiagnosticSeverity,
    options?: DiagnosticOptions
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
      } catch {
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

  /** Compiler option problems, which otherwise only reach stderr at startup. */
  getCompilerOptionsDiagnostics(): Diagnostic[] {
    return this.service.getCompilerOptionsDiagnostics().map((diag) => ({
      file: diag.file ? this.toRelative(diag.file.fileName) : 'tsconfig.json',
      line: 1,
      column: 1,
      message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
      code: diag.code,
      severity: this.mapDiagnosticCategory(diag.category),
      source: 'typescript' as const,
    }));
  }

  /**
   * The error codes covering an offset, with the span they occupy.
   *
   * Falling back to the whole line matters because a caller points at the
   * symbol they can see, which is rarely the exact character the compiler
   * anchored the error to.
   */
  protected diagnosticsAt(
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
}

export function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || limit === undefined) return DEFAULT_DIAGNOSTICS_LIMIT;
  if (limit < 1) return 1;
  if (limit > MAX_DIAGNOSTICS_LIMIT) return MAX_DIAGNOSTICS_LIMIT;
  return Math.floor(limit);
}

export function sortAndLimitDiagnostics(diagnostics: Diagnostic[], limit: number): Diagnostic[] {
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

export { MAX_DIAGNOSTICS_LIMIT };
