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

async function acquireTier1StripeWithTimeout(
  stripeIndex: number,
  lockKey: string,
  deadline: number,
  timeoutSeconds: number
): Promise<() => void> {
  let timeout: NodeJS.Timeout | undefined;
  let acquired = false;
  const acquire = pluginLockStripes[stripeIndex].acquire();
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new LockTimeoutError(lockKey, timeoutSeconds)),
      remainingMs(deadline)
    );
    timeout.unref?.();
  });

  try {
    const release = await Promise.race([acquire, timeoutPromise]);
    acquired = true;
    return release;
  } finally {
    if (timeout) clearTimeout(timeout);
    if (!acquired) {
      acquire.then((release) => release()).catch(() => undefined);
    }
  }
}

export async function withPluginCoordinationLock<T>(
  config: FlashQueryConfig,
  input: { pluginId: string; pluginInstance: string },
  fn: () => Promise<T>
): Promise<T> {
  const lockKey = `plugin:${config.instance.id}:${input.pluginId}:${input.pluginInstance}`;
  const configuredTimeoutSeconds = config.locking.lockTimeoutSeconds ?? 10;
  const acquireDeadline = Date.now() + timeoutMs(config);
  const releaseTier1 = await acquireTier1StripeWithTimeout(
    hashString(lockKey) % PLUGIN_LOCK_STRIPE_COUNT,
    lockKey,
    acquireDeadline,
    configuredTimeoutSeconds
  );

  try {
    if (!config.locking.enabled) {
      return await fn();
    }

    return await withPgClient(
      config.supabase.databaseUrl,
      async (client) => {
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
      },
      {
        connectTimeoutMs: remainingMs(acquireDeadline),
        timeoutError: new LockTimeoutError(lockKey, configuredTimeoutSeconds),
      }
    );
  } finally {
    releaseTier1();
  }
}
