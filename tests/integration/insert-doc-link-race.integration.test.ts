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

describe.skipIf(!HAS_SUPABASE)('REQ-010 insert_doc_link race regression', () => {
  let harness: Phase155Harness;

  beforeAll(async () => {
    harness = await createPhase155Harness('fqc-insert-doc-link-race-');
  }, 60_000);

  afterAll(async () => {
    await harness?.cleanup();
  });

  it('T-I-018 preserves a racing write_document body update and inserted relationship link', async () => {
    await writeDocument(harness.handlers, 'phase155/source.md', 'Source', 'initial source');
    await writeDocument(harness.handlers, 'phase155/target.md', 'Target', 'target body');

    const originalWriteMarkdown = vaultManager.writeMarkdown.bind(vaultManager);
    const writePaused = createGate();
    const releaseWrite = createGate();

    const restore = patchVaultWriteMarkdown(async (relativePath, ...args) => {
      if (relativePath === 'phase155/source.md' && String(args[1]) === 'updated body') {
        writePaused.release();
        await releaseWrite.promise;
      }
      return originalWriteMarkdown(relativePath, ...args);
    });

    try {
      const bodyUpdate = harness.handlers.write_document({
        mode: 'update',
        identifier: 'phase155/source.md',
        content: 'updated body',
      });
      await writePaused.promise;

      const linkUpdate = harness.handlers.insert_doc_link({
        identifiers: 'phase155/source.md',
        target_identifier: 'phase155/target.md',
        property: 'links',
      });
      await expect(Promise.race([linkUpdate.then(() => 'finished'), new Promise((resolve) => setTimeout(() => resolve('waiting'), 100))]))
        .resolves.toBe('waiting');

      releaseWrite.release();
      const [bodyResult, linkResult] = await Promise.all([bodyUpdate, linkUpdate]);
      expect((bodyResult as { isError?: boolean }).isError).toBeFalsy();
      expect((linkResult as { isError?: boolean }).isError).toBeFalsy();

      const raw = await readFile(join(harness.vaultPath, 'phase155/source.md'), 'utf-8');
      const parsed = matter(raw);
      expect(parsed.content.trim()).toBe('updated body');
      expect(parsed.data.links).toContain('[[Target]]');
    } finally {
      releaseWrite.release();
      restore();
    }
  }, 40_000);
});
