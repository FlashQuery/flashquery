import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted mocks (available inside vi.mock factories)
// ─────────────────────────────────────────────────────────────────────────────

const { mockPgClient } = vi.hoisted(() => {
  const mockPgClient = {
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn().mockResolvedValue(undefined),
  };
  return { mockPgClient };
});

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted reconciliation mocks
// ─────────────────────────────────────────────────────────────────────────────

const { mockReconcilePluginDocuments, mockExecuteReconciliationActions } = vi.hoisted(() => {
  const emptyResult = {
    pluginId: '',
    instanceId: '',
    classified: { autoTrack: [], archive: [], resurrect: [], updatePath: [], syncFields: [], createPendingReview: [], clearPendingReview: [] },
    stale: false,
    cacheHit: false,
  };
  const emptyActionSummary = {
    autoTracked: 0,
    archived: 0,
    resurrected: 0,
    pathsUpdated: 0,
    fieldsSynced: 0,
    pendingReviewsCreated: 0,
    pendingReviewsCleared: 0,
  };
  const mockReconcilePluginDocuments = vi.fn().mockResolvedValue(emptyResult);
  const mockExecuteReconciliationActions = vi.fn().mockResolvedValue(emptyActionSummary);
  return { mockReconcilePluginDocuments, mockExecuteReconciliationActions, emptyResult, emptyActionSummary };
});

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../src/services/plugin-reconciliation.js', () => ({
  reconcilePluginDocuments: mockReconcilePluginDocuments,
  executeReconciliationActions: mockExecuteReconciliationActions,
}));

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: {
    getClient: vi.fn(),
  },
}));

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/embedding/provider.js', () => ({
  embeddingProvider: {
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  },
}));

vi.mock('../../src/plugins/manager.js', () => ({
  pluginManager: {
    getTableSpec: vi.fn(),
    getEntry: vi.fn(),
    loadEntry: vi.fn(),
    getAllEntries: vi.fn(() => []),
  },
  resolveTableName: vi.fn((pluginId: string, instanceName: string, tableName: string) =>
    `fqcp_${pluginId}_${instanceName}_${tableName}`
  ),
}));

vi.mock('pg', () => ({
  default: {
    Client: vi.fn(function(this: Record<string, unknown>) {
      this.connect = mockPgClient.connect;
      this.query = mockPgClient.query;
      this.end = mockPgClient.end;
    }),
    escapeIdentifier: vi.fn((s: string) => `"${s}"`),
    escapeLiteral: vi.fn((s: string) => `'${s}'`),
  },
}));

// Mock pg-client utility so record tools use mockPgClient regardless of pg module resolution
vi.mock('../../src/utils/pg-client.js', () => ({
  createPgClientIPv4: vi.fn(() => ({
    connect: mockPgClient.connect,
    query: mockPgClient.query,
    end: mockPgClient.end,
  })),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Imports (after mocks)
// ─────────────────────────────────────────────────────────────────────────────

import { registerRecordTools } from '../../src/mcp/tools/records.js';
import { supabaseManager } from '../../src/storage/supabase.js';
import { pluginManager } from '../../src/plugins/manager.js';
import { embeddingProvider } from '../../src/embedding/provider.js';
import pg from 'pg';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { reconcilePluginDocuments, executeReconciliationActions } from '../../src/services/plugin-reconciliation.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function createMockServer(): {
  server: McpServer;
  getHandler: (name: string) => (params: Record<string, unknown>) => Promise<unknown>;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: Record<string, (params: any) => Promise<unknown>> = {};
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers[name] = handler;
    }),
  } as unknown as McpServer;
  return { server, getHandler: (name: string) => handlers[name] };
}

function makeConfig(): FlashQueryConfig {
  return {
    instance: { name: 'test', id: 'test-instance-id', vault: { path: '/tmp/test-vault', markdownExtensions: ['.md'] } },
    supabase: {
      url: 'http://localhost',
      serviceRoleKey: 'key',
      databaseUrl: 'postgresql://localhost:5432/db',
      skipDdl: false,
    },
    embedding: { provider: 'openai', model: 'text-embedding-3-small', dimensions: 1536 },
    logging: { level: 'info', output: 'stdout' },
    locking: { enabled: false, ttlSeconds: 30 },
    defaults: { project: 'Default' },
    vault: { path: '/tmp/vault' },
    projects: { areas: [] },
  } as unknown as FlashQueryConfig;
}

/** Build a mock supabase client that returns the given data/error for the chained call */
function makeSupabaseMock(opts: {
  selectData?: unknown;
  selectError?: unknown;
  insertData?: unknown;
  insertError?: unknown;
  updateError?: unknown;
} = {}) {
  const mockSingle = vi.fn().mockResolvedValue({
    data: opts.insertData ?? opts.selectData ?? null,
    error: opts.insertError ?? opts.selectError ?? null,
  });
  const mockInsertSelect = vi.fn().mockReturnValue({ single: mockSingle });
  const mockInsert = vi.fn().mockReturnValue({ select: mockInsertSelect });

  const mockSelectSingle = vi.fn().mockResolvedValue({
    data: opts.selectData ?? null,
    error: opts.selectError ?? null,
  });
  const mockSelectEq2 = vi.fn().mockReturnValue({ single: mockSelectSingle });
  const mockSelectEq1 = vi.fn().mockReturnValue({ eq: mockSelectEq2 });
  const mockSelectStar = vi.fn().mockReturnValue({ eq: mockSelectEq1 });

  const mockUpdateSingle = vi.fn().mockResolvedValue({
    data: opts.selectData ?? null,
    error: opts.updateError ?? null,
  });
  const mockUpdateSelectSingle = vi.fn().mockReturnValue({ single: mockUpdateSingle });
  const mockUpdateSelect = vi.fn().mockReturnValue({ single: mockUpdateSingle, select: mockUpdateSelectSingle });
  const mockUpdateEq2 = vi.fn().mockReturnValue({ select: mockUpdateSelectSingle, single: mockUpdateSingle });
  const mockUpdateEq1 = vi.fn().mockReturnValue({ eq: mockUpdateEq2 });
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq1 });

  const mockFrom = vi.fn().mockReturnValue({
    insert: mockInsert,
    select: mockSelectStar,
    update: mockUpdate,
  });

  vi.mocked(supabaseManager.getClient).mockReturnValue({
    from: mockFrom,
  } as unknown as ReturnType<typeof supabaseManager.getClient>);

  return { mockFrom, mockInsert, mockUpdate, mockSingle };
}

/** Default table spec for a table with embed_fields */
const TABLE_SPEC_WITH_EMBED = {
  tableSpec: {
    name: 'contacts',
    description: 'Contacts table',
    embed_fields: ['full_name', 'notes'],
    columns: [
      { name: 'full_name', type: 'text' as const, required: true },
      { name: 'notes', type: 'text' as const },
    ],
  },
  entry: {
    plugin_id: 'crm',
    plugin_instance: 'default',
    table_prefix: 'fqcp_crm_default_',
    schema: {
      plugin: { id: 'crm', name: 'CRM Plugin', version: 1 },
      tables: [],
    },
  },
};

/** Default table spec for a table WITHOUT embed_fields */
const TABLE_SPEC_NO_EMBED = {
  tableSpec: {
    name: 'tasks',
    description: 'Tasks table',
    columns: [
      { name: 'title', type: 'text' as const, required: true },
      { name: 'status', type: 'text' as const },
    ],
  },
  entry: {
    plugin_id: 'crm',
    plugin_instance: 'default',
    table_prefix: 'fqcp_crm_default_',
    schema: {
      plugin: { id: 'crm', name: 'CRM Plugin', version: 1 },
      tables: [],
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests: registerRecordTools registers 5 tools total
// ─────────────────────────────────────────────────────────────────────────────

describe('registerRecordTools', () => {
  it('registers exactly 5 tools', () => {
    const config = makeConfig();
    const { server } = createMockServer();
    registerRecordTools(server, config);

    const registerTool = vi.mocked(server.registerTool);
    expect(registerTool).toHaveBeenCalledTimes(5);

    const names = registerTool.mock.calls.map(call => call[0]);
    expect(names).toContain('create_record');
    expect(names).toContain('get_record');
    expect(names).toContain('update_record');
    expect(names).toContain('archive_record');
    expect(names).toContain('search_records');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: create_record
// ─────────────────────────────────────────────────────────────────────────────

describe('create_record', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPgClient.connect.mockResolvedValue(undefined);
    mockPgClient.query.mockResolvedValue({ rows: [] });
    mockPgClient.end.mockResolvedValue(undefined);
  });

  it('inserts a record and returns the new record ID', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);
    makeSupabaseMock({ insertData: { id: 'new-record-uuid' } });

    const handler = getHandler('create_record');
    const result = await handler({
      plugin_id: 'crm',
      table: 'tasks',
      fields: { title: 'Test Task' },
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('new-record-uuid');
  });

  it('adds instance_id from config to the inserted row', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);
    const { mockInsert } = makeSupabaseMock({ insertData: { id: 'rec-id' } });

    const handler = getHandler('create_record');
    await handler({
      plugin_id: 'crm',
      table: 'tasks',
      fields: { title: 'Test Task' },
    });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ instance_id: 'test-instance-id' })
    );
  });

  it('fires-and-forgets embedding when table has embed_fields', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_WITH_EMBED);
    makeSupabaseMock({ insertData: { id: 'embed-record-id' } });

    const handler = getHandler('create_record');
    await handler({
      plugin_id: 'crm',
      table: 'contacts',
      fields: { full_name: 'Alice Smith', notes: 'Key contact' },
    });

    // embeddingProvider.embed should have been called (fire-and-forget)
    await vi.runAllTimersAsync().catch(() => undefined);
    expect(embeddingProvider.embed).toHaveBeenCalled();
  });

  it('does NOT fire embedding when table has no embed_fields', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);
    makeSupabaseMock({ insertData: { id: 'no-embed-rec' } });

    const handler = getHandler('create_record');
    await handler({
      plugin_id: 'crm',
      table: 'tasks',
      fields: { title: 'No embed task' },
    });

    expect(embeddingProvider.embed).not.toHaveBeenCalled();
  });

  it('returns isError for unknown plugin_id', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(undefined);

    const handler = getHandler('create_record');
    const result = await handler({
      plugin_id: 'nonexistent',
      table: 'contacts',
      fields: {},
    }) as { isError?: boolean };

    expect(result.isError).toBe(true);
  });

  it('returns isError for unknown table name', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(undefined);

    const handler = getHandler('create_record');
    const result = await handler({
      plugin_id: 'crm',
      table: 'nonexistent_table',
      fields: {},
    }) as { isError?: boolean };

    expect(result.isError).toBe(true);
  });

  it('defaults plugin_instance to "default" when not provided', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);
    makeSupabaseMock({ insertData: { id: 'rec-id' } });

    const handler = getHandler('create_record');
    await handler({ plugin_id: 'crm', table: 'tasks', fields: {} });

    expect(pluginManager.getTableSpec).toHaveBeenCalledWith('crm', 'default', 'tasks');
  });

  it('validates fqcp_ prefix guard on table name', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    // Return a table spec but override resolveTableName to return a non-fqcp_ name
    const { resolveTableName } = await import('../../src/plugins/manager.js');
    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);
    vi.mocked(resolveTableName).mockReturnValueOnce('evil_table_name');

    const handler = getHandler('create_record');
    const result = await handler({
      plugin_id: 'crm',
      table: 'tasks',
      fields: {},
    }) as { isError?: boolean };

    expect(result.isError).toBe(true);
  });

  it('returns isError when supabase insert fails', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);
    makeSupabaseMock({ insertError: { message: 'DB insert failed' } });

    const handler = getHandler('create_record');
    const result = await handler({
      plugin_id: 'crm',
      table: 'tasks',
      fields: { title: 'fail' },
    }) as { isError?: boolean };

    expect(result.isError).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: get_record
// ─────────────────────────────────────────────────────────────────────────────

describe('get_record', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns record data for a valid id', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);
    makeSupabaseMock({ selectData: { id: 'rec-123', title: 'My Task', instance_id: 'test-instance-id' } });

    const handler = getHandler('get_record');
    const result = await handler({
      plugin_id: 'crm',
      table: 'tasks',
      id: 'rec-123',
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('rec-123');
  });

  it('returns isError for unknown id', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);
    makeSupabaseMock({ selectError: { message: 'No rows found' } });

    const handler = getHandler('get_record');
    const result = await handler({
      plugin_id: 'crm',
      table: 'tasks',
      id: 'unknown-id',
    }) as { isError?: boolean };

    expect(result.isError).toBe(true);
  });

  it('filters by instance_id for tenant isolation', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);

    // We'll check that getClient().from().select().eq(id).eq(instance_id) is called
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: 'rec-123' }, error: null });
    const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle });
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect, insert: vi.fn(), update: vi.fn() });
    vi.mocked(supabaseManager.getClient).mockReturnValue({ from: mockFrom } as unknown as ReturnType<typeof supabaseManager.getClient>);

    const handler = getHandler('get_record');
    await handler({ plugin_id: 'crm', table: 'tasks', id: 'rec-123' });

    // Second .eq should be called with instance_id
    expect(mockEq2).toHaveBeenCalledWith('instance_id', 'test-instance-id');
  });

  it('defaults plugin_instance to "default" when not provided', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);
    makeSupabaseMock({ selectData: { id: 'rec-1' } });

    const handler = getHandler('get_record');
    await handler({ plugin_id: 'crm', table: 'tasks', id: 'rec-1' });

    expect(pluginManager.getTableSpec).toHaveBeenCalledWith('crm', 'default', 'tasks');
  });

  it('returns isError for unknown plugin_id', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(undefined);

    const handler = getHandler('get_record');
    const result = await handler({ plugin_id: 'bad', table: 'tasks', id: 'rec-1' }) as { isError?: boolean };

    expect(result.isError).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: update_record
// ─────────────────────────────────────────────────────────────────────────────

describe('update_record', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates fields and returns success', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);
    makeSupabaseMock({ selectData: { id: 'rec-123', title: 'Updated Task' } });

    const handler = getHandler('update_record');
    const result = await handler({
      plugin_id: 'crm',
      table: 'tasks',
      id: 'rec-123',
      fields: { title: 'Updated Task' },
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('rec-123');
  });

  it('sets updated_at on update', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);
    const { mockUpdate } = makeSupabaseMock({ selectData: { id: 'rec-123' } });

    const handler = getHandler('update_record');
    await handler({
      plugin_id: 'crm',
      table: 'tasks',
      id: 'rec-123',
      fields: { title: 'New Title' },
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ updated_at: expect.any(String) })
    );
  });

  it('fires-and-forgets re-embedding when table has embed_fields', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_WITH_EMBED);
    makeSupabaseMock({ selectData: { id: 'rec-123', full_name: 'Alice', notes: 'Updated' } });

    const handler = getHandler('update_record');
    await handler({
      plugin_id: 'crm',
      table: 'contacts',
      id: 'rec-123',
      fields: { notes: 'Updated' },
    });

    await vi.runAllTimersAsync().catch(() => undefined);
    expect(embeddingProvider.embed).toHaveBeenCalled();
  });

  it('returns isError for unknown id', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);
    makeSupabaseMock({ updateError: { message: 'Record not found' } });

    const handler = getHandler('update_record');
    const result = await handler({
      plugin_id: 'crm',
      table: 'tasks',
      id: 'bad-id',
      fields: { title: 'X' },
    }) as { isError?: boolean };

    expect(result.isError).toBe(true);
  });

  it('defaults plugin_instance to "default" when not provided', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);
    makeSupabaseMock({ selectData: { id: 'rec-1' } });

    const handler = getHandler('update_record');
    await handler({ plugin_id: 'crm', table: 'tasks', id: 'rec-1', fields: {} });

    expect(pluginManager.getTableSpec).toHaveBeenCalledWith('crm', 'default', 'tasks');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: archive_record
// ─────────────────────────────────────────────────────────────────────────────

describe('archive_record', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets status to archived and updated_at', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);
    const { mockUpdate } = makeSupabaseMock({});

    const handler = getHandler('archive_record');
    const result = await handler({
      plugin_id: 'crm',
      table: 'tasks',
      id: 'rec-123',
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'archived', updated_at: expect.any(String) })
    );
  });

  it('returns isError for unknown id (supabase error)', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);

    // Make the update chain return an error
    const mockUpdateResult = vi.fn().mockResolvedValue({ error: { message: 'Record not found' } });
    const mockEq2 = vi.fn().mockReturnValue({ then: vi.fn(), ...mockUpdateResult() });
    // Actually we need to set up a simpler chain for archive (no .select().single() — just .eq().eq())
    const mockEq1 = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: { message: 'Not found' } }) });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 });
    const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate, insert: vi.fn(), select: vi.fn() });
    vi.mocked(supabaseManager.getClient).mockReturnValue({ from: mockFrom } as unknown as ReturnType<typeof supabaseManager.getClient>);

    const handler = getHandler('archive_record');
    const result = await handler({
      plugin_id: 'crm',
      table: 'tasks',
      id: 'bad-id',
    }) as { isError?: boolean };

    expect(result.isError).toBe(true);
  });

  it('defaults plugin_instance to "default" when not provided', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);
    makeSupabaseMock({});

    const handler = getHandler('archive_record');
    await handler({ plugin_id: 'crm', table: 'tasks', id: 'rec-1' });

    expect(pluginManager.getTableSpec).toHaveBeenCalledWith('crm', 'default', 'tasks');
  });

  it('returns success message with table name', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);
    makeSupabaseMock({});

    const handler = getHandler('archive_record');
    const result = await handler({ plugin_id: 'crm', table: 'tasks', id: 'rec-archive' }) as {
      content: Array<{ text: string }>;
    };

    expect(result.content[0].text).toContain('Archived');
    expect(result.content[0].text).toContain('rec-archive');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: search_records
// ─────────────────────────────────────────────────────────────────────────────

describe('search_records', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPgClient.connect.mockResolvedValue(undefined);
    mockPgClient.query.mockResolvedValue({ rows: [{ id: 'r1', title: 'Found' }] });
    mockPgClient.end.mockResolvedValue(undefined);
  });

  it('uses supabase-js for filters-only (no query)', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);

    const mockLimit = vi.fn().mockResolvedValue({ data: [{ id: 'r1' }], error: null });
    const mockEqFilter = vi.fn().mockReturnValue({ limit: mockLimit, eq: vi.fn().mockReturnValue({ limit: mockLimit }) });
    const mockEqInstance = vi.fn().mockReturnValue({ eq: mockEqFilter });
    const mockEqStatus = vi.fn().mockReturnValue({ eq: mockEqInstance });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEqStatus });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect, insert: vi.fn(), update: vi.fn() });
    vi.mocked(supabaseManager.getClient).mockReturnValue({ from: mockFrom } as unknown as ReturnType<typeof supabaseManager.getClient>);

    const handler = getHandler('search_records');
    const result = await handler({
      plugin_id: 'crm',
      table: 'tasks',
      filters: { status: 'active' },
    }) as { isError?: boolean };

    expect(result.isError).toBeUndefined();
    // pg.Client should NOT be created for filters-only
    expect(pg.Client).not.toHaveBeenCalled();
  });

  it('uses pg.Client + embeddingProvider for semantic path (query + embed_fields)', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_WITH_EMBED);
    vi.mocked(embeddingProvider.embed).mockResolvedValue([0.1, 0.2, 0.3]);

    const handler = getHandler('search_records');
    const result = await handler({
      plugin_id: 'crm',
      table: 'contacts',
      query: 'Alice Smith',
    }) as { isError?: boolean };

    expect(result.isError).toBeUndefined();
    expect(embeddingProvider.embed).toHaveBeenCalledWith('Alice Smith');
    expect(mockPgClient.connect).toHaveBeenCalled();
    expect(mockPgClient.end).toHaveBeenCalled();
  });

  it('SQL in semantic path contains <=> operator', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_WITH_EMBED);
    vi.mocked(embeddingProvider.embed).mockResolvedValue([0.1, 0.2]);

    const handler = getHandler('search_records');
    await handler({ plugin_id: 'crm', table: 'contacts', query: 'test query' });

    // The SQL query passed to pgClient.query should contain <=>
    const queryCalls = mockPgClient.query.mock.calls;
    const sqlCalls = queryCalls.filter(call => typeof call[0] === 'string');
    const hasCosineOp = sqlCalls.some(call => (call[0] as string).includes('<=>'));
    expect(hasCosineOp).toBe(true);
  });

  it('uses pg.Client + ILIKE for non-embed tables with query', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);

    const handler = getHandler('search_records');
    const result = await handler({
      plugin_id: 'crm',
      table: 'tasks',
      query: 'find me',
    }) as { isError?: boolean };

    expect(result.isError).toBeUndefined();
    expect(mockPgClient.connect).toHaveBeenCalled();
    // ILIKE should be in the SQL
    const queryCalls = mockPgClient.query.mock.calls;
    const hasilike = queryCalls.some(call =>
      typeof call[0] === 'string' && (call[0] as string).toUpperCase().includes('ILIKE')
    );
    expect(hasilike).toBe(true);
    // embeddingProvider.embed should NOT be called for ILIKE path
    expect(embeddingProvider.embed).not.toHaveBeenCalled();
  });

  it('pg.Client.end() is called in finally block (semantic path)', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_WITH_EMBED);
    vi.mocked(embeddingProvider.embed).mockResolvedValue([0.1]);
    mockPgClient.query.mockRejectedValueOnce(new Error('pg query error'));

    const handler = getHandler('search_records');
    await handler({ plugin_id: 'crm', table: 'contacts', query: 'test' });

    // end() must be called even on pg.query failure
    expect(mockPgClient.end).toHaveBeenCalled();
  });

  it('pg.Client.end() is called in finally block (ILIKE path)', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);
    mockPgClient.query.mockRejectedValueOnce(new Error('pg query error'));

    const handler = getHandler('search_records');
    await handler({ plugin_id: 'crm', table: 'tasks', query: 'test' });

    expect(mockPgClient.end).toHaveBeenCalled();
  });

  it('defaults limit to 10', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);

    const mockLimit = vi.fn().mockResolvedValue({ data: [], error: null });
    const mockEqChain = vi.fn().mockReturnValue({ limit: mockLimit, eq: vi.fn().mockReturnValue({ limit: mockLimit }) });
    const mockSelectChain = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: mockEqChain }) });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelectChain, insert: vi.fn(), update: vi.fn() });
    vi.mocked(supabaseManager.getClient).mockReturnValue({ from: mockFrom } as unknown as ReturnType<typeof supabaseManager.getClient>);

    const handler = getHandler('search_records');
    await handler({ plugin_id: 'crm', table: 'tasks' });

    // limit(10) should have been called
    expect(mockLimit).toHaveBeenCalledWith(10);
  });

  it('defaults plugin_instance to "default" when not provided', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);
    makeSupabaseMock({});

    const mockLimit = vi.fn().mockResolvedValue({ data: [], error: null });
    const mockEqChain = vi.fn().mockReturnValue({ limit: mockLimit, eq: vi.fn().mockReturnValue({ limit: mockLimit }) });
    const mockSelectChain = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: mockEqChain }) });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelectChain, insert: vi.fn(), update: vi.fn() });
    vi.mocked(supabaseManager.getClient).mockReturnValue({ from: mockFrom } as unknown as ReturnType<typeof supabaseManager.getClient>);

    const handler = getHandler('search_records');
    await handler({ plugin_id: 'crm', table: 'tasks' });

    expect(pluginManager.getTableSpec).toHaveBeenCalledWith('crm', 'default', 'tasks');
  });

  it('returns isError for unknown plugin', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(undefined);

    const handler = getHandler('search_records');
    const result = await handler({
      plugin_id: 'nonexistent',
      table: 'contacts',
      query: 'test',
    }) as { isError?: boolean };

    expect(result.isError).toBe(true);
  });

  it('combines filters + query in semantic path', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_WITH_EMBED);
    vi.mocked(embeddingProvider.embed).mockResolvedValue([0.1, 0.2]);

    const handler = getHandler('search_records');
    const result = await handler({
      plugin_id: 'crm',
      table: 'contacts',
      query: 'Alice',
      filters: { status: 'active' },
    }) as { isError?: boolean };

    expect(result.isError).toBeUndefined();
    // Both embed and pg connection should be used
    expect(embeddingProvider.embed).toHaveBeenCalled();
    expect(mockPgClient.connect).toHaveBeenCalled();
    // The SQL should include filter for status
    const queryCalls = mockPgClient.query.mock.calls;
    const sqlCall = queryCalls.find(call => typeof call[0] === 'string') as [string, unknown[]] | undefined;
    expect(sqlCall).toBeDefined();
    // The params array should include the filter value
    expect(sqlCall![1]).toContain('active');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: D-07 reconciliation preamble (RECTOOLS-01, RECTOOLS-04)
// ─────────────────────────────────────────────────────────────────────────────

describe('record tools — reconciliation preamble (D-07)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPgClient.connect.mockResolvedValue(undefined);
    mockPgClient.query.mockResolvedValue({ rows: [] });
    mockPgClient.end.mockResolvedValue(undefined);
  });

  it('create_record calls reconcilePluginDocuments before core op', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);
    makeSupabaseMock({ insertData: { id: 'new-id' } });

    const handler = getHandler('create_record');
    await handler({ plugin_id: 'crm', table: 'tasks', fields: {} });

    expect(reconcilePluginDocuments).toHaveBeenCalledWith('crm', 'default', expect.any(String));
    expect(executeReconciliationActions).toHaveBeenCalled();
  });

  it('create_record response contains reconciliation summary when autoTracked > 0', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);
    mockExecuteReconciliationActions.mockResolvedValueOnce({
      autoTracked: 1,
      archived: 0,
      resurrected: 0,
      pathsUpdated: 0,
      fieldsSynced: 0,
      pendingReviewsCreated: 0,
      pendingReviewsCleared: 0,
    });
    makeSupabaseMock({ insertData: { id: 'new-id' } });

    const handler = getHandler('create_record');
    const result = await handler({ plugin_id: 'crm', table: 'tasks', fields: {} }) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Auto-tracked 1 new document(s)');
  });

  it('reconciliation failure is non-fatal — tool returns success with warning text', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);
    mockReconcilePluginDocuments.mockRejectedValueOnce(new Error('DB connection lost'));
    makeSupabaseMock({ insertData: { id: 'new-id' } });

    const handler = getHandler('create_record');
    const result = await handler({ plugin_id: 'crm', table: 'tasks', fields: {} }) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };

    // Tool must still succeed (no isError)
    expect(result.isError).toBeUndefined();
    // Warning text must appear in response
    expect(result.content[0].text).toContain('Reconciliation warning');
    expect(result.content[0].text).toContain('DB connection lost');
  });

  it('pending items note is appended when fqc_pending_plugin_review has rows', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);

    // Set up supabase to return pending rows for fqc_pending_plugin_review
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: [
            { fqc_id: 'pr-1', table_name: 'contacts', review_type: 'type_changed', context: {} },
          ],
          error: null,
        }),
      }),
    });
    const mockInsertSelectSingle = vi.fn().mockResolvedValue({ data: { id: 'new-id' }, error: null });
    const mockInsertSelect = vi.fn().mockReturnValue({ single: mockInsertSelectSingle });
    const mockInsert = vi.fn().mockReturnValue({ select: mockInsertSelect });
    const mockUpdateEq2Single = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockUpdateEq2 = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockUpdateEq2Single }), single: mockUpdateEq2Single });
    const mockUpdateEq1 = vi.fn().mockReturnValue({ eq: mockUpdateEq2 });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq1 });
    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === 'fqc_pending_plugin_review') {
        return { select: mockSelect };
      }
      return { insert: mockInsert, select: mockSelect, update: mockUpdate };
    });
    vi.mocked(supabaseManager.getClient).mockReturnValue({ from: mockFrom } as unknown as ReturnType<typeof supabaseManager.getClient>);

    const handler = getHandler('create_record');
    const result = await handler({ plugin_id: 'crm', table: 'tasks', fields: {} }) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };

    expect(result.content[0].text).toContain('pending review item');
    expect(result.content[0].text).toContain('clear_pending_reviews');
  });

  it('all five record tools call reconcilePluginDocuments', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);
    makeSupabaseMock({ insertData: { id: 'new-id' }, selectData: { id: 'r1', title: 'T' } });

    // create_record
    await getHandler('create_record')({ plugin_id: 'crm', table: 'tasks', fields: {} });
    // get_record
    await getHandler('get_record')({ plugin_id: 'crm', table: 'tasks', id: 'r1' });
    // update_record
    await getHandler('update_record')({ plugin_id: 'crm', table: 'tasks', id: 'r1', fields: {} });
    // archive_record
    await getHandler('archive_record')({ plugin_id: 'crm', table: 'tasks', id: 'r1' });
    // search_records (filters-only path)
    const mockLimit = vi.fn().mockResolvedValue({ data: [], error: null });
    const mockEqChain = vi.fn().mockReturnValue({ limit: mockLimit, eq: vi.fn().mockReturnValue({ limit: mockLimit }) });
    const mockSelectChain = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: mockEqChain }) });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelectChain, insert: vi.fn(), update: vi.fn() });
    vi.mocked(supabaseManager.getClient).mockReturnValue({ from: mockFrom } as unknown as ReturnType<typeof supabaseManager.getClient>);
    await getHandler('search_records')({ plugin_id: 'crm', table: 'tasks' });

    // reconcilePluginDocuments should have been called 5 times (once per tool)
    expect(reconcilePluginDocuments).toHaveBeenCalledTimes(5);
  });
});
