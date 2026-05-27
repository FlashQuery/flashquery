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

function sha256(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

describe.skipIf(!HAS_SUPABASE)('REQ-011 version_token response shape integration', () => {
  let harness: Phase155Harness;

  beforeAll(async () => {
    harness = await createPhase155Harness('fqc-version-token-shape-');
    harness.vaultPath = await realpath(harness.vaultPath);
    harness.config.instance.vault.path = harness.vaultPath;
  }, 60_000);

  afterAll(async () => {
    await harness?.cleanup();
  });

  it('T-I-019 get_document returns version_token equal to SHA-256 of on-disk bytes', async () => {
    await writeDocument(
      harness.handlers,
      'phase162/version-token-shape.md',
      'Version Token Shape',
      'Raw bytes drive the public version_token.'
    );

    const result = await harness.handlers.get_document({
      identifiers: 'phase162/version-token-shape.md',
      include: ['body', 'frontmatter'],
    });
    expect((result as { isError?: boolean }).isError).toBeFalsy();
    const payload = parseToolJson<{ version_token?: string }>(result);
    const raw = await readFile(join(harness.vaultPath, 'phase162/version-token-shape.md'), 'utf-8');

    expect(payload.version_token).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.version_token).toBe(sha256(raw));
  });
});
