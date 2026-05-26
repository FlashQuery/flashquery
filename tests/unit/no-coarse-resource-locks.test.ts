import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SKIP_DIRS = new Set(['dist', 'node_modules', '.git', 'coverage']);

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (SKIP_DIRS.has(entry)) return [];
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
    const files = listSourceFiles('src');

    expect(files.length).toBeGreaterThan(50);
    expect(files.length).toBeLessThan(500);
    expect(files).not.toContain(join('src', 'dist', 'index.d.ts'));
    expect(files.some((file) => file.includes(`${join('src', 'node_modules')}${sep}`))).toBe(false);

    for (const file of files) {
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
