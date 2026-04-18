import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    root: resolve(import.meta.dirname, '../..'),
    include: ['tests/benchmark/**/*.bench.ts'],
    setupFiles: ['tests/helpers/setup-env.ts'],
    globals: true,
    testTimeout: 120_000, // 2 minutes per test (vault generation + benchmark)
    maxWorkers: 1,
    minWorkers: 1,
  },
});
