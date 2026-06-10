import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { initLogger } from '../../../src/logging/logger.js';
import { buildSchemaDDL, initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import { setupTestSupabase } from '../../helpers/supabase.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, '../../fixtures/flashquery.test.yml');
const TEST_INSTANCE_ID = 'embedding-catalog-schema-test';

function loadTestConfig(): FlashQueryConfig {
  const config = loadConfig(configPath);
  if (process.env.SUPABASE_URL) config.supabase.url = process.env.SUPABASE_URL;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    config.supabase.serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
  if (process.env.DATABASE_URL) config.supabase.databaseUrl = process.env.DATABASE_URL;
  config.supabase.skipDdl = false;
  return config;
}

describe('embedding-catalog DDL text', () => {
  it('T-I-001 includes the fqc_embeddings catalog table and required constraints', () => {
    const ddl = buildSchemaDDL(1536);

    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS fqc_embeddings');
    expect(ddl).toContain('id UUID PRIMARY KEY DEFAULT gen_random_uuid()');
    expect(ddl).toContain('instance_id TEXT NOT NULL');
    expect(ddl).toContain('name TEXT NOT NULL');
    expect(ddl).toContain('dimensions INT NOT NULL');
    expect(ddl).toContain('endpoints JSONB NOT NULL');
    expect(ddl).toContain("source TEXT NOT NULL DEFAULT 'yaml'");
    expect(ddl).toContain("status TEXT NOT NULL DEFAULT 'active'");
    expect(ddl).toContain("CHECK (status IN ('active', 'deactivated'))");
    expect(ddl).toContain('UNIQUE(instance_id, name)');
  });
});

describe.skipIf(!HAS_SUPABASE)('embedding-catalog schema integration', () => {
  let client: pg.Client;

  beforeAll(async () => {
    const config = loadTestConfig();
    initLogger(config);
    await initSupabase(config);
    client = await setupTestSupabase();
    await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  }, 90000);

  afterAll(async () => {
    await client?.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.end().catch(() => undefined);
    await supabaseManager?.close();
  });

  it('T-I-001 creates fqc_embeddings with exact catalog columns and status check', async () => {
    const columns = await client.query(`
      SELECT column_name, is_nullable, data_type, udt_name, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'fqc_embeddings'
      ORDER BY ordinal_position
    `);

    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'id',
      'instance_id',
      'name',
      'dimensions',
      'endpoints',
      'source',
      'status',
      'created_at',
      'updated_at',
    ]);
    expect(columns.rows.find((row) => row.column_name === 'id')).toMatchObject({
      is_nullable: 'NO',
      data_type: 'uuid',
    });
    expect(columns.rows.find((row) => row.column_name === 'dimensions')).toMatchObject({
      is_nullable: 'NO',
      data_type: 'integer',
    });
    expect(columns.rows.find((row) => row.column_name === 'endpoints')).toMatchObject({
      is_nullable: 'NO',
      data_type: 'jsonb',
    });
    expect(columns.rows.find((row) => row.column_name === 'source')?.column_default).toContain("'yaml'");
    expect(columns.rows.find((row) => row.column_name === 'status')?.column_default).toContain("'active'");

    const constraints = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'fqc_embeddings'::regclass
    `);

    expect(constraints.rows.some((row) => row.definition.includes('PRIMARY KEY (id)'))).toBe(true);
    expect(
      constraints.rows.some((row) => row.definition.includes('UNIQUE (instance_id, name)'))
    ).toBe(true);
    expect(
      constraints.rows.some((row) =>
        row.definition.includes("CHECK ((status = ANY (ARRAY['active'::text, 'deactivated'::text])))")
      )
    ).toBe(true);
  });

  it('T-I-002 rejects duplicate rows for the same instance_id and name', async () => {
    const endpoints = [{ providerName: 'openai', model: 'text-embedding-3-small' }];
    await client.query(
      `INSERT INTO fqc_embeddings (instance_id, name, dimensions, endpoints)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [TEST_INSTANCE_ID, 'primary', 1536, JSON.stringify(endpoints)]
    );

    await expect(
      client.query(
        `INSERT INTO fqc_embeddings (instance_id, name, dimensions, endpoints)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [TEST_INSTANCE_ID, 'primary', 1536, JSON.stringify(endpoints)]
      )
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('T-I-003 preserves endpoint JSONB array declaration order on read-back', async () => {
    const endpoints = [
      { providerName: 'openai', model: 'text-embedding-3-small' },
      { providerName: 'local', model: 'nomic-embed-text' },
      { providerName: 'backup', model: 'text-embedding-3-large' },
    ];

    await client.query(
      `INSERT INTO fqc_embeddings (instance_id, name, dimensions, endpoints)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [TEST_INSTANCE_ID, 'ordered', 1536, JSON.stringify(endpoints)]
    );

    const result = await client.query(
      `SELECT endpoints FROM fqc_embeddings WHERE instance_id = $1 AND name = $2`,
      [TEST_INSTANCE_ID, 'ordered']
    );

    expect(result.rows[0].endpoints.map((endpoint: { model: string }) => endpoint.model)).toEqual([
      'text-embedding-3-small',
      'nomic-embed-text',
      'text-embedding-3-large',
    ]);
  });
});
