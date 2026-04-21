import http from 'node:http';
import https from 'node:https';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import { logger } from '../logging/logger.js';
import type { FlashQueryConfig } from '../config/loader.js';
import { verifySchema } from './schema-verify.js';
import { createPgClientIPv4 } from '../utils/pg-client.js';

// ─────────────────────────────────────────────────────────────────────────────
// macOS 15+ (Sequoia/Tahoe) Local Network Privacy
//
// macOS 15 introduced iOS-style Local Network Privacy for desktop apps.
// When Node.js is spawned as a subprocess of an Electron app (e.g. Claude
// desktop), ALL outbound BSD socket TCP connections to LAN hosts (192.168.x.x,
// 10.x.x.x, etc.) fail with EHOSTUNREACH if the parent Electron app does not
// have Local Network permission granted in System Settings.
//
// This affects:
//   - pg.Client / net.Socket (raw TCP)
//   - node:http / node:https (http.request — still BSD sockets underneath)
//   - undici / Node built-in fetch (also BSD sockets)
//
// macOS does NOT show a permission dialog for BSD socket connections — only
// for apps using Apple's Network.framework (which Node.js does not use).
//
// FIX (user action required):
//   System Settings → Privacy & Security → Local Network → enable Claude
//
// If Claude does not appear in that list:
//   1. Quit Claude desktop completely
//   2. Run in Terminal:  open -a Claude
//   3. The first connection attempt should trigger the permission dialog
//   4. If no dialog appears, check System Settings — it may have been silently added
//
// macOS 26 (Tahoe) KNOWN BUG: After a system reboot, Local Network permissions
// may appear ON in System Settings but be ineffective at the kernel level.
// If the toggle is already ON and connections still fail after a reboot:
//   1. System Settings → Privacy & Security → Local Network
//   2. Toggle Claude to OFF
//   3. Toggle Claude back to ON
//   4. Relaunch Claude desktop (do NOT reboot — that resets the kernel state again)
//
// Architecture note: pg was removed from the startup path in favour of HTTP
// POSTs to the postgres-meta service ({supabaseUrl}/pg/query). This is cleaner
// regardless of the macOS permission issue, but does NOT bypass it — both TCP
// and node:http use BSD sockets and are equally subject to Local Network privacy.
// ─────────────────────────────────────────────────────────────────────────────

const RETRYABLE_CODES = new Set([
  'EHOSTUNREACH',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ECONNRESET',
  'ENETUNREACH',
]);
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

function nodeFetch(input: string, init?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const url = new URL(input);
    const requester = url.protocol === 'https:' ? https : http;
    const body = init?.body as string | Buffer | undefined;
    // Normalize headers — supabase-js may pass a Headers instance (not a plain object)
    let headers: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((value: string, key: string) => {
          headers[key] = value;
        });
      } else if (Array.isArray(init.headers)) {
        for (const [key, value] of init.headers as string[][]) {
          headers[key] = value;
        }
      } else {
        headers = { ...init.headers };
      }
    }

    const req = requester.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: init?.method ?? 'GET',
        headers,
        family: 4, // Force IPv4 to avoid IPv6 timeout on Linux systems with broken IPv6
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          const status = res.statusCode ?? 200;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: res.statusMessage ?? '',
            headers: new Headers(res.headers as Record<string, string>),
            text: () => Promise.resolve(text),
            json: () => Promise.resolve(JSON.parse(text) as unknown),
          } as Response);
        });
        res.on('error', reject);
      }
    );

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function isRetryable(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  if (code && RETRYABLE_CODES.has(code)) return true;
  const cause = (err as { cause?: unknown }).cause;
  if (cause) return isRetryable(cause);
  return false;
}

async function fetchWithRetry(input: string, init?: RequestInit): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await nodeFetch(input, init);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === MAX_RETRIES) break;
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn(
        `Supabase fetch attempt ${attempt} failed (${errMsg}), retrying in ${RETRY_DELAY_MS}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  throw lastErr;
}

/**
 * Executes raw SQL against Supabase's postgres-meta service via HTTP.
 *
 * Uses node:http (nodeFetch) instead of a pg TCP socket — this avoids the
 * Electron/Chromium networking issue where all TCP connections to LAN hosts
 * fail with EHOSTUNREACH from MCP subprocesses (see comment at top of file).
 *
 * The postgres-meta service is available at {supabaseUrl}/pg/query and accepts
 * a JSON body { query: string }.  Authentication uses the service_role key.
 *
 * When databaseUrl is provided (cloud Supabase or local with direct pg access),
 * uses a direct pg connection instead — the /pg/query endpoint only exists on
 * local Supabase (postgres-meta) and is not available on Supabase cloud.
 */
async function ddlQuery(
  supabaseUrl: string,
  serviceRoleKey: string,
  sql: string,
  databaseUrl?: string
): Promise<void> {
  if (databaseUrl) {
    logger.debug('[ddlQuery] Using Path A: direct PostgreSQL connection (databaseUrl provided)');
    logger.debug(`[ddlQuery] Creating pg.Client with connectionString: ${maskConnectionUrl(databaseUrl)}`);
    try {
      const client = createPgClientIPv4(databaseUrl);
      logger.debug('[ddlQuery] pg.Client created, attempting to connect...');
      await client.connect();
      logger.debug('[ddlQuery] Connected to PostgreSQL, executing query...');
      try {
        await client.query(sql);
        logger.debug('[ddlQuery] Query executed successfully');
      } finally {
        logger.debug('[ddlQuery] Closing PostgreSQL connection...');
        await client.end();
        logger.debug('[ddlQuery] PostgreSQL connection closed');
      }
      return;
    } catch (err) {
      logger.error(`[ddlQuery] Path A failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }
  logger.debug('[ddlQuery] Using Path B: HTTP /pg/query endpoint (no databaseUrl)');
  const queryUrl = `${supabaseUrl.replace(/\/$/, '')}/pg/query`;
  logger.debug(`[ddlQuery] Making HTTP POST to ${queryUrl}`);
  const response = await fetchWithRetry(queryUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ query: sql }),
  });
  logger.debug(`[ddlQuery] HTTP response status: ${response.status}`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`DDL query failed (HTTP ${response.status}): ${body}`);
  }
  logger.debug('[ddlQuery] HTTP /pg/query succeeded');
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility functions (exported for unit testing)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifies schema accessibility via supabase-js REST API with exponential backoff.
 * Used when databaseUrl is unavailable (postgres-meta HTTP endpoint case).
 * Attempts to SELECT from fqc_documents with retries to account for PostgREST
 * schema cache reload latency.
 *
 * @param client - Temporary supabase-js client for verification only
 * @param maxWaitMs - Maximum time to spend retrying (default 5000ms)
 * @returns Resolves when all tables are accessible via REST API
 * @throws Error if tables remain inaccessible after maxWaitMs
 */
async function verifySchemaViaRestApi(
  client: SupabaseClient,
  maxWaitMs: number = 5000
): Promise<void> {
  const startTime = Date.now();
  let lastError: Error | null = null;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      // Attempt a simple SELECT from fqc_documents to verify table accessibility
      // This forces PostgREST to check its schema cache
      const { error } = await client.from('fqc_documents').select('id').limit(1);
      if (!error) {
        // Table is accessible; schema verification successful
        return;
      }
      lastError = new Error(error.message);
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }

    // Exponential backoff: 100ms, 200ms, 400ms, 800ms, 1600ms
    const elapsedMs = Date.now() - startTime;
    const nextRetryDelay = Math.min(100 * Math.pow(2, Math.floor(elapsedMs / 400)), 1600);
    await new Promise((resolve) => setTimeout(resolve, nextRetryDelay));
  }

  // Timed out waiting for tables
  throw new Error(
    `Schema verification timeout (${maxWaitMs}ms): tables still inaccessible via REST API. ` +
      `Last error: ${lastError?.message ?? 'unknown'}`
  );
}

/**
 * Masks credentials in a postgresql:// connection URL.
 * Replaces user:password with ***:*** while preserving host/port/database.
 */
export function maskConnectionUrl(url: string): string {
  return url.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
}

/**
 * Builds the full schema DDL SQL string with dynamic vector dimensions.
 * All DDL uses IF NOT EXISTS / CREATE OR REPLACE for idempotency.
 */
export function buildSchemaDDL(dimensions: number): string {
  return `
-- Step 1: Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Step 2: Create base tables

CREATE TABLE IF NOT EXISTS fqc_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  plugin_scope TEXT DEFAULT 'global',
  status TEXT DEFAULT 'active',
  version INTEGER DEFAULT 1,
  previous_version_id UUID,
  embedding vector(${dimensions}),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Phase 23: Hard-delete unused columns from existing databases (v1.7 pre-release)
ALTER TABLE IF EXISTS fqc_memory DROP COLUMN IF EXISTS user_id;
ALTER TABLE IF EXISTS fqc_memory DROP COLUMN IF EXISTS category;
ALTER TABLE IF EXISTS fqc_memory DROP COLUMN IF EXISTS source_context;

-- Phase 31: project column removal (PROJ-04)
ALTER TABLE IF EXISTS fqc_documents DROP COLUMN IF EXISTS project;
ALTER TABLE IF EXISTS fqc_memory DROP COLUMN IF EXISTS project;

-- CLEAN-01: fqc_projects table removed in v1.7
-- Projects configuration replaced by path-based location + tag-based categorization.

CREATE TABLE IF NOT EXISTS fqc_vault (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fqc_plugin_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  plugin_instance TEXT,
  project_scope TEXT,
  schema_version TEXT DEFAULT '1.0.0',
  schema_yaml TEXT,
  table_prefix TEXT,
  vault_path TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- fqc_documents must exist before fqc_pending_plugin_review (FK dependency)
CREATE TABLE IF NOT EXISTS fqc_documents (
  id UUID PRIMARY KEY,
  instance_id TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  content_hash TEXT,
  status TEXT DEFAULT 'active',
  embedding vector(${dimensions}),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Phase 32: description column for batch outline metadata (MOD-03 §3c, OUTLINE-05)
ALTER TABLE IF EXISTS fqc_documents ADD COLUMN IF NOT EXISTS description TEXT DEFAULT NULL;

-- Phase 39: needs_frontmatter_repair flag for TSA-01 (read-only background scan)
ALTER TABLE IF EXISTS fqc_documents ADD COLUMN IF NOT EXISTS needs_frontmatter_repair BOOLEAN DEFAULT FALSE;

-- Phase 88: Remove push-notification infrastructure (LEGACY-07)
DROP TABLE IF EXISTS fqc_change_queue;
ALTER TABLE IF EXISTS fqc_documents DROP COLUMN IF EXISTS watcher_claims;
ALTER TABLE IF EXISTS fqc_documents DROP COLUMN IF EXISTS needs_discovery;
ALTER TABLE IF EXISTS fqc_documents DROP COLUMN IF EXISTS discovery_status;

-- Phase 54 (Scanner Enhancement): Plugin ownership tracking (per DISC-04, PERF-02)
ALTER TABLE IF EXISTS fqc_documents ADD COLUMN IF NOT EXISTS ownership_plugin_id TEXT DEFAULT NULL;
ALTER TABLE IF EXISTS fqc_documents ADD COLUMN IF NOT EXISTS ownership_type TEXT DEFAULT NULL;

-- Phase 86: Pending plugin review queue (RECTOOLS-01)
CREATE TABLE IF NOT EXISTS fqc_pending_plugin_review (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fqc_id UUID NOT NULL REFERENCES fqc_documents(id) ON DELETE CASCADE,
    plugin_id TEXT NOT NULL,
    instance_id TEXT NOT NULL DEFAULT 'default',
    table_name TEXT NOT NULL,
    review_type TEXT NOT NULL,
    context JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_review_plugin
  ON fqc_pending_plugin_review(plugin_id, instance_id);

CREATE INDEX IF NOT EXISTS idx_pending_review_fqc_id
  ON fqc_pending_plugin_review(fqc_id);

-- Phase 31: plugin_instance rename (PLUGIN-02)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='fqc_plugin_registry' AND column_name='instance_name'
  ) THEN
    ALTER TABLE IF EXISTS fqc_plugin_registry RENAME COLUMN instance_name TO plugin_instance;
  END IF;
END$$;

-- Phase 40: schema_version type change from INTEGER to TEXT (PLUGIN-04)
-- Support semantic versioning like "0.1.0" instead of integer version numbers
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='fqc_plugin_registry' AND column_name='schema_version'
      AND data_type='integer'
  ) THEN
    -- Create temporary TEXT column, migrate data, drop old column, rename new to original
    ALTER TABLE IF EXISTS fqc_plugin_registry ADD COLUMN schema_version_temp TEXT;
    UPDATE fqc_plugin_registry SET schema_version_temp = schema_version::TEXT;
    ALTER TABLE IF EXISTS fqc_plugin_registry DROP COLUMN schema_version;
    ALTER TABLE IF EXISTS fqc_plugin_registry RENAME COLUMN schema_version_temp TO schema_version;
    ALTER TABLE IF EXISTS fqc_plugin_registry ALTER COLUMN schema_version SET DEFAULT '1.0.0';
  END IF;
END$$;

-- CLEAN-01, CLEAN-02: fqc_event_log and fqc_routing_rules removed in v1.7
-- These tables were unused in v1.5/v1.6. If upgrading, run:
--   flashquery doctor (warns about old tables)
-- Or drop them manually: DROP TABLE IF EXISTS fqc_event_log, fqc_routing_rules;

-- Phase 24: Distributed write locks (LOCK-02)
CREATE TABLE IF NOT EXISTS fqc_write_locks (
  instance_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (instance_id, resource_type)
);

CREATE INDEX IF NOT EXISTS idx_fqc_write_locks_expires ON fqc_write_locks (expires_at);


-- Step 3: Create indexes

CREATE INDEX IF NOT EXISTS idx_fqc_memory_embedding ON fqc_memory USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_fqc_memory_tags ON fqc_memory USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_fqc_memory_status ON fqc_memory (status);
CREATE INDEX IF NOT EXISTS idx_fqc_vault_instance ON fqc_vault (instance_id);
CREATE INDEX IF NOT EXISTS idx_fqc_documents_embedding ON fqc_documents USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_fqc_documents_instance ON fqc_documents (instance_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fqc_documents_instance_path ON fqc_documents (instance_id, path);
CREATE INDEX IF NOT EXISTS idx_fqc_documents_status ON fqc_documents (status);
CREATE INDEX IF NOT EXISTS idx_fqc_documents_tags ON fqc_documents USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_fqc_documents_ownership ON fqc_documents(ownership_plugin_id, ownership_type);


-- Step 4: Create match_memories RPC function

-- Drop old function signature if it exists (Phase 33 added tag_match support)
-- Old 6-param signature: embedding, threshold, count, project(removed), tags, instance_id
-- New 6-param signature: embedding, threshold, count, tags, tag_match(new), instance_id
-- PostgreSQL 42P13 blocks CREATE OR REPLACE when RETURNS TABLE differs, so we drop first.
DROP FUNCTION IF EXISTS match_memories(vector, double precision, integer, text, text[], text) CASCADE;

CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(${dimensions}),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10,
  filter_tags text[] DEFAULT NULL,
  filter_tag_match text DEFAULT 'any',
  filter_instance_id text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  content text,
  tags text[],
  plugin_scope text,
  similarity float,
  created_at timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.content,
    m.tags,
    m.plugin_scope,
    1 - (m.embedding <=> query_embedding) AS similarity,
    m.created_at
  FROM fqc_memory m
  WHERE m.status = 'active'
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
    AND (filter_tags IS NULL OR
      CASE WHEN filter_tag_match = 'all'
        THEN m.tags @> filter_tags
        ELSE m.tags && filter_tags
      END
    )
    AND (filter_instance_id IS NULL OR m.instance_id = filter_instance_id)
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Step 5: Create match_documents RPC function

-- Drop old function signatures with incompatible parameters (Phase 33 added filter_tags, filter_tag_match)
-- Old signature: (vector, float, int, text) — 4 params, no tag filtering
-- New signature: (vector, float, int, text, text[], text) — adds filter_tags and filter_tag_match
DROP FUNCTION IF EXISTS match_documents(vector, double precision, integer, text) CASCADE;

CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(${dimensions}),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10,
  filter_instance_id text DEFAULT NULL,
  filter_tags text[] DEFAULT NULL,
  filter_tag_match text DEFAULT 'any'
)
RETURNS TABLE (
  id uuid,
  path text,
  title text,
  tags text[],
  similarity float,
  created_at timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.path,
    d.title,
    d.tags,
    1 - (d.embedding <=> query_embedding) AS similarity,
    d.created_at
  FROM fqc_documents d
  WHERE d.status = 'active'
    AND d.embedding IS NOT NULL
    AND 1 - (d.embedding <=> query_embedding) > match_threshold
    AND (filter_instance_id IS NULL OR d.instance_id = filter_instance_id)
    AND (filter_tags IS NULL OR
      CASE WHEN filter_tag_match = 'all'
        THEN d.tags @> filter_tags
        ELSE d.tags && filter_tags
      END
    )
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Step 6: Create find_plugin_scope RPC function (pg_trgm fuzzy matching)

CREATE OR REPLACE FUNCTION find_plugin_scope(
  search_name text,
  p_instance_id text,
  threshold float DEFAULT 0.8
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  matched_id text;
BEGIN
  SELECT plugin_id INTO matched_id
  FROM fqc_plugin_registry
  WHERE instance_id = p_instance_id
    AND status = 'active'
    AND similarity(plugin_id, search_name) > threshold
  ORDER BY similarity(plugin_id, search_name) DESC
  LIMIT 1;

  RETURN COALESCE(matched_id, 'global');
END;
$$;

-- Step 7: Grant PostgREST roles access to public schema objects.
-- Required when running against a plain Postgres container (e.g. Docker dev
-- stack) where Supabase's automatic grants are not present.
GRANT USAGE ON SCHEMA public TO service_role, authenticated, anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role, authenticated, anon;
-- Ensure future tables (e.g. dynamically created plugin tables) also get grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Database migration utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Drops the unused `description` column from the `fqc_documents` table.
 * This is a one-time migration function — it does not use DROP IF EXISTS
 * (not available for columns in PostgreSQL < 14), so it assumes one execution
 * during deployment.
 *
 * @param supabaseUrl - Supabase instance URL
 * @param serviceRoleKey - Service role API key for authentication
 * @param databaseUrl - Optional direct PostgreSQL connection URL (preferred over HTTP)
 * @throws Error if DDL execution fails
 */
export async function dropDescriptionColumn(
  supabaseUrl: string,
  serviceRoleKey: string,
  databaseUrl?: string
): Promise<void> {
  const sql = 'ALTER TABLE fqc_documents DROP COLUMN description;';
  logger.info('Dropping description column from fqc_documents...');
  try {
    await ddlQuery(supabaseUrl, serviceRoleKey, sql, databaseUrl);
    logger.info('Dropped description column from fqc_documents');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to drop description column: ${msg}`);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SupabaseManager interface
// ─────────────────────────────────────────────────────────────────────────────

export interface SupabaseManager {
  /** Called during startup — runs DDL via postgres-meta HTTP, initializes supabase-js client. */
  initialize(config: FlashQueryConfig): Promise<void>;
  /** Returns the supabase-js client for runtime data operations. */
  getClient(): SupabaseClient;
  /** Cleanup. */
  close(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// SupabaseManagerImpl (internal)
// ─────────────────────────────────────────────────────────────────────────────

class SupabaseManagerImpl implements SupabaseManager {
  private client: SupabaseClient | null = null;

  async initialize(config: FlashQueryConfig): Promise<void> {
    const { url: supabaseUrl, serviceRoleKey, skipDdl, databaseUrl } = config.supabase;
    const { dimensions } = config.embedding;

    const hostname = new URL(supabaseUrl).hostname;
    logger.debug(`Supabase: connecting to ${hostname}...`);

    if (skipDdl) {
      logger.info('Supabase: skipping DDL (skip_ddl: true)');

      // Defensive check: warn if tables are missing
      if (databaseUrl) {
        try {
          const verifyClient = createPgClientIPv4(databaseUrl);
          await verifyClient.connect();
          try {
            await verifySchema(verifyClient);
            logger.debug('Schema verification: all tables present (skip_ddl: true)');
          } finally {
            await verifyClient.end();
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn(
            `Schema verification failed with skip_ddl: true — tables may be missing: ${message}`
          );
          // Don't throw — warn and proceed. User is responsible if they set skip_ddl: true.
        }
      }
    } else {
      // Run DDL via direct pg connection when databaseUrl is available (cloud Supabase
      // or local with direct pg access). Falls back to postgres-meta HTTP endpoint
      // ({supabaseUrl}/pg/query) for local Supabase without databaseUrl — that endpoint
      // avoids Electron/Chromium TCP issues in MCP subprocesses on macOS (see top of file).
      logger.debug('Base schema: checking tables...');
      try {
        await ddlQuery(supabaseUrl, serviceRoleKey, buildSchemaDDL(dimensions), databaseUrl);
        // Notify PostgREST to reload its schema cache so newly created tables
        // are immediately accessible via the REST API.
        await ddlQuery(supabaseUrl, serviceRoleKey, `SELECT pg_notify('pgrst', 'reload schema')`, databaseUrl);
        // Brief wait for PostgREST to process the async schema reload notification.
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Verify that all required tables were actually created after DDL execution
        if (databaseUrl) {
          const verifyClient = createPgClientIPv4(databaseUrl);
          await verifyClient.connect();
          try {
            await verifySchema(verifyClient);
          } finally {
            await verifyClient.end();
          }
        } else {
          // Using postgres-meta HTTP endpoint — verify via REST API with retries (D-POST-01)
          // PostgREST schema cache reload is async; wait for tables to become accessible
          // before returning from initialize(). This ensures initPlugins doesn't fail.
          logger.debug('Verifying schema via REST API (postgres-meta HTTP endpoint in use)...');
          // Create temporary client for verification (will be replaced below)
          const tempVerifyClient = createClient(supabaseUrl, serviceRoleKey, {
            global: { fetch: fetchWithRetry as typeof globalThis.fetch },
          });
          try {
            await verifySchemaViaRestApi(tempVerifyClient);
          } finally {
            // Temporary client is closed implicitly; no explicit close needed in supabase-js v2
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);

        // Check if this is a schema verification failure (different error context)
        if (message.includes('Missing required tables')) {
          logger.error('Schema verification failed after DDL succeeded');
          logger.error(`  Error: ${message}`);
          logger.error('  This indicates tables were not created despite DDL running.');
          logger.error('  Possible causes:');
          logger.error('    (1) Permission issue — service_role_key lacks CREATE TABLE privilege');
          logger.error('    (2) Partial DDL failure — schema is incomplete');
          logger.error('    (3) DDL transaction rolled back by database');
          logger.error('  Check:');
          logger.error('    (1) Verify service_role_key has admin role in Supabase dashboard');
          logger.error('    (2) Review database logs for DDL errors');
          logger.error('    (3) If using local Supabase, ensure postgre is running');
        } else if (message.includes('Schema verification timeout')) {
          logger.error('Schema verification timeout via REST API');
          logger.error(`  Error: ${message}`);
          logger.error('  This indicates PostgREST did not reload its schema cache after DDL.');
          logger.error('  Possible causes:');
          logger.error('    (1) PostgREST service is stuck or slow');
          logger.error('    (2) Database is under heavy load');
          logger.error('    (3) Network connectivity issue between Supabase services');
          logger.error('  Check:');
          logger.error('    (1) Is the Supabase instance running smoothly? Check CPU/memory');
          logger.error('    (2) Try again — transient load issues sometimes cause this');
          logger.error('    (3) If persistent, consider setting `database_url` for direct pg verification');
        } else {
          logger.error('Supabase DDL failed');
          logger.error(`  URL: ${supabaseUrl}/pg/query`);
          logger.error(`  Error: ${message}`);
          logger.error('  Check:');
          logger.error('    (1) Is Supabase running? Run `supabase start` for local.');
          logger.error('    (2) Is `url` correct in your config?');
          logger.error(
            '    (3) macOS 15+ (Sequoia/Tahoe): if running via Claude desktop, grant Local Network'
          );
          logger.error(
            '        permission — System Settings → Privacy & Security → Local Network → enable Claude.'
          );
          logger.error(
            '        If Claude is not listed, quit and reopen it to trigger the permission prompt.'
          );
          logger.error(
            '        macOS 26 (Tahoe) bug: if toggle is already ON but still failing after a reboot,'
          );
          logger.error(
            '        toggle Claude OFF then back ON in System Settings, then relaunch Claude (do NOT reboot).'
          );
          logger.error('    (4) Can this machine reach the Supabase host from Terminal?');
          logger.error('        Run: curl -s http://<supabase-url>/health');
          logger.error(
            '    (5) If schema already exists, set `skip_ddl: true` under `supabase:` in your config.'
          );
        }
        throw err;
      }

      // Drop unused description column (Phase 69: SPEC-19)
      // This migration removes the column added in Phase 32 which is no longer used
      try {
        await dropDescriptionColumn(supabaseUrl, serviceRoleKey, databaseUrl);
        logger.info('Dropped description column from fqc_documents');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('does not exist')) {
          logger.info('description column already dropped or never existed — no action needed');
        } else {
          logger.warn(`Failed to drop description column: ${msg}`);
          // Don't throw — migration is non-critical
        }
      }

      logger.info('Schema verification: all 5 required tables present');
      logger.debug('  fqc_memory: verified');
      logger.debug('  fqc_vault: verified');
      logger.debug('  fqc_documents: verified');
      logger.debug('  fqc_plugin_registry: verified');
      logger.debug('  fqc_write_locks: verified');
      // CLEAN-01, CLEAN-02: fqc_event_log and fqc_routing_rules removed in v1.7
      // CLEAN-01: fqc_projects removed in v1.7 (replaced by path-based location + tag-based categorization)
      logger.info('Supabase: connected');
    }

    // Create supabase-js client for runtime data operations.
    // NOTE: first arg is REST API URL (config.supabase.url), NOT databaseUrl (Pitfall 3)
    // Use node-fetch instead of Node.js built-in fetch — undici v7 (Node 22+) has strict
    // HTTP compliance checks that conflict with some self-hosted Supabase/Kong configurations.
    this.client = createClient(supabaseUrl, serviceRoleKey, {
      global: { fetch: fetchWithRetry as typeof globalThis.fetch },
    });

    if (!skipDdl) {
      // Seed fqc_vault with current instance (D-16, D-17)
      // Use UPSERT on path to allow idempotent re-runs (Pitfall 5 mitigation)
      const vaultName = config.instance.name;
      const vaultPath = config.instance.vault.path;
      const instanceId = config.instance.id;

      const { error: vaultError } = await this.client
        .from('fqc_vault')
        .upsert(
          {
            path: vaultPath,
            name: vaultName,
            instance_id: instanceId,
            created_at: new Date().toISOString(),
          },
          { onConflict: 'path' }
        );

      if (vaultError) {
        logger.error(`Failed to seed fqc_vault: ${vaultError.message}`);
      } else {
        logger.info(`Vault instance registered: ${vaultPath} (id=${instanceId})`);
      }
    }
  }

  getClient(): SupabaseClient {
    if (!this.client) {
      throw new Error('SupabaseManager not initialized. Call initialize(config) first.');
    }
    return this.client;
  }

  async close(): Promise<void> {
    this.client = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Module singleton (mirrors logger.ts pattern)
// ─────────────────────────────────────────────────────────────────────────────

export let supabaseManager: SupabaseManager;

export async function initSupabase(config: FlashQueryConfig): Promise<void> {
  const manager = new SupabaseManagerImpl();
  await manager.initialize(config);
  supabaseManager = manager;
}

/**
 * Graceful shutdown for Supabase client
 *
 * The supabase-js client does not have a direct dispose() method in v2.x.
 * Instead, we rely on Node.js to close the underlying HTTP connections.
 * This function attempts a ping to flush any pending operations.
 *
 * Per D-04a: 5-second timeout for flush
 */
export async function gracefulShutdownSupabase(): Promise<void> {
  if (!supabaseManager) return;
  const client = supabaseManager.getClient();
  if (!client) return;

  // Attempt a ping to flush any pending operations
  try {
    await Promise.race([
      client.from('fqc_documents').select('id').limit(1),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 5000) // 5s per D-04a
      ),
    ]);
  } catch (err: unknown) {
    // Timeout or error is expected; we just want to flush pending requests
    logger.debug(
      `gracefulShutdownSupabase: flush timeout or error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
