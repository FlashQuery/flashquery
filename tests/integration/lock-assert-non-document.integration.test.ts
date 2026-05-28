import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withDocumentLock } from '../../src/services/document-lock.js';
import { writeVaultFile } from '../../src/storage/vault-write.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: 'lock-assert-non-document',
      id: 'lock-assert-non-document',
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    server: { host: 'localhost', port: 0 },
    supabase: {
      url: 'http://localhost:54321',
      serviceRoleKey: 'test-key',
      databaseUrl: 'postgresql://localhost/test',
      skipDdl: true,
    },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    embedding: { provider: 'openai', model: 'text-embedding-3-small', dimensions: 1536 },
    locking: { enabled: false, lockTimeoutSeconds: 10 },
    logging: { level: 'error', output: 'stderr' },
  } as FlashQueryConfig;
}

describe('REQ-009 uniform writeVaultFile lock assertion for non-document callers', () => {
  let vaultPath: string;
  let previousLockAssert: string | undefined;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fq-lock-assert-non-document-'));
    previousLockAssert = process.env.FQC_LOCK_ASSERT;
    process.env.FQC_LOCK_ASSERT = 'true';
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
    if (previousLockAssert === undefined) {
      delete process.env.FQC_LOCK_ASSERT;
    } else {
      process.env.FQC_LOCK_ASSERT = previousLockAssert;
    }
  });

  it('T-I-052 rejects an unlocked infrastructure write and accepts it under withDocumentLock', async () => {
    const config = makeConfig(vaultPath);
    const backupPath = join(vaultPath, '.fqc', 'backup.json');

    await expect(
      writeVaultFile(backupPath, '{"unlocked":true}', { lockConfig: config })
    ).rejects.toThrow(
      `writeVaultFile(${backupPath}) called without holding withDocumentLock for that path`
    );

    await expect(
      withDocumentLock(config, backupPath, () =>
        writeVaultFile(backupPath, '{"locked":true}', { lockConfig: config })
      )
    ).resolves.toEqual({ contentHash: expect.any(String) });

    await expect(readFile(backupPath, 'utf8')).resolves.toBe('{"locked":true}');
  });
});
