/// <reference types="vitest" />
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { TypeScriptLanguageService } from '../src/language-service.js';

const SOURCE = [
  'export interface Subject {',
  '  unchecked: boolean;',
  '}',
  '',
  'export function pass(subjects: Subject[]) {',
  '  const pendingSubjects = subjects.filter((s) => s.unchecked);',
  '  if (pendingSubjects.length === 0) {',
  '    return { checked: 0 };',
  '  }',
  '  for (const subject of pendingSubjects) {',
  '    void subject;',
  '  }',
  '  return { checked: pendingSubjects.length };',
  '}',
  '',
].join('\n');

const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      skipLibCheck: true,
    },
    include: ['src/**/*'],
  },
  null,
  2
);

/** 1-based line/column of the first occurrence of needle. */
function positionOf(text: string, needle: string): { line: number; column: number } {
  const index = text.indexOf(needle);
  const before = text.slice(0, index);
  return {
    line: before.split('\n').length,
    column: index - (before.lastIndexOf('\n') + 1) + 1,
  };
}

describe('a project edited after the server started', () => {
  let root: string;
  let service: TypeScriptLanguageService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-language-mcp-'));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'pass.ts'), SOURCE, 'utf-8');
    fs.writeFileSync(path.join(root, 'tsconfig.json'), TSCONFIG, 'utf-8');
    service = new TypeScriptLanguageService(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const read = (): string => fs.readFileSync(path.join(root, 'src', 'pass.ts'), 'utf-8');

  it('renames_against_the_text_the_previous_rename_wrote', () => {
    const property = positionOf(SOURCE, 'unchecked');
    const first = service.applyRename('src/pass.ts', property.line, property.column, 'checked');
    expect(first.success).toBe(true);

    const afterFirst = read();
    const local = positionOf(afterFirst, 'pendingSubjects');
    const second = service.applyRename('src/pass.ts', local.line, local.column, 'waiting');

    expect(second.success).toBe(true);
    expect(read().split('\n')).toEqual([
      'export interface Subject {',
      '  checked: boolean;',
      '}',
      '',
      'export function pass(subjects: Subject[]) {',
      '  const waiting = subjects.filter((s) => s.checked);',
      '  if (waiting.length === 0) {',
      '    return { checked: 0 };',
      '  }',
      '  for (const subject of waiting) {',
      '    void subject;',
      '  }',
      '  return { checked: waiting.length };',
      '}',
      '',
    ]);
  });

  it('reports_an_error_introduced_by_an_edit_made_outside_the_server', async () => {
    expect(await service.getDiagnostics('src/pass.ts', { includeEslint: false })).toEqual([]);

    fs.writeFileSync(
      path.join(root, 'src', 'pass.ts'),
      SOURCE.replace('void subject;', 'const wrong: number = subject;'),
      'utf-8'
    );
    service.refreshChangedFiles();

    const diagnostics = await service.getDiagnostics('src/pass.ts', { includeEslint: false });
    expect(diagnostics.map((d) => d.message).join('\n')).toContain('not assignable to type');
  });

  it('writes_nothing_when_the_compiler_offsets_no_longer_match_the_file', () => {
    // Freeze every file at the version the compiler already parsed, so its text
    // stays behind the file on disk. That is the state that corrupted files.
    const fileManager = (service as unknown as {
      fileManager: { getScriptVersion: (fileName: string) => string };
    }).fileManager;
    const readVersion = fileManager.getScriptVersion.bind(fileManager);
    const frozen = new Map<string, string>();
    fileManager.getScriptVersion = (fileName: string) => {
      if (!frozen.has(fileName)) frozen.set(fileName, readVersion(fileName));
      return frozen.get(fileName) as string;
    };

    const property = positionOf(SOURCE, 'unchecked');
    expect(service.applyRename('src/pass.ts', property.line, property.column, 'checked').success).toBe(
      true
    );

    const afterFirst = read();
    const local = positionOf(afterFirst, 'pendingSubjects');
    const result = service.applyRename('src/pass.ts', local.line, local.column, 'waiting');

    expect(result.success).toBe(false);
    expect(result.reason).toContain('Compiler offsets do not match');
    expect(result.filesModified).toEqual([]);
    expect(read()).toBe(afterFirst);
  });
});
