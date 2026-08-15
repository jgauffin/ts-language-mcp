/// <reference types="vitest" />
import * as path from 'path';
import * as fs from 'fs';
import YAML from 'yaml';
import { TypeScriptLanguageService } from '../src/language-service.js';
import { AstFinder } from '../src/ast-finder.js';
import { ToolHandler } from '../src/tools/index.js';
import type { CodeFix } from '../src/types.js';

const FIXTURE = path.join(__dirname, 'fixtures', 'codefix-project');
const SOURCES = ['src/models.ts', 'src/missing-import.ts', 'src/unused-imports.ts'];

function read(relative: string): string {
  return fs.readFileSync(path.join(FIXTURE, relative), 'utf-8');
}

function parse<T>(text: string): T {
  return YAML.parse(text) as T;
}

describe('code actions', () => {
  let originals: Map<string, string>;
  let service: TypeScriptLanguageService;
  let handler: ToolHandler;

  beforeEach(() => {
    originals = new Map(SOURCES.map((f) => [f, read(f)]));
    service = new TypeScriptLanguageService(FIXTURE);
    handler = new ToolHandler(service, new AstFinder(service));
  });

  afterEach(() => {
    for (const [relative, content] of originals) {
      fs.writeFileSync(path.join(FIXTURE, relative), content, 'utf-8');
    }
  });

  describe('get_code_fixes', () => {
    // "makeAccount" is called on line 4, column 10 of src/missing-import.ts.
    const atMissingCall = { file: 'src/missing-import.ts', line: 4, column: 10 };

    it('offers an import fix for an unresolved name', async () => {
      const result = await handler.handleTool('get_code_fixes', atMissingCall);

      expect(result.isError).toBeUndefined();
      const { fixes } = parse<{ fixes: CodeFix[] }>(result.content[0].text);

      expect(fixes.length).toBeGreaterThan(0);
      expect(fixes.some((f) => f.description.toLowerCase().includes('import'))).toBe(true);
    });

    it('reports the edit as line/column so it can be read without offsets', async () => {
      const result = await handler.handleTool('get_code_fixes', atMissingCall);
      const { fixes } = parse<{ fixes: CodeFix[] }>(result.content[0].text);
      const edit = fixes[0].changes[0].edits[0];

      expect(edit.line).toBeGreaterThan(0);
      expect(edit.column).toBeGreaterThan(0);
      expect(typeof edit.newText).toBe('string');
    });

    it('returns no fixes where there is no diagnostic', async () => {
      const result = await handler.handleTool('get_code_fixes', {
        file: 'src/models.ts',
        line: 2,
        column: 3,
      });

      const { fixes } = parse<{ fixes: CodeFix[] }>(result.content[0].text);
      expect(fixes).toEqual([]);
    });
  });

  describe('apply_code_fix', () => {
    const atMissingCall = { file: 'src/missing-import.ts', line: 4, column: 10 };

    it('writes the import and clears the error', async () => {
      const listed = await handler.handleTool('get_code_fixes', atMissingCall);
      const { fixes } = parse<{ fixes: CodeFix[] }>(listed.content[0].text);
      const importFix = fixes.find((f) => f.description.toLowerCase().includes('import'))!;

      const applied = await handler.handleTool('apply_code_fix', {
        ...atMissingCall,
        fixName: importFix.fixName,
      });

      expect(applied.isError).toBeUndefined();
      expect(read('src/missing-import.ts')).toContain('makeAccount');
      expect(read('src/missing-import.ts')).toMatch(/import .*makeAccount.*from/);

      // The whole point: the diagnostic is gone afterwards.
      const fresh = new TypeScriptLanguageService(FIXTURE);
      const freshHandler = new ToolHandler(fresh, new AstFinder(fresh));
      const diagnostics = await freshHandler.handleTool('get_diagnostics', {
        file: 'src/missing-import.ts',
      });
      const parsed = parse<{ total: number }>(diagnostics.content[0].text);
      expect(parsed.total).toBe(0);
    });

    it('names the available fixes when asked for one that does not exist', async () => {
      const result = await handler.handleTool('apply_code_fix', {
        ...atMissingCall,
        fixName: 'noSuchFix',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('No fix named');
      expect(result.content[0].text).toContain('Available:');
    });

    it('errors when there is nothing to fix at the position', async () => {
      const result = await handler.handleTool('apply_code_fix', {
        file: 'src/models.ts',
        line: 2,
        column: 3,
        fixName: 'import',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('nothing to fix');
    });
  });

  describe('organize_imports', () => {
    it('previews without touching disk by default', async () => {
      const before = read('src/unused-imports.ts');
      const result = await handler.handleTool('organize_imports', {
        file: 'src/unused-imports.ts',
      });

      expect(result.isError).toBeUndefined();
      const parsed = parse<{ applied: boolean; totalEdits: number }>(result.content[0].text);
      expect(parsed.applied).toBe(false);
      expect(parsed.totalEdits).toBeGreaterThan(0);
      expect(read('src/unused-imports.ts')).toBe(before);
    });

    it('drops an unused import when applied', async () => {
      const result = await handler.handleTool('organize_imports', {
        file: 'src/unused-imports.ts',
        apply: true,
      });

      expect(result.isError).toBeUndefined();
      const after = read('src/unused-imports.ts');
      expect(after).toContain('makeAccount');
      expect(after).not.toContain('Account,');
      expect(after).not.toMatch(/type Account/);
    });
  });

  describe('suggestion diagnostics', () => {
    it('surfaces unused imports only when asked', async () => {
      const without = await handler.handleTool('get_diagnostics', {
        file: 'src/unused-imports.ts',
      });
      const withSuggestions = await handler.handleTool('get_diagnostics', {
        file: 'src/unused-imports.ts',
        includeSuggestions: true,
        includeEslint: false,
      });

      const a = parse<{ total: number }>(without.content[0].text);
      const b = parse<{ total: number }>(withSuggestions.content[0].text);

      expect(b.total).toBeGreaterThan(a.total);
    });

    it('reports truncation instead of silently capping', async () => {
      const result = await handler.handleTool('get_diagnostics', {
        file: 'src/missing-import.ts',
        limit: 1,
      });

      const parsed = parse<{ total: number; returned: number; truncated: boolean }>(
        result.content[0].text
      );
      expect(parsed.returned).toBeLessThanOrEqual(1);
      expect(parsed).toHaveProperty('truncated');
    });
  });

  describe('get_type_definition', () => {
    it('lands on the type rather than the variable', async () => {
      // The return of makeAccount is an Account, declared in src/models.ts.
      const result = await handler.handleTool('get_type_definition', {
        symbol: 'makeAccount',
      });

      expect(result.isError).toBeUndefined();
      const parsed = parse<{ definitions: Array<{ file: string }> }>(result.content[0].text);
      expect(parsed.definitions.length).toBeGreaterThan(0);
      expect(parsed.definitions[0].file).toBe('src/models.ts');
    });
  });
});
