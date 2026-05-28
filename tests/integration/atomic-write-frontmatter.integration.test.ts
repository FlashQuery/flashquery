import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { initLogger } from '../../src/logging/logger.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

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

  it('T-I-040 writes frontmatter through writeVaultFile under caller-held document locks', async () => {
    vi.doUnmock('../../src/storage/vault-write.js');
    const vaultPath = await mkdtemp(join(tmpdir(), 'fqc-atomic-frontmatter-locks-'));
    const docPath = join(vaultPath, 'locked.md');
    const config = {
      instance: {
        name: 'frontmatter-lock-test',
        id: 'frontmatter-lock-test',
        vault: { path: vaultPath, markdownExtensions: ['.md'] },
      },
      supabase: { databaseUrl: 'postgresql://unused' },
      locking: { enabled: false, lockTimeoutSeconds: 10 },
      logging: { level: 'error', output: 'stdout' },
    } as unknown as FlashQueryConfig;

    await writeFile(docPath, ['---', 'fq_title: Locked', '---', 'body'].join('\n'), 'utf8');

    try {
      const { initLogger: initDynamicLogger } = await import('../../src/logging/logger.js');
      const { atomicWriteFrontmatter } = await import('../../src/utils/frontmatter.js');
      const { withAncestorDirectoryLocksShared, withDocumentLock } = await import('../../src/services/document-lock.js');
      initDynamicLogger(config);
      await withAncestorDirectoryLocksShared(config, docPath, () =>
        withDocumentLock(config, docPath, () =>
          atomicWriteFrontmatter(docPath, { fq_owner: 'plugin-a' }, config)
        )
      );

      expect(await readFile(docPath, 'utf8')).toContain('fq_owner: plugin-a');
    } finally {
      await rm(vaultPath, { recursive: true, force: true });
    }
  });

  it('T-I-040 routes vault markdown and frontmatter writes through writeVaultFile', async () => {
    const previousLockAssert = process.env.FQC_LOCK_ASSERT;
    process.env.FQC_LOCK_ASSERT = 'false';
    const vaultPath = await mkdtemp(join(tmpdir(), 'fqc-write-routing-'));
    const calls: string[] = [];

    vi.doMock('../../src/storage/vault-write.js', () => ({
      isVaultTempFileName: (name: string) => name.endsWith('.fqc-tmp') || name.includes('.fqc-tmp-'),
      writeVaultFile: vi.fn(async (absPath: string, content: Buffer | string) => {
        calls.push(absPath);
        await mkdir(dirname(absPath), { recursive: true });
        await writeFile(absPath, content);
        return { contentHash: 'instrumented-hash' };
      }),
    }));

    try {
      const vaultModule = await import('../../src/storage/vault.js');
      const { atomicWriteFrontmatter } = await import('../../src/utils/frontmatter.js');
      const { initLogger: initDynamicLogger } = await import('../../src/logging/logger.js');
      const config = {
        instance: {
          name: 'routing-test',
          id: 'routing-test',
          vault: { path: vaultPath, markdownExtensions: ['.md'] },
        },
        logging: { level: 'error', output: 'stdout' },
        server: { host: 'localhost', port: 3200 },
        supabase: { url: 'http://localhost:54321', serviceRoleKey: 'key', databaseUrl: 'postgresql://localhost/db' },
        git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
        mcp: { transport: 'stdio' },
        embedding: { provider: 'none', model: '', dimensions: 1536 },
      } as unknown as FlashQueryConfig;

      initDynamicLogger(config);
      await vaultModule.initVault(config);

      await vaultModule.vaultManager.writeMarkdown('tools/write-document.md', { fq_title: 'Tool Write' }, 'body');
      const frontmatterPath = join(vaultPath, 'repair.md');
      await writeFile(frontmatterPath, ['---', 'fq_title: Repair', '---', 'body'].join('\n'), 'utf8');
      await atomicWriteFrontmatter(frontmatterPath, { fq_owner: 'plugin-a' });

      expect(calls).toContain(join(vaultPath, 'tools/write-document.md'));
      expect(calls).toContain(frontmatterPath);
      expect(await readFile(frontmatterPath, 'utf8')).toContain('fq_owner: plugin-a');
    } finally {
      if (previousLockAssert === undefined) {
        delete process.env.FQC_LOCK_ASSERT;
      } else {
        process.env.FQC_LOCK_ASSERT = previousLockAssert;
      }
      await rm(vaultPath, { recursive: true, force: true });
    }
  });
});
