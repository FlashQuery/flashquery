import pg from 'pg';

/**
 * Checks if a single table exists in the PostgreSQL database using to_regclass().
 *
 * PostgreSQL's to_regclass() efficiently checks table existence by looking up the
 * table's object ID (OID) in the catalog. Returns NULL if the table doesn't exist.
 *
 * Pattern: SELECT to_regclass('public.tablename') IS NOT NULL
 * This is faster and more reliable than querying information_schema.tables.
 *
 * @param client - A connected pg.Client instance (e.g., from pg.Client({ connectionString }))
 * @param tableName - The name of the table to check (unqualified, assumes 'public' schema)
 * @returns true if the table exists, false if it does not
 * @throws if the SQL query fails (connection error, permission denied, etc.)
 */
export async function tableExists(client: pg.Client, tableName: string): Promise<boolean> {
  const result = await client.query(
    `SELECT to_regclass(format('public.%I', $1)) IS NOT NULL`,
    [tableName]
  );
  // PostgreSQL returns the column as '?column?' when unnamed
  return (result.rows[0] as Record<string, unknown>)['?column?'] === true;
}

/**
 * Verifies that all required FlashQuery tables exist in the database.
 *
 * This function checks for the presence of each required table after DDL execution.
 * If any table is missing, it throws an error listing the missing tables.
 * If all tables exist, it returns silently (logging is the caller's responsibility).
 *
 * Required tables:
 * - fqc_memory: stores semantic memories with vector embeddings
 * - fqc_vault: tracks local vault instances and paths
 * - fqc_documents: stores uploaded documents with embeddings
 * - fqc_plugin_registry: tracks installed plugins and schemas
 * - fqc_write_locks: coordinates concurrent write access
 * - fqc_llm_providers: LLM provider config (Phase 98)
 * - fqc_llm_models: LLM model config (Phase 98)
 * - fqc_llm_purposes: LLM purpose config (Phase 98)
 * - fqc_llm_purpose_models: purpose-to-model mappings (Phase 98)
 * - fqc_llm_usage: LLM usage telemetry (Phase 98)
 *
 * @param client - A connected pg.Client instance
 * @returns Resolves successfully if all tables exist
 * @throws Error listing missing tables if any table is not found
 */
export async function verifySchema(client: pg.Client): Promise<void> {
  const requiredTables = [
    'fqc_memory',
    'fqc_vault',
    'fqc_documents',
    'fqc_plugin_registry',
    'fqc_write_locks',
    'fqc_llm_providers',
    'fqc_llm_models',
    'fqc_llm_purposes',
    'fqc_llm_purpose_models',
    'fqc_llm_usage',
  ];

  const missingTables: string[] = [];

  for (const table of requiredTables) {
    const exists = await tableExists(client, table);
    if (!exists) {
      missingTables.push(table);
    }
  }

  if (missingTables.length > 0) {
    throw new Error(`Missing required tables after DDL: [${missingTables.join(', ')}]`);
  }
}
