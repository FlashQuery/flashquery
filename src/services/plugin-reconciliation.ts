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
// reconcilePluginDocuments — stub (body added in Task 2 of this plan)
// ─────────────────────────────────────────────────────────────────────────────

export async function reconcilePluginDocuments(
  pluginId: string,
  instanceId: string,
): Promise<ReconciliationResult> {
  // Body added in Task 2 of this plan.
  return emptyResult();
}
