import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerRecordTools } from '../../src/mcp/tools/records.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: { getClient: vi.fn(() => ({})) },
}));

vi.mock('../../src/plugins/manager.js', () => ({
  pluginManager: {
    getTableSpec: vi.fn(),
  },
  resolveTableName: vi.fn(() => 'fqcp_crm_unit_contacts'),
}));

vi.mock('../../src/services/plugin-reconciliation.js', () => ({
  reconcilePluginDocuments: vi.fn().mockResolvedValue({ actions: [] }),
  executeReconciliationActions: vi.fn().mockResolvedValue({
    autoTracked: 0,
    archived: 0,
    resurrected: 0,
    pathsUpdated: 0,
    fieldsSynced: 0,
    pendingReviewsCreated: 0,
    pendingReviewsCleared: 0,
  }),
}));

vi.mock('../../src/services/plugin-coordination-lock.js', () => ({
  withPluginCoordinationLock: vi.fn(async (_config, _input, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../../src/server/shutdown-state.js', () => ({
  getIsShuttingDown: vi.fn(() => false),
}));

vi.mock('../../src/embedding/provider.js', () => ({
  embeddingProvider: {
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  },
}));

vi.mock('../../src/utils/pg-client.js', () => ({
  queryPgPool: vi.fn(),
}));

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { supabaseManager } from '../../src/storage/supabase.js';
import { pluginManager } from '../../src/plugins/manager.js';
import { queryPgPool } from '../../src/utils/pg-client.js';
import { logger } from '../../src/logging/logger.js';
import { withPluginCoordinationLock } from '../../src/services/plugin-coordination-lock.js';

function makeConfig(): FlashQueryConfig {
  return {
    instance: { id: 'unit', name: 'Unit', vault: { path: '/tmp/fq-unit', markdownExtensions: ['.md'] } },
    supabase: { url: 'https://example.invalid', serviceRoleKey: 'key', databaseUrl: 'postgresql://localhost/db' },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'info', output: 'stderr' },
    locking: { enabled: false },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
  } as FlashQueryConfig;
}

type Handler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}>;

function makeServer(): {
  server: McpServer;
  getHandler: (name: string) => Handler;
} {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, handler: Handler) => {
      handlers.set(name, handler);
    }),
  } as unknown as McpServer;
  return {
    server,
    getHandler: (name: string) => {
      const handler = handlers.get(name);
      if (!handler) throw new Error(`missing handler: ${name}`);
      return handler;
    },
  };
}

function setTableSpec(embedFields: string[] = []): void {
  vi.mocked(pluginManager.getTableSpec).mockReturnValue({
    tableSpec: {
      name: 'contacts',
      columns: [{ name: 'name', type: 'text' }],
      embed_fields: embedFields,
    },
    entry: {
      plugin_id: 'crm',
      plugin_instance: 'unit',
      table_prefix: 'fqcp_crm_unit_',
      schema: {
        plugin: { id: 'crm', name: 'CRM', version: '1.0.0' },
        tables: [],
      },
    },
  });
}

function makeSupabaseLimitResult(result: { data: unknown[] | null; error: { message: string } | null }): void {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  };
  vi.mocked(supabaseManager.getClient).mockReturnValue({
    from: vi.fn(() => query),
  } as unknown as ReturnType<typeof supabaseManager.getClient>);
}

function makeSupabaseLimitRejection(error: Error): void {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockRejectedValue(error),
  };
  vi.mocked(supabaseManager.getClient).mockReturnValue({
    from: vi.fn(() => query),
  } as unknown as ReturnType<typeof supabaseManager.getClient>);
}

function timingMessages(): string[] {
  return [
    ...vi.mocked(logger.info).mock.calls.map(([message]) => message),
    ...vi.mocked(logger.warn).mock.calls.map(([message]) => message),
  ].filter((message) => message.includes('search_records timing:'));
}

function expectPluginCoordinationLock(pluginId = 'crm', pluginInstance = 'unit'): void {
  expect(withPluginCoordinationLock).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ pluginId, pluginInstance }),
    expect.any(Function)
  );
}

describe('record tools final surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTableSpec();
    vi.mocked(queryPgPool).mockResolvedValue({ rows: [] } as Awaited<ReturnType<typeof queryPgPool>>);
  });

  it('registers current record tools and omits removed legacy handlers', () => {
    const names: string[] = [];
    const server = {
      registerTool: vi.fn((name: string) => names.push(name)),
    } as unknown as McpServer;

    registerRecordTools(server, makeConfig());

    expect(names).toEqual(expect.arrayContaining([
      'write_record',
      'get_record',
      'archive_record',
      'search_records',
    ]));
    expect(names).not.toContain('create_record');
    expect(names).not.toContain('update_record');
  });

  it('REQ-023: write_record runs reconciliation under the per-plugin coordination lock', async () => {
    const insertSingle = vi.fn().mockResolvedValue({
      data: { id: 'row-1', instance_id: 'unit', name: 'Ada' },
      error: null,
    });
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
    const insert = vi.fn().mockReturnValue({ select: insertSelect });
    const pendingEq2 = vi.fn().mockResolvedValue({ data: [] });
    const pendingEq1 = vi.fn().mockReturnValue({ eq: pendingEq2 });
    const pendingSelect = vi.fn().mockReturnValue({ eq: pendingEq1 });
    vi.mocked(supabaseManager.getClient).mockReturnValue({
      from: vi.fn((table: string) => table === 'fqc_pending_plugin_review'
        ? { select: pendingSelect }
        : { insert }),
    } as unknown as ReturnType<typeof supabaseManager.getClient>);
    const { server, getHandler } = makeServer();
    registerRecordTools(server, makeConfig());

    const result = await getHandler('write_record')({
      mode: 'create',
      plugin_id: 'crm',
      plugin_instance: 'unit',
      table: 'contacts',
      data: { name: 'Ada' },
    });

    expect(result.isError).toBeUndefined();
    expectPluginCoordinationLock();
  });

  it('REQ-023: get_record runs reconciliation under the per-plugin coordination lock', async () => {
    const getSingle = vi.fn().mockResolvedValue({
      data: { id: 'row-1', instance_id: 'unit', name: 'Ada' },
      error: null,
    });
    const getEq2 = vi.fn().mockReturnValue({ single: getSingle });
    const getEq1 = vi.fn().mockReturnValue({ eq: getEq2 });
    const getSelect = vi.fn().mockReturnValue({ eq: getEq1 });
    const pendingEq2 = vi.fn().mockResolvedValue({ data: [] });
    const pendingEq1 = vi.fn().mockReturnValue({ eq: pendingEq2 });
    const pendingSelect = vi.fn().mockReturnValue({ eq: pendingEq1 });
    vi.mocked(supabaseManager.getClient).mockReturnValue({
      from: vi.fn((table: string) => table === 'fqc_pending_plugin_review'
        ? { select: pendingSelect }
        : { select: getSelect }),
    } as unknown as ReturnType<typeof supabaseManager.getClient>);
    const { server, getHandler } = makeServer();
    registerRecordTools(server, makeConfig());

    const result = await getHandler('get_record')({
      plugin_id: 'crm',
      plugin_instance: 'unit',
      table: 'contacts',
      id: 'row-1',
    });

    expect(result.isError).toBeUndefined();
    expectPluginCoordinationLock();
  });

  it('REQ-023: archive_record runs reconciliation under the per-plugin coordination lock', async () => {
    const updateSingle = vi.fn().mockResolvedValue({
      data: { id: 'row-1', instance_id: 'unit', name: 'Ada', status: 'archived' },
      error: null,
    });
    const updateSelect = vi.fn().mockReturnValue({ single: updateSingle });
    const updateEq2 = vi.fn().mockReturnValue({ select: updateSelect });
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 });
    const update = vi.fn().mockReturnValue({ eq: updateEq1 });
    vi.mocked(supabaseManager.getClient).mockReturnValue({
      from: vi.fn(() => ({ update })),
    } as unknown as ReturnType<typeof supabaseManager.getClient>);
    const { server, getHandler } = makeServer();
    registerRecordTools(server, makeConfig());

    const result = await getHandler('archive_record')({
      targets: [{ plugin_id: 'crm', plugin_instance: 'unit', table: 'contacts', id: 'row-1' }],
    });

    expect(result.isError).toBeUndefined();
    expectPluginCoordinationLock();
  });

  it('REQ-023: search_records runs reconciliation under the per-plugin coordination lock', async () => {
    makeSupabaseLimitResult({
      data: [{ id: 'row-1', name: 'Ada' }],
      error: null,
    });
    const { server, getHandler } = makeServer();
    registerRecordTools(server, makeConfig());

    const result = await getHandler('search_records')({
      plugin_id: 'crm',
      plugin_instance: 'unit',
      table: 'contacts',
      filters: { name: 'Ada' },
    });

    expect(result.isError).toBeUndefined();
    expectPluginCoordinationLock();
  });

  it('T-U-023: filters-only search_records logs safe timing metadata on success', async () => {
    makeSupabaseLimitResult({
      data: [{ id: 'row-1', name: 'Ada', secret: 'raw payload should stay out of logs' }],
      error: null,
    });
    const { server, getHandler } = makeServer();
    registerRecordTools(server, makeConfig());

    const result = await getHandler('search_records')({
      plugin_id: 'crm',
      table: 'contacts',
      filters: { name: 'Ada' },
    });

    expect(result.isError).toBeUndefined();
    const [message] = timingMessages();
    expect(message).toContain('path=filters-only');
    expect(message).toContain('table=fqcp_crm_unit_contacts');
    expect(message).toContain('rows=1');
    expect(message).toMatch(/elapsed_ms=\d+(\.\d+)?/);
    expect(message).not.toContain('Ada');
    expect(message).not.toContain('raw payload');
  });

  it('T-U-023: filters-only search_records logs safe timing metadata on failure', async () => {
    makeSupabaseLimitResult({
      data: null,
      error: { message: 'db unavailable' },
    });
    const { server, getHandler } = makeServer();
    registerRecordTools(server, makeConfig());

    const result = await getHandler('search_records')({
      plugin_id: 'crm',
      table: 'contacts',
      filters: { name: 'Ada' },
    });

    expect(result.isError).toBe(true);
    const [message] = timingMessages();
    expect(message).toContain('path=filters-only');
    expect(message).toContain('table=fqcp_crm_unit_contacts');
    expect(message).toContain('rows=0');
    expect(message).not.toContain('error=');
    expect(message).not.toContain('db unavailable');
    expect(message).toMatch(/elapsed_ms=\d+(\.\d+)?/);
    expect(message).not.toContain('Ada');
  });

  it('T-U-023: filters-only search_records logs safe timing metadata on thrown rejection', async () => {
    makeSupabaseLimitRejection(new Error('network unavailable'));
    const { server, getHandler } = makeServer();
    registerRecordTools(server, makeConfig());

    const result = await getHandler('search_records')({
      plugin_id: 'crm',
      table: 'contacts',
      filters: { name: 'Ada' },
    });

    expect(result.isError).toBe(true);
    const [message] = timingMessages();
    expect(message).toContain('path=filters-only');
    expect(message).toContain('table=fqcp_crm_unit_contacts');
    expect(message).not.toContain('error=');
    expect(message).not.toContain('network unavailable');
    expect(message).toMatch(/elapsed_ms=\d+(\.\d+)?/);
    expect(message).not.toContain('Ada');
  });

  it('T-U-024: semantic search_records logs safe timing metadata on success', async () => {
    setTableSpec(['name']);
    vi.mocked(queryPgPool).mockResolvedValue({
      rows: [{ id: 'row-1', name: 'Ada', embedding: [0.99, 0.01] }],
    } as Awaited<ReturnType<typeof queryPgPool>>);
    const { server, getHandler } = makeServer();
    registerRecordTools(server, makeConfig());

    const result = await getHandler('search_records')({
      plugin_id: 'crm',
      table: 'contacts',
      query: 'find Ada',
    });

    expect(result.isError).toBeUndefined();
    const [message] = timingMessages();
    expect(message).toContain('path=semantic');
    expect(message).toContain('table=fqcp_crm_unit_contacts');
    expect(message).toContain('rows=1');
    expect(message).toMatch(/elapsed_ms=\d+(\.\d+)?/);
    expect(message).not.toContain('find Ada');
    expect(message).not.toContain('0.99,0.01');
    expect(message).not.toContain('embedding');
  });

  it('T-U-024: semantic search_records logs safe timing metadata on failure', async () => {
    setTableSpec(['name']);
    vi.mocked(queryPgPool).mockRejectedValue(new Error('pg unavailable'));
    const { server, getHandler } = makeServer();
    registerRecordTools(server, makeConfig());

    const result = await getHandler('search_records')({
      plugin_id: 'crm',
      table: 'contacts',
      query: 'find Ada',
    });

    expect(result.isError).toBe(true);
    const [message] = timingMessages();
    expect(message).toContain('path=semantic');
    expect(message).toContain('table=fqcp_crm_unit_contacts');
    expect(message).not.toContain('error=');
    expect(message).not.toContain('pg unavailable');
    expect(message).toMatch(/elapsed_ms=\d+(\.\d+)?/);
    expect(message).not.toContain('find Ada');
    expect(message).not.toContain('0.1,0.2,0.3');
  });
});
