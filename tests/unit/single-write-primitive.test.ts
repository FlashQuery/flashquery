import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SOURCE_ROOTS = ['src'];

const ALLOWED_DIRECT_WRITE_SITES = [
  {
    file: 'src/storage/vault-write.ts',
    operation: 'writeFile',
    snippet: 'await ops.writeFile(tempPath, bytes);',
    reason: 'allowed primitive internals: write temp file',
  },
  {
    file: 'src/storage/vault-write.ts',
    operation: 'rename',
    snippet: 'await ops.rename(tempPath, absPath);',
    reason: 'allowed primitive internals: rename temp into destination',
  },
  {
    file: 'src/storage/vault.ts',
    operation: 'rename',
    snippet: 'await rename(sourceAbsPath, trashAbsPath);',
    reason: 'same-filesystem trash move; EXDEV fallback must use writeVaultFile',
  },
  {
    file: 'src/mcp/tools/documents/move.ts',
    operation: 'rename',
    snippet: 'await rename(sourceAbsPath, destAbsPath);',
    reason: 'same-filesystem document move; EXDEV fallback must use writeVaultFile',
  },
  {
    file: 'src/storage/supabase.ts',
    operation: 'rename',
    snippet: 'plugin_instance rename',
    reason: 'non-vault write: SQL migration text mentions a schema rename',
  },
];

function sourceFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const abs = join(dir, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      result.push(...sourceFiles(abs));
    } else if (entry.endsWith('.ts')) {
      result.push(abs);
    }
  }
  return result;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('T-U-030 single durable vault write primitive guard', () => {
  it('allows direct writeFile/rename only at explicit primitive or inode-move sites', () => {
    const offenders: string[] = [];

    for (const root of SOURCE_ROOTS) {
      for (const file of sourceFiles(root)) {
        const rel = relative(process.cwd(), file);
        const source = stripComments(readFileSync(file, 'utf8'));
        const lines = source.split('\n');

        for (const [index, line] of lines.entries()) {
          for (const match of line.matchAll(/\b(writeFile|appendFile|rename)\s*\(/g)) {
            const operation = match[1] ?? '';
            const allowed = ALLOWED_DIRECT_WRITE_SITES.some(
              (site) =>
                site.file === rel &&
                site.operation === operation &&
                line.includes(site.snippet.trim())
            );
            if (!allowed) {
              offenders.push(
                `${rel}:${index + 1}: direct ${operation} without writeVaultFile routing`
              );
            }
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps current vault markdown write callers routed through writeVaultFile', () => {
    const vaultSource = readFileSync('src/storage/vault.ts', 'utf8');
    const frontmatterSource = readFileSync('src/utils/frontmatter.ts', 'utf8');
    const resolverSource = readFileSync('src/mcp/utils/document-resolver-primitives.ts', 'utf8');
    const pluginSource = readFileSync('src/services/plugin-reconciliation.ts', 'utf8');
    const gitSource = readFileSync('src/git/manager.ts', 'utf8');
    const moveSource = readFileSync('src/mcp/tools/documents/move.ts', 'utf8');

    expect(vaultSource).toMatch(/import .*writeVaultFile.* from '\.\/vault-write\.js'/s);
    expect(vaultSource).toMatch(/await writeVaultFile\(absolutePath, output, \{ lockConfig: this\.config \}\)/);
    expect(vaultSource).toMatch(/await writeVaultFile\(trashAbsPath, content, \{ lockConfig: this\.config \}\)/);
    expect(frontmatterSource).toMatch(/import .*writeVaultFile.* from '\.\.\/storage\/vault-write\.js'/s);
    expect(frontmatterSource).toMatch(/await writeVaultFile\(absolutePath, updatedContent, \{ lockConfig \}\)/);
    expect(resolverSource).toMatch(/import .*writeVaultFile.* from '\.\.\/\.\.\/storage\/vault-write\.js'/s);
    expect(resolverSource).toMatch(/await writeVaultFile\(absolutePath, output, \{ lockConfig: config \}\)/);
    expect(pluginSource).toMatch(/await atomicWriteFrontmatter\(toAbsolutePath\(doc\.path\)/);
    expect(gitSource).toMatch(/await writeVaultFile\(dumpAbsPath, output\)/);
    expect(moveSource).toMatch(/await writeVaultFile\(destAbsPath, content, \{ lockConfig: config \}\)/);
  });

  it('documents each allowed direct write site with an explicit reason', () => {
    for (const site of ALLOWED_DIRECT_WRITE_SITES) {
      expect(site.reason.length).toBeGreaterThan(20);
    }
    expect(ALLOWED_DIRECT_WRITE_SITES.map((site) => site.file)).not.toContain('src/git/manager.ts');
  });
});
