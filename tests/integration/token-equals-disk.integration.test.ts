import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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

describe.skipIf(!HAS_SUPABASE)('REQ-014 token equals disk integration', () => {
  let harness: Phase155Harness;

  beforeAll(async () => {
    harness = await createPhase155Harness('fqc-token-equals-disk-');
    harness.vaultPath = await realpath(harness.vaultPath);
    harness.config.instance.vault.path = harness.vaultPath;
  }, 60_000);

  afterAll(async () => {
    await harness?.cleanup();
  });

  async function expectTokenDbAndDiskAgree(result: unknown, relativePath: string, fqcId?: string): Promise<void> {
    const payload = parseToolJson<{ version_token?: string; fq_id?: string }>(result);
    const id = fqcId ?? payload.fq_id;
    const raw = await readFile(join(harness.vaultPath, relativePath), 'utf-8');
    expect(payload.version_token).toBe(sha256(raw));
    expect(id, 'expectTokenDbAndDiskAgree requires a resolvable fq_id').toBeTruthy();
    const { data, error } = await import('../../src/storage/supabase.js')
      .then(({ supabaseManager }) => supabaseManager.getClient()
        .from('fqc_documents')
        .select('content_hash')
        .eq('id', id)
        .eq('instance_id', harness.instanceId)
        .single());
    expect(error).toBeNull();
    expect((data as { content_hash: string }).content_hash).toBe(payload.version_token);
  }

  it('T-I-026 get_document repair returns post-repair version_token, not pre-repair token', async () => {
    const relativePath = 'phase162/repair-token.md';
    const absPath = join(harness.vaultPath, relativePath);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, '---\nfq_title: Repair Token\n---\nMissing fq_id triggers repair.\n');
    const beforeRaw = await readFile(absPath, 'utf-8');
    const beforeHash = sha256(beforeRaw);

    const result = await harness.handlers.get_document({ identifiers: relativePath, include: ['frontmatter', 'body'] });
    const payload = parseToolJson<{ version_token?: string }>(result);
    const afterRaw = await readFile(absPath, 'utf-8');

    expect(afterRaw).not.toBe(beforeRaw);
    expect(payload.version_token).toBe(sha256(afterRaw));
    expect(payload.version_token).not.toBe(beforeHash);
  });

  it('T-I-027 follow-up write_document accepts the post-repair returned token', async () => {
    const relativePath = 'phase162/repair-follow-up.md';
    const absPath = join(harness.vaultPath, relativePath);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, '---\nfq_title: Repair Follow Up\n---\nRepair then real write.\n');

    const readResult = await harness.handlers.get_document({ identifiers: relativePath });
    const token = parseToolJson<{ version_token?: string }>(readResult).version_token;
    expect(token).toMatch(/^[a-f0-9]{64}$/);

    const writeResult = await harness.handlers.write_document({
      mode: 'update',
      identifier: relativePath,
      content: 'Repair then real write.',
      expected_version: token,
    });
    expect((writeResult as { isError?: boolean }).isError).toBeFalsy();
    const writePayload = parseToolJson<{ error?: string; version_token?: string }>(writeResult);
    expect(writePayload.error).toBeUndefined();
    expect(writePayload.version_token).toMatch(/^[a-f0-9]{64}$/);
    expect(writePayload.version_token).not.toBe(token);
    const diskAfter = await readFile(absPath, 'utf-8');
    expect(diskAfter).toContain('Repair then real write.');
    expect(writePayload.version_token).toBe(sha256(diskAfter));
  });

  it('T-I-028 write, copy, move, archive, and compound mutations keep DB content_hash, version_token, and disk SHA-256 equal', async () => {
    const created = await writeDocument(harness.handlers, 'phase162/equality-write.md', 'Equality Write', 'initial');
    await expectTokenDbAndDiskAgree(
      await harness.handlers.write_document({
        mode: 'update',
        identifier: 'phase162/equality-write.md',
        content: 'updated by write_document',
      }),
      'phase162/equality-write.md',
      String(created.fq_id)
    );

    const copyResult = await harness.handlers.copy_document({
      identifier: 'phase162/equality-write.md',
      destination: 'phase162/equality-copy.md',
    });
    const copyPayload = parseToolJson<{ fq_id?: string; version_token?: string }>(copyResult);
    expect(copyPayload.fq_id).toMatch(/^[0-9a-f-]{36}$/);
    await expectTokenDbAndDiskAgree(copyResult, 'phase162/equality-copy.md', copyPayload.fq_id);
    const copiedGet = parseToolJson<{ version_token?: string }>(
      await harness.handlers.get_document({ identifiers: 'phase162/equality-copy.md' })
    );
    expect(copiedGet.version_token).toBe(copyPayload.version_token);

    const moveResult = await harness.handlers.move_document({
      identifier: 'phase162/equality-copy.md',
      destination: 'phase162/equality-moved.md',
    });
    const movePayload = parseToolJson<{ fq_id?: string; version_token?: string }>(moveResult);
    expect(movePayload.fq_id).toMatch(/^[0-9a-f-]{36}$/);
    await expectTokenDbAndDiskAgree(moveResult, 'phase162/equality-moved.md', movePayload.fq_id);
    const movedGet = parseToolJson<{ version_token?: string }>(
      await harness.handlers.get_document({ identifiers: 'phase162/equality-moved.md' })
    );
    expect(movedGet.version_token).toBe(movePayload.version_token);

    const compoundResult = await harness.handlers.insert_in_doc({
      identifier: 'phase162/equality-write.md',
      position: 'end',
      content: '\ncompound mutation',
    });
    await expectTokenDbAndDiskAgree(compoundResult, 'phase162/equality-write.md', String(created.fq_id));

    const archiveResult = await harness.handlers.archive_document({ identifiers: 'phase162/equality-write.md' });
    await expectTokenDbAndDiskAgree(archiveResult, 'phase162/equality-write.md', String(created.fq_id));
  });
});
