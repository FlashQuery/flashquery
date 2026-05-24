import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { KnipConfig } from 'knip';
import { describe, expect, it } from 'vitest';

const REQUIRED_KNIP_IGNORES = [
  '.claude/worktrees/**',
  'src/node_modules/**',
  'src/dist/**',
  'dist/**',
] as const;

describe('Phase 147 — Knip config policy', () => {
  it('[T-U-015] excludes worktree, vendor, and build-noise globs with actionable failures', async () => {
    const configPath = resolve(process.cwd(), 'knip.ts');
    const { default: config } = await import(pathToFileURL(configPath).href) as { default: KnipConfig };
    const ignoreGlobs = config.ignore ?? [];
    const missingGlobs = REQUIRED_KNIP_IGNORES.filter((glob) => !ignoreGlobs.includes(glob));

    expect(missingGlobs, [
      '',
      'Knip config is missing required ignore globs.',
      'Add each missing glob to knip.ts so npm run knip stays actionable:',
      ...missingGlobs.map((glob) => `  - ${glob}`),
      '',
    ].join('\n')).toHaveLength(0);
  });
});
