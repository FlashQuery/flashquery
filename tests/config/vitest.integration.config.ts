import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    root: resolve(import.meta.dirname, '../..'),
    include: [
      'tests/integration/documents.integration.test.ts',
      'tests/integration/save-memory-tags.test.ts',
      'tests/integration/compound-tools.integration.test.ts',
      'tests/integration/llm-config-sync.test.ts',
      'tests/integration/tool-registry.test.ts',
      'tests/integration/archive-document-lock.test.ts',
      'tests/integration/macro-parse-error.test.ts',
      'tests/integration/macro-shell-verbs.integration.test.ts',
      'tests/integration/macro-tool-dispatch.test.ts',
      'tests/integration/macro-concurrency.test.ts',
      'tests/integration/macro-call-macro-session.test.ts',
    ],
    setupFiles: ['tests/helpers/setup-build.ts', 'tests/helpers/setup-env.ts'],
    globals: true,
    testTimeout: 30000,
    // Integration tests share module-level singletons (supabaseManager, pluginManager).
    // maxWorkers: 1 ensures one file runs at a time, preventing DDL races and singleton conflicts.
    maxWorkers: 1,
    minWorkers: 1,
  },
});
