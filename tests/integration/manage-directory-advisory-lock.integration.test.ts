import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FlashQueryConfig } from '../../src/config/types.js';
import { closePgPools } from '../../src/utils/pg-client.js';
import { withDirectoryLockExclusive } from '../../src/services/document-lock.js';
import {
  HAS_SESSION_CAPABLE_DATABASE_URL,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../helpers/test-env.js';

function makeConfig(vaultPath: string, lockTimeoutSeconds = 1): FlashQueryConfig {
  return {
    instance: {
      name: 'manage-directory-advisory-lock-integration',
      id: 'manage-directory-advisory-lock-integration',
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: true,
    },
    locking: { enabled: true, lockTimeoutSeconds },
  } as FlashQueryConfig;
}

function createGate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe.skipIf(!HAS_SESSION_CAPABLE_DATABASE_URL)('REQ-024 manage-directory-advisory integration', () => {
  afterAll(async () => {
    await closePgPools();
  });

  it('T-I-046 manage-directory-advisory exclusive directory locks block a second structural holder', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'fq-manage-directory-advisory-'));
    const config = makeConfig(vault, 0.05);
    const holderEntered = createGate();
    const releaseHolder = createGate();

    try {
      await mkdir(join(vault, 'Folder'), { recursive: true });
      const holder = withDirectoryLockExclusive(config, join(vault, 'Folder'), async () => {
        holderEntered.release();
        await releaseHolder.promise;
      });
      await holderEntered.promise;

      await expect(
        withDirectoryLockExclusive(config, join(vault, 'Folder'), async () => 'second')
      ).rejects.toMatchObject({ reason: 'lock_timeout' });

      releaseHolder.release();
      await holder;
    } finally {
      releaseHolder.release();
      await rm(vault, { recursive: true, force: true });
    }
  }, 20_000);

  it('T-I-047 manage-directory-advisory different folder locks can proceed independently', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'fq-manage-directory-advisory-'));
    const config = makeConfig(vault);
    const entered: string[] = [];

    try {
      await mkdir(join(vault, 'A'), { recursive: true });
      await mkdir(join(vault, 'B'), { recursive: true });
      await Promise.all([
        withDirectoryLockExclusive(config, join(vault, 'A'), async () => entered.push('A')),
        withDirectoryLockExclusive(config, join(vault, 'B'), async () => entered.push('B')),
      ]);
      expect(entered.sort()).toEqual(['A', 'B']);
    } finally {
      await rm(vault, { recursive: true, force: true });
    }
  }, 20_000);
});
