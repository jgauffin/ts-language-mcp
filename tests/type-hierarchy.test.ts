/// <reference types="vitest" />
import * as path from 'path';
import * as fs from 'fs';
import YAML from 'yaml';
import { TypeScriptLanguageService } from '../src/language-service.js';
import { AstFinder } from '../src/ast-finder.js';
import { ToolHandler } from '../src/tools/index.js';
import type { TypeHierarchyItem } from '../src/types.js';

const FIXTURE = path.join(__dirname, 'fixtures', 'hierarchy-project');

describe('type hierarchy', () => {
  let service: TypeScriptLanguageService;
  let handler: ToolHandler;

  beforeAll(() => {
    service = new TypeScriptLanguageService(FIXTURE);
    handler = new ToolHandler(service, new AstFinder(service));
  });

  async function hierarchy(
    file: string,
    line: number,
    column: number,
    direction: 'supertypes' | 'subtypes'
  ): Promise<TypeHierarchyItem[]> {
    const result = await handler.handleTool('get_type_hierarchy', {
      file,
      line,
      column,
      direction,
    });
    expect(result.isError).toBeUndefined();
    return (YAML.parse(result.content[0].text) as { types: TypeHierarchyItem[] }).types;
  }

  describe('subtypes', () => {
    it('reports file paths that actually exist in the project', async () => {
      // "Shape" is declared on line 1 of src/base.ts.
      const types = await hierarchy('src/base.ts', 1, 18, 'subtypes');

      expect(types.length).toBeGreaterThan(0);
      for (const item of types) {
        expect(item.file).not.toContain('temp.ts');
        expect(fs.existsSync(path.join(FIXTURE, item.file))).toBe(true);
      }
    });

    it('finds implementers in other files', async () => {
      const types = await hierarchy('src/base.ts', 1, 18, 'subtypes');
      const names = types.map((t) => t.name);

      expect(names).toContain('Circle');
      expect(names).toContain('Base');
    });

    it('ignores an unrelated type that shares the name', async () => {
      const types = await hierarchy('src/base.ts', 1, 18, 'subtypes');

      expect(types.map((t) => t.name)).not.toContain('Decoy');
    });

    it('points at the line the subtype is declared on', async () => {
      const types = await hierarchy('src/base.ts', 1, 18, 'subtypes');
      const circle = types.find((t) => t.name === 'Circle');

      expect(circle).toBeDefined();
      const source = fs.readFileSync(path.join(FIXTURE, circle!.file), 'utf-8');
      expect(source.split('\n')[circle!.line - 1]).toContain('class Circle');
    });
  });

  describe('supertypes', () => {
    it('resolves a base class declared in another file to the right line', async () => {
      // "Square" is declared on line 3 of src/square.ts.
      const types = await hierarchy('src/square.ts', 3, 14, 'supertypes');
      const base = types.find((t) => t.name === 'Base');

      expect(base).toBeDefined();
      expect(base!.file).toBe('src/base.ts');

      const source = fs.readFileSync(path.join(FIXTURE, base!.file), 'utf-8');
      expect(source.split('\n')[base!.line - 1]).toContain('class Base');
    });

    it('resolves an implemented interface from another file', async () => {
      // "Circle" is declared on line 3 of src/circle.ts.
      const types = await hierarchy('src/circle.ts', 3, 14, 'supertypes');
      const shape = types.find((t) => t.name === 'Shape');

      expect(shape).toBeDefined();
      expect(shape!.file).toBe('src/base.ts');

      const source = fs.readFileSync(path.join(FIXTURE, shape!.file), 'utf-8');
      expect(source.split('\n')[shape!.line - 1]).toContain('interface Shape');
    });
  });
});
