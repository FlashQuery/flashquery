import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SOURCE_ROOTS = ['src/storage', 'src/utils', 'src/mcp', 'src/services'];

const ALLOWED_DIRECT_WRITE_SITES: Record<string, string[]> = {
  'src/storage/vault-write.ts': [
    'allowed primitive internals: write temp file and rename temp into destination',
  ],
  'src/storage/supabase.ts': [
    'non-vault write: SQL migration text includes rename statements for database schema changes',
  ],
  'src/storage/vault.ts': [
    'Phase 161 / REQ-022 deferred boundary: moveMarkdownToTrash EXDEV fallback still uses copy/unlink discipline',
    'Non-deferred normal markdown writes in this file must call writeVaultFile',
  ],
  'src/mcp/tools/documents/move.ts': [
    'Phase 161 / REQ-022 deferred boundary: move_document rename and EXDEV fallback remain out of Phase 156 scope',
  ],
};

function sourceFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
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
  it('allows direct writeFile/rename only in the primitive or deferred REQ-022 move boundaries', () => {
    const offenders: string[] = [];

    for (const root of SOURCE_ROOTS) {
      for (const file of sourceFiles(root)) {
        const rel = relative(process.cwd(), file);
        const source = stripComments(readFileSync(file, 'utf8'));
        const hasDirectCommitOperation = /\b(writeFile|appendFile|rename)\s*\(/.test(source);
        if (!hasDirectCommitOperation) continue;

        if (!ALLOWED_DIRECT_WRITE_SITES[rel]) {
          offenders.push(`${rel}: direct writeFile/appendFile/rename without writeVaultFile routing`);
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

    expect(vaultSource).toMatch(/import .*writeVaultFile.* from '\.\/vault-write\.js'/s);
    expect(vaultSource).toMatch(/await writeVaultFile\(absolutePath, output\)/);
    expect(frontmatterSource).toMatch(/import .*writeVaultFile.* from '\.\.\/storage\/vault-write\.js'/s);
    expect(frontmatterSource).toMatch(/await writeVaultFile\(absolutePath, updatedContent\)/);
    expect(resolverSource).toMatch(/import .*writeVaultFile.* from '\.\.\/\.\.\/storage\/vault-write\.js'/s);
    expect(resolverSource).toMatch(/await writeVaultFile\(absolutePath, output\)/);
    expect(pluginSource).toMatch(/await atomicWriteFrontmatter\(toAbsolutePath\(doc\.path\)/);
  });

  it('documents each allowed direct write site with an explicit reason', () => {
    expect(ALLOWED_DIRECT_WRITE_SITES['src/storage/vault.ts']?.join(' ')).toContain('Phase 161');
    expect(ALLOWED_DIRECT_WRITE_SITES['src/mcp/tools/documents/move.ts']?.join(' ')).toContain('Phase 161');
    expect(ALLOWED_DIRECT_WRITE_SITES['src/storage/vault-write.ts']?.join(' ')).toContain('primitive');
  });
});
