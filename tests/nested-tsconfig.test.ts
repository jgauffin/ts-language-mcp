/// <reference types="vitest" />
import * as path from 'path';
import YAML from 'yaml';
import { ProjectRegistry } from '../src/project-registry.js';
import { AstFinder } from '../src/ast-finder.js';
import { ToolHandler } from '../src/tools/index.js';

const NESTED_FIXTURE = path.join(__dirname, 'fixtures', 'nested-config-project');

function makeHandler(root: string) {
  const registry = new ProjectRegistry(root);
  return { registry, handler: new ToolHandler(registry, new AstFinder(registry)) };
}

/**
 * A test file usually sits outside the root tsconfig and is governed by its own
 * config, which is where the runner's globals are declared. Analysing it under
 * the root config instead reports every global as an undefined name — advice
 * that sends a developer chasing errors the real compiler never raises.
 */
describe('nested tsconfig resolution', () => {
  it('file_governed_by_nested_tsconfig_is_analyzed_under_that_config', async () => {
    const { handler } = makeHandler(NESTED_FIXTURE);

    const result = await handler.handleTool('get_diagnostics', {
      file: 'tests/calculator.spec.ts',
    });
    const text = result.content[0].text;

    expect(result.isError).toBeUndefined();
    // The nested config declares describe/it/expect, so none may be unresolved.
    expect(text).not.toContain("Cannot find name 'describe'");
    expect(text).not.toContain("Cannot find name 'it'");
    expect(text).not.toContain("Cannot find name 'expect'");
  });

  it('excluded_file_is_not_reported_as_missing', async () => {
    const { handler } = makeHandler(NESTED_FIXTURE);

    const result = await handler.handleTool('get_diagnostics', {
      file: 'tests/calculator.spec.ts',
    });

    // The file plainly exists; claiming otherwise sends the caller hunting a typo.
    expect(result.content[0].text).not.toContain('File not found');
  });

  it('root_config_files_are_still_analyzed_normally', async () => {
    const { handler } = makeHandler(NESTED_FIXTURE);

    const result = await handler.handleTool('get_diagnostics', {
      file: 'src/calculator.ts',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).not.toContain('File not found');
  });
});

/**
 * When no config governs a file the server still answers, but has to say the
 * answer rests on inferred options, so a caller knows how far to trust an
 * unresolved-name error.
 */
describe('files outside every tsconfig', () => {
  it('file_outside_every_tsconfig_is_analyzed_with_a_warning', async () => {
    const { handler } = makeHandler(NESTED_FIXTURE);

    const result = await handler.handleTool('get_diagnostics', {
      file: 'scripts/release.ts',
    });
    const text = result.content[0].text;

    expect(result.isError).toBeUndefined();
    expect(text).not.toContain('File not found');
    expect(text.toLowerCase()).toContain('tsconfig');
  });

  it('genuine_missing_file_is_still_reported_as_not_found', async () => {
    const { handler } = makeHandler(NESTED_FIXTURE);

    const result = await handler.handleTool('get_diagnostics', {
      file: 'src/does-not-exist.ts',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('File not found');
  });
});

/**
 * Project-wide reporting must span every config, otherwise a whole test suite
 * silently drops out of the quality picture.
 */
describe('project-wide reporting across configs', () => {
  it('project_wide_diagnostics_cover_every_discovered_config', async () => {
    const { handler } = makeHandler(NESTED_FIXTURE);

    const result = await handler.handleTool('get_all_diagnostics', {});
    const parsed = YAML.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(parsed).toHaveProperty('summary');
  });

  it('lists_files_from_every_discovered_config', () => {
    const { registry } = makeHandler(NESTED_FIXTURE);

    const files = registry.getProjectFiles();

    expect(files).toContain('src/calculator.ts');
    expect(files).toContain('tests/calculator.spec.ts');
  });
});
