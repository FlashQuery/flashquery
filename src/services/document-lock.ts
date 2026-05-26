import path from 'node:path';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Mutex } from 'async-mutex';
import type { FlashQueryConfig } from '../config/types.js';
import { withPgClient } from '../utils/pg-client.js';

const TIER1_STRIPE_COUNT = 1024;
const tier1Stripes = Array.from({ length: TIER1_STRIPE_COUNT }, () => new Mutex());
const heldDocumentLocks = new AsyncLocalStorage<Set<string>>();

export class LockTimeoutError extends Error {
  constructor(resource: string) {
    super(`Write lock timeout: another instance is writing to ${resource}. Retry in a few seconds.`);
    this.name = 'LockTimeoutError';
  }
}

interface DocumentLockEntry {
  basicKey: string;
  resource: string;
  stripeIndex: number;
}

interface BurstRequest<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

interface BurstState {
  entries: DocumentLockEntry[];
  stripeIndices: number[];
  queue: BurstRequest<unknown>[];
}

const activeBursts = new Map<string, BurstState>();

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function toPhase155BasicKey(filePath: string): string {
  // Phase 155 deliberately accepts already resolved absolute paths only.
  // Full realpath/case-folding canonical derivation is deferred to Phase 159.
  if (!path.isAbsolute(filePath)) {
    throw new Error('withDocumentLock requires an absolute, already validated file path');
  }
  return path.normalize(filePath);
}

function toEntry(filePath: string): DocumentLockEntry {
  const basicKey = toPhase155BasicKey(filePath);
  return {
    basicKey,
    resource: `document:${basicKey}`,
    stripeIndex: hashString(basicKey) % TIER1_STRIPE_COUNT,
  };
}

function uniqueSortedEntries(filePaths: string[]): DocumentLockEntry[] {
  const byKey = new Map<string, DocumentLockEntry>();
  for (const filePath of filePaths) {
    const entry = toEntry(filePath);
    byKey.set(entry.basicKey, entry);
  }
  return [...byKey.values()].sort((a, b) => a.basicKey.localeCompare(b.basicKey));
}

function toBurstKey(entries: DocumentLockEntry[]): string {
  return entries.map((entry) => entry.basicKey).join('\n');
}

function toAdvisoryKey(entry: DocumentLockEntry): string {
  const digest = createHash('sha256').update(entry.resource).digest();
  return digest.readBigInt64BE(0).toString();
}

export function isDocumentLockHeldForPath(filePath: string): boolean {
  const held = heldDocumentLocks.getStore();
  if (!held) return false;
  return held.has(toPhase155BasicKey(filePath));
}

async function runWithTier2<T>(
  config: FlashQueryConfig,
  entries: DocumentLockEntry[],
  fn: () => Promise<T>
): Promise<T> {
  if (!config.locking.enabled) return fn();

  const advisoryKeys = entries.map(toAdvisoryKey);
  return withPgClient(config.supabase.databaseUrl, async (client) => {
    const acquiredKeys: string[] = [];
    try {
      for (const advisoryKey of advisoryKeys) {
        await client.query('SELECT pg_advisory_lock($1::bigint)', [advisoryKey]);
        acquiredKeys.push(advisoryKey);
      }
      return await fn();
    } finally {
      for (const advisoryKey of [...acquiredKeys].reverse()) {
        const result = await client.query<{ released: boolean }>(
          'SELECT pg_advisory_unlock($1::bigint) AS released',
          [advisoryKey]
        );
        if (result.rows[0]?.released !== true) {
          throw new Error(`Failed to release advisory document lock ${advisoryKey}`);
        }
      }
    }
  });
}

export async function withDocumentLock<T>(
  config: FlashQueryConfig,
  filePath: string,
  fn: () => Promise<T>
): Promise<T> {
  return withDocumentLocks(config, [filePath], fn);
}

export async function withDocumentLocks<T>(
  config: FlashQueryConfig,
  filePaths: string[],
  fn: () => Promise<T>
): Promise<T> {
  const entries = uniqueSortedEntries(filePaths);
  if (entries.length === 0) return fn();
  const stripeIndices = [...new Set(entries.map((entry) => entry.stripeIndex))].sort((a, b) => a - b);
  const burstKey = toBurstKey(entries);
  const activeBurst = activeBursts.get(burstKey);

  if (activeBurst) {
    return new Promise<T>((resolve, reject) => {
      activeBurst.queue.push({ fn, resolve: resolve as (value: unknown) => void, reject });
    });
  }

  const burstState: BurstState = {
    entries,
    stripeIndices,
    queue: [],
  };

  activeBursts.set(burstKey, burstState);

  const initialPromise = new Promise<T>((resolve, reject) => {
    burstState.queue.push({ fn, resolve: resolve as (value: unknown) => void, reject });
  });

  const tier1Releases: Array<() => void> = [];

  void (async () => {
    const outcomes: Array<
      | { request: BurstRequest<unknown>; status: 'fulfilled'; value: unknown }
      | { request: BurstRequest<unknown>; status: 'rejected'; reason: unknown }
    > = [];

    try {
      for (const stripeIndex of stripeIndices) {
        const releaseTier1 = await tier1Stripes[stripeIndex].acquire();
        tier1Releases.push(releaseTier1);
      }

      await runWithTier2(config, entries, async () => {
        while (burstState.queue.length > 0) {
          const request = burstState.queue.shift();
          if (!request) continue;
          const inheritedLocks = heldDocumentLocks.getStore();
          const activeLocks = new Set(inheritedLocks ?? []);
          for (const entry of entries) {
            activeLocks.add(entry.basicKey);
          }

          try {
            const result = await heldDocumentLocks.run(activeLocks, request.fn);
            outcomes.push({ request, status: 'fulfilled', value: result });
          } catch (err) {
            outcomes.push({ request, status: 'rejected', reason: err });
          }
        }
      });

      for (const outcome of outcomes) {
        if (outcome.status === 'fulfilled') {
          outcome.request.resolve(outcome.value);
        } else {
          outcome.request.reject(outcome.reason);
        }
      }
    } catch (err) {
      for (const outcome of outcomes) {
        outcome.request.reject(err);
      }
      for (const request of burstState.queue.splice(0)) {
        request.reject(err);
      }
    } finally {
      activeBursts.delete(burstKey);
      for (const releaseTier1 of [...tier1Releases].reverse()) {
        releaseTier1();
      }
    }
  })();

  return initialPromise;
}
