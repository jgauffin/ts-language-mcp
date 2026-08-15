/// <reference types="vitest" />
import * as path from 'path';
import YAML from 'yaml';
import { TypeScriptLanguageService } from '../src/language-service.js';
import { AstFinder } from '../src/ast-finder.js';
import { ToolHandler } from '../src/tools/index.js';

const REPO_ROOT = path.join(__dirname, '..');

describe('the server against its own repository', () => {
  let handler: ToolHandler;
  let service: TypeScriptLanguageService;

  beforeAll(() => {
    service = new TypeScriptLanguageService(REPO_ROOT);
    handler = new ToolHandler(service, new AstFinder(service));
  });

  it('honours the tsconfig exclude of tests/', () => {
    const files = service.getProjectFiles();
    expect(files.some((f) => f.startsWith('tests/'))).toBe(false);
    expect(files).toContain('src/index.ts');
  });

  it('reports project diagnostics without failing', async () => {
    const result = await handler.handleTool('get_all_diagnostics', { severity: 'error' });
    const text = result.content[0].text;

    expect(text).not.toContain('Could not find source file');
    expect(result.isError).toBeUndefined();

    // Whether the repo currently has errors is the build's business; what
    // matters here is that the sweep completes over every file.
    const parsed = YAML.parse(text) as { summary: { total: number }; skippedFiles?: string[] };
    expect(parsed.summary).toBeDefined();
    expect(parsed.skippedFiles).toBeUndefined();
  });

  it('analyses indirection without failing', async () => {
    const result = await handler.handleTool('find_indirection_hotspots', { take: 3 });

    expect(result.content[0].text).not.toContain('Could not find source file');
    expect(result.isError).toBeUndefined();
  });

  it('finds a symbol by name and reports its source line', async () => {
    const result = await handler.handleTool('get_references', {
      symbol: 'SymbolResolver',
    });
    const parsed = YAML.parse(result.content[0].text) as {
      references: Array<{ file: string; text?: string }>;
    };

    expect(parsed.references.length).toBeGreaterThan(0);
    expect(parsed.references[0].text).toBeTruthy();
  });

  it('resolves its own module graph', async () => {
    const result = await handler.handleTool('get_module_dependencies', {
      file: 'src/tools/index.ts',
    });
    const parsed = YAML.parse(result.content[0].text) as {
      imports: Array<{ resolvedFile?: string }>;
    };

    expect(parsed.imports.some((i) => i.resolvedFile === 'src/yaml.ts')).toBe(true);
  });
});
