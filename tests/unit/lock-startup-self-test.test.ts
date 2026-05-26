import { afterEach, describe, expect, it } from 'vitest';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { assertLockingSessionCapability, verifySessionAdvisoryLocks } from '../../src/services/lock-startup.js';
import type { FlashQueryConfig } from '../../src/config/types.js';
import { closePgPools, __setPgPoolFactoryForTesting } from '../../src/utils/pg-client.js';

type QueryCall = { sql: string; params?: unknown[] };

class FakeStartupClient {
  readonly calls: QueryCall[] = [];
  released = false;

  constructor(
    private readonly role: 'owner' | 'observer',
    private readonly state: { locked: boolean; observerCanSeeLock: boolean }
  ) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<Row>> {
    this.calls.push({ sql, params });

    if (sql.includes('pg_advisory_xact_lock')) {
      throw new Error('pg_advisory_xact_lock must not be used for lock-startup');
    }

    if (sql.includes('pg_advisory_lock')) {
      this.state.locked = true;
      return { rows: [] as Row[] } as QueryResult<Row>;
    }

    if (sql.includes('pg_locks')) {
      const visible =
        this.role === 'observer' && this.state.locked && this.state.observerCanSeeLock;
      return { rows: [{ visible }] as Row[] } as QueryResult<Row>;
    }

    if (sql.includes('pg_advisory_unlock')) {
      const released = this.role === 'owner' && this.state.locked;
      this.state.locked = false;
      return { rows: [{ released }] as Row[] } as QueryResult<Row>;
    }

    throw new Error(`Unexpected query: ${sql}`);
  }

  release(): void {
    this.released = true;
  }
}

function installFakeStartupPool(observerCanSeeLock: boolean): { clients: FakeStartupClient[] } {
  const clients: FakeStartupClient[] = [];
  const state = { locked: false, observerCanSeeLock };

  __setPgPoolFactoryForTesting(() => ({
    async query<Row extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<Row>> {
      return { rows: [] as Row[] } as QueryResult<Row>;
    },
    async connect(): Promise<PoolClient> {
      const client = new FakeStartupClient(clients.length === 0 ? 'owner' : 'observer', state);
      clients.push(client);
      return client as unknown as PoolClient;
    },
    async end(): Promise<void> {},
  }));

  return { clients };
}

function makeConfig(lockingEnabled: boolean): FlashQueryConfig {
  return {
    instance: {
      name: 'lock-startup-self-test',
      id: 'lock-startup-self-test',
      vault: { path: '/tmp/vault', markdownExtensions: ['.md'] },
    },
    supabase: {
      url: 'http://localhost:54321',
      serviceRoleKey: 'service-role',
      databaseUrl: 'postgres://fq/test',
      skipDdl: true,
    },
    locking: { enabled: lockingEnabled },
  } as FlashQueryConfig;
}

describe('REQ-005 lock-startup session-capable advisory-lock self-test', () => {
  afterEach(async () => {
    await closePgPools();
    __setPgPoolFactoryForTesting(null);
  });

  it('T-U-012 lock-startup session-capable self-test observes owner advisory lock from a second checkout', async () => {
    const { clients } = installFakeStartupPool(true);

    const result = await verifySessionAdvisoryLocks('postgres://fq/session-capable');

    expect(result).toEqual({ ok: true });
    expect(clients).toHaveLength(2);
    expect(clients.every((client) => client.released)).toBe(true);
    expect(clients[0].calls).toEqual([
      {
        sql: 'SELECT pg_advisory_lock($1::bigint)',
        params: [expect.any(String)],
      },
      {
        sql: 'SELECT pg_advisory_unlock($1::bigint) AS released',
        params: [expect.any(String)],
      },
    ]);
    expect(clients[1].calls).toEqual([
      {
        sql: expect.stringContaining('pg_locks'),
        params: [clients[0].calls[0].params?.[0]],
      },
    ]);
    expect(clients[1].calls[0].sql).toContain('$1::bigint');
    expect(clients.flatMap((client) => client.calls).map((call) => call.sql).join('\n')).not.toContain(
      'pg_advisory_xact_lock'
    );
  });

  it('T-U-013 lock-startup transaction-mode pooler simulation fails as session_not_stable', async () => {
    installFakeStartupPool(false);

    const result = await verifySessionAdvisoryLocks('postgres://fq/transaction-pooler');

    expect(result).toMatchObject({
      ok: false,
      reason: 'session_not_stable',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('session-capable');
      expect(result.message).toContain('transaction-mode pooler');
    }
  });

  it('skips the session self-test when locking is disabled', async () => {
    __setPgPoolFactoryForTesting(() => ({
      async query<Row extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<Row>> {
        throw new Error('pool should not be used');
      },
      async connect(): Promise<PoolClient> {
        throw new Error('pool should not be used');
      },
      async end(): Promise<void> {},
    }));

    await expect(assertLockingSessionCapability(makeConfig(false))).resolves.toBeUndefined();
  });
});
