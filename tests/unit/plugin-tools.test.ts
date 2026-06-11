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
// Module mocks
// ─────────────────────────────────────────────────────────────────────────────

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

vi.mock('../../src/plugins/manager.js', () => ({
  pluginManager: {
    getEntry: vi.fn(),
    loadEntry: vi.fn(),
    removeEntry: vi.fn(),
    getAllEntries: vi.fn(() => []),
  },
  parsePluginSchema: vi.fn(),
  buildPluginTableDDL: vi.fn(() => 'CREATE TABLE IF NOT EXISTS "fqcp_crm_default_contacts" (id UUID);'),
  resolveTableName: vi.fn((pluginId: string, instanceName: string, tableName: string) => `fqcp_${pluginId}_${instanceName}_${tableName}`),
  validateInstanceName: vi.fn(),
  validatePluginId: vi.fn(),
  buildGlobalTypeRegistry: vi.fn(),
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

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

vi.mock('../../src/utils/schema-migration.js', () => ({
  compareSchemaVersions: vi.fn(),
  analyzeSchemaChanges: vi.fn(),
}));

// Mock pg-client utility so plugin registration uses mockPgClient regardless of pg module resolution
vi.mock('../../src/utils/pg-client.js', () => ({
  createPgClientIPv4: vi.fn(() => ({
    connect: mockPgClient.connect,
    query: mockPgClient.query,
    end: mockPgClient.end,
  })),
}));

vi.mock('../../src/services/plugin-coordination-lock.js', () => ({
  withPluginCoordinationLock: vi.fn(async (_config, _input, fn: () => Promise<unknown>) => fn()),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Imports (after mocks)
// ─────────────────────────────────────────────────────────────────────────────

import { registerPluginTools } from '../../src/mcp/tools/plugins.js';
import { supabaseManager } from '../../src/storage/supabase.js';
import { pluginManager, parsePluginSchema } from '../../src/plugins/manager.js';
import { compareSchemaVersions, analyzeSchemaChanges } from '../../src/utils/schema-migration.js';
import { logger } from '../../src/logging/logger.js';
import * as nodeFs from 'node:fs';
import pg from 'pg';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { LockTimeoutError } from '../../src/services/document-lock.js';
import { withPluginCoordinationLock } from '../../src/services/plugin-coordination-lock.js';

function parseToolText(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

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
    defaults: { project: 'Default' },
    vault: { path: '/tmp/vault' },
    projects: { areas: [] },
    locking: { enabled: false },
  } as unknown as FlashQueryConfig;
}

const VALID_SCHEMA_YAML = `
plugin:
  id: crm
  name: CRM Plugin
  version: 1

tables:
  - name: contacts
    columns:
      - name: full_name
        type: text
        required: true
`;

const PARSED_SCHEMA_MOCK = {
  plugin: { id: 'crm', name: 'CRM Plugin', version: '1' },
  embedding: null,
  tables: [
    {
      name: 'contacts',
      columns: [{ name: 'full_name', type: 'text', required: true }],
    },
  ],
};

/** Build a default supabase mock for the "no existing entry" case */
function makeDefaultSupabaseMock() {
  const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const mockEq3 = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
  const mockEq2 = vi.fn().mockReturnValue({ eq: mockEq3 });
  const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 });
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 });
  const mockCatalogEq = vi.fn().mockResolvedValue({
    data: [{ name: 'primary', dimensions: 1536, status: 'active' }],
    error: null,
  });
  const mockCatalogSelect = vi.fn().mockReturnValue({ eq: mockCatalogEq });
  const mockInsert = vi.fn().mockResolvedValue({ data: [{ id: 'new-id' }], error: null });
  const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });

  const mockFrom = vi.fn((table: string) => ({
    select: mockSelect,
    ...(table === 'fqc_embeddings' ? { select: mockCatalogSelect } : {}),
    insert: mockInsert,
    update: mockUpdate,
  }));

  vi.mocked(supabaseManager.getClient).mockReturnValue({
    from: mockFrom,
  } as unknown as ReturnType<typeof supabaseManager.getClient>);

  return { mockFrom, mockSelect, mockInsert, mockUpdate };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: registerPluginTools registers 2 tools
// ─────────────────────────────────────────────────────────────────────────────

describe('registerPluginTools', () => {
  it('registers exactly 3 tools: register_plugin, get_plugin_info, and unregister_plugin', () => {
    const config = makeConfig();
    const { server } = createMockServer();
    registerPluginTools(server, config);

    const registerTool = vi.mocked(server.registerTool);
    expect(registerTool).toHaveBeenCalledTimes(3);

    const names = registerTool.mock.calls.map(call => call[0]);
    expect(names).toContain('register_plugin');
    expect(names).toContain('get_plugin_info');
    expect(names).toContain('unregister_plugin');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: register_plugin
// ─────────────────────────────────────────────────────────────────────────────

describe('register_plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Re-set hoisted mock implementations after clearAllMocks
    mockPgClient.connect.mockResolvedValue(undefined);
    mockPgClient.query.mockResolvedValue({ rows: [] });
    mockPgClient.end.mockResolvedValue(undefined);

    // Default: parsePluginSchema returns valid schema
    vi.mocked(parsePluginSchema).mockReturnValue(PARSED_SCHEMA_MOCK as ReturnType<typeof parsePluginSchema>);

    // Set up default supabase mock
    makeDefaultSupabaseMock();
  });

  it('registers plugin with inline schema_yaml — creates tables and inserts registry row', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    const handler = getHandler('register_plugin');
    const result = await handler({ schema_yaml: VALID_SCHEMA_YAML }) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(parseToolText(result)).toMatchObject({
      plugin_id: 'crm',
      name: 'CRM Plugin',
      status: 'registered',
      table_count: 1,
      was_new: true,
    });
    expect(parseToolText(result)).not.toHaveProperty('tables');
    // pg connection was established via createPgClientIPv4
    expect(mockPgClient.connect).toHaveBeenCalled();
    expect(mockPgClient.query).toHaveBeenCalled();
    expect(mockPgClient.end).toHaveBeenCalled();
    // pluginManager.loadEntry was called
    expect(pluginManager.loadEntry).toHaveBeenCalledWith(
      expect.objectContaining({ plugin_id: 'crm', plugin_instance: 'default' })
    );
  });

  it('reads schema_path from disk when provided', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    vi.mocked(nodeFs.readFileSync).mockReturnValue(VALID_SCHEMA_YAML);

    const handler = getHandler('register_plugin');
    const result = await handler({ schema_path: '/path/to/crm.yaml' }) as { isError?: boolean };

    expect(result.isError).toBeUndefined();
    expect(nodeFs.readFileSync).toHaveBeenCalledWith('/path/to/crm.yaml', 'utf-8');
  });

  it('schema_path takes precedence over schema_yaml when both provided', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    vi.mocked(nodeFs.readFileSync).mockReturnValue(VALID_SCHEMA_YAML);

    const handler = getHandler('register_plugin');
    await handler({ schema_path: '/path/to/schema.yaml', schema_yaml: 'something else' });

    expect(nodeFs.readFileSync).toHaveBeenCalledWith('/path/to/schema.yaml', 'utf-8');
    // parsePluginSchema should have been called with schema_path content
    expect(parsePluginSchema).toHaveBeenCalledWith(VALID_SCHEMA_YAML);
  });

  it('defaults plugin_instance to "default" when not provided', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    const handler = getHandler('register_plugin');
    await handler({ schema_yaml: VALID_SCHEMA_YAML });

    expect(pluginManager.loadEntry).toHaveBeenCalledWith(
      expect.objectContaining({ plugin_instance: 'default' })
    );
  });

  it('uses provided plugin_instance when specified', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    const handler = getHandler('register_plugin');
    await handler({ schema_yaml: VALID_SCHEMA_YAML, plugin_instance: 'work' });

    expect(pluginManager.loadEntry).toHaveBeenCalledWith(
      expect.objectContaining({ plugin_instance: 'work' })
    );
  });


  it('returns expected invalid_input JSON when neither schema_path nor schema_yaml provided', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    const handler = getHandler('register_plugin');
    const result = await handler({}) as { isError?: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(false);
    expect(parseToolText(result)).toEqual({
      error: 'invalid_input',
      message: 'Either schema_path or schema_yaml must be provided',
      details: { field: 'schema_path|schema_yaml' },
    });
  });

  it('returns isError when schema YAML is invalid', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    vi.mocked(parsePluginSchema).mockImplementation(() => {
      throw new Error('Invalid column type');
    });

    const handler = getHandler('register_plugin');
    const result = await handler({ schema_yaml: 'invalid yaml !!' }) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(parseToolText(result)).toMatchObject({
      error: 'runtime_error',
      message: 'Invalid column type',
    });
  });

  it('returns runtime JSON when registry lookup fails', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'registry unavailable' } });
    const mockEq3 = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockEq2 = vi.fn().mockReturnValue({ eq: mockEq3 });
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 });
    const mockCatalogEq = vi.fn().mockResolvedValue({
      data: [{ name: 'primary', dimensions: 1536, status: 'active' }],
      error: null,
    });
    const mockCatalogSelect = vi.fn().mockReturnValue({ eq: mockCatalogEq });
    vi.mocked(supabaseManager.getClient).mockReturnValue({
      from: vi.fn((table: string) => ({
        select: table === 'fqc_embeddings' ? mockCatalogSelect : mockSelect,
      })),
    } as unknown as ReturnType<typeof supabaseManager.getClient>);

    const result = await getHandler('register_plugin')({ schema_yaml: VALID_SCHEMA_YAML }) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(parseToolText(result)).toMatchObject({
      error: 'runtime_error',
      message: 'Error checking registry: registry unavailable',
    });
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: get_plugin_info
// ─────────────────────────────────────────────────────────────────────────────

describe('get_plugin_info', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns plugin info for a registered plugin', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    vi.mocked(pluginManager.getEntry).mockReturnValue({
      plugin_id: 'crm',
      plugin_instance: 'default',
      table_prefix: 'fqcp_crm_default_',
      schema: PARSED_SCHEMA_MOCK as ReturnType<typeof parsePluginSchema>,
    });

    const handler = getHandler('get_plugin_info');
    const result = await handler({ plugin_id: 'crm' }) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(parseToolText(result)).toEqual({
      plugin_id: 'crm',
      name: 'CRM Plugin',
      status: 'registered',
      table_count: 1,
      tables: ['contacts'],
    });
  });

  it('returns expected not_found for unknown plugin', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    vi.mocked(pluginManager.getEntry).mockReturnValue(undefined);

    const handler = getHandler('get_plugin_info');
    const result = await handler({ plugin_id: 'nonexistent' }) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBe(false);
    expect(parseToolText(result)).toMatchObject({
      error: 'not_found',
      identifier: 'nonexistent',
    });
  });

  it('defaults plugin_instance to "default" when not provided', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    vi.mocked(pluginManager.getEntry).mockReturnValue(undefined);

    const handler = getHandler('get_plugin_info');
    await handler({ plugin_id: 'crm' });

    expect(pluginManager.getEntry).toHaveBeenCalledWith('crm', 'default');
  });

  it('uses provided plugin_instance', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    vi.mocked(pluginManager.getEntry).mockReturnValue(undefined);

    const handler = getHandler('get_plugin_info');
    await handler({ plugin_id: 'crm', plugin_instance: 'work' });

    expect(pluginManager.getEntry).toHaveBeenCalledWith('crm', 'work');
  });

  it('gates schema, tables, and status detail through include', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    vi.mocked(pluginManager.getEntry).mockReturnValue({
      plugin_id: 'crm',
      plugin_instance: 'default',
      table_prefix: 'fqcp_crm_default_',
      schema: PARSED_SCHEMA_MOCK as ReturnType<typeof parsePluginSchema>,
    });

    const handler = getHandler('get_plugin_info');
    const result = await handler({ plugin_id: 'crm', include: ['schema', 'tables', 'status_detail'] }) as { content: Array<{ text: string }> };
    const payload = parseToolText(result);

    expect(payload).toMatchObject({
      plugin_id: 'crm',
      tables: ['contacts'],
      status_detail: {
        plugin_instance: 'default',
        table_prefix: 'fqcp_crm_default_',
        version: '1',
      },
    });
    expect(payload.schema).toEqual(PARSED_SCHEMA_MOCK);
  });
});

describe('unregister_plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(parsePluginSchema).mockReturnValue(PARSED_SCHEMA_MOCK as ReturnType<typeof parsePluginSchema>);
    mockPgClient.connect.mockResolvedValue(undefined);
    mockPgClient.end.mockResolvedValue(undefined);
  });

  function mockUnregisterSupabase(options: { memoryDeleteError?: { message: string } } = {}) {
    const registryMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'registry-1', schema_yaml: VALID_SCHEMA_YAML },
      error: null,
    });
    const registryEq3 = vi.fn().mockReturnValue({ maybeSingle: registryMaybeSingle });
    const registryEq2 = vi.fn().mockReturnValue({ eq: registryEq3 });
    const registryEq1 = vi.fn().mockReturnValue({ eq: registryEq2 });
    const registrySelect = vi.fn().mockReturnValue({ eq: registryEq1 });
    const registryDeleteEq3 = vi.fn().mockResolvedValue({ error: null });
    const registryDeleteEq2 = vi.fn().mockReturnValue({ eq: registryDeleteEq3 });
    const registryDeleteEq1 = vi.fn().mockReturnValue({ eq: registryDeleteEq2 });
    const registryDelete = vi.fn().mockReturnValue({ eq: registryDeleteEq1 });

    const countEq2 = vi.fn().mockResolvedValue({ count: 0 });
    const countEq1 = vi.fn().mockReturnValue({ eq: countEq2 });
    const countSelect = vi.fn().mockReturnValue({ eq: countEq1 });
    const updateEq2 = vi.fn().mockResolvedValue({ error: null });
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 });
    const update = vi.fn().mockReturnValue({ eq: updateEq1 });
    const memoryDeleteEq2 = vi.fn().mockResolvedValue({ error: options.memoryDeleteError ?? null });
    const otherDeleteEq2 = vi.fn().mockResolvedValue({ error: null });
    const memoryDeleteEq1 = vi.fn().mockReturnValue({ eq: memoryDeleteEq2 });
    const otherDeleteEq1 = vi.fn().mockReturnValue({ eq: otherDeleteEq2 });
    const memoryDelete = vi.fn().mockReturnValue({ eq: memoryDeleteEq1 });
    const otherDelete = vi.fn().mockReturnValue({ eq: otherDeleteEq1 });

    const mockFrom = vi.fn((table: string) => {
      if (table === 'fqc_plugin_registry') {
        return { select: registrySelect, delete: registryDelete };
      }
      if (table === 'fqc_memory') {
        return { select: countSelect, update, delete: memoryDelete };
      }
      return { select: countSelect, update, delete: otherDelete };
    });

    vi.mocked(supabaseManager.getClient).mockReturnValue({
      from: mockFrom,
    } as unknown as ReturnType<typeof supabaseManager.getClient>);
  }

  it('conflicts on live records unless force is true', async () => {
    mockUnregisterSupabase();
    mockPgClient.query
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] });
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    const result = await getHandler('unregister_plugin')({ plugin_id: 'crm' }) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBe(false);
    expect(parseToolText(result)).toMatchObject({
      error: 'conflict',
      details: { live_record_count: 2 },
    });
    expect(withPluginCoordinationLock).toHaveBeenCalledWith(
      config,
      expect.objectContaining({ pluginId: 'crm', pluginInstance: 'default' }),
      expect.any(Function)
    );
    expect(pluginManager.removeEntry).not.toHaveBeenCalled();
  });

  it('force unregisters registry state and warns about orphaned records', async () => {
    mockUnregisterSupabase();
    mockPgClient.query
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [{ count: '3' }] });
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    const result = await getHandler('unregister_plugin')({ plugin_id: 'crm', force: true }) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(parseToolText(result)).toMatchObject({
      plugin_id: 'crm',
      name: 'CRM Plugin',
      status: 'unregistered',
      table_count: 1,
      warnings: ['orphaned_records: 3'],
    });
    expect(withPluginCoordinationLock).toHaveBeenCalledWith(
      config,
      expect.objectContaining({ pluginId: 'crm', pluginInstance: 'default' }),
      expect.any(Function)
    );
    expect(pluginManager.removeEntry).toHaveBeenCalledWith('crm', 'default');
    expect(mockPgClient.query).not.toHaveBeenCalledWith(expect.stringContaining('DROP TABLE'));
  });

  it('REQ-023: force unregister cleanup failure returns runtime_error instead of unregistered status', async () => {
    mockUnregisterSupabase({ memoryDeleteError: { message: 'delete memories failed' } });
    mockPgClient.query
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    const result = await getHandler('unregister_plugin')({ plugin_id: 'crm', force: true }) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };
    const payload = parseToolText(result);

    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      error: 'runtime_error',
      message: 'Failed to delete plugin-scoped memories: delete memories failed',
    });
    expect(payload).not.toMatchObject({ status: 'unregistered' });
    expect(withPluginCoordinationLock).toHaveBeenCalledWith(
      config,
      expect.objectContaining({ pluginId: 'crm', pluginInstance: 'default' }),
      expect.any(Function)
    );
    expect(pluginManager.removeEntry).not.toHaveBeenCalled();
  });

  it('maps plugin coordination lock timeout to a conflict envelope', async () => {
    const config = makeConfig();
    vi.mocked(withPluginCoordinationLock).mockRejectedValueOnce(
      new LockTimeoutError('plugin:test-instance-id:crm:default', 1)
    );
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    const result = await getHandler('unregister_plugin')({ plugin_id: 'crm' }) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBe(false);
    expect(parseToolText(result)).toMatchObject({
      error: 'conflict',
      identifier: 'crm',
      details: { reason: 'lock_timeout', timeout_seconds: 1 },
    });
    expect(pluginManager.removeEntry).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Schema Migration (SPEC-15)
// ─────────────────────────────────────────────────────────────────────────────

describe('Schema Migration (SPEC-15)', () => {
  it('compareSchemaVersions is imported and available', () => {
    expect(compareSchemaVersions).toBeDefined();
    expect(typeof compareSchemaVersions).toBe('function');
  });

  it('analyzeSchemaChanges is imported and available', () => {
    expect(analyzeSchemaChanges).toBeDefined();
    expect(typeof analyzeSchemaChanges).toBe('function');
  });
});
