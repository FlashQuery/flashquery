import type { FlashQueryConfig } from '../config/loader.js';
import { withPgClient } from '../utils/pg-client.js';

export async function withPluginCoordinationLock<T>(
  config: FlashQueryConfig,
  input: { pluginId: string; pluginInstance: string },
  fn: () => Promise<T>
): Promise<T> {
  const lockKey = `plugin:${config.instance.id}:${input.pluginId}:${input.pluginInstance}`;

  return withPgClient(config.supabase.databaseUrl, async (client) => {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0)::bigint)', [lockKey]);
    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0)::bigint)', [lockKey]);
    }
  });
}
