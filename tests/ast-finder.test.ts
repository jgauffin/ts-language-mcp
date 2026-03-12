/// <reference types="vitest" />
import * as path from 'path';
import { TypeScriptLanguageService } from '../src/language-service.js';
import { AstFinder } from '../src/ast-finder.js';

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'sample-project');

describe('AstFinder', () => {
  let service: TypeScriptLanguageService;
  let finder: AstFinder;

  beforeAll(() => {
    service = new TypeScriptLanguageService(FIXTURE_PATH);
    finder = new AstFinder(service);
  });

  describe('find by kind', () => {
    it('should find all interfaces', () => {
      const results = finder.find({ kinds: ['interface'] });

      const names = results.map((r) => r.name);
      expect(names).toContain('UserService');
      expect(names).toContain('User');
      expect(names).toContain('CreateUserDto');
      expect(names).toContain('HandlerContext');
    });

    it('should find all classes', () => {
      const results = finder.find({ kinds: ['class'] });

      const names = results.map((r) => r.name);
      expect(names).toContain('DefaultUserService');
      expect(names).toContain('DefaultHttpClient');
    });

    it('should find all enums', () => {
      const results = finder.find({ kinds: ['enum'] });

      const names = results.map((r) => r.name);
      expect(names).toContain('UserRole');
    });

    it('should find all functions', () => {
      const results = finder.find({ kinds: ['function'] });

      const names = results.map((r) => r.name);
      expect(names).toContain('validateEmail');
      expect(names).toContain('createUserService');
      expect(names).toContain('createGetUserHandler');
      expect(names).toContain('createPostUserHandler');
    });

    it('should find all type aliases', () => {
      const results = finder.find({ kinds: ['type'] });

      const names = results.map((r) => r.name);
      expect(names).toContain('UserId');
      expect(names).toContain('RequestHandler');
    });

    it('should find multiple kinds at once', () => {
      const results = finder.find({ kinds: ['interface', 'type'] });

      const names = results.map((r) => r.name);
      expect(names).toContain('UserService');
      expect(names).toContain('UserId');
    });
  });

  describe('find by query pattern', () => {
    it('should match glob pattern with *', () => {
      const results = finder.find({ query: '*Service' });

      const names = results.map((r) => r.name);
      expect(names).toContain('UserService');
      expect(names).toContain('DefaultUserService');
      expect(names).toContain('createUserService');
    });

    it('should match glob pattern case-insensitively', () => {
      const results = finder.find({ query: '*SERVICE' });

      const names = results.map((r) => r.name);
      expect(names).toContain('UserService');
      expect(names).toContain('DefaultUserService');
      expect(names).toContain('createUserService');
    });

    it('should match glob pattern with ?', () => {
      const results = finder.find({ query: 'User?' });

      // Should not match User (too short) but may match others
      const names = results.map((r) => r.name);
      expect(names).not.toContain('User');
    });

    it('should match regex pattern', () => {
      const results = finder.find({ query: '/^create/' });

      const names = results.map((r) => r.name);
      expect(names).toContain('createUserService');
      expect(names).toContain('createGetUserHandler');
      expect(names).toContain('createPostUserHandler');
    });

    it('should match case-insensitive substring', () => {
      const results = finder.find({ query: 'user' });

      const names = results.map((r) => r.name);
      expect(names).toContain('User');
      expect(names).toContain('UserService');
      expect(names).toContain('userCount');
    });
  });

  describe('find by export status', () => {
    it('should find only exported symbols', () => {
      const results = finder.find({ exported: true, kinds: ['function'] });

      const names = results.map((r) => r.name);
      expect(names).toContain('createUserService');
      expect(names).not.toContain('validateEmail'); // Internal function
    });

    it('should find non-exported symbols', () => {
      const results = finder.find({ exported: false, kinds: ['function'] });

      const names = results.map((r) => r.name);
      expect(names).toContain('validateEmail');
    });

    it('should mark export status correctly', () => {
      const results = finder.find({ kinds: ['interface'] });

      const userService = results.find((r) => r.name === 'UserService');
      expect(userService?.exported).toBe(true);
    });
  });

  describe('find by scope', () => {
    it('should search entire project by default', () => {
      const results = finder.find({ kinds: ['interface'] });

      const files = new Set(results.map((r) => r.file));
      expect(files.size).toBeGreaterThan(1);
    });

    it('should search single file', () => {
      const results = finder.find({
        kinds: ['interface'],
        scope: 'file',
        path: 'src/handlers.ts',
      });

      const files = new Set(results.map((r) => r.file));
      expect(files.size).toBe(1);
      expect(results.every((r) => r.file.includes('handlers.ts'))).toBe(true);
    });

    it('should search directory', () => {
      const results = finder.find({
        kinds: ['interface'],
        scope: 'directory',
        path: 'src/services',
      });

      expect(
        results.every((r) => r.file.includes('services'))
      ).toBe(true);
    });
  });

  describe('result structure', () => {
    it('should include file path', () => {
      const results = finder.find({ kinds: ['class'] });

      expect(results[0].file).toBeDefined();
      expect(results[0].file).toContain('.ts');
    });

    it('should include line and column (1-based)', () => {
      const results = finder.find({ kinds: ['class'] });

      expect(results[0].line).toBeGreaterThan(0);
      expect(results[0].column).toBeGreaterThan(0);
    });

    it('should include code snippet', () => {
      const results = finder.find({ kinds: ['class'] });

      expect(results[0].snippet).toBeDefined();
      expect(results[0].snippet).toContain('class');
    });

    it('should truncate long snippets', () => {
      const results = finder.find({});

      results.forEach((r) => {
        expect(r.snippet.length).toBeLessThanOrEqual(103); // 100 + "..."
      });
    });
  });

  describe('combined filters', () => {
    it('should apply query and kind together', () => {
      const results = finder.find({
        query: '*Handler',
        kinds: ['function'],
      });

      const names = results.map((r) => r.name);
      expect(names).toContain('createGetUserHandler');
      expect(names).toContain('createPostUserHandler');
      expect(names.every((n) => n.includes('Handler'))).toBe(true);
    });

    it('should apply all filters together', () => {
      const results = finder.find({
        query: '*Service',
        kinds: ['interface'],
        exported: true,
        scope: 'file',
        path: 'src/services/user-service.ts',
      });

      expect(results.length).toBe(1);
      expect(results[0].name).toBe('UserService');
    });
  });

  describe('named import bindings', () => {
    it('should find named import specifiers by query', () => {
      const results = finder.find({ query: 'HttpClient' });

      const names = results.map((r) => r.name);
      expect(names).toContain('HttpClient');
    });

    it('should find named import specifiers with kind filter', () => {
      const results = finder.find({ kinds: ['import'], scope: 'file', path: 'src/handlers.ts' });

      const names = results.map((r) => r.name);
      // Should include individual named imports, not just module specifiers
      expect(names).toContain('HttpClient');
      expect(names).toContain('UserService');
    });
  });

  describe('function expressions', () => {
    it('should find named function expressions by query', () => {
      const results = finder.find({ query: 'processHtml' });

      const names = results.map((r) => r.name);
      expect(names).toContain('processHtml');
    });

    it('should find named function expressions with kind filter', () => {
      const results = finder.find({ kinds: ['function'], scope: 'file', path: 'src/handlers.ts' });

      const names = results.map((r) => r.name);
      expect(names).toContain('processHtml');
    });
  });

  describe('export declarations', () => {
    it('should find re-export declarations by query', () => {
      const results = finder.find({ kinds: ['export'], scope: 'file', path: 'src/handlers.ts' });

      // Should find the re-export of HttpClient
      expect(results.length).toBeGreaterThan(0);
      const names = results.map((r) => r.name);
      expect(names).toContain('HttpClient');
    });

    it('should find default export', () => {
      const results = finder.find({ kinds: ['export'], scope: 'file', path: 'src/handlers.ts' });

      const names = results.map((r) => r.name);
      expect(names).toContain('createGetUserHandler');
    });
  });

  describe('edge cases', () => {
    it('should return empty for no matches', () => {
      const results = finder.find({ query: 'NonExistent12345' });

      expect(results).toEqual([]);
    });

    it('should handle invalid regex gracefully', () => {
      const results = finder.find({ query: '/[invalid/' });

      expect(results).toEqual([]);
    });

    it('should return all when no filters', () => {
      const results = finder.find({});

      expect(results.length).toBeGreaterThan(10);
    });
  });
});
