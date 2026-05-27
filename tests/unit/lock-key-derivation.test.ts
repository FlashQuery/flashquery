import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FlashQueryConfig } from '../../src/config/types.js';
import {
  __testing,
  isDocumentLockHeldForPath,
  withDocumentLock,
} from '../../src/services/document-lock.js';

const tempDirs: string[] = [];

async function makeVault(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fq-lock-key-'));
  tempDirs.push(dir);
  return dir;
}

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: 'lock-key-derivation-test',
      id: 'instance-1',
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    supabase: { url: 'http://localhost:54321', serviceRoleKey: 'service-role', databaseUrl: 'postgres://fq/test', skipDdl: true },
    locking: { enabled: true, lockTimeoutSeconds: 10 },
  } as FlashQueryConfig;
}

function makeTier1OnlyConfig(vaultPath: string): FlashQueryConfig {
  return {
    ...makeConfig(vaultPath),
    locking: { enabled: false, lockTimeoutSeconds: 10 },
  } as FlashQueryConfig;
}

describe('REQ-003 canonical lock-key derivation', () => {
  afterEach(async () => {
    __testing.clearCaseSensitivityCache();
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('T-U-006 canonical-key symlink realpath unifies aliases to one file resource', async () => {
    const vault = await makeVault();
    await mkdir(join(vault, 'Notes'));
    await writeFile(join(vault, 'Notes', 'Plan.md'), 'body');
    await symlink(join(vault, 'Notes'), join(vault, 'Alias'));

    const realEntry = await __testing.deriveDocumentLockEntry(makeConfig(vault), join(vault, 'Notes', 'Plan.md'));
    const aliasEntry = await __testing.deriveDocumentLockEntry(makeConfig(vault), join(vault, 'Alias', 'Plan.md'));

    expect(aliasEntry.resource).toBe(realEntry.resource);
    expect(aliasEntry.resource).toMatch(/^file:/);
  });

  it('T-U-007 canonical-key destination uses real parent plus missing basename', async () => {
    const vault = await makeVault();
    await mkdir(join(vault, 'Notes'));
    await __testing.setCaseInsensitiveForVault(vault, false);

    const entry = await __testing.deriveDocumentLockEntry(makeConfig(vault), join(vault, 'Notes', 'New.md'));
    const resolvedParent = await realpath(join(vault, 'Notes'));

    expect(entry.resource).toBe(`file:${join(resolvedParent, 'New.md')}`);
  });

  it('T-U-008 case-fold follows the vault filesystem sensitivity probe', async () => {
    const vault = await makeVault();
    await mkdir(join(vault, 'Notes'));
    await writeFile(join(vault, 'Notes', 'Plan.md'), 'body');
    const config = makeTier1OnlyConfig(vault);
    const resolvedFile = await realpath(join(vault, 'Notes', 'Plan.md'));

    await __testing.setCaseInsensitiveForVault(vault, true);
    const folded = await __testing.deriveDocumentLockEntry(config, join(vault, 'Notes', 'Plan.md'));
    expect(folded.resource).toBe(`file:${resolvedFile.toLocaleLowerCase('en-US')}`);

    __testing.clearCaseSensitivityCache();
    await __testing.setCaseInsensitiveForVault(vault, false);
    const exact = await __testing.deriveDocumentLockEntry(config, join(vault, 'Notes', 'Plan.md'));
    expect(exact.resource).toBe(`file:${resolvedFile}`);
  });

  it('T-U-009 namespace separates file and directory advisory resources', async () => {
    const vault = await makeVault();
    await mkdir(join(vault, 'Notes'));
    await __testing.setCaseInsensitiveForVault(vault, false);
    const resolvedPath = await realpath(join(vault, 'Notes'));

    const fileEntry = await __testing.deriveDocumentLockEntry(makeConfig(vault), join(vault, 'Notes'), 'file');
    const dirEntry = await __testing.deriveDocumentLockEntry(makeConfig(vault), join(vault, 'Notes'), 'dir');

    expect(fileEntry.resource).toBe(`file:${resolvedPath}`);
    expect(dirEntry.resource).toBe(`dir:${resolvedPath}`);
    expect(fileEntry).not.toMatchObject({ resource: dirEntry.resource, stripeIndex: dirEntry.stripeIndex });
  });

  it('T-U-010 vault-relative input is canonicalized before hashing', async () => {
    const vault = await makeVault();
    await mkdir(join(vault, 'Notes'));
    await writeFile(join(vault, 'Notes', 'Plan.md'), 'body');
    await __testing.setCaseInsensitiveForVault(vault, false);
    const resolvedFile = await realpath(join(vault, 'Notes', 'Plan.md'));

    const entry = await __testing.deriveDocumentLockEntry(makeConfig(vault), 'Notes/Plan.md');

    expect(entry.basicKey).toBe(`file:${resolvedFile}`);
    expect(entry.resource).not.toBe('file:Notes/Plan.md');
  });

  it('ambient lock assertion lookup uses the same canonical symlink key as acquisition', async () => {
    const vault = await makeVault();
    await mkdir(join(vault, 'Notes'));
    await writeFile(join(vault, 'Notes', 'Plan.md'), 'body');
    await symlink(join(vault, 'Notes'), join(vault, 'Alias'));
    await __testing.setCaseInsensitiveForVault(vault, false);
    const config = makeTier1OnlyConfig(vault);

    await withDocumentLock(config, join(vault, 'Alias', 'Plan.md'), async () => {
      await expect(isDocumentLockHeldForPath(config, join(vault, 'Alias', 'Plan.md'))).resolves.toBe(true);
      await expect(isDocumentLockHeldForPath(config, join(vault, 'Notes', 'Plan.md'))).resolves.toBe(true);
    });
  });

  it('ambient lock assertion lookup uses canonical case-folded and relative keys', async () => {
    const vault = await makeVault();
    await mkdir(join(vault, 'Notes'));
    await writeFile(join(vault, 'Notes', 'Plan.md'), 'body');
    await __testing.setCaseInsensitiveForVault(vault, true);
    const config = makeTier1OnlyConfig(vault);

    await withDocumentLock(config, 'Notes/Plan.md', async () => {
      await expect(isDocumentLockHeldForPath(config, join(vault, 'Notes', 'Plan.md'))).resolves.toBe(true);
      await expect(isDocumentLockHeldForPath(config, join(vault, 'notes', 'plan.md'))).resolves.toBe(true);
    });
  });
});
