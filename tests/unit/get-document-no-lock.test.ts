import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('REQ-011 read path lock contract', () => {
  it('T-U-037 get_document source does not import or call write-lock primitives', async () => {
    const source = await readFile(
      new URL('../../src/mcp/tools/documents/get.ts', import.meta.url),
      'utf-8'
    );

    expect(source).not.toMatch(/from ['"].*services\/document-lock\.js['"]/);
    expect(source).not.toMatch(/\bwithDocumentLock\b/);
    expect(source).not.toMatch(/\bwithDocumentLocks\b/);
    expect(source).not.toMatch(/\bwithAncestorDirectoryLocksShared\b/);
    expect(source).not.toMatch(/\bLockTimeoutError\b/);
    expect(source).not.toMatch(/\bacquireLock\b|\breleaseLock\b|\bisLocked\b/);
  });

  it('T-U-037 D-02 cache-hit get_document path stays lock-free and bypasses targetedScan', async () => {
    const source = await readFile(
      new URL('../../src/mcp/utils/document-output.ts', import.meta.url),
      'utf-8'
    );

    const cacheHitBranch = source.match(/} else {\n\s*\/\/ Cache-hit path:[\s\S]*?\n\s*};\n\s*}/)?.[0] ?? '';
    const executableCacheHitBranch = stripComments(cacheHitBranch);

    expect(cacheHitBranch).toContain('Cache-hit path');
    expect(executableCacheHitBranch).not.toMatch(/\btargetedScan\b/);
    expect(executableCacheHitBranch).not.toMatch(/\bwithDocumentLock\b/);
    expect(executableCacheHitBranch).not.toMatch(/\bwithDocumentLocks\b/);
    expect(executableCacheHitBranch).not.toMatch(/\bwithAncestorDirectoryLocksShared\b/);
  });

  it('T-U-037 D-03 targetedScan only locks the actual frontmatter repair write branch', async () => {
    const source = await readFile(
      new URL('../../src/mcp/utils/document-resolver-primitives.ts', import.meta.url),
      'utf-8'
    );

    expect(source).toMatch(/if \(frontmatterChanged\) {[\s\S]*withAncestorDirectoryLocksShared[\s\S]*withDocumentLock[\s\S]*writeMarkdownFile/);
    expect(source).toMatch(/withDocumentLock[\s\S]*readFile\(resolved\.absPath, 'utf-8'\)[\s\S]*writeMarkdownFile/);
    expect(source).toMatch(/let snapshotContentHash = newContentHash/);
    expect(source).toMatch(/if \(frontmatterChanged\) {/);
  });
});
