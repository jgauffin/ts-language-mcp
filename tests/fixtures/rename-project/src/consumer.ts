import { timeout } from './config.js';

// Shorthand property: the key is part of the returned shape and must survive
// a rename of the binding, so this has to become { timeout: <newName> }.
export function makeOptions(): { timeout: number } {
  return { timeout };
}
