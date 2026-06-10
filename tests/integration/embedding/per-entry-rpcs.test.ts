import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { initLogger } from '../../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import { syncEmbeddingCatalog } from '../../../src/embedding/embedding-config-sync.js';
import { setupTestSupabase } from '../../helpers/supabase.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, '../../fixtures/flashquery.test.yml');
const TEST_INSTANCE_ID = 'embedding-per-entry-rpc-test';

const coreTables = ['fqc_documents', 'fqc_memory'] as const;
const managedColumns = [
  'embedding_primary',
  'embedding_primary_model',
  'embedding_primary_dimensions',
  'embedding_primary_provider',
  'embedding_primary_truncated',
] as const;

function vectorLiteral(dimensions: number): string {
  return `[${Array.from({ length: dimensions }, () => '0').join(',')}]`;
}

function configWithEmbeddings(embeddings: FlashQueryConfig['embeddings']): FlashQueryConfig {
  const config = loadConfig(configPath);
  if (process.env.SUPABASE_URL) config.supabase.url = process.env.SUPABASE_URL;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) config.supabase.serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.DATABASE_URL) config.supabase.databaseUrl = process.env.DATABASE_URL;
  config.supabase.skipDdl = false;
  config.instance.id = TEST_INSTANCE_ID;
  config.embeddings = embeddings;
  return config;
}

async function cleanupPrimarySchema(client: pg.Client): Promise<void> {
  await client.query('DROP FUNCTION IF EXISTS match_memories_primary(vector, double precision, integer, text[], text, text, boolean)');
  await client.query('DROP FUNCTION IF EXISTS match_documents_primary(vector, double precision, integer, text, text[], text, boolean)');
  for (const table of coreTables) {
    await client.query(`DROP INDEX IF EXISTS idx_${table}_embedding_primary`);
    for (const column of managedColumns) {
      await client.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS ${column}`);
    }
  }
}

async function getFunctionDefinition(client: pg.Client, functionName: string): Promise<string | undefined> {
  const result = await client.query(
    `
    SELECT pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = $1
    `,
    [functionName]
  );
  return result.rows[0]?.definition;
}

describe.skipIf(!HAS_SUPABASE).sequential('per-entry-rpcs core RPC creation', () => {
  let client: pg.Client;

  beforeAll(async () => {
    const config = configWithEmbeddings([]);
    initLogger(config);
    await initSupabase(config);
    client = await setupTestSupabase();
  }, 90000);

  beforeEach(async () => {
    await client.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    await client.query('DELETE FROM fqc_memory WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    await cleanupPrimarySchema(client);
    await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  }, 60000);

  afterAll(async () => {
    await client?.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqc_memory WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await cleanupPrimarySchema(client).catch(() => undefined);
    await client?.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.end().catch(() => undefined);
    await supabaseManager?.close();
  }, 60000);

  it('T-I-050 creates core per-entry semantic RPCs with the configured vector width', async () => {
    await syncEmbeddingCatalog(configWithEmbeddings([
      {
        name: 'primary',
        dimensions: 96,
        endpoints: [{ providerName: 'openai', model: 'text-embedding-3-small' }],
      },
    ]));

    await expect(getFunctionDefinition(client, 'match_memories_primary')).resolves.toContain(
      'm."embedding_primary" <=> query_embedding'
    );
    await expect(getFunctionDefinition(client, 'match_documents_primary')).resolves.toContain(
      'd."embedding_primary" <=> query_embedding'
    );

    await client.query(
      `INSERT INTO fqc_memory (instance_id, content, embedding_primary)
       VALUES ($1, 'rpc memory probe', $2::vector)`,
      [TEST_INSTANCE_ID, vectorLiteral(96)]
    );
    await client.query(
      `INSERT INTO fqc_documents (id, instance_id, path, title, embedding_primary)
       VALUES (gen_random_uuid(), $1, '/rpc-probe.md', 'RPC Probe', $2::vector)`,
      [TEST_INSTANCE_ID, vectorLiteral(96)]
    );

    await expect(
      client.query(`SELECT * FROM match_memories_primary($1::vector, 0, 1)`, [vectorLiteral(95)])
    ).rejects.toThrow(/different vector dimensions|expected 96 dimensions/i);
    await expect(
      client.query(`SELECT * FROM match_documents_primary($1::vector, 0, 1)`, [vectorLiteral(95)])
    ).rejects.toThrow(/different vector dimensions|expected 96 dimensions/i);
  });
});
