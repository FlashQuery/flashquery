import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import type { FlashQueryConfig } from '../../src/config/types.js';
import {
  withDocumentLock,
  withDocumentLocks,
  __testing,
} from '../../src/services/document-lock.js';
import { closePgPools, __setPgPoolFactoryForTesting } from '../../src/utils/pg-client.js';

type QueryCall = { sql: string; params?: unknown[] };

class FakePoolClient {
  readonly calls: QueryCall[] = [];
  released = false;

  async query<Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<Row>> {
    this.calls.push({ sql, params });
    if (sql.includes('pg_advisory_unlock')) {
      return { rows: [{ released: true }] as Row[] } as QueryResult<Row>;
    }
    if (sql.includes('pg_try_advisory_lock')) {
      return { rows: [{ acquired: true }] as Row[] } as QueryResult<Row>;
    }
    return { rows: [] as Row[] } as QueryResult<Row>;
  }

  release(): void {
    this.released = true;
  }
}

function makeConfig(enabled = true): FlashQueryConfig {
  return {
    instance: {
      name: 'with-document-lock-test',
      id: 'instance-1',
      vault: { path: '/tmp/vault', markdownExtensions: ['.md'] },
    },
    supabase: {
      url: 'http://localhost:54321',
      serviceRoleKey: 'service-role',
      databaseUrl: 'postgres://fq/test',
      skipDdl: true,
    },
    locking: { enabled },
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

describe('REQ-009 withDocumentLock facade', () => {
  let clients: FakePoolClient[];

  beforeEach(() => {
    ({ clients } = installFakePool());
  });

  afterEach(async () => {
    await closePgPools();
    __setPgPoolFactoryForTesting(null);
  });

  it('T-U-016 acquires Tier 1 plus advisory Tier 2 and releases on success', async () => {
    const result = await withDocumentLock(makeConfig(), '/tmp/vault/a.md', async () => 'done');

    expect(result).toBe('done');
    expect(clients).toHaveLength(1);
    expect(clients[0].calls.map((call) => call.sql)).toEqual([
      'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
      'SELECT pg_advisory_unlock($1::bigint) AS released',
    ]);
    expect(clients[0].released).toBe(true);
  });

  it('T-U-016 releases advisory Tier 2 when the callback throws', async () => {
    await expect(
      withDocumentLock(makeConfig(), '/tmp/vault/a.md', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(clients).toHaveLength(1);
    expect(clients[0].calls.map((call) => call.sql)).toEqual([
      'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
      'SELECT pg_advisory_unlock($1::bigint) AS released',
    ]);
    expect(clients[0].released).toBe(true);
  });

  it('T-U-017 withDocumentLocks acquires advisory locks in sorted canonical basic-key order and releases reverse order', async () => {
    const config = makeConfig();
    const unsortedPaths = ['/tmp/vault/b.md', '/tmp/vault/a.md', '/tmp/vault/a.md'];
    const expectedEntries = await Promise.all(
      [...new Set(unsortedPaths)].map((filePath) =>
        __testing.deriveDocumentLockEntry(config, filePath)
      )
    );
    const expectedKeys = expectedEntries
      .sort((a, b) => a.basicKey.localeCompare(b.basicKey))
      .map((entry) => __testing.deriveAdvisoryKey(config, entry.basicKey.replace(/^file:/, '')));

    await withDocumentLocks(config, unsortedPaths, async () => undefined);
    const resolvedExpectedKeys = await Promise.all(expectedKeys);

    expect(clients).toHaveLength(1);
    expect(clients[0].calls.map((call) => call.sql)).toEqual([
      'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
      'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
      'SELECT pg_advisory_unlock($1::bigint) AS released',
      'SELECT pg_advisory_unlock($1::bigint) AS released',
    ]);
    expect(clients[0].calls.slice(0, 2).map((call) => call.params?.[0])).toEqual(
      resolvedExpectedKeys
    );
    expect(clients[0].calls.slice(2).map((call) => call.params?.[0])).toEqual(
      [...resolvedExpectedKeys].reverse()
    );
  });

  it('T-U-018 releases Tier 1 after advisory unlock failure so a later caller can enter', async () => {
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
          if (sql.includes('pg_advisory_unlock')) {
            return { rows: [{ released: false }] as Row[] } as QueryResult<Row>;
          }
          if (sql.includes('pg_try_advisory_lock')) {
            return { rows: [{ acquired: true }] as Row[] } as QueryResult<Row>;
          }
          return { rows: [] as Row[] } as QueryResult<Row>;
        };
        clients.push(client);
        return client as unknown as PoolClient;
      },
      async end(): Promise<void> {},
    }));

    await expect(
      withDocumentLock(makeConfig(), '/tmp/vault/a.md', async () => 'done')
    ).rejects.toThrow(/Failed to release advisory document lock/);

    await closePgPools();
    ({ clients } = installFakePool());

    await expect(withDocumentLock(makeConfig(), '/tmp/vault/a.md', async () => 'ok')).resolves.toBe(
      'ok'
    );
  });

  it('does not self-deadlock when multiple document keys share a Tier 1 stripe', async () => {
    await expect(
      Promise.race([
        withDocumentLocks(
          makeConfig(false),
          ['/tmp/vault/file-21.md', '/tmp/vault/file-120.md'],
          async () => 'ok'
        ),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 100)),
      ])
    ).resolves.toBe('ok');
  });
});
