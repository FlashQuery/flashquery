import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    root: resolve(import.meta.dirname, '../..'),
    include: ['tests/e2e/http-transport.test.ts'],
    setupFiles: ['tests/helpers/setup-env.ts'],
    globals: true,
    testTimeout: 30000,
  },
});
