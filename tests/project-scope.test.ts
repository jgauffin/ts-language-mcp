/// <reference types="vitest" />
import * as path from 'path';
import YAML from 'yaml';
import { TypeScriptLanguageService } from '../src/language-service.js';
import { AstFinder } from '../src/ast-finder.js';
import { ToolHandler } from '../src/tools/index.js';

const NARROW_FIXTURE = path.join(__dirname, 'fixtures', 'narrow-tsconfig-project');

function makeHandler(root: string) {
  const service = new TypeScriptLanguageService(root);
  return { service, handler: new ToolHandler(service, new AstFinder(service)) };
}

/**
 * The constructor seeds the file set from tsconfig, but every tool call
 * refreshes it. These tests prove the tsconfig scope survives that refresh,
 * which is what keeps out-of-program files from reaching the compiler.
 */
describe('tsconfig scope survives a refresh', () => {
  it('keeps excluded files out of the project after refreshing', () => {
    const service = new TypeScriptLanguageService(NARROW_FIXTURE);

    expect(service.getProjectFiles()).toContain('src/included/a.ts');
    expect(service.getProjectFiles().some((f) => f.includes('excluded'))).toBe(false);

    service.refreshChangedFiles();

    const afterRefresh = service.getProjectFiles();
    expect(afterRefresh).toContain('src/included/a.ts');
    expect(afterRefresh).toContain('src/included/b.ts');
    expect(afterRefresh.some((f) => f.includes('excluded'))).toBe(false);
  });

  it('does not pull an out-of-program javascript file into the root set', () => {
    const service = new TypeScriptLanguageService(NARROW_FIXTURE);
    service.refreshChangedFiles();

    expect(service.getProjectFiles().some((f) => f.endsWith('legacy.js'))).toBe(false);
  });
});

/**
 * A project-wide tool must not be taken down by a single unanalyzable file.
 * Before this was fixed, one excluded .js file made these tools return
 * "Could not find source file" for the entire project.
 */
describe('project-wide tools survive an unanalyzable file', () => {
  it('reports diagnostics for the whole project without failing', async () => {
    const { handler } = makeHandler(NARROW_FIXTURE);

    const result = await handler.handleTool('get_all_diagnostics', {});
    const text = result.content[0].text;

    expect(text).not.toContain('Could not find source file');
    expect(result.isError).toBeUndefined();
    expect(YAML.parse(text)).toHaveProperty('summary');
  });

  it('analyses indirection without failing', async () => {
    const { handler } = makeHandler(NARROW_FIXTURE);

    const result = await handler.handleTool('find_indirection_hotspots', { take: 2 });
    const text = result.content[0].text;

    expect(text).not.toContain('Could not find source file');
    expect(result.isError).toBeUndefined();
    expect(YAML.parse(text)).toHaveProperty('offenders');
  });
});

/**
 * Failures must be distinguishable from results at the protocol level,
 * otherwise an agent reads an error string as data.
 */
describe('tool failures are flagged', () => {
  it('marks a missing file as an error rather than a result', async () => {
    const { handler } = makeHandler(NARROW_FIXTURE);

    const result = await handler.handleTool('get_hover', {
      file: 'src/does-not-exist.ts',
      line: 1,
      column: 1,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('File not found');
  });

  it('marks an unknown tool as an error', async () => {
    const { handler } = makeHandler(NARROW_FIXTURE);

    const result = await handler.handleTool('no_such_tool', {});

    expect(result.isError).toBe(true);
  });
});
