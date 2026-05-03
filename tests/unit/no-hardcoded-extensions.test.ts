import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (name.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

// These files legitimately define or document the markdown_extensions config key itself.
const ALLOWLISTED_FILES = new Set([
  'src/config/loader.ts',
]);

describe('[ANTIPATTERN] no hardcoded markdown extension arrays', () => {
  it('all listMarkdownFiles call sites must use config.instance.vault.markdownExtensions, not [".md"]', () => {
    const srcRoot = join(process.cwd(), 'src');
    const violations: string[] = [];

    for (const absPath of collectTsFiles(srcRoot)) {
      const relPath = relative(process.cwd(), absPath);
      if (ALLOWLISTED_FILES.has(relPath)) continue;

      const lines = readFileSync(absPath, 'utf-8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Must contain a ['.md'] or [".md"] array literal to be relevant
        if (!/\[\s*['"]\.md['"]\s*\]/.test(line)) continue;
        // Skip comment-only lines
        if (/^\s*\/\//.test(line)) continue;
        // Allow function/parameter default values: extensions: string[] = ['.md']
        if (/=\s*\[\s*['"]\.md['"]\s*\]/.test(line)) continue;

        violations.push(`  ${relPath}:${i + 1}  →  ${line.trim()}`);
      }
    }

    expect(violations, [
      '',
      'Hardcoded markdown extension array detected in source.',
      'Use config.instance.vault.markdownExtensions instead of [\'.md\'].',
      'If this is a function-signature default, use: extensions: string[] = [\'.md\']',
      '',
      ...violations,
      '',
    ].join('\n')).toHaveLength(0);
  });
});
