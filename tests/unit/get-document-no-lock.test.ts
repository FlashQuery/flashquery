import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

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
});
