import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initLogger } from '../../src/logging/logger.js';
import { registerPluginTools } from '../../src/mcp/tools/plugins.js';
import { registerRecordTools } from '../../src/mcp/tools/records.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { TEST_DATABASE_URL, TEST_SUPABASE_KEY, TEST_SUPABASE_URL } from '../helpers/test-env.js';

export interface PluginRecordHarness {
  instanceId: string;
  config: FlashQueryConfig;
  vaultPath: string;
  client: pg.Client;
  registerPlugin: (params: Record<string, unknown>) => Promise<unknown>;
  writeRecord: (params: Record<string, unknown>) => Promise<unknown>;
  searchRecords: (params: Record<string, unknown>) => Promise<unknown>;
  tablesToDrop: Set<string>;
}

export function createMockServer() {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers[name] = handler;
    },
  } as unknown as McpServer;
  return { server, getHandler: (name: string) => handlers[name]! };
}

export function makePluginRecordConfig(instanceId: string, vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: instanceId,
      id: instanceId,
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
    },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: false },
    server: { host: '127.0.0.1', port: 3100 },
    mcpServers: {},
    host: { mcpServers: [], toolSearch: 'disabled' },
    macro: { defaultTimeoutMs: 30_000 },
    llm: {
      providers: [{ name: 'catalog_provider', type: 'openai', endpoint: 'https://embedding.test', apiKey: 'sk-test' }],
      models: [],
      purposes: [],
    },
    embeddings: [
      { name: 'primary', dimensions: 3, endpoints: [{ providerName: 'catalog_provider', model: 'primary-model' }] },
      { name: 'analysis', dimensions: 3, endpoints: [{ providerName: 'catalog_provider', model: 'analysis-model' }] },
    ],
    embedding: { provider: 'none', model: '', dimensions: 3 },
    logging: { level: 'error', output: 'stdout' },
    trashFolder: { enabled: false, path: '.trash', collisionStrategy: 'suffix' },
  } as unknown as FlashQueryConfig;
}

export function pluginRecordYaml(pluginId: string, embedding: string | null): string {
  const embeddingLine = embedding === null ? 'embedding: null' : `embedding: "${embedding}"`;
  return `
id: ${pluginId}
name: ${pluginId}
version: 1.0.0
${embeddingLine}
tables:
  - name: notes
    embed_fields: [title, body]
    columns:
      - name: title
        type: text
      - name: body
        type: text
`.trim();
}

export function textOf(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
}

export async function seedEmbeddingCatalog(client: pg.Client, instanceId: string, names = ['primary', 'analysis']): Promise<void> {
  await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [instanceId]);
  for (const name of names) {
    await client.query(
      `INSERT INTO fqc_embeddings(instance_id, name, dimensions, endpoints, source, status)
       VALUES ($1, $2, 3, $3::jsonb, 'yaml', 'active')`,
      [instanceId, name, JSON.stringify([{ provider_name: 'catalog_provider', model: `${name}-model` }])]
    );
  }
}

export async function createPluginRecordHarness(): Promise<PluginRecordHarness> {
  const instanceId = `plugin-record-embed-${randomUUID().slice(0, 8)}`;
  const vaultPath = await mkdtemp(join(tmpdir(), `${instanceId}-`));
  const config = makePluginRecordConfig(instanceId, vaultPath);
  initLogger(config);
  await initSupabase(config);
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await seedEmbeddingCatalog(client, instanceId);
  const { server, getHandler } = createMockServer();
  registerPluginTools(server, config);
  registerRecordTools(server, config);
  return {
    instanceId,
    config,
    vaultPath,
    client,
    registerPlugin: getHandler('register_plugin'),
    writeRecord: getHandler('write_record'),
    searchRecords: getHandler('search_records'),
    tablesToDrop: new Set(),
  };
}

export async function destroyPluginRecordHarness(harness: PluginRecordHarness): Promise<void> {
  for (const tableName of harness.tablesToDrop) {
    await harness.client.query(`DROP TABLE IF EXISTS ${pg.escapeIdentifier(tableName)} CASCADE`).catch(() => undefined);
  }
  await supabaseManager.getClient().from('fqc_plugin_registry').delete().eq('instance_id', harness.instanceId);
  await harness.client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [harness.instanceId]).catch(() => undefined);
  await harness.client.end().catch(() => undefined);
  await rm(harness.vaultPath, { recursive: true, force: true }).catch(() => undefined);
  await supabaseManager.close();
}
