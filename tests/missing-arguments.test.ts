/// <reference types="vitest" />
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { TypeScriptLanguageService } from '../src/language-service.js';
import { AstFinder } from '../src/ast-finder.js';
import { ToolHandler } from '../src/tools/index.js';

const FIXTURE = path.join(__dirname, 'fixtures', 'sample-project');
const FILE = 'src/services/user-service.ts';

/**
 * Nothing validates tool arguments before dispatch, so a missing one surfaced
 * as whatever the handler happened to trip over. "Cannot read properties of
 * undefined" tells the caller nothing about which argument to supply.
 */
describe('a tool called without a required argument', () => {
  let handler: ToolHandler;

  beforeAll(() => {
    const service = new TypeScriptLanguageService(FIXTURE);
    handler = new ToolHandler(service, new AstFinder(service));
  });

  it('names_the_missing_positions_argument_of_batch_analyze', async () => {
    const result = await handler.handleTool('batch_analyze', {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('positions');
    expect(result.content[0].text).not.toContain('Cannot read properties');
  });

  it('tells_a_caller_that_passed_one_position_to_wrap_it_in_positions', async () => {
    const result = await handler.handleTool('batch_analyze', { file: FILE, line: 1, column: 1 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('positions');
  });

  it('rejects_positions_that_is_not_an_array', async () => {
    const result = await handler.handleTool('batch_analyze', {
      positions: { file: FILE, line: 1, column: 1 },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('positions');
  });

  it('names_the_missing_file_argument', async () => {
    const result = await handler.handleTool('get_diagnostics', {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('file');
    expect(result.content[0].text).not.toContain('Cannot read properties');
  });

  /**
   * Without the argument the replacement text was the string "undefined", so
   * the rename wrote it into every occurrence. A throwaway project keeps the
   * shared fixture out of reach while this is proven.
   */
  it('names_the_missing_new_name_argument_of_a_rename', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-language-mcp-'));
    try {
      fs.mkdirSync(path.join(root, 'src'));
      const source = 'export const timeout = 30;\nexport const doubled = timeout * 2;\n';
      fs.writeFileSync(path.join(root, 'src', 'config.ts'), source, 'utf-8');
      fs.writeFileSync(
        path.join(root, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { strict: true }, include: ['src/**/*'] }),
        'utf-8'
      );
      const service = new TypeScriptLanguageService(root);
      const temporary = new ToolHandler(service, new AstFinder(service));

      const result = await temporary.handleTool('rename_symbol', {
        file: 'src/config.ts',
        line: 1,
        column: 14,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('newName');
      expect(fs.readFileSync(path.join(root, 'src', 'config.ts'), 'utf-8')).toBe(source);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('asks_for_a_position_or_a_symbol_when_a_position_tool_gets_neither', async () => {
    const result = await handler.handleTool('get_hover', {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/symbol/);
  });

  it('still_runs_a_correctly_argued_call', async () => {
    const result = await handler.handleTool('batch_analyze', {
      positions: [{ file: FILE, line: 1, column: 1 }],
      include: ['hover'],
    });

    expect(result.isError).toBeUndefined();
  });
});
