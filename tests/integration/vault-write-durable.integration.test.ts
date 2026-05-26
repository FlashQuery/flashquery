import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanStaleTempFiles } from '../../src/storage/vault.js';
import { initLogger } from '../../src/logging/logger.js';

let vaultPath: string;

beforeEach(() => {
  vaultPath = mkdtempSync(join(tmpdir(), 'fqc-vault-write-durable-'));
  initLogger({
    logging: { level: 'error', output: 'stdout' },
  } as Parameters<typeof initLogger>[0]);
});

afterEach(() => {
  rmSync(vaultPath, { recursive: true, force: true });
});

describe('vault write durability integration', () => {
  it('T-I-041 removes legacy and unique stale temp files while preserving markdown files', async () => {
    const normalFile = join(vaultPath, 'note.md');
    const legacyTemp = join(vaultPath, 'note.md.fqc-tmp');
    const uniqueTemp = join(vaultPath, 'note.md.fqc-tmp-12345-7-abcdef12-3456-7890-abcd-ef1234567890');

    writeFileSync(normalFile, '# Note\n');
    writeFileSync(legacyTemp, 'legacy temp');
    writeFileSync(uniqueTemp, 'unique temp');

    await cleanStaleTempFiles(vaultPath);

    expect(existsSync(normalFile)).toBe(true);
    expect(existsSync(legacyTemp)).toBe(false);
    expect(existsSync(uniqueTemp)).toBe(false);
  });
});
