import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    root: resolve(import.meta.dirname, '../..'),
    include: [
      // Single entrypoint — the runner discovers YAML cases at module-load
      // time and registers describe/it blocks (per §9.3 explicit include
      // convention, mirroring vitest.integration.config.ts).
      'tests/macro-framework/cases.test.ts',
      // TypeScript escape-hatch tests (cases-ts/) when present.
      'tests/macro-framework/cases-ts/**/*.test.ts',
    ],
    // Only setup-env is needed — the macro framework drives the engine
    // in-process (no `node dist/index.js` spawn), so the integration suite's
    // setup-build.ts (which rebuilds the prod bundle) is wasted overhead
    // here. setup-env loads `.env.test` so the real Supabase + real native
    // FQ handlers (per §5.1) get their credentials.
    setupFiles: ['tests/helpers/setup-env.ts'],
    globals: true,
    testTimeout: 30000,
    // Mirror integration: module-level singletons (supabaseManager,
    // pluginManager) require single-worker execution to prevent DDL races
    // and singleton conflicts. Per §9.7.
    maxWorkers: 1,
    minWorkers: 1,
  },
});
