import http from 'node:http';
import https from 'node:https';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logging/logger.js';
import type { FlashQueryConfig } from '../config/types.js';
import { verifySchema } from './schema-verify.js';
import { createPgClientIPv4 } from '../utils/pg-client.js';
import { getEmbeddingDimensions } from '../embedding/dimensions.js';

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
	  chain_root_id UUID,
	  is_latest BOOLEAN DEFAULT true,
  archived_at TIMESTAMPTZ,
  embedding vector(${dimensions}),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Phase 125: memory lifecycle visibility columns for final search/memory tools.
	ALTER TABLE IF EXISTS fqc_memory ADD COLUMN IF NOT EXISTS is_latest BOOLEAN DEFAULT true;
	ALTER TABLE IF EXISTS fqc_memory ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
	ALTER TABLE IF EXISTS fqc_memory ADD COLUMN IF NOT EXISTS chain_root_id UUID;
	UPDATE fqc_memory SET is_latest = true WHERE is_latest IS NULL;
	UPDATE fqc_memory parent
	SET is_latest = false
WHERE EXISTS (
  SELECT 1
  FROM fqc_memory child
	  WHERE child.previous_version_id = parent.id
	);
	WITH RECURSIVE memory_chains AS (
	  SELECT id, id AS root_id
	  FROM fqc_memory
	  WHERE previous_version_id IS NULL
	  UNION ALL
	  SELECT child.id, parent.root_id
	  FROM fqc_memory child
	  JOIN memory_chains parent ON child.previous_version_id = parent.id
	)
	UPDATE fqc_memory memory
	SET chain_root_id = memory_chains.root_id
	FROM memory_chains
	WHERE memory.id = memory_chains.id
	  AND memory.chain_root_id IS NULL;
	UPDATE fqc_memory SET chain_root_id = id WHERE chain_root_id IS NULL;

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
  archived_at TIMESTAMPTZ,
  embedding vector(${dimensions}),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Phase 32: description column added here, but dropped in Phase 69 (SPEC-19) — omitted to prevent
-- add/drop cycle that exhausts PostgreSQL's 1600 attnum slots over repeated test runs.

-- Phase 39: needs_frontmatter_repair flag for TSA-01 (read-only background scan)
ALTER TABLE IF EXISTS fqc_documents ADD COLUMN IF NOT EXISTS needs_frontmatter_repair BOOLEAN DEFAULT FALSE;

-- Phase 123: archive_document lifecycle timestamp (DOC-02)
ALTER TABLE IF EXISTS fqc_documents ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Phase 144: indexed template metadata for bounded template discovery
ALTER TABLE IF EXISTS fqc_documents ADD COLUMN IF NOT EXISTS template_meta JSONB;

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

-- Phase 125: Existing databases may have been created before the pending-review
-- FK used ON DELETE CASCADE. Repair the constraint idempotently so hard-deleting
-- a document cannot leave orphaned pending-review rows.
DO $$
DECLARE
  existing_constraint TEXT;
BEGIN
  SELECT c.conname INTO existing_constraint
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
  WHERE t.relname = 'fqc_pending_plugin_review'
    AND c.contype = 'f'
    AND a.attname = 'fqc_id'
  LIMIT 1;

  IF existing_constraint IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conname = existing_constraint
        AND c.confdeltype = 'c'
    ) THEN
      EXECUTE format('ALTER TABLE fqc_pending_plugin_review DROP CONSTRAINT %I', existing_constraint);
      existing_constraint := NULL;
    END IF;
  END IF;

  IF existing_constraint IS NULL THEN
    DELETE FROM fqc_pending_plugin_review p
    WHERE NOT EXISTS (
      SELECT 1 FROM fqc_documents d WHERE d.id = p.fqc_id
    );

    ALTER TABLE fqc_pending_plugin_review
      ADD CONSTRAINT fqc_pending_plugin_review_fqc_id_fkey
      FOREIGN KEY (fqc_id) REFERENCES fqc_documents(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pending_review_plugin
  ON fqc_pending_plugin_review(plugin_id, instance_id);

CREATE INDEX IF NOT EXISTS idx_pending_review_fqc_id
  ON fqc_pending_plugin_review(fqc_id);

-- Phase 146: Durable pending embedding retry state (REQ-003, REQ-004)
CREATE TABLE IF NOT EXISTS fqc_pending_embeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_label TEXT,
  embed_text TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_attempt_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fqc_pending_embeds_status_check'
  ) THEN
    ALTER TABLE fqc_pending_embeds
      ADD CONSTRAINT fqc_pending_embeds_status_check
      CHECK (status IN ('pending', 'complete', 'failed'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fqc_pending_embeds_target_unique
  ON fqc_pending_embeds(instance_id, target_kind, target_table, target_id);

CREATE INDEX IF NOT EXISTS idx_fqc_pending_embeds_retry
  ON fqc_pending_embeds(instance_id, status, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_fqc_pending_embeds_target_lookup
  ON fqc_pending_embeds(instance_id, target_kind, target_id);

-- Phase 165: Per-instance embedding catalog foundation (REQ-001)
CREATE TABLE IF NOT EXISTS fqc_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id TEXT NOT NULL,
  name TEXT NOT NULL,
  dimensions INT NOT NULL,
  endpoints JSONB NOT NULL,
  source TEXT NOT NULL DEFAULT 'yaml',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(instance_id, name)
);

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

-- ─── Phase 98 (v3.0): LLM three-layer config tables ────────────────────────

-- LLM Config: Providers (PROV-01, PROV-02)
-- source: 'yaml' (set by syncLlmConfigToDb on each startup) or 'webapp' (preserved across restarts)
-- api_key_ref stores a literal \${ENV_VAR} reference string, NEVER the resolved secret
CREATE TABLE IF NOT EXISTS fqc_llm_providers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  api_key_ref TEXT,
  source TEXT NOT NULL DEFAULT 'yaml',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(instance_id, name)
);

-- LLM Config: Models (MOD-01, MOD-02)
-- cost_per_million_input/output use NUMERIC(10,4): supports rates like $0.0001/1M to $999,999.9999/1M.
-- Default 0 covers local/free models per MOD-02.
CREATE TABLE IF NOT EXISTS fqc_llm_models (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id TEXT NOT NULL,
  name TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  model TEXT NOT NULL,
  type TEXT NOT NULL,
  cost_per_million_input NUMERIC(10, 4) NOT NULL DEFAULT 0,
  cost_per_million_output NUMERIC(10, 4) NOT NULL DEFAULT 0,
  capabilities JSONB,
  tags TEXT[] DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'yaml',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(instance_id, name)
);
CREATE INDEX IF NOT EXISTS idx_llm_models_provider ON fqc_llm_models(instance_id, provider_name);
ALTER TABLE IF EXISTS fqc_llm_models ADD COLUMN IF NOT EXISTS capabilities JSONB;
ALTER TABLE IF EXISTS fqc_llm_models ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

-- LLM Config: Purposes (PURP-01, PURP-02, PURP-03)
-- defaults JSONB stores arbitrary LLM provider params (temperature, max_tokens, etc.)
CREATE TABLE IF NOT EXISTS fqc_llm_purposes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  defaults JSONB,
  tools JSONB,
  excluded_tools JSONB,
  source TEXT NOT NULL DEFAULT 'yaml',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(instance_id, name)
);
ALTER TABLE IF EXISTS fqc_llm_purposes ADD COLUMN IF NOT EXISTS tools JSONB;
ALTER TABLE IF EXISTS fqc_llm_purposes ADD COLUMN IF NOT EXISTS excluded_tools JSONB;

-- LLM Config: Purpose-Model fallback chain (PURP-01 ordered list)
-- position is 1-indexed; UNIQUE(instance_id, purpose_name, position) enforces ordering integrity.
CREATE TABLE IF NOT EXISTS fqc_llm_purpose_models (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id TEXT NOT NULL,
  purpose_name TEXT NOT NULL,
  model_name TEXT NOT NULL,
  position INTEGER NOT NULL,
  UNIQUE(instance_id, purpose_name, position)
);
CREATE INDEX IF NOT EXISTS idx_llm_purpose_models_lookup ON fqc_llm_purpose_models(instance_id, purpose_name);

-- LLM Usage: Cost tracking log (COST-01 — DDL ONLY in Phase 98; recording logic in Phase 102)
-- Token columns are BIGINT per STATE.md architectural constraint (not INTEGER) — once-shipped types.
-- cost_usd is NUMERIC(18,10) per STATE.md ("NUMERIC(18,10) for cost_usd") — supports rates as small
-- as 0.0000000001 USD with up to 99,999,999 USD total.
CREATE TABLE IF NOT EXISTS fqc_llm_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id TEXT NOT NULL,
  purpose_name TEXT NOT NULL,
  model_name TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(18, 10) NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  fallback_position INTEGER,
  trace_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_llm_usage_instance_created ON fqc_llm_usage(instance_id, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_usage_instance_purpose ON fqc_llm_usage(instance_id, purpose_name);
CREATE INDEX IF NOT EXISTS idx_llm_usage_instance_trace ON fqc_llm_usage(instance_id, trace_id);

-- Phase 115: Purpose-template bindings (BIND-03)
-- source: 'yaml' rows are recreated by startup config sync; 'api' rows are runtime-managed;
-- 'webapp' rows are durable UI-managed rows that block YAML/API ownership.
CREATE TABLE IF NOT EXISTS fqc_purpose_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id TEXT NOT NULL,
  purpose_name TEXT NOT NULL,
  template_path TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'yaml',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(instance_id, purpose_name, template_path)
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fqc_purpose_templates_source_check'
  ) THEN
    ALTER TABLE fqc_purpose_templates
      ADD CONSTRAINT fqc_purpose_templates_source_check
      CHECK (source IN ('yaml', 'api', 'webapp'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_fqc_purpose_templates_lookup
  ON fqc_purpose_templates(instance_id, purpose_name);

-- ─── End LLM config tables ─────────────────────────────────────────────────


-- Step 3: Create indexes

CREATE INDEX IF NOT EXISTS idx_fqc_memory_embedding ON fqc_memory USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_fqc_memory_tags ON fqc_memory USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_fqc_memory_status ON fqc_memory (status);
	CREATE INDEX IF NOT EXISTS idx_fqc_memory_latest_status ON fqc_memory (instance_id, status, is_latest);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_fqc_memory_one_latest_per_chain
	  ON fqc_memory (instance_id, chain_root_id) WHERE (is_latest = true);
CREATE INDEX IF NOT EXISTS idx_fqc_vault_instance ON fqc_vault (instance_id);
CREATE INDEX IF NOT EXISTS idx_fqc_documents_embedding ON fqc_documents USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_fqc_documents_instance ON fqc_documents (instance_id);
-- Phase 90: migrate from full to partial unique index on (instance_id, path).
-- Archived rows are excluded so a new document at the same path (after archiving
-- the old one) can be inserted without conflict, enabling clean test re-runs and
-- correct stale-row recovery in create_document when plugin FK constraints exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_fqc_documents_instance_path'
      AND indexdef NOT LIKE '%WHERE%'
  ) THEN
    DROP INDEX idx_fqc_documents_instance_path;
  END IF;
END$$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_fqc_documents_instance_path
  ON fqc_documents (instance_id, path) WHERE (status = 'active');
CREATE INDEX IF NOT EXISTS idx_fqc_documents_status ON fqc_documents (status);
CREATE INDEX IF NOT EXISTS idx_fqc_documents_tags ON fqc_documents USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_fqc_documents_ownership ON fqc_documents(ownership_plugin_id, ownership_type);


-- Step 4: Create match_memories RPC function

	-- Drop old function signature if it exists (Phase 33 added tag_match support)
	-- Old 6-param signature: embedding, threshold, count, project(removed), tags, instance_id
	-- New 6-param signature: embedding, threshold, count, tags, tag_match(new), instance_id
	-- PostgreSQL 42P13 blocks CREATE OR REPLACE when RETURNS TABLE differs, so we drop first.
	DROP FUNCTION IF EXISTS match_memories(vector, double precision, integer, text, text[], text) CASCADE;
	DROP FUNCTION IF EXISTS match_memories(vector, double precision, integer, text[], text, text) CASCADE;

	CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(${dimensions}),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10,
	  filter_tags text[] DEFAULT NULL,
	  filter_tag_match text DEFAULT 'any',
	  filter_instance_id text DEFAULT NULL,
	  include_archived boolean DEFAULT false
	)
RETURNS TABLE (
  id uuid,
  content text,
	  tags text[],
	  plugin_scope text,
	  similarity float,
	  created_at timestamptz,
	  updated_at timestamptz,
	  is_latest boolean
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
	    m.created_at,
	    m.updated_at,
	    m.is_latest
	  FROM fqc_memory m
	  WHERE (include_archived OR m.status = 'active')
	    AND m.is_latest = true
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

	CREATE OR REPLACE FUNCTION fqc_memory_create_version(
	  p_instance_id text,
	  p_previous_id uuid,
	  p_content text,
	  p_tags text[],
	  p_plugin_scope text DEFAULT 'global'
	)
	RETURNS TABLE (
	  id uuid,
	  content text,
	  tags text[],
	  plugin_scope text,
	  created_at timestamptz,
	  updated_at timestamptz,
	  version integer,
	  previous_version_id uuid,
	  is_latest boolean,
	  archived_at timestamptz,
	  chain_root_id uuid
	)
	LANGUAGE plpgsql
	AS $$
	DECLARE
	  previous_row fqc_memory%ROWTYPE;
	  inserted_id uuid := gen_random_uuid();
	  root_id uuid;
	BEGIN
	  SELECT * INTO previous_row
	  FROM fqc_memory
	  WHERE fqc_memory.id = p_previous_id
	    AND fqc_memory.instance_id = p_instance_id
	  FOR UPDATE;

	  IF NOT FOUND THEN
	    RAISE EXCEPTION 'Memory not found: %', p_previous_id USING ERRCODE = 'P0002';
	  END IF;

	  IF previous_row.is_latest IS NOT TRUE THEN
	    RAISE EXCEPTION 'Cannot update a non-latest memory version' USING ERRCODE = '23505';
	  END IF;

	  root_id := COALESCE(previous_row.chain_root_id, previous_row.id);

	  UPDATE fqc_memory
	  SET is_latest = false,
	      updated_at = now(),
	      chain_root_id = root_id
	  WHERE fqc_memory.id = previous_row.id
	    AND fqc_memory.instance_id = p_instance_id;

	  INSERT INTO fqc_memory (
	    id,
	    instance_id,
	    content,
	    tags,
	    plugin_scope,
	    status,
	    version,
	    previous_version_id,
	    chain_root_id,
	    is_latest,
	    archived_at,
	    embedding
	  )
	  VALUES (
	    inserted_id,
	    p_instance_id,
	    p_content,
	    COALESCE(p_tags, '{}'),
	    COALESCE(p_plugin_scope, previous_row.plugin_scope, 'global'),
	    'active',
	    COALESCE(previous_row.version, 1) + 1,
	    previous_row.id,
	    root_id,
	    true,
	    NULL,
	    NULL
	  );

	  RETURN QUERY
	  SELECT
	    m.id,
	    m.content,
	    m.tags,
	    m.plugin_scope,
	    m.created_at,
	    m.updated_at,
	    m.version,
	    m.previous_version_id,
	    m.is_latest,
	    m.archived_at,
	    m.chain_root_id
	  FROM fqc_memory m
	  WHERE m.id = inserted_id;
	END;
	$$;

-- Step 5: Create match_documents RPC function

-- Drop old function signatures with incompatible parameters (Phase 33 added filter_tags, filter_tag_match)
	-- Old signature: (vector, float, int, text) — 4 params, no tag filtering
	-- New signature: (vector, float, int, text, text[], text) — adds filter_tags and filter_tag_match
	DROP FUNCTION IF EXISTS match_documents(vector, double precision, integer, text) CASCADE;
	DROP FUNCTION IF EXISTS match_documents(vector, double precision, integer, text, text[], text) CASCADE;

CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(${dimensions}),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10,
	  filter_instance_id text DEFAULT NULL,
	  filter_tags text[] DEFAULT NULL,
	  filter_tag_match text DEFAULT 'any',
	  include_archived boolean DEFAULT false
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
	  WHERE (include_archived OR d.status = 'active')
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

export function buildDropDescriptionColumnDDL(): string {
  return 'ALTER TABLE IF EXISTS fqc_documents DROP COLUMN IF EXISTS description;';
}

export function buildRetireLegacyWriteLocksDDL(): string {
  return `DROP TABLE IF EXISTS fqc_write_locks`;
}

/**
 * Drops the unused `description` column from the `fqc_documents` table.
 * This migration is intentionally idempotent and silent for the common no-op
 * path where the column has already been removed.
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
  await ddlQuery(supabaseUrl, serviceRoleKey, buildDropDescriptionColumnDDL(), databaseUrl);
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
    const dimensions = getEmbeddingDimensions(config);

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
            await verifySchema(verifyClient, dimensions);
            logger.debug('Schema verification: all tables present (skip_ddl: true)');
          } finally {
            await verifyClient.end();
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes('Embedding dimension mismatch')) {
            logger.error(`Schema verification failed with skip_ddl: true — ${message}`);
            throw err;
          }
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
        await ddlQuery(supabaseUrl, serviceRoleKey, buildRetireLegacyWriteLocksDDL(), databaseUrl);
        logger.debug('Retired obsolete write-lock table if it existed');
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
            await verifySchema(verifyClient, dimensions);
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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('does not exist')) {
          // Already removed in this schema; no user-facing log needed.
        } else {
          logger.warn(`Failed to drop description column: ${msg}`);
          // Don't throw — migration is non-critical
        }
      }

      logger.info('Schema verification: all 11 required tables present');
      logger.debug('  fqc_memory: verified');
      logger.debug('  fqc_vault: verified');
      logger.debug('  fqc_documents: verified');
      logger.debug('  fqc_plugin_registry: verified');
      logger.debug('  fqc_llm_providers: verified');
      logger.debug('  fqc_llm_models: verified');
      logger.debug('  fqc_llm_purposes: verified');
      logger.debug('  fqc_llm_purpose_models: verified');
      logger.debug('  fqc_llm_usage: verified');
      logger.debug('  fqc_purpose_templates: verified');
      logger.debug('  fqc_pending_embeds: verified');
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
        const isAuthError = /invalid api key|unauthorized|jwt/i.test(vaultError.message);
        const detail = isAuthError
          ? `Auth rejected by Supabase (${vaultError.message}). ` +
            `Check that SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env both belong to the same Supabase project.`
          : vaultError.message;
        logger.error(`Failed to seed fqc_vault: ${detail}`);
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

  // eslint-disable-next-line @typescript-eslint/require-await
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
