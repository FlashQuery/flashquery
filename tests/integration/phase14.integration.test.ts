/**
 * Integration tests for Phase 14 — Unified Taxonomy + Archive + Versioning + Discrepancy Detection.
 *
 * Tests the cross-system behaviors that unit tests (with mocked I/O) cannot verify:
 *   - TAX-03: #status/active prefix survives gray-matter YAML round-trip to vault + fqc_documents.tags TEXT[]
 *   - ARC-02: archive_document sets status=archived in both vault frontmatter and fqc_documents
 *   - ARC-01: archive_memory sets status=archived in fqc_memory and updates #status/ tags TEXT[]
 *   - VER-01: update_memory inserts new row with previous_version_id + version incremented; old row intact
 *   - DISC-01: runScanOnce() detects content_hash mismatch and updates DB hash
 *
 * Requires: Supabase credentials in .env.test (see .env.test.example)
 * Run: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import matter from 'gray-matter';
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initVault } from '../../src/storage/vault.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { registerMemoryTools } from '../../src/mcp/tools/memory.js';
import { runScanOnce } from '../../src/index.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// ── Config ────────────────────────────────────────────────────────────────────

import { TEST_SUPABASE_URL, TEST_SUPABASE_KEY, TEST_DATABASE_URL, HAS_SUPABASE } from '../helpers/test-env.js';

const SUPABASE_URL = TEST_SUPABASE_URL;
const SUPABASE_KEY = TEST_SUPABASE_KEY;
const DATABASE_URL = TEST_DATABASE_URL;

const SKIP = !HAS_SUPABASE;
const INSTANCE_ID = 'phase14-integration-test';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: { name: 'phase14-integration-test', id: INSTANCE_ID, vault: { path: vaultPath, markdownExtensions: ['.md'] } },
    supabase: { url: SUPABASE_URL, serviceRoleKey: SUPABASE_KEY, databaseUrl: DATABASE_URL, skipDdl: false },
    server: { host: 'localhost', port: 3100 },
    embedding: { provider: 'openai', model: 'text-embedding-3-small', apiKey: 'sk-no-key-needed', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: false, ttlSeconds: 30 },
  } as unknown as FlashQueryConfig;
}

function createMockServer() {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: (_name: string, _cfg: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers[_name] = handler;
    },
  } as unknown as McpServer;
  return { server, getHandler: (name: string) => handlers[name] };
}

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function getText(result: unknown): string {
  const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
  return r.content[0]?.text ?? '';
}

function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

/** Write a vault markdown file and insert a matching fqc_documents row. Returns fqcId. */
async function seedDocument(opts: {
  vaultPath: string;
  relPath: string;      // e.g. '_global/my-doc.md'
  title: string;
  body: string;
  frontmatter?: Record<string, unknown>;
}): Promise<string> {
  const fqcId = randomUUID();
  const fm = { title: opts.title, fqc_id: fqcId, status: 'active', tags: [], ...opts.frontmatter };
  const raw = matter.stringify(opts.body, fm);
  const absPath = join(opts.vaultPath, opts.relPath);
  await mkdir(join(opts.vaultPath, opts.relPath, '..'), { recursive: true });
  await writeFile(absPath, raw, 'utf-8');

  await supabaseManager.getClient().from('fqc_documents').insert({
    id: fqcId,
    instance_id: INSTANCE_ID,
    title: opts.title,
    path: opts.relPath,
    content_hash: computeHash(raw),
    status: 'active',
    tags: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return fqcId;
}

/** Insert a fqc_memory row directly (no vault file). Returns the memory id. */
async function seedMemory(opts: { content: string; tags?: string[] }): Promise<string> {
  const id = randomUUID();
  await supabaseManager.getClient().from('fqc_memory').insert({
    id,
    instance_id: INSTANCE_ID,
    content: opts.content,
    status: 'active',
    tags: opts.tags ?? [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return id;
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('Phase 14 Integration', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;
  let getDocHandler: ReturnType<typeof createMockServer>['getHandler'];
  let getMemHandler: ReturnType<typeof createMockServer>['getHandler'];

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-phase14-integration-'));
    config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    await initVault(config);

    // Register document tools
    const docMock = createMockServer();
    registerDocumentTools(docMock.server, config);
    getDocHandler = docMock.getHandler;

    // Register memory tools
    const memMock = createMockServer();
    registerMemoryTools(memMock.server, config);
    getMemHandler = memMock.getHandler;
  }, 30000);

  afterAll(async () => {
    await supabaseManager.getClient().from('fqc_documents').delete().eq('instance_id', INSTANCE_ID);
    await supabaseManager.getClient().from('fqc_memory').delete().eq('instance_id', INSTANCE_ID);
    await supabaseManager.getClient().from('fqc_vault').delete().eq('instance_id', INSTANCE_ID);
    await rm(vaultPath, { recursive: true, force: true });
  });

  // ── TAX-03: #status/active tag prefix round-trip ──────────────────────────

  describe('TAX-03: #status/active tag prefix', () => {
    it('create_document writes #status/active (with #) to vault frontmatter and fqc_documents.tags', async () => {
      const result = await getDocHandler('create_document')({
        title: 'TAX-03 Test Doc',
        content: 'Body content for tag prefix test.',
        project: '_global',
      });
      expect(isError(result)).toBe(false);

      // Extract fqc_id from response text (format: "fqc_id: <uuid>")
      const text = getText(result);
      const fqcIdMatch = text.match(/FQC ID:\s*([a-f0-9-]{36})/);
      if (!fqcIdMatch) {
        throw new Error(`Expected FQC ID in response, got:\n${text}`);
      }
      const fqcId = fqcIdMatch[1];

      // Extract vault path from response (format: "Document created: <path>")
      const pathMatch = text.match(/Document created:\s*(.+)/);
      if (!pathMatch) {
        throw new Error(`Expected document path in response, got:\n${text}`);
      }
      const relPath = pathMatch[1];

      // Assert vault frontmatter has #status/active (with #)
      const raw = await readFile(join(vaultPath, relPath), 'utf-8');
      const parsed = matter(raw);
      expect(parsed.data.tags).toEqual(expect.arrayContaining(['#status/active']));
      // Must NOT contain bare 'status/active' without #
      expect((parsed.data.tags as string[]).some(t => t === 'status/active')).toBe(false);

      // Assert fqc_documents.tags TEXT[] has #status/active
      const { data } = await supabaseManager.getClient()
        .from('fqc_documents')
        .select('tags')
        .eq('id', fqcId)
        .single();
      expect((data!.tags as string[])).toContain('#status/active');
    });
  });

  // ── ARC-02: archive_document vault+DB round-trip ──────────────────────────

  describe('ARC-02: archive_document', () => {
    it('sets status=archived in vault frontmatter and fqc_documents — vault written before DB update', async () => {
      const fqcId = await seedDocument({
        vaultPath, relPath: '_global/archive-doc-test.md',
        title: 'Archive Doc Test', body: 'Will be archived.',
        frontmatter: { status: 'active' },
      });

      const result = await getDocHandler('archive_document')({ identifiers: '_global/archive-doc-test.md' });
      expect(isError(result)).toBe(false);

      // Assert vault frontmatter
      const raw = await readFile(join(vaultPath, '_global/archive-doc-test.md'), 'utf-8');
      const parsed = matter(raw);
      expect(parsed.data.status).toBe('archived');

      // Assert fqc_documents row
      const { data } = await supabaseManager.getClient()
        .from('fqc_documents')
        .select('status')
        .eq('id', fqcId)
        .single();
      expect(data!.status).toBe('archived');
    });

    it('reports failure when document path does not exist', async () => {
      const result = await getDocHandler('archive_document')({ identifiers: '_global/nonexistent.md' }) as { content: Array<{ text: string }>; isError?: boolean };
      // Per-item errors are captured in results text, not as isError
      expect(result.content[0].text).toContain('failed');
    });
  });

  // ── ARC-01: archive_memory TEXT[] tag round-trip ──────────────────────────

  describe('ARC-01: archive_memory', () => {
    it('sets status=archived in fqc_memory and updates #status/ tags TEXT[]', async () => {
      const memId = await seedMemory({ content: 'Memory to be archived', tags: ['#status/active', 'project:test'] });

      const result = await getMemHandler('archive_memory')({ memory_id: memId });
      expect(isError(result)).toBe(false);

      const { data } = await supabaseManager.getClient()
        .from('fqc_memory')
        .select('status, tags')
        .eq('id', memId)
        .single();

      expect(data!.status).toBe('archived');
      // #status/archived must be present
      expect((data!.tags as string[])).toContain('#status/archived');
      // #status/active must be removed
      expect((data!.tags as string[])).not.toContain('#status/active');
      // Other tags preserved
      expect((data!.tags as string[])).toContain('project:test');
    });

    it('is idempotent — calling archive_memory twice does not duplicate #status/archived', async () => {
      const memId = await seedMemory({ content: 'Idempotent archive test', tags: ['#status/active'] });
      await getMemHandler('archive_memory')({ memory_id: memId });
      await getMemHandler('archive_memory')({ memory_id: memId });

      const { data } = await supabaseManager.getClient()
        .from('fqc_memory').select('tags').eq('id', memId).single();
      const archivedCount = (data!.tags as string[]).filter(t => t === '#status/archived').length;
      expect(archivedCount).toBe(1);
    });
  });

  // ── VER-01: update_memory version chain ───────────────────────────────────

  describe('VER-01: update_memory version chain', () => {
    it('inserts new row with previous_version_id and increments version; original row untouched', async () => {
      const originalId = await seedMemory({ content: 'Original memory content', tags: ['tag-a'] });

      const result = await getMemHandler('update_memory')({
        memory_id: originalId,
        content: 'Revised memory content',
      });
      expect(isError(result)).toBe(false);

      // Extract new id from response (format: "Memory updated. New version id: <uuid>.")
      const text = getText(result);
      const newIdMatch = text.match(/New version id:\s*([a-f0-9-]{36})/);
      if (!newIdMatch) {
        throw new Error(`Expected new version id in response, got:\n${text}`);
      }
      const newId = newIdMatch[1];

      // Assert new row: previous_version_id points to original, version = 2
      const { data: newRow } = await supabaseManager.getClient()
        .from('fqc_memory').select('content, version, previous_version_id').eq('id', newId).single();
      expect(newRow!.content).toBe('Revised memory content');
      expect(newRow!.version).toBe(2);
      expect(newRow!.previous_version_id).toBe(originalId);

      // Assert original row is intact (not deleted, not mutated)
      const { data: origRow } = await supabaseManager.getClient()
        .from('fqc_memory').select('content, version').eq('id', originalId).single();
      expect(origRow).not.toBeNull();
      expect(origRow!.content).toBe('Original memory content');
      expect(origRow!.version).toBe(1);
    });
  });

  // ── DISC-01: runScanOnce detects content_hash mismatch ────────────────────

  describe('DISC-01: runScanOnce detects content_hash mismatch', () => {
    it('detects externally-edited file and updates content_hash in DB', async () => {
      // Seed a document (hash matches at creation)
      const fqcId = await seedDocument({
        vaultPath, relPath: '_global/scan-test.md',
        title: 'Scan Test Doc', body: 'Original content.',
      });

      // Verify initial hash matches
      const { data: before } = await supabaseManager.getClient()
        .from('fqc_documents').select('content_hash').eq('id', fqcId).single();
      const absPath = join(vaultPath, '_global/scan-test.md');
      const originalRaw = await readFile(absPath, 'utf-8');
      expect(before!.content_hash).toBe(computeHash(originalRaw));

      // Simulate external Obsidian edit — overwrite file content directly
      const editedContent = '---\ntitle: Scan Test Doc\nfqc_id: ' + fqcId + '\nstatus: active\ntags: []\n---\nEdited by Obsidian externally.\n';
      await writeFile(absPath, editedContent, 'utf-8');

      // Run scan
      const { hashMismatches } = await runScanOnce(config);
      expect(hashMismatches).toBeGreaterThanOrEqual(1);

      // Assert content_hash updated in DB to match new file content
      const { data: after } = await supabaseManager.getClient()
        .from('fqc_documents').select('content_hash').eq('id', fqcId).single();
      expect(after!.content_hash).toBe(computeHash(editedContent));
      expect(after!.content_hash).not.toBe(before!.content_hash);
    });
  });
});
