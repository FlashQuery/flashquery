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
  const mockInsert = vi.fn().mockResolvedValue({ data: [{ id: 'new-id' }], error: null });
  const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });

  const mockFrom = vi.fn().mockReturnValue({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  });

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


  it('returns isError when neither schema_path nor schema_yaml provided', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    const handler = getHandler('register_plugin');
    const result = await handler({}) as { isError?: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
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
    expect(result.content[0].text).toContain('Invalid column type');
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
    expect(result.content[0].text).toContain('crm');
    expect(result.content[0].text).toContain('fqcp_crm_default_');
    expect(result.content[0].text).toContain('contacts');
  });

  it('returns isError for unknown plugin', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    vi.mocked(pluginManager.getEntry).mockReturnValue(undefined);

    const handler = getHandler('get_plugin_info');
    const result = await handler({ plugin_id: 'nonexistent' }) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
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

  it('includes Version and table list in response', async () => {
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
    const result = await handler({ plugin_id: 'crm' }) as { content: Array<{ text: string }> };

    expect(result.content[0].text).toContain('Version:');
    expect(result.content[0].text).toContain('1');
    expect(result.content[0].text).toContain('contacts');
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
