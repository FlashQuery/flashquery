/**
 * Phase 38: Error Resilience Integration Tests
 *
 * Tests verify that the scanner completes every pass without corrupting DB state
 * when encountering error conditions:
 *   ERR-01: readFile permission error does not cause false deletion
 *   ERR-02: Binary file detection — file skipped with [BINARY_SKIP] warning
 *   ERR-03: Binary file with existing DB row stays active (not marked missing)
 *   ERR-04: Malformed YAML recovery via regex — fqc_id recovered, scan continues
 *   ERR-05: SCAN-04 existsSync protection — file not marked missing if it exists
 *   ERR-06: Write failure prevents orphaned DB row
 *
 * Environment: requires .env.test with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL
 * Run: npm run test:integration -- phase38-error-resilience.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  writeFileSync,
  chmodSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

import {
  TEST_SUPABASE_URL,
  TEST_SUPABASE_KEY,
  HAS_SUPABASE,
} from '../helpers/test-env.js';
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initVault, vaultManager } from '../../src/storage/vault.js';
import { runScanOnce } from '../../src/services/scanner.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test environment check
// ─────────────────────────────────────────────────────────────────────────────

const INSTANCE_ID = 'err-resilience-test';
const SKIP = !HAS_SUPABASE;

// ─────────────────────────────────────────────────────────────────────────────
// Test config factory
// ─────────────────────────────────────────────────────────────────────────────

function makeTestConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: 'err-resilience-test',
      id: INSTANCE_ID,
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: '',
      skipDdl: true,
    },
    embedding: {
      provider: 'none',
      model: '',
      dimensions: 0,
    },
    logging: { level: 'debug' as const, output: 'stdout' as const },
    server: { host: 'localhost', port: 0 },
    mcp: { transport: 'stdio' as const },
    git: { autoCommit: false, autoPush: false, remote: '', branch: 'main' },
    locking: { enabled: false, ttlSeconds: 30 },
  } as FlashQueryConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// Log capture helper
// ─────────────────────────────────────────────────────────────────────────────

function captureLogger(config: FlashQueryConfig): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  initLogger(config, (line: string) => {
    logs.push(line);
  });
  return {
    logs,
    restore: () => {
      // Re-init with null write (suppress output in tests)
      initLogger(config, () => {});
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers
// ─────────────────────────────────────────────────────────────────────────────

async function insertDbRow(
  supabase: SupabaseClient,
  fqcId: string,
  relativePath: string,
  contentHash = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaabbbbccccdddd',
  status = 'active'
): Promise<void> {
  const { error } = await supabase.from('fqc_documents').insert({
    id: fqcId,
    instance_id: INSTANCE_ID,
    path: relativePath,
    title: 'Test Document',
    status,
    content_hash: contentHash,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`insertDbRow failed: ${error.message}`);
}

async function getDbRow(
  supabase: SupabaseClient,
  fqcId: string
): Promise<{ status: string; id: string; path: string } | null> {
  const { data, error } = await supabase
    .from('fqc_documents')
    .select('id, status, path')
    .eq('id', fqcId)
    .single();
  if (error) return null;
  return data;
}

async function deleteDbRow(supabase: SupabaseClient, fqcId: string): Promise<void> {
  await supabase.from('fqc_documents').delete().eq('id', fqcId);
}

async function countDbRows(supabase: SupabaseClient, pathLike: string): Promise<number> {
  const { data, error } = await supabase
    .from('fqc_documents')
    .select('id')
    .eq('instance_id', INSTANCE_ID)
    .like('path', `%${pathLike}%`);
  if (error) return 0;
  return data?.length ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('Phase 38: Error Resilience', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;
  let supabase: SupabaseClient;

  beforeAll(async () => {
    vaultPath = join(tmpdir(), `fqc-err-resilience-${Date.now()}`);
    mkdirSync(vaultPath, { recursive: true });

    config = makeTestConfig(vaultPath);

    // Capture logs during init (suppress noise)
    initLogger(config, () => {});

    await initSupabase(config);
    initEmbedding(config);
    await initVault(config);

    supabase = supabaseManager.getClient();
  });

  afterAll(async () => {
    // Clean up all test DB rows
    try {
      await supabase
        .from('fqc_documents')
        .delete()
        .eq('instance_id', INSTANCE_ID);
    } catch (err) {
      console.warn('afterAll DB cleanup failed:', err instanceof Error ? err.message : String(err));
    }

    try {
      rmSync(vaultPath, { recursive: true, force: true });
    } catch (err) {
      console.warn('afterAll vault cleanup failed:', err instanceof Error ? err.message : String(err));
    }

    try {
      await supabaseManager.close();
    } catch (_) {}
  });

  beforeEach(async () => {
    // Clean DB rows for this instance before each test
    await supabase.from('fqc_documents').delete().eq('instance_id', INSTANCE_ID);
    // Re-init logger with suppressed output as default
    initLogger(config, () => {});
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // ERR-01: Permission error does not cause false deletion
  // ─────────────────────────────────────────────────────────────────────────────

  describe('ERR-01: Read error handling', () => {
    it('Permission error does not cause false deletion', async () => {
      // Skip on root (root can read any file regardless of permissions)
      if (process.getuid && process.getuid() === 0) {
        console.log('Skipping ERR-01: running as root, chmod has no effect');
        return;
      }

      const testId = uuidv4();
      const fileName = `err01-permission-${testId.slice(0, 8)}.md`;
      const filePath = join(vaultPath, fileName);

      // Setup: Create file with valid frontmatter
      writeFileSync(filePath, `---\nfq_id: ${testId}\ntitle: ERR-01 Test\nstatus: active\n---\n\nContent.`);

      // Insert DB row manually (active status)
      await insertDbRow(supabase, testId, fileName);

      // Capture logs
      const { logs } = captureLogger(config);

      try {
        // Remove read permission — scanner will get EACCES
        chmodSync(filePath, 0o000);

        // Action: Run scanner
        await runScanOnce(config);

        // Verify: log contains [READ_ERROR] with permission error
        const hasReadError = logs.some(
          (l) => l.includes('[READ_ERROR]') && (l.includes('EACCES') || l.includes('EPERM') || l.includes('permission'))
        );
        expect(hasReadError).toBe(true);

        // Verify: DB row is still active (not marked missing)
        const row = await getDbRow(supabase, testId);
        expect(row).toBeTruthy();
        expect(row?.status).toBe('active');
      } finally {
        // Restore permissions for cleanup
        try {
          chmodSync(filePath, 0o644);
        } catch (_) {}
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // ERR-02: Binary file detection
  // ─────────────────────────────────────────────────────────────────────────────

  describe('ERR-02: Binary file detection', () => {
    it('Binary file is skipped with [BINARY_SKIP] warning', async () => {
      const fileName = `err02-binary-${Date.now()}.md`;
      const filePath = join(vaultPath, fileName);

      // Setup: Create a .md file with null bytes in the first 8KB
      // This simulates a binary file that was accidentally given a .md extension
      const binaryContent = Buffer.concat([
        Buffer.from('Some text before null bytes '),
        Buffer.alloc(16, 0), // 16 null bytes (well within 8KB window)
        Buffer.from(' more text after'),
      ]);
      writeFileSync(filePath, binaryContent);

      const { logs } = captureLogger(config);

      try {
        // Action: Run scanner
        await runScanOnce(config);

        // Verify: log contains [BINARY_SKIP]
        const hasBinarySkip = logs.some((l) => l.includes('[BINARY_SKIP]') && l.includes(fileName));
        expect(hasBinarySkip).toBe(true);

        // Verify: no DB row was created for this file
        const count = await countDbRows(supabase, fileName);
        expect(count).toBe(0);
      } finally {
        try {
          rmSync(filePath, { force: true });
        } catch (_) {}
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // ERR-03: Binary file with existing DB row stays active
  // ─────────────────────────────────────────────────────────────────────────────

  describe('ERR-03: Binary file DB protection', () => {
    it('Binary file with existing DB row stays active (not marked missing)', async () => {
      const testId = uuidv4();
      const fileName = `err03-binary-existing-${testId.slice(0, 8)}.md`;
      const filePath = join(vaultPath, fileName);

      // Setup: First create a normal file and insert a DB row for it
      writeFileSync(filePath, `---\nfq_id: ${testId}\ntitle: Binary Existing Test\nstatus: active\n---\n\nNormal content.`);
      await insertDbRow(supabase, testId, fileName);

      // Now replace file content with binary (null bytes)
      const binaryContent = Buffer.concat([
        Buffer.from('---\nfq_id: '),
        Buffer.from(testId),
        Buffer.alloc(32, 0), // null bytes corrupt it
        Buffer.from('\n---\n'),
      ]);
      writeFileSync(filePath, binaryContent);

      const { logs } = captureLogger(config);

      try {
        // Action: Run scanner
        await runScanOnce(config);

        // Verify: log contains [BINARY_SKIP]
        const hasBinarySkip = logs.some((l) => l.includes('[BINARY_SKIP]') && l.includes(fileName));
        expect(hasBinarySkip).toBe(true);

        // Verify: DB row status is still active (not marked missing)
        const row = await getDbRow(supabase, testId);
        expect(row).toBeTruthy();
        expect(row?.status).toBe('active');
      } finally {
        try {
          rmSync(filePath, { force: true });
        } catch (_) {}
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // ERR-04: Malformed YAML recovery
  // ─────────────────────────────────────────────────────────────────────────────

  describe('ERR-04: Malformed YAML recovery', () => {
    it('Malformed YAML with recoverable fqc_id logs YAML_PARSE_ERROR and recovers', async () => {
      // Use a v4 UUID — embedded in both the fixture file and the inline fixture content below.
      // Must be a v4 UUID to pass isValidUuid() validation in the scanner.
      const fixtureFqcId = '19c19b07-3f01-41d5-b3f9-f18c86dd56dd';
      const fileName = `err04-malformed-${Date.now()}.md`;
      const filePath = join(vaultPath, fileName);

      // Setup: Copy the malformed-yaml fixture content to a temp file in vault
      const fixtureContent = `---\nfq_id: ${fixtureFqcId}\ntitle: "Broken Frontmatter\ndescription: missing closing quote\ntags: [broken, array, missing closing bracket\n---\n\nThis is the content of the malformed YAML fixture.`;
      writeFileSync(filePath, fixtureContent);

      const { logs } = captureLogger(config);

      try {
        // Action: Run scanner
        await runScanOnce(config);

        // Verify: log contains [YAML_PARSE_ERROR]
        const hasYamlError = logs.some((l) => l.includes('[YAML_PARSE_ERROR]') && l.includes(fileName));
        expect(hasYamlError).toBe(true);

        // Verify: fqc_id was recovered via regex
        // Log format: [YAML_PARSE_ERROR] recovered valid fqc_id="<uuid>" via regex
        const yamlLogs = logs.filter((l) => l.includes('[YAML_PARSE_ERROR]'));
        const hasRecovery = yamlLogs.some(
          (l) => l.includes('recovered valid fqc_id') && l.includes(fixtureFqcId)
        );
        expect(hasRecovery).toBe(true);

        // Verify: scan did not abort — it completed and processed the file
        // (The file should have been processed — either a DB row created or reconnected)
        // Since there's no existing DB row for this fqc_id, it should be adopted (IDC-04)
        const count = await countDbRows(supabase, fileName);
        expect(count).toBeGreaterThan(0);
      } finally {
        try {
          rmSync(filePath, { force: true });
          // Clean up any DB row that was created
          await supabase.from('fqc_documents').delete().eq('instance_id', INSTANCE_ID);
        } catch (_) {}
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // ERR-05: SCAN-04 existsSync protection
  // ─────────────────────────────────────────────────────────────────────────────

  describe('ERR-05: SCAN-04 existsSync protection', () => {
    it('File with existing DB row not marked missing when file exists but has different hash', async () => {
      // This test verifies the existsSync guard in SCAN-04.
      //
      // Scenario: A file exists at a path, but its DB row (from a previous fqc_id)
      // was not encountered in seenFqcIds during the main scan pass. The SCAN-04
      // loop calls existsSync and finds the file still exists → row NOT marked missing.
      //
      // We achieve "not in seenFqcIds" by inserting a DB row with a different fqc_id
      // than what the file contains, so the file creates a new identity while the
      // old row is not seen.

      const oldFqcId = uuidv4();
      const fileName = `err05-existsync-${Date.now()}.md`;
      const filePath = join(vaultPath, fileName);

      // Setup: Insert a DB row for "oldFqcId" at the file's path
      await insertDbRow(supabase, oldFqcId, fileName);

      // Create a file WITHOUT the matching fqc_id so it goes through Tier 4 (new file)
      // The old DB row (oldFqcId) won't be in seenFqcIds since the file has a different UUID
      const newFqcId = uuidv4();
      writeFileSync(
        filePath,
        `---\nfq_id: ${newFqcId}\ntitle: ERR-05 ExistsSync Test\nstatus: active\n---\n\nContent.`
      );

      // Compute real hash of file content for the new row
      // (The old row has a synthetic hash that won't match)

      const { logs } = captureLogger(config);

      try {
        // Action: Run scanner
        await runScanOnce(config);

        // Verify: [SCAN-04] verifying log appears for the old row
        const hasScan04Verify = logs.some(
          (l) => l.includes('[SCAN-04]') && l.includes('verifying file missing')
        );
        expect(hasScan04Verify).toBe(true);

        // Verify: The old DB row is NOT marked missing (existsSync returns true)
        // The file exists at the path, so existsSync(path) → true → row stays active
        const oldRow = await getDbRow(supabase, oldFqcId);
        // WR-04: assert unconditionally — row must exist (not deleted or merged away)
        expect(oldRow).toBeTruthy();
        expect(oldRow?.status).not.toBe('missing');

        // Verify: "file exists but was skipped" log appears for the old row
        const hasSkippedLog = logs.some(
          (l) => l.includes('[SCAN-04]') && l.includes('file exists but was skipped')
        );
        // The [SCAN-04] skipped log must appear — old fqc_id was not seen and file still exists
        expect(hasSkippedLog).toBe(true);
      } finally {
        try {
          rmSync(filePath, { force: true });
          await supabase.from('fqc_documents').delete().eq('id', oldFqcId);
          await supabase.from('fqc_documents').delete().eq('id', newFqcId);
        } catch (_) {}
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // ERR-06: Write failure prevents DB row insertion
  // ─────────────────────────────────────────────────────────────────────────────

  describe('ERR-06: Write error handling', () => {
    it('Write failure logs [WRITE_ERROR] and does not insert DB row', async () => {
      const fileName = `err06-write-fail-${Date.now()}.md`;
      const filePath = join(vaultPath, fileName);

      // Setup: Create a new file without fqc_id — this will trigger the Tier 4 (NEW FILE) branch
      // which calls vaultManager.writeMarkdown() and then inserts a DB row
      writeFileSync(filePath, `# ERR-06 Write Failure Test\n\nContent without frontmatter.`);

      // WR-05: capture original before the try block, install mock inside try so
      // the finally restore is always reachable even if captureLogger throws
      const originalWriteMarkdown = vaultManager.writeMarkdown.bind(vaultManager);
      let writeCallCount = 0;

      const { logs } = captureLogger(config);

      try {
        // Install mock inside try — ensures finally always restores it
        vaultManager.writeMarkdown = async (relativePath, frontmatter, content, options) => {
          if (relativePath === fileName) {
            writeCallCount++;
            throw new Error('ENOSPC: no space left on device');
          }
          // Allow writes for other files (if any)
          return originalWriteMarkdown(relativePath, frontmatter, content, options);
        };

        // Action: Run scanner
        await runScanOnce(config);

        // Verify: write was attempted for our file
        expect(writeCallCount).toBeGreaterThan(0);

        // Verify: log contains [WRITE_ERROR] with the error message
        const hasWriteError = logs.some(
          (l) => l.includes('[WRITE_ERROR]') && l.includes(fileName)
        );
        expect(hasWriteError).toBe(true);

        // Verify: no DB row was inserted for this file
        const count = await countDbRows(supabase, fileName);
        expect(count).toBe(0);

        // Verify: the file still exists (scanner didn't delete it)
        expect(existsSync(filePath)).toBe(true);

        // Verify: file still has no fqc_id in frontmatter (write was blocked)
        const fileContent = readFileSync(filePath, 'utf-8');
        // The original file had no frontmatter at all
        expect(fileContent).not.toMatch(/^---/);
      } finally {
        // Restore original writeMarkdown
        vaultManager.writeMarkdown = originalWriteMarkdown;
        try {
          rmSync(filePath, { force: true });
        } catch (_) {}
      }
    });
  });
});
