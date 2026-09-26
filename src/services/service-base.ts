import ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import { normalizePath } from '../paths.js';
import { FileManager } from '../file-manager.js';
import { getOffset, getLineColumn } from '../position-utils.js';
import type { FileEdits, FormatOptions } from '../types.js';

/**
 * The compiler plumbing every group of language operations needs: the language
 * service itself, the file cache, and the conversions between the line/column
 * coordinates callers speak and the offsets the compiler speaks.
 *
 * Split out so navigation, diagnostics, refactoring and structure can each be
 * read on their own without the other three in the way.
 */
export abstract class LanguageServiceBase {
  protected service: ts.LanguageService;
  protected fileManager: FileManager;
  protected projectRoot: string;
  protected compilerOptions: ts.CompilerOptions;
  protected configPath: string;

  /**
   * @param projectRoot - Directory the file set is resolved and reported against.
   * @param configPath - The tsconfig governing this project. Defaults to the
   *   one in the project root; a nested config (for example tests/tsconfig.json)
   *   is passed explicitly so its files are checked under its own options.
   */
  constructor(projectRoot: string, configPath?: string) {
    this.projectRoot = path.resolve(projectRoot).replace(/[\\\/]+$/, '');
    this.configPath = configPath
      ? path.resolve(configPath)
      : path.join(this.projectRoot, 'tsconfig.json');
    this.compilerOptions = this.loadProjectConfig().options;
    // Re-resolving on every refresh keeps the project in step with tsconfig
    // edits, and costs one config read in place of a full directory walk.
    this.fileManager = new FileManager(
      this.projectRoot,
      () => this.loadProjectConfig().fileNames
    );
    this.service = this.createLanguageService();
  }

  /**
   * Loads the tsconfig governing this project. Returns compiler options and,
   * when a tsconfig is present, the fully-resolved list of files it includes.
   */
  protected loadProjectConfig(): {
    options: ts.CompilerOptions;
    fileNames: string[] | null;
  } {
    const configPath = this.configPath;

    if (fs.existsSync(configPath)) {
      const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
      if (configFile.error) {
        console.error(
          `Warning: failed to read tsconfig.json: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`
        );
        return { options: this.defaultCompilerOptions(), fileNames: null };
      }

      // Relative include/exclude globs resolve against the config's own
      // directory, which is not the project root for a nested tsconfig.
      const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(configPath)
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
   * Adopts compiler options that changed on disk, rebuilding if they did.
   *
   * A branch switch can bring a different tsconfig — strict flipped, a new
   * target, an added path alias. The host reads the options field through a
   * closure, so assigning it is enough to change how new work is compiled, but
   * every source file already parsed under the old options stays cached in the
   * document registry. Replacing the language service is what discards them.
   *
   * Returns whether it rebuilt, so a caller can order the rest of its refresh
   * around the fact that the file cache was just invalidated.
   */
  protected reloadConfigIfChanged(): boolean {
    const reloaded = this.loadProjectConfig().options;
    if (sameCompilerOptions(reloaded, this.compilerOptions)) return false;

    this.compilerOptions = reloaded;
    this.service = this.createLanguageService();
    return true;
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
  protected createLanguageService(): ts.LanguageService {
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
  protected getContentForPath(filePath: string): string | undefined {
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
  protected toOffset(filePath: string, line: number, column: number): number {
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
  protected toLineColumn(filePath: string, offset: number): { line: number; column: number } {
    const content = this.getContentForPath(filePath);
    if (!content) return { line: 1, column: 1 };
    return getLineColumn(content, offset);
  }

  /**
   * The trimmed source line at a position, so navigation results show what
   * they point at instead of only where it is.
   */
  protected lineText(filePath: string, line: number): string | undefined {
    const content = this.getContentForPath(filePath);
    if (content === undefined) return undefined;
    return content.split('\n')[line - 1]?.trim();
  }

  /**
   * The lines surrounding a position, for callers that ask for context.
   */
  protected surroundingLines(
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

  /** A project-relative path with forward slashes, as results report it. */
  protected toRelative(fileName: string): string {
    return normalizePath(path.relative(this.projectRoot, fileName));
  }

  /** Converts compiler text changes into line/column edits for display. */
  protected toFileEdits(changes: readonly ts.FileTextChanges[]): FileEdits[] {
    return changes.map((change) => ({
      file: this.toRelative(change.fileName),
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
  protected writeFileTextChanges(changes: readonly ts.FileTextChanges[]): {
    filesModified: string[];
    totalEdits: number;
  } {
    const filesModified: string[] = [];
    let totalEdits = 0;

    for (const change of changes) {
      const relativePath = this.toRelative(change.fileName);
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
   * Maps a declaration span start to the start of that declaration's name,
   * using the navigation tree which reports both. Falls back to the original
   * offset when no matching entry exists.
   */
  protected toNameSpanStart(
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
 * Whether two sets of compiler options would compile the same way.
 *
 * Option values are primitives or arrays of them once tsconfig is parsed, so
 * comparing a key-sorted serialization is exact here and avoids a deep-equality
 * helper. Key order varies between parses, hence the sort.
 */
function sameCompilerOptions(left: ts.CompilerOptions, right: ts.CompilerOptions): boolean {
  const serialize = (options: ts.CompilerOptions): string =>
    JSON.stringify(
      Object.entries(options)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, value ?? null])
    );

  return serialize(left) === serialize(right);
}

/**
 * Format settings shared by the formatter and every code action, so applied
 * fixes come out looking like the rest of the file.
 */
export function toFormatSettings(options?: FormatOptions): ts.FormatCodeSettings {
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
