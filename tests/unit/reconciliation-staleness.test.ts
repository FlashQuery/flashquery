import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks (must be before imports)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: { getClient: vi.fn() },
}));
vi.mock('../../src/logging/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('pg', () => ({
  default: {
    Client: vi.fn(),
    escapeIdentifier: vi.fn((s: string) => `"${s}"`),
    escapeLiteral: vi.fn((s: string) => `'${s}'`),
  },
}));
vi.mock('../../src/utils/pg-client.js', () => ({
  createPgClientIPv4: vi.fn(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('../../src/storage/vault.js', () => ({
  atomicWriteFrontmatter: vi.fn().mockResolvedValue(undefined),
  vaultManager: { rootPath: '/vault' },
}));
vi.mock('../../src/plugins/manager.js', () => ({
  pluginManager: { getEntry: vi.fn(), getAllEntries: vi.fn() },
  getTypeRegistryMap: vi.fn(() => new Map()),
}));
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('---\nfqc_id: test-id\n---\nContent'),
}));

// ─────────────────────────────────────────────────────────────────────────────
// System-under-test imports (AFTER mocks)
// ─────────────────────────────────────────────────────────────────────────────

import {
  reconcilePluginDocuments,
  invalidateReconciliationCache,
} from '../../src/services/plugin-reconciliation.js';
import { supabaseManager } from '../../src/storage/supabase.js';
import { createPgClientIPv4 } from '../../src/utils/pg-client.js';
import { pluginManager } from '../../src/plugins/manager.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeEntry(pluginId: string) {
  return {
    plugin_id: pluginId,
    plugin_instance: 'default',
    table_prefix: `fqcp_${pluginId}_default_`,
    schema: {
      plugin: { id: pluginId, name: pluginId.toUpperCase(), version: '1.0' },
      tables: [],
      documents: {
        types: [
          {
            id: 'contact',
            folder: `${pluginId.toUpperCase()}/Contacts`,
            access: 'read-write',
            on_added: 'auto-track',
            on_moved: 'keep-tracking',
            on_modified: 'ignore',
            track_as: 'contacts',
          },
        ],
      },
    },
  } as any;
}

function setupPluginEntry(pluginId = 'crm') {
  vi.mocked(pluginManager.getEntry).mockReturnValue(makeEntry(pluginId));
}

/**
 * Minimal Supabase mock returning empty rows — staleness tests don't care about data.
 * Both Path 1 and Path 2 chains resolve to [].
 */
function setupFqcDocuments() {
  const makeChain = () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.or = vi.fn().mockReturnValue(chain);
    chain.in = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
    chain.insert = vi.fn().mockResolvedValue({ data: null, error: null });
    chain.delete = vi.fn().mockReturnValue(chain);
    chain.then = (resolve: (val: { data: []; error: null }) => void) =>
      resolve({ data: [], error: null });
    return chain;
  };

  vi.mocked(supabaseManager.getClient).mockReturnValue({
    from: vi.fn().mockReturnValue(makeChain()),
  } as any);
}

/**
 * Sets up a pg mock that is SPYABLE — returns the query mock so tests can
 * inspect call counts to verify whether pg was actually hit.
 */
function setupPgClient() {
  const query = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes('information_schema.columns')) {
      return Promise.resolve({ rows: [{ exists: 1 }] });
    }
    return Promise.resolve({ rows: [] });
  });
  vi.mocked(createPgClientIPv4).mockReturnValue({
    connect: vi.fn().mockResolvedValue(undefined),
    query,
    end: vi.fn().mockResolvedValue(undefined),
  } as any);
  return query;
}

// ─────────────────────────────────────────────────────────────────────────────
// Global reset
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  invalidateReconciliationCache();
  vi.useFakeTimers();
  process.env.DATABASE_URL = 'postgres://fake/test';
});

afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: reconciliation staleness cache (D-09, D-15)
// ─────────────────────────────────────────────────────────────────────────────

describe('reconciliation staleness cache', () => {
  it('skips reconciliation when called twice within 30 seconds (returns empty result)', async () => {
    setupPluginEntry('crm');
    setupFqcDocuments();
    const pgQuery = setupPgClient();

    // First call — should hit pg
    await reconcilePluginDocuments('crm', 'default');
    const firstCount = pgQuery.mock.calls.length;
    expect(firstCount).toBeGreaterThan(0);

    // Advance by 10 seconds (still within 30s window)
    vi.advanceTimersByTime(10_000);

    // Second call — should be suppressed by staleness cache
    const result2 = await reconcilePluginDocuments('crm', 'default');

    expect(result2.added.length).toBe(0);
    expect(result2.unchanged).toBe(0);
    // pg must NOT have been called again
    expect(pgQuery.mock.calls.length).toBe(firstCount);
  });

  it('runs in full after invalidateReconciliationCache() clears the cache', async () => {
    setupPluginEntry('crm');
    setupFqcDocuments();
    const pgQuery = setupPgClient();

    // First call
    await reconcilePluginDocuments('crm', 'default');
    const firstCount = pgQuery.mock.calls.length;

    // Advance 5 seconds, then invalidate the cache
    vi.advanceTimersByTime(5_000);
    invalidateReconciliationCache();

    // Re-setup mocks so the second run can proceed (mocks were already called once)
    setupPluginEntry('crm');
    setupFqcDocuments();

    // Second call — cache invalidated, should hit pg again
    await reconcilePluginDocuments('crm', 'default');

    expect(pgQuery.mock.calls.length).toBeGreaterThan(firstCount);
  });

  it('tracks independent cache entries per pluginId/instanceId pair (D-15)', async () => {
    // Setup: getEntry returns different entries based on pluginId
    vi.mocked(pluginManager.getEntry).mockImplementation((pluginId: string) =>
      makeEntry(pluginId),
    );
    setupFqcDocuments();
    const pgQuery = setupPgClient();

    // Run both plugins back-to-back (same moment — no time advance)
    await reconcilePluginDocuments('crm', 'default');
    const afterCrm = pgQuery.mock.calls.length;

    await reconcilePluginDocuments('hr', 'default');
    const afterHr = pgQuery.mock.calls.length;

    // The second call ('hr') must NOT be suppressed by the 'crm' staleness entry
    expect(afterHr).toBeGreaterThan(afterCrm);
  });

  it('expires cache after 30_001 ms and runs full reconciliation', async () => {
    setupPluginEntry('crm');
    setupFqcDocuments();
    const pgQuery = setupPgClient();

    // First call
    await reconcilePluginDocuments('crm', 'default');
    const firstCount = pgQuery.mock.calls.length;

    // Advance past the 30-second staleness threshold
    vi.advanceTimersByTime(30_001);

    // Re-setup mocks for second run
    setupPluginEntry('crm');
    setupFqcDocuments();

    // Second call — cache expired, should hit pg again
    await reconcilePluginDocuments('crm', 'default');

    expect(pgQuery.mock.calls.length).toBeGreaterThan(firstCount);
  });
});
