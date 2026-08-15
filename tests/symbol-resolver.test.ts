/// <reference types="vitest" />
import * as path from 'path';
import YAML from 'yaml';
import { TypeScriptLanguageService } from '../src/language-service.js';
import { AstFinder } from '../src/ast-finder.js';
import { ToolHandler } from '../src/tools/index.js';
import { SymbolResolver } from '../src/symbol-resolver.js';

const FIXTURE = path.join(__dirname, 'fixtures', 'sample-project');

describe('addressing symbols by name', () => {
  let service: TypeScriptLanguageService;
  let handler: ToolHandler;
  let resolver: SymbolResolver;

  beforeAll(() => {
    service = new TypeScriptLanguageService(FIXTURE);
    handler = new ToolHandler(service, new AstFinder(service));
    resolver = new SymbolResolver(service);
  });

  describe('resolution', () => {
    it('finds a uniquely named symbol anywhere in the project', () => {
      const position = resolver.resolve('DefaultUserService');

      expect(position.file).toBe('src/services/user-service.ts');
      const line = service.getFileContent(position.file)!.split('\n')[position.line - 1];
      expect(line).toContain('DefaultUserService');
    });

    it('lands on the name itself, not the start of the declaration', () => {
      const position = resolver.resolve('DefaultUserService');
      const line = service.getFileContent(position.file)!.split('\n')[position.line - 1];

      // Column must point at the identifier so position tools resolve it.
      expect(line.slice(position.column - 1)).toMatch(/^DefaultUserService/);
    });

    it('accepts a Container.member qualified name', () => {
      const position = resolver.resolve('DefaultUserService.createUser');
      const line = service.getFileContent(position.file)!.split('\n')[position.line - 1];

      expect(line).toContain('createUser');
    });

    it('scopes the search to a file when one is given', () => {
      const position = resolver.resolve('HttpClient', 'src/http-client.ts');

      expect(position.file).toBe('src/http-client.ts');
    });

    it('reports candidates rather than guessing when a name is ambiguous', () => {
      // "getUser" exists on both the interface and its implementation.
      expect(() => resolver.resolve('getUser')).toThrow(/ambiguous/i);
      expect(() => resolver.resolve('getUser')).toThrow(/user-service\.ts/);
    });

    it('rejects an unknown symbol with guidance', () => {
      expect(() => resolver.resolve('NoSuchSymbolAnywhere')).toThrow(/No symbol named/);
    });

    it('rejects an empty symbol name', () => {
      expect(() => resolver.resolve('   ')).toThrow(/must not be empty/);
    });

    it('does not match a symbol by fuzzy near-miss', () => {
      // The underlying search is fuzzy; only exact names may resolve.
      expect(() => resolver.resolve('DefaultUserServ')).toThrow(/No symbol named/);
    });
  });

  describe('through the tools', () => {
    it('accepts a symbol in place of line and column', async () => {
      const bySymbol = await handler.handleTool('get_hover', {
        symbol: 'DefaultUserService',
      });

      expect(bySymbol.isError).toBeUndefined();
      const parsed = YAML.parse(bySymbol.content[0].text) as { hover: string | null };
      expect(parsed.hover).toContain('DefaultUserService');
    });

    it('agrees with the equivalent coordinate lookup', async () => {
      const position = resolver.resolve('DefaultUserService');

      const bySymbol = await handler.handleTool('get_references', {
        symbol: 'DefaultUserService',
      });
      const byPosition = await handler.handleTool('get_references', position);

      expect(bySymbol.content[0].text).toBe(byPosition.content[0].text);
    });

    it('reports an ambiguous symbol as a tool error', async () => {
      const result = await handler.handleTool('get_hover', { symbol: 'getUser' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/ambiguous/i);
    });

    it('narrows an ambiguous symbol with a qualified name', async () => {
      const result = await handler.handleTool('get_hover', {
        symbol: 'UserService.getUser',
      });

      expect(result.isError).toBeUndefined();
    });

    it('works for tools that take extra arguments', async () => {
      const result = await handler.handleTool('get_type_hierarchy', {
        symbol: 'DefaultUserService',
        direction: 'supertypes',
      });

      expect(result.isError).toBeUndefined();
      const parsed = YAML.parse(result.content[0].text) as { types: Array<{ name: string }> };
      expect(parsed.types.map((t) => t.name)).toContain('UserService');
    });

    it('resolves symbols inside batch_analyze positions', async () => {
      const result = await handler.handleTool('batch_analyze', {
        positions: [{ symbol: 'DefaultUserService' }, { symbol: 'DefaultHttpClient' }],
        include: ['hover'],
      });

      expect(result.isError).toBeUndefined();
      const parsed = YAML.parse(result.content[0].text) as {
        results: Array<{ hover: string | null }>;
      };
      expect(parsed.results).toHaveLength(2);
      expect(parsed.results[0].hover).toContain('DefaultUserService');
      expect(parsed.results[1].hover).toContain('DefaultHttpClient');
    });
  });

  describe('find scope paths', () => {
    it('rejects a path that matches nothing instead of returning no matches', async () => {
      const result = await handler.handleTool('find', {
        query: '*',
        scope: 'file',
        path: 'src/does-not-exist.ts',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('No project file or directory matches');
    });

    it('still accepts a real directory scope', async () => {
      const result = await handler.handleTool('find', {
        query: '*Service',
        scope: 'directory',
        path: 'src/services',
      });

      expect(result.isError).toBeUndefined();
    });
  });
});
