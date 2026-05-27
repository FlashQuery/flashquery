import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FlashQueryConfig } from '../../src/config/types.js';
import { __testing, LockTimeoutError, withDocumentLock } from '../../src/services/document-lock.js';
import { closePgPools } from '../../src/utils/pg-client.js';
import {
  HAS_SESSION_CAPABLE_DATABASE_URL,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../helpers/test-env.js';

function makeConfig(vaultPath: string, lockTimeoutSeconds?: number): FlashQueryConfig {
  return {
    instance: {
      name: 'lock-timeout-integration',
      id: 'lock-timeout-integration',
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: true,
    },
    locking: { enabled: true, lockTimeoutSeconds: lockTimeoutSeconds ?? 10 },
  } as FlashQueryConfig;
}

function advisoryKeyForResource(resource: string): string {
  const digest = createHash('sha256').update(resource).digest();
  return digest.readBigInt64BE(0).toString();
}

async function holdAdvisoryLock(key: string, holdMs: number): Promise<Promise<void>> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await client.query('SELECT pg_advisory_lock($1::bigint)', [key]);
  return new Promise((resolve) => {
    setTimeout(() => {
      void client
        .query('SELECT pg_advisory_unlock($1::bigint)', [key])
        .finally(() => client.end())
        .finally(resolve);
    }, holdMs);
  });
}

describe.skipIf(!HAS_SESSION_CAPABLE_DATABASE_URL)('REQ-006 lock-timeout integration', () => {
  afterAll(async () => {
    await closePgPools();
  });

  it('T-I-009 lock-timeout default returns a typed timeout when a real advisory lock remains contended', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'fq-lock-timeout-'));
    const filePath = join(vault, 'Busy.md');
    await writeFile(filePath, 'busy');
    const config = makeConfig(vault);
    const entry = await __testing.deriveDocumentLockEntry(config, filePath);

    try {
      const holderDone = await holdAdvisoryLock(advisoryKeyForResource(entry.resource), 12_000);

      const started = Date.now();
      await expect(withDocumentLock(config, filePath, async () => 'done')).rejects.toBeInstanceOf(LockTimeoutError);
      expect(Date.now() - started).toBeGreaterThanOrEqual(9_500);
      await holderDone;
    } finally {
      await rm(vault, { recursive: true, force: true });
    }
  }, 20_000);

  it('T-I-010 lock-timeout configured allows a contender to acquire after the holder releases', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'fq-lock-timeout-'));
    const filePath = join(vault, 'Patient.md');
    await writeFile(filePath, 'patient');
    const config = makeConfig(vault, 30);
    const entry = await __testing.deriveDocumentLockEntry(config, filePath);

    try {
      const holderDone = await holdAdvisoryLock(advisoryKeyForResource(entry.resource), 12_000);

      await expect(withDocumentLock(config, filePath, async () => 'acquired')).resolves.toBe('acquired');
      await holderDone;
    } finally {
      await rm(vault, { recursive: true, force: true });
    }
  }, 35_000);
});
