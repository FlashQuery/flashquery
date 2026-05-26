import type { FlashQueryConfig } from '../config/loader.js';
import { withPgClient } from '../utils/pg-client.js';
import { Mutex } from 'async-mutex';

const PLUGIN_LOCK_STRIPE_COUNT = 256;
const pluginLockStripes = Array.from({ length: PLUGIN_LOCK_STRIPE_COUNT }, () => new Mutex());

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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
      await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0)::bigint)', [lockKey]);
      try {
        return await fn();
      } finally {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0)::bigint)', [lockKey]);
      }
    });
  } finally {
    releaseTier1();
  }
}
