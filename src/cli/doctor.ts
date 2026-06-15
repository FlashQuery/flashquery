import { accessSync, constants } from 'node:fs';
import pg from 'pg';
import { simpleGit } from 'simple-git';
import { loadConfig, resolveConfigPath, getDeprecationWarnings, getStartupWarnings } from '../config/loader.js';
import { initLogger } from '../logging/logger.js';
import type { FlashQueryConfig } from '../config/loader.js';
import { queryPgPool } from '../utils/pg-client.js';

// ─────────────────────────────────────────────────────────────────────────────
// CheckResult interface
// ─────────────────────────────────────────────────────────────────────────────

export interface CheckResult {
  name: string;
  passed: boolean;
  issue?: string;
  fix?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Check functions (each returns a CheckResult without throwing)
// ─────────────────────────────────────────────────────────────────────────────

async function checkSupabaseConnection(config: FlashQueryConfig): Promise<CheckResult> {
  try {
    const { initSupabase, supabaseManager } = await import('../storage/supabase.js');
    await initSupabase(config);
    const { error } = await supabaseManager.getClient().from('fqc_memory').select('id').limit(1);
    if (error) {
      return {
        name: 'Supabase connection',
        passed: false,
        issue: error.message,
        fix: 'Verify SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env or flashquery.yaml. Ensure Supabase is running.',
      };
    }
    return { name: 'Supabase connection', passed: true };
  } catch (err) {
    return {
      name: 'Supabase connection',
      passed: false,
      issue: err instanceof Error ? err.message : String(err),
      fix: 'Verify SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env or flashquery.yaml. Ensure Supabase is running.',
    };
  }
}

async function checkPgvector(config: FlashQueryConfig): Promise<CheckResult> {
  try {
    const { initSupabase, supabaseManager } = await import('../storage/supabase.js');
    await initSupabase(config);
    const { error } = await supabaseManager
      .getClient()
      .from('fqc_document_embeddings')
      .select('id')
      .limit(1);
    if (error) {
      return {
        name: 'pgvector extension',
        passed: false,
        issue: error.message,
        fix: 'Run CREATE EXTENSION IF NOT EXISTS vector; as the database superuser.',
      };
    }
    return { name: 'pgvector extension', passed: true };
  } catch (err) {
    return {
      name: 'pgvector extension',
      passed: false,
      issue: err instanceof Error ? err.message : String(err),
      fix: 'Run CREATE EXTENSION IF NOT EXISTS vector; as the database superuser.',
    };
  }
}

function checkVaultPath(config: FlashQueryConfig): CheckResult {
  try {
    accessSync(config.instance.vault.path, constants.W_OK);
    return { name: `Vault path writable: ${config.instance.vault.path}`, passed: true };
  } catch {
    return {
      name: 'Vault path writable',
      passed: false,
      issue: 'Directory does not exist or is not writable',
      fix: `Create the directory: mkdir -p ${config.instance.vault.path} — or update vault.path in flashquery.yaml`,
    };
  }
}

async function checkEmbeddingApiKey(config: FlashQueryConfig): Promise<CheckResult> {
  try {
    const { initEmbedding, embeddingProvider } = await import('../embedding/provider.js');
    initEmbedding(config);
    await embeddingProvider.embed('test');
    return { name: 'Embedding API key', passed: true };
  } catch (err) {
    const keyHint =
      config.embedding?.provider === 'openai' ? 'OPENAI_API_KEY' : 'the embedding API key';
    return {
      name: 'Embedding API key',
      passed: false,
      issue: err instanceof Error ? err.message : String(err),
      fix: `Set ${keyHint} in .env or configure the 'embedding' purpose in the llm: section of flashquery.yml`,
    };
  }
}

/**
 * Checks for legacy tables (fqc_event_log, fqc_routing_rules) that were removed in v1.7.
 * These tables are safe to drop — they were unused in v1.5/v1.6.
 * Returns a warning-style CheckResult (not a failure — they don't block operation).
 */
async function checkLegacyTables(config: FlashQueryConfig): Promise<CheckResult> {
  const LEGACY_TABLES = ['fqc_event_log', 'fqc_routing_rules'];
  const found: string[] = [];

  try {
    const { initSupabase, supabaseManager } = await import('../storage/supabase.js');
    await initSupabase(config);
    const client = supabaseManager.getClient();

    for (const table of LEGACY_TABLES) {
      // Check if the table exists by querying it — if it doesn't exist, Supabase returns an error
      const { error } = await client.from(table).select('id').limit(1);
      if (!error) {
        // Table exists (no error means it's accessible)
        found.push(table);
      }
      // If error (e.g., "relation does not exist"), table is gone — that's correct
    }

    if (found.length > 0) {
      return {
        name: 'Legacy schema tables',
        passed: false,
        issue: `Old tables found: ${found.join(', ')} — safe to remove`,
        fix: `Run: DROP TABLE IF EXISTS ${found.join(', ')}; (in Supabase SQL Editor)\n         Or upgrade note: these tables were unused in v1.5/v1.6 and removed in v1.7.`,
      };
    }

    return { name: 'Legacy schema tables', passed: true };
  } catch {
    // Connection error — skip this check gracefully
    return {
      name: 'Legacy schema tables',
      passed: true, // Don't fail on connection issues (already caught by checkSupabaseConnection)
    };
  }
}

export async function checkEmbeddingRetryGaps(config: FlashQueryConfig): Promise<CheckResult> {
  const databaseUrl = config.supabase.databaseUrl;
  if (!databaseUrl) {
    return {
      name: 'Embedding retry coverage',
      passed: true,
    };
  }

  try {
    const embeddingNames = await queryActiveEmbeddingNames(databaseUrl, config.instance.id);
    const documents = await queryDocumentEmbeddingGaps(databaseUrl, config.instance.id, embeddingNames);
    const memories = await queryMemoryEmbeddingGaps(databaseUrl, config.instance.id, embeddingNames);
    const records = await queryRecordEmbeddingGaps(databaseUrl, config.instance.id, embeddingNames);

    const total = documents.length + memories.length + records.length;
    if (total === 0) {
      return { name: 'Embedding retry coverage', passed: true };
    }

    return {
      name: 'Embedding retry coverage',
      passed: false,
      issue:
        `Untracked embedding gaps: documents=${documents.length} [${documents.join(', ')}]; ` +
        `memories=${memories.length} [${memories.join(', ')}]; ` +
        `records=${records.length} [${records.join(', ')}]`,
      fix: 'Run maintain_vault sync to retry pending embeddings, or inspect rows missing fqc_pending_embeds retry state.',
    };
  } catch (err) {
    return {
      name: 'Embedding retry coverage',
      passed: false,
      issue: err instanceof Error ? err.message : String(err),
      fix: 'Verify DATABASE_URL has access to fqc_chunks, fqc_documents, fqc_memory, plugin record tables, and fqc_pending_embeds.',
    };
  }
}

async function queryActiveEmbeddingNames(databaseUrl: string, instanceId: string): Promise<string[]> {
  const { rows } = await queryPgPool<{ name: string }>(
    databaseUrl,
    `
    SELECT name
    FROM fqc_embeddings
    WHERE instance_id = $1
      AND status = 'active'
    ORDER BY name
    `,
    [instanceId]
  );
  return rows.map((row) => row.name);
}

async function queryDocumentEmbeddingGaps(
  databaseUrl: string,
  instanceId: string,
  embeddingNames: string[]
): Promise<string[]> {
  if (embeddingNames.length === 0) {
    return [];
  }

  const gaps: string[] = [];
  for (const embeddingName of embeddingNames) {
    assertSafeEmbeddingName(embeddingName);
    const column = pg.escapeIdentifier(`embedding_${embeddingName}`);
    const { rows } = await queryPgPool<{ id: string }>(
      databaseUrl,
      `
      SELECT c.id::text AS id
      FROM fqc_chunks c
      JOIN fqc_documents d
        ON d.id = c.document_id
       AND d.instance_id = c.instance_id
      LEFT JOIN fqc_pending_embeds p
        ON p.instance_id = c.instance_id
       AND p.target_kind = 'document_chunk'
       AND p.target_table = 'fqc_chunks'
       AND p.target_id = c.id::text
       AND p.embedding_name = $2
       AND p.status = 'pending'
      WHERE c.instance_id = $1
        AND d.status = 'active'
        AND c.${column} IS NULL
        AND p.id IS NULL
      ORDER BY c.document_id, c.chunk_index, c.id
      LIMIT 20
      `,
      [instanceId, embeddingName]
    );
    gaps.push(...rows.map((row) => formatEmbeddingGapId(row.id, embeddingName, embeddingNames.length)));
  }
  return gaps;
}

async function queryMemoryEmbeddingGaps(
  databaseUrl: string,
  instanceId: string,
  embeddingNames: string[]
): Promise<string[]> {
  if (embeddingNames.length === 0) {
    return queryLegacyCoreEmbeddingGaps(databaseUrl, instanceId, 'fqc_memory', 'm', 'memory');
  }

  const gaps: string[] = [];
  for (const embeddingName of embeddingNames) {
    assertSafeEmbeddingName(embeddingName);
    const column = pg.escapeIdentifier(`embedding_${embeddingName}`);
    const { rows } = await queryPgPool<{ id: string }>(
      databaseUrl,
      `
      SELECT m.id::text AS id
      FROM fqc_memory m
      LEFT JOIN fqc_pending_embeds p
        ON p.instance_id = m.instance_id
       AND p.target_kind = 'memory'
       AND p.target_table = 'fqc_memory'
       AND p.target_id = m.id::text
       AND p.embedding_name = $2
       AND p.status = 'pending'
      WHERE m.instance_id = $1
        AND m.status = 'active'
        AND m.${column} IS NULL
        AND p.id IS NULL
      ORDER BY m.id
      LIMIT 20
      `,
      [instanceId, embeddingName]
    );
    gaps.push(...rows.map((row) => formatEmbeddingGapId(row.id, embeddingName, embeddingNames.length)));
  }
  return gaps;
}

async function queryLegacyCoreEmbeddingGaps(
  databaseUrl: string,
  instanceId: string,
  tableName: 'fqc_documents' | 'fqc_memory',
  alias: 'd' | 'm',
  kind: 'document' | 'memory'
): Promise<string[]> {
  const escapedTable = pg.escapeIdentifier(tableName);
  const { rows } = await queryPgPool<{ id: string }>(
    databaseUrl,
    `
    SELECT ${alias}.id::text AS id
    FROM ${escapedTable} ${alias}
    LEFT JOIN fqc_pending_embeds p
      ON p.instance_id = ${alias}.instance_id
     AND p.target_kind = $2
     AND p.target_table = $3
     AND p.target_id = ${alias}.id::text
     AND p.status = 'pending'
    WHERE ${alias}.instance_id = $1
      AND ${alias}.status = 'active'
      AND ${alias}.embedding IS NULL
      AND p.id IS NULL
    ORDER BY ${alias}.id
    LIMIT 20
    `,
    [instanceId, kind, tableName]
  );
  return rows.map((row) => row.id);
}

async function queryRecordEmbeddingGaps(
  databaseUrl: string,
  instanceId: string,
  embeddingNames: string[]
): Promise<string[]> {
  const tableResult = await queryPgPool<{ table_name: string; embedding_name: string; column_name: string }>(
    databaseUrl,
    embeddingNames.length === 0
      ? `
        SELECT table_name, 'legacy' AS embedding_name, 'embedding' AS column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name LIKE 'fqcp\\_%' ESCAPE '\\'
          AND column_name IN ('id', 'instance_id', 'status', 'embedding')
        GROUP BY table_name
        HAVING COUNT(DISTINCT column_name) = 4
        ORDER BY table_name
        `
      : `
        SELECT c.table_name,
               replace(c.column_name, 'embedding_', '') AS embedding_name,
               c.column_name
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name LIKE 'fqcp\\_%' ESCAPE '\\'
          AND c.column_name = ANY($1::text[])
          AND EXISTS (
            SELECT 1 FROM information_schema.columns id_col
            WHERE id_col.table_schema = 'public'
              AND id_col.table_name = c.table_name
              AND id_col.column_name = 'id'
          )
          AND EXISTS (
            SELECT 1 FROM information_schema.columns inst_col
            WHERE inst_col.table_schema = 'public'
              AND inst_col.table_name = c.table_name
              AND inst_col.column_name = 'instance_id'
          )
          AND EXISTS (
            SELECT 1 FROM information_schema.columns status_col
            WHERE status_col.table_schema = 'public'
              AND status_col.table_name = c.table_name
              AND status_col.column_name = 'status'
          )
        ORDER BY c.table_name, c.column_name
        `,
    embeddingNames.length === 0 ? [] : [embeddingNames.map((name) => `embedding_${name}`)]
  );

  const gaps: string[] = [];
  for (const { table_name: tableName, embedding_name: embeddingName, column_name: columnName } of tableResult.rows) {
    if (embeddingName !== 'legacy') {
      assertSafeEmbeddingName(embeddingName);
    }
    const escapedTable = pg.escapeIdentifier(tableName);
    const escapedColumn = pg.escapeIdentifier(columnName);
    const { rows } = await queryPgPool<{ id: string }>(
      databaseUrl,
      `
      SELECT t.id::text AS id
      FROM ${escapedTable} t
      LEFT JOIN fqc_pending_embeds p
        ON p.instance_id = t.instance_id
       AND p.target_kind = 'record'
       AND p.target_table = $2
       AND p.target_id = t.id::text
       AND p.embedding_name = $3
       AND p.status = 'pending'
      WHERE t.instance_id = $1
        AND t.status = 'active'
        AND t.${escapedColumn} IS NULL
        AND p.id IS NULL
      ORDER BY t.id
      LIMIT 20
      `,
      [instanceId, tableName, embeddingName]
    );
    gaps.push(...rows.map((row) => formatRecordEmbeddingGapId(tableName, row.id, embeddingName, embeddingNames.length)));
  }

  return gaps;
}

function formatEmbeddingGapId(id: string, embeddingName: string, activeCount: number): string {
  return activeCount > 1 ? `${embeddingName}:${id}` : id;
}

function formatRecordEmbeddingGapId(tableName: string, id: string, embeddingName: string, activeCount: number): string {
  if (embeddingName === 'legacy' || activeCount <= 1) {
    return `${tableName}:${id}`;
  }
  return `${tableName}:${embeddingName}:${id}`;
}

function assertSafeEmbeddingName(name: string): void {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid embedding name in diagnostic query: ${name}`);
  }
}

async function checkGitRepo(config: FlashQueryConfig): Promise<CheckResult> {
  try {
    const isRepo = await simpleGit(config.instance.vault.path).checkIsRepo();
    if (!isRepo) {
      return {
        name: 'Git repository',
        passed: false,
        issue: 'Vault directory is not a git repository',
        fix: `Run: cd ${config.instance.vault.path} && git init`,
      };
    }
    return { name: 'Git repository initialized', passed: true };
  } catch (err) {
    return {
      name: 'Git repository',
      passed: false,
      issue: err instanceof Error ? err.message : String(err),
      fix: `Run: cd ${config.instance.vault.path} && git init`,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// runDoctorCommand — exported for CLI and testing
// ─────────────────────────────────────────────────────────────────────────────

export async function runDoctorCommand(explicitConfigPath?: string): Promise<void> {
  // Output header to stderr
  process.stderr.write('\nfqc doctor — system health check\n\n');

  // Step 0: Resolve and load config
  let config: FlashQueryConfig;
  try {
    const configPath = resolveConfigPath(explicitConfigPath);
    config = loadConfig(configPath);
    initLogger(config);
    process.stderr.write(`  [PASS] Config loaded: ${configPath}\n`);
    // Show any deprecation warnings from config loading
    const deprecationWarnings = getDeprecationWarnings(config);
    for (const warning of deprecationWarnings) {
      process.stderr.write(`  [WARN] ${warning}\n`);
    }
    for (const warning of getStartupWarnings(config)) {
      process.stderr.write(`  [WARN] ${warning}\n`);
    }
  } catch (err) {
    process.stderr.write(`  [FAIL] Config file\n`);
    process.stderr.write(`         Issue: ${err instanceof Error ? err.message : String(err)}\n`);
    process.stderr.write(
      `         Fix:   Set FQC_HOME, place flashquery.yaml in cwd, or use --config <path>\n`
    );
    process.stderr.write(`\n1 check failed. Fix config first, then run fqc doctor again.\n`);
    process.exit(1);
    return; // process.exit() may be mocked in tests
  }

  // Run checks sequentially — order: DB/vault foundation before embedding/git
  const checks: Array<() => Promise<CheckResult>> = [
    () => checkSupabaseConnection(config),
    () => checkPgvector(config),
    () => checkLegacyTables(config),
    () => checkEmbeddingRetryGaps(config),
    () => Promise.resolve(checkVaultPath(config)),
    () => checkEmbeddingApiKey(config),
    () => checkGitRepo(config),
  ];

  let failCount = 0;
  for (const check of checks) {
    const result = await check();
    if (result.passed) {
      process.stderr.write(`  [PASS] ${result.name}\n`);
    } else {
      failCount++;
      process.stderr.write(`  [FAIL] ${result.name}\n`);
      if (result.issue) {
        process.stderr.write(`         Issue: ${result.issue}\n`);
      }
      if (result.fix) {
        process.stderr.write(`         Fix:   ${result.fix}\n`);
      }
    }
  }

  process.stderr.write('\n');
  if (failCount === 0) {
    process.stderr.write('All checks passed.\n');
    process.exit(0);
  } else {
    process.stderr.write(
      `${failCount} check(s) failed. Run fqc doctor after fixing the issues above.\n`
    );
    process.exit(1);
  }
}
