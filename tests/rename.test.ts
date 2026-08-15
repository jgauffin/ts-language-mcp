/// <reference types="vitest" />
import * as path from 'path';
import * as fs from 'fs';
import YAML from 'yaml';
import { TypeScriptLanguageService } from '../src/language-service.js';
import { AstFinder } from '../src/ast-finder.js';
import { ToolHandler } from '../src/tools/index.js';

const FIXTURE = path.join(__dirname, 'fixtures', 'rename-project');
const SOURCES = ['src/config.ts', 'src/consumer.ts', 'src/aliased.ts'];

function read(relative: string): string {
  return fs.readFileSync(path.join(FIXTURE, relative), 'utf-8');
}

describe('renaming a symbol', () => {
  let originals: Map<string, string>;
  let service: TypeScriptLanguageService;
  let handler: ToolHandler;

  beforeEach(() => {
    originals = new Map(SOURCES.map((f) => [f, read(f)]));
    service = new TypeScriptLanguageService(FIXTURE);
    handler = new ToolHandler(service, new AstFinder(service));
  });

  afterEach(() => {
    // The fixture is mutated on disk, so put it back for the next test.
    for (const [relative, content] of originals) {
      fs.writeFileSync(path.join(FIXTURE, relative), content, 'utf-8');
    }
  });

  /** `timeout` is declared at line 1, column 14 of src/config.ts. */
  const declaration = { file: 'src/config.ts', line: 1, column: 14 };

  it('writes the new name to disk', async () => {
    const result = await handler.handleTool('rename_symbol', {
      ...declaration,
      newName: 'timeoutMs',
    });

    expect(result.isError).toBeUndefined();
    expect(read('src/config.ts')).toContain('export const timeoutMs = 30;');
  });

  it('keeps the rename after a refresh reloads the project', async () => {
    await handler.handleTool('rename_symbol', { ...declaration, newName: 'timeoutMs' });

    // A refresh is what previously discarded in-memory-only edits.
    service.refreshChangedFiles();

    expect(service.getFileContent('src/config.ts')).toContain('timeoutMs');
    expect(read('src/config.ts')).toContain('timeoutMs');
  });

  it('expands a shorthand property so the object keeps its key', async () => {
    await handler.handleTool('rename_symbol', { ...declaration, newName: 'timeoutMs' });

    // The declared return type is { timeout: number }, so the key must stay
    // "timeout" while only the referenced binding changes.
    expect(read('src/consumer.ts')).toContain('return { timeout: timeoutMs };');
    expect(read('src/consumer.ts')).toContain("import { timeoutMs } from './config.js';");
  });

  it('renames only the imported name of an aliased import', async () => {
    await handler.handleTool('rename_symbol', { ...declaration, newName: 'timeoutMs' });

    expect(read('src/aliased.ts')).toContain(
      "import { timeoutMs as requestTimeout } from './config.js';"
    );
    // The local alias is untouched, so its usage must still compile.
    expect(read('src/aliased.ts')).toContain('requestTimeout * 2');
  });

  it('leaves the project free of errors after the rename', async () => {
    await handler.handleTool('rename_symbol', { ...declaration, newName: 'timeoutMs' });

    const fresh = new TypeScriptLanguageService(FIXTURE);
    const freshHandler = new ToolHandler(fresh, new AstFinder(fresh));
    const result = await freshHandler.handleTool('get_all_diagnostics', { severity: 'error' });
    const parsed = YAML.parse(result.content[0].text) as { summary: { total: number } };

    expect(parsed.summary.total).toBe(0);
  });

  it('reports the prefix a shorthand needs in the preview', async () => {
    const result = await handler.handleTool('rename_preview', {
      ...declaration,
      newName: 'timeoutMs',
    });
    const parsed = YAML.parse(result.content[0].text) as {
      locations: Array<{ file: string; line: number; prefixText?: string }>;
    };

    const shorthand = parsed.locations.find(
      (l) => l.file === 'src/consumer.ts' && l.line === 6
    );
    expect(shorthand?.prefixText).toBe('timeout: ');
  });

  it('does not touch disk when only previewing', async () => {
    await handler.handleTool('rename_preview', { ...declaration, newName: 'timeoutMs' });

    expect(read('src/config.ts')).toContain('export const timeout = 30;');
  });
});
