import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...sourceFiles(fullPath));
    } else if (entry.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function unauthorizedLegacyTableReferences(file: string, source: string): string[] {
  const rel = relative(process.cwd(), file);
  const matches = [...source.matchAll(/fqc_write_locks/g)];
  if (rel === join('src', 'storage', 'supabase.ts')) {
    return matches
      .filter((match) => {
        const line = source.slice(0, match.index).split('\n').length;
        const textLine = source.split('\n')[line - 1] ?? '';
        return !/DROP TABLE IF EXISTS fqc_write_locks/.test(textLine);
      })
      .map(() => rel);
  }
  return matches.map(() => rel);
}

describe('REQ-004 legacy-write-lock retirement static guard', () => {
  it('T-U-011 legacy-write-lock production source has no table-lock imports, symbols, CLI command, or unauthorized table references', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC_ROOT)) {
      const rel = relative(process.cwd(), file);
      const source = readFileSync(file, 'utf-8');

      if (/from\s+['"].*\/services\/write-lock(?:\.js)?['"]/.test(source)) {
        offenders.push(`${rel}: imports services/write-lock`);
      }
      if (/\b(?:acquireLock|releaseLock|isLocked)\b/.test(source)) {
        offenders.push(`${rel}: references legacy lock symbol`);
      }
      if (/flashquery\s+unlock/.test(source) || /new Command\(['"]unlock['"]\)/.test(source)) {
        offenders.push(`${rel}: exposes flashquery unlock`);
      }
      for (const tableRef of unauthorizedLegacyTableReferences(file, source)) {
        offenders.push(`${tableRef}: unauthorized fqc_write_locks reference`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
