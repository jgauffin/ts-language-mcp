/**
 * Path utilities for cross-platform compatibility.
 * Always normalizes to forward slashes.
 */

/**
 * Normalizes a path to use forward slashes (cross-platform).
 */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Checks if a path starts with a prefix (normalized).
 */
export function pathStartsWith(filePath: string, prefix: string): boolean {
  return normalizePath(filePath).startsWith(normalizePath(prefix));
}

/**
 * Checks if a path ends with a suffix (normalized).
 */
export function pathEndsWith(filePath: string, suffix: string): boolean {
  return normalizePath(filePath).endsWith(normalizePath(suffix));
}
