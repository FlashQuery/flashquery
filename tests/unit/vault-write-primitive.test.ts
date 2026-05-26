import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeVaultFile } from '../../src/storage/vault-write.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'fqc-vault-write-primitive-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('writeVaultFile primitive', () => {
  it('T-U-028 writes exact bytes and returns their SHA-256 contentHash', async () => {
    const content = Buffer.from('hello durable vault\n', 'utf8');
    const target = join(testDir, 'note.md');

    const result = await writeVaultFile(target, content);

    expect(await readFile(target)).toEqual(content);
    expect(result.contentHash).toBe(createHash('sha256').update(content).digest('hex'));
    expect(result.contentHash).toHaveLength(64);
  });

  it('T-U-029 surfaces write failures and removes the temp file best-effort', async () => {
    const target = join(testDir, 'failure.md');
    const writeError = new Error('disk full during temp write');

    await expect(
      writeVaultFile(target, 'body', {
        operations: {
          writeFile: async () => {
            throw writeError;
          },
        },
      })
    ).rejects.toThrow(writeError);

    expect(existsSync(target)).toBe(false);
  });

  it('T-U-029 surfaces rename failures without replacing the destination', async () => {
    const target = join(testDir, 'existing.md');
    const renameError = new Error('rename denied');

    await writeVaultFile(target, 'old body');

    await expect(
      writeVaultFile(target, 'new body', {
        operations: {
          rename: async () => {
            throw renameError;
          },
        },
      })
    ).rejects.toThrow(renameError);

    expect(await readFile(target, 'utf8')).toBe('old body');
  });
});
