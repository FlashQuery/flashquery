import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDeprecationWarnings, loadConfig } from '../../src/config/loader.js';
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import {
  HAS_SUPABASE,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../helpers/test-env.js';
import type { FlashQueryConfig } from '../../src/config/types.js';

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: 'fqc-write-locks-drop-integration',
      id: 'fqc-write-locks-drop-integration',
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
    },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    server: { host: 'localhost', port: 3200 },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: true },
    trashFolder: {
      enabled: false,
      path: '.flashquery/removed',
      collisionStrategy: 'suffix',
    },
  } as FlashQueryConfig;
}

describe.skipIf(!HAS_SUPABASE)('REQ-004 fqc-write-locks-drop lock-startup retirement integration', () => {
  afterAll(async () => {
    await supabaseManager.close();
  });

  it('T-I-005 fqc-write-locks-drop startup drops the legacy fqc_write_locks table', async () => {
    const vaultPath = await mkdtemp(join(tmpdir(), 'fqc-write-locks-drop-'));
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    try {
      await client.connect();
      await client.query(`
        CREATE TABLE IF NOT EXISTS fqc_write_locks (
          instance_id TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ NOT NULL,
          PRIMARY KEY (instance_id, resource_type)
        )
      `);
      await client.query(`
        INSERT INTO fqc_write_locks (instance_id, resource_type, expires_at)
        VALUES ('legacy-drop-test', 'documents', now() + interval '5 minutes')
        ON CONFLICT DO NOTHING
      `);

      const existsBefore = await client.query<{ exists: boolean }>(
        "SELECT to_regclass('public.fqc_write_locks') IS NOT NULL AS exists"
      );
      expect(existsBefore.rows[0]?.exists).toBe(true);

      const config = makeConfig(vaultPath);
      initLogger(config);
      await initSupabase(config);

      await expect(client.query('SELECT 1 FROM fqc_write_locks LIMIT 1')).rejects.toThrow(
        /relation "fqc_write_locks" does not exist/
      );
    } finally {
      await client.end().catch(() => undefined);
      await rm(vaultPath, { recursive: true, force: true });
    }
  }, 60_000);

  it('T-I-006 lock-startup legacy ttl_seconds config loads and emits one deprecation warning', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fqc-legacy-ttl-'));
    try {
      const configPath = join(dir, 'flashquery.yml');
      await writeFile(
        configPath,
        `
instance:
  id: "legacy-ttl-integration"
  vault:
    path: "./vault"
supabase:
  url: "${TEST_SUPABASE_URL}"
  service_role_key: "${TEST_SUPABASE_KEY}"
  database_url: "${TEST_DATABASE_URL}"
embedding:
  provider: "none"
  model: ""
locking:
  enabled: true
  ttl_seconds: 30
`
      );

      const config = loadConfig(configPath);
      expect(config.locking).not.toHaveProperty('ttlSeconds');
      expect(getDeprecationWarnings(config).filter((warning) => warning.includes('ttl_seconds'))).toEqual([
        'locking.ttl_seconds is deprecated; advisory locks do not use TTL and this key is safe to remove.',
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
