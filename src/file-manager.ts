import * as path from 'path';
import * as fs from 'fs';
import ts from 'typescript';
import { normalizePath } from './paths.js';

export interface FileEntry {
  /** Absolute path with forward slashes, in the casing the file has on disk. */
  fileName: string;
  content: string;
  version: number;
  mtime: number;
}

/**
 * Supplies the set of files the project config currently declares.
 * Returns null when the project has no tsconfig to scope it.
 */
export type ProjectFileResolver = () => string[] | null;

/**
 * Manages the in-memory file cache for a TypeScript project.
 * Handles indexing, loading, refreshing, and change detection.
 */
export class FileManager {
  private files: Map<string, FileEntry> = new Map();
  private projectRoot: string;
  private resolveProjectFiles: ProjectFileResolver | null;
  private static EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
  private static SKIP_DIRS = ['node_modules', 'dist', 'build', 'coverage'];

  /**
   * The cache key for a file, in whatever spelling the caller used.
   *
   * TypeScript hands its host forward-slash paths, callers hand us relative
   * ones and Windows hands us backslashes. All three name the same file, so
   * they have to collapse to one key: a key miss makes getScriptVersion
   * answer "unchanged" forever and freezes the compiler on startup text.
   */
  private cacheKey(filePath: string): string {
    const absolute = normalizePath(path.resolve(this.projectRoot, filePath));
    return ts.sys.useCaseSensitiveFileNames ? absolute : absolute.toLowerCase();
  }

  constructor(projectRoot: string, resolveProjectFiles?: ProjectFileResolver) {
    this.projectRoot = projectRoot;
    this.resolveProjectFiles = resolveProjectFiles ?? null;

    const configured = this.configuredFiles();
    if (configured) {
      this.syncToConfiguredFiles(configured);
    } else {
      this.indexProjectFiles();
    }
  }

  /**
   * The file list declared by tsconfig, or null when there is none to honor.
   */
  private configuredFiles(): string[] | null {
    const configured = this.resolveProjectFiles?.() ?? null;
    return configured && configured.length > 0 ? configured : null;
  }

  /**
   * Indexes all TS/JS files in the project for analysis.
   * Only used when the project has no tsconfig to scope it.
   */
  private indexProjectFiles(): void {
    this.walkDirectory(this.projectRoot, FileManager.EXTENSIONS);
  }

  private walkDirectory(dir: string, extensions: string[]): void {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!FileManager.SKIP_DIRS.includes(entry.name) && !entry.name.startsWith('.')) {
          this.walkDirectory(fullPath, extensions);
        }
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        this.loadFile(fullPath);
      }
    }
  }

  /**
   * Loads a file into the cache. Call when file content changes.
   */
  loadFile(filePath: string): void {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    if (!fs.existsSync(absolutePath)) return;

    const content = fs.readFileSync(absolutePath, 'utf-8');
    const mtime = fs.statSync(absolutePath).mtimeMs;
    const key = this.cacheKey(absolutePath);
    const existing = this.files.get(key);

    this.files.set(key, {
      fileName: normalizePath(absolutePath),
      content,
      version: (existing?.version ?? 0) + 1,
      mtime,
    });
  }

  /**
   * Updates file content without disk I/O. Useful for unsaved changes.
   * The zero mtime marks the entry as diverged from disk, so the next
   * refresh reloads it.
   */
  updateFile(filePath: string, content: string): void {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const key = this.cacheKey(absolutePath);
    const existing = this.files.get(key);

    this.files.set(key, {
      fileName: normalizePath(absolutePath),
      content,
      version: (existing?.version ?? 0) + 1,
      mtime: 0, // In-memory update, no disk mtime
    });
  }

  /**
   * Writes file content to disk and updates the cache to match.
   *
   * Recording the post-write mtime is what stops the next refresh from
   * mistaking our own write for an external edit and reloading over it.
   */
  writeFile(filePath: string, content: string): void {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    fs.writeFileSync(absolutePath, content, 'utf-8');

    const key = this.cacheKey(absolutePath);
    const existing = this.files.get(key);
    this.files.set(key, {
      fileName: normalizePath(absolutePath),
      content,
      version: (existing?.version ?? 0) + 1,
      mtime: fs.statSync(absolutePath).mtimeMs,
    });
  }

  /**
   * Brings the cache back in line with disk.
   *
   * When tsconfig declares the file set, that declaration is authoritative:
   * files it excludes must not be pulled in, because the compiler cannot
   * produce source files for them and every program-backed API would fail.
   */
  refreshChangedFiles(): void {
    const configured = this.configuredFiles();
    if (configured) {
      this.syncToConfiguredFiles(configured);
      return;
    }

    for (const [key, entry] of Array.from(this.files.entries())) {
      try {
        if (!fs.existsSync(entry.fileName)) {
          this.files.delete(key);
        }
      } catch {
        this.files.delete(key);
      }
    }

    this.refreshDirectory(this.projectRoot, FileManager.EXTENSIONS);
  }

  /**
   * Makes the cache hold exactly the configured files, reloading changed ones.
   */
  private syncToConfiguredFiles(fileNames: string[]): void {
    const wanted = new Map(
      fileNames.map((f) => [this.cacheKey(f), path.resolve(this.projectRoot, f)])
    );

    for (const key of Array.from(this.files.keys())) {
      if (!wanted.has(key)) {
        this.files.delete(key);
      }
    }

    for (const [key, absolutePath] of wanted) {
      const existing = this.files.get(key);
      if (!existing) {
        this.loadFile(absolutePath);
        continue;
      }

      try {
        if (fs.statSync(absolutePath).mtimeMs !== existing.mtime) {
          this.loadFile(absolutePath);
        }
      } catch {
        this.files.delete(key);
      }
    }
  }

  private refreshDirectory(dir: string, extensions: string[]): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!FileManager.SKIP_DIRS.includes(entry.name) && !entry.name.startsWith('.')) {
          this.refreshDirectory(fullPath, extensions);
        }
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        try {
          const existing = this.files.get(this.cacheKey(fullPath));
          if (!existing) {
            this.loadFile(fullPath);
          } else {
            const currentMtime = fs.statSync(fullPath).mtimeMs;
            if (currentMtime !== existing.mtime) {
              this.loadFile(fullPath);
            }
          }
        } catch {
          this.files.delete(this.cacheKey(fullPath));
        }
      }
    }
  }

  /**
   * Returns file content if loaded.
   */
  getFileContent(filePath: string): string | undefined {
    return this.files.get(this.cacheKey(filePath))?.content;
  }

  /**
   * Returns all indexed file paths (relative to project root).
   */
  getProjectFiles(): string[] {
    return Array.from(this.files.values()).map((entry) =>
      normalizePath(path.relative(this.projectRoot, entry.fileName))
    );
  }

  /**
   * Returns the raw file entry (content + version + mtime) for a file.
   */
  getFileEntry(filePath: string): FileEntry | undefined {
    return this.files.get(this.cacheKey(filePath));
  }

  /**
   * Returns all absolute file paths tracked by the manager.
   */
  getAbsolutePaths(): string[] {
    return Array.from(this.files.values()).map((entry) => entry.fileName);
  }

  /**
   * Returns the script version string for a file (used by LanguageServiceHost).
   */
  getScriptVersion(fileName: string): string {
    return this.files.get(this.cacheKey(fileName))?.version.toString() ?? '0';
  }

  /**
   * Returns a TypeScript ScriptSnapshot for a file, falling back to disk.
   *
   * The fallback serves the compiler's own lib files, which are outside the
   * project and never tracked here.
   */
  getScriptSnapshot(fileName: string): string | undefined {
    const file = this.files.get(this.cacheKey(fileName));
    if (file) return file.content;

    if (fs.existsSync(fileName)) {
      return fs.readFileSync(fileName, 'utf-8');
    }
    return undefined;
  }
}
