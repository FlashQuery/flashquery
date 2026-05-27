import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { HAS_SUPABASE } from '../helpers/test-env.js';
import {
  createPhase155Harness,
  parseToolJson,
  writeDocument,
  type Phase155Harness,
} from './vault-write-coherency-phase155-helpers.js';

type ConflictPayload = {
  error?: string;
  details?: { reason?: string };
  version_token?: string;
};

function expectVersionConflict(payload: ConflictPayload): void {
  expect(payload).toMatchObject({
    error: 'conflict',
    details: { reason: 'version_mismatch' },
  });
  expect(payload.version_token).toMatch(/^[a-f0-9]{64}$/);
}

describe.skipIf(!HAS_SUPABASE)('REQ-012 expected_version precondition integration', () => {
  let harness: Phase155Harness;

  beforeAll(async () => {
    harness = await createPhase155Harness('fqc-version-token-precondition-');
    harness.vaultPath = await realpath(harness.vaultPath);
    harness.config.instance.vault.path = harness.vaultPath;
  }, 60_000);

  afterAll(async () => {
    await harness?.cleanup();
  });

  async function readToken(path: string): Promise<string> {
    const result = await harness.handlers.get_document({ identifiers: path });
    const payload = parseToolJson<{ version_token: string }>(result);
    expect(payload.version_token).toMatch(/^[a-f0-9]{64}$/);
    return payload.version_token;
  }

  it('T-I-020 write_document with matching expected_version succeeds and returns a new token', async () => {
    await writeDocument(harness.handlers, 'phase162/precondition-match.md', 'Precondition Match', 'before');
    const token = await readToken('phase162/precondition-match.md');

    const result = await harness.handlers.write_document({
      mode: 'update',
      identifier: 'phase162/precondition-match.md',
      content: 'after',
      expected_version: token,
    });
    expect((result as { isError?: boolean }).isError).toBeFalsy();
    const payload = parseToolJson<{ version_token?: string }>(result);
    expect(payload.version_token).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.version_token).not.toBe(token);
  });

  it('T-I-021 write_document with non-matching expected_version is refused and leaves disk unchanged', async () => {
    await writeDocument(harness.handlers, 'phase162/precondition-mismatch.md', 'Precondition Mismatch', 'before');
    const diskBefore = await readFile(join(harness.vaultPath, 'phase162/precondition-mismatch.md'), 'utf-8');

    const result = await harness.handlers.write_document({
      mode: 'update',
      identifier: 'phase162/precondition-mismatch.md',
      content: 'must not be written',
      expected_version: '0'.repeat(64),
    });
    expectVersionConflict(parseToolJson<ConflictPayload>(result));
    const diskAfter = await readFile(join(harness.vaultPath, 'phase162/precondition-mismatch.md'), 'utf-8');
    expect(diskAfter).toBe(diskBefore);
  });

  it('T-I-022 omitted expected_version preserves last-writer-wins behavior', async () => {
    await writeDocument(harness.handlers, 'phase162/precondition-omitted.md', 'Precondition Omitted', 'before');
    const result = await harness.handlers.write_document({
      mode: 'update',
      identifier: 'phase162/precondition-omitted.md',
      content: 'after without a version token',
    });
    expect((result as { isError?: boolean }).isError).toBeFalsy();
    const raw = await readFile(join(harness.vaultPath, 'phase162/precondition-omitted.md'), 'utf-8');
    expect(raw).toContain('after without a version token');
  });

  it('T-I-023 destructive tools and copy_document refuse mismatching relevant source tokens without modifying disk', async () => {
    const tools = [
      { name: 'archive_document', path: 'phase162/archive-mismatch.md', args: { identifiers: 'phase162/archive-mismatch.md' } },
      { name: 'remove_document', path: 'phase162/remove-mismatch.md', args: { identifiers: 'phase162/remove-mismatch.md' } },
      { name: 'move_document', path: 'phase162/move-mismatch.md', args: { identifier: 'phase162/move-mismatch.md', destination: 'phase162/moved.md' } },
      { name: 'copy_document', path: 'phase162/copy-source-mismatch.md', args: { identifier: 'phase162/copy-source-mismatch.md', destination: 'phase162/copy-dest-mismatch.md' } },
    ] as const;

    for (const tool of tools) {
      await writeDocument(harness.handlers, tool.path, `${tool.name} mismatch`, 'original body');
      const before = await readFile(join(harness.vaultPath, tool.path), 'utf-8');
      const result = await harness.handlers[tool.name]({
        ...tool.args,
        expected_version: '1'.repeat(64),
      });
      expectVersionConflict(parseToolJson<ConflictPayload>(result));
      await expect(readFile(join(harness.vaultPath, tool.path), 'utf-8')).resolves.toBe(before);
    }
  });

  it('T-I-024 if_match behaves identically to expected_version', async () => {
    await writeDocument(harness.handlers, 'phase162/if-match.md', 'If Match', 'before');
    const token = await readToken('phase162/if-match.md');
    const result = await harness.handlers.write_document({
      mode: 'update',
      identifier: 'phase162/if-match.md',
      content: 'after via if_match',
      if_match: token,
    });
    expect((result as { isError?: boolean }).isError).toBeFalsy();
    expect(parseToolJson<{ version_token?: string }>(result).version_token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('T-I-023 copy_document expected_version uses source-token semantics while destination conflicts remain destination-path conflicts', async () => {
    await writeDocument(harness.handlers, 'phase162/copy-source-token.md', 'Copy Source Token', 'source body');
    await writeDocument(harness.handlers, 'phase162/copy-dest-token.md', 'Copy Dest Token', 'existing destination');
    const sourceToken = await readToken('phase162/copy-source-token.md');
    const result = await harness.handlers.copy_document({
      identifier: 'phase162/copy-source-token.md',
      destination: 'phase162/copy-dest-token.md',
      expected_version: sourceToken,
    });
    const payload = parseToolJson<{ error?: string; details?: { reason?: string } }>(result);
    expect(payload).toMatchObject({ error: 'conflict', details: { reason: 'path_exists' } });
  });
});
