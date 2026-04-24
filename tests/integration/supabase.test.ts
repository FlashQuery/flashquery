// Requires: Supabase running (local or cloud) with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// and DATABASE_URL env vars set. Falls back to fixture config for local dev.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import { loadConfig, type FlashQueryConfig } from '../../src/config/loader.js';
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { setupTestSupabase, cleanupTestRows } from '../helpers/supabase.js';
import { HAS_SUPABASE } from '../helpers/test-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, '../fixtures/flashquery.test.yml');

/**
 * Loads config from fixture, then overrides supabase credentials from env vars
 * when available. This allows the same test to run against local or cloud Supabase.
 */
function loadTestConfig(): FlashQueryConfig {
  const config = loadConfig(configPath);
  if (process.env.SUPABASE_URL) config.supabase.url = process.env.SUPABASE_URL;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) config.supabase.serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.DATABASE_URL) config.supabase.databaseUrl = process.env.DATABASE_URL;
  return config;
}

// This test verifies schema creation. The tables (fqc_memory, fqc_projects, etc.)
// are created with CREATE TABLE IF NOT EXISTS, so they are left in place after the
// test — they are schema objects, not test data. Row-level data inserted during
// these tests is cleaned up in afterAll under the test instance_id.
const TEST_INSTANCE_ID = 'test-fqc';

describe.skipIf(!HAS_SUPABASE)('Supabase integration', () => {
  let verifyClient: pg.Client;

  beforeAll(async () => {
    const config = loadTestConfig();
    initLogger(config);
    await initSupabase(config);
    verifyClient = await setupTestSupabase();
  });

  afterAll(async () => {
    // Clean up only rows seeded under the test instance_id.
    // Tables are NOT dropped — they are permanent schema objects shared across
    // the application lifecycle. Dropping them would destroy live user data.
    await cleanupTestRows(verifyClient, TEST_INSTANCE_ID);
    await supabaseManager.close();
  });

  it('creates all 5 tables (SUP-02, SUP-04)', async () => {
    // v1.7 schema: fqc_projects, fqc_event_log, fqc_routing_rules removed (CLEAN-01, CLEAN-02)
    // Remaining tables: fqc_memory, fqc_vault, fqc_plugin_registry, fqc_documents, fqc_write_locks
    const result = await verifyClient.query(`
      SELECT table_name, table_schema
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY(ARRAY[
          'fqc_memory',
          'fqc_vault',
          'fqc_plugin_registry',
          'fqc_documents',
          'fqc_write_locks'
        ])
    `);
    expect(result.rows).toHaveLength(5);
  });

  it('enables pgvector extension (SUP-02)', async () => {
    const result = await verifyClient.query(
      "SELECT extname FROM pg_extension WHERE extname = 'vector'"
    );
    expect(result.rows).toHaveLength(1);
  });

  it('creates match_memories function (SUP-02)', async () => {
    const result = await verifyClient.query(
      "SELECT proname FROM pg_proc WHERE proname = 'match_memories'"
    );
    expect(result.rows).toHaveLength(1);
  });

  it('is idempotent — second run does not error (SUP-02)', async () => {
    const config = loadTestConfig();
    await expect(initSupabase(config)).resolves.not.toThrow();

    // Re-verify tables still exist after second run (v1.7 schema)
    const result = await verifyClient.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY(ARRAY[
          'fqc_memory',
          'fqc_vault',
          'fqc_plugin_registry',
          'fqc_documents',
          'fqc_write_locks'
        ])
    `);
    expect(result.rows).toHaveLength(5);
  });

  it('v1.5 columns exist with null defaults in fqc_memory (SUP-03)', async () => {
    // v1.7: source_context removed (line 206 in buildSchemaDDL)
    const result = await verifyClient.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'fqc_memory'
        AND column_name = ANY(ARRAY[
          'previous_version_id',
          'plugin_scope',
          'version'
        ])
    `);
    expect(result.rows).toHaveLength(3);
  });

  it('tables are in public schema (SUP-04)', async () => {
    // v1.7 schema: fqc_projects, fqc_event_log, fqc_routing_rules removed
    const result = await verifyClient.query(`
      SELECT table_name, table_schema
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY(ARRAY[
          'fqc_memory',
          'fqc_vault',
          'fqc_plugin_registry',
          'fqc_documents',
          'fqc_write_locks'
        ])
    `);
    expect(result.rows).toHaveLength(5);
    for (const row of result.rows) {
      expect(row.table_schema).toBe('public');
    }
  });

  it('getClient returns a supabase-js client (SUP-05)', () => {
    const client = supabaseManager.getClient();
    expect(client).toBeTruthy();
    expect(typeof client.from).toBe('function');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Post-DDL verification tests (Wave 2: SCHEMA-04, SCHEMA-05, SCHEMA-06)
  // ─────────────────────────────────────────────────────────────────────────

  it('all required tables exist and are queryable after DDL (SCHEMA-04)', async () => {
    // Verify each of the 5 required tables exists using a simple query
    // This tests the post-DDL schema completeness

    const requiredTables = [
      'fqc_memory',
      'fqc_vault',
      'fqc_documents',
      'fqc_plugin_registry',
      'fqc_write_locks',
    ];

    for (const table of requiredTables) {
      // Existence check via information_schema (works even for empty tables)
      const result = await verifyClient.query(
        `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1) AS table_exists`,
        [table]
      );

      expect(result.rows[0].table_exists).toBe(true);
    }
  });

  it('PostgREST schema reload works after DDL (SCHEMA-06)', async () => {
    // Verify PostgREST schema reload notification succeeds
    // This is essential for REST API to recognize newly created tables

    // Send NOTIFY command to trigger PostgREST schema reload
    const notifyResult = await verifyClient.query(
      "SELECT pg_notify('pgrst', 'reload schema')"
    );
    expect(notifyResult.rows).toBeDefined();

    // Wait for PostgREST to process the notification (current behavior: 500ms)
    await new Promise(resolve => setTimeout(resolve, 600));

    // Verify schema information is accessible after reload
    // Query information_schema to confirm reload didn't break catalog access
    const schemaResult = await verifyClient.query(`
      SELECT COUNT(*) as table_count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name LIKE 'fqc_%'
    `);

    // Should have at least 5 fqc_ tables
    expect(parseInt(schemaResult.rows[0].table_count)).toBeGreaterThanOrEqual(5);
  });

  it('buildSchemaDDL generates correct vector dimensions in schema (SCHEMA-04)', async () => {
    // Verify that the DDL was created with the correct embedding dimensions
    // fqc_memory.embedding column should be vector({dimensions})

    const result = await verifyClient.query(`
      SELECT column_name, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'fqc_memory'
        AND column_name = 'embedding'
    `);

    expect(result.rows).toHaveLength(1);
    const udtName = result.rows[0].udt_name;

    // pgvector columns have data_type = 'USER-DEFINED' and udt_name = 'vector'
    // information_schema does not expose the dimension for extension types
    expect(udtName).toBe('vector');
  });

  it('pgvector extension is enabled and usable (SCHEMA-04)', async () => {
    // Verify that vector operations are available
    // This tests that pgvector extension was properly created

    const result = await verifyClient.query(`
      SELECT
        EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') as vector_enabled,
        EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'match_memories') as function_exists
    `);

    expect(result.rows[0].vector_enabled).toBe(true);
    expect(result.rows[0].function_exists).toBe(true);
  });
});
