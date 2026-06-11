import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/loader.js';

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function writeConfig(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fq-lifecycle-config-'));
  tempDirs.push(dir);
  const configPath = join(dir, 'flashquery.yml');
  await writeFile(configPath, body);
  return configPath;
}

describe('embedding lifecycle config', () => {
  it('REQ-038 parses configurable lifecycle lock stale threshold', async () => {
    const configPath = await writeConfig(`
instance:
  id: lifecycle-config-test
  vault:
    path: ./vault
supabase:
  url: https://test.supabase.co
  service_role_key: test-key
  database_url: postgresql://localhost:5432/test
embedding_lifecycle:
  lock_stale_ms: 2500
logging:
  level: error
`);

    const config = await loadConfig(configPath);

    expect(config.embeddingLifecycle).toEqual({ lockStaleMs: 2500 });
  });
});
