import * as path from 'path';
import * as fs from 'fs';

/**
 * Notices when the working tree has been moved to different code.
 *
 * A long-lived server keeps a parsed model of the project in memory. Switching
 * branches replaces the sources under it, and often the tsconfig governing
 * them, so the model describes code the developer is no longer working on.
 * Answering from it is worse than failing: the caller acts on diagnostics for
 * a branch they left.
 *
 * Reads git's own bookkeeping files rather than shelling out, so a project
 * without git — or with a .git this process cannot read — costs nothing and
 * simply never reports a change.
 */
export class GitState {
  /** The directory holding HEAD and refs, or null when there is no git here. */
  private gitDir: string | null;
  private fingerprint: string;
  private watchers: fs.FSWatcher[] = [];
  private debounce: ReturnType<typeof setTimeout> | null = null;
  /** How long to let a checkout settle before reacting to it. */
  private static SETTLE_MS = 100;

  constructor(projectRoot: string) {
    this.gitDir = GitState.resolveGitDir(projectRoot);
    this.fingerprint = this.readFingerprint();
  }

  /**
   * The git directory for a working tree.
   *
   * Usually `.git` is that directory. In a worktree or submodule it is instead
   * a file pointing at the real one, which is where the branch of *this*
   * checkout is recorded — following it is what makes worktrees work.
   */
  private static resolveGitDir(projectRoot: string): string | null {
    const dotGit = path.join(path.resolve(projectRoot), '.git');

    try {
      const stats = fs.statSync(dotGit);
      if (stats.isDirectory()) return dotGit;

      const pointer = fs.readFileSync(dotGit, 'utf-8').match(/^gitdir:\s*(.+)$/m);
      if (!pointer) return null;

      const target = pointer[1].trim();
      return path.isAbsolute(target) ? target : path.resolve(projectRoot, target);
    } catch {
      return null;
    }
  }

  /**
   * A cheap summary of which commit the working tree is on.
   *
   * HEAD alone names the branch but not its position, so a commit, pull or
   * rebase that leaves the branch name unchanged would go unnoticed. The ref
   * it points at supplies that position; when refs are packed there is no
   * loose ref file, so packed-refs stands in for it.
   */
  private readFingerprint(): string {
    if (!this.gitDir) return '';

    const parts: string[] = [];

    const head = this.readFile(path.join(this.gitDir, 'HEAD'));
    if (head !== undefined) parts.push(head.trim());

    const symbolic = head?.match(/^ref:\s*(.+)$/m);
    if (symbolic) {
      const refPath = path.join(this.gitDir, ...symbolic[1].trim().split('/'));
      parts.push(this.stamp(refPath));
    }

    parts.push(this.stamp(path.join(this.gitDir, 'packed-refs')));

    return parts.join('|');
  }

  private readFile(filePath: string): string | undefined {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return undefined;
    }
  }

  /** Size and mtime of a file, or empty when it does not exist. */
  private stamp(filePath: string): string {
    try {
      const stats = fs.statSync(filePath);
      return `${stats.mtimeMs}:${stats.size}`;
    } catch {
      return '';
    }
  }

  /**
   * Calls back as soon as the working tree moves to different code.
   *
   * Watching lets a checkout be picked up while the server is idle, so the
   * developer's next request is answered from the new branch instead of paying
   * for the rebuild. Only git's own bookkeeping is watched — a handful of files
   * in one directory, which is where fs.watch is dependable; source files are
   * still found by the mtime scan the refresh already does.
   *
   * A checkout writes HEAD and the ref separately, and rewrites the tree in
   * between, so events are coalesced: reacting to the first one would rebuild
   * from a half-written tree and then have to do it again.
   *
   * Returns a function that stops watching. Failure to watch is not fatal —
   * detection simply falls back to the check made on each request.
   */
  watch(onChange: () => void): () => void {
    if (!this.gitDir) return () => {};

    const fire = (): void => {
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => {
        this.debounce = null;
        if (this.hasChanged()) onChange();
      }, GitState.SETTLE_MS);
      // Never keep the process alive for a refresh that has not been asked for.
      this.debounce.unref?.();
    };

    // The git directory holds HEAD and packed-refs; refs/heads holds the branch
    // tips. Watching the directories rather than individual files means a ref
    // created by a new branch is covered without re-registering.
    for (const target of [this.gitDir, path.join(this.gitDir, 'refs', 'heads')]) {
      try {
        const watcher = fs.watch(target, { persistent: false }, fire);
        watcher.on('error', () => {});
        this.watchers.push(watcher);
      } catch {
        // An unwatchable path (network drive, exotic filesystem) leaves the
        // per-request check as the detection path.
      }
    }

    return () => this.stopWatching();
  }

  /** Releases the watchers and any pending debounce. */
  private stopWatching(): void {
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        // Already closed.
      }
    }
    this.watchers = [];
  }

  /**
   * Whether the working tree has moved to a different commit, without
   * adopting it. Safe to ask repeatedly: a caller deciding whether a refresh
   * is due must not consume the very change that makes it due.
   */
  isStale(): boolean {
    if (!this.gitDir) return false;
    return this.readFingerprint() !== this.fingerprint;
  }

  /**
   * Whether the working tree moved since the last call, adopting the new state.
   *
   * Consuming the change means a single checkout triggers one rebuild rather
   * than one per caller.
   */
  hasChanged(): boolean {
    if (!this.gitDir) return false;

    const current = this.readFingerprint();
    if (current === this.fingerprint) return false;

    this.fingerprint = current;
    return true;
  }
}
