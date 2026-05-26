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
      'tests/integration/plugin-reconciliation.integration.test.ts',
      'tests/integration/archive-document-lock.test.ts',
      'tests/integration/reference-resolver.integration.test.ts',
      'tests/integration/supabase-schema-verify.test.ts',
      'tests/integration/template-tools.integration.test.ts',
      'tests/integration/macro-parse-error.test.ts',
      'tests/integration/macro-shell-verbs.integration.test.ts',
      'tests/integration/macro-tool-dispatch.test.ts',
      'tests/integration/macro-concurrency.test.ts',
      'tests/integration/macro-call-macro-session.test.ts',
      'tests/integration/macro-source-ref.integration.test.ts',
      'tests/integration/macro-write-lock.integration.test.ts',
      'tests/integration/mcp-broker/client-lifecycle.test.ts',
      'tests/integration/mcp-broker/dispatch.test.ts',
      'tests/integration/mcp-broker/host-surface.test.ts',
      'tests/integration/mcp-broker/tofu-list-changed.test.ts',
      'tests/integration/mcp/tools/memory-plugin-scope.test.ts',
      'tests/integration/embedding/background-embed-doc-memory-record.test.ts',
      'tests/integration/embedding/pending-embed-worker.test.ts',
      'tests/integration/doctor/embedding-diagnostics.test.ts',
      'tests/integration/mcp/tools/records-pg-pool.test.ts',
      'tests/integration/services/scanner-embed-drain.test.ts',
      'tests/integration/server/shutdown-mcp-drain.test.ts',
      'tests/integration/tool-search/*.test.ts',
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
