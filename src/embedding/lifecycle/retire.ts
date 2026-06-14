import pg from 'pg';
import type { FlashQueryConfig } from '../../config/loader.js';
import type { ErrorEnvelope, MaintenanceLifecycleActionResult } from '../../mcp/utils/response-formats.js';
import { validateEmbeddingSqlName } from '../../storage/supabase.js';
import { withPgClient } from '../../utils/pg-client.js';
import {
  acquireLifecycleJob,
  completeLifecycleJob,
  failLifecycleJob,
} from './jobs.js';
import type { LifecycleBaseInput, RetireLifecycleCounts } from './types.js';

export type RetireEmbeddingsResult =
  | { ok: true; payload: MaintenanceLifecycleActionResult }
  | { ok: false; error: ErrorEnvelope };

interface CatalogRow {
  name: string;
  status: 'active' | 'deactivated';
}

interface PluginConflictRow {
  plugin_id: string;
  plugin_instance: string | null;
}

interface FunctionArtifact {
  drop_signature: string;
}

interface ColumnArtifact {
  table_name: string;
  column_name: string;
}

interface IndexArtifact {
  table_name: string;
  indexname: string;
}

const CORE_TABLES = ['fqc_chunks', 'fqc_memory'] as const;
const RETIRE_ACTION = 'retire_embedding' as const;

export async function runRetireEmbedding(
  config: FlashQueryConfig,
  input: LifecycleBaseInput & { action: 'retire_embedding' }
): Promise<RetireEmbeddingsResult> {
  const startedAt = new Date().toISOString();
  const databaseUrl = requireDatabaseUrl(config);
  if (!databaseUrl.ok) return databaseUrl;

  const embeddingName = input.embedding_name ?? '';
  try {
    validateEmbeddingSqlName(embeddingName);
  } catch (err) {
    return invalidInput(err instanceof Error ? err.message : String(err), 'embedding_name', {
      embedding_name: embeddingName,
    });
  }

  const catalog = await loadCatalogEntry(config, embeddingName);
  if (!catalog.ok) return catalog;

  const conflict = await loadPluginConflicts(config, embeddingName);
  if (!conflict.ok) return conflict;
  if (conflict.payload.length > 0) {
    const affectedPlugins = conflict.payload.map((row) => row.plugin_id).sort();
    return {
      ok: false,
      error: {
        error: 'conflict',
        message: `Embedding catalog entry '${embeddingName}' is still used by registered plugin(s)`,
        identifier: embeddingName,
        details: {
          affected_plugins: [...new Set(affectedPlugins)],
          affected_plugin_instances: conflict.payload.map((row) => ({
            plugin_id: row.plugin_id,
            plugin_instance: row.plugin_instance ?? 'default',
          })),
        },
      },
    };
  }

  const acquired = await acquireLifecycleJob(config, {
    action: RETIRE_ACTION,
    embedding_name: embeddingName,
    counts: countsRecord(emptyCounts()),
    metadata: {
      dry_run: false,
      drop_stamping_columns: input.drop_stamping_columns !== false,
      catalog_status: catalog.payload.status,
    },
  });
  if (!acquired.ok) return acquired;

  let counts = emptyCounts();
  try {
    counts = await retireArtifactsInTransaction(config, embeddingName, input.drop_stamping_columns !== false);
    await completeLifecycleJob(config, acquired.payload.job_id, countsRecord(counts));
    return {
      ok: true,
      payload: {
        action: RETIRE_ACTION,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        dry_run: false,
        embedding_name: embeddingName,
        counts,
      },
    };
  } catch (err) {
    const error: ErrorEnvelope = {
      error: 'runtime_error',
      message: err instanceof Error ? err.message : String(err),
      identifier: embeddingName,
    };
    await failLifecycleJob(config, acquired.payload.job_id, error, countsRecord(counts)).catch(() => undefined);
    return { ok: false, error };
  }
}

async function retireArtifactsInTransaction(
  config: FlashQueryConfig,
  embeddingName: string,
  dropStampingColumns: boolean
): Promise<RetireLifecycleCounts> {
  return await withPgClient(config.supabase.databaseUrl, async (client) => {
    await client.query('BEGIN');
    try {
      const columns = await discoverColumns(config, embeddingName, dropStampingColumns);
      const pluginTables = [...new Set(columns
        .map((column) => column.table_name)
        .filter((table) => table.startsWith('fqcp_')))];
      const functions = await discoverFunctions(config, embeddingName, pluginTables);
      const indexes = await discoverIndexes(config, embeddingName);
      const affectedTables = new Set<string>([
        ...columns.map((column) => column.table_name),
        ...indexes.map((index) => index.table_name),
      ]);

      for (const fn of functions) {
        await client.query(`DROP FUNCTION IF EXISTS ${fn.drop_signature} CASCADE`);
      }

      for (const index of indexes) {
        await client.query(`DROP INDEX IF EXISTS ${pg.escapeIdentifier(index.indexname)}`);
      }

      const columnsByTable = new Map<string, string[]>();
      for (const column of columns) {
        const tableColumns = columnsByTable.get(column.table_name) ?? [];
        tableColumns.push(column.column_name);
        columnsByTable.set(column.table_name, tableColumns);
      }

      for (const [table, tableColumns] of columnsByTable) {
        const clauses = tableColumns
          .sort((a, b) => a.localeCompare(b))
          .map((column) => `DROP COLUMN IF EXISTS ${pg.escapeIdentifier(column)}`)
          .join(', ');
        await client.query(`ALTER TABLE ${pg.escapeIdentifier(table)} ${clauses}`);
      }

      const deleted = await client.query<{ count: string }>(
        `
        WITH deleted AS (
          DELETE FROM fqc_embeddings
          WHERE instance_id = $1 AND name = $2
          RETURNING 1
        )
        SELECT count(*)::text AS count FROM deleted
        `,
        [config.instance.id, embeddingName]
      );

      await client.query(`SELECT pg_notify('pgrst', 'reload schema')`);
      await client.query('COMMIT');

      return {
        tables_affected: affectedTables.size,
        columns_dropped: columns.length,
        indexes_dropped: indexes.length,
        catalog_rows_deleted: Number(deleted.rows[0]?.count ?? 0),
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  });
}

async function loadCatalogEntry(
  config: FlashQueryConfig,
  embeddingName: string
): Promise<{ ok: true; payload: CatalogRow } | { ok: false; error: ErrorEnvelope }> {
  const result = await withPgClient(config.supabase.databaseUrl, async (client) =>
    client.query<CatalogRow>(
      `
      SELECT name, status
      FROM fqc_embeddings
      WHERE instance_id = $1 AND name = $2
      LIMIT 1
      `,
      [config.instance.id, embeddingName]
    )
  );
  const row = result.rows[0];
  if (!row) {
    return {
      ok: false,
      error: {
        error: 'not_found',
        message: `Embedding catalog entry '${embeddingName}' was not found`,
        identifier: embeddingName,
      },
    };
  }
  return { ok: true, payload: row };
}

async function loadPluginConflicts(
  config: FlashQueryConfig,
  embeddingName: string
): Promise<{ ok: true; payload: PluginConflictRow[] } | { ok: false; error: ErrorEnvelope }> {
  const result = await withPgClient(config.supabase.databaseUrl, async (client) =>
    client.query<PluginConflictRow>(
      `
      SELECT plugin_id, plugin_instance
      FROM fqc_plugin_registry
      WHERE instance_id = $1
        AND status = 'active'
        AND embedding_name = $2
      ORDER BY plugin_id, plugin_instance
      `,
      [config.instance.id, embeddingName]
    )
  );
  return { ok: true, payload: result.rows };
}

async function discoverFunctions(
  config: FlashQueryConfig,
  embeddingName: string,
  pluginTables: string[]
): Promise<FunctionArtifact[]> {
  const coreNames = [`match_memories_${embeddingName}`, `match_chunks_${embeddingName}`];
  const recordNames = pluginTables.map((table) => truncateIdentifier(`match_records_${table}_${embeddingName}`));
  const suffix = `_${embeddingName}`;
  const result = await withPgClient(config.supabase.databaseUrl, async (client) =>
    client.query<FunctionArtifact>(
      `
      SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS drop_signature
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND (
          p.proname = ANY($1::text[])
          OR (p.proname LIKE 'match_records_%' AND right(p.proname, length($2)) = $2)
          OR p.proname = ANY($3::text[])
        )
      ORDER BY p.proname
      `,
      [coreNames, suffix, recordNames]
    )
  );
  return result.rows;
}

async function discoverIndexes(config: FlashQueryConfig, embeddingName: string): Promise<IndexArtifact[]> {
  const baseColumn = `embedding_${embeddingName}`;
  const result = await withPgClient(config.supabase.databaseUrl, async (client) =>
    client.query<IndexArtifact>(
      `
      SELECT DISTINCT t.relname AS table_name, i.relname AS indexname
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_class t ON t.oid = x.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(x.indkey)
      WHERE n.nspname = 'public'
        AND a.attname = $1
        AND (
          t.relname = ANY($2::text[])
          OR t.relname LIKE 'fqcp\\_%' ESCAPE '\\'
        )
      ORDER BY t.relname, i.relname
      `,
      [baseColumn, CORE_TABLES]
    )
  );
  return result.rows;
}

async function discoverColumns(
  config: FlashQueryConfig,
  embeddingName: string,
  dropStampingColumns: boolean
): Promise<ColumnArtifact[]> {
  const baseColumn = `embedding_${embeddingName}`;
  const targetColumns = [
    baseColumn,
    ...(dropStampingColumns
      ? [
          `${baseColumn}_model`,
          `${baseColumn}_dimensions`,
          `${baseColumn}_provider`,
          `${baseColumn}_truncated`,
          `${baseColumn}_indexed_at`,
        ]
      : []),
  ];
  const result = await withPgClient(config.supabase.databaseUrl, async (client) =>
    client.query<ColumnArtifact>(
      `
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = ANY($1::text[])
        AND (
          table_name = ANY($2::text[])
          OR table_name LIKE 'fqcp\\_%' ESCAPE '\\'
        )
      ORDER BY table_name, column_name
      `,
      [targetColumns, CORE_TABLES]
    )
  );
  return result.rows;
}

function emptyCounts(): RetireLifecycleCounts {
  return {
    tables_affected: 0,
    columns_dropped: 0,
    indexes_dropped: 0,
    catalog_rows_deleted: 0,
  };
}

function countsRecord(counts: RetireLifecycleCounts): Record<string, unknown> {
  return { ...counts };
}

function truncateIdentifier(identifier: string): string {
  return Buffer.from(identifier, 'utf8').subarray(0, 63).toString('utf8');
}

function requireDatabaseUrl(config: FlashQueryConfig): { ok: true; payload: string } | { ok: false; error: ErrorEnvelope } {
  if (!config.supabase.databaseUrl) {
    return {
      ok: false,
      error: {
        error: 'invalid_input',
        message: 'retire_embedding requires supabase.databaseUrl for direct PostgreSQL access',
        identifier: 'supabase.databaseUrl',
        details: { reason: 'direct_postgresql_required' },
      },
    };
  }
  return { ok: true, payload: config.supabase.databaseUrl };
}

function invalidInput(
  message: string,
  identifier: string,
  details: Record<string, unknown>
): { ok: false; error: ErrorEnvelope } {
  return { ok: false, error: { error: 'invalid_input', message, identifier, details } };
}
