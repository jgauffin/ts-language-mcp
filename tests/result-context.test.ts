/// <reference types="vitest" />
import * as path from 'path';
import YAML from 'yaml';
import { TypeScriptLanguageService } from '../src/language-service.js';
import { AstFinder } from '../src/ast-finder.js';
import { ToolHandler } from '../src/tools/index.js';
import type { FilePosition, ReferenceInfo } from '../src/types.js';

const FIXTURE = path.join(__dirname, 'fixtures', 'sample-project');

function parse<T>(text: string): T {
  return YAML.parse(text) as T;
}

describe('navigation results carry their source line', () => {
  let handler: ToolHandler;

  beforeAll(() => {
    const service = new TypeScriptLanguageService(FIXTURE);
    handler = new ToolHandler(service, new AstFinder(service));
  });

  it('includes the source line on every reference', async () => {
    const result = await handler.handleTool('get_references', {
      symbol: 'DefaultUserService',
    });
    const { references } = parse<{ references: ReferenceInfo[] }>(result.content[0].text);

    expect(references.length).toBeGreaterThan(0);
    for (const ref of references) {
      expect(typeof ref.text).toBe('string');
      expect(ref.text!.length).toBeGreaterThan(0);
    }
  });

  it('includes the source line on a definition', async () => {
    const result = await handler.handleTool('get_definition', {
      symbol: 'DefaultUserService',
    });
    const { definition } = parse<{ definition: FilePosition }>(result.content[0].text);

    expect(definition.text).toContain('DefaultUserService');
  });

  it('returns every definition, not only the first', async () => {
    const result = await handler.handleTool('get_definition', {
      symbol: 'DefaultUserService',
    });
    const parsed = parse<{ definitions: FilePosition[]; count: number }>(
      result.content[0].text
    );

    expect(Array.isArray(parsed.definitions)).toBe(true);
    expect(parsed.count).toBe(parsed.definitions.length);
    expect(parsed.count).toBeGreaterThan(0);
  });

  it('adds surrounding lines only when asked', async () => {
    const without = await handler.handleTool('get_references', {
      symbol: 'DefaultUserService',
    });
    const withContext = await handler.handleTool('get_references', {
      symbol: 'DefaultUserService',
      contextLines: 2,
    });

    const a = parse<{ references: ReferenceInfo[] }>(without.content[0].text);
    const b = parse<{ references: ReferenceInfo[] }>(withContext.content[0].text);

    expect(a.references[0].context).toBeUndefined();
    expect(b.references[0].context).toBeDefined();
    expect(b.references[0].context!.lines.length).toBeGreaterThan(1);
  });
});

describe('unbounded results are capped and say so', () => {
  let handler: ToolHandler;

  beforeAll(() => {
    const service = new TypeScriptLanguageService(FIXTURE);
    handler = new ToolHandler(service, new AstFinder(service));
  });

  it('reports the true total when references are capped', async () => {
    const result = await handler.handleTool('get_references', {
      symbol: 'DefaultUserService',
      limit: 1,
    });
    const parsed = parse<{
      references: ReferenceInfo[];
      total: number;
      returned: number;
      truncated: boolean;
    }>(result.content[0].text);

    expect(parsed.returned).toBe(1);
    expect(parsed.total).toBeGreaterThan(1);
    expect(parsed.truncated).toBe(true);
  });

  it('pages through results with offset', async () => {
    const first = await handler.handleTool('get_references', {
      symbol: 'DefaultUserService',
      limit: 1,
      offset: 0,
    });
    const second = await handler.handleTool('get_references', {
      symbol: 'DefaultUserService',
      limit: 1,
      offset: 1,
    });

    const a = parse<{ references: ReferenceInfo[] }>(first.content[0].text);
    const b = parse<{ references: ReferenceInfo[] }>(second.content[0].text);

    expect(a.references[0]).not.toEqual(b.references[0]);
  });

  it('caps find results and reports the total', async () => {
    const result = await handler.handleTool('find', { query: '*', limit: 2 });
    const parsed = parse<{ total: number; returned: number; truncated: boolean }>(
      result.content[0].text
    );

    expect(parsed.returned).toBe(2);
    expect(parsed.total).toBeGreaterThan(2);
    expect(parsed.truncated).toBe(true);
  });

  it('caps symbol listings and reports the total', async () => {
    const result = await handler.handleTool('get_symbols', {
      file: 'src/services/user-service.ts',
      limit: 2,
    });
    const parsed = parse<{ total: number; returned: number; truncated: boolean }>(
      result.content[0].text
    );

    expect(parsed.returned).toBe(2);
    expect(parsed.truncated).toBe(true);
  });

  it('does not mark a complete result as truncated', async () => {
    const result = await handler.handleTool('get_symbols', {
      file: 'src/http-client.ts',
    });
    const parsed = parse<{ total: number; returned: number; truncated: boolean }>(
      result.content[0].text
    );

    expect(parsed.truncated).toBe(false);
    expect(parsed.returned).toBe(parsed.total);
  });
});
