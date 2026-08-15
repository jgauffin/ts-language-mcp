import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * The package version, read from package.json so the CLI, the MCP handshake
 * and npm can never drift apart.
 */
export function getVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // dist/version.js sits one level below the package root.
    const manifest = path.join(here, '..', 'package.json');
    return JSON.parse(fs.readFileSync(manifest, 'utf-8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
