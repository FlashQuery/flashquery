/**
 * Integration tests for frontmatter field ordering (Phase 90, ORD-01 through ORD-04).
 *
 * These tests verify that user-defined frontmatter fields are written BEFORE
 * FlashQuery-managed fields (fq_*) in all code paths that touch vault files.
 *
 * Wave 1 (Plan 01): These tests are stubs — they will FAIL until Wave 2 source
 * file rewrites rename legacy fields (title, fqc_id, etc.) to fq_* and invert
 * the ordering in frontmatter-sanitizer.ts. Failure is expected and intentional
 * at this stage.
 *
 * Requires: Supabase credentials in .env.test (see .env.test.example)
 * Run: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initVault } from '../../src/storage/vault.js';
import { initPlugins } from '../../src/plugins/manager.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { FM } from '../../src/constants/frontmatter-fields.js';
import {
  TEST_SUPABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_DATABASE_URL,
  HAS_SUPABASE,
} from '../helpers/test-env.js';

// ── Config ────────────────────────────────────────────────────────────────────

const INSTANCE_ID = 'frontmatter-ordering-test';
const SKIP = !HAS_SUPABASE;

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: 'frontmatter-ordering-test',
      id: INSTANCE_ID,
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
    },
    server: { host: 'localhost', port: 3100 },
    embedding: {
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'sk-no-key-needed',
      dimensions: 1536,
    },
    logging: { level: 'error', output: 'stdout' },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: false, ttlSeconds: 30 },
  } as unknown as FlashQueryConfig;
}

// ── Mock Server ───────────────────────────────────────────────────────────────

function createMockServer() {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: (
      _name: string,
      _cfg: unknown,
      handler: (params: Record<string, unknown>) => Promise<unknown>,
    ) => {
      handlers[_name] = handler;
    },
  } as unknown as McpServer;
  return { server, getHandler: (name: string) => handlers[name] };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** All FlashQuery-managed field names (fq_*). */
const FQ_FIELDS = new Set(Object.values(FM));

/**
 * Returns the index of the first FQ-managed field in a frontmatter key array.
 * Returns -1 if no FQ fields are present.
 */
function firstFqIndex(keys: string[]): number {
  return keys.findIndex((k) => FQ_FIELDS.has(k as typeof FM[keyof typeof FM]));
}

/**
 * Returns the index of the last user-defined (non-FQ) field in a frontmatter
 * key array. Returns -1 if no user fields are present.
 */
function lastUserIndex(keys: string[]): number {
  let last = -1;
  for (let i = 0; i < keys.length; i++) {
    if (!FQ_FIELDS.has(keys[i] as typeof FM[keyof typeof FM])) {
      last = i;
    }
  }
  return last;
}

function getText(result: unknown): string {
  const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
  return r.content[0]?.text ?? '';
}

function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

/** Extract fq_id from a tool response string (e.g., "FQ ID: <uuid>"). */
function extractId(text: string): string | null {
  // Accept both old "FQC ID:" and new "FQ ID:" prefixes for forward-compatibility
  const m = text.match(/(?:FQ(?:C)? ID|fq_id):\s*([a-f0-9-]{36})/i);
  return m ? m[1] : null;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('Frontmatter Ordering Integration', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;
  let handlers: ReturnType<typeof createMockServer>['getHandler'];

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-ordering-integration-'));
    config = makeConfig(vaultPath);

    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    await initVault(config);
    await initPlugins(config);

    const { server, getHandler } = createMockServer();
    registerDocumentTools(server, config);
    registerCompoundTools(server, config);
    handlers = getHandler;
  }, 30000);

  afterAll(async () => {
    const sb = supabaseManager.getClient();
    await sb.from('fqc_documents').delete().eq('instance_id', INSTANCE_ID);
    await sb.from('fqc_vault').delete().eq('instance_id', INSTANCE_ID);
    await rm(vaultPath, { recursive: true, force: true });
    await supabaseManager.close();
  });

  // ── ORD-01 ────────────────────────────────────────────────────────────────

  describe('ORD-01 — create_document writes user fields before FQ fields', () => {
    it('user-defined fields appear before fq_* fields in the written vault file', async () => {
      const result = await handlers('create_document')({
        title: 'Ordering Test Create',
        content: 'Body content for ORD-01.',
        frontmatter: { description: 'user field', owner_name: 'user field' },
      });

      expect(isError(result)).toBe(false);
      const text = getText(result);
      const docId = extractId(text);
      expect(docId).not.toBeNull();

      // Locate the vault file — search by fq_id in all .md files
      const { data } = await supabaseManager.getClient()
        .from('fqc_documents')
        .select('path')
        .eq('id', docId)
        .eq('instance_id', INSTANCE_ID)
        .single();
      expect(data).not.toBeNull();

      const raw = await readFile(join(vaultPath, data!.path), 'utf-8');
      const parsed = matter(raw);
      const keys = Object.keys(parsed.data);

      const firstFq = firstFqIndex(keys);
      const lastUser = lastUserIndex(keys);

      // Assert user fields (description, owner_name) precede all fq_* fields
      expect(firstFq).toBeGreaterThan(-1); // at least one fq_* field present
      expect(lastUser).toBeGreaterThan(-1); // at least one user field present
      expect(lastUser).toBeLessThan(firstFq); // user fields end before fq_* begin

      // Clean up
      await supabaseManager.getClient()
        .from('fqc_documents')
        .delete()
        .eq('id', docId)
        .eq('instance_id', INSTANCE_ID);
    });
  });

  // ── ORD-02 ────────────────────────────────────────────────────────────────

  describe('ORD-02 — update_document preserves user-first ordering', () => {
    it('user-defined fields still appear before fq_* fields after a body update', async () => {
      // Create with extra user fields
      const createResult = await handlers('create_document')({
        title: 'Ordering Test Update',
        content: 'Original body for ORD-02.',
        frontmatter: { note: 'user note', priority: 'high' },
      });
      expect(isError(createResult)).toBe(false);
      const createText = getText(createResult);
      const docId = extractId(createText);
      expect(docId).not.toBeNull();

      // Retrieve vault path
      const { data: row } = await supabaseManager.getClient()
        .from('fqc_documents')
        .select('path')
        .eq('id', docId)
        .eq('instance_id', INSTANCE_ID)
        .single();
      expect(row).not.toBeNull();

      // Update body only
      const updateResult = await handlers('update_document')({
        identifier: docId,
        content: 'Updated body for ORD-02.',
      });
      expect(isError(updateResult)).toBe(false);

      // Re-read and check ordering
      const raw = await readFile(join(vaultPath, row!.path), 'utf-8');
      const parsed = matter(raw);
      const keys = Object.keys(parsed.data);

      const firstFq = firstFqIndex(keys);
      const lastUser = lastUserIndex(keys);

      expect(firstFq).toBeGreaterThan(-1);
      expect(lastUser).toBeGreaterThan(-1);
      expect(lastUser).toBeLessThan(firstFq);

      // Clean up
      await supabaseManager.getClient()
        .from('fqc_documents')
        .delete()
        .eq('id', docId)
        .eq('instance_id', INSTANCE_ID);
    });
  });

  // ── ORD-03 ────────────────────────────────────────────────────────────────

  describe('ORD-03 — update_doc_header preserves user-first ordering', () => {
    it('user-defined fields still appear before fq_* fields after adding a tag via update_doc_header', async () => {
      // Create with extra user fields
      const createResult = await handlers('create_document')({
        title: 'Ordering Test Header',
        content: 'Body for ORD-03.',
        frontmatter: { category: 'testing', source: 'integration' },
      });
      expect(isError(createResult)).toBe(false);
      const createText = getText(createResult);
      const docId = extractId(createText);
      expect(docId).not.toBeNull();

      // Retrieve vault path
      const { data: row } = await supabaseManager.getClient()
        .from('fqc_documents')
        .select('path')
        .eq('id', docId)
        .eq('instance_id', INSTANCE_ID)
        .single();
      expect(row).not.toBeNull();

      // Update header (add a tag via updates map)
      const headerResult = await handlers('update_doc_header')({
        identifier: docId,
        updates: { [FM.TAGS]: ['#ordering-test'] },
      });
      expect(isError(headerResult)).toBe(false);

      // Re-read and check ordering
      const raw = await readFile(join(vaultPath, row!.path), 'utf-8');
      const parsed = matter(raw);
      const keys = Object.keys(parsed.data);

      const firstFq = firstFqIndex(keys);
      const lastUser = lastUserIndex(keys);

      expect(firstFq).toBeGreaterThan(-1);
      expect(lastUser).toBeGreaterThan(-1);
      expect(lastUser).toBeLessThan(firstFq);

      // Clean up
      await supabaseManager.getClient()
        .from('fqc_documents')
        .delete()
        .eq('id', docId)
        .eq('instance_id', INSTANCE_ID);
    });
  });

  // ── ORD-04 ────────────────────────────────────────────────────────────────

  describe('ORD-04 — plugin reconciliation writes fq_owner/fq_type after user fields', () => {
    it('fq_owner and fq_type appear after user-defined fields when reconcile_documents runs', async () => {
      // Create a document with user fields
      const createResult = await handlers('create_document')({
        title: 'Ordering Test Reconcile',
        content: 'Body for ORD-04.',
        frontmatter: { project_name: 'test-project', env: 'integration' },
      });
      expect(isError(createResult)).toBe(false);
      const createText = getText(createResult);
      const docId = extractId(createText);
      expect(docId).not.toBeNull();

      // Retrieve vault path
      const { data: row } = await supabaseManager.getClient()
        .from('fqc_documents')
        .select('path')
        .eq('id', docId)
        .eq('instance_id', INSTANCE_ID)
        .single();
      expect(row).not.toBeNull();

      // Trigger reconciliation (if available) or skip gracefully
      const reconcileHandler = handlers('reconcile_documents');
      if (reconcileHandler) {
        const reconcileResult = await reconcileHandler({ dry_run: false });
        // Reconciliation may or may not modify this document — that is OK
        void reconcileResult;
      }

      // Re-read and check that fq_owner / fq_type (if present) appear after user fields
      const raw = await readFile(join(vaultPath, row!.path), 'utf-8');
      const parsed = matter(raw);
      const keys = Object.keys(parsed.data);

      const userFields = ['project_name', 'env'];
      const ownerIdx = keys.indexOf(FM.OWNER);
      const typeIdx = keys.indexOf(FM.TYPE);

      // User fields must precede fq_owner and fq_type when those fields are present
      for (const uf of userFields) {
        const userIdx = keys.indexOf(uf);
        if (userIdx !== -1) {
          if (ownerIdx !== -1) {
            expect(userIdx).toBeLessThan(ownerIdx);
          }
          if (typeIdx !== -1) {
            expect(userIdx).toBeLessThan(typeIdx);
          }
        }
      }

      // At minimum, the document must have been created with at least one fq_* field
      const hasFqField = keys.some((k) => FQ_FIELDS.has(k as typeof FM[keyof typeof FM]));
      expect(hasFqField).toBe(true);

      // Clean up
      await supabaseManager.getClient()
        .from('fqc_documents')
        .delete()
        .eq('id', docId)
        .eq('instance_id', INSTANCE_ID);
    });
  });
});
