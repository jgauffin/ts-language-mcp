// Imported through the tsconfig "paths" alias rather than a relative path.
// Plain path matching cannot resolve this; the compiler can.
import { log } from '@core/logger';

export function run(): void {
  log('running');
}
