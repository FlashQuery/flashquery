import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { compareSchemaVersions, analyzeSchemaChanges } from '../../src/utils/schema-migration.js';
import { parsePluginSchema } from '../../src/plugins/manager.js';

/**
 * Integration tests for schema migration (SPEC-15)
 * Tests real database operations with actual Supabase and PostgreSQL connections
 */

// Load test environment
const envFile = path.join(process.cwd(), '.env.test');
let testEnv = {
  SUPABASE_URL: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
  DATABASE_URL: '',
};

try {
  const envContent = readFileSync(envFile, 'utf-8');
  envContent.split('\n').forEach((line) => {
    const [key, value] = line.split('=');
    if (key && value) {
      testEnv[key as keyof typeof testEnv] = value.trim();
    }
  });
} catch (err) {
  // .env.test not found, tests will be skipped
}

const supabaseUrl = testEnv.SUPABASE_URL;
const serviceRoleKey = testEnv.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = testEnv.DATABASE_URL;

const SKIP_INTEGRATION = !supabaseUrl || !serviceRoleKey || !databaseUrl;

describe.skipIf(SKIP_INTEGRATION)('Schema Migration Integration Tests', () => {
  let pgClient: pg.Client;
  let supabase: ReturnType<typeof createClient>;

  beforeAll(async () => {
    supabase = createClient(supabaseUrl, serviceRoleKey);
    pgClient = new pg.Client({ connectionString: databaseUrl });
    await pgClient.connect();
  });

  afterEach(async () => {
    // Clean up test plugin tables
    try {
      await pgClient.query(`DROP TABLE IF EXISTS fqcp_test_crm_default_contacts CASCADE`);
      await pgClient.query(`DROP TABLE IF EXISTS fqcp_test_crm_default_interactions CASCADE`);
      await pgClient.query(
        `DELETE FROM fqc_plugin_registry WHERE plugin_id = 'test_crm' AND instance_id = 'test-instance'`
      );
    } catch (err) {
      // Cleanup errors are non-fatal
    }
  });

  it('first registration: inserts registry entry', async () => {
    const schema = parsePluginSchema(`
plugin:
  id: test_crm
  name: Test CRM
  version: 1.0.0

tables:
  - name: contacts
    columns:
      - name: id
        type: uuid
        required: true
      - name: name
        type: text
        required: true
`);

    // Insert registry entry
    const { error: insertError, data } = await supabase.from('fqc_plugin_registry').insert({
      instance_id: 'test-instance',
      plugin_id: 'test_crm',
      plugin_instance: 'default',
      schema_version: schema.plugin.version,
      schema_yaml: `plugin:
  id: test_crm
  name: Test CRM
  version: 1.0.0

tables:
  - name: contacts
    columns:
      - name: id
        type: uuid
        required: true
      - name: name
        type: text
        required: true`,
      table_prefix: 'fqcp_test_crm_default_',
      status: 'active',
    });

    expect(insertError).toBeNull();

    // Verify registry entry was created
    const { data: registryData } = await supabase
      .from('fqc_plugin_registry')
      .select('*')
      .eq('plugin_id', 'test_crm')
      .eq('instance_id', 'test-instance')
      .maybeSingle();

    expect(registryData).toBeDefined();
    expect(registryData?.schema_version).toBe('1.0.0');
  });

  it('safe schema evolution: new table added', async () => {
    // Register v1.0.0 with one table
    const oldSchema = parsePluginSchema(`
plugin:
  id: test_crm
  name: Test CRM
  version: 1.0.0

tables:
  - name: contacts
    columns:
      - name: id
        type: uuid
        required: true
`);

    const { error: v1Insert } = await supabase.from('fqc_plugin_registry').insert({
      instance_id: 'test-instance',
      plugin_id: 'test_crm',
      plugin_instance: 'default',
      schema_version: oldSchema.plugin.version,
      schema_yaml: `plugin:
  id: test_crm
  name: Test CRM
  version: 1.0.0

tables:
  - name: contacts
    columns:
      - name: id
        type: uuid
        required: true`,
      table_prefix: 'fqcp_test_crm_default_',
      status: 'active',
    });

    expect(v1Insert).toBeNull();

    // Upgrade to v1.1.0 with new table
    const newSchema = parsePluginSchema(`
plugin:
  id: test_crm
  name: Test CRM
  version: 1.1.0

tables:
  - name: contacts
    columns:
      - name: id
        type: uuid
        required: true
  - name: interactions
    columns:
      - name: id
        type: uuid
        required: true
`);

    // Analyze changes
    const { safe, unsafe } = analyzeSchemaChanges(oldSchema, newSchema);
    expect(safe.length).toBeGreaterThan(0);
    expect(unsafe.length).toBe(0);
    expect(safe).toContainEqual(expect.objectContaining({ type: 'table_added', table: 'interactions' }));
  });

  it('safe schema evolution: new nullable column added', async () => {
    const oldSchema = parsePluginSchema(`
plugin:
  id: test_crm
  name: Test CRM
  version: 1.0.0

tables:
  - name: contacts
    columns:
      - name: id
        type: uuid
        required: true
      - name: name
        type: text
        required: true
`);

    const newSchema = parsePluginSchema(`
plugin:
  id: test_crm
  name: Test CRM
  version: 1.1.0

tables:
  - name: contacts
    columns:
      - name: id
        type: uuid
        required: true
      - name: name
        type: text
        required: true
      - name: email
        type: text
        required: false
`);

    const { safe, unsafe } = analyzeSchemaChanges(oldSchema, newSchema);
    expect(safe).toContainEqual(
      expect.objectContaining({ type: 'column_added', table: 'contacts', column: 'email' })
    );
    expect(unsafe.length).toBe(0);
  });

  it('unsafe schema evolution: column removed is rejected', async () => {
    const oldSchema = parsePluginSchema(`
plugin:
  id: test_crm
  name: Test CRM
  version: 1.0.0

tables:
  - name: contacts
    columns:
      - name: id
        type: uuid
        required: true
      - name: name
        type: text
        required: true
      - name: email
        type: text
        required: false
`);

    const newSchema = parsePluginSchema(`
plugin:
  id: test_crm
  name: Test CRM
  version: 1.1.0

tables:
  - name: contacts
    columns:
      - name: id
        type: uuid
        required: true
      - name: name
        type: text
        required: true
`);

    const { safe, unsafe } = analyzeSchemaChanges(oldSchema, newSchema);
    expect(unsafe).toContainEqual(expect.objectContaining({ type: 'column_removed', table: 'contacts', column: 'email' }));
    expect(safe.length).toBe(0);
  });

  it('unsafe schema evolution: column type change is rejected', async () => {
    const oldSchema = parsePluginSchema(`
plugin:
  id: test_crm
  name: Test CRM
  version: 1.0.0

tables:
  - name: contacts
    columns:
      - name: id
        type: uuid
        required: true
      - name: status
        type: text
        required: true
`);

    const newSchema = parsePluginSchema(`
plugin:
  id: test_crm
  name: Test CRM
  version: 1.1.0

tables:
  - name: contacts
    columns:
      - name: id
        type: uuid
        required: true
      - name: status
        type: integer
        required: true
`);

    const { safe, unsafe } = analyzeSchemaChanges(oldSchema, newSchema);
    expect(unsafe).toContainEqual(
      expect.objectContaining({
        type: 'type_changed',
        table: 'contacts',
        column: 'status',
        oldValue: 'text',
        newValue: 'integer',
      })
    );
  });

  it('idempotent: re-registering same version is no-op', async () => {
    const versionResult = compareSchemaVersions('1.0.0', '1.0.0');
    expect(versionResult).toBe(0);

    const versionResult2 = compareSchemaVersions('1.0', '1.0.0');
    expect(versionResult2).toBe(0);
  });

  it('version comparison: uses integer comparison not string', async () => {
    const comparison = compareSchemaVersions('1.10.0', '1.2.0');
    expect(comparison).toBe(1); // 1.10 > 1.2 (not < when compared as strings)

    const comparison2 = compareSchemaVersions('1.2.0', '1.10.0');
    expect(comparison2).toBe(-1); // 1.2 < 1.10
  });
});
