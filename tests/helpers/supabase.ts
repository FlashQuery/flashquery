import pg from 'pg';
import { TEST_DATABASE_URL } from './test-env.js';

/**
 * Creates a pg.Client connected to Supabase for integration test verification.
 * Uses DATABASE_URL from .env.test (loaded via test-env.ts).
 * Works with both self-hosted and cloud-hosted Supabase.
 */
export async function setupTestSupabase(): Promise<pg.Client> {
  if (!TEST_DATABASE_URL) {
    throw new Error('DATABASE_URL not set — copy .env.test.example to .env.test and fill in your values');
  }
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  return client;
}

/**
 * Cleans up all rows seeded by an integration test under a given instance_id.
 *
 * IMPORTANT: This function ONLY deletes rows — it NEVER drops tables, functions,
 * or extensions. Dropping schema objects would destroy user data on a shared
 * Supabase instance. All core fqc_ tables are long-lived and owned by the
 * application schema, not by individual test runs.
 *
 * For plugin tables created dynamically during tests (fqcp_* prefix), the
 * calling test is responsible for dropping those specific tables in its own
 * afterAll (see plugin-records.integration.test.ts for the pattern).
 */
export async function cleanupTestRows(client: pg.Client, instanceId: string): Promise<void> {
  try {
    // Delete in reverse FK dependency order (child tables first)
    // v1.7: fqc_event_log, fqc_routing_rules, fqc_projects removed (CLEAN-01, CLEAN-02)
    await client.query('DELETE FROM fqc_plugin_registry WHERE instance_id = $1', [instanceId]);
    await client.query('DELETE FROM fqc_documents WHERE instance_id = $1', [instanceId]);
    await client.query('DELETE FROM fqc_memory WHERE instance_id = $1', [instanceId]);
    await client.query('DELETE FROM fqc_vault WHERE instance_id = $1', [instanceId]);
  } finally {
    await client.end();
  }
}

/**
 * @deprecated Use cleanupTestRows() instead. teardownTestSupabase() dropped tables
 * which destroyed live user data on a shared Supabase instance. Kept here as a
 * tombstone to prevent reintroduction.
 *
 * If you need to test schema creation idempotency (supabase.test.ts), let
 * initSupabase() run CREATE TABLE IF NOT EXISTS — the tables already existing
 * is the correct post-test state.
 */
export async function teardownTestSupabase(_client: pg.Client): Promise<void> {
  throw new Error(
    'teardownTestSupabase() has been removed. Use cleanupTestRows(client, instanceId) instead. ' +
    'Never drop core fqc_ tables in tests — they are shared schema objects, not test artifacts.'
  );
}
