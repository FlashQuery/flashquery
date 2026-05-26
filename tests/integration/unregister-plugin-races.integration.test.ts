import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initLogger } from '../../src/logging/logger.js';
import { registerPluginTools } from '../../src/mcp/tools/plugins.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { HAS_SUPABASE, TEST_DATABASE_URL, TEST_SUPABASE_KEY, TEST_SUPABASE_URL } from '../helpers/test-env.js';

const INSTANCE_ID = 'phase-157-unregister-plugin-races';
const PLUGIN_ID = 'phase157_unregister';
const TABLE_NAME = `fqcp_${PLUGIN_ID}_default_contacts`;

const SCHEMA = `
plugin:
  id: ${PLUGIN_ID}
  name: Phase 157 Unregister
  version: 1
tables:
  - name: contacts
    columns:
      - name: name
        type: text
`.trim();

function makeConfig(): FlashQueryConfig {
  return {
    instance: { name: INSTANCE_ID, id: INSTANCE_ID, vault: { path: '/tmp/phase-157-unregister', markdownExtensions: ['.md'] } },
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

function payload(result: unknown): Record<string, unknown> {
  return JSON.parse((result as { content: Array<{ text: string }> }).content[0].text) as Record<string, unknown>;
}

describe.skipIf(!HAS_SUPABASE)('unregister-plugin T-I-045', () => {
  let config: FlashQueryConfig;
  let pgClient: pg.Client;
  let supabaseReady = false;

  beforeAll(async () => {
    config = makeConfig();
    initLogger(config);
    await initSupabase(config);
    supabaseReady = true;
    initEmbedding(config);
    pgClient = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await pgClient.connect();
  }, 120_000);

  afterAll(async () => {
    if (supabaseReady) {
      await supabaseManager.getClient().from('fqc_pending_plugin_review').delete().eq('instance_id', INSTANCE_ID);
      await supabaseManager.getClient().from('fqc_memory').delete().eq('instance_id', INSTANCE_ID);
      await supabaseManager.getClient().from('fqc_documents').delete().eq('instance_id', INSTANCE_ID);
      await supabaseManager.getClient().from('fqc_plugin_registry').delete().eq('instance_id', INSTANCE_ID);
      await supabaseManager.close();
    }
    await pgClient?.query(`DROP TABLE IF EXISTS ${pg.escapeIdentifier(TABLE_NAME)}`).catch(() => undefined);
    await pgClient?.end().catch(() => undefined);
  }, 60_000);

  it('T-I-045 concurrent unregister_plugin leaves one success and no partial cleanup state', async () => {
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    const registerResult = await getHandler('register_plugin')({ schema_yaml: SCHEMA }) as { isError?: boolean; content: Array<{ text: string }> };
    expect(registerResult.isError).toBeFalsy();

    const fqcId = randomUUID();
    await supabaseManager.getClient().from('fqc_documents').insert({
      id: fqcId,
      instance_id: INSTANCE_ID,
      path: `unregister-plugin/${fqcId}.md`,
      title: 'Phase 157 unregister doc',
      tags: [],
      status: 'active',
      ownership_plugin_id: PLUGIN_ID,
      ownership_type: 'contact',
    });
    await supabaseManager.getClient().from('fqc_pending_plugin_review').insert({
      fqc_id: fqcId,
      plugin_id: PLUGIN_ID,
      instance_id: INSTANCE_ID,
      table_name: TABLE_NAME,
      review_type: 'template_available',
      context: {},
    });
    const memoryId = randomUUID();
    await supabaseManager.getClient().from('fqc_memory').insert({
      id: memoryId,
      instance_id: INSTANCE_ID,
      content: 'Plugin-scoped memory for unregister race.',
      tags: [],
      plugin_scope: PLUGIN_ID,
      status: 'active',
      version: 1,
      previous_version_id: null,
      chain_root_id: memoryId,
      is_latest: true,
      archived_at: null,
      embedding: null,
    });

    const results = await Promise.allSettled([
      getHandler('unregister_plugin')({ plugin_id: PLUGIN_ID, force: true }),
      getHandler('unregister_plugin')({ plugin_id: PLUGIN_ID, force: true }),
    ]);
    const payloads = results.map((entry) => entry.status === 'fulfilled' ? payload(entry.value) : { error: 'rejected' });
    expect(payloads.filter((item) => item.status === 'unregistered')).toHaveLength(1);
    expect(payloads.filter((item) => item.error === 'not_found')).toHaveLength(1);

    const { data: registry } = await supabaseManager.getClient()
      .from('fqc_plugin_registry')
      .select('id')
      .eq('instance_id', INSTANCE_ID)
      .eq('plugin_id', PLUGIN_ID);
    expect(registry ?? []).toHaveLength(0);

    const { data: pending } = await supabaseManager.getClient()
      .from('fqc_pending_plugin_review')
      .select('id')
      .eq('instance_id', INSTANCE_ID)
      .eq('plugin_id', PLUGIN_ID);
    expect(pending ?? []).toHaveLength(0);

    const { data: memories } = await supabaseManager.getClient()
      .from('fqc_memory')
      .select('id')
      .eq('instance_id', INSTANCE_ID)
      .eq('plugin_scope', PLUGIN_ID);
    expect(memories ?? []).toHaveLength(0);
  }, 60_000);
});
