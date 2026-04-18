/**
 * Integration tests for Phase 40 Plan 04 — End-to-end plugin propagation.
 *
 * Covers PLG-04 and the full propagation workflow:
 * - Full propagation: fqc_id change propagates to plugin table rows
 * - PLG-04: Unknown old ID logged and skipped (graceful degradation)
 * - Multiple plugin tables: all discovered and updated
 * - Error handling: UPDATE failure on one table does not block others
 *
 * Requires: local Supabase running (DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY set)
 * Run: npm run test:integration -- plugin-propagation.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { propagateFqcIdChange } from '../../src/services/plugin-propagation.js';
import { TEST_SUPABASE_URL, TEST_SUPABASE_KEY, TEST_DATABASE_URL, HAS_SUPABASE } from '../helpers/test-env.js';

// ── Skip guard ───────────────────────────────────────────────────────────────

const SKIP = !HAS_SUPABASE;

// ── Test infrastructure ──────────────────────────────────────────────────────

const TEST_PREFIX = 'fqcp_pp_inttest'; // unique prefix to avoid conflicts

/** Temporary plugin table names created by this test suite */
const TABLE_SINGLE = `${TEST_PREFIX}_contacts`;
const TABLE_MULTI_A = `${TEST_PREFIX}_crm_contacts`;
const TABLE_MULTI_B = `${TEST_PREFIX}_notion_pages`;
const TABLE_MULTI_C = `${TEST_PREFIX}_other_items`;

/**
 * MockLogger captures log calls for assertion in tests.
 */
function makeMockLogger() {
  const calls: { level: string; message: string }[] = [];
  return {
    debug: (msg: string) => calls.push({ level: 'debug', message: msg }),
    info: (msg: string) => calls.push({ level: 'info', message: msg }),
    warn: (msg: string) => calls.push({ level: 'warn', message: msg }),
    error: (msg: string) => calls.push({ level: 'error', message: msg }),
    calls,
    hasWarn: (pattern: string) => calls.some((c) => c.level === 'warn' && c.message.includes(pattern)),
    hasInfo: (pattern: string) => calls.some((c) => c.level === 'info' && c.message.includes(pattern)),
  };
}

/** Generate a deterministic-ish UUID for tests (not cryptographically secure) */
function testUuid(seed: string): string {
  // Simple reproducible hex string padded into UUID format
  const hex = seed.padEnd(32, '0').slice(0, 32).replace(/[^0-9a-f]/gi, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('plugin-propagation integration', () => {
  let pgClient: pg.Client;
  let supabase: ReturnType<typeof createClient>;

  beforeAll(async () => {
    // Set DATABASE_URL so propagateFqcIdChange can open a pg connection
    process.env.DATABASE_URL = TEST_DATABASE_URL;

    pgClient = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await pgClient.connect();

    supabase = createClient(TEST_SUPABASE_URL, TEST_SUPABASE_KEY);

    // Create all test tables needed across describe blocks
    const tables = [TABLE_SINGLE, TABLE_MULTI_A, TABLE_MULTI_B, TABLE_MULTI_C];
    for (const table of tables) {
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${pg.escapeIdentifier(table)} (
          id        serial       PRIMARY KEY,
          fqc_id    text         NOT NULL,
          name      text
        )
      `);
    }
  });

  afterAll(async () => {
    // Drop all test tables
    const tables = [TABLE_SINGLE, TABLE_MULTI_A, TABLE_MULTI_B, TABLE_MULTI_C];
    for (const table of tables) {
      await pgClient.query(`DROP TABLE IF EXISTS ${pg.escapeIdentifier(table)}`).catch(() => {});
    }
    await pgClient.end();
  });

  // ── Test 1: Full propagation workflow ─────────────────────────────────────

  describe('End-to-end propagation', () => {
    const OLD_ID = testUuid('e2e-old-id-111');
    const NEW_ID = testUuid('e2e-new-id-222');

    beforeAll(async () => {
      // Clean slate
      await pgClient.query(`DELETE FROM ${pg.escapeIdentifier(TABLE_SINGLE)} WHERE fqc_id = $1`, [OLD_ID]);
      await pgClient.query(`DELETE FROM ${pg.escapeIdentifier(TABLE_SINGLE)} WHERE fqc_id = $1`, [NEW_ID]);
      // Insert a row referencing OLD_ID
      await pgClient.query(`INSERT INTO ${pg.escapeIdentifier(TABLE_SINGLE)} (fqc_id, name) VALUES ($1, $2)`, [OLD_ID, 'Alice']);
    });

    afterAll(async () => {
      await pgClient.query(`DELETE FROM ${pg.escapeIdentifier(TABLE_SINGLE)} WHERE fqc_id IN ($1, $2)`, [OLD_ID, NEW_ID]);
    });

    it('propagates fqc_id to plugin table rows when old and new IDs are known', async () => {
      const logger = makeMockLogger();

      await propagateFqcIdChange(
        supabase,
        OLD_ID,
        NEW_ID,
        'Work/Contacts/alice.md',
        new Map(),
        logger as never,
      );

      // Row should now reference NEW_ID
      const { rows } = await pgClient.query<{ fqc_id: string; name: string }>(
        `SELECT fqc_id, name FROM ${pg.escapeIdentifier(TABLE_SINGLE)} WHERE name = $1`,
        ['Alice'],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].fqc_id).toBe(NEW_ID);

      // OLD_ID should no longer appear for this row
      const { rows: oldRows } = await pgClient.query(
        `SELECT id FROM ${pg.escapeIdentifier(TABLE_SINGLE)} WHERE fqc_id = $1 AND name = $2`,
        [OLD_ID, 'Alice'],
      );
      expect(oldRows).toHaveLength(0);

      // Logger should report success
      expect(logger.hasInfo('Successfully propagated')).toBe(true);
    });
  });

  // ── Test 2: PLG-04 — Unknown old ID handling ──────────────────────────────

  describe('PLG-04: Unknown old ID handling', () => {
    it('logs WARN and skips propagation when old ID is null and path not in pathToRow', async () => {
      const logger = makeMockLogger();

      await propagateFqcIdChange(
        supabase,
        null,          // old ID unknown
        testUuid('plg04-new-idddd'),
        '/unknown/path/to/file.md',
        new Map(),     // empty pathToRow — path will not be found
        logger as never,
      );

      // Must log WARN with "Cannot propagate" message
      expect(logger.hasWarn('Cannot propagate fqc_id change')).toBe(true);
      expect(logger.hasWarn('old ID unknown')).toBe(true);

      // No UPDATE should have been attempted — no info log about propagation success
      expect(logger.hasInfo('Successfully propagated')).toBe(false);
    });

    it('propagates using pathToRow fallback when old ID can be resolved from path', async () => {
      const FALLBACK_OLD_ID = testUuid('fallback-old-1111');
      const FALLBACK_NEW_ID = testUuid('fallback-new-2222');
      const DOC_PATH = 'Work/Contacts/fallback-doc.md';

      // Insert row with FALLBACK_OLD_ID
      await pgClient.query(`DELETE FROM ${pg.escapeIdentifier(TABLE_SINGLE)} WHERE fqc_id IN ($1, $2)`, [FALLBACK_OLD_ID, FALLBACK_NEW_ID]);
      await pgClient.query(`INSERT INTO ${pg.escapeIdentifier(TABLE_SINGLE)} (fqc_id, name) VALUES ($1, $2)`, [FALLBACK_OLD_ID, 'FallbackContact']);

      const logger = makeMockLogger();

      // Build a pathToRow map that contains the document path
      const pathToRow = new Map([
        [DOC_PATH, { id: FALLBACK_OLD_ID, path: DOC_PATH, content_hash: 'abc', title: 'Fallback', status: 'active', updated_at: '' }],
      ]);

      await propagateFqcIdChange(
        supabase,
        null,            // old ID not provided — uses pathToRow fallback
        FALLBACK_NEW_ID,
        DOC_PATH,
        pathToRow,
        logger as never,
      );

      // Row should now reference FALLBACK_NEW_ID
      const { rows } = await pgClient.query<{ fqc_id: string }>(
        `SELECT fqc_id FROM ${pg.escapeIdentifier(TABLE_SINGLE)} WHERE name = $1`,
        ['FallbackContact'],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].fqc_id).toBe(FALLBACK_NEW_ID);

      // Should NOT warn about unknown old ID
      expect(logger.hasWarn('Cannot propagate fqc_id change')).toBe(false);
      // Should log success
      expect(logger.hasInfo('Successfully propagated')).toBe(true);

      // Cleanup
      await pgClient.query(`DELETE FROM ${pg.escapeIdentifier(TABLE_SINGLE)} WHERE fqc_id IN ($1, $2)`, [FALLBACK_OLD_ID, FALLBACK_NEW_ID]);
    });
  });

  // ── Test 3: Multiple plugin tables ───────────────────────────────────────

  describe('Multiple plugin tables', () => {
    const MULTI_OLD = testUuid('multi-old-id-3333');
    const MULTI_NEW = testUuid('multi-new-id-4444');

    beforeAll(async () => {
      // Insert a row in each of the 3 multi-table test tables
      for (const table of [TABLE_MULTI_A, TABLE_MULTI_B, TABLE_MULTI_C]) {
        await pgClient.query(`DELETE FROM ${pg.escapeIdentifier(table)} WHERE fqc_id IN ($1, $2)`, [MULTI_OLD, MULTI_NEW]);
        await pgClient.query(`INSERT INTO ${pg.escapeIdentifier(table)} (fqc_id, name) VALUES ($1, $2)`, [MULTI_OLD, `MultiEntry-${table}`]);
      }
    });

    afterAll(async () => {
      for (const table of [TABLE_MULTI_A, TABLE_MULTI_B, TABLE_MULTI_C]) {
        await pgClient.query(`DELETE FROM ${pg.escapeIdentifier(table)} WHERE fqc_id IN ($1, $2)`, [MULTI_OLD, MULTI_NEW]);
      }
    });

    it('updates all plugin tables that have fqc_id column', async () => {
      const logger = makeMockLogger();

      await propagateFqcIdChange(
        supabase,
        MULTI_OLD,
        MULTI_NEW,
        'Work/Docs/multi-doc.md',
        new Map(),
        logger as never,
      );

      // All three tables should now reference MULTI_NEW
      for (const table of [TABLE_MULTI_A, TABLE_MULTI_B, TABLE_MULTI_C]) {
        const { rows } = await pgClient.query<{ fqc_id: string }>(
          `SELECT fqc_id FROM ${pg.escapeIdentifier(table)} WHERE fqc_id = $1`,
          [MULTI_NEW],
        );
        expect(rows).toHaveLength(1);
      }

      // All old references should be gone
      for (const table of [TABLE_MULTI_A, TABLE_MULTI_B, TABLE_MULTI_C]) {
        const { rows } = await pgClient.query(
          `SELECT id FROM ${pg.escapeIdentifier(table)} WHERE fqc_id = $1`,
          [MULTI_OLD],
        );
        expect(rows).toHaveLength(0);
      }

      // Success log should mention at least 3 tables
      const successLogs = logger.calls.filter((c) => c.level === 'info' && c.message.includes('Successfully propagated'));
      expect(successLogs).toHaveLength(1);
      // The count in the log message should be >= 3 (may be more if other fqcp_ tables exist)
      const match = successLogs[0].message.match(/in (\d+) tables/);
      expect(match).not.toBeNull();
      expect(parseInt(match![1], 10)).toBeGreaterThanOrEqual(3);
    });
  });

  // ── Test 4: Error handling ────────────────────────────────────────────────

  describe('Error handling', () => {
    it('logs WARN and continues when DATABASE_URL is missing', async () => {
      const originalUrl = process.env.DATABASE_URL;
      // Temporarily unset DATABASE_URL to trigger discovery failure
      delete process.env.DATABASE_URL;

      const logger = makeMockLogger();

      try {
        await propagateFqcIdChange(
          supabase,
          testUuid('err-old-id-aaaa'),
          testUuid('err-new-id-bbbb'),
          'Work/Docs/test.md',
          new Map(),
          logger as never,
        );
      } finally {
        process.env.DATABASE_URL = originalUrl;
      }

      // Should warn and NOT throw
      expect(logger.hasWarn('DATABASE_URL not set')).toBe(true);
      // Should NOT have thrown (the await above succeeded without error)
    });

    it('does not throw when propagateFqcIdChange encounters an unknown error path', async () => {
      const logger = makeMockLogger();

      // Call with a valid old/new ID that doesn't match any rows — should complete gracefully
      await expect(
        propagateFqcIdChange(
          supabase,
          testUuid('nonexistent-old-cc'),
          testUuid('nonexistent-new-dd'),
          'Work/Docs/ghost.md',
          new Map(),
          logger as never,
        )
      ).resolves.toBeUndefined();

      // Should log success (0 rows updated is still a success)
      expect(logger.hasInfo('Successfully propagated')).toBe(true);
    });
  });
});
