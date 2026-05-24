import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REQUIRED_KNIP_IGNORES = [
  '.claude/worktrees/**',
  'src/node_modules/**',
  'src/dist/**',
] as const;

describe('Phase 147 — Knip config policy', () => {
  it('[T-U-015] excludes worktree, vendor, and build-noise globs with actionable failures', () => {
    const configPath = resolve(process.cwd(), 'knip.ts');
    const configSource = readFileSync(configPath, 'utf-8');
    const missingGlobs = REQUIRED_KNIP_IGNORES.filter((glob) => !configSource.includes(`'${glob}'`));

    expect(missingGlobs, [
      '',
      'Knip config is missing required ignore globs.',
      'Add each missing glob to knip.ts so npm run knip stays actionable:',
      ...missingGlobs.map((glob) => `  - ${glob}`),
      '',
    ].join('\n')).toHaveLength(0);
  });
});
