import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  // Reachability policy: PRODUCTION-SOURCE-ONLY.
  // The entry graph starts at the production CLI entry point (`src/index.ts`).
  // Test entrypoints, scripts, and fixtures are intentionally excluded so this gate
  // reports production source/package reachability rather than test-only helpers.
  // Existing exported API/tooling surfaces still pending triage are documented below
  // through explicit per-file `ignoreIssues` entries instead of hiding reporter classes.
  entry: ['src/index.ts'],
  project: [
    'src/**/*.ts',
    '!src/node_modules/**',
    '!src/dist/**',
  ],
  ignore: [
    '.claude/worktrees/**',
    'src/node_modules/**',
    'src/dist/**',
    'dist/**',
  ],
  ignoreDependencies: [
    '@types/uuid',
    'esbuild',
  ],
  tags: ['-@internal'],
  ignoreIssues: {
    // Existing public/plugin/test surfaces pending API-surface triage. Keep the
    // symbols named here aligned with `knip --include exports,types` output.
    'src/constants/template-warnings.ts': ['types'],
    'src/embedding/provider.ts': ['exports'],
    'src/llm/capabilities.ts': ['types'],
    'src/llm/config-sync.ts': ['exports'],
    'src/llm/cost-tracker.ts': ['types'],
    'src/llm/help-content.ts': ['exports', 'types'],
    'src/llm/reference-resolver.ts': ['exports', 'types'],
    'src/llm/tool-registry.ts': ['types'],
    'src/llm/types.ts': ['types'],
    'src/macro/evaluator.ts': ['types'],
    'src/macro/introspection.ts': ['exports'],
    'src/macro/preflight.ts': ['types'],
    'src/macro/progress-emitter.ts': ['types'],
    'src/macro/runtime-types.ts': ['types'],
    'src/macro/safe-points.ts': ['types'],
    'src/macro/tokens.ts': ['exports'],
    'src/macro/types.ts': ['types'],
    'src/mcp/auth.ts': ['exports'],
    // Phase 148: exported for lifecycle helper tests and shutdown-drain contract
    // documentation; production code consumes the returned shape structurally.
    'src/mcp/request-lifecycle.ts': ['types'],
    'src/mcp/tool-metadata.ts': ['types'],
    'src/mcp/tools/documents.ts': ['exports'],
    'src/mcp/utils/document-output.ts': ['exports', 'types'],
    'src/mcp/utils/resolve-document.ts': ['types'],
    'src/mcp/utils/markdown-sections.ts': ['types'],
    'src/mcp/utils/markdown-utils.ts': ['exports'],
    'src/mcp/utils/memory-output.ts': ['exports'],
    'src/mcp/utils/record-output.ts': ['exports', 'types'],
    'src/mcp/utils/record-validation.ts': ['types'],
    'src/mcp/utils/response-formats.ts': ['exports', 'types'],
    'src/mcp/utils/search-results.ts': ['types'],
    'src/plugins/manager.ts': ['exports'],
    'src/services/maintenance.ts': ['types'],
    'src/services/mcp-broker/cli.ts': ['types'],
    'src/services/mcp-broker/index.ts': ['exports'],
    'src/services/mcp-broker/tofu.ts': ['exports'],
    'src/services/mcp-broker/types.ts': ['types'],
    'src/services/plugin-reconciliation.ts': ['types'],
    'src/services/tool-search/indexer.ts': ['types'],
    'src/services/tool-search/tool-meta.ts': ['exports', 'types'],
    'src/storage/schema-verify.ts': ['exports'],
    'src/storage/supabase.ts': ['exports'],
    'src/storage/vault.ts': ['exports', 'types'],
    'src/utils/schema-migration.ts': ['exports'],
  },
};

export default config;
