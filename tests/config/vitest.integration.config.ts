import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    root: resolve(import.meta.dirname, '../..'),
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['tests/helpers/setup-build.ts', 'tests/helpers/setup-env.ts'],
    globals: true,
    testTimeout: 30000,
    // Integration tests share module-level singletons (supabaseManager, pluginManager).
    // maxWorkers: 1 ensures one file runs at a time, preventing DDL races and singleton conflicts.
    maxWorkers: 1,
    minWorkers: 1,
  },
});
