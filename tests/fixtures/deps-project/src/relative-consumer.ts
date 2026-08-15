import { log } from './core/logger';

export async function lazy(): Promise<void> {
  // A dynamic import, which a statements-only scan would miss.
  const mod = await import('./core/logger');
  mod.log('lazy');
  log('eager');
}
