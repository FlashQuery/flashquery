import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { vaultManager } from '../../src/storage/vault.js';
import { HAS_SUPABASE } from '../helpers/test-env.js';
import {
  createGate,
  createPhase155Harness,
  parseToolJson,
  patchVaultWriteMarkdown,
  waitFor,
  writeDocument,
  type Phase155Harness,
} from './vault-write-coherency-phase155-helpers.js';

describe.skipIf(!HAS_SUPABASE)('REQ-001 per-file document locking integration', () => {
  let harness: Phase155Harness;

  beforeAll(async () => {
    harness = await createPhase155Harness('fqc-per-file-lock-');
  }, 60_000);

  afterAll(async () => {
    await harness?.cleanup();
  });

  it('T-I-001 lets writes to different files complete while one file write is paused', async () => {
    const originalWriteMarkdown = vaultManager.writeMarkdown.bind(vaultManager);
    const firstPaused = createGate();
    const releaseFirst = createGate();
    let firstIsPaused = false;
    let secondEnteredWhileFirstPaused = false;

    const restore = patchVaultWriteMarkdown(async (relativePath, ...args) => {
      if (relativePath === 'phase155/parallel-a.md') {
        firstIsPaused = true;
        firstPaused.release();
        await releaseFirst.promise;
      }
      if (relativePath === 'phase155/parallel-b.md' && firstIsPaused) {
        secondEnteredWhileFirstPaused = true;
      }
      return originalWriteMarkdown(relativePath, ...args);
    });

    try {
      const first = harness.handlers.write_document({
        mode: 'create',
        path: 'phase155/parallel-a.md',
        title: 'Parallel A',
        content: 'A',
        tags: ['wco-phase-155'],
      });
      await firstPaused.promise;

      const second = await harness.handlers.write_document({
        mode: 'create',
        path: 'phase155/parallel-b.md',
        title: 'Parallel B',
        content: 'B',
        tags: ['wco-phase-155'],
      });
      releaseFirst.release();
      await first;

      expect((second as { isError?: boolean }).isError).toBeFalsy();
      expect(secondEnteredWhileFirstPaused).toBe(true);
    } finally {
      releaseFirst.release();
      restore();
    }
  }, 40_000);

  it('T-I-002 serializes same-file updates so the later writer enters after the first commit', async () => {
    await writeDocument(harness.handlers, 'phase155/same-file.md', 'Same File', 'initial');

    const originalWriteMarkdown = vaultManager.writeMarkdown.bind(vaultManager);
    const firstPaused = createGate();
    const releaseFirst = createGate();
    let firstUpdatePaused = false;
    let secondEnteredBeforeFirstReleased = false;

    const restore = patchVaultWriteMarkdown(async (relativePath, ...args) => {
      if (relativePath === 'phase155/same-file.md') {
        const body = String(args[1]);
        if (body === 'first update') {
          firstUpdatePaused = true;
          firstPaused.release();
          await releaseFirst.promise;
        }
        if (body === 'second update' && firstUpdatePaused) {
          secondEnteredBeforeFirstReleased = true;
        }
      }
      return originalWriteMarkdown(relativePath, ...args);
    });

    try {
      const first = harness.handlers.write_document({
        mode: 'update',
        identifier: 'phase155/same-file.md',
        content: 'first update',
      });
      await firstPaused.promise;

      const second = harness.handlers.write_document({
        mode: 'update',
        identifier: 'phase155/same-file.md',
        content: 'second update',
      });
      await expect(Promise.race([second.then(() => 'finished'), new Promise((resolve) => setTimeout(() => resolve('waiting'), 100))]))
        .resolves.toBe('waiting');
      expect(secondEnteredBeforeFirstReleased).toBe(false);

      releaseFirst.release();
      const [firstResult, secondResult] = await Promise.all([first, second]);
      expect((firstResult as { isError?: boolean }).isError).toBeFalsy();
      expect((secondResult as { isError?: boolean }).isError).toBeFalsy();
      await waitFor(() => true);
      expect(parseToolJson(firstResult)).toMatchObject({ path: 'phase155/same-file.md' });
      expect(parseToolJson(secondResult)).toMatchObject({ path: 'phase155/same-file.md' });
    } finally {
      releaseFirst.release();
      restore();
    }
  }, 40_000);
});
