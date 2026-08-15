/// <reference types="vitest" />
import * as path from 'path';
import YAML from 'yaml';
import { TypeScriptLanguageService } from '../src/language-service.js';
import { AstFinder } from '../src/ast-finder.js';
import { ToolHandler } from '../src/tools/index.js';

const FIXTURE = path.join(__dirname, 'fixtures', 'sample-project');
const FILE = 'src/services/user-service.ts';

/**
 * A position outside the file used to resolve silently to offset 0, so the
 * agent got a confident answer about the first character instead of being
 * told its coordinates were wrong.
 */
describe('out-of-range positions are rejected', () => {
  let handler: ToolHandler;

  beforeAll(() => {
    const service = new TypeScriptLanguageService(FIXTURE);
    handler = new ToolHandler(service, new AstFinder(service));
  });

  it('rejects a line past the end of the file', async () => {
    const result = await handler.handleTool('get_hover', {
      file: FILE,
      line: 9999,
      column: 1,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('out of range');
    expect(result.content[0].text).toContain(FILE);
  });

  it('names the actual line count so the caller can correct itself', async () => {
    const result = await handler.handleTool('get_hover', {
      file: FILE,
      line: 9999,
      column: 1,
    });

    expect(result.content[0].text).toMatch(/\d+ lines/);
  });

  it('rejects a zero or negative line', async () => {
    for (const line of [0, -3]) {
      const result = await handler.handleTool('get_hover', { file: FILE, line, column: 1 });
      expect(result.isError).toBe(true);
    }
  });

  it('rejects a column past the end of the line', async () => {
    const result = await handler.handleTool('get_hover', {
      file: FILE,
      line: 1,
      column: 9999,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('out of range');
  });

  it('still accepts a valid position', async () => {
    // "UserService" is declared on line 4 of the fixture.
    const result = await handler.handleTool('get_hover', {
      file: FILE,
      line: 4,
      column: 18,
    });

    expect(result.isError).toBeUndefined();
    const parsed = YAML.parse(result.content[0].text) as { hover: string | null };
    expect(parsed.hover).toContain('UserService');
  });

  it('accepts a column just past the last character of a line', async () => {
    const result = await handler.handleTool('get_hover', {
      file: FILE,
      line: 1,
      column: 4,
    });

    expect(result.isError).toBeUndefined();
  });
});
