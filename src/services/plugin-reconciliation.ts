/**
 * Reconciliation engine — classifies every plugin-relevant document into exactly one of seven
 * states (added, resurrected, deleted, disassociated, moved, modified, unchanged) without
 * mutating state. Mechanical policy execution is in executeReconciliationActions().
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import matter from 'gray-matter';
import { supabaseManager } from '../storage/supabase.js';
import { logger } from '../logging/logger.js';
import { createPgClientIPv4 } from '../utils/pg-client.js';
import { atomicWriteFrontmatter, vaultManager } from '../storage/vault.js';
import { pluginManager, getTypeRegistryMap } from '../plugins/manager.js';
import type { DocumentTypePolicy, TypeRegistryEntry, RegistryEntry } from '../plugins/manager.js';

// ─────────────────────────────────────────────────────────────────────────────
// Exported types (D-02)
// ─────────────────────────────────────────────────────────────────────────────

export type ClassificationState =
  | 'added' | 'resurrected' | 'deleted' | 'disassociated'
  | 'moved' | 'modified' | 'unchanged';

export interface DocumentInfo {
  fqcId: string;
  path: string;
  typeId: string;
  tableName: string | null;
}

export interface ResurrectionRef {
  fqcId: string;
  path: string;
  typeId: string;
  tableName: string;
  pluginRowId: string;
}

export interface DeletionRef {
  fqcId: string;
  tableName: string;
  pluginRowId: string;
}

export interface MovedRef {
  fqcId: string;
  oldPath: string | null;
  newPath: string;
  typeId: string;
  tableName: string;
  pluginRowId: string;
}

export interface ModifiedRef {
  fqcId: string;
  path: string;
  typeId: string;
  tableName: string;
  pluginRowId: string;
  updatedAt: string;
}

export interface ReconciliationResult {
  added: DocumentInfo[];
  resurrected: ResurrectionRef[];
  deleted: DeletionRef[];
  disassociated: DeletionRef[];
  moved: MovedRef[];
  modified: ModifiedRef[];
  unchanged: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-private row shapes
// ─────────────────────────────────────────────────────────────────────────────

interface FqcDocRow {
  id: string;
  path: string;
  status: string;
  updated_at: string;
  ownership_plugin_id: string | null;
  ownership_type: string | null;
  content_hash: string | null;
}

interface PluginTableRow {
  rowId: string;
  fqcId: string;
  status: string;
  path: string | null;
  tableName: string;
  typeId: string;
  lastSeenUpdatedAt: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level state (D-09, D-10)
// ─────────────────────────────────────────────────────────────────────────────

const STALENESS_THRESHOLD_MS = 30_000;
const reconciliationTimestamps = new Map<string, number>();
const verifiedTables = new Set<string>();

export function invalidateReconciliationCache(): void {
  reconciliationTimestamps.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Staleness cache helpers
// ─────────────────────────────────────────────────────────────────────────────

function staleCacheKey(pluginId: string, instanceId: string): string {
  return `${pluginId}:${instanceId ?? ''}`;
}

function isWithinStaleness(pluginId: string, instanceId: string): boolean {
  const last = reconciliationTimestamps.get(staleCacheKey(pluginId, instanceId));
  if (last === undefined) return false;
  return (Date.now() - last) < STALENESS_THRESHOLD_MS;
}

function markReconciled(pluginId: string, instanceId: string): void {
  reconciliationTimestamps.set(staleCacheKey(pluginId, instanceId), Date.now());
}

function emptyResult(): ReconciliationResult {
  return { added: [], resurrected: [], deleted: [], disassociated: [], moved: [], modified: [], unchanged: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-healing ALTER TABLE helper (RECON-08 / D-10)
// ─────────────────────────────────────────────────────────────────────────────

async function ensureLastSeenColumn(tableName: string, pgClient: pg.Client): Promise<void> {
  if (verifiedTables.has(tableName)) return;
  const { rows } = await pgClient.query<{ exists: number }>(
    `SELECT 1 AS exists FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'last_seen_updated_at'`,
    [tableName],
  );
  if (rows.length === 0) {
    await pgClient.query(
      `ALTER TABLE ${pg.escapeIdentifier(tableName)} ADD COLUMN IF NOT EXISTS last_seen_updated_at TIMESTAMPTZ`,
    );
    logger.debug(`[RECON-08] Added last_seen_updated_at column to ${tableName}`);
  }
  verifiedTables.add(tableName);
}

// ─────────────────────────────────────────────────────────────────────────────
// Doc-type helpers
// ─────────────────────────────────────────────────────────────────────────────

interface DocTypeEntry {
  typeId: string;
  policy: DocumentTypePolicy;
  tableName: string | null;
}

function collectPluginDocTypes(entry: RegistryEntry): DocTypeEntry[] {
  const types = entry.schema.documents?.types ?? [];
  return types.map((policy) => ({
    typeId: policy.id,
    policy,
    tableName: policy.track_as != null ? `${entry.table_prefix}${policy.track_as}` : null,
  }));
}

function isPathInWatchedFolders(filePath: string, watchedFolders: Set<string>): boolean {
  for (const folder of watchedFolders) {
    if (filePath === folder || filePath.startsWith(folder + '/')) {
      return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Classification decision tree (D-04)
// ─────────────────────────────────────────────────────────────────────────────

function classifyDocument(args: {
  fqcId: string;
  fqcDoc: FqcDocRow | undefined;
  pluginRow: PluginTableRow | undefined;
  pluginId: string;
  watchedFolders: Set<string>;
}): ClassificationState {
  const { fqcDoc, pluginRow, pluginId, watchedFolders } = args;

  // 1. Archived plugin row + active fqc_documents → resurrected
  if (pluginRow?.status === 'archived' && fqcDoc?.status === 'active') return 'resurrected';
  // 2. No plugin row + active doc (in watched folder or type) → added
  if (!pluginRow && fqcDoc?.status === 'active') return 'added';
  // 3. Active plugin row + doc missing/archived/absent → deleted
  if (pluginRow?.status === 'active' && (!fqcDoc || fqcDoc.status === 'archived' || fqcDoc.status === 'missing')) return 'deleted';
  // 4. Active plugin row + ownership mismatch → disassociated
  if (pluginRow?.status === 'active' && fqcDoc?.status === 'active' &&
      (fqcDoc.ownership_plugin_id === null || fqcDoc.ownership_plugin_id !== pluginId)) return 'disassociated';
  // 5. Active plugin row + path outside watched folders → moved
  if (pluginRow?.status === 'active' && fqcDoc?.status === 'active' &&
      !isPathInWatchedFolders(fqcDoc.path, watchedFolders)) return 'moved';
  // 6. Active plugin row + updated_at != last_seen_updated_at → modified
  if (pluginRow?.status === 'active' && fqcDoc?.status === 'active' &&
      fqcDoc.updated_at !== pluginRow.lastSeenUpdatedAt) return 'modified';
  return 'unchanged';
}

// ─────────────────────────────────────────────────────────────────────────────
// Added document type inference helpers
// ─────────────────────────────────────────────────────────────────────────────

function inferDocTypeForAdded(fqcDoc: FqcDocRow, docTypes: DocTypeEntry[]): DocTypeEntry | undefined {
  // Prefer ownership_type match if the type is registered
  if (fqcDoc.ownership_type) {
    const byType = docTypes.find((d) => d.typeId === fqcDoc.ownership_type);
    if (byType) return byType;
  }
  // Fall back to folder match
  return docTypes.find((d) => isPathInWatchedFolders(fqcDoc.path, new Set([d.policy.folder])));
}

// ─────────────────────────────────────────────────────────────────────────────
// applyFieldMap — exported pure helper (RECON-06 / D-12 / Pattern 5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map frontmatter fields to plugin table columns.
 * RECON-06 / D-12: absent frontmatter field → column explicitly set to null.
 * Column keys are the mapped target (fieldMap values). Never omit a column.
 */
export function applyFieldMap(
  fieldMap: Record<string, string> | undefined,
  frontmatter: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!fieldMap) return result;
  for (const [frontmatterKey, columnName] of Object.entries(fieldMap)) {
    // RECON-06 / D-12: absent field → NULL (never omit the column)
    // Use ?? null (not || null) to preserve falsy values like 0, false, ""
    result[columnName] = frontmatter[frontmatterKey] ?? null;
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// executeReconciliationActions helpers (module-private)
// ─────────────────────────────────────────────────────────────────────────────

function toAbsolutePath(relativePath: string): string {
  // VaultManagerImpl.rootPath is private on the interface — access via cast.
  // vaultManager is always the concrete VaultManagerImpl at runtime.
  const mgr = vaultManager as unknown as { rootPath: string };
  return join(mgr.rootPath, relativePath);
}

async function readFrontmatterFromDisk(relativePath: string): Promise<Record<string, unknown>> {
  try {
    const absPath = toAbsolutePath(relativePath);
    const raw = await readFile(absPath, 'utf-8');
    const parsed = matter(raw);
    return (parsed.data ?? {}) as Record<string, unknown>;
  } catch (err) {
    logger.debug(`[RECON] Failed to read frontmatter for ${relativePath}: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

async function withPendingReviewGuard(op: () => Promise<unknown>, opLabel: string): Promise<void> {
  try {
    await op();
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === '42P01') {
      logger.debug(`[RECON] fqc_pending_plugin_review ${opLabel} skipped — table not yet created (Phase 86)`);
      return;
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// executeReconciliationActions — mechanical policy executor (D-06)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply all configured policies to a reconciliation result.
 * Mechanical — no skill callbacks. All 7 branches per CONTEXT.md D-06.
 * @param result - output of reconcilePluginDocuments()
 * @param policies - typeId → DocumentTypePolicy for the plugin (derived from getTypeRegistryMap or entry.schema)
 */
export async function executeReconciliationActions(
  result: ReconciliationResult,
  policies: Map<string, DocumentTypePolicy>,
  pluginId: string,
  instanceId?: string,
): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    logger.warn('[RECON] DATABASE_URL not set — skipping policy execution');
    return;
  }
  const pgClient = createPgClientIPv4(dbUrl);
  await pgClient.connect();
  try {
    // Branches added in Task 2:
    //   - resurrected
    //   - added (auto-track / ignore)
    //   - deleted
    //   - disassociated
    //   - moved (keep-tracking / stop-tracking / ignore)
    //   - modified (sync-fields / ignore)
    // For now: no-op. Plan 02 Task 2 fills in the bodies.
    void result; void policies; void pluginId; void instanceId;
  } finally {
    await pgClient.end();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// reconcilePluginDocuments — full implementation
// ─────────────────────────────────────────────────────────────────────────────

export async function reconcilePluginDocuments(
  pluginId: string,
  instanceId: string,
): Promise<ReconciliationResult> {
  // Step A — Staleness check FIRST, before any DB or registry access (RECON-07 / RESEARCH.md pitfall)
  if (isWithinStaleness(pluginId, instanceId)) {
    logger.debug(`[RECON-07] Skipping reconciliation for ${pluginId}:${instanceId} (within 30s staleness window)`);
    return emptyResult();
  }

  // Step B — Load plugin entry
  const entry = pluginManager.getEntry(pluginId, instanceId);
  if (!entry) {
    logger.warn(`Plugin ${pluginId}/${instanceId} not registered — skipping reconciliation`);
    return emptyResult();
  }

  // Step C — Extract doc types and build lookup structures
  const docTypes = collectPluginDocTypes(entry);
  const watchedFolders = new Set<string>(docTypes.map((d) => d.policy.folder));
  const pluginTypeIds = docTypes.map((d) => d.typeId);
  const tableToType = new Map<string, string>();
  for (const d of docTypes) {
    if (d.tableName !== null) {
      tableToType.set(d.tableName, d.typeId);
    }
  }

  // Step D — Open ONE pg client for the whole function (PATTERNS.md / pitfall 3)
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    logger.warn('[RECON] DATABASE_URL not set — skipping reconciliation');
    return emptyResult();
  }
  const pgClient = createPgClientIPv4(dbUrl);
  await pgClient.connect();

  const result = emptyResult();

  try {
    // Step E — Self-healing: ensure last_seen_updated_at column exists on each plugin table (RECON-08)
    for (const { tableName } of docTypes.filter((d) => d.tableName !== null)) {
      await ensureLastSeenColumn(tableName as string, pgClient);
    }

    // Step F — Two-path candidate discovery via Supabase JS (known table: fqc_documents)
    const candidateMap = new Map<string, FqcDocRow>();
    const supabase = supabaseManager.getClient();

    // Path 1: folder-based query
    if (watchedFolders.size > 0) {
      const folderFilters: string[] = [];
      for (const folder of watchedFolders) {
        folderFilters.push(`path.like.${folder}/%`);
        folderFilters.push(`path.eq.${folder}`);
      }
      const folderFilter = folderFilters.join(',');
      const { data: path1Data, error: path1Error } = await supabase
        .from('fqc_documents')
        .select('id, path, status, updated_at, ownership_plugin_id, ownership_type, content_hash')
        .or(folderFilter);
      if (path1Error) {
        logger.warn('[RECON] fqc_documents query failed: ' + path1Error.message);
      } else if (path1Data) {
        for (const row of path1Data as FqcDocRow[]) {
          candidateMap.set(row.id, row);
        }
      }
    }

    // Path 2: ownership_type-based query
    if (pluginTypeIds.length > 0) {
      const { data: path2Data, error: path2Error } = await supabase
        .from('fqc_documents')
        .select('id, path, status, updated_at, ownership_plugin_id, ownership_type, content_hash')
        .in('ownership_type', pluginTypeIds);
      if (path2Error) {
        logger.warn('[RECON] fqc_documents query failed: ' + path2Error.message);
      } else if (path2Data) {
        for (const row of path2Data as FqcDocRow[]) {
          candidateMap.set(row.id, row);
        }
      }
    }

    // Step G — Query ALL plugin table rows (RECON-03 / OQ-7 guard)
    const pluginRowMap = new Map<string, PluginTableRow>();
    for (const { typeId, tableName } of docTypes.filter((d) => d.tableName !== null)) {
      // CRITICAL: Query ALL rows, including archived.
      const sql = `SELECT id, fqc_id, status, path, last_seen_updated_at FROM ${pg.escapeIdentifier(tableName as string)}`;
      let rows: Array<{ id: string; fqc_id: string; status: string; path: string | null; last_seen_updated_at: string | null }> = [];
      try {
        const res = await pgClient.query(sql);
        rows = res.rows;
      } catch (err) {
        const pgErr = err as { code?: string };
        // 42P01 = undefined_table (table removed externally) — log and continue
        if (pgErr?.code === '42P01') {
          logger.debug(`[RECON] Plugin table ${tableName} does not exist — skipping`);
          continue;
        }
        throw err;
      }
      for (const r of rows) {
        pluginRowMap.set(r.fqc_id, {
          rowId: r.id,
          fqcId: r.fqc_id,
          status: r.status,
          path: r.path,
          tableName: tableName as string,
          typeId,
          lastSeenUpdatedAt: r.last_seen_updated_at,
        });
      }
    }

    // Step H — Classification loop over union of candidateMap and pluginRowMap keys
    const allFqcIds = new Set<string>([...candidateMap.keys(), ...pluginRowMap.keys()]);
    for (const fqcId of allFqcIds) {
      const fqcDoc = candidateMap.get(fqcId);
      const pluginRow = pluginRowMap.get(fqcId);
      const state = classifyDocument({ fqcId, fqcDoc, pluginRow, pluginId, watchedFolders });

      switch (state) {
        case 'added': {
          const matchedType = fqcDoc ? inferDocTypeForAdded(fqcDoc, docTypes) : undefined;
          result.added.push({
            fqcId,
            path: fqcDoc?.path ?? '',
            typeId: matchedType?.typeId ?? '',
            tableName: matchedType?.tableName ?? null,
          });
          break;
        }
        case 'resurrected': {
          if (pluginRow && fqcDoc) {
            result.resurrected.push({
              fqcId,
              path: fqcDoc.path,
              typeId: pluginRow.typeId,
              tableName: pluginRow.tableName,
              pluginRowId: pluginRow.rowId,
            });
          }
          break;
        }
        case 'deleted': {
          if (pluginRow) {
            result.deleted.push({
              fqcId,
              tableName: pluginRow.tableName,
              pluginRowId: pluginRow.rowId,
            });
          }
          break;
        }
        case 'disassociated': {
          if (pluginRow) {
            result.disassociated.push({
              fqcId,
              tableName: pluginRow.tableName,
              pluginRowId: pluginRow.rowId,
            });
          }
          break;
        }
        case 'moved': {
          if (pluginRow && fqcDoc) {
            result.moved.push({
              fqcId,
              oldPath: pluginRow.path,
              newPath: fqcDoc.path,
              typeId: pluginRow.typeId,
              tableName: pluginRow.tableName,
              pluginRowId: pluginRow.rowId,
            });
          }
          break;
        }
        case 'modified': {
          if (pluginRow && fqcDoc) {
            result.modified.push({
              fqcId,
              path: fqcDoc.path,
              typeId: pluginRow.typeId,
              tableName: pluginRow.tableName,
              pluginRowId: pluginRow.rowId,
              updatedAt: fqcDoc.updated_at,
            });
          }
          break;
        }
        case 'unchanged': {
          result.unchanged++;
          break;
        }
      }
    }

    // Step I — Mark reconciled (inside try, before finally closes pgClient)
    markReconciled(pluginId, instanceId);
  } finally {
    await pgClient.end();
  }

  // Step J — Debug summary log and return
  logger.debug(
    `[RECON] ${pluginId}:${instanceId} — added=${result.added.length} resurrected=${result.resurrected.length} deleted=${result.deleted.length} disassociated=${result.disassociated.length} moved=${result.moved.length} modified=${result.modified.length} unchanged=${result.unchanged}`,
  );

  return result;
}
