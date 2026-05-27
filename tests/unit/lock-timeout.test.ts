import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import type { FlashQueryConfig } from '../../src/config/types.js';
import { loadConfig } from '../../src/config/loader.js';
import { LockTimeoutError, withDocumentLock } from '../../src/services/document-lock.js';
import { closePgPools, __setPgPoolFactoryForTesting } from '../../src/utils/pg-client.js';

type QueryCall = { sql: string; params?: unknown[] };
const tempDirs: string[] = [];

class ContendedPoolClient {
  readonly calls: QueryCall[] = [];
  released = false;

  async query<Row extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<QueryResult<Row>> {
    this.calls.push({ sql, params });
    if (sql.includes('pg_try_advisory_lock')) {
      return { rows: [{ acquired: false }] as Row[] } as QueryResult<Row>;
    }
    if (sql.includes('pg_advisory_unlock')) {
      return { rows: [{ released: true }] as Row[] } as QueryResult<Row>;
    }
    return { rows: [] as Row[] } as QueryResult<Row>;
  }

  release(): void {
    this.released = true;
  }
}

function makeConfig(lockTimeoutSeconds = 10): FlashQueryConfig {
  return {
    instance: {
      name: 'lock-timeout-test',
      id: 'instance-1',
      vault: { path: '/tmp/vault', markdownExtensions: ['.md'] },
    },
    supabase: { url: 'http://localhost:54321', serviceRoleKey: 'service-role', databaseUrl: 'postgres://fq/test', skipDdl: true },
    locking: { enabled: true, lockTimeoutSeconds },
  } as FlashQueryConfig;
}

function installContendedPool(): { clients: ContendedPoolClient[] } {
  const clients: ContendedPoolClient[] = [];
  __setPgPoolFactoryForTesting(() => ({
    async query<Row extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<Row>> {
      return { rows: [] as Row[] } as QueryResult<Row>;
    },
    async connect(): Promise<PoolClient> {
      const client = new ContendedPoolClient();
      clients.push(client);
      return client as unknown as PoolClient;
    },
    async end(): Promise<void> {},
  }));
  return { clients };
}

function writeConfig(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'fq-lock-timeout-config-'));
  tempDirs.push(dir);
  const configPath = join(dir, 'flashquery.yml');
  writeFileSync(configPath, contents);
  return configPath;
}

function baseConfig(locking = ''): string {
  return `
instance:
  id: "lock-timeout-config-test"
  vault:
    path: "./vault"
supabase:
  url: "https://test.supabase.co"
  service_role_key: "key"
  database_url: "postgresql://localhost/db"
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
${locking}
`;
}

describe('REQ-006 bounded lock acquisition timeout', () => {
  afterEach(async () => {
    await closePgPools();
    __setPgPoolFactoryForTesting(null);
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('T-U-014 lock-timeout configured controls the pg_try_advisory_lock retry deadline', async () => {
    const { clients } = installContendedPool();

    await expect(withDocumentLock(makeConfig(1), '/tmp/vault/busy.md', async () => 'done')).rejects.toMatchObject({
      name: 'LockTimeoutError',
      reason: 'lock_timeout',
      timeoutSeconds: 1,
    });

    expect(clients[0].calls.some((call) => call.sql === 'SELECT pg_try_advisory_lock($1::bigint) AS acquired')).toBe(true);
    expect(clients[0].released).toBe(true);
  });

  it('T-U-015 lock-timeout default applies when lock_timeout_seconds is absent', () => {
    const config = loadConfig(writeConfig(baseConfig()));

    expect(config.locking.lockTimeoutSeconds).toBe(10);
  });

  it('LockTimeoutError carries the default 10 s when no override is provided', () => {
    const err = new LockTimeoutError('file:/tmp/vault/busy.md');

    expect(err.reason).toBe('lock_timeout');
    expect(err.timeoutSeconds).toBe(10);
  });
});
