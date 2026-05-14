import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../../src/services/plugin-reconciliation.js', () => ({
  reconcilePluginDocuments: vi.fn().mockResolvedValue({
    pluginId: 'phase126_records',
    instanceId: 'default',
    classified: { autoTrack: [], archive: [], resurrect: [], updatePath: [], syncFields: [], createPendingReview: [], clearPendingReview: [] },
    stale: false,
    cacheHit: false,
  }),
  executeReconciliationActions: vi.fn().mockResolvedValue({
    autoTracked: 0,
    archived: 0,
    resurrected: 0,
    pathsUpdated: 0,
    fieldsSynced: 0,
    pendingReviewsCreated: 0,
    pendingReviewsCleared: 0,
  }),
  invalidateReconciliationCache: vi.fn(),
}));

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initLogger } from '../../src/logging/logger.js';
import { registerPluginTools } from '../../src/mcp/tools/plugins.js';
import { registerRecordTools } from '../../src/mcp/tools/records.js';
import { initPlugins } from '../../src/plugins/manager.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { HAS_SUPABASE, TEST_DATABASE_URL, TEST_SUPABASE_KEY, TEST_SUPABASE_URL } from '../helpers/test-env.js';

const TEST_INSTANCE_ID = 'phase-126-write-record-integration';
const PLUGIN_ID = 'phase126_records';
const TABLE_NAME = `fqcp_${PLUGIN_ID}_default_contacts`;
const SKIP = !HAS_SUPABASE;

const SCHEMA = `
plugin:
  id: ${PLUGIN_ID}
  name: Phase 126 Records
  version: 1
tables:
  - name: contacts
    columns:
      - name: name
        type: text
        required: true
      - name: email
        type: text
      - name: notes
        type: text
`.trim();

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: { name: 'phase-126-write-record-integration', id: TEST_INSTANCE_ID, vault: { path: vaultPath, markdownExtensions: ['.md'] } },
    supabase: { url: TEST_SUPABASE_URL, serviceRoleKey: TEST_SUPABASE_KEY, databaseUrl: TEST_DATABASE_URL, skipDdl: false },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    locking: { enabled: false, ttlSeconds: 30 },
  } as unknown as FlashQueryConfig;
}

function createMockServer() {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers[name] = handler;
    },
  } as unknown as McpServer;
  return { server, getHandler: (name: string) => handlers[name] };
}

function textOf(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
}

describe.skipIf(SKIP)('write_record final contracts (integration)', () => {
  let config: FlashQueryConfig;
  let vaultPath: string;
  let pgClient: pg.Client;
  let getHandler: (name: string) => (params: Record<string, unknown>) => Promise<unknown>;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-write-record-'));
    config = makeConfig(vaultPath);
    initLogger(config);
    pgClient = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await pgClient.connect();
    await pgClient.query(`DROP TABLE IF EXISTS ${pg.escapeIdentifier(TABLE_NAME)}`).catch(() => {});
    await initSupabase(config);
    initEmbedding(config);
    await initPlugins(config);
    const { server, getHandler: handler } = createMockServer();
    registerPluginTools(server, config);
    registerRecordTools(server, config);
    getHandler = handler;
    await getHandler('register_plugin')({ schema_yaml: SCHEMA });
  }, 60_000);

  afterAll(async () => {
    await pgClient.query(`DROP TABLE IF EXISTS ${pg.escapeIdentifier(TABLE_NAME)}`).catch(() => {});
    await supabaseManager.getClient().from('fqc_plugin_registry').delete().eq('plugin_id', PLUGIN_ID).eq('instance_id', TEST_INSTANCE_ID);
    await pgClient.end();
    await rm(vaultPath, { recursive: true, force: true }).catch(() => {});
    await supabaseManager.close();
  });

  it('creates and updates plugin records with include-gated payloads', async () => {
    const createResult = await getHandler('write_record')({
      mode: 'create',
      plugin_id: PLUGIN_ID,
      table: 'contacts',
      data: { name: 'Ada Lovelace', email: 'ada@example.test' },
    }) as { isError?: boolean };
    expect(createResult.isError).toBeFalsy();
    const created = JSON.parse(textOf(createResult)) as { id: string; plugin_id: string; table: string; data?: unknown };
    expect(created).toMatchObject({
      id: expect.any(String),
      plugin_id: PLUGIN_ID,
      table: 'contacts',
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });
    expect(created.data).toBeUndefined();

    const { data: row } = await supabaseManager.getClient()
      .from(TABLE_NAME)
      .select('id, name, email')
      .eq('id', created.id)
      .eq('instance_id', TEST_INSTANCE_ID)
      .single();
    expect(row).toMatchObject({ id: created.id, name: 'Ada Lovelace', email: 'ada@example.test' });

    const updateResult = await getHandler('write_record')({
      mode: 'update',
      plugin_id: PLUGIN_ID,
      table: 'contacts',
      id: created.id,
      data: { email: 'ada-updated@example.test' },
      include: ['data'],
    }) as { isError?: boolean };
    expect(updateResult.isError).toBeFalsy();
    const updated = JSON.parse(textOf(updateResult)) as { data: Record<string, unknown> };
    expect(updated.data.email).toBe('ada-updated@example.test');

    const { data: updatedRow } = await supabaseManager.getClient()
      .from(TABLE_NAME)
      .select('email')
      .eq('id', created.id)
      .eq('instance_id', TEST_INSTANCE_ID)
      .single();
    expect(updatedRow).toMatchObject({ email: 'ada-updated@example.test' });
  });

  it('returns canonical invalid_input for required, generated, and unknown fields', async () => {
    const missingRequired = await getHandler('write_record')({
      mode: 'create',
      plugin_id: PLUGIN_ID,
      table: 'contacts',
      data: { email: 'missing@example.test' },
    }) as { isError?: boolean };
    expect(missingRequired.isError).toBe(false);
    expect(JSON.parse(textOf(missingRequired))).toMatchObject({ error: 'invalid_input', details: { missing_fields: ['name'] } });

    const generatedField = await getHandler('write_record')({
      mode: 'create',
      plugin_id: PLUGIN_ID,
      table: 'contacts',
      data: { name: 'Grace', id: 'managed' },
    }) as { isError?: boolean };
    expect(generatedField.isError).toBe(false);
    expect(JSON.parse(textOf(generatedField))).toMatchObject({ error: 'invalid_input', details: { field: 'id' } });

    const unknownField = await getHandler('write_record')({
      mode: 'create',
      plugin_id: PLUGIN_ID,
      table: 'contacts',
      data: { name: 'Grace', nickname: 'Amazing Grace' },
    }) as { isError?: boolean };
    expect(unknownField.isError).toBe(false);
    expect(JSON.parse(textOf(unknownField))).toMatchObject({ error: 'invalid_input', details: { field: 'nickname' } });
  });
});
