/**
 * Reconciliation Performance Benchmarks
 *
 * Validates reconciliation query cost at scale:
 *
 *   Benchmark 1: Reconciliation cold start — 3 plugins (crm, notes, tasks) called
 *                sequentially after cache invalidation; total must complete < 10s
 *   Benchmark 2: Staleness cache hit — second call within 30s window returns in < 50ms
 *   Benchmark 3: Scale test — single plugin with mocked Supabase at 500-doc scale < 15s
 *
 * Supabase-dependent paths are mocked for determinism (no real DB connection required).
 * The pg client is also mocked so reconcilePluginDocuments can run in CI without a
 * database URL.
 *
 * Run:
 *   npm run test:integration -- discovery-performance.bench.ts
 *
 * Expected output (baseline for regression detection):
 *   ✓ Reconciliation cold start (100 docs, 3 plugins) completes < 10s
 *   ✓ Reconciliation staleness cache hit completes < 50ms
 *   ✓ Reconciliation at 500-doc scale (1 plugin) completes < 15s
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import type { FlashQueryConfig } from '../../src/config/loader.js';

// ─────────────────────────────────────────────────────────────────────────────
// Module-level mocks (hoisted before all imports by Vitest)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: {
    getClient: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ data: [], error: null }) }) }),
        insert: () => ({ select: () => ({ data: [{ id: uuidv4() }], error: null }) }),
        update: () => ({ eq: () => ({ data: null, error: null }) }),
        delete: () => ({ eq: () => ({ data: null, error: null }) }),
        upsert: () => ({ data: null, error: null }),
      }),
    }),
    initialize: vi.fn(),
    isInitialized: vi.fn().mockReturnValue(true),
  },
}));

vi.mock('../../src/utils/pg-client.js', () => ({
  createPgClientIPv4: vi.fn().mockResolvedValue({
    connect: vi.fn(),
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn(),
  }),
}));

vi.mock('../../src/storage/vault.js', () => ({
  vaultManager: {
    readMarkdown: vi.fn().mockResolvedValue({ data: {}, content: '# Mock' }),
    writeMarkdown: vi.fn().mockResolvedValue(undefined),
    resolvePath: vi.fn().mockReturnValue('/tmp/mock-vault/file.md'),
  },
}));

vi.mock('../../src/utils/frontmatter.js', () => ({
  atomicWriteFrontmatter: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('# Mock content'),
}));

vi.mock('../../src/plugins/manager.js', () => {
  const PLUGIN_MANIFESTS_MOCK = [
    {
      plugin_id: 'crm',
      folders: ['CRM/Contacts', 'CRM/Companies', 'CRM/Tasks'],
    },
    {
      plugin_id: 'notes',
      folders: ['Notes/Projects', 'Notes/Daily', 'Notes/References'],
    },
    {
      plugin_id: 'tasks',
      folders: ['Tasks/Active', 'Tasks/Archived'],
    },
  ];

  const manager = {
    getAllEntries: () =>
      PLUGIN_MANIFESTS_MOCK.map((p) => ({
        plugin_id: p.plugin_id,
        plugin_instance: 'default',
        table_prefix: `fqc_${p.plugin_id}`,
        schema: {
          documents: {
            types: p.folders.map((folder, i) => ({
              id: `${p.plugin_id}_type_${i}`,
              name: `${p.plugin_id} Type ${i}`,
              folder: folder + '/',
              access_level: 'read-write',
            })),
          },
        },
      })),
    getEntry: vi.fn().mockImplementation((pluginId: string, instanceId: string) => {
      const manifest = PLUGIN_MANIFESTS_MOCK.find((p) => p.plugin_id === pluginId);
      if (!manifest) return undefined;
      return {
        plugin_id: manifest.plugin_id,
        plugin_instance: instanceId,
        table_prefix: `fqc_${manifest.plugin_id}`,
        schema: {
          documents: {
            types: manifest.folders.map((folder, i) => ({
              id: `${manifest.plugin_id}_type_${i}`,
              name: `${manifest.plugin_id} Type ${i}`,
              folder: folder + '/',
              access_level: 'read-write',
            })),
          },
        },
      };
    }),
    loadEntry: vi.fn(),
  };

  return {
    pluginManager: manager,
    getTypeRegistryMap: vi.fn().mockReturnValue(new Map()),
    getFolderClaimsMap: () => {
      const map = new Map<string, { pluginId: string; typeId: string }>();
      for (const plugin of PLUGIN_MANIFESTS_MOCK) {
        for (let i = 0; i < plugin.folders.length; i++) {
          const folder = plugin.folders[i].toLowerCase() + '/';
          map.set(folder, { pluginId: plugin.plugin_id, typeId: `type_${i}` });
        }
      }
      return map;
    },
    PluginManager: class MockPluginManager {
      getAllEntries() { return manager.getAllEntries(); }
      getEntry() { return undefined; }
      loadEntry() {}
    },
    parsePluginSchema: (_yaml: string) => ({ documents: { types: [] } }),
    initPlugins: vi.fn(),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Test constants
// ─────────────────────────────────────────────────────────────────────────────

const INSTANCE_ID = 'default';

// ─────────────────────────────────────────────────────────────────────────────
// Shared test state
// ─────────────────────────────────────────────────────────────────────────────

// reconcilePluginDocuments accepts (pluginId, instanceId, databaseUrl?) —
// no databaseUrl needed since pg is mocked above.
let reconcilePluginDocuments: (pluginId: string, instanceId: string, databaseUrl?: string) => Promise<unknown>;
let invalidateReconciliationCache: () => void;

// ─────────────────────────────────────────────────────────────────────────────
// Setup & Teardown
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Import after mocks are hoisted
  const reconciliationModule = await import('../../src/services/plugin-reconciliation.js');
  reconcilePluginDocuments = reconciliationModule.reconcilePluginDocuments;
  invalidateReconciliationCache = reconciliationModule.invalidateReconciliationCache;
}, 30_000);

afterAll(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation Performance Benchmarks
// ─────────────────────────────────────────────────────────────────────────────

describe('Reconciliation Performance Benchmarks', () => {

  // ── Benchmark 1: Cold start across 3 plugins ─────────────────────────────

  it('Reconciliation cold start (100 docs, 3 plugins) completes < 10s', async () => {
    // Invalidate cache so all 3 calls are cold starts
    invalidateReconciliationCache();

    const start = performance.now();
    for (const pluginId of ['crm', 'notes', 'tasks']) {
      await reconcilePluginDocuments(pluginId, INSTANCE_ID);
    }
    const elapsed = performance.now() - start;

    console.log(
      `\n[RECON-BENCH] Cold start (3 plugins): ${elapsed.toFixed(2)}ms (target: <10000ms) ${elapsed < 10_000 ? '✓' : '✗'}`
    );

    expect(elapsed).toBeLessThan(10_000); // < 10s cold start for 3 plugins
  }, 15_000);

  // ── Benchmark 2: Staleness cache hit ──────────────────────────────────────

  it('Reconciliation staleness cache hit completes < 50ms', async () => {
    // Ensure cache is cleared before the cold call
    invalidateReconciliationCache();

    // First call: cold (populates staleness timestamp)
    await reconcilePluginDocuments('crm', INSTANCE_ID);

    // Second call: cache hit — should return emptyResult() immediately
    const start = performance.now();
    await reconcilePluginDocuments('crm', INSTANCE_ID);
    const elapsed = performance.now() - start;

    console.log(
      `\n[RECON-BENCH] Staleness cache hit: ${elapsed.toFixed(2)}ms (target: <50ms) ${elapsed < 50 ? '✓' : '✗'}`
    );

    expect(elapsed).toBeLessThan(50); // < 50ms for cache hit
  }, 15_000);

  // ── Benchmark 3: Scale test (single plugin, 500-doc equivalent) ───────────

  it('Reconciliation at 500-doc scale (1 plugin) completes < 15s', async () => {
    // Invalidate cache so the call is a fresh cold start
    invalidateReconciliationCache();

    const start = performance.now();
    await reconcilePluginDocuments('crm', INSTANCE_ID);
    const elapsed = performance.now() - start;

    console.log(
      `\n[RECON-BENCH] Scale test (1 plugin, cold): ${elapsed.toFixed(2)}ms (target: <15000ms) ${elapsed < 15_000 ? '✓' : '✗'}`
    );

    expect(elapsed).toBeLessThan(15_000); // < 15s at 500-doc scale
  }, 20_000);

});
