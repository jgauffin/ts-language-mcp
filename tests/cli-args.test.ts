/// <reference types="vitest" />
import { parseCliArgs } from '../src/cli-args.js';

/**
 * A mistyped command line must be reported, not guessed at. Silently taking a
 * flag as another flag's value starts the server under a name the caller never
 * asked for, and silently dropping a value leaves them believing an option
 * took effect when it did not.
 */
describe('command line parsing', () => {
  it('flag_used_where_a_value_is_expected_is_rejected', () => {
    const result = parseCliArgs(['--name', '--description', 'x', './proj']);

    expect(result.ok).toBe(false);
    // Naming both the option and what was found makes the typo obvious.
    expect(result.ok === false && result.error).toContain('--name');
    expect(result.ok === false && result.error).toContain('--description');
  });

  it('option_missing_its_value_is_rejected', () => {
    const result = parseCliArgs(['./proj', '--name']);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('--name');
  });

  it('project_root_is_not_confused_with_an_option_value', () => {
    const result = parseCliArgs(['--name', 'myserver', './proj']);

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.options.name).toBe('myserver');
    expect(result.ok === true && result.projectRoot).toBe('./proj');
  });

  it('unknown_option_is_rejected', () => {
    const result = parseCliArgs(['--nope']);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('--nope');
  });

  it('both_named_options_are_read', () => {
    const result = parseCliArgs(['--name', 'srv', '--description', 'does things', './proj']);

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.options.name).toBe('srv');
    expect(result.ok === true && result.options.description).toBe('does things');
    expect(result.ok === true && result.projectRoot).toBe('./proj');
  });

  it('help_and_version_are_reported_before_anything_else_is_parsed', () => {
    // These short-circuit, so they must win even alongside a broken option.
    expect(parseCliArgs(['--help', '--name']).ok === true &&
      parseCliArgs(['--help', '--name']).mode).toBe('help');
    expect(parseCliArgs(['-v']).ok === true && parseCliArgs(['-v']).mode).toBe('version');
  });

  it('project_root_defaults_to_the_current_directory', () => {
    const result = parseCliArgs([]);

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.projectRoot).toBe(process.cwd());
  });

  it('a_value_that_looks_like_a_path_is_kept_as_the_option_value', () => {
    // The value belongs to --name even though it could pass for a root.
    const result = parseCliArgs(['--name', './looks-like-a-path']);

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.options.name).toBe('./looks-like-a-path');
    expect(result.ok === true && result.projectRoot).toBe(process.cwd());
  });
});
