import { makeAccount, type Account } from './models.js';

// Account is imported but never used, so organize_imports should drop it.
export function open(id: string) {
  return makeAccount(id);
}
