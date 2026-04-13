import * as path from 'path';
import * as fs from 'fs';
import { normalizePath } from './tools.js';

export interface FileEntry {
  content: string;
  version: number;
  mtime: number;
}

/**
 * Manages the in-memory file cache for a TypeScript project.
 * Handles indexing, loading, refreshing, and change detection.
 */
export class FileManager {
  private files: Map<string, FileEntry> = new Map();
  private projectRoot: string;
  private static EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
  private static SKIP_DIRS = ['node_modules', 'dist', 'build', 'coverage'];

  constructor(projectRoot: string, initialFileNames?: string[] | null) {
    this.projectRoot = projectRoot;
    if (initialFileNames && initialFileNames.length > 0) {
      for (const fileName of initialFileNames) {
        this.loadFile(fileName);
      }
    } else {
      this.indexProjectFiles();
    }
  }

  /**
   * Indexes all TS/JS files in the project for analysis.
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
    const trackedPaths = Array.from(this.files.keys());
    for (const absolutePath of trackedPaths) {
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
