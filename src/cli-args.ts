import type { ServerOptions } from './server.js';

/** Flags that take a value argument. */
const VALUE_FLAGS = new Set(['--name', '--description']);

/** Flags that report something and exit without starting a server. */
const MODE_FLAGS = new Map<string, 'help' | 'version'>([
  ['--help', 'help'],
  ['-h', 'help'],
  ['--version', 'version'],
  ['-v', 'version'],
]);

/** All recognised flags. */
const KNOWN_FLAGS = new Set([...VALUE_FLAGS, ...MODE_FLAGS.keys()]);

/** A command line that named what to do. */
export type CliArgs =
  | { ok: true; mode: 'help' }
  | { ok: true; mode: 'version' }
  | { ok: true; mode: 'serve'; projectRoot: string; options: ServerOptions }
  | { ok: false; error: string };

/**
 * Reads the command line.
 *
 * A single pass consumes each option's value as it goes. Scanning separately
 * to validate, to collect options and to find the project root let the passes
 * disagree — one treating an argument as a consumed value while another
 * treated the same argument as an option — so a typo could start the server
 * under a name nobody asked for.
 */
export function parseCliArgs(argv: string[]): CliArgs {
  // Reporting help or the version wins over anything else on the line, so
  // asking what a broken command should have been still gets an answer.
  for (const arg of argv) {
    const mode = MODE_FLAGS.get(arg);
    if (mode) return { ok: true, mode };
  }

  const options: ServerOptions = {};
  let projectRoot: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (!arg.startsWith('-')) {
      // The first bare argument is the project root; later ones are surplus.
      projectRoot ??= arg;
      continue;
    }

    if (!KNOWN_FLAGS.has(arg)) {
      return {
        ok: false,
        error: `Unknown option: "${arg}". Valid options: ${[...KNOWN_FLAGS].join(', ')}`,
      };
    }

    const value = argv[i + 1];
    if (value === undefined) {
      return { ok: false, error: `Option "${arg}" expects a value, but none was given.` };
    }
    if (value.startsWith('-')) {
      return {
        ok: false,
        error: `Option "${arg}" expects a value, but found the option "${value}".`,
      };
    }

    if (arg === '--name') options.name = value;
    else options.description = value;

    i++; // The value is consumed, so it is never read as a root or an option.
  }

  return { ok: true, mode: 'serve', projectRoot: projectRoot ?? process.cwd(), options };
}
