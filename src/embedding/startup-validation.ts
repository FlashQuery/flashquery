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
  const hasEmbeddingsCatalog = (config.embeddings?.length ?? 0) > 0;
  const hasLegacyEmbeddingPurpose =
    config.llm?.purposes?.some((purpose) => purpose.name === 'embedding') === true;
  if (!hasEmbeddingsCatalog && !hasLegacyEmbeddingPurpose) return;

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
    if (hasLegacyEmbeddingPurpose) {
      await refusePopulatedLegacyEmbeddingColumns(client);
      if (!hasEmbeddingsCatalog) return;
    }

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

async function refusePopulatedLegacyEmbeddingColumns(
  client: Awaited<ReturnType<typeof createPgClientIPv4>>
): Promise<void> {
  const columns = await client.query<{ table_name: string }>(
    `
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('fqc_documents', 'fqc_memory')
      AND column_name = 'embedding'
    ORDER BY table_name
    `
  );

  const populated: Array<{ table_name: string; row_count: string }> = [];
  for (const row of columns.rows) {
    const count = await client.query<{ row_count: string }>(
      `SELECT count(*)::text AS row_count FROM ${row.table_name} WHERE embedding IS NOT NULL`
    );
    const rowCount = count.rows[0]?.row_count ?? '0';
    if (Number(rowCount) > 0) {
      populated.push({ table_name: row.table_name, row_count: rowCount });
    }
  }

  if (populated.length === 0) return;

  const affected = populated
    .map((row) => `${row.table_name}.embedding (${row.row_count} row${row.row_count === '1' ? '' : 's'})`)
    .join(', ');
  throw new Error(
    `Legacy embedding schema reset required before startup. ` +
      `The LLM embedding purpose is configured while populated legacy vector data remains in ${affected}. ` +
      `Drop or migrate the singular legacy embedding columns, then restart with the embeddings catalog and run maintain_vault backfill_embeddings.`
  );
}
