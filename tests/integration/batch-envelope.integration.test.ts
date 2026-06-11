import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { HAS_SUPABASE } from '../helpers/test-env.js';
import {
  createPhase155Harness,
  parseToolJson,
  writeDocument,
  type Phase155Harness,
} from './vault-write-coherency-phase155-helpers.js';

type BatchEntry = {
  identifier: string;
  status: 'succeeded' | 'conflicted' | 'failed';
  version_token?: string;
  targeted_region?: Record<string, unknown>;
  details?: { reason?: string };
  error?: { error?: string };
};

function sha256(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

describe.skipIf(!HAS_SUPABASE)('REQ-018 destructive batch result envelopes', () => {
  let harness: Phase155Harness;

  beforeAll(async () => {
    harness = await createPhase155Harness('fqc-batch-envelope-');
    harness.vaultPath = await realpath(harness.vaultPath);
    harness.config.instance.vault.path = harness.vaultPath;
  }, 180_000);

  afterAll(async () => {
    await harness?.cleanup();
  });

  async function readToken(path: string): Promise<string> {
    const result = await harness.handlers.get_document({ identifiers: path });
    const payload = parseToolJson<{ version_token: string }>(result);
    expect(payload.version_token).toMatch(/^[a-f0-9]{64}$/);
    return payload.version_token;
  }

  it('T-I-035 T-I-036 T-I-037 archive_document returns ordered success, conflict, failure entries without rollback', async () => {
    await writeDocument(harness.handlers, 'phase163/archive-success-a.md', 'Archive Success A', 'archive success a');
    await writeDocument(harness.handlers, 'phase163/archive-conflict.md', 'Archive Conflict', 'archive conflict original');
    await writeDocument(harness.handlers, 'phase163/archive-success-b.md', 'Archive Success B', 'archive success b');

    const staleToken = await readToken('phase163/archive-conflict.md');
    await harness.handlers.write_document({
      mode: 'update',
      identifier: 'phase163/archive-conflict.md',
      content: 'archive conflict current',
    });
    const conflictDiskBefore = await readFile(join(harness.vaultPath, 'phase163/archive-conflict.md'), 'utf-8');

    const result = await harness.handlers.archive_document({
      identifiers: [
        'phase163/archive-success-a.md',
        { identifier: 'phase163/archive-conflict.md', version_token: staleToken },
        'phase163/archive-missing.md',
        'phase163/archive-success-b.md',
      ],
    });
    const payload = parseToolJson<BatchEntry[]>(result);

    expect(Array.isArray(payload)).toBe(true);
    expect(payload).toHaveLength(4);
    expect(payload.map((entry) => entry.identifier)).toEqual([
      'phase163/archive-success-a.md',
      'phase163/archive-conflict.md',
      'phase163/archive-missing.md',
      'phase163/archive-success-b.md',
    ]);
    expect(payload.map((entry) => entry.status)).toEqual([
      'succeeded',
      'conflicted',
      'failed',
      'succeeded',
    ]);

    expect(payload[1]).toMatchObject({
      status: 'conflicted',
      error: 'conflict',
      details: { reason: 'version_mismatch' },
      targeted_region: {
        kind: 'frontmatter',
        frontmatter: {
          fq_title: 'Archive Conflict',
        },
      },
    });
    expect(payload[1]?.version_token).toMatch(/^[a-f0-9]{64}$/);

    expect(payload[2]).toMatchObject({
      status: 'failed',
      error: { error: 'not_found' },
    });

    const archivedA = await readFile(join(harness.vaultPath, 'phase163/archive-success-a.md'), 'utf-8');
    const archivedB = await readFile(join(harness.vaultPath, 'phase163/archive-success-b.md'), 'utf-8');
    expect(archivedA).toContain('fq_status: archived');
    expect(archivedB).toContain('fq_status: archived');
    expect(payload[0]?.version_token).toBe(sha256(archivedA));
    expect(payload[3]?.version_token).toBe(sha256(archivedB));

    await expect(readFile(join(harness.vaultPath, 'phase163/archive-conflict.md'), 'utf-8')).resolves.toBe(conflictDiskBefore);
  });

  it('T-I-034 T-I-036 T-I-037 remove_document returns a raw ordered array and keeps successful removals', async () => {
    await writeDocument(harness.handlers, 'phase163/remove-success.md', 'Remove Success', 'remove success');
    await writeDocument(harness.handlers, 'phase163/remove-conflict.md', 'Remove Conflict', 'remove conflict original');

    const staleToken = await readToken('phase163/remove-conflict.md');
    await harness.handlers.write_document({
      mode: 'update',
      identifier: 'phase163/remove-conflict.md',
      content: 'remove conflict current',
    });
    const conflictDiskBefore = await readFile(join(harness.vaultPath, 'phase163/remove-conflict.md'), 'utf-8');

    const result = await harness.handlers.remove_document({
      identifiers: [
        'phase163/remove-success.md',
        { identifier: 'phase163/remove-conflict.md', version_token: staleToken },
        'phase163/remove-missing.md',
      ],
    });
    const payload = parseToolJson<BatchEntry[]>(result);

    expect(Array.isArray(payload)).toBe(true);
    expect(payload).toHaveLength(3);
    expect(payload.map((entry) => entry.identifier)).toEqual([
      'phase163/remove-success.md',
      'phase163/remove-conflict.md',
      'phase163/remove-missing.md',
    ]);
    expect(payload.map((entry) => entry.status)).toEqual(['succeeded', 'conflicted', 'failed']);
    expect(payload[0]?.version_token).toBeUndefined();
    expect(payload[1]).toMatchObject({
      status: 'conflicted',
      error: 'conflict',
      details: { reason: 'version_mismatch' },
      targeted_region: {
        type: 'document',
        path: 'phase163/remove-conflict.md',
        content: expect.stringContaining('remove conflict current'),
      },
    });
    expect(payload[1]?.version_token).toMatch(/^[a-f0-9]{64}$/);
    expect(payload[2]).toMatchObject({
      status: 'failed',
      error: { error: 'not_found' },
    });

    await expect(readFile(join(harness.vaultPath, 'phase163/remove-success.md'), 'utf-8')).rejects.toThrow();
    await expect(readFile(join(harness.vaultPath, 'phase163/remove-conflict.md'), 'utf-8')).resolves.toBe(conflictDiskBefore);
  });
});
