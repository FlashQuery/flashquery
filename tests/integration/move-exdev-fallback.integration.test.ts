import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, basename } from 'node:path';
import { HAS_SESSION_CAPABLE_DATABASE_URL } from '../helpers/test-env.js';
import {
  createPhase155Harness,
  parseToolJson,
  writeDocument,
  type Phase155Harness,
} from './vault-write-coherency-phase155-helpers.js';

const fsFaults = vi.hoisted(() => ({
  failNextRenameWithExdev: false,
  failNextWriteFileAfterWrite: false,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: vi.fn(async (...args: Parameters<typeof actual.rename>) => {
      if (fsFaults.failNextRenameWithExdev) {
        fsFaults.failNextRenameWithExdev = false;
        throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
      }
      return actual.rename(...args);
    }),
    writeFile: vi.fn(async (...args: Parameters<typeof actual.writeFile>) => {
      await actual.writeFile(...args);
      if (fsFaults.failNextWriteFileAfterWrite) {
        fsFaults.failNextWriteFileAfterWrite = false;
        throw new Error('simulated durable temp write failure');
      }
    }),
  };
});

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

async function listVaultTempFiles(filePath: string): Promise<string[]> {
  const names = await readdir(dirname(filePath));
  const prefix = `${basename(filePath)}.fqc-tmp-`;
  return names.filter((name) => name.startsWith(prefix));
}

describe.skipIf(!HAS_SESSION_CAPABLE_DATABASE_URL)('REQ-022 move-exdev integration fallback', () => {
  let harness: Phase155Harness;
  const previousLockAssert = process.env.FQC_LOCK_ASSERT;

  beforeEach(async () => {
    fsFaults.failNextRenameWithExdev = false;
    fsFaults.failNextWriteFileAfterWrite = false;
    harness = await createPhase155Harness('fqc-move-exdev-');
    harness.config.locking = { enabled: true, lockTimeoutSeconds: 1 };
    process.env.FQC_LOCK_ASSERT = 'true';
  });

  afterAll(() => {
    if (previousLockAssert === undefined) {
      delete process.env.FQC_LOCK_ASSERT;
    } else {
      process.env.FQC_LOCK_ASSERT = previousLockAssert;
    }
  });

  afterEach(async () => {
    fsFaults.failNextRenameWithExdev = false;
    fsFaults.failNextWriteFileAfterWrite = false;
    await harness?.cleanup();
  });

  it('T-I-042 commits the destination and unlinks the source after an EXDEV fallback', async () => {
    await writeDocument(harness.handlers, 'phase161/source.md', 'Source', 'source body');

    fsFaults.failNextRenameWithExdev = true;
    const result = await harness.handlers.move_document({
      identifier: 'phase161/source.md',
      destination: 'phase161/dest.md',
    }) as ToolResult;

    expect(result.isError).toBeFalsy();
    expect(parseToolJson(result)).toMatchObject({ path: 'phase161/dest.md' });
    expect(existsSync(`${harness.vaultPath}/phase161/source.md`)).toBe(false);
    await expect(readFile(`${harness.vaultPath}/phase161/dest.md`, 'utf-8')).resolves.toContain(
      'source body'
    );
    await expect(listVaultTempFiles(`${harness.vaultPath}/phase161/dest.md`)).resolves.toEqual([]);
  }, 40_000);

  it('T-I-042 durable commit failure leaves source intact and no partial destination', async () => {
    await writeDocument(harness.handlers, 'phase161/source-fail.md', 'Source Fail', 'source body');

    fsFaults.failNextRenameWithExdev = true;
    fsFaults.failNextWriteFileAfterWrite = true;
    const result = await harness.handlers.move_document({
      identifier: 'phase161/source-fail.md',
      destination: 'phase161/dest-fail.md',
    }) as ToolResult;

    expect(result.isError).toBe(true);
    expect(parseToolJson(result)).toMatchObject({
      error: 'runtime_error',
      message: expect.stringContaining('simulated durable temp write failure'),
    });
    expect(existsSync(`${harness.vaultPath}/phase161/source-fail.md`)).toBe(true);
    expect(existsSync(`${harness.vaultPath}/phase161/dest-fail.md`)).toBe(false);
    await expect(listVaultTempFiles(`${harness.vaultPath}/phase161/dest-fail.md`)).resolves.toEqual(
      []
    );
  }, 40_000);
});
