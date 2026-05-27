import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import type { FlashQueryConfig } from '../../src/config/types.js';
import {
  LockTimeoutError,
  withAncestorDirectoryLocksShared,
  withDirectoryLockExclusive,
} from '../../src/services/document-lock.js';
import { closePgPools, __setPgPoolFactoryForTesting } from '../../src/utils/pg-client.js';

type QueryCall = { sql: string; params?: unknown[] };

class FakePoolClient {
  readonly calls: QueryCall[] = [];
  released = false;
  acquireSucceeds = true;
  releaseSucceeds = true;

  async query<Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<Row>> {
    this.calls.push({ sql, params });
    if (sql.includes('pg_advisory_unlock')) {
      return { rows: [{ released: this.releaseSucceeds }] as Row[] } as QueryResult<Row>;
    }
    if (sql.includes('pg_try_advisory_lock')) {
      return { rows: [{ acquired: this.acquireSucceeds }] as Row[] } as QueryResult<Row>;
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
      name: 'with-directory-lock-test',
      id: 'instance-1',
      vault: { path: '/tmp/vault', markdownExtensions: ['.md'] },
    },
    supabase: {
      url: 'http://localhost:54321',
      serviceRoleKey: 'service-role',
      databaseUrl: 'postgres://fq/test',
      skipDdl: true,
    },
    locking: { enabled: true, lockTimeoutSeconds },
  } as FlashQueryConfig;
}

function installFakePool(): { clients: FakePoolClient[] } {
  const clients: FakePoolClient[] = [];
  __setPgPoolFactoryForTesting(() => ({
    async query<Row extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<Row>> {
      return { rows: [] as Row[] } as QueryResult<Row>;
    },
    async connect(): Promise<PoolClient> {
      const client = new FakePoolClient();
      clients.push(client);
      return client as unknown as PoolClient;
    },
    async end(): Promise<void> {},
  }));
  return { clients };
}

describe('REQ-007 with-directory-lock shared ancestor facade', () => {
  let clients: FakePoolClient[];

  beforeEach(() => {
    ({ clients } = installFakePool());
  });

  afterEach(async () => {
    await closePgPools();
    __setPgPoolFactoryForTesting(null);
  });

  it('T-I-011 T-I-012 derives shared dir locks for file parent ancestors through vault root', async () => {
    const events: string[] = [];

    await withAncestorDirectoryLocksShared(
      makeConfig(),
      '/tmp/vault/Notes/Sub/A.md',
      async () => {
        events.push('inside');
      }
    );

    expect(events).toEqual(['inside']);
    expect(clients).toHaveLength(1);
    expect(clients[0].calls.map((call) => call.sql)).toEqual([
      'SELECT pg_try_advisory_lock_shared($1::bigint) AS acquired',
      'SELECT pg_try_advisory_lock_shared($1::bigint) AS acquired',
      'SELECT pg_try_advisory_lock_shared($1::bigint) AS acquired',
      'SELECT pg_advisory_unlock_shared($1::bigint) AS released',
      'SELECT pg_advisory_unlock_shared($1::bigint) AS released',
      'SELECT pg_advisory_unlock_shared($1::bigint) AS released',
    ]);
    expect(new Set(clients[0].calls.slice(0, 3).map((call) => call.params?.[0])).size).toBe(3);
    expect(clients[0].released).toBe(true);
  });

  it('T-I-013 releases acquired shared dir locks in reverse order after partial timeout', async () => {
    const { clients: installedClients } = installFakePool();
    clients = installedClients;
    let attempts = 0;
    clients.length = 0;
    __setPgPoolFactoryForTesting(() => ({
      async query<Row extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<Row>> {
        return { rows: [] as Row[] } as QueryResult<Row>;
      },
      async connect(): Promise<PoolClient> {
        const client = new FakePoolClient();
        client.query = async <Row extends QueryResultRow = QueryResultRow>(
          sql: string,
          params?: unknown[]
        ): Promise<QueryResult<Row>> => {
          client.calls.push({ sql, params });
          if (sql.includes('pg_try_advisory_lock_shared')) {
            attempts += 1;
            return { rows: [{ acquired: attempts === 1 }] as Row[] } as QueryResult<Row>;
          }
          if (sql.includes('pg_advisory_unlock_shared')) {
            return { rows: [{ released: true }] as Row[] } as QueryResult<Row>;
          }
          return { rows: [] as Row[] } as QueryResult<Row>;
        };
        clients.push(client);
        return client as unknown as PoolClient;
      },
      async end(): Promise<void> {},
    }));

    await expect(
      withAncestorDirectoryLocksShared(makeConfig(0.05), '/tmp/vault/Notes/A.md', async () => 'done')
    ).rejects.toMatchObject({ name: 'LockTimeoutError', reason: 'lock_timeout' });

    expect(clients[0].calls.some((call) => call.sql.includes('pg_advisory_unlock_shared'))).toBe(
      true
    );
  });

  it('T-I-046 uses an exclusive dir lock for structural folder operations', async () => {
    await expect(
      withDirectoryLockExclusive(makeConfig(), '/tmp/vault/Notes', async () => 'renamed')
    ).resolves.toBe('renamed');

    expect(clients[0].calls.map((call) => call.sql)).toEqual([
      'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
      'SELECT pg_advisory_unlock($1::bigint) AS released',
    ]);
  });

  it('T-I-047 preserves callback errors when shared dir release also fails', async () => {
    const callbackError = new Error('callback failed');

    await expect(
      withAncestorDirectoryLocksShared(makeConfig(), '/tmp/vault/Notes/A.md', async () => {
        clients[0].releaseSucceeds = false;
        throw callbackError;
      })
    ).rejects.toThrow(callbackError);

    expect(clients[0].calls.some((call) => call.sql.includes('pg_advisory_unlock_shared'))).toBe(
      true
    );
  });

  it('T-I-047 surfaces shared dir release failures when the callback succeeds', async () => {
    await expect(
      withAncestorDirectoryLocksShared(makeConfig(), '/tmp/vault/Notes/A.md', async () => {
        clients[0].releaseSucceeds = false;
        return 'done';
      })
    ).rejects.toThrow(/Failed to release advisory directory lock/);
  });

  it('raises LockTimeoutError with lock_timeout reason for contended exclusive dir locks', async () => {
    clients[0]?.calls.splice(0);
    clients.length = 0;
    __setPgPoolFactoryForTesting(() => ({
      async query<Row extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<Row>> {
        return { rows: [] as Row[] } as QueryResult<Row>;
      },
      async connect(): Promise<PoolClient> {
        const client = new FakePoolClient();
        client.acquireSucceeds = false;
        clients.push(client);
        return client as unknown as PoolClient;
      },
      async end(): Promise<void> {},
    }));

    await expect(
      withDirectoryLockExclusive(makeConfig(0.05), '/tmp/vault/Notes', async () => 'never')
    ).rejects.toBeInstanceOf(LockTimeoutError);
    expect(clients[0].calls.some((call) => call.sql.includes('pg_try_advisory_lock'))).toBe(true);
  });
});
