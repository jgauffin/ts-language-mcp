import * as path from 'path';
import * as fs from 'fs';
import { normalizePath } from './paths.js';

export interface FileEntry {
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
    const existing = this.files.get(absolutePath);

    this.files.set(absolutePath, {
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
    const existing = this.files.get(absolutePath);

    this.files.set(absolutePath, {
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

    const existing = this.files.get(absolutePath);
    this.files.set(absolutePath, {
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

    for (const absolutePath of Array.from(this.files.keys())) {
      try {
        if (!fs.existsSync(absolutePath)) {
          this.files.delete(absolutePath);
        }
      } catch {
        this.files.delete(absolutePath);
      }
    }

    this.refreshDirectory(this.projectRoot, FileManager.EXTENSIONS);
  }

  /**
   * Makes the cache hold exactly the configured files, reloading changed ones.
   */
  private syncToConfiguredFiles(fileNames: string[]): void {
    const wanted = new Set(fileNames.map((f) => path.resolve(this.projectRoot, f)));

    for (const absolutePath of Array.from(this.files.keys())) {
      if (!wanted.has(absolutePath)) {
        this.files.delete(absolutePath);
      }
    }

    for (const absolutePath of wanted) {
      const existing = this.files.get(absolutePath);
      if (!existing) {
        this.loadFile(absolutePath);
        continue;
      }

      try {
        if (fs.statSync(absolutePath).mtimeMs !== existing.mtime) {
          this.loadFile(absolutePath);
        }
      } catch {
        this.files.delete(absolutePath);
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
          const existing = this.files.get(fullPath);
          if (!existing) {
            this.loadFile(fullPath);
          } else {
            const currentMtime = fs.statSync(fullPath).mtimeMs;
            if (currentMtime !== existing.mtime) {
              this.loadFile(fullPath);
            }
          }
        } catch {
          this.files.delete(fullPath);
        }
      }
    }
  }

  /**
   * Returns file content if loaded.
   */
  getFileContent(filePath: string): string | undefined {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    return this.files.get(absolutePath)?.content;
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
   * Returns the raw file entry (content + version + mtime) for a file.
   */
  getFileEntry(filePath: string): FileEntry | undefined {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    return this.files.get(absolutePath);
  }

  /**
   * Returns all absolute file paths tracked by the manager.
   */
  getAbsolutePaths(): string[] {
    return Array.from(this.files.keys());
  }

  /**
   * Returns the script version string for a file (used by LanguageServiceHost).
   */
  getScriptVersion(fileName: string): string {
    return this.files.get(fileName)?.version.toString() ?? '0';
  }

  /**
   * Returns a TypeScript ScriptSnapshot for a file, falling back to disk.
   */
  getScriptSnapshot(fileName: string): string | undefined {
    const file = this.files.get(fileName);
    if (file) return file.content;

    if (fs.existsSync(fileName)) {
      return fs.readFileSync(fileName, 'utf-8');
    }
    return undefined;
  }
}
