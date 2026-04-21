import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  vaultManager: { rootPath: '/vault' },
}));
vi.mock('../../src/utils/frontmatter.js', () => ({
  atomicWriteFrontmatter: vi.fn().mockResolvedValue(undefined),
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
  executeReconciliationActions,
} from '../../src/services/plugin-reconciliation.js';
import { supabaseManager } from '../../src/storage/supabase.js';
import { createPgClientIPv4 } from '../../src/utils/pg-client.js';
import { pluginManager } from '../../src/plugins/manager.js';
import { atomicWriteFrontmatter } from '../../src/utils/frontmatter.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

type FqcDocRow = {
  id: string;
  path: string;
  status: string;
  updated_at: string;
  ownership_plugin_id: string | null;
  ownership_type: string | null;
  content_hash: string | null;
};

type PluginRow = {
  id: string;
  fqc_id: string;
  status: string;
  path: string | null;
  last_seen_updated_at: string | null;
};

function validFqcDoc(overrides: Partial<FqcDocRow> = {}): FqcDocRow {
  return {
    id: 'doc-1',
    path: 'CRM/Contacts/alice.md',
    status: 'active',
    updated_at: '2026-04-20T10:00:00Z',
    ownership_plugin_id: 'crm',
    ownership_type: 'contact',
    content_hash: 'hash1',
    ...overrides,
  };
}

function validPluginRow(overrides: Partial<PluginRow> = {}): PluginRow {
  return {
    id: 'row-1',
    fqc_id: 'doc-1',
    status: 'active',
    path: 'CRM/Contacts/alice.md',
    last_seen_updated_at: '2026-04-20T10:00:00Z',
    ...overrides,
  };
}

function makeDocType(overrides: Partial<{
  id: string;
  folder: string;
  track_as: string;
  on_added: string;
  on_moved: string;
  on_modified: string;
}> = {}) {
  return {
    id: overrides.id ?? 'contact',
    folder: overrides.folder ?? 'CRM/Contacts',
    access: 'read-write',
    on_added: overrides.on_added ?? 'auto-track',
    on_moved: overrides.on_moved ?? 'keep-tracking',
    on_modified: overrides.on_modified ?? 'ignore',
    track_as: overrides.track_as ?? 'contacts',
  };
}

function setupPluginEntry(docTypes?: ReturnType<typeof makeDocType>[]) {
  const types = docTypes ?? [makeDocType()];
  vi.mocked(pluginManager.getEntry).mockReturnValue({
    plugin_id: 'crm',
    plugin_instance: 'default',
    table_prefix: 'fqcp_crm_default_',
    schema: {
      plugin: { id: 'crm', name: 'CRM', version: '1.0' },
      tables: [],
      documents: { types },
    },
  } as any);
}

/**
 * Sets up the Supabase mock so that BOTH Path 1 (.or()) and Path 2 (.in())
 * return the provided rows. Since the reconciler merges by id, duplicate rows
 * are deduplicated naturally.
 */
function setupFqcDocuments(rows: FqcDocRow[]) {
  const makeChain = () => {
    const chain: Record<string, unknown> = {};
    // Each chainable method returns the same chain
    chain.select = vi.fn().mockReturnValue(chain);
    chain.or = vi.fn().mockReturnValue(chain);
    chain.in = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn().mockResolvedValue({ data: rows[0] ?? null, error: null });
    chain.insert = vi.fn().mockResolvedValue({ data: null, error: null });
    chain.delete = vi.fn().mockReturnValue(chain);
    // Make the chain awaitable — resolves with rows when awaited
    chain.then = (resolve: (val: { data: FqcDocRow[]; error: null }) => void) =>
      resolve({ data: rows, error: null });
    return chain;
  };

  vi.mocked(supabaseManager.getClient).mockReturnValue({
    from: vi.fn().mockReturnValue(makeChain()),
  } as any);
}

function setupPgClient(pluginTableRows: PluginRow[]) {
  vi.mocked(createPgClientIPv4).mockReturnValue({
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('information_schema.columns')) {
        // Self-healing check: column exists, no ALTER needed
        return Promise.resolve({ rows: [{ exists: 1 }] });
      }
      if (/FROM\s+"fqcp_/i.test(sql)) {
        return Promise.resolve({ rows: pluginTableRows });
      }
      return Promise.resolve({ rows: [] });
    }),
    end: vi.fn().mockResolvedValue(undefined),
  } as any);
}

// ─────────────────────────────────────────────────────────────────────────────
// Global reset before each test
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  invalidateReconciliationCache();
  process.env.DATABASE_URL = 'postgres://fake/test';
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: classification states
// ─────────────────────────────────────────────────────────────────────────────

describe('reconcilePluginDocuments — added', () => {
  it('classifies a new document in a watched folder as added', async () => {
    setupPluginEntry();
    setupFqcDocuments([validFqcDoc({ id: 'doc-new', ownership_plugin_id: null, ownership_type: null, path: 'CRM/Contacts/new.md' })]);
    setupPgClient([]);

    const result = await reconcilePluginDocuments('crm', 'default');

    expect(result.added.length).toBe(1);
    expect(result.added[0].fqcId).toBe('doc-new');
    expect(result.resurrected.length).toBe(0);
  });
});

describe('reconcilePluginDocuments — deleted', () => {
  it('classifies plugin row as deleted when fqc_documents row is missing', async () => {
    setupPluginEntry();
    // No fqc_documents rows — the doc is gone
    setupFqcDocuments([]);
    // Plugin table has one active row
    setupPgClient([validPluginRow({ fqc_id: 'doc-gone', id: 'row-gone', status: 'active' })]);

    const result = await reconcilePluginDocuments('crm', 'default');

    expect(result.deleted.length).toBe(1);
    expect(result.deleted[0].fqcId).toBe('doc-gone');
  });
});

describe('reconcilePluginDocuments — modified', () => {
  it('classifies as modified when fqc_documents.updated_at differs from plugin_row.last_seen_updated_at', async () => {
    setupPluginEntry();
    setupFqcDocuments([validFqcDoc({ updated_at: '2026-04-20T11:00:00Z' })]);
    setupPgClient([validPluginRow({ last_seen_updated_at: '2026-04-20T10:00:00Z' })]);

    const result = await reconcilePluginDocuments('crm', 'default');

    expect(result.modified.length).toBe(1);
    expect(result.modified[0].fqcId).toBe('doc-1');
  });
});

describe('reconcilePluginDocuments — unchanged', () => {
  it('classifies as unchanged when updated_at equals last_seen_updated_at', async () => {
    setupPluginEntry();
    const ts = '2026-04-20T10:00:00Z';
    setupFqcDocuments([validFqcDoc({ updated_at: ts })]);
    setupPgClient([validPluginRow({ last_seen_updated_at: ts })]);

    const result = await reconcilePluginDocuments('crm', 'default');

    expect(result.unchanged).toBe(1);
    expect(result.modified.length).toBe(0);
    expect(result.added.length).toBe(0);
  });
});

describe('reconcilePluginDocuments — resurrected', () => {
  it('classifies archived plugin row + active fqc_documents as resurrected', async () => {
    setupPluginEntry();
    setupFqcDocuments([validFqcDoc({ status: 'active' })]);
    setupPgClient([validPluginRow({ status: 'archived' })]);

    const result = await reconcilePluginDocuments('crm', 'default');

    expect(result.resurrected.length).toBe(1);
    expect(result.added.length).toBe(0);
  });

  it('OQ-7: archived plugin row is NOT misclassified as added (resurrection guard)', async () => {
    setupPluginEntry();
    setupFqcDocuments([validFqcDoc({ status: 'active' })]);
    setupPgClient([validPluginRow({ status: 'archived' })]);

    const result = await reconcilePluginDocuments('crm', 'default');

    expect(result.added.length).toBe(0);
    expect(result.resurrected.length).toBe(1);
  });
});

describe('reconcilePluginDocuments — deleted (fqc row archived)', () => {
  it('classifies plugin row as deleted when fqc_documents row has archived status', async () => {
    setupPluginEntry();
    // fqc_documents shows the doc is archived
    setupFqcDocuments([validFqcDoc({ status: 'archived' })]);
    // Plugin table has one active row
    setupPgClient([validPluginRow({ status: 'active' })]);

    const result = await reconcilePluginDocuments('crm', 'default');

    expect(result.deleted.length).toBe(1);
    expect(result.deleted[0].fqcId).toBe('doc-1');
  });
});

describe('reconcilePluginDocuments — disassociated', () => {
  it('classifies as disassociated when ownership_plugin_id points to another plugin', async () => {
    setupPluginEntry();
    setupFqcDocuments([validFqcDoc({ ownership_plugin_id: 'other-plugin' })]);
    setupPgClient([validPluginRow()]);

    const result = await reconcilePluginDocuments('crm', 'default');

    expect(result.disassociated.length).toBe(1);
    expect(result.disassociated[0].fqcId).toBe('doc-1');
  });
});

describe('reconcilePluginDocuments — moved', () => {
  it('classifies as moved when path is outside watched folders', async () => {
    setupPluginEntry(); // watches CRM/Contacts
    // fqcDoc now has a path outside the watched folder
    setupFqcDocuments([validFqcDoc({ path: 'Archive/relocated.md' })]);
    setupPgClient([validPluginRow({ path: 'CRM/Contacts/alice.md' })]);

    const result = await reconcilePluginDocuments('crm', 'default');

    expect(result.moved.length).toBe(1);
    expect(result.moved[0].newPath).toBe('Archive/relocated.md');
  });
});

describe('reconcilePluginDocuments — idempotency', () => {
  it('returns all unchanged on second run with no changes (D-14)', async () => {
    setupPluginEntry();
    const ts = '2026-04-20T10:00:00Z';
    setupFqcDocuments([validFqcDoc({ updated_at: ts })]);
    setupPgClient([validPluginRow({ last_seen_updated_at: ts })]);

    // First run
    const run1 = await reconcilePluginDocuments('crm', 'default');
    expect(run1.unchanged).toBe(1);

    // Reset staleness so the second run is not suppressed
    invalidateReconciliationCache();

    // Reset mocks to re-apply same data
    vi.clearAllMocks();
    setupPluginEntry();
    setupFqcDocuments([validFqcDoc({ updated_at: ts })]);
    setupPgClient([validPluginRow({ last_seen_updated_at: ts })]);
    process.env.DATABASE_URL = 'postgres://fake/test';

    // Second run
    const run2 = await reconcilePluginDocuments('crm', 'default');
    expect(run2.unchanged).toBe(1);
    expect(run2.added.length).toBe(0);
    expect(run2.modified.length).toBe(0);
  });
});

describe('reconcilePluginDocuments — Path 2 ownership-type discovery', () => {
  it('Path 2: classifies a document outside watched folder as added when ownership_type matches a plugin typeId', async () => {
    // folder='CRM/Contacts', typeId='contact'
    setupPluginEntry([makeDocType({ id: 'contact', folder: 'CRM/Contacts', track_as: 'contacts' })]);
    // doc is OUTSIDE CRM/Contacts but has ownership_type='contact'
    setupFqcDocuments([validFqcDoc({
      id: 'doc-out',
      path: 'Archive/relocated.md',
      ownership_type: 'contact',
      ownership_plugin_id: null,
    })]);
    // No plugin row for this doc
    setupPgClient([]);

    const result = await reconcilePluginDocuments('crm', 'default');

    expect(result.added.length).toBe(1);
    expect(result.added[0].fqcId).toBe('doc-out');
    expect(result.added[0].typeId).toBe('contact');
  });

  it('Path 2: merges deduplicated when same doc returned by both Path 1 and Path 2', async () => {
    setupPluginEntry([makeDocType({ id: 'contact', folder: 'CRM/Contacts', track_as: 'contacts' })]);
    // This doc: path matches watched folder AND ownership_type matches
    // Both Path 1 (.or folder) and Path 2 (.in ownership_type) return the SAME row
    setupFqcDocuments([validFqcDoc({
      id: 'doc-both',
      path: 'CRM/Contacts/alice.md',
      ownership_type: 'contact',
      ownership_plugin_id: null,
    })]);
    setupPgClient([]);

    const result = await reconcilePluginDocuments('crm', 'default');

    // Deduplication by id: should be 1, NOT 2
    expect(result.added.length).toBe(1);
    expect(result.added[0].fqcId).toBe('doc-both');
  });
});

describe('reconcilePluginDocuments — mutual exclusivity', () => {
  it('classifies every fqcId into exactly one bucket — sum of all bucket counts equals total unique fqcIds', async () => {
    // 5 distinct fqcIds: one of each state
    // added: doc-new (no plugin row, path in watched folder)
    // deleted: doc-del (plugin row active, no fqc_documents)
    // modified: doc-mod (plugin row active, timestamps differ)
    // unchanged: doc-unch (plugin row active, same timestamps)
    // resurrected: doc-res (plugin row archived, fqc_documents active)

    setupPluginEntry();

    const fqcDocs: FqcDocRow[] = [
      // added
      validFqcDoc({ id: 'doc-new', path: 'CRM/Contacts/new.md', ownership_plugin_id: null, ownership_type: null }),
      // modified
      validFqcDoc({ id: 'doc-mod', updated_at: '2026-04-20T11:00:00Z' }),
      // unchanged
      validFqcDoc({ id: 'doc-unch', path: 'CRM/Contacts/unch.md', updated_at: '2026-04-20T09:00:00Z' }),
      // resurrected
      validFqcDoc({ id: 'doc-res', path: 'CRM/Contacts/res.md', status: 'active' }),
    ];
    setupFqcDocuments(fqcDocs);

    const pluginRows: PluginRow[] = [
      // deleted: plugin row active, no matching fqc_documents
      validPluginRow({ id: 'row-del', fqc_id: 'doc-del', status: 'active', path: 'CRM/Contacts/deleted.md' }),
      // modified: timestamps differ
      validPluginRow({ id: 'row-mod', fqc_id: 'doc-mod', status: 'active', last_seen_updated_at: '2026-04-20T10:00:00Z' }),
      // unchanged: same timestamps
      validPluginRow({ id: 'row-unch', fqc_id: 'doc-unch', status: 'active', last_seen_updated_at: '2026-04-20T09:00:00Z' }),
      // resurrected: archived plugin row
      validPluginRow({ id: 'row-res', fqc_id: 'doc-res', status: 'archived' }),
    ];
    setupPgClient(pluginRows);

    const result = await reconcilePluginDocuments('crm', 'default');

    const totalBuckets =
      result.added.length +
      result.resurrected.length +
      result.deleted.length +
      result.disassociated.length +
      result.moved.length +
      result.modified.length +
      result.unchanged;

    expect(totalBuckets).toBe(5);

    // Verify no fqcId appears in more than one bucket
    const allFqcIds = [
      ...result.added.map((d) => d.fqcId),
      ...result.resurrected.map((d) => d.fqcId),
      ...result.deleted.map((d) => d.fqcId),
      ...result.disassociated.map((d) => d.fqcId),
      ...result.moved.map((d) => d.fqcId),
      ...result.modified.map((d) => d.fqcId),
    ];
    const uniqueFqcIds = new Set(allFqcIds);
    expect(uniqueFqcIds.size).toBe(allFqcIds.length); // no duplicates in buckets
  });
});

describe('reconcilePluginDocuments — cross-table added', () => {
  it('classifies new documents across two distinct doc types into separate plugin tables', async () => {
    // Plugin entry with TWO doc types
    setupPluginEntry([
      makeDocType({ id: 'contact', folder: 'CRM/Contacts', track_as: 'contacts' }),
      makeDocType({ id: 'deal', folder: 'CRM/Deals', track_as: 'deals' }),
    ]);

    setupFqcDocuments([
      validFqcDoc({ id: 'doc-c', path: 'CRM/Contacts/alice.md', ownership_plugin_id: null, ownership_type: null }),
      validFqcDoc({ id: 'doc-d', path: 'CRM/Deals/q4.md', ownership_plugin_id: null, ownership_type: null }),
    ]);

    // No rows in either plugin table
    setupPgClient([]);

    const result = await reconcilePluginDocuments('crm', 'default');

    expect(result.added.length).toBe(2);

    const contactAdded = result.added.find((a) => a.fqcId === 'doc-c');
    const dealAdded = result.added.find((a) => a.fqcId === 'doc-d');

    expect(contactAdded?.tableName?.includes('contacts')).toBe(true);
    expect(dealAdded?.tableName?.includes('deals')).toBe(true);
  });
});

describe('executeReconciliationActions — smoke test (empty result, no throw)', () => {
  it('does not throw when called with an empty ReconciliationResult', async () => {
    setupPluginEntry();
    setupFqcDocuments([]);
    setupPgClient([]);

    const emptyResult = {
      added: [],
      resurrected: [],
      deleted: [],
      disassociated: [],
      moved: [],
      modified: [],
      unchanged: 0,
    };

    await expect(
      executeReconciliationActions(emptyResult, 'crm', 'default')
    ).resolves.toBeDefined();
  });
});

describe('reconcilePluginDocuments — modified with on_modified: ignore', () => {
  it("modified + on_modified: 'ignore' classifies the document as modified (policy applied at executeReconciliationActions level)", async () => {
    setupPluginEntry([makeDocType({ on_modified: 'ignore' })]);
    setupFqcDocuments([validFqcDoc({ updated_at: '2026-04-20T11:00:00Z' })]);
    setupPgClient([validPluginRow({ last_seen_updated_at: '2026-04-20T10:00:00Z' })]);

    const result = await reconcilePluginDocuments('crm', 'default');

    // Classification happens here — modified because timestamps differ
    expect(result.modified.length).toBe(1);
    expect(result.modified[0].fqcId).toBe('doc-1');
    // The on_modified: 'ignore' policy is applied in executeReconciliationActions, not here
    expect(result.modified[0].updatedAt).toBe('2026-04-20T11:00:00Z');
  });
});

describe('reconcilePluginDocuments — deleted archives reference', () => {
  it('deleted classification carries the pluginRowId and tableName needed to archive the plugin row', async () => {
    setupPluginEntry();
    setupFqcDocuments([]);
    setupPgClient([validPluginRow({ id: 'row-arch', fqc_id: 'doc-arch', status: 'active' })]);

    const result = await reconcilePluginDocuments('crm', 'default');

    expect(result.deleted.length).toBe(1);
    const ref = result.deleted[0];
    expect(ref.fqcId).toBe('doc-arch');
    expect(ref.pluginRowId).toBe('row-arch');
    expect(typeof ref.tableName).toBe('string');
    expect(ref.tableName.length).toBeGreaterThan(0);
  });
});

describe('reconcilePluginDocuments — disassociated carries archive reference', () => {
  it('disassociated classification carries pluginRowId and tableName for archiving', async () => {
    setupPluginEntry();
    // fqc_documents row shows ownership by a different plugin
    setupFqcDocuments([validFqcDoc({ ownership_plugin_id: 'other-plugin' })]);
    setupPgClient([validPluginRow({ id: 'row-dis', fqc_id: 'doc-1' })]);

    const result = await reconcilePluginDocuments('crm', 'default');

    expect(result.disassociated.length).toBe(1);
    const ref = result.disassociated[0];
    expect(ref.fqcId).toBe('doc-1');
    expect(ref.pluginRowId).toBe('row-dis');
    expect(typeof ref.tableName).toBe('string');
    expect(ref.tableName.length).toBeGreaterThan(0);
  });
});

describe('reconcilePluginDocuments — moved keep-tracking carries new path', () => {
  it("moved + on_moved: 'keep-tracking' (default) carries the new path in the MovedRef", async () => {
    setupPluginEntry([makeDocType({ on_moved: 'keep-tracking' })]);
    setupFqcDocuments([validFqcDoc({ path: 'Archive/relocated.md' })]);
    setupPgClient([validPluginRow({ path: 'CRM/Contacts/alice.md', id: 'row-mv' })]);

    const result = await reconcilePluginDocuments('crm', 'default');

    expect(result.moved.length).toBe(1);
    const ref = result.moved[0];
    expect(ref.newPath).toBe('Archive/relocated.md');
    expect(ref.oldPath).toBe('CRM/Contacts/alice.md');
    expect(ref.pluginRowId).toBe('row-mv');
  });
});

describe('reconcilePluginDocuments — missing plugin entry returns empty result', () => {
  it('returns an empty result without throwing when pluginManager.getEntry returns undefined', async () => {
    // Override: getEntry returns undefined (plugin not registered)
    vi.mocked(pluginManager.getEntry).mockReturnValue(undefined as any);
    setupFqcDocuments([]);
    setupPgClient([]);

    const result = await reconcilePluginDocuments('crm', 'default');

    expect(result.added.length).toBe(0);
    expect(result.deleted.length).toBe(0);
    expect(result.unchanged).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RECON-05 / D-13: executeReconciliationActions "added" path
// Verifies the post-write fqc_documents.updated_at re-query and the subsequent
// UPDATE last_seen_updated_at on the plugin row.
// ─────────────────────────────────────────────────────────────────────────────

describe('executeReconciliationActions — RECON-05 added path (post-write updated_at re-query)', () => {
  it('RECON-05: writes frontmatter, INSERTs plugin row with post-write updated_at from fqc_documents re-query', async () => {
    // Arrange — build a ReconciliationResult with one added DocumentInfo
    const addedDoc = {
      fqcId: 'doc-recon05',
      path: 'CRM/Contacts/recon05.md',
      typeId: 'contact',
      tableName: 'fqcp_crm_default_contacts',
    };

    const reconciliationResult = {
      added: [addedDoc],
      resurrected: [],
      deleted: [],
      disassociated: [],
      moved: [],
      modified: [],
      unchanged: 0,
    };

    // pluginManager.getEntry mock — returns entry with 'contact' policy (on_added: 'auto-track', no template)
    vi.mocked(pluginManager.getEntry).mockReturnValue({
      plugin_id: 'crm',
      plugin_instance: 'default',
      table_prefix: 'fqcp_crm_default_',
      schema: {
        plugin: { id: 'crm', name: 'CRM', version: '1.0' },
        tables: [],
        documents: {
          types: [
            {
              id: 'contact',
              folder: 'CRM/Contacts',
              access: 'read-write',
              on_added: 'auto-track',
              on_moved: 'keep-tracking',
              on_modified: 'ignore',
              track_as: 'contacts',
            },
          ],
        },
      },
    } as any);

    // Supabase mock — .single() on fqc_documents returns the post-write updated_at (RECON-05)
    const postWriteUpdatedAt = '2026-04-20T10:01:00Z';
    const singleChain: Record<string, unknown> = {};
    singleChain.select = vi.fn().mockReturnValue(singleChain);
    singleChain.eq = vi.fn().mockReturnValue(singleChain);
    singleChain.single = vi.fn().mockResolvedValue({
      data: { updated_at: postWriteUpdatedAt, content_hash: 'hash-post' },
      error: null,
    });
    singleChain.insert = vi.fn().mockResolvedValue({ data: null, error: null });
    singleChain.update = vi.fn().mockReturnValue(singleChain);
    singleChain.delete = vi.fn().mockReturnValue(singleChain);
    singleChain.or = vi.fn().mockReturnValue(singleChain);
    singleChain.in = vi.fn().mockReturnValue(singleChain);
    singleChain.then = (resolve: (val: { data: unknown[]; error: null }) => void) =>
      resolve({ data: [], error: null });

    vi.mocked(supabaseManager.getClient).mockReturnValue({
      from: vi.fn().mockReturnValue(singleChain),
    } as any);

    // pg mock — tracks all query calls; returns success for INSERT
    const pgQueryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    vi.mocked(createPgClientIPv4).mockReturnValue({
      connect: vi.fn().mockResolvedValue(undefined),
      query: pgQueryMock,
      end: vi.fn().mockResolvedValue(undefined),
    } as any);

    // Act
    await expect(
      executeReconciliationActions(reconciliationResult, 'crm', 'default')
    ).resolves.toBeDefined();

    // Assert 1 — atomicWriteFrontmatter was called once (fqc_owner written)
    expect(vi.mocked(atomicWriteFrontmatter)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(atomicWriteFrontmatter)).toHaveBeenCalledWith(
      expect.stringContaining('recon05.md'),
      expect.objectContaining({ fqc_owner: 'crm', fqc_type: 'contact' }),
    );

    // Assert 2 — pg.query called at least once for the INSERT into the plugin table
    expect(pgQueryMock).toHaveBeenCalled();
    const insertCall = pgQueryMock.mock.calls.find(
      (args: unknown[]) => typeof args[0] === 'string' && /INSERT INTO/i.test(args[0])
    );
    expect(insertCall).toBeDefined();

    // Assert 3 — the INSERT params contain the post-write updated_at from the RECON-05 re-query
    // (index 3 of the base values: fqc_id, status, path, last_seen_updated_at)
    const insertParams = insertCall![1] as unknown[];
    expect(insertParams).toContain(postWriteUpdatedAt);

    // Assert 4 — supabase .single() was invoked (the RECON-05 re-query itself)
    expect(singleChain.single).toHaveBeenCalled();
  });
});
