import ts from 'typescript';
import * as fs from 'fs';
import { RefactorService } from './services/refactor-service.js';
import type { LanguageIntelligence } from './types.js';

/**
 * TypeScript code intelligence for a single tsconfig.
 *
 * The operations themselves live in the service layers this composes —
 * navigation, diagnostics, structure and refactoring — each readable without
 * the other three in the way. What remains here is the project identity every
 * layer shares, and the file cache they all read through.
 *
 * Answers every question from its own config, so the `filePath` arguments that
 * LanguageIntelligence declares for config-dependent lookups are accepted and
 * ignored here; routing them across several configs is ProjectRegistry's job.
 *
 * @example
 * const service = new TypeScriptLanguageService('/path/to/project');
 * const hover = service.getHover('src/index.ts', 10, 5);
 */
export class TypeScriptLanguageService extends RefactorService implements LanguageIntelligence {
  /**
   * The tsconfig this project is checked against.
   *
   * The file argument is what a multi-config registry routes on; a single
   * project has one config and answers the same for every file.
   */
  getConfigPath(_filePath?: string): string {
    return this.configPath;
  }

  /** True when no tsconfig backs this project, so options are inferred. */
  isUnconfigured(_filePath?: string): boolean {
    return !fs.existsSync(this.configPath);
  }

  getCompilerOptions(_filePath?: string): ts.CompilerOptions {
    return this.compilerOptions;
  }

  getProgram(_filePath?: string): ts.Program | undefined {
    return this.service.getProgram();
  }

  getProjectRoot(): string {
    return this.projectRoot;
  }

  // ── Delegated file management ──

  loadFile(filePath: string): void {
    this.fileManager.loadFile(filePath);
  }

  updateFile(filePath: string, content: string): void {
    this.fileManager.updateFile(filePath, content);
  }

  /**
   * Brings the project back in line with disk, config first.
   *
   * Order matters: adopting changed compiler options replaces the language
   * service, discarding every source file cached under the old ones. Syncing
   * files first would hand that rebuild a cache it immediately throws away, so
   * the project would answer from nothing until the following refresh.
   */
  refreshChangedFiles(): void {
    this.reloadConfigIfChanged();
    this.fileManager.refreshChangedFiles();
  }

  takeDiscardedEdits(): string[] {
    return this.fileManager.takeDiscardedEdits();
  }

  getProjectFiles(): string[] {
    return this.fileManager.getProjectFiles();
  }

  getFileContent(filePath: string): string | undefined {
    return this.fileManager.getFileContent(filePath);
  }
}
