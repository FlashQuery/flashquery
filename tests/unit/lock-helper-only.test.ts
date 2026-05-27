import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('REQ-009 document lock facade only', () => {
  it('T-U-019 exposes no low-level document lock primitive outside src/services/document-lock.ts', async () => {
    const source = await readFile(new URL('../../src/services/document-lock.ts', import.meta.url), 'utf-8');
    const exportedSymbols = [...source.matchAll(/^export\s+(?:async\s+function|class|interface|const|type)\s+(\w+)/gm)]
      .map((match) => match[1]);

    expect(exportedSymbols.sort()).toEqual(['LockTimeoutError', '__testing', 'withDocumentLock', 'withDocumentLocks'].sort());
    expect(source).not.toMatch(/export\s+(?:async\s+)?function\s+acquire/i);
    expect(source).not.toMatch(/export\s+(?:async\s+)?function\s+release/i);
  });
});
