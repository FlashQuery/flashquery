import { Command } from 'commander';
import { supabaseManager, initSupabase } from '../../storage/supabase.js';
import { loadConfig, resolveConfigPath } from '../../config/loader.js';
import { initLogger } from '../../logging/logger.js';

export const unlockCommand = new Command('unlock')
  .description('Remove write locks from fqc_write_locks table (clears orphaned locks)')
  .option('--resource <type>', 'Resource type to unlock (e.g., memory, documents, records). Omit to clear all.')
  .option('--config <path>', 'Config file path')
  .action(async (opts: { resource?: string; config?: string }) => {
    const configPath = resolveConfigPath(opts.config);
    let config;
    try {
      config = loadConfig(configPath);
    } catch (err: unknown) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    try {
      initLogger(config);
      await initSupabase(config);
      const client = supabaseManager.getClient();

      let query = client.from('fqc_write_locks').delete();
      if (opts.resource) {
        query = query.eq('resource_type', opts.resource);
      } else {
        // Delete all rows — use gte on locked_at (always populated) as a row selector
        query = query.gte('locked_at', '1970-01-01T00:00:00Z');
      }

      const { error } = await query;

      if (error) {
        console.error(`Failed to clear locks: ${error.message}`);
        process.exit(1);
      }

      if (opts.resource) {
        console.log(`Cleared locks for resource: ${opts.resource}`);
      } else {
        console.log('Cleared all write locks');
      }
    } catch (err: unknown) {
      console.error(`unlock failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });
