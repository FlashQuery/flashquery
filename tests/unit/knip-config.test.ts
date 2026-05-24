import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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

  it('[T-U-015] declares the production-source-only reachability policy in source', async () => {
    const source = await readFile(resolve(process.cwd(), 'knip.ts'), 'utf-8');

    expect(source).toContain('Reachability policy: PRODUCTION-SOURCE-ONLY');
    expect(source).toContain('Test entrypoints, scripts, and fixtures are intentionally excluded');
  });

  it('[T-U-015] runs the default reporter set with explicit export/type ignore entries', async () => {
    const configPath = resolve(process.cwd(), 'knip.ts');
    const { default: config } = await import(pathToFileURL(configPath).href) as { default: KnipConfig };
    const packageJson = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.knip).toBe('knip --no-config-hints');
    expect(packageJson.scripts?.knip).not.toContain('--include');
    expect(packageJson.scripts?.knip).not.toContain('--exclude');
    expect(Object.keys(config.ignoreIssues ?? {})).toContain('src/constants/template-warnings.ts');
    expect(config.ignoreIssues?.['src/constants/template-warnings.ts']).toEqual(['types']);
    expect(config.ignoreIssues?.['src/mcp/utils/response-formats.ts']).toEqual(['exports', 'types']);
  });
});
