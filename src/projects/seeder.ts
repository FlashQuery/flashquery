import pg from 'pg';
import { logger } from '../logging/logger.js';
import { supabaseManager } from '../storage/supabase.js';
import type { FlashQueryConfig } from '../config/loader.js';
import { createPgClientIPv4 } from '../utils/pg-client.js';

export async function initProjects(config: FlashQueryConfig): Promise<void> {
  // v1.7+: projects configuration removed from config
  // Silently skip if not configured (projects can be created via API/plugin system)
  const projects = (config as unknown as { projects?: unknown }).projects;
  if (!projects || typeof projects !== 'object' || !('areas' in projects)) {
    logger.info('Projects: no projects configured, skipping seed');
    return;
  }

  const rows = (projects as { areas: Array<{ name: string; projects?: Array<{ name: string; description?: string }> }> }).areas.flatMap((area) =>
    (area.projects ?? []).map((project) => ({
      instance_id: config.instance.id,
      area: area.name,
      name: project.name,
      description: project.description ?? null,
    }))
  );

  if (rows.length === 0) {
    logger.info('Projects: no projects configured, skipping seed');
    return;
  }

  if (config.supabase.skipDdl) {
    // skip_ddl mode: use supabase-js REST upsert instead of direct pg
    const supabase = supabaseManager.getClient();
    for (const row of rows) {
      const { error } = await supabase
        .from('fqc_projects')
        .upsert(row, { onConflict: 'instance_id,area,name', ignoreDuplicates: true });
      if (error) {
        logger.warn(`Projects: upsert failed for ${row.area}/${row.name}: ${error.message}`);
      }
    }
    logger.info(`Projects: seeded ${rows.length} project(s) from config`);
    return;
  }

  // Default: use pg directly — bypasses Kong for reliability during initial setup
  const pgClient = createPgClientIPv4(config.supabase.databaseUrl);
  try {
    await pgClient.connect();

    for (const row of rows) {
      await pgClient.query(
        `INSERT INTO fqc_projects (instance_id, area, name, description)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (instance_id, area, name) DO NOTHING`,
        [row.instance_id, row.area, row.name, row.description]
      );
    }

    logger.info(`Projects: seeded ${rows.length} project(s) from config`);
  } finally {
    await pgClient.end();
  }
}
