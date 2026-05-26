import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initLogger } from '../../src/logging/logger.js';

function initTestLogger(): void {
  initLogger({
    logging: { level: 'error', output: 'stdout' },
  } as Parameters<typeof initLogger>[0]);
}

describe('atomicWriteFrontmatter durable write routing', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('T-I-039 propagates writeVaultFile failures to the caller', async () => {
    const vaultPath = await mkdtemp(join(tmpdir(), 'fqc-atomic-frontmatter-'));
    const docPath = join(vaultPath, 'note.md');
    const writeError = new Error('injected durable write failure');

    initTestLogger();
    await writeFile(docPath, ['---', 'fq_title: Existing', '---', 'body'].join('\n'), 'utf8');

    vi.doMock('../../src/storage/vault-write.js', () => ({
      writeVaultFile: vi.fn(async () => {
        throw writeError;
      }),
    }));

    try {
      const { atomicWriteFrontmatter } = await import('../../src/utils/frontmatter.js');

      await expect(atomicWriteFrontmatter(docPath, { fq_owner: 'plugin-a' })).rejects.toThrow(
        writeError
      );
    } finally {
      await rm(vaultPath, { recursive: true, force: true });
    }
  });
});
