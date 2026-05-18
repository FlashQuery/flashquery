// Vault helper — builds an on-disk scratch vault from the YAML test's
// `vault:` map (path -> content) and returns its root path.
//
// Per §5.1 the framework keeps the real vault wrapper and an on-disk scratch
// vault populated per-test. No substitution justification needed — this is a
// real-component helper, just one that creates the seed state from the test
// fixture.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

export interface VaultFixture {
  root: string;
  cleanup(): Promise<void>;
}

/**
 * Build a temporary vault directory and populate it with files from the
 * provided map. Keys are vault-relative paths (POSIX-style); leading `/`
 * is tolerated and stripped.
 */
export async function buildVault(
  files: Record<string, string> = {},
  options: { prefix?: string } = {},
): Promise<VaultFixture> {
  const prefix = options.prefix ?? 'fq-macro-framework-';
  const root = await mkdtemp(join(tmpdir(), prefix));

  for (const [rawPath, content] of Object.entries(files)) {
    const rel = rawPath.replace(/^\/+/, '');
    const abs = resolve(root, rel);
    // Guard against absolute / escape paths (defense in depth — the
    // vault wrapper enforces this too, but a malformed fixture should
    // fail loudly here rather than write somewhere unexpected).
    if (!abs.startsWith(root + sep) && abs !== root) {
      throw new Error(`Vault fixture: path escapes root: ${rawPath}`);
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }

  return {
    root,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}
