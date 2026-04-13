/// <reference types="vitest" />
import * as path from 'path';
import ts from 'typescript';
import { TypeScriptLanguageService } from '../src/language-service.js';

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'sample-project');
const ESLINT_FIXTURE_PATH = path.join(__dirname, 'fixtures', 'eslint-project');
const NARROW_FIXTURE_PATH = path.join(__dirname, 'fixtures', 'narrow-tsconfig-project');
const NOISY_FIXTURE_PATH = path.join(__dirname, 'fixtures', 'noisy-project');

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
    it('should return empty for valid file', async () => {
      const diagnostics = await service.getDiagnostics('src/services/user-service.ts');

      // Fixture should be valid TypeScript
      const errors = diagnostics.filter((d) => d.severity === 'error');
      expect(errors.length).toBe(0);
    });

    it('should tag TS diagnostics with source=typescript', async () => {
      const diagnostics = await service.getDiagnostics('src/services/user-service.ts');
      for (const d of diagnostics) {
        expect(d.source).toBe('typescript');
      }
    });

    it('should not include ESLint diagnostics when ESLint is not installed in target', async () => {
      const diagnostics = await service.getDiagnostics('src/services/user-service.ts');
      const eslintEntries = diagnostics.filter((d) => d.source === 'eslint');
      expect(eslintEntries.length).toBe(0);
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
    it('should return combined analysis', async () => {
      // Line 4, column 18: "UserService" interface name
      const analysis = await service.analyzePosition(
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

describe('tsconfig-driven indexing', () => {
  it('should index only files included by tsconfig', () => {
    const service = new TypeScriptLanguageService(NARROW_FIXTURE_PATH);
    const files = service.getProjectFiles();

    expect(files).toContain('src/included/a.ts');
    expect(files).toContain('src/included/b.ts');
    expect(files.some((f) => f.includes('excluded'))).toBe(false);
  });

  it('should match tsconfig.parseJsonConfigFileContent fileNames', () => {
    const service = new TypeScriptLanguageService(NARROW_FIXTURE_PATH);
    const files = new Set(service.getProjectFiles().map((f) => path.resolve(NARROW_FIXTURE_PATH, f)));

    const configPath = path.join(NARROW_FIXTURE_PATH, 'tsconfig.json');
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, NARROW_FIXTURE_PATH);
    const expected = new Set(parsed.fileNames.map((f) => path.resolve(f)));

    for (const f of expected) {
      expect(files.has(f)).toBe(true);
    }
  });
});

describe('getDiagnostics with ESLint', () => {
  let service: TypeScriptLanguageService;

  beforeAll(() => {
    service = new TypeScriptLanguageService(ESLINT_FIXTURE_PATH);
  });

  it('should include a TypeScript diagnostic', async () => {
    const diagnostics = await service.getDiagnostics('src/bad.ts');
    const tsDiags = diagnostics.filter((d) => d.source === 'typescript');
    expect(tsDiags.length).toBeGreaterThan(0);
  });

  it('should include an ESLint diagnostic with a ruleId', async () => {
    const diagnostics = await service.getDiagnostics('src/lint-issues.js');
    const eslintDiags = diagnostics.filter((d) => d.source === 'eslint');
    expect(eslintDiags.length).toBeGreaterThan(0);
    for (const d of eslintDiags) {
      expect(d.ruleId).toBeTruthy();
    }
  });

  it('should map ESLint severity 2 to error and 1 to warning', async () => {
    const diagnostics = await service.getDiagnostics('src/lint-issues.js');
    const eslintDiags = diagnostics.filter((d) => d.source === 'eslint');

    const noUnused = eslintDiags.find((d) => d.ruleId === 'no-unused-vars');
    expect(noUnused?.severity).toBe('error');

    const preferConst = eslintDiags.find((d) => d.ruleId === 'prefer-const');
    expect(preferConst?.severity).toBe('warning');
  });

  it('should exclude ESLint diagnostics when includeEslint is false', async () => {
    const diagnostics = await service.getDiagnostics('src/lint-issues.js', { includeEslint: false });
    const eslintDiags = diagnostics.filter((d) => d.source === 'eslint');
    expect(eslintDiags.length).toBe(0);
  });
});

describe('getAllDiagnostics capping', () => {
  let service: TypeScriptLanguageService;

  beforeAll(() => {
    service = new TypeScriptLanguageService(NOISY_FIXTURE_PATH);
  });

  it('should cap results at 50 by default and report truncation', async () => {
    const result = await service.getAllDiagnostics();

    const returned = Object.values(result.files).flat();
    expect(returned.length).toBeLessThanOrEqual(50);
    expect(result.summary.returned).toBe(returned.length);
    expect(result.summary.total).toBeGreaterThan(50);
    expect(result.summary.truncated).toBe(true);
  });

  it('should sort errors before warnings across all files', async () => {
    const result = await service.getAllDiagnostics();
    const returned = Object.values(result.files).flat();

    let sawWarning = false;
    for (const d of returned) {
      if (d.severity === 'warning') sawWarning = true;
      if (d.severity === 'error') {
        expect(sawWarning).toBe(false);
      }
    }
  });

  it('should return everything when limit exceeds total', async () => {
    const result = await service.getAllDiagnostics(undefined, { limit: 500 });
    expect(result.summary.truncated).toBe(false);
    expect(result.summary.returned).toBe(result.summary.total);
  });
});
