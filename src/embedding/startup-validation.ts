import type { FlashQueryConfig } from '../config/types.js';
import { logger } from '../logging/logger.js';
import { verifySchema } from '../storage/schema-verify.js';
import { repairEmbeddingDimensionDrift } from '../storage/test-dev-repair.js';
import { createPgClientIPv4 } from '../utils/pg-client.js';

function isDestructiveEmbeddingRepairEnabled(): boolean {
  const value = process.env.FQ_EMBEDDING_REPAIR?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

export async function verifyStartupEmbeddingCatalog(config: FlashQueryConfig): Promise<void> {
  if (!config.embeddings || config.embeddings.length === 0) return;

  const databaseUrl = config.supabase.databaseUrl?.trim();
  if (!databaseUrl) {
    if (isDestructiveEmbeddingRepairEnabled()) {
      logger.warn(
        'Skipping FQ_EMBEDDING_REPAIR because embedding catalog startup validation needs supabase.database_url for direct pg access'
      );
    } else {
      logger.info(
        'Skipping embedding catalog dimension drift validation because supabase.database_url is not configured'
      );
    }
    return;
  }

  const client = createPgClientIPv4(databaseUrl);
  await client.connect();
  try {
    const repairEnabled = isDestructiveEmbeddingRepairEnabled();
    if (repairEnabled) {
      const repaired = await repairEmbeddingDimensionDrift(client, {
        instanceId: config.instance.id,
        enabled: true,
      });
      if (repaired > 0) {
        logger.warn(
          `Embedding catalog startup validation repaired ${repaired} drifted column(s) because FQ_EMBEDDING_REPAIR is enabled`
        );
      }
    }

    await verifySchema(client, { instanceId: config.instance.id });
  } finally {
    await client.end();
  }
}
