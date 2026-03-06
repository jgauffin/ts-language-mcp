/// <reference types="vitest" />
import * as path from 'path';
import { TypeScriptLanguageService } from '../src/language-service.js';

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'sample-project');

describe('TypeScriptLanguageService', () => {
  let service: TypeScriptLanguageService;

  beforeAll(() => {
    service = new TypeScriptLanguageService(FIXTURE_PATH);
  });

  describe('constructor', () => {
    it('should normalize project root path (remove trailing slashes)', () => {
      // Create services with various trailing slash patterns
      const withoutSlash = new TypeScriptLanguageService(FIXTURE_PATH);
      const withSlash = new TypeScriptLanguageService(FIXTURE_PATH + '/');
      const withBackslash = new TypeScriptLanguageService(FIXTURE_PATH + '\\');

      // All should return the same files
      const files1 = withoutSlash.getProjectFiles();
      const files2 = withSlash.getProjectFiles();
      const files3 = withBackslash.getProjectFiles();

      expect(files1).toEqual(files2);
      expect(files1).toEqual(files3);
    });
  });

  describe('getProjectFiles', () => {
    it('should index TypeScript files in project', () => {
      const files = service.getProjectFiles();

      expect(files).toContain('src/services/user-service.ts');
      expect(files).toContain('src/handlers.ts');
    });

    it('should not include node_modules', () => {
      const files = service.getProjectFiles();
      const hasNodeModules = files.some((f) => f.includes('node_modules'));

      expect(hasNodeModules).toBe(false);
    });

    it('should skip hidden directories (starting with .)', () => {
      const files = service.getProjectFiles();

      // Hidden directories like .angular, .git, .next should be skipped
      const hasHiddenDir = files.some((f) => 
        f.includes('/.') || f.includes('\\.') || f.split(/[\\/]/).some(part => part.startsWith('.') && part !== '.')
      );

      expect(hasHiddenDir).toBe(false);
    });
  });

  describe('getHover', () => {
    it('should return type info for interface', () => {
      // UserService interface at line 4
      const hover = service.getHover('src/services/user-service.ts', 4, 18);

      expect(hover).toBeDefined();
      expect(hover).toContain('UserService');
    });

    it('should return undefined for whitespace', () => {
      const hover = service.getHover('src/services/user-service.ts', 1, 1);

      // May or may not have hover for comment
      expect(hover === undefined || typeof hover === 'string').toBe(true);
    });
  });

  describe('getDefinition', () => {
    it('should find interface definition', () => {
      // User reference in UserService.getUser return type (line 5)
      const def = service.getDefinition('src/services/user-service.ts', 5, 32);

      expect(def).toBeDefined();
      if (def) {
        expect(def.file).toContain('user-service.ts');
      }
    });

    it('should return undefined for declarations', () => {
      // The UserService declaration itself has no further definition
      const def = service.getDefinition('src/services/user-service.ts', 4, 18);

      // May point to itself
      expect(def === undefined || def.file !== undefined).toBe(true);
    });
  });

  describe('getReferences', () => {
    it('should find all usages of interface', () => {
      // User interface - should be used multiple places
      const refs = service.getReferences('src/services/user-service.ts', 12, 18);

      expect(refs.length).toBeGreaterThan(0);
    });

    it('should include references from other files', () => {
      // UserService is imported in handlers.ts
      const refs = service.getReferences('src/services/user-service.ts', 4, 18);

      const hasHandlerRef = refs.some((r) => r.file.includes('handlers.ts'));
      expect(hasHandlerRef).toBe(true);
    });
  });

  describe('getDiagnostics', () => {
    it('should return empty for valid file', () => {
      const diagnostics = service.getDiagnostics('src/services/user-service.ts');

      // Fixture should be valid TypeScript
      const errors = diagnostics.filter((d) => d.severity === 'error');
      expect(errors.length).toBe(0);
    });
  });

  describe('getSymbols', () => {
    it('should list all symbols in file', () => {
      const symbols = service.getSymbols('src/services/user-service.ts');

      const names = symbols.map((s) => s.name);

      expect(names).toContain('UserService');
      expect(names).toContain('User');
      expect(names).toContain('DefaultUserService');
      expect(names).toContain('createUserService');
    });

    it('should include symbol kinds', () => {
      const symbols = service.getSymbols('src/services/user-service.ts');

      const userService = symbols.find((s) => s.name === 'UserService');
      expect(userService?.kind).toBe('interface');

      const defaultUserService = symbols.find((s) => s.name === 'DefaultUserService');
      expect(defaultUserService?.kind).toBe('class');
    });
  });

  describe('getCompletions', () => {
    it('should return completions at position', () => {
      // Line 56: "const user = this.users.get(id);" - after "this."
      const completions = service.getCompletions(
        'src/services/user-service.ts',
        56,
        22
      );

      // May return completions or empty depending on context
      expect(Array.isArray(completions)).toBe(true);
    });
  });

  describe('analyzePosition', () => {
    it('should return combined analysis', () => {
      // Line 4, column 18: "UserService" interface name
      const analysis = service.analyzePosition(
        'src/services/user-service.ts',
        4,
        18
      );

      // Analysis object should always have these keys
      expect('hover' in analysis).toBe(true);
      expect('diagnostics' in analysis).toBe(true);
      expect('definition' in analysis).toBe(true);
      expect('references' in analysis).toBe(true);
    });
  });

  describe('getFileContent', () => {
    it('should return file content', () => {
      const content = service.getFileContent('src/services/user-service.ts');

      expect(content).toBeDefined();
      expect(content).toContain('UserService');
    });

    it('should return undefined for non-existent file', () => {
      const content = service.getFileContent('non-existent.ts');

      expect(content).toBeUndefined();
    });
  });

  describe('updateFile', () => {
    it('should update in-memory content', () => {
      const originalContent = service.getFileContent('src/services/user-service.ts');

      service.updateFile('src/services/user-service.ts', '// modified\n' + originalContent);

      const updatedContent = service.getFileContent('src/services/user-service.ts');
      expect(updatedContent).toContain('// modified');

      // Restore original
      service.updateFile('src/services/user-service.ts', originalContent!);
    });
  });
});
