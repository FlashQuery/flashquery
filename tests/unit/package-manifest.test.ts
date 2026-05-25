import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type PackageManifest = {
  files?: string[];
  scripts?: Record<string, string>;
};

async function readPackageManifest(): Promise<PackageManifest> {
  return JSON.parse(
    await readFile(resolve(process.cwd(), 'package.json'), 'utf-8')
  ) as PackageManifest;
}

describe('package manifest', () => {
  it('exposes useful scripts without benchmark aliases that duplicate the benchmark suite', async () => {
    const manifest = await readPackageManifest();

    expect(manifest.scripts?.['test:benchmark']).toBe(
      'vitest run --config tests/config/vitest.benchmark.config.ts'
    );
    expect(manifest.scripts?.['bench:mcp-broker']).toBeUndefined();
    expect(manifest.scripts?.['test:docker-smoke']).toBe('bash scripts/smoke-test.sh');
  });

  it('includes setup assets needed by npm package users', async () => {
    const manifest = await readPackageManifest();

    expect(manifest.files).toEqual(
      expect.arrayContaining([
        'setup/',
        '.env.example',
        'flashquery.example.yml',
        'docker/.env.docker.example',
      ])
    );
  });
});
