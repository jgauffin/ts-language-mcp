import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite resolves tsconfig "paths" natively, so the vite-tsconfig-paths
  // plugin it replaced is no longer a dependency.
  resolve: { tsconfigPaths: true },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.*/**'],
    environment: 'node',
    globals: true,
  },
});