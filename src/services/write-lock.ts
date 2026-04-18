import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logging/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Write-lock service (Phase 24 — LOCK-01, LOCK-03)
//
// Provides distributed write locking via the fqc_write_locks table.
// Multiple FQC instances can share one Supabase database; this service
// ensures only one instance writes a given resource_type at a time.
//
// Strategy: optimistic insert with exponential backoff.
//   - acquireLock: deletes expired locks, then inserts our lock row.
//   - releaseLock: deletes our lock row explicitly.
//   - isLocked:    checks whether any non-expired lock exists for a resource.
//
// PRIMARY KEY (instance_id, resource_type) enforces mutual exclusion.
// Expired locks are cleaned before every insert attempt so a crashed instance
// does not block writers indefinitely (TTL-based recovery, LOCK-03).
// ─────────────────────────────────────────────────────────────────────────────

const INITIAL_DELAY_MS = 10;
const MAX_DELAY_MS = 1000;
const DEFAULT_TIMEOUT_MS = 10000;

export interface LockOptions {
  ttlSeconds?: number;
  timeoutMs?: number;
}

/**
 * Attempt to acquire an exclusive write lock for `resourceType` on behalf of
 * `instanceId`. Returns true on success, false if the lock could not be
 * acquired within `options.timeoutMs` (default 10 s).
 *
 * Exponential backoff: 10 ms → 20 ms → 40 ms … capped at 1 000 ms.
 * Expired locks for the same resource_type are cleaned up before each attempt
 * so that a crashed instance does not hold the lock past its TTL.
 */
export async function acquireLock(
  client: SupabaseClient,
  instanceId: string,
  resourceType: string,
  options: LockOptions = {}
): Promise<boolean> {
  const ttlSeconds = options.ttlSeconds ?? 30;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  let attempt = 0;
  let delay = INITIAL_DELAY_MS;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    // Delete any expired locks for this resource_type (not just our instance)
    await client
      .from('fqc_write_locks')
      .delete()
      .eq('resource_type', resourceType)
      .lt('expires_at', new Date().toISOString());

    // Attempt to insert our lock
    const { error } = await client.from('fqc_write_locks').insert({
      instance_id: instanceId,
      resource_type: resourceType,
      locked_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    });

    if (!error) {
      logger.debug(`[write-lock] acquired instance_id=${instanceId} resource=${resourceType}`);
      return true;
    }

    // Conflict (23505 = unique_violation) means another instance holds the lock
    attempt++;
    logger.debug(
      `[write-lock] waiting instance_id=${instanceId} resource=${resourceType} (retry ${attempt})`
    );

    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, MAX_DELAY_MS);
  }

  logger.debug(
    `[write-lock] timeout acquiring lock instance_id=${instanceId} resource=${resourceType} after ${attempt} retries`
  );
  return false;
}

/**
 * Release the write lock held by `instanceId` for `resourceType`.
 * Safe to call even if the lock has already expired or been released.
 */
export async function releaseLock(
  client: SupabaseClient,
  instanceId: string,
  resourceType: string
): Promise<void> {
  await client
    .from('fqc_write_locks')
    .delete()
    .eq('instance_id', instanceId)
    .eq('resource_type', resourceType);
  logger.debug(`[write-lock] released instance_id=${instanceId} resource=${resourceType}`);
}

/**
 * Check whether a non-expired lock exists for `resourceType`.
 * Returns `{ locked: false }` when no active lock is found.
 * Returns `{ locked: true, instanceId, expiresAt }` when an active lock exists.
 */
export async function isLocked(
  client: SupabaseClient,
  resourceType: string
): Promise<{ locked: boolean; instanceId?: string; expiresAt?: string }> {
  const { data, error } = await client
    .from('fqc_write_locks')
    .select('instance_id, expires_at')
    .eq('resource_type', resourceType)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle();

  if (error || !data) return { locked: false };
  return { locked: true, instanceId: data.instance_id, expiresAt: data.expires_at };
}
