import type { FlashQueryConfig } from '../config/loader.js';
import { withPgClient } from '../utils/pg-client.js';
import { Mutex } from 'async-mutex';
import { LockTimeoutError } from './document-lock.js';

const PLUGIN_LOCK_STRIPE_COUNT = 256;
const PLUGIN_TIER2_RETRY_DELAY_MS = 25;
const pluginLockStripes = Array.from({ length: PLUGIN_LOCK_STRIPE_COUNT }, () => new Mutex());

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function timeoutMs(config: FlashQueryConfig): number {
  return (config.locking.lockTimeoutSeconds ?? 10) * 1000;
}

function remainingMs(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withPluginCoordinationLock<T>(
  config: FlashQueryConfig,
  input: { pluginId: string; pluginInstance: string },
  fn: () => Promise<T>
): Promise<T> {
  const lockKey = `plugin:${config.instance.id}:${input.pluginId}:${input.pluginInstance}`;
  const releaseTier1 = await pluginLockStripes[hashString(lockKey) % PLUGIN_LOCK_STRIPE_COUNT].acquire();

  try {
    if (!config.locking.enabled) {
      return await fn();
    }

    return await withPgClient(config.supabase.databaseUrl, async (client) => {
      const acquireDeadline = Date.now() + timeoutMs(config);
      const configuredTimeoutSeconds = config.locking.lockTimeoutSeconds ?? 10;
      let acquired = false;

      try {
        while (true) {
          if (remainingMs(acquireDeadline) <= 0) {
            throw new LockTimeoutError(lockKey, configuredTimeoutSeconds);
          }

          const result = await client.query<{ acquired: boolean }>(
            'SELECT pg_try_advisory_lock(hashtextextended($1, 0)::bigint) AS acquired',
            [lockKey]
          );
          if (result.rows[0]?.acquired === true) {
            acquired = true;
            break;
          }

          await sleep(Math.min(PLUGIN_TIER2_RETRY_DELAY_MS, remainingMs(acquireDeadline)));
        }

        return await fn();
      } finally {
        if (acquired) {
          await client.query(
            'SELECT pg_advisory_unlock(hashtextextended($1, 0)::bigint)',
            [lockKey]
          );
        }
      }
    });
  } finally {
    releaseTier1();
  }
}
