/**
 * Stands in for whatever globals a test runner contributes (vitest, jest,
 * mocha). Declared locally so the fixture proves nested-config resolution
 * without depending on any particular runner being installed.
 */
declare global {
  function describe(name: string, fn: () => void): void;
  function it(name: string, fn: () => void): void;
  function expect(actual: unknown): { toBe(expected: unknown): void };
}

export {};
