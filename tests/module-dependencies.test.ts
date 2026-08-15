/// <reference types="vitest" />
import * as path from 'path';
import YAML from 'yaml';
import { TypeScriptLanguageService } from '../src/language-service.js';
import { AstFinder } from '../src/ast-finder.js';
import { ToolHandler } from '../src/tools/index.js';
import type { ModuleDependenciesResult } from '../src/types.js';

const FIXTURE = path.join(__dirname, 'fixtures', 'deps-project');

describe('module dependencies', () => {
  let handler: ToolHandler;

  beforeAll(() => {
    const service = new TypeScriptLanguageService(FIXTURE);
    handler = new ToolHandler(service, new AstFinder(service));
  });

  async function deps(
    file: string,
    extra: Record<string, unknown> = {}
  ): Promise<ModuleDependenciesResult> {
    const result = await handler.handleTool('get_module_dependencies', { file, ...extra });
    expect(result.isError).toBeUndefined();
    return YAML.parse(result.content[0].text) as ModuleDependenciesResult;
  }

  it('resolves an import written through a tsconfig paths alias', async () => {
    const result = await deps('src/aliased-consumer.ts');

    const aliased = result.imports!.find((i) => i.module === '@core/logger');
    expect(aliased).toBeDefined();
    expect(aliased!.resolvedFile).toBe('src/core/logger.ts');
    expect(aliased!.external).toBe(false);
  });

  it('picks up dynamic imports as well as static ones', async () => {
    const result = await deps('src/relative-consumer.ts');
    const kinds = result.imports!.map((i) => i.kind);

    expect(kinds).toContain('import');
    expect(kinds).toContain('dynamic-import');
  });

  it('reports the files that import a module', async () => {
    const result = await deps('src/core/logger.ts');
    const importers = result.importedBy!.map((d) => d.file);

    expect(importers).toContain('src/aliased-consumer.ts');
    expect(importers).toContain('src/relative-consumer.ts');
  });

  it('counts afferent coupling from real importers', async () => {
    const result = await deps('src/core/logger.ts');

    expect(result.metrics.afferentCoupling).toBe(2);
    expect(result.metrics.efferentCoupling).toBe(0);
    expect(result.metrics.instability).toBe(0);
  });

  it('treats a leaf consumer as fully unstable', async () => {
    const result = await deps('src/aliased-consumer.ts');

    expect(result.metrics.efferentCoupling).toBe(1);
    expect(result.metrics.afferentCoupling).toBe(0);
    expect(result.metrics.instability).toBe(1);
  });

  it('omits the half of the graph the caller did not ask for', async () => {
    const onlyImports = await deps('src/core/logger.ts', { direction: 'imports' });
    const onlyDependents = await deps('src/core/logger.ts', { direction: 'importedBy' });

    expect(onlyImports.importedBy).toBeUndefined();
    expect(onlyImports.imports).toBeDefined();
    expect(onlyDependents.imports).toBeUndefined();
    expect(onlyDependents.importedBy).toBeDefined();
  });

  it('leaves external modules out unless asked', async () => {
    const withoutExternal = await deps('src/aliased-consumer.ts');
    expect(withoutExternal.imports!.every((i) => !i.external)).toBe(true);
  });
});
