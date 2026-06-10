import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { initSupabase, createCoreEmbeddingColumnSet } from '../../../src/storage/supabase.js';
import { documentEmbeddingTarget, scheduleBackgroundEmbedding } from '../../../src/embedding/background-embed.js';
import type { EmbeddingProvider } from '../../../src/embedding/provider.js';
import type { FlashQueryConfig } from '../../../src/config/types.js';
import {
  HAS_SUPABASE,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../../helpers/test-env.js';

const TEST_INSTANCE_ID = 'phase-165-03-stamping';
const ENTRY_NAME = 'stamp165';
const BASE_COLUMN = `embedding_${ENTRY_NAME}`;

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: TEST_INSTANCE_ID,
      id: TEST_INSTANCE_ID,
      vault: { path: '/tmp/phase-165-03-stamping', markdownExtensions: ['.md'] },
    },
    server: { host: '127.0.0.1', port: 3100 },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
    },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: false, lockTimeoutSeconds: 10 },
    trashFolder: { enabled: false, path: '.trash', collisionStrategy: 'suffix' },
    mcpServers: {},
    host: { mcpServers: [], toolSearch: 'disabled' },
    macro: { defaultTimeoutMs: 30_000 },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
  };
}

const provider: EmbeddingProvider = {
  embed: async () => [0.1, 0.2, 0.3],
  getDimensions: () => 3,
  getProviderInfo: () => ({ provider: 'test-provider', model: 'native-three' }),
};

describe.skipIf(!HAS_SUPABASE)('embedding stamping write roundtrip', () => {
  let client: pg.Client;
  let config: FlashQueryConfig;

  beforeAll(async () => {
    config = makeConfig();
    await initSupabase(config);
    await createCoreEmbeddingColumnSet(config, { name: ENTRY_NAME, dimensions: 3 });
    client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    await client.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  }, 60_000);

  afterAll(async () => {
    await client?.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query(`ALTER TABLE fqc_documents DROP COLUMN IF EXISTS ${pg.escapeIdentifier(BASE_COLUMN)} CASCADE`).catch(() => undefined);
    await client?.query(`ALTER TABLE fqc_documents DROP COLUMN IF EXISTS ${pg.escapeIdentifier(`${BASE_COLUMN}_model`)} CASCADE`).catch(() => undefined);
    await client?.query(`ALTER TABLE fqc_documents DROP COLUMN IF EXISTS ${pg.escapeIdentifier(`${BASE_COLUMN}_dimensions`)} CASCADE`).catch(() => undefined);
    await client?.query(`ALTER TABLE fqc_documents DROP COLUMN IF EXISTS ${pg.escapeIdentifier(`${BASE_COLUMN}_provider`)} CASCADE`).catch(() => undefined);
    await client?.query(`ALTER TABLE fqc_documents DROP COLUMN IF EXISTS ${pg.escapeIdentifier(`${BASE_COLUMN}_truncated`)} CASCADE`).catch(() => undefined);
    await client?.query(`ALTER TABLE fqc_memory DROP COLUMN IF EXISTS ${pg.escapeIdentifier(BASE_COLUMN)} CASCADE`).catch(() => undefined);
    await client?.query(`ALTER TABLE fqc_memory DROP COLUMN IF EXISTS ${pg.escapeIdentifier(`${BASE_COLUMN}_model`)} CASCADE`).catch(() => undefined);
    await client?.query(`ALTER TABLE fqc_memory DROP COLUMN IF EXISTS ${pg.escapeIdentifier(`${BASE_COLUMN}_dimensions`)} CASCADE`).catch(() => undefined);
    await client?.query(`ALTER TABLE fqc_memory DROP COLUMN IF EXISTS ${pg.escapeIdentifier(`${BASE_COLUMN}_provider`)} CASCADE`).catch(() => undefined);
    await client?.query(`ALTER TABLE fqc_memory DROP COLUMN IF EXISTS ${pg.escapeIdentifier(`${BASE_COLUMN}_truncated`)} CASCADE`).catch(() => undefined);
    await client?.end();
  });

  it('T-I-031 write then read-back confirms vector and stamping columns populated atomically', async () => {
    await client.query(
      `INSERT INTO fqc_documents (id, instance_id, path, title, content)
       VALUES ($1, $2, $3, $4, $5)`,
      ['doc-stamped', TEST_INSTANCE_ID, 'docs/stamped.md', 'Stamped', 'content']
    );

    const result = await scheduleBackgroundEmbedding({
      target: documentEmbeddingTarget({ instanceId: TEST_INSTANCE_ID, id: 'doc-stamped' }),
      embedText: 'content',
      provider,
      supabase: { from: () => ({}) },
      databaseUrl: TEST_DATABASE_URL,
      embeddingName: ENTRY_NAME,
    });

    expect(result.warnings).toEqual([]);
    const { rows } = await client.query(
      `SELECT ${pg.escapeIdentifier(BASE_COLUMN)}::text AS vector,
              ${pg.escapeIdentifier(`${BASE_COLUMN}_model`)} AS model,
              ${pg.escapeIdentifier(`${BASE_COLUMN}_dimensions`)} AS dimensions,
              ${pg.escapeIdentifier(`${BASE_COLUMN}_provider`)} AS provider,
              ${pg.escapeIdentifier(`${BASE_COLUMN}_truncated`)} AS truncated
       FROM fqc_documents
       WHERE instance_id = $1 AND id = $2`,
      [TEST_INSTANCE_ID, 'doc-stamped']
    );

    expect(rows[0]).toMatchObject({
      vector: '[0.1,0.2,0.3]',
      model: 'native-three',
      dimensions: 3,
      provider: 'test-provider',
      truncated: false,
    });
  });
});
