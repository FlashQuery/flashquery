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
// Tests: force_file_scan cache invalidation path (RECON-07, TEST-04)
// ─────────────────────────────────────────────────────────────────────────────

describe('force_file_scan cache invalidation — sync path', () => {
  it('calling invalidateReconciliationCache() allows a second full reconciliation run within the 30s window', async () => {
    // First run — populates cache
    setupPluginEntry('crm');
    setupFqcDocuments();
    const pgQuery = setupPgClient();
    await reconcilePluginDocuments('crm', 'default');
    const afterFirst = pgQuery.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    // Still within 30s — without invalidation, second call would be a no-op
    vi.advanceTimersByTime(5_000);

    // Simulate what force_file_scan does: invalidate THEN run
    invalidateReconciliationCache();

    // Re-setup mocks for the second run
    setupPluginEntry('crm');
    setupFqcDocuments();

    // Second run — must hit pg again because cache was cleared
    await reconcilePluginDocuments('crm', 'default');
    expect(pgQuery.mock.calls.length).toBeGreaterThan(afterFirst);
  });
});

describe('force_file_scan cache invalidation — background path', () => {
  it('invalidateReconciliationCache() before background scan enables the background run to execute in full', async () => {
    // First run — populate cache
    setupPluginEntry('crm');
    setupFqcDocuments();
    const pgQuery = setupPgClient();
    await reconcilePluginDocuments('crm', 'default');
    const afterFirst = pgQuery.mock.calls.length;

    // Advance 2s — still stale
    vi.advanceTimersByTime(2_000);

    // Without invalidation, reconciliation would be suppressed
    const suppressedResult = await reconcilePluginDocuments('crm', 'default');
    expect(suppressedResult.added.length).toBe(0);
    expect(suppressedResult.unchanged).toBe(0);
    expect(pgQuery.mock.calls.length).toBe(afterFirst); // pg not called again

    // Simulate background branch: invalidate THEN schedule reconciliation
    invalidateReconciliationCache();
    setupPluginEntry('crm');
    setupFqcDocuments();
    await reconcilePluginDocuments('crm', 'default');

    // pg must have been called again
    expect(pgQuery.mock.calls.length).toBeGreaterThan(afterFirst);
  });
});

describe('force_file_scan cache invalidation — post-invalidation run executes', () => {
  it('a run immediately after invalidateReconciliationCache() is NOT suppressed by the staleness window', async () => {
    setupPluginEntry('crm');
    setupFqcDocuments();
    const pgQuery = setupPgClient();

    // Populate cache
    await reconcilePluginDocuments('crm', 'default');
    const afterFirst = pgQuery.mock.calls.length;

    // Invalidate — simulates what force_file_scan now does
    invalidateReconciliationCache();

    // Re-setup for next run
    setupPluginEntry('crm');
    setupFqcDocuments();

    // Run immediately (no time advance) — must NOT be suppressed
    await reconcilePluginDocuments('crm', 'default');
    expect(pgQuery.mock.calls.length).toBeGreaterThan(afterFirst);
  });
});
