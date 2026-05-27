import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendFile, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { HAS_SUPABASE } from '../helpers/test-env.js';
import {
  createPhase155Harness,
  parseToolJson,
  writeDocument,
  type Phase155Harness,
} from './vault-write-coherency-phase155-helpers.js';

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
});
