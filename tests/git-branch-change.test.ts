/// <reference types="vitest" />
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import YAML from 'yaml';
import { ProjectRegistry } from '../src/project-registry.js';
import { AstFinder } from '../src/ast-finder.js';
import { ToolHandler } from '../src/tools/index.js';

/**
 * Assigning a string to a number only fails under strict null checks off/on
 * differences; an implicit-any parameter is the cheaper switch to flip, since
 * "noImplicitAny" is exactly what "strict" turns on.
 */
const IMPLICIT_ANY_SOURCE = ['export function greet(name) {', '  return `hi ${name}`;', '}', ''].join(
  '\n'
);

function tsconfig(options: Record<string, unknown>, include = ['src/**/*']): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        skipLibCheck: true,
        ...options,
      },
      include,
    },
    null,
    2
  );
}

/**
 * A working tree the tests can move between commits.
 *
 * Only the files the server actually reads are needed — git's own bookkeeping,
 * not a real repository — so a checkout is reproduced by rewriting the tracked
 * files and moving the ref, which is precisely the state a running server sees.
 */
class FakeCheckout {
  readonly root: string;

  constructor() {
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-language-mcp-git-'));
    fs.mkdirSync(path.join(this.root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(this.root, '.git', 'refs', 'heads'), { recursive: true });
    this.checkoutBranch('main', 'a'.repeat(40));
  }

  write(relativePath: string, content: string): void {
    const target = path.join(this.root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
  }

  remove(relativePath: string): void {
    fs.rmSync(path.join(this.root, relativePath), { force: true, recursive: true });
  }

  /** Points HEAD at a branch holding the given commit. */
  checkoutBranch(name: string, commit: string): void {
    fs.writeFileSync(path.join(this.root, '.git', 'HEAD'), `ref: refs/heads/${name}\n`, 'utf-8');
    fs.writeFileSync(path.join(this.root, '.git', 'refs', 'heads', name), `${commit}\n`, 'utf-8');
  }

  dispose(): void {
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}

function makeHandler(root: string) {
  const registry = new ProjectRegistry(root);
  return { registry, handler: new ToolHandler(registry, new AstFinder(registry)) };
}

/** How many tsconfigs the registry is currently holding projects for. */
function projectCount(registry: ProjectRegistry): number {
  return (registry as unknown as { projects: unknown[] }).projects.length;
}

/**
 * Waits for a watcher-driven change to land. Polling the condition rather than
 * sleeping a fixed time keeps the test honest on a slow machine without making
 * a fast one wait.
 */
async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

describe('a branch switch under a running server', () => {
  let tree: FakeCheckout;

  beforeEach(() => {
    tree = new FakeCheckout();
  });

  afterEach(() => {
    tree.dispose();
  });

  it('compiler_option_change_from_a_branch_switch_is_applied', async () => {
    tree.write('tsconfig.json', tsconfig({ strict: false }));
    tree.write('src/greet.ts', IMPLICIT_ANY_SOURCE);

    const { registry } = makeHandler(tree.root);
    expect(await registry.getDiagnostics('src/greet.ts', { includeEslint: false })).toEqual([]);

    tree.write('tsconfig.json', tsconfig({ strict: true }));
    tree.checkoutBranch('strict-mode', 'b'.repeat(40));
    registry.refreshChangedFiles();

    const diagnostics = await registry.getDiagnostics('src/greet.ts', { includeEslint: false });
    expect(diagnostics.map((d) => d.message).join('\n')).toContain('implicitly has an');
  });

  it('tsconfig_added_by_a_branch_switch_starts_governing_its_files', () => {
    tree.write('tsconfig.json', tsconfig({ strict: true }, ['src/**/*']));
    tree.write('src/greet.ts', 'export const greet = 1;\n');
    tree.write('extras/helper.ts', 'export const helper = 2;\n');

    const { registry } = makeHandler(tree.root);
    expect(registry.isFileUnconfigured('extras/helper.ts')).toBe(true);

    tree.write('extras/tsconfig.json', tsconfig({ strict: true }, ['**/*']));
    tree.checkoutBranch('with-extras', 'c'.repeat(40));
    registry.refreshChangedFiles();

    expect(registry.isFileUnconfigured('extras/helper.ts')).toBe(false);
    expect(registry.getConfigPath('extras/helper.ts')).toContain('extras');
  });

  it('tsconfig_removed_by_a_branch_switch_stops_being_queried', () => {
    tree.write('tsconfig.json', tsconfig({ strict: true }, ['src/**/*']));
    tree.write('src/greet.ts', 'export const greet = 1;\n');
    tree.write('extras/tsconfig.json', tsconfig({ strict: true }, ['**/*']));
    tree.write('extras/helper.ts', 'export const helper = 2;\n');

    const { registry } = makeHandler(tree.root);
    expect(registry.getProjectFiles().some((f) => f.includes('extras/helper'))).toBe(true);
    expect(projectCount(registry)).toBe(2);

    tree.remove('extras');
    tree.checkoutBranch('no-extras', 'd'.repeat(40));
    registry.refreshChangedFiles();

    expect(registry.getProjectFiles().some((f) => f.includes('extras/helper'))).toBe(false);
    // The files vanishing is not enough: the project itself must be gone, or
    // every project-wide query keeps paying for a config that no longer exists.
    expect(projectCount(registry)).toBe(1);
  });

  it('source_edits_survive_a_config_rebuild_in_the_same_refresh', async () => {
    tree.write('tsconfig.json', tsconfig({ strict: false }));
    tree.write('src/greet.ts', 'export const greet = "before";\n');

    const { registry } = makeHandler(tree.root);
    expect(registry.getFileContent('src/greet.ts')).toContain('before');

    // One branch change carrying both a source edit and a compiler option
    // change. Syncing files before rebuilding the service would drop the new
    // text along with the old document registry.
    tree.write('tsconfig.json', tsconfig({ strict: true }));
    tree.write('src/greet.ts', 'export const greet = "after";\n');
    tree.checkoutBranch('both-changed', 'e'.repeat(40));
    registry.refreshChangedFiles();

    expect(registry.getFileContent('src/greet.ts')).toContain('after');
    const symbols = registry.getSymbols('src/greet.ts');
    expect(symbols.length).toBeGreaterThan(0);
  });

  it('checkout_within_the_throttle_window_is_not_served_from_stale_cache', async () => {
    tree.write('tsconfig.json', tsconfig({ strict: true }));
    tree.write('src/greet.ts', 'export const before = 1;\n');

    const { handler } = makeHandler(tree.root);

    // Primes the throttle timer, so the second call falls inside its window.
    await handler.handleTool('get_symbols', { file: 'src/greet.ts' });

    tree.write('src/greet.ts', 'export const after = 2;\n');
    tree.checkoutBranch('renamed-export', 'f'.repeat(40));

    const result = await handler.handleTool('get_symbols', { file: 'src/greet.ts' });
    expect(result.content[0].text).toContain('after');
    expect(result.content[0].text).not.toContain('before');
  });

  it('unsaved_in_memory_changes_replaced_on_disk_are_reported_once', async () => {
    tree.write('tsconfig.json', tsconfig({ strict: true }));
    tree.write('src/greet.ts', 'export const greet = 1;\n');

    const { registry, handler } = makeHandler(tree.root);
    registry.updateFile('src/greet.ts', 'export const greet = 999;\n');

    tree.write('src/greet.ts', 'export const greet = 2;\n');
    tree.checkoutBranch('other-value', '1'.repeat(40));

    const first = await handler.handleTool('get_symbols', { file: 'src/greet.ts' });
    expect(first.content[0].text).toContain('src/greet.ts');
    expect(YAML.parse(first.content[0].text).notice).toContain('replaced by newer content');

    // Reporting it again on every later call would be noise about an event the
    // caller has already been told about.
    const second = await handler.handleTool('get_symbols', { file: 'src/greet.ts' });
    expect(YAML.parse(second.content[0].text).notice).toBeUndefined();
  });

  it('idle_server_picks_up_a_checkout_without_waiting_for_a_request', async () => {
    tree.write('tsconfig.json', tsconfig({ strict: true }));
    tree.write('src/greet.ts', 'export const before = 1;\n');

    const { registry } = makeHandler(tree.root);
    expect(registry.getFileContent('src/greet.ts')).toContain('before');

    // No tool call anywhere in this test: the watcher alone must do the work,
    // so the developer's next request is answered from the branch they moved to
    // rather than paying for the rebuild.
    tree.write('src/greet.ts', 'export const after = 2;\n');
    tree.checkoutBranch('watched', '9'.repeat(40));

    await waitFor(() => registry.getFileContent('src/greet.ts')?.includes('after') === true);
    expect(registry.getFileContent('src/greet.ts')).toContain('after');
  });

  it('disposing_the_handler_stops_watching', async () => {
    tree.write('tsconfig.json', tsconfig({ strict: true }));
    tree.write('src/greet.ts', 'export const before = 1;\n');

    const { registry, handler } = makeHandler(tree.root);
    handler.dispose();

    tree.write('src/greet.ts', 'export const after = 2;\n');
    tree.checkoutBranch('after-dispose', '8'.repeat(40));

    // A disposed handler must leave the cache alone; the watcher firing after
    // shutdown is what would keep a finished session's listener alive.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(registry.getFileContent('src/greet.ts')).toContain('before');
  });

  it('a_project_without_git_still_refreshes_normally', async () => {
    tree.remove('.git');
    tree.write('tsconfig.json', tsconfig({ strict: true }));
    tree.write('src/greet.ts', 'export const greet = 1;\n');

    const { registry } = makeHandler(tree.root);
    expect(() => registry.refreshChangedFiles()).not.toThrow();
    expect(registry.hasGitStateChanged()).toBe(false);

    tree.write('src/greet.ts', 'export const greet = 2;\n');
    registry.refreshChangedFiles();
    expect(registry.getFileContent('src/greet.ts')).toContain('2');
  });
});
