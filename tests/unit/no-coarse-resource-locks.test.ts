import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return listSourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('no-coarse-resource-locks T-U-036', () => {
  it('does not use coarse records, memory, or plugins write-lock resources in src/', () => {
    const offenders: string[] = [];
    const forbiddenCall = /\b(?:acquireLock|releaseLock)\s*\([\s\S]{0,500}?['"](?:records|memory|plugins)['"]/g;

    for (const file of listSourceFiles('src')) {
      if (file === join('src', 'services', 'write-lock.ts')) continue;
      const source = stripComments(readFileSync(file, 'utf8'));
      if (forbiddenCall.test(source)) {
        offenders.push(relative(process.cwd(), file));
      }
      forbiddenCall.lastIndex = 0;
    }

    expect(offenders).toEqual([]);
  });
});
