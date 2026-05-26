import { afterEach, describe, expect, it } from 'vitest';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import type { FlashQueryConfig } from '../../src/config/types.js';
import { closePgPools, __setPgPoolFactoryForTesting } from '../../src/utils/pg-client.js';
import { withDocumentLock } from '../../src/services/document-lock.js';

type QueryCall = { sql: string; params?: unknown[] };

class FakePoolClient {
  readonly calls: QueryCall[] = [];
  released = false;

  async query<Row extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<QueryResult<Row>> {
    this.calls.push({ sql, params });
    if (sql.includes('pg_advisory_unlock')) {
      return { rows: [{ released: true }] as Row[] } as QueryResult<Row>;
    }
    return { rows: [] as Row[] } as QueryResult<Row>;
  }

  release(): void {
    this.released = true;
  }
}

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'document-lock-tier2-test',
      id: 'instance-1',
      vault: { path: '/tmp/vault', markdownExtensions: ['.md'] },
    },
    supabase: { url: 'http://localhost:54321', serviceRoleKey: 'service-role', databaseUrl: 'postgres://fq/test', skipDdl: true },
    locking: { enabled: true },
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

function createGate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('REQ-002 advisory-lock two-tier document lock Tier 2', () => {
  afterEach(async () => {
    await closePgPools();
    __setPgPoolFactoryForTesting(null);
  });

  it('T-U-004 advisory-lock uses parameterized session acquire/release on one checked-out client', async () => {
    const { clients } = installFakePool();
    const events: string[] = [];

    await withDocumentLock(makeConfig(), '/tmp/vault/tier2.md', async () => {
      events.push('inside');
      expect(clients).toHaveLength(1);
      expect(clients[0].released).toBe(false);
    });

    expect(events).toEqual(['inside']);
    expect(clients).toHaveLength(1);
    expect(clients[0].calls).toEqual([
      {
        sql: 'SELECT pg_advisory_lock($1::bigint)',
        params: [expect.anything()],
      },
      {
        sql: 'SELECT pg_advisory_unlock($1::bigint) AS released',
        params: [expect.anything()],
      },
    ]);
    expect(clients[0].calls[0].params?.[0]).toBe(clients[0].calls[1].params?.[0]);
    expect(clients[0].released).toBe(true);
  });

  it('T-U-005 advisory-lock same-process burst collapses to one Tier 2 acquire/release pair', async () => {
    const { clients } = installFakePool();
    const events: string[] = [];
    const firstEntered = createGate();
    const releaseFirst = createGate();

    const first = withDocumentLock(makeConfig(), '/tmp/vault/burst.md', async () => {
      events.push('first-enter');
      firstEntered.release();
      await releaseFirst.promise;
      events.push('first-exit');
    });

    await firstEntered.promise;

    const second = withDocumentLock(makeConfig(), '/tmp/vault/burst.md', async () => {
      events.push('second-enter');
    });
    const third = withDocumentLock(makeConfig(), '/tmp/vault/burst.md', async () => {
      events.push('third-enter');
    });

    await Promise.resolve();
    expect(events).toEqual(['first-enter']);

    releaseFirst.release();
    await Promise.all([first, second, third]);

    expect(events).toEqual(['first-enter', 'first-exit', 'second-enter', 'third-enter']);
    expect(clients).toHaveLength(1);
    expect(clients[0].calls.filter((call) => call.sql.includes('pg_advisory_lock'))).toHaveLength(1);
    expect(clients[0].calls.filter((call) => call.sql.includes('pg_advisory_unlock'))).toHaveLength(1);
  });
});
