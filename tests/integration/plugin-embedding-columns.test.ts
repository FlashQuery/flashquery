import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initLogger } from '../../src/logging/logger.js';
import { registerPluginTools } from '../../src/mcp/tools/plugins.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { HAS_SUPABASE, TEST_DATABASE_URL, TEST_SUPABASE_KEY, TEST_SUPABASE_URL } from '../helpers/test-env.js';

const SKIP = !HAS_SUPABASE;
const INSTANCE_ID = `plugin-embed-columns-${randomUUID().slice(0, 8)}`;

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: INSTANCE_ID,
      id: INSTANCE_ID,
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
      { name: 'analysis', dimensions: 4, endpoints: [{ providerName: 'catalog_provider', model: 'analysis-model' }] },
    ],
    embedding: { provider: 'none', model: '', dimensions: 3 },
    logging: { level: 'error', output: 'stdout' },
    trashFolder: { enabled: false, path: '.trash', collisionStrategy: 'suffix' },
  } as unknown as FlashQueryConfig;
}

function createMockServer() {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers[name] = handler;
    },
  } as unknown as McpServer;
  return { server, getHandler: (name: string) => handlers[name]! };
}

function pluginYaml(pluginId: string, embedding: string | null, version = '1.0.0'): string {
  const embeddingLine = embedding === null ? 'embedding: null' : `embedding: "${embedding}"`;
  return `
id: ${pluginId}
name: ${pluginId}
version: ${version}
${embeddingLine}
tables:
  - name: notes
    embed_fields: [title]
    columns:
      - name: title
        type: text
      - name: body
        type: text
  - name: audit
    columns:
      - name: message
        type: text
`.trim();
}

function textOf(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
}

async function seedEmbeddingCatalog(client: pg.Client, names: Array<{ name: string; dimensions: number; status?: 'active' | 'deactivated' }>) {
  await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [INSTANCE_ID]);
  for (const entry of names) {
    await client.query(
      `INSERT INTO fqc_embeddings(instance_id, name, dimensions, endpoints, source, status)
       VALUES ($1, $2, $3, $4::jsonb, 'yaml', $5)`,
      [
        INSTANCE_ID,
        entry.name,
        entry.dimensions,
        JSON.stringify([{ provider_name: 'catalog_provider', model: `${entry.name}-model` }]),
        entry.status ?? 'active',
      ]
    );
  }
}

async function columnNames(client: pg.Client, tableName: string): Promise<string[]> {
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name`,
    [tableName]
  );
  return result.rows.map((row: { column_name: string }) => row.column_name);
}

async function indexExists(client: pg.Client, indexName: string): Promise<boolean> {
  const result = await client.query(`SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`, [indexName]);
  return result.rowCount === 1;
}

async function functionExists(client: pg.Client, functionName: string): Promise<boolean> {
  const result = await client.query(`SELECT 1 FROM pg_proc WHERE proname = $1`, [functionName]);
  return result.rowCount === 1;
}

describe.skipIf(SKIP)('plugin embedding column sets (integration)', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;
  let client: pg.Client;
  let registerPlugin: (params: Record<string, unknown>) => Promise<unknown>;
  const tablesToDrop = new Set<string>();

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-plugin-embed-columns-'));
    config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);
    registerPlugin = getHandler('register_plugin');
  }, 60_000);

  afterEach(async () => {
    for (const tableName of tablesToDrop) {
      await client.query(`DROP TABLE IF EXISTS ${pg.escapeIdentifier(tableName)} CASCADE`).catch(() => undefined);
    }
    tablesToDrop.clear();
    await supabaseManager.getClient().from('fqc_plugin_registry').delete().eq('instance_id', INSTANCE_ID);
    await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [INSTANCE_ID]);
  }, 60_000);

  afterAll(async () => {
    await client?.end().catch(() => undefined);
    await rm(vaultPath, { recursive: true, force: true }).catch(() => undefined);
    await supabaseManager.close();
  });

  it('T-I-061 adds one resolved entry column set and RPC to embed-bearing tables only', async () => {
    await seedEmbeddingCatalog(client, [{ name: 'primary', dimensions: 3 }, { name: 'analysis', dimensions: 4 }]);
    const pluginId = 'plug_cols_one';
    const notesTable = `fqcp_${pluginId}_default_notes`;
    const auditTable = `fqcp_${pluginId}_default_audit`;
    tablesToDrop.add(notesTable);
    tablesToDrop.add(auditTable);

    const result = await registerPlugin({
      schema_yaml: pluginYaml(pluginId, '*'),
      embedding_name: 'primary',
    }) as { isError?: boolean };
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toMatchObject({ embedding_name: 'primary' });

    const notesColumns = await columnNames(client, notesTable);
    expect(notesColumns).toEqual(expect.arrayContaining([
      'embedding_primary',
      'embedding_primary_model',
      'embedding_primary_dimensions',
      'embedding_primary_provider',
      'embedding_primary_truncated',
    ]));
    expect(notesColumns).not.toContain('embedding_analysis');
    expect(await indexExists(client, `idx_${notesTable}_embedding_primary`)).toBe(true);
    expect(await functionExists(client, `match_records_${notesTable}_primary`)).toBe(true);

    const auditColumns = await columnNames(client, auditTable);
    expect(auditColumns).not.toContain('embedding_primary');
  }, 90_000);

  it('T-I-062 adds no embedding columns for opted-out plugins', async () => {
    await seedEmbeddingCatalog(client, [{ name: 'primary', dimensions: 3 }]);
    const pluginId = 'plug_cols_null';
    const notesTable = `fqcp_${pluginId}_default_notes`;
    tablesToDrop.add(notesTable);
    tablesToDrop.add(`fqcp_${pluginId}_default_audit`);

    const result = await registerPlugin({ schema_yaml: pluginYaml(pluginId, null) }) as { isError?: boolean };
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toMatchObject({ embedding_name: null });

    const notesColumns = await columnNames(client, notesTable);
    expect(notesColumns.filter((column) => column.startsWith('embedding_'))).toEqual([]);
  }, 90_000);

  it('T-I-063 does not add columns for later catalog entries without re-registration', async () => {
    await seedEmbeddingCatalog(client, [{ name: 'primary', dimensions: 3 }]);
    const pluginId = 'plug_cols_frozen';
    const notesTable = `fqcp_${pluginId}_default_notes`;
    tablesToDrop.add(notesTable);
    tablesToDrop.add(`fqcp_${pluginId}_default_audit`);

    const result = await registerPlugin({ schema_yaml: pluginYaml(pluginId, '*') }) as { isError?: boolean };
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toMatchObject({ embedding_name: 'primary' });

    await seedEmbeddingCatalog(client, [{ name: 'primary', dimensions: 3 }, { name: 'analysis', dimensions: 4 }]);

    const notesColumns = await columnNames(client, notesTable);
    expect(notesColumns).toContain('embedding_primary');
    expect(notesColumns).not.toContain('embedding_analysis');
    expect(await functionExists(client, `match_records_${notesTable}_analysis`)).toBe(false);
  }, 90_000);

  it('adds the new entry column set when versioned re-registration switches embeddings', async () => {
    await seedEmbeddingCatalog(client, [{ name: 'primary', dimensions: 3 }, { name: 'analysis', dimensions: 4 }]);
    const pluginId = 'plug_cols_reregister';
    const notesTable = `fqcp_${pluginId}_default_notes`;
    tablesToDrop.add(notesTable);
    tablesToDrop.add(`fqcp_${pluginId}_default_audit`);

    const first = await registerPlugin({
      schema_yaml: pluginYaml(pluginId, '*', '1.0.0'),
      embedding_name: 'primary',
    }) as { isError?: boolean };
    expect(first.isError).toBeFalsy();

    const second = await registerPlugin({
      schema_yaml: pluginYaml(pluginId, '*', '1.1.0'),
      embedding_name: 'analysis',
    }) as { isError?: boolean };
    expect(second.isError).toBeFalsy();
    expect(JSON.parse(textOf(second))).toMatchObject({ embedding_name: 'analysis' });

    const notesColumns = await columnNames(client, notesTable);
    expect(notesColumns).toEqual(expect.arrayContaining([
      'embedding_primary',
      'embedding_analysis',
      'embedding_analysis_model',
      'embedding_analysis_dimensions',
      'embedding_analysis_provider',
      'embedding_analysis_truncated',
    ]));
    expect(await indexExists(client, `idx_${notesTable}_embedding_analysis`)).toBe(true);
    expect(await functionExists(client, `match_records_${notesTable}_analysis`)).toBe(true);
  }, 90_000);
});
