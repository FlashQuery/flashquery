import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(fullPath));
    } else if (entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('REQ-009 document lock facade only', () => {
  it('T-U-019 exposes no low-level document lock primitive outside src/services/document-lock.ts', async () => {
    const root = new URL('../../', import.meta.url).pathname;
    const files = await listSourceFiles(join(root, 'src'));
    const offenders: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf-8');
      const normalized = file.replace(root, '');
      if (normalized === 'src/services/document-lock.ts') continue;
      if (/from ['"].*services\/write-lock\.js['"]/.test(source)) offenders.push(normalized);
      if (/\bwithDocumentLock(s)?\b/.test(source) && normalized.includes('src/macro/')) offenders.push(normalized);
      if (/\bexport\s+(?:async\s+)?function\s+acquire(?:Tier|Document)|\bexport\s+(?:async\s+)?function\s+release(?:Tier|Document)/.test(source)) {
        offenders.push(normalized);
      }
    }

    expect(offenders).toEqual([]);
  });
});
