/// <reference types="vitest" />
import * as path from 'path';
import { ProjectRegistry } from '../src/project-registry.js';

const NESTED_FIXTURE = path.join(__dirname, 'fixtures', 'nested-config-project');

/** A file the nested tests/tsconfig.json governs, not the root config. */
const NESTED_FILE = 'tests/calculator.spec.ts';

/** A file the root tsconfig.json governs. */
const ROOT_FILE = 'src/calculator.ts';

/**
 * A repository splits its sources across several tsconfigs, and every answer
 * about a file has to come from the config that actually governs it. Answering
 * from the root config instead describes a project that does not exist: the
 * file may be absent from that program entirely, and its aliases unresolvable.
 *
 * These rules hold for every question the registry can be asked, not only the
 * ones someone remembered to route.
 */
describe('answers come from the config that governs the file', () => {
  it('reports_the_config_that_governs_the_file_not_the_root_config', () => {
    const registry = new ProjectRegistry(NESTED_FIXTURE);

    const nestedConfig = registry.getConfigPath(NESTED_FILE);
    const rootConfig = registry.getConfigPath(ROOT_FILE);

    // The nested file is governed by tests/tsconfig.json; naming the root
    // config would misdescribe which options were applied.
    expect(nestedConfig.replace(/\\/g, '/')).toContain('tests/tsconfig.json');
    expect(rootConfig.replace(/\\/g, '/')).not.toContain('tests/tsconfig.json');
  });

  it('compiler_options_come_from_the_governing_project', () => {
    const registry = new ProjectRegistry(NESTED_FIXTURE);

    // Only the nested config declares "paths"; the root config has none.
    const nestedOptions = registry.getCompilerOptions(NESTED_FILE);
    const rootOptions = registry.getCompilerOptions(ROOT_FILE);

    expect(nestedOptions.paths).toBeDefined();
    expect(rootOptions.paths).toBeUndefined();
  });

  it('program_for_a_nested_config_file_contains_that_file', () => {
    const registry = new ProjectRegistry(NESTED_FIXTURE);

    const program = registry.getProgram(NESTED_FILE);
    const absolute = path.resolve(NESTED_FIXTURE, NESTED_FILE);

    // A program that omits the file cannot answer any question about it.
    expect(program?.getSourceFile(absolute)).toBeDefined();
  });

  it('module_specifier_resolves_through_the_governing_projects_paths_aliases', () => {
    const registry = new ProjectRegistry(NESTED_FIXTURE);

    // "@fixture/*" exists only in tests/tsconfig.json. Resolving under the
    // root config, which declares no such alias, yields nothing.
    const resolved = registry.resolveModule('@fixture/support.js', NESTED_FILE);

    expect(resolved).toBeDefined();
    expect(resolved?.replace(/\\/g, '/')).toContain('tests/support.ts');
  });

  it('unconfigured_state_is_reported_per_file_not_for_the_registry', () => {
    const registry = new ProjectRegistry(NESTED_FIXTURE);

    // Both files are governed by a real config; neither is inferred.
    expect(registry.isUnconfigured(NESTED_FILE)).toBe(false);
    expect(registry.isUnconfigured(ROOT_FILE)).toBe(false);
    // This one sits outside every config.
    expect(registry.isUnconfigured('scripts/release.ts')).toBe(true);
  });
});
