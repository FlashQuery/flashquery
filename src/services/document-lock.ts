import path from 'node:path';
import { Mutex } from 'async-mutex';
import type { FlashQueryConfig } from '../config/types.js';
import { supabaseManager } from '../storage/supabase.js';
import { acquireLock, releaseLock } from './write-lock.js';

const TIER1_STRIPE_COUNT = 1024;
const tier1Stripes = Array.from({ length: TIER1_STRIPE_COUNT }, () => new Mutex());

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

async function acquireLegacyTier2(config: FlashQueryConfig, entry: DocumentLockEntry): Promise<boolean> {
  if (!config.locking.enabled) return true;
  return acquireLock(supabaseManager.getClient(), config.instance.id, entry.resource, {
    ttlSeconds: config.locking.ttlSeconds,
  });
}

async function releaseLegacyTier2(config: FlashQueryConfig, entry: DocumentLockEntry): Promise<void> {
  if (!config.locking.enabled) return;
  await releaseLock(supabaseManager.getClient(), config.instance.id, entry.resource);
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

  const tier1Releases: Array<() => void> = [];
  const tier2Entries: DocumentLockEntry[] = [];

  try {
    for (const stripeIndex of stripeIndices) {
      const releaseTier1 = await tier1Stripes[stripeIndex].acquire();
      tier1Releases.push(releaseTier1);
    }

    for (const entry of entries) {
      const acquiredTier2 = await acquireLegacyTier2(config, entry);
      if (!acquiredTier2) {
        throw new LockTimeoutError(entry.resource);
      }
      if (config.locking.enabled) tier2Entries.push(entry);
    }

    return await fn();
  } finally {
    for (const entry of [...tier2Entries].reverse()) {
      await releaseLegacyTier2(config, entry);
    }
    for (const releaseTier1 of [...tier1Releases].reverse()) {
      releaseTier1();
    }
  }
}
