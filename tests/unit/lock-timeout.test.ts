import { afterEach, describe, expect, it } from 'vitest';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import type { FlashQueryConfig } from '../../src/config/types.js';
import { LockTimeoutError, withDocumentLock } from '../../src/services/document-lock.js';
import { closePgPools, __setPgPoolFactoryForTesting } from '../../src/utils/pg-client.js';

type QueryCall = { sql: string; params?: unknown[] };

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

describe('REQ-006 bounded lock acquisition timeout', () => {
  afterEach(async () => {
    await closePgPools();
    __setPgPoolFactoryForTesting(null);
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

  it('T-U-015 lock-timeout default is carried by the typed timeout error', () => {
    const err = new LockTimeoutError('file:/tmp/vault/busy.md');

    expect(err.reason).toBe('lock_timeout');
    expect(err.timeoutSeconds).toBe(10);
  });
});
