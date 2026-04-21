import type { SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import type { Logger } from '../logging/logger.js';
import { createPgClientIPv4 } from '../utils/pg-client.js';
import { ensureLastSeenColumn } from './plugin-reconciliation.js';

/**
 * DbRow shape — matches the schema of fqc_documents table rows
 */
export interface DbRow {
  id: string;
  path: string;
  content_hash: string;
  title: string;
  status: string;
  updated_at: string;
}

/**
 * propagateFqcIdChange — propagate document identity changes to all plugin tables
 *
 * Purpose: When a document's fqc_id is retired (old document deleted/archived),
 * update all references in plugin tables (fqcp_*) from oldFqcId to newFqcId.
 *
 * Discovery: Uses information_schema.columns to dynamically discover all plugin
 * tables that have an fqc_id column. No hardcoded table list required.
 *
 * Parameters:
 * - supabase: SupabaseClient (used to get databaseUrl config if needed in future)
 * - oldFqcId: UUID of the retiring document (nullable for fallback)
 * - newFqcId: UUID of the replacement document
 * - documentPath: vault path of the document being retired (for logging)
 * - pathToRow: Map of vault path → DbRow (used for oldFqcId fallback when null)
 * - logger_inst: Logger instance (passed to allow test mocking)
 *
 * Behavior:
 * 1. If oldFqcId is null, attempt lookup in pathToRow using documentPath
 * 2. If pathToRow lookup succeeds, extract old ID from that row
 * 3. If pathToRow lookup fails, log WARN and return gracefully (no update)
 * 4. Query information_schema to discover fqcp_* tables
 * 5. For each discovered table, execute UPDATE to replace oldFqcId with newFqcId
 * 6. Log results at INFO (success) or WARN (failures)
 * 7. No transaction wrapping — each UPDATE is independent and idempotent
 *
 * Error handling:
 * - information_schema query failure → log WARN and return (fail-safe)
 * - Individual UPDATE failures → log WARN per table but continue
 * - All errors caught and logged (no unhandled promise rejections)
 */
export async function propagateFqcIdChange(
  supabase: SupabaseClient,
  oldFqcId: string | null,
  newFqcId: string,
  documentPath: string,
  pathToRow: Map<string, DbRow>,
  logger_inst: Logger,
  databaseUrl?: string,
): Promise<void> {
  // ── Step 1: Determine old fqc_id (D-02 fallback logic) ────────────────────
  let resolvedOldFqcId = oldFqcId;

  if (resolvedOldFqcId === null) {
    // Attempt pathToRow fallback
    const rowAtPath = pathToRow.get(documentPath);
    if (rowAtPath) {
      resolvedOldFqcId = rowAtPath.id;
      logger_inst.debug(
        `Propagation context: oldId=null (fallback to pathToRow), newId=${newFqcId}, documentPath=${documentPath}`
      );
    } else {
      // Path not found in map — cannot determine old ID
      logger_inst.warn(
        `Cannot propagate fqc_id change — old ID unknown for document ${documentPath}`
      );
      return; // Graceful degradation per D-03
    }
  } else {
    logger_inst.debug(
      `Propagation context: oldId=${oldFqcId}, newId=${newFqcId}, documentPath=${documentPath}`
    );
  }

  // ── Step 2: Discover plugin tables via information_schema ────────────────
  let discoveredTables: string[] = [];
  let updateCount = 0;

  const dbUrl = databaseUrl ?? process.env.DATABASE_URL;

  if (!dbUrl) {
    logger_inst.warn('Failed to discover plugin tables: DATABASE_URL not set');
    return;
  }

  const pgClient = createPgClientIPv4(dbUrl);
  try {
    await pgClient.connect();
    const result = await pgClient.query<{ table_name: string }>(`
      SELECT DISTINCT table_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name LIKE 'fqcp_%'
        AND column_name = 'fqc_id'
      ORDER BY table_name
    `);
    discoveredTables = result.rows.map((row) => row.table_name);

    if (discoveredTables.length === 0) {
      logger_inst.info(
        `Successfully propagated fqc_id from ${resolvedOldFqcId} to ${newFqcId} in 0 tables`
      );
      return;
    }

    // ── Step 3: Execute UPDATE for each discovered table ─────────────────────
    for (const tableName of discoveredTables) {
      try {
        // Defensive: update last_seen_updated_at so the reconciler doesn't
        // flag this row as 'modified' due to the fqc_id change. In practice,
        // fqc_id reassignment on plugin-tracked documents is unlikely — it
        // requires scanner duplicate resolution to touch a document that a
        // plugin is actively tracking. But if it does happen, a stale
        // last_seen_updated_at would cause a false 'modified' classification
        // on the next reconciliation pass.
        await ensureLastSeenColumn(tableName, pgClient);
        await pgClient.query(
          `UPDATE ${pg.escapeIdentifier(tableName)} SET fqc_id = $1, last_seen_updated_at = NOW() WHERE fqc_id = $2`,
          [newFqcId, resolvedOldFqcId]
        );
        updateCount++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger_inst.warn(
          `Failed to propagate fqc_id change from ${resolvedOldFqcId} to ${newFqcId} in table ${tableName}: ${errMsg}`
        );
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger_inst.warn(`Failed to discover plugin tables: ${errMsg}`);
    return;
  } finally {
    await pgClient.end();
  }

  // ── Step 4: Log results (D-04 tiered approach) ──────────────────────────
  logger_inst.info(
    `Successfully propagated fqc_id from ${resolvedOldFqcId} to ${newFqcId} in ${updateCount} tables`
  );
}
