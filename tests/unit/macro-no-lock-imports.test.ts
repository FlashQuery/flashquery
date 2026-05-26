import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const FORBIDDEN = /\b(?:withDocumentLock|withDocumentLocks|document-lock|write-lock|acquireLock|releaseLock)\b/;

describe('REQ-025 macro layer lock boundary', () => {
  it('T-U-038 keeps macro engine files free of document/write lock imports and calls', async () => {
    const files = [
      'src/mcp/tools/macro.ts',
      'src/macro/evaluator.ts',
    ];
    const offenders: string[] = [];

    for (const file of files) {
      const source = await readFile(new URL(`../../${file}`, import.meta.url), 'utf-8');
      if (FORBIDDEN.test(source)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});
