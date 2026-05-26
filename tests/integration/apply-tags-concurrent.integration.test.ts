import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import matter from 'gray-matter';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { vaultManager } from '../../src/storage/vault.js';
import { HAS_SUPABASE } from '../helpers/test-env.js';
import {
  createGate,
  createPhase155Harness,
  patchVaultWriteMarkdown,
  writeDocument,
  type Phase155Harness,
} from './vault-write-coherency-phase155-helpers.js';

describe.skipIf(!HAS_SUPABASE)('REQ-010 apply_tags same-file lost-update regression', () => {
  let harness: Phase155Harness;

  beforeAll(async () => {
    harness = await createPhase155Harness('fqc-apply-tags-concurrent-');
  }, 60_000);

  afterAll(async () => {
    await harness?.cleanup();
  });

  it('T-I-017 preserves disjoint tags from concurrent apply_tags calls on one document', async () => {
    await writeDocument(harness.handlers, 'phase155/apply-tags.md', 'Apply Tags Target', 'tag target', ['base']);

    const originalWriteMarkdown = vaultManager.writeMarkdown.bind(vaultManager);
    const firstPaused = createGate();
    const releaseFirst = createGate();
    let pausedOnce = false;

    const restore = patchVaultWriteMarkdown(async (relativePath, ...args) => {
      if (relativePath === 'phase155/apply-tags.md' && !pausedOnce) {
        pausedOnce = true;
        firstPaused.release();
        await releaseFirst.promise;
      }
      return originalWriteMarkdown(relativePath, ...args);
    });

    try {
      const first = harness.handlers.apply_tags({
        targets: [{ entity_type: 'document', identifier: 'phase155/apply-tags.md' }],
        add_tags: ['alpha-155'],
      });
      await firstPaused.promise;

      const second = harness.handlers.apply_tags({
        targets: [{ entity_type: 'document', identifier: 'phase155/apply-tags.md' }],
        add_tags: ['beta-155'],
      });
      await expect(Promise.race([second.then(() => 'finished'), new Promise((resolve) => setTimeout(() => resolve('waiting'), 100))]))
        .resolves.toBe('waiting');
      releaseFirst.release();

      const [firstResult, secondResult] = await Promise.all([first, second]);
      expect((firstResult as { isError?: boolean }).isError).toBeFalsy();
      expect((secondResult as { isError?: boolean }).isError).toBeFalsy();

      const raw = await readFile(join(harness.vaultPath, 'phase155/apply-tags.md'), 'utf-8');
      const tags = new Set(matter(raw).data.fq_tags as string[]);
      expect(tags.has('base')).toBe(true);
      expect(tags.has('alpha-155')).toBe(true);
      expect(tags.has('beta-155')).toBe(true);
    } finally {
      releaseFirst.release();
      restore();
    }
  }, 40_000);
});
