import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { TypeScriptLanguageService } from '../src/language-service.js';
import { AstFinder } from '../src/ast-finder.js';
import { ToolHandler, TOOL_DEFINITIONS } from '../src/tools.js';

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'sample-project');

describe('ToolHandler', () => {
  let handler: ToolHandler;

  beforeAll(() => {
    const service = new TypeScriptLanguageService(FIXTURE_PATH);
    const finder = new AstFinder(service);
    handler = new ToolHandler(service, finder);
  });

  describe('tool definitions', () => {
    it('should define all expected tools', () => {
      const toolNames = TOOL_DEFINITIONS.map((t) => t.name);

      expect(toolNames).toContain('get_hover');
      expect(toolNames).toContain('get_definition');
      expect(toolNames).toContain('get_references');
      expect(toolNames).toContain('get_diagnostics');
      expect(toolNames).toContain('get_symbols');
      expect(toolNames).toContain('get_completions');
      expect(toolNames).toContain('get_signature');
      expect(toolNames).toContain('analyze_position');
      expect(toolNames).toContain('find');
      expect(toolNames).toContain('get_implementations');
      expect(toolNames).toContain('get_imports');
      expect(toolNames).toContain('get_outline');
      expect(toolNames).toContain('rename_preview');
      expect(toolNames).toContain('get_call_hierarchy');
      expect(toolNames).toContain('get_type_hierarchy');
      expect(toolNames).toContain('batch_analyze');
    });

    it('should have descriptions for all tools', () => {
      TOOL_DEFINITIONS.forEach((tool) => {
        expect(tool.description).toBeDefined();
        expect(tool.description.length).toBeGreaterThan(10);
      });
    });

    it('should have input schemas for all tools', () => {
      TOOL_DEFINITIONS.forEach((tool) => {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
      });
    });
  });

  describe('get_hover', () => {
    it('should return hover content', () => {
      const result = handler.handleTool('get_hover', {
        file: 'src/services/user-service.ts',
        line: 4,
        column: 18,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].type).toBe('text');

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.hover).toBeDefined();
    });
  });

  describe('get_definition', () => {
    it('should return definition location', () => {
      const result = handler.handleTool('get_definition', {
        file: 'src/services/user-service.ts',
        line: 5,
        column: 32,
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.definition === null || parsed.definition.file).toBeTruthy();
    });
  });

  describe('get_references', () => {
    it('should return reference locations', () => {
      const result = handler.handleTool('get_references', {
        file: 'src/services/user-service.ts',
        line: 13,
        column: 18,
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed.references)).toBe(true);
    });

    it('should include reference kind for each reference', () => {
      // Get references to UserService interface (line 4)
      const result = handler.handleTool('get_references', {
        file: 'src/services/user-service.ts',
        line: 4,
        column: 18,
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.references.length).toBeGreaterThan(0);

      // Each reference should have a kind and isDefinition boolean
      parsed.references.forEach((ref: { kind: string; isDefinition: boolean }) => {
        expect(['definition', 'read', 'write']).toContain(ref.kind);
        expect(typeof ref.isDefinition).toBe('boolean');
      });
    });
  });

  describe('get_diagnostics', () => {
    it('should return diagnostics array', () => {
      const result = handler.handleTool('get_diagnostics', {
        file: 'src/services/user-service.ts',
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed.diagnostics)).toBe(true);
    });
  });

  describe('get_symbols', () => {
    it('should return symbols array', () => {
      const result = handler.handleTool('get_symbols', {
        file: 'src/services/user-service.ts',
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed.symbols)).toBe(true);
      expect(parsed.symbols.length).toBeGreaterThan(0);
    });
  });

  describe('get_completions', () => {
    it('should return completions array', () => {
      const result = handler.handleTool('get_completions', {
        file: 'src/services/user-service.ts',
        line: 50,
        column: 10,
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed.completions)).toBe(true);
    });
  });

  describe('get_signature', () => {
    it('should return signature or null', () => {
      const result = handler.handleTool('get_signature', {
        file: 'src/services/user-service.ts',
        line: 10,
        column: 10,
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.signature === null || typeof parsed.signature === 'object').toBe(
        true
      );
    });
  });

  describe('analyze_position', () => {
    it('should return combined analysis', () => {
      const result = handler.handleTool('analyze_position', {
        file: 'src/services/user-service.ts',
        line: 4,
        column: 18,
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      // Analysis should return an object with these keys
      expect(typeof parsed).toBe('object');
      expect(parsed !== null).toBe(true);
    });
  });

  describe('find', () => {
    it('should return matches with count', () => {
      const result = handler.handleTool('find', {
        kinds: ['interface'],
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed.matches)).toBe(true);
      expect(typeof parsed.count).toBe('number');
      expect(parsed.count).toBe(parsed.matches.length);
    });

    it('should support all find parameters', () => {
      const result = handler.handleTool('find', {
        query: '*Service',
        kinds: ['interface'],
        scope: 'project',
        exported: true,
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.matches.length).toBeGreaterThan(0);
      expect(parsed.matches[0].name).toContain('Service');
    });

    it('should find string literals', () => {
      const result = handler.handleTool('find', {
        kinds: ['string'],
        scope: 'file',
        path: 'src/services/user-service.ts',
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed.matches)).toBe(true);
      // Should find strings like 'admin', 'user', 'guest', error messages, etc.
      expect(parsed.matches.length).toBeGreaterThan(0);
      expect(parsed.matches.every((m: { kind: string }) => m.kind === 'string')).toBe(true);
    });

    it('should find comments', () => {
      const result = handler.handleTool('find', {
        kinds: ['comment'],
        scope: 'file',
        path: 'src/services/user-service.ts',
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed.matches)).toBe(true);
      // user-service.ts has JSDoc comments
      expect(parsed.matches.length).toBeGreaterThan(0);
      expect(parsed.matches.every((m: { kind: string }) => m.kind === 'comment')).toBe(true);
    });

    it('should find comments matching a query pattern', () => {
      const result = handler.handleTool('find', {
        query: 'User',
        kinds: ['comment'],
        scope: 'file',
        path: 'src/services/user-service.ts',
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed.matches)).toBe(true);
      // Should find comments containing "User"
      expect(parsed.matches.length).toBeGreaterThan(0);
    });
  });

  describe('get_implementations', () => {
    it('should find implementations of an interface', () => {
      // UserService interface at line 4
      const result = handler.handleTool('get_implementations', {
        file: 'src/services/user-service.ts',
        line: 4,
        column: 18,
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed.implementations)).toBe(true);
      expect(typeof parsed.count).toBe('number');
    });

    it('should return empty array for non-interface', () => {
      const result = handler.handleTool('get_implementations', {
        file: 'src/services/user-service.ts',
        line: 94,
        column: 14,
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed.implementations)).toBe(true);
    });
  });

  describe('get_imports', () => {
    it('should return imports from a file', () => {
      const result = handler.handleTool('get_imports', {
        file: 'src/handlers.ts',
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed.imports)).toBe(true);
      expect(typeof parsed.count).toBe('number');
      expect(parsed.imports.length).toBeGreaterThan(0);

      // Check import structure
      const firstImport = parsed.imports[0];
      expect(firstImport.moduleSpecifier).toBeDefined();
      expect(typeof firstImport.isTypeOnly).toBe('boolean');
      expect(typeof firstImport.line).toBe('number');
    });

    it('should include named imports', () => {
      const result = handler.handleTool('get_imports', {
        file: 'src/handlers.ts',
      });

      const parsed = JSON.parse(result.content[0].text);
      const importWithNamed = parsed.imports.find(
        (i: { namedImports?: string[] }) => i.namedImports && i.namedImports.length > 0
      );
      expect(importWithNamed).toBeDefined();
      expect(importWithNamed.namedImports).toContain('UserService');
    });

    it('should return empty array for file without imports', () => {
      const result = handler.handleTool('get_imports', {
        file: 'src/services/user-service.ts',
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed.imports)).toBe(true);
    });
  });

  describe('get_outline', () => {
    it('should return hierarchical structure', () => {
      const result = handler.handleTool('get_outline', {
        file: 'src/services/user-service.ts',
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed.outline)).toBe(true);
      expect(parsed.outline.length).toBeGreaterThan(0);
    });

    it('should include position information', () => {
      const result = handler.handleTool('get_outline', {
        file: 'src/services/user-service.ts',
      });

      const parsed = JSON.parse(result.content[0].text);
      const item = parsed.outline[0];

      expect(item.name).toBeDefined();
      expect(item.kind).toBeDefined();
      expect(typeof item.line).toBe('number');
      expect(typeof item.column).toBe('number');
      expect(typeof item.endLine).toBe('number');
      expect(typeof item.endColumn).toBe('number');
    });

    it('should include nested children for classes', () => {
      const result = handler.handleTool('get_outline', {
        file: 'src/services/user-service.ts',
      });

      const parsed = JSON.parse(result.content[0].text);
      // Find the DefaultUserService class
      const classItem = parsed.outline.find(
        (item: { name: string }) => item.name === 'DefaultUserService'
      );

      expect(classItem).toBeDefined();
      expect(classItem.children).toBeDefined();
      expect(classItem.children.length).toBeGreaterThan(0);
    });
  });

  describe('rename_preview', () => {
    it('should return locations for renaming', () => {
      // Rename the User interface
      const result = handler.handleTool('rename_preview', {
        file: 'src/services/user-service.ts',
        line: 13,
        column: 18,
        newName: 'UserEntity',
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed.locations)).toBe(true);
      expect(typeof parsed.count).toBe('number');
    });

    it('should include original and new text', () => {
      const result = handler.handleTool('rename_preview', {
        file: 'src/services/user-service.ts',
        line: 13,
        column: 18,
        newName: 'UserEntity',
      });

      const parsed = JSON.parse(result.content[0].text);
      if (parsed.locations.length > 0) {
        const location = parsed.locations[0];
        expect(location.originalText).toBeDefined();
        expect(location.newText).toBe('UserEntity');
        expect(typeof location.line).toBe('number');
        expect(typeof location.column).toBe('number');
      }
    });
  });

  describe('get_call_hierarchy', () => {
    it('should return incoming calls', () => {
      // validateEmail function at line 45
      const result = handler.handleTool('get_call_hierarchy', {
        file: 'src/services/user-service.ts',
        line: 45,
        column: 10,
        direction: 'incoming',
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed.calls)).toBe(true);
      expect(typeof parsed.count).toBe('number');
    });

    it('should return outgoing calls', () => {
      // createUser method calls validateEmail
      const result = handler.handleTool('get_call_hierarchy', {
        file: 'src/services/user-service.ts',
        line: 63,
        column: 9,
        direction: 'outgoing',
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed.calls)).toBe(true);
      expect(typeof parsed.count).toBe('number');
    });

    it('should include call location info', () => {
      const result = handler.handleTool('get_call_hierarchy', {
        file: 'src/services/user-service.ts',
        line: 45,
        column: 10,
        direction: 'incoming',
      });

      const parsed = JSON.parse(result.content[0].text);
      if (parsed.calls.length > 0) {
        const call = parsed.calls[0];
        expect(call.from || call.to).toBeDefined();
        expect(Array.isArray(call.fromRanges)).toBe(true);
      }
    });
  });

  describe('get_type_hierarchy', () => {
    it('should return supertypes', () => {
      // DefaultUserService class at line 52
      const result = handler.handleTool('get_type_hierarchy', {
        file: 'src/services/user-service.ts',
        line: 52,
        column: 14,
        direction: 'supertypes',
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed.types)).toBe(true);
      expect(typeof parsed.count).toBe('number');
    });

    it('should return subtypes', () => {
      // UserService interface at line 4
      const result = handler.handleTool('get_type_hierarchy', {
        file: 'src/services/user-service.ts',
        line: 4,
        column: 18,
        direction: 'subtypes',
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed.types)).toBe(true);
      expect(typeof parsed.count).toBe('number');
    });

    it('should include type info', () => {
      const result = handler.handleTool('get_type_hierarchy', {
        file: 'src/services/user-service.ts',
        line: 52,
        column: 14,
        direction: 'supertypes',
      });

      const parsed = JSON.parse(result.content[0].text);
      if (parsed.types.length > 0) {
        const typeItem = parsed.types[0];
        expect(typeItem.name).toBeDefined();
        expect(['class', 'interface']).toContain(typeItem.kind);
        expect(typeof typeItem.line).toBe('number');
        expect(typeof typeItem.column).toBe('number');
      }
    });
  });

  describe('batch_analyze', () => {
    it('should analyze multiple positions', () => {
      const result = handler.handleTool('batch_analyze', {
        positions: [
          { file: 'src/services/user-service.ts', line: 4, column: 18 },
          { file: 'src/services/user-service.ts', line: 13, column: 18 },
        ],
      });

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed.results)).toBe(true);
      expect(parsed.results.length).toBe(2);
      expect(parsed.count).toBe(2);
    });

    it('should include all analyses by default', () => {
      const result = handler.handleTool('batch_analyze', {
        positions: [{ file: 'src/services/user-service.ts', line: 4, column: 18 }],
      });

      const parsed = JSON.parse(result.content[0].text);
      const analysis = parsed.results[0];

      expect(analysis.file).toBe('src/services/user-service.ts');
      expect(analysis.line).toBe(4);
      expect(analysis.column).toBe(18);
      expect('hover' in analysis).toBe(true);
      expect('definition' in analysis).toBe(true);
      expect('references' in analysis).toBe(true);
      expect('diagnostics' in analysis).toBe(true);
      expect('signature' in analysis).toBe(true);
    });

    it('should support selective analysis with include', () => {
      const result = handler.handleTool('batch_analyze', {
        positions: [{ file: 'src/services/user-service.ts', line: 4, column: 18 }],
        include: ['hover', 'definition'],
      });

      const parsed = JSON.parse(result.content[0].text);
      const analysis = parsed.results[0];

      expect('hover' in analysis).toBe(true);
      expect('definition' in analysis).toBe(true);
      expect('references' in analysis).toBe(false);
      expect('diagnostics' in analysis).toBe(false);
      expect('signature' in analysis).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should return error for unknown tool', () => {
      const result = handler.handleTool('unknown_tool', {});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unknown tool');
    });

    it('should handle missing file gracefully', () => {
      const result = handler.handleTool('get_diagnostics', {
        file: 'non-existent-file.ts',
      });

      // Should not throw, but may return empty or error
      expect(result.content[0].type).toBe('text');
    });
  });

  describe('response format', () => {
    it('should always return content array', () => {
      const result = handler.handleTool('get_symbols', {
        file: 'src/services/user-service.ts',
      });

      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBe(1);
    });

    it('should return text type content', () => {
      const result = handler.handleTool('get_symbols', {
        file: 'src/services/user-service.ts',
      });

      expect(result.content[0].type).toBe('text');
    });

    it('should return valid JSON in text', () => {
      const result = handler.handleTool('get_symbols', {
        file: 'src/services/user-service.ts',
      });

      expect(() => JSON.parse(result.content[0].text)).not.toThrow();
    });
  });
});
