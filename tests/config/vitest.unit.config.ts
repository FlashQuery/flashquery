import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    root: resolve(import.meta.dirname, '../..'),
    include: ['tests/unit/**/*.test.ts'],
    globals: true,
    passWithNoTests: true,
  },
});
