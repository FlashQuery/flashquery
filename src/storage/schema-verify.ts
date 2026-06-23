import pg from 'pg';

export interface VerifySchemaOptions {
  instanceId: string;
}

export interface EmbeddingDimensionDrift {
  entry: string;
  table: string;
  column: string;
  configuredWidth: number;
  actualWidth: number | null;
}

const CORE_EMBEDDING_TABLES = ['fqc_chunks', 'fqc_memory'] as const;
const EMBEDDING_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;

function parseVectorWidth(formattedType: string | null | undefined): number | null {
  if (!formattedType) return null;
  const match = /^vector\((\d+)\)$/.exec(formattedType);
  return match ? Number.parseInt(match[1], 10) : null;
}

function isVerifySchemaOptions(value: number | VerifySchemaOptions | undefined): value is VerifySchemaOptions {
  return typeof value === 'object' && value !== null && 'instanceId' in value;
}

function validateEmbeddingSqlName(name: string): void {
  if (!EMBEDDING_IDENTIFIER_PATTERN.test(name)) {
    throw new Error(
      `Embedding catalog entry '${name}' cannot be verified as a SQL identifier. ` +
        'Names must start with a lowercase letter and contain only lowercase letters, numbers, and underscores.'
    );
  }
}

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
    `SELECT to_regclass(format('public.%I', $1::text)) IS NOT NULL`,
    [tableName]
  );
  // PostgreSQL returns the column as '?column?' when unnamed
  return (result.rows[0] as Record<string, unknown>)['?column?'] === true;
}

export async function columnExists(client: pg.Client, tableName: string, columnName: string): Promise<boolean> {
  const result = await client.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
    )
    `,
    [tableName, columnName]
  );
  return (result.rows[0] as Record<string, unknown>).exists === true;
}

export async function verifyEmbeddingDimensions(
  client: pg.Client,
  expectedDimensions: number
): Promise<void> {
  const result = await client.query(
    `
    SELECT c.table_name, format_type(a.atttypid, a.atttypmod) AS formatted_type
    FROM information_schema.columns c
    JOIN pg_class cl
      ON cl.relname = c.table_name
    JOIN pg_namespace n
      ON n.oid = cl.relnamespace
     AND n.nspname = c.table_schema
    JOIN pg_attribute a
      ON a.attrelid = cl.oid
     AND a.attname = c.column_name
    WHERE c.table_schema = 'public'
      AND c.table_name IN ('fqc_documents', 'fqc_memory')
      AND c.column_name = 'embedding'
    ORDER BY c.table_name
    `
  );

  const mismatches: string[] = [];
  const expectedType = `vector(${expectedDimensions})`;
  for (const row of result.rows as Array<{ table_name?: unknown; formatted_type?: unknown }>) {
    const tableName = typeof row.table_name === 'string' ? row.table_name : 'unknown_table';
    const formattedType = typeof row.formatted_type === 'string' ? row.formatted_type : 'unknown';
    if (formattedType !== expectedType) {
      mismatches.push(`${tableName}.embedding is ${formattedType}`);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `Embedding dimension mismatch: config expects ${expectedType}, but existing schema has ` +
      `${mismatches.join(', ')}. FlashQuery uses shared embedding columns per database; ` +
      'changing instance.id does not create separate vector dimensions. Use an embedding model ' +
      'with the existing dimensions, or migrate/recreate the FlashQuery schema for the new dimensions.'
    );
  }
}

export async function getActiveEmbeddingDimensionDrift(
  client: pg.Client,
  instanceId: string
): Promise<EmbeddingDimensionDrift[]> {
  const catalog = await client.query(
    `
    SELECT name, dimensions
    FROM fqc_embeddings
    WHERE instance_id = $1
      AND status = 'active'
    ORDER BY name
    `,
    [instanceId]
  );

  const drifts: EmbeddingDimensionDrift[] = [];
  for (const row of catalog.rows as Array<{ name: string; dimensions: number }>) {
    validateEmbeddingSqlName(row.name);
    const columnName = `embedding_${row.name}`;
    const metadata = await client.query(
      `
      SELECT c.table_name, format_type(a.atttypid, a.atttypmod) AS formatted_type
      FROM information_schema.columns c
      JOIN pg_class cl
        ON cl.relname = c.table_name
      JOIN pg_namespace n
        ON n.oid = cl.relnamespace
       AND n.nspname = c.table_schema
      JOIN pg_attribute a
        ON a.attrelid = cl.oid
       AND a.attname = c.column_name
      WHERE c.table_schema = 'public'
        AND c.table_name = ANY($1::text[])
        AND c.column_name = $2
      ORDER BY c.table_name
      `,
      [[...CORE_EMBEDDING_TABLES], columnName]
    );
    const typeByTable = new Map(
      (metadata.rows as Array<{ table_name: string; formatted_type: string }>).map((typeRow) => [
        typeRow.table_name,
        typeRow.formatted_type,
      ])
    );

    for (const table of CORE_EMBEDDING_TABLES) {
      const actualWidth = parseVectorWidth(typeByTable.get(table));
      if (actualWidth !== row.dimensions) {
        drifts.push({
          entry: row.name,
          table,
          column: columnName,
          configuredWidth: row.dimensions,
          actualWidth,
        });
      }
    }
  }

  return drifts;
}

export async function verifyCatalogEmbeddingDimensions(
  client: pg.Client,
  instanceId: string
): Promise<void> {
  const drifts = await getActiveEmbeddingDimensionDrift(client, instanceId);
  if (drifts.length === 0) return;

  const details = drifts
    .map((drift) => {
      const actual = drift.actualWidth === null ? 'missing/non-vector' : String(drift.actualWidth);
      return (
        `entry ${drift.entry}: ${drift.table}.${drift.column} ` +
        `configured width ${drift.configuredWidth}, actual width ${actual}`
      );
    })
    .join('; ');

  throw new Error(`Embedding catalog dimension drift detected: ${details}`);
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
 * - fqc_documents: stores uploaded documents
 * - fqc_chunks: stores document semantic chunks with per-entry embeddings
 * - fqc_plugin_registry: tracks installed plugins and schemas
 * - fqc_llm_providers: LLM provider config (Phase 98)
 * - fqc_llm_models: LLM model config (Phase 98)
 * - fqc_llm_purposes: LLM purpose config (Phase 98)
 * - fqc_llm_purpose_models: purpose-to-model mappings (Phase 98)
 * - fqc_llm_usage: LLM usage telemetry (Phase 98)
 * - fqc_purpose_templates: purpose-template bindings (Phase 115)
 * - fqc_pending_embeds: durable embedding retry state (Phase 146)
 *
 * @param client - A connected pg.Client instance
 * @returns Resolves successfully if all tables exist
 * @throws Error listing missing tables if any table is not found
 */
export async function verifySchema(
  client: pg.Client,
  expectedEmbeddingDimensionsOrOptions?: number | VerifySchemaOptions
): Promise<void> {
  const requiredTables = [
    'fqc_memory',
    'fqc_vault',
    'fqc_documents',
    'fqc_chunks',
    'fqc_plugin_registry',
    'fqc_llm_providers',
    'fqc_llm_models',
    'fqc_llm_purposes',
    'fqc_llm_purpose_models',
    'fqc_llm_usage',
    'fqc_purpose_templates',
    'fqc_pending_embeds',
    'fqc_graph_nodes',
    'fqc_graph_edges',
    'fqc_pending_edges',
    'fqc_graph_maintenance_state',
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

  const requiredColumns: Array<{ table: string; column: string }> = [
    { table: 'fqc_documents', column: 'template_meta' },
    { table: 'fqc_pending_embeds', column: 'id' },
    { table: 'fqc_pending_embeds', column: 'instance_id' },
    { table: 'fqc_pending_embeds', column: 'target_kind' },
    { table: 'fqc_pending_embeds', column: 'target_table' },
    { table: 'fqc_pending_embeds', column: 'target_id' },
    { table: 'fqc_pending_embeds', column: 'target_label' },
    { table: 'fqc_pending_embeds', column: 'embed_text' },
    { table: 'fqc_pending_embeds', column: 'attempt_count' },
    { table: 'fqc_pending_embeds', column: 'last_error' },
    { table: 'fqc_pending_embeds', column: 'last_attempt_at' },
    { table: 'fqc_pending_embeds', column: 'next_retry_at' },
    { table: 'fqc_pending_embeds', column: 'status' },
    { table: 'fqc_pending_embeds', column: 'created_at' },
    { table: 'fqc_pending_embeds', column: 'updated_at' },
    { table: 'fqc_graph_nodes', column: 'chunk_id' },
    { table: 'fqc_graph_nodes', column: 'instance_id' },
    { table: 'fqc_graph_nodes', column: 'provenance_basis' },
    { table: 'fqc_graph_nodes', column: 'question_status' },
    { table: 'fqc_graph_nodes', column: 'question_resolution' },
    { table: 'fqc_graph_nodes', column: 'community_id' },
    { table: 'fqc_graph_nodes', column: 'community_label' },
    { table: 'fqc_graph_nodes', column: 'community_summary' },
    { table: 'fqc_graph_nodes', column: 'key_claims' },
    { table: 'fqc_graph_nodes', column: 'chunk_summary' },
    { table: 'fqc_graph_nodes', column: 'certainty_level' },
    { table: 'fqc_graph_nodes', column: 'staleness_risk' },
    { table: 'fqc_graph_nodes', column: 'external_refs' },
    { table: 'fqc_graph_nodes', column: 'temporal_markers' },
    { table: 'fqc_graph_nodes', column: 'analyzed_content_hash' },
    { table: 'fqc_graph_nodes', column: 'analyzed_by_model' },
    { table: 'fqc_graph_nodes', column: 'analyzed_at' },
    { table: 'fqc_graph_nodes', column: 'created_at' },
    { table: 'fqc_graph_nodes', column: 'updated_at' },
    { table: 'fqc_graph_edges', column: 'source_chunk_id' },
    { table: 'fqc_graph_edges', column: 'target_chunk_id' },
    { table: 'fqc_graph_edges', column: 'relation' },
    { table: 'fqc_graph_edges', column: 'confidence' },
    { table: 'fqc_graph_edges', column: 'confidence_score' },
    { table: 'fqc_graph_edges', column: 'reasoning' },
    { table: 'fqc_graph_edges', column: 'model' },
    { table: 'fqc_graph_edges', column: 'status' },
    { table: 'fqc_graph_edges', column: 'metadata' },
  ];
  const missingColumns: string[] = [];

  for (const required of requiredColumns) {
    const exists = await columnExists(client, required.table, required.column);
    if (!exists) {
      missingColumns.push(`${required.table}.${required.column}`);
    }
  }

  if (missingColumns.length > 0) {
    throw new Error(`Missing required columns after DDL: [${missingColumns.join(', ')}]`);
  }

  if (isVerifySchemaOptions(expectedEmbeddingDimensionsOrOptions)) {
    await verifyCatalogEmbeddingDimensions(client, expectedEmbeddingDimensionsOrOptions.instanceId);
  } else if (expectedEmbeddingDimensionsOrOptions !== undefined) {
    await verifyEmbeddingDimensions(client, expectedEmbeddingDimensionsOrOptions);
  }
}
