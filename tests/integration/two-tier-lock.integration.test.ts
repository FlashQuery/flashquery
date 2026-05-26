import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { withDocumentLock } from '../../src/services/document-lock.js';
import { closePgPools } from '../../src/utils/pg-client.js';
import { HAS_SUPABASE, TEST_DATABASE_URL, TEST_SUPABASE_KEY, TEST_SUPABASE_URL } from '../helpers/test-env.js';
import type { FlashQueryConfig } from '../../src/config/types.js';

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'two-tier-lock-integration',
      id: 'two-tier-lock-integration',
      vault: { path: '/tmp/vault', markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: true,
    },
    locking: { enabled: true, ttlSeconds: 30 },
  } as FlashQueryConfig;
}

function advisoryKeyForPath(filePath: string): string {
  const digest = createHash('sha256').update(`document:${filePath}`).digest();
  return digest.readBigInt64BE(0).toString();
}

async function advisoryLockVisible(client: PoolClient, key: string): Promise<boolean> {
  const result = await client.query<{ visible: boolean }>(
    `SELECT EXISTS (
      SELECT 1
      FROM pg_locks
      WHERE locktype = 'advisory'
        AND objsubid = 1
        AND granted = true
        AND ((classid::bigint << 32) | objid::bigint) = $1::bigint
    ) AS visible`,
    [key]
  );
  return result.rows[0]?.visible === true;
}

function createGate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe.skipIf(!HAS_SUPABASE)('REQ-002 two-tier advisory-lock integration', () => {
  afterAll(async () => {
    await closePgPools();
  });

  it('T-I-003 two-tier advisory-lock sessions cannot both hold the same file lock at once', async () => {
    const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, allowExitOnIdle: true });
    const observer = await pool.connect();
    const filePath = '/tmp/vault/two-tier-same-file.md';
    const key = advisoryKeyForPath(filePath);
    const holderEntered = createGate();
    const releaseHolder = createGate();
    const secondEntered = createGate();
    let secondInside = false;

    try {
      const first = withDocumentLock(makeConfig(), filePath, async () => {
        holderEntered.release();
        await releaseHolder.promise;
      });
      await holderEntered.promise;
      expect(await advisoryLockVisible(observer, key)).toBe(true);

      const second = withDocumentLock(makeConfig(), filePath, async () => {
        secondInside = true;
        secondEntered.release();
      });
      await expect(
        Promise.race([secondEntered.promise.then(() => 'entered'), new Promise((resolve) => setTimeout(() => resolve('waiting'), 150))])
      ).resolves.toBe('waiting');
      expect(secondInside).toBe(false);

      releaseHolder.release();
      await Promise.all([first, second]);
      expect(secondInside).toBe(true);
    } finally {
      releaseHolder.release();
      observer.release();
      await pool.end();
    }
  }, 20_000);

  it('T-I-004 two-tier advisory-lock session end releases a held lock without manual recovery', async () => {
    const holder = new pg.Client({ connectionString: TEST_DATABASE_URL });
    const contender = new pg.Client({ connectionString: TEST_DATABASE_URL });
    const filePath = '/tmp/vault/two-tier-session-end.md';
    const key = advisoryKeyForPath(filePath);

    try {
      await holder.connect();
      await contender.connect();
      await holder.query('SELECT pg_advisory_lock($1::bigint)', [key]);
      const blocked = await contender.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock($1::bigint) AS acquired', [key]);
      expect(blocked.rows[0]?.acquired).toBe(false);

      await holder.end();

      await expect
        .poll(async () => {
          const result = await contender.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock($1::bigint) AS acquired', [key]);
          if (result.rows[0]?.acquired === true) {
            await contender.query('SELECT pg_advisory_unlock($1::bigint)', [key]);
            return true;
          }
          return false;
        })
        .toBe(true);
    } finally {
      await contender.end().catch(() => undefined);
    }
  }, 20_000);
});
