import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runScanOnce } from '../../src/services/scanner.js';
import { vaultManager } from '../../src/storage/vault.js';
import { HAS_SUPABASE } from '../helpers/test-env.js';
import {
  createPhase155Harness,
  type Phase155Harness,
} from './vault-write-coherency-phase155-helpers.js';

describe.skipIf(!HAS_SUPABASE)('REQ-017 scanner zero-write stability integration', () => {
  let harness: Phase155Harness;

  beforeAll(async () => {
    harness = await createPhase155Harness('fqc-scanner-zero-writes-');
    harness.vaultPath = await realpath(harness.vaultPath);
    harness.config.instance.vault.path = harness.vaultPath;
  }, 60_000);

  afterAll(async () => {
    await harness?.cleanup();
  });

  async function writePlain(relativePath: string, raw: string): Promise<void> {
    const absPath = join(harness.vaultPath, relativePath);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, raw);
  }

  it('T-I-032 two consecutive scans of an untouched vault perform zero second-run writes', async () => {
    await writePlain(
      'phase162/scanner-stable.md',
      '---\nfq_title: Scanner Stable\nfq_id: 11111111-1111-4111-8111-111111111111\nfq_status: active\n---\nStable body.\n'
    );

    await runScanOnce(harness.config);
    const originalWriteMarkdown = vaultManager.writeMarkdown.bind(vaultManager);
    let secondRunWrites = 0;
    vaultManager.writeMarkdown = (async (...args) => {
      secondRunWrites += 1;
      return originalWriteMarkdown(...args);
    }) as typeof vaultManager.writeMarkdown;
    try {
      await runScanOnce(harness.config);
    } finally {
      vaultManager.writeMarkdown = originalWriteMarkdown;
    }

    expect(secondRunWrites).toBe(0);
  }, 60_000);

  it('T-I-033 missing-fq_id repair writes once and the second scan writes zero', async () => {
    await writePlain(
      'phase162/scanner-repair-once.md',
      '---\nfq_title: Scanner Repair Once\n---\nMissing identity should repair only once.\n'
    );

    const originalWriteMarkdown = vaultManager.writeMarkdown.bind(vaultManager);
    let firstRunWrites = 0;
    vaultManager.writeMarkdown = (async (...args) => {
      firstRunWrites += 1;
      return originalWriteMarkdown(...args);
    }) as typeof vaultManager.writeMarkdown;
    try {
      await runScanOnce(harness.config);
    } finally {
      vaultManager.writeMarkdown = originalWriteMarkdown;
    }
    expect(firstRunWrites).toBeGreaterThan(0);

    let secondRunWrites = 0;
    vaultManager.writeMarkdown = (async (...args) => {
      secondRunWrites += 1;
      return originalWriteMarkdown(...args);
    }) as typeof vaultManager.writeMarkdown;
    try {
      await runScanOnce(harness.config);
    } finally {
      vaultManager.writeMarkdown = originalWriteMarkdown;
    }

    expect(secondRunWrites).toBe(0);
  }, 60_000);
});
