import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initLogger } from '../../src/logging/logger.js';
import { initPlugins } from '../../src/plugins/manager.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { HAS_SUPABASE, TEST_DATABASE_URL, TEST_SUPABASE_KEY, TEST_SUPABASE_URL } from '../helpers/test-env.js';

const SKIP = !HAS_SUPABASE;
const INSTANCE_ID = `plugin-legacy-migration-${randomUUID().slice(0, 8)}`;

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: { name: INSTANCE_ID, id: INSTANCE_ID, vault: { path: vaultPath, markdownExtensions: ['.md'] } },
    supabase: { url: TEST_SUPABASE_URL, serviceRoleKey: TEST_SUPABASE_KEY, databaseUrl: TEST_DATABASE_URL, skipDdl: false },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: false },
    server: { host: '127.0.0.1', port: 3100 },
    mcpServers: {},
    host: { mcpServers: [], toolSearch: 'disabled' },
    macro: { defaultTimeoutMs: 30_000 },
    llm: { providers: [{ name: 'catalog_provider', type: 'openai', endpoint: 'https://embedding.test', apiKey: 'sk-test' }], models: [], purposes: [] },
    embeddings: [
      { name: 'primary', dimensions: 3, endpoints: [{ providerName: 'catalog_provider', model: 'primary-model' }] },
      { name: 'analysis', dimensions: 3, endpoints: [{ providerName: 'catalog_provider', model: 'analysis-model' }] },
    ],
    embedding: { provider: 'none', model: '', dimensions: 3 },
    logging: { level: 'error', output: 'stdout' },
    trashFolder: { enabled: false, path: '.trash', collisionStrategy: 'suffix' },
  } as unknown as FlashQueryConfig;
}

function schemaYaml(pluginId: string): string {
  return `
id: ${pluginId}
name: ${pluginId}
version: 1.0.0
tables:
  - name: notes
    embed_fields: [title]
    columns:
      - name: title
        type: text
`.trim();
}

async function seedCatalog(client: pg.Client, entries: string[]) {
  await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [INSTANCE_ID]);
  for (const name of entries) {
    await client.query(
      `INSERT INTO fqc_embeddings(instance_id, name, dimensions, endpoints, source, status)
       VALUES ($1, $2, 3, $3::jsonb, 'yaml', 'active')`,
      [INSTANCE_ID, name, JSON.stringify([{ provider_name: 'catalog_provider', model: `${name}-model` }])]
    );
  }
}

async function seedLegacyPlugin(client: pg.Client, pluginId: string) {
  const tableName = `fqcp_${pluginId}_default_notes`;
  await client.query(`DROP TABLE IF EXISTS ${pg.escapeIdentifier(tableName)} CASCADE`);
  await client.query(`
    CREATE TABLE ${pg.escapeIdentifier(tableName)} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      instance_id TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      title TEXT,
      embedding vector(3),
      embedding_updated_at TIMESTAMPTZ
    )
  `);
  await client.query(
    `INSERT INTO fqc_plugin_registry(instance_id, plugin_id, plugin_instance, schema_version, schema_yaml, table_prefix, status)
     VALUES ($1, $2, 'default', '1.0.0', $3, $4, 'active')`,
    [INSTANCE_ID, pluginId, schemaYaml(pluginId), `fqcp_${pluginId}_default_`]
  );
  return tableName;
}

async function columns(client: pg.Client, tableName: string): Promise<string[]> {
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name`,
    [tableName]
  );
  return result.rows.map((row: { column_name: string }) => row.column_name);
}

describe.skipIf(SKIP)('legacy plugin embedding registration migration', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;
  let client: pg.Client;
  const tables = new Set<string>();

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-plugin-legacy-migration-'));
    config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
  }, 60_000);

  beforeEach(async () => {
    for (const tableName of tables) {
      await client.query(`DROP TABLE IF EXISTS ${pg.escapeIdentifier(tableName)} CASCADE`).catch(() => undefined);
    }
    tables.clear();
    await supabaseManager.getClient().from('fqc_plugin_registry').delete().eq('instance_id', INSTANCE_ID);
    await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [INSTANCE_ID]);
  }, 60_000);

  afterAll(async () => {
    for (const tableName of tables) {
      await client.query(`DROP TABLE IF EXISTS ${pg.escapeIdentifier(tableName)} CASCADE`).catch(() => undefined);
    }
    await supabaseManager.getClient().from('fqc_plugin_registry').delete().eq('instance_id', INSTANCE_ID);
    await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [INSTANCE_ID]).catch(() => undefined);
    await client.end().catch(() => undefined);
    await rm(vaultPath, { recursive: true, force: true }).catch(() => undefined);
    await supabaseManager.close();
  });

  it('T-I-067 defaults a legacy plugin to the only active entry', async () => {
    await seedCatalog(client, ['primary']);
    const tableName = await seedLegacyPlugin(client, 'plug_legacy_one');
    tables.add(tableName);

    await initPlugins(config);

    const registry = await client.query(
      `SELECT embedding_name, embedding_resolved_at FROM fqc_plugin_registry WHERE instance_id = $1 AND plugin_id = 'plug_legacy_one'`,
      [INSTANCE_ID]
    );
    expect(registry.rows[0].embedding_name).toBe('primary');
    expect(registry.rows[0].embedding_resolved_at).toBeTruthy();
    const tableColumns = await columns(client, tableName);
    expect(tableColumns).toEqual(expect.arrayContaining(['embedding', 'embedding_primary']));
  }, 90_000);

  it('T-I-068 resolves a multi-active legacy plugin to null', async () => {
    await seedCatalog(client, ['primary', 'analysis']);
    const tableName = await seedLegacyPlugin(client, 'plug_legacy_multi');
    tables.add(tableName);

    await initPlugins(config);

    const registry = await client.query(
      `SELECT embedding_name, embedding_resolved_at FROM fqc_plugin_registry WHERE instance_id = $1 AND plugin_id = 'plug_legacy_multi'`,
      [INSTANCE_ID]
    );
    expect(registry.rows[0].embedding_name).toBeNull();
    expect(registry.rows[0].embedding_resolved_at).toBeTruthy();
    const tableColumns = await columns(client, tableName);
    expect(tableColumns).toContain('embedding');
    expect(tableColumns).not.toContain('embedding_primary');
    expect(tableColumns).not.toContain('embedding_analysis');
  }, 90_000);

  it('T-I-069 leaves legacy singular embedding columns untouched', async () => {
    await seedCatalog(client, ['primary']);
    const tableName = await seedLegacyPlugin(client, 'plug_legacy_column');
    tables.add(tableName);

    await initPlugins(config);

    const tableColumns = await columns(client, tableName);
    expect(tableColumns).toContain('embedding');
    expect(tableColumns).toContain('embedding_updated_at');
  }, 90_000);
});
