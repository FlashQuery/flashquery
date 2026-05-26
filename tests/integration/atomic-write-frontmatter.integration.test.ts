import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { initLogger } from '../../src/logging/logger.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { HAS_SUPABASE } from '../helpers/test-env.js';

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

  it.skipIf(!HAS_SUPABASE)('T-I-040 routes registered MCP document tools and frontmatter writes through writeVaultFile', async () => {
    const vaultPath = await mkdtemp(join(tmpdir(), 'fqc-write-routing-'));
    const calls: string[] = [];
    let harnessCleanup: (() => Promise<void>) | undefined;

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
      const { createPhase155Harness, parseToolJson } = await import(
        './vault-write-coherency-phase155-helpers.js'
      );
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

      const harness = await createPhase155Harness('fqc-write-routing-mcp-');
      harnessCleanup = harness.cleanup;
      const created = parseToolJson<Record<string, unknown>>(
        await harness.handlers.write_document({
          mode: 'create',
          path: 'tools/mcp-write.md',
          title: 'MCP Write',
          content: 'body',
          tags: ['routing'],
        })
      );
      expect(created.path).toBe('tools/mcp-write.md');

      const tagResult = await harness.handlers.apply_tags({
        identifier: 'tools/mcp-write.md',
        add_tags: ['compound-route'],
      });
      expect((tagResult as { isError?: boolean }).isError).not.toBe(true);

      expect(calls).toContain(join(vaultPath, 'tools/write-document.md'));
      expect(calls).toContain(frontmatterPath);
      expect(calls).toContain(join(harness.vaultPath, 'tools/mcp-write.md'));
      expect(await readFile(frontmatterPath, 'utf8')).toContain('fq_owner: plugin-a');
    } finally {
      await harnessCleanup?.();
      await rm(vaultPath, { recursive: true, force: true });
    }
  });
});
