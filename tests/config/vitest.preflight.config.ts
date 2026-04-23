import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Excludes test files with known platform-specific failures (deferred).
// These files pass on Linux CI but fail on macOS due to git binary mock differences.
// Run `npm test` for the full suite; this config is used by `npm run preflight` only.
export default defineConfig({
  test: {
    root: resolve(import.meta.dirname, '../..'),
    include: ['tests/unit/**/*.test.ts'],
    exclude: [
      'tests/unit/git-manager.test.ts',
      'tests/unit/compound-tools.test.ts',
    ],
    globals: true,
    passWithNoTests: true,
  },
});
