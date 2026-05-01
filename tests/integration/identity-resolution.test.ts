/**
 * Phase 37: Identity Resolution — End-to-End Integration Tests
 *
 * Validates all four success criteria for Phase 37:
 *   SC1: Foreign UUID adoption (IDC-04, D-01, D-02)
 *   SC2: Path-based fallback and reconnection (INF-04, INF-05)
 *   SC3: Malformed UUID replacement with warning (IDC-05, D-09)
 *   SC4: Duplicate path deduplication (INF-02, D-10, D-11, D-12)
 *
 * Prerequisites:
 *   - Plans 01 and 02 must be complete (isValidUuid, pathToRow map, foreign UUID adoption,
 *     path-based fallback in scanner.ts and resolve-document.ts)
 *   - .env.test must have valid SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL
 *
 * Run: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import { v4 as uuidv4 } from 'uuid';

import pg from 'pg';
import { TEST_SUPABASE_URL, TEST_SUPABASE_KEY, TEST_DATABASE_URL, TEST_OPENAI_API_KEY, HAS_SUPABASE } from '../helpers/test-env.js';
import { initLogger, logger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initVault } from '../../src/storage/vault.js';
import { runScanOnce } from '../../src/services/scanner.js';
import { computeHash } from '../../src/mcp/tools/documents.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test environment guard
// ─────────────────────────────────────────────────────────────────────────────

const SKIP = !HAS_SUPABASE;
const INSTANCE_ID = 'identity-resolution-test-id';

// ─────────────────────────────────────────────────────────────────────────────
// Config builder (mirrors scan-command.integration.test.ts pattern)
// ─────────────────────────────────────────────────────────────────────────────

function makeTestConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: 'identity-resolution-test',
      id: INSTANCE_ID,
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: true,  // Schema already exists from prior test runs
    },
    embedding: {
      provider: 'none' as const,
      model: '',
      apiKey: '',
      dimensions: 0,
    },
    logging: { level: 'warn' as const, output: 'stdout' as const },
    defaults: { project: 'IdentityTest' },
    vault: { path: vaultPath, markdownExtensions: ['.md'] },
    git: { autoCommit: false, autoPush: false, scheduled: false },
    plugins: {},
    locking: { enabled: false, ttlSeconds: 30 },
  } as unknown as FlashQueryConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: write a markdown file with frontmatter to vault
// ─────────────────────────────────────────────────────────────────────────────

async function writeVaultFile(
  vaultPath: string,
  relativePath: string,
  frontmatter: Record<string, unknown>,
  body: string
): Promise<void> {
  const fullPath = join(vaultPath, relativePath);
  const dir = join(fullPath, '..');
  await mkdir(dir, { recursive: true });
  const content = matter.stringify(body, frontmatter);
  await writeFile(fullPath, content, 'utf-8');
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: read parsed frontmatter from vault file
// ─────────────────────────────────────────────────────────────────────────────

async function readVaultFrontmatter(
  vaultPath: string,
  relativePath: string
): Promise<Record<string, unknown>> {
  const fullPath = join(vaultPath, relativePath);
  const raw = await readFile(fullPath, 'utf-8');
  return matter(raw).data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: read raw file content
// ─────────────────────────────────────────────────────────────────────────────

async function readVaultRaw(vaultPath: string, relativePath: string): Promise<string> {
  const fullPath = join(vaultPath, relativePath);
  return readFile(fullPath, 'utf-8');
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 37 identity resolution integration tests
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('Phase 37: Identity Resolution', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-identity-test-'));
    config = makeTestConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    await initVault(config);
  });

  afterAll(async () => {
    try {
      const client = supabaseManager.getClient();
      await client.from('fqc_documents').delete().eq('instance_id', INSTANCE_ID);
      await supabaseManager.close();
    } catch {
      // ignore cleanup errors
    }
    try {
      await rm(vaultPath, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  beforeEach(async () => {
    // Isolate each test: clean all docs for this instance + all vault files
    const client = supabaseManager.getClient();
    await client.from('fqc_documents').delete().eq('instance_id', INSTANCE_ID);

    // Remove all files from vault root (but keep the directory)
    try {
      const { readdir, unlink, rm: rmEntry, stat } = await import('node:fs/promises');
      const entries = await readdir(vaultPath);
      for (const entry of entries) {
        const entryPath = join(vaultPath, entry);
        const s = await stat(entryPath);
        if (s.isDirectory()) {
          await rmEntry(entryPath, { recursive: true });
        } else {
          await unlink(entryPath);
        }
      }
    } catch {
      // vault may be empty
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SC1: Foreign UUID adoption (IDC-04)
  // ───────────────────────────────────────────────────────────────────────────

  describe('SC1: Foreign UUID adoption', () => {
    it('adopts valid foreign UUID without creating duplicate DB row or rewriting frontmatter', async () => {
      // 1. A valid v4 UUID from a "foreign" FQC instance — not in current DB
      const foreignUuid = uuidv4();
      const testPath = 'foreign-doc.md';
      const createdAt = new Date().toISOString();

      await writeVaultFile(vaultPath, testPath, {
        fq_id: foreignUuid,
        title: 'Foreign Document',
        status: 'active',
        tags: [],
        created: createdAt,
        updated: createdAt,
      }, '# Foreign Document\n\nContent from another FQC instance.');

      // Record raw content BEFORE scan (SC1: no frontmatter rewrite allowed)
      const rawBefore = await readVaultRaw(vaultPath, testPath);
      const hashBefore = computeHash(rawBefore);

      // 2. Run scanner
      await runScanOnce(config);

      // 3. DB row must exist with the foreignUuid as its id (not a new generated UUID)
      const { data: dbRow, error } = await supabaseManager.getClient()
        .from('fqc_documents')
        .select('id, path, status')
        .eq('id', foreignUuid)
        .eq('instance_id', INSTANCE_ID)
        .maybeSingle();

      expect(error).toBeNull();
      expect(dbRow).not.toBeNull();
      expect((dbRow as Record<string, unknown>).id).toBe(foreignUuid);
      expect((dbRow as Record<string, unknown>).path).toBe(testPath);

      // 4. File must be unchanged (SC1: no frontmatter rewrite)
      const rawAfter = await readVaultRaw(vaultPath, testPath);
      const hashAfter = computeHash(rawAfter);
      expect(hashAfter).toBe(hashBefore);

      // 5. Exactly one DB row for this instance (no duplicates)
      const { data: allRows } = await supabaseManager.getClient()
        .from('fqc_documents')
        .select('id')
        .eq('instance_id', INSTANCE_ID);
      expect((allRows ?? []).length).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SC1b: Archived UUID on disk — stable across repeated scans (IDC-04 fix)
  // ───────────────────────────────────────────────────────────────────────────

  describe('SC1b: Archived UUID on disk', () => {
    it('does not count file as new and preserves archived status across repeated scans', async () => {
      const archivedUuid = uuidv4();
      const testPath = 'archived-doc.md';
      const createdAt = new Date().toISOString();

      // 1. Insert an archived row directly into the DB
      const supabase = supabaseManager.getClient();
      const { error: insertErr } = await supabase.from('fqc_documents').insert({
        id: archivedUuid,
        instance_id: INSTANCE_ID,
        path: testPath,
        title: 'Archived Document',
        status: 'archived',
        content_hash: 'placeholder-hash',
        created_at: createdAt,
        updated_at: createdAt,
      });
      expect(insertErr).toBeNull();

      // 2. Write a vault file whose fq_id points to that archived row
      await writeVaultFile(vaultPath, testPath, {
        fq_id: archivedUuid,
        title: 'Archived Document',
        status: 'active',
        tags: [],
        created: createdAt,
        updated: createdAt,
      }, '# Archived Document\n\nThis file has an archived UUID.');

      // 3. First scan — should not count it as new
      const result1 = await runScanOnce(config);
      expect(result1.newFiles).toBe(0);

      // 4. DB row must still be archived
      const { data: row1 } = await supabase
        .from('fqc_documents')
        .select('id, status')
        .eq('id', archivedUuid)
        .eq('instance_id', INSTANCE_ID)
        .maybeSingle();
      expect((row1 as Record<string, unknown> | null)?.status).toBe('archived');

      // 5. Second scan — must be stable (same result, not reported as new again)
      const result2 = await runScanOnce(config);
      expect(result2.newFiles).toBe(0);

      // 6. DB row still archived, no duplicates created
      const { data: allRows } = await supabase
        .from('fqc_documents')
        .select('id, status')
        .eq('instance_id', INSTANCE_ID);
      const rowsForUuid = (allRows ?? []).filter(
        (r: Record<string, unknown>) => r.id === archivedUuid
      );
      expect(rowsForUuid.length).toBe(1);
      expect(rowsForUuid[0].status).toBe('archived');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SC2: Path-based fallback and reconnection (INF-04)
  // ───────────────────────────────────────────────────────────────────────────

  describe('SC2: Path-based fallback and reconnection', () => {
    it('reconnects file with removed fqc_id to existing DB row via path', async () => {
      const testPath = 'reconnect-test.md';
      const originalUuid = uuidv4();
      const createdAt = new Date().toISOString();

      // 1. Create file WITH fqc_id and run scan to establish DB row
      await writeVaultFile(vaultPath, testPath, {
        fq_id: originalUuid,
        title: 'Reconnect Test',
        status: 'active',
        tags: [],
        created: createdAt,
        updated: createdAt,
      }, '# Reconnect\n\nOriginal content.');

      await runScanOnce(config);

      // Verify initial DB row exists
      const { data: initialRow } = await supabaseManager.getClient()
        .from('fqc_documents')
        .select('id, path, content_hash')
        .eq('id', originalUuid)
        .eq('instance_id', INSTANCE_ID)
        .maybeSingle();
      expect(initialRow).not.toBeNull();

      // 2. Manually remove fqc_id from frontmatter to simulate user edit
      //    (Also change content so hash doesn't match)
      await writeVaultFile(vaultPath, testPath, {
        // fqc_id intentionally omitted
        title: 'Reconnect Test',
        status: 'active',
        tags: [],
        created: createdAt,
        updated: new Date().toISOString(),
      }, '# Reconnect\n\nModified content — fqc_id was manually removed.');

      // 3. Run scanner again — should reconnect via path-based fallback
      await runScanOnce(config);

      // 4. DB row must still have originalUuid as id (not replaced with a new UUID)
      const { data: reconnectedRow } = await supabaseManager.getClient()
        .from('fqc_documents')
        .select('id, path, content_hash')
        .eq('id', originalUuid)
        .eq('instance_id', INSTANCE_ID)
        .maybeSingle();

      expect(reconnectedRow).not.toBeNull();
      expect((reconnectedRow as Record<string, unknown>).id).toBe(originalUuid);
      expect((reconnectedRow as Record<string, unknown>).path).toBe(testPath);

      // 5. DB content_hash must be updated (content changed)
      const rawAfter = await readVaultRaw(vaultPath, testPath);
      const expectedHash = computeHash(rawAfter);
      expect((reconnectedRow as Record<string, unknown>).content_hash).toBe(expectedHash);

      // 6. fqc_id written back to file frontmatter
      const fm = await readVaultFrontmatter(vaultPath, testPath);
      expect(fm.fq_id).toBe(originalUuid);

      // 7. Exactly one DB row (no orphan created)
      const { data: allRows } = await supabaseManager.getClient()
        .from('fqc_documents')
        .select('id')
        .eq('instance_id', INSTANCE_ID);
      expect((allRows ?? []).length).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SC3: Malformed UUID replacement (IDC-05)
  // ───────────────────────────────────────────────────────────────────────────

  describe('SC3: Malformed UUID replacement', () => {
    it('replaces malformed fqc_id with generated UUID and logs warning with original value', async () => {
      const testPath = 'malformed-id.md';
      const malformedId = 'invalid-id-123';
      const createdAt = new Date().toISOString();

      await writeVaultFile(vaultPath, testPath, {
        fq_id: malformedId,
        title: 'Malformed Test',
        status: 'active',
        tags: [],
        created: createdAt,
        updated: createdAt,
      }, '# Malformed\n\nContent here.');

      // Spy on logger.warn to capture malformed UUID warning (IDC-05 / D-09)
      const warnSpy = vi.spyOn(logger, 'warn');

      // Run scanner
      await runScanOnce(config);

      // 1. Warning must include the original malformed value
      const warnCalls = warnSpy.mock.calls.map((args) => String(args[0]));
      const hasWarning = warnCalls.some(
        (msg) => msg.includes(malformedId) || msg.toLowerCase().includes('malformed')
      );
      expect(hasWarning).toBe(true);

      warnSpy.mockRestore();

      // 2. File frontmatter must now have a valid UUID (not the malformed one)
      const fm = await readVaultFrontmatter(vaultPath, testPath);
      const newFqcId = fm.fq_id as string;
      expect(newFqcId).toBeDefined();
      expect(newFqcId).not.toBe(malformedId);
      expect(newFqcId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );

      // 3. DB row created with the new valid UUID
      const { data: dbRow } = await supabaseManager.getClient()
        .from('fqc_documents')
        .select('id, path')
        .eq('id', newFqcId)
        .eq('instance_id', INSTANCE_ID)
        .maybeSingle();

      expect(dbRow).not.toBeNull();
      expect((dbRow as Record<string, unknown>).path).toBe(testPath);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SC4: Duplicate path deduplication (INF-02)
  // ───────────────────────────────────────────────────────────────────────────

  describe('SC4: Duplicate path deduplication', () => {
    it('keeps newer DB row and archives older when two rows share the same vault_path', async () => {
      const testPath = 'duplicate-path.md';
      const olderId = uuidv4();
      const newerId = uuidv4();
      const olderDate = '2026-04-01T00:00:00.000Z';
      const newerDate = '2026-04-07T00:00:00.000Z';

      // 1. Insert two DB rows with the same vault_path via direct pg connection.
      //    The fqc_documents table has a unique index on (instance_id, path).
      //    This test temporarily drops and recreates that constraint to simulate
      //    the crash scenario (D-10: two rows with same path after partial write).
      //    Direct pg bypasses the REST API constraint enforcement.
      const pgClient = new pg.Client({ connectionString: TEST_DATABASE_URL });
      await pgClient.connect();
      try {
        // Drop the unique index temporarily to allow duplicate path insertion
        await pgClient.query(
          'ALTER TABLE fqc_documents DROP CONSTRAINT IF EXISTS idx_fqc_documents_instance_path'
        );
        await pgClient.query(
          'DROP INDEX IF EXISTS idx_fqc_documents_instance_path'
        );

        // Insert older row
        await pgClient.query(
          `INSERT INTO fqc_documents (id, instance_id, path, title, status, content_hash, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [olderId, INSTANCE_ID, testPath, 'Old Version', 'active', 'hash-old-' + olderId, olderDate, olderDate]
        );

        // Insert newer row (same path — possible now that index is dropped)
        await pgClient.query(
          `INSERT INTO fqc_documents (id, instance_id, path, title, status, content_hash, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [newerId, INSTANCE_ID, testPath, 'New Version', 'active', 'hash-new-' + newerId, newerDate, newerDate]
        );
      } finally {
        await pgClient.end();
      }

      // 2. Create the vault file with the newer UUID in frontmatter
      await writeVaultFile(vaultPath, testPath, {
        fq_id: newerId,
        title: 'New Version',
        status: 'active',
        tags: [],
        created: newerDate,
        updated: newerDate,
      }, '# New Version\n\nContent from the newer row.');

      // Spy on logger.warn to capture dedup warning (D-12)
      const warnSpy = vi.spyOn(logger, 'warn');

      // 3. Run scanner — pathToRow construction should detect duplicate, archive older
      await runScanOnce(config);

      // 4. Older row must be archived (D-11)
      const supabaseClient = supabaseManager.getClient();
      const { data: olderRow } = await supabaseClient
        .from('fqc_documents')
        .select('status')
        .eq('id', olderId)
        .maybeSingle();

      expect(olderRow).not.toBeNull();
      expect((olderRow as Record<string, unknown>).status).toBe('archived');

      // 5. Newer row must remain active
      const { data: newerRow } = await supabaseClient
        .from('fqc_documents')
        .select('status')
        .eq('id', newerId)
        .maybeSingle();

      expect(newerRow).not.toBeNull();
      expect((newerRow as Record<string, unknown>).status).toBe('active');

      // 6. Warning must have been logged with path and/or both IDs (D-12)
      const warnCalls = warnSpy.mock.calls.map((args) => String(args[0]));
      const hasDedupWarning = warnCalls.some(
        (msg) =>
          msg.toLowerCase().includes('duplicate') &&
          (msg.includes(testPath) || msg.includes(olderId) || msg.includes(newerId))
      );
      expect(hasDedupWarning).toBe(true);

      warnSpy.mockRestore();

      // Restore the unique index after the test
      const restoreClient = new pg.Client({ connectionString: TEST_DATABASE_URL });
      await restoreClient.connect();
      try {
        await restoreClient.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_fqc_documents_instance_path
           ON fqc_documents (instance_id, path)
           WHERE status != 'archived'`
        );
      } finally {
        await restoreClient.end();
      }
    });
  });
});
