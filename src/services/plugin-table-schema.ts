import pg from 'pg';
import { logger } from '../logging/logger.js';

const verifiedTables = new Set<string>();

// Shared low-level schema helper used by propagation and reconciliation.
// Keeping it here avoids coupling those higher-level services to each other.
export async function ensureLastSeenColumn(tableName: string, pgClient: pg.Client): Promise<void> {
  if (verifiedTables.has(tableName)) return;
  const { rows } = await pgClient.query<{ exists: number }>(
    `SELECT 1 AS exists FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'last_seen_updated_at'`,
    [tableName],
  );
  if (rows.length === 0) {
    await pgClient.query(
      `ALTER TABLE ${pg.escapeIdentifier(tableName)} ADD COLUMN IF NOT EXISTS last_seen_updated_at TIMESTAMPTZ`,
    );
    logger?.debug(`[RECON-08] Added last_seen_updated_at column to ${tableName}`);
  }
  verifiedTables.add(tableName);
}
