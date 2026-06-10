import pg from 'pg';
import { logger } from '../logging/logger.js';
import { getActiveEmbeddingDimensionDrift } from './schema-verify.js';

export interface RepairEmbeddingDimensionDriftOptions {
  instanceId: string;
  enabled: boolean;
}

const EMBEDDING_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function validateIdentifierPart(value: string): void {
  if (!EMBEDDING_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`Unsafe embedding repair identifier '${value}'`);
  }
}

export async function repairEmbeddingDimensionDrift(
  client: pg.Client,
  options: RepairEmbeddingDimensionDriftOptions
): Promise<number> {
  if (!options.enabled) {
    throw new Error('Embedding dimension repair refused: explicit test/dev repair gate is not enabled');
  }

  const drifts = await getActiveEmbeddingDimensionDrift(client, options.instanceId);
  for (const drift of drifts) {
    validateIdentifierPart(drift.entry);
    validateIdentifierPart(drift.table);
    validateIdentifierPart(drift.column);
    const indexName = `idx_${drift.table}_${drift.column}`;

    logger.warn(
      `Destructive embedding repair may cause data loss for entry ${drift.entry}: ` +
        `${drift.table}.${drift.column} will be recreated at vector(${drift.configuredWidth})`
    );

    await client.query('BEGIN');
    try {
      await client.query(`DROP INDEX IF EXISTS ${quoteIdentifier(indexName)}`);
      await client.query(`ALTER TABLE ${quoteIdentifier(drift.table)} DROP COLUMN ${quoteIdentifier(drift.column)}`);
      await client.query(
        `ALTER TABLE ${quoteIdentifier(drift.table)} ADD COLUMN ${quoteIdentifier(drift.column)} vector(${drift.configuredWidth})`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(indexName)}
         ON ${quoteIdentifier(drift.table)} USING hnsw (${quoteIdentifier(drift.column)} vector_cosine_ops)`
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  return drifts.length;
}
