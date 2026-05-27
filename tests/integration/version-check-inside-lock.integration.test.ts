import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { appendFile, readFile, realpath } from 'node:fs/promises';
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

describe.skipIf(!HAS_SUPABASE)('REQ-013 version check inside document lock integration', () => {
  let harness: Phase155Harness;

  beforeAll(async () => {
    harness = await createPhase155Harness('fqc-version-check-inside-lock-');
    harness.vaultPath = await realpath(harness.vaultPath);
    harness.config.instance.vault.path = harness.vaultPath;
  }, 60_000);

  afterAll(async () => {
    await harness?.cleanup();
  });

  it('T-I-025 intervening disk write between read and write triggers a version_mismatch conflict', async () => {
    await writeDocument(harness.handlers, 'phase162/inside-lock.md', 'Inside Lock', 'before');
    const readResult = await harness.handlers.get_document({ identifiers: 'phase162/inside-lock.md' });
    const originalToken = parseToolJson<{ version_token: string }>(readResult).version_token;
    const absPath = join(harness.vaultPath, 'phase162/inside-lock.md');
    const beforeAttempt = await readFile(absPath, 'utf-8');

    await appendFile(absPath, '\nExternal editor write before the MCP update.\n');
    const afterExternalWrite = await readFile(absPath, 'utf-8');
    expect(afterExternalWrite).not.toBe(beforeAttempt);

    const writeResult = await harness.handlers.write_document({
      mode: 'update',
      identifier: 'phase162/inside-lock.md',
      content: 'stale caller body',
      expected_version: originalToken,
    });
    const payload = parseToolJson<{ error?: string; details?: { reason?: string } }>(writeResult);
    expect(payload).toMatchObject({ error: 'conflict', details: { reason: 'version_mismatch' } });
    await expect(readFile(absPath, 'utf-8')).resolves.toBe(afterExternalWrite);
  });

  it('T-I-025b version check trusts disk bytes, not stale fqc_documents.content_hash', async () => {
    const created = await writeDocument(harness.handlers, 'phase162/db-lag.md', 'DB Lag', 'true body');
    const absPath = join(harness.vaultPath, 'phase162/db-lag.md');
    const diskToken = sha256(await readFile(absPath, 'utf-8'));

    const { supabaseManager } = await import('../../src/storage/supabase.js');
    const { error: staleHashError } = await supabaseManager.getClient()
      .from('fqc_documents')
      .update({ content_hash: '9'.repeat(64) })
      .eq('id', String(created.fq_id))
      .eq('instance_id', harness.instanceId);
    expect(staleHashError).toBeNull();

    const result = await harness.handlers.write_document({
      mode: 'update',
      identifier: 'phase162/db-lag.md',
      content: 'updated despite DB lag',
      expected_version: diskToken,
    });

    expect((result as { isError?: boolean }).isError).toBeFalsy();
    const payload = parseToolJson<{ error?: string; version_token?: string }>(result);
    expect(payload.error).toBeUndefined();
    expect(payload.version_token).toMatch(/^[a-f0-9]{64}$/);
    await expect(readFile(absPath, 'utf-8')).resolves.toContain('updated despite DB lag');
  });
});
