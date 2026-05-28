import { afterEach, describe, expect, it } from 'vitest';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import type { FlashQueryConfig } from '../../src/config/types.js';
import { LockTimeoutError } from '../../src/services/document-lock.js';
import { withPluginCoordinationLock } from '../../src/services/plugin-coordination-lock.js';
import { closePgPools, __setPgPoolFactoryForTesting } from '../../src/utils/pg-client.js';

type QueryCall = { sql: string; params?: unknown[] };

class FakePoolClient {
  readonly calls: QueryCall[] = [];
  released = false;

  constructor(private readonly acquire: () => boolean) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<Row>> {
    this.calls.push({ sql, params });
    if (sql.includes('pg_try_advisory_lock')) {
      return { rows: [{ acquired: this.acquire() }] as Row[] } as QueryResult<Row>;
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

function makeConfig(lockTimeoutSeconds = 0.05, lockingEnabled = true): FlashQueryConfig {
  return {
    instance: {
      name: 'plugin-coordination-lock-test',
      id: 'instance-1',
      vault: { path: '/tmp/vault', markdownExtensions: ['.md'] },
    },
    supabase: {
      url: 'http://localhost:54321',
      serviceRoleKey: 'service-role',
      databaseUrl: 'postgres://fq/test',
      skipDdl: true,
    },
    locking: { enabled: lockingEnabled, lockTimeoutSeconds },
  } as FlashQueryConfig;
}

function installFakePool(acquire: () => boolean): { clients: FakePoolClient[] } {
  const clients: FakePoolClient[] = [];
  __setPgPoolFactoryForTesting(() => ({
    async query<Row extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<Row>> {
      return { rows: [] as Row[] } as QueryResult<Row>;
    },
    async connect(): Promise<PoolClient> {
      const client = new FakePoolClient(acquire);
      clients.push(client);
      return client as unknown as PoolClient;
    },
    async end(): Promise<void> {},
  }));
  return { clients };
}

describe('REQ-023 plugin coordination lock', () => {
  afterEach(async () => {
    await closePgPools();
    __setPgPoolFactoryForTesting(null);
  });

  it('uses bounded try-lock acquisition and releases resources after timeout', async () => {
    let available = false;
    const { clients } = installFakePool(() => available);
    const plugin = { pluginId: 'crm', pluginInstance: 'default' };
    const callback = async () => 'entered';

    const started = performance.now();
    await expect(
      withPluginCoordinationLock(makeConfig(), plugin, callback)
    ).rejects.toBeInstanceOf(LockTimeoutError);
    const elapsedMs = performance.now() - started;

    expect(elapsedMs).toBeLessThan(500);
    expect(clients).toHaveLength(1);
    expect(clients[0].calls.some((call) => call.sql === 'SELECT pg_try_advisory_lock(hashtextextended($1, 0)::bigint) AS acquired')).toBe(true);
    expect(clients[0].calls.some((call) => call.sql.includes('pg_advisory_unlock'))).toBe(false);
    expect(clients[0].released).toBe(true);

    available = true;
    await expect(withPluginCoordinationLock(makeConfig(), plugin, callback)).resolves.toBe(
      'entered'
    );
    expect(clients).toHaveLength(2);
    expect(clients[1].released).toBe(true);
  });

  it('times out same-process Tier 1 contention and releases the stripe for later callers', async () => {
    const { clients } = installFakePool(() => true);
    const plugin = { pluginId: 'crm', pluginInstance: 'default' };
    let releaseHolder: (() => void) | undefined;
    let holderPromise: Promise<void> | undefined;
    const holderEntered = new Promise<void>((resolve) => {
      holderPromise = withPluginCoordinationLock(makeConfig(), plugin, async () => {
        resolve();
        await new Promise<void>((release) => {
          releaseHolder = release;
        });
      });
    });
    await holderEntered;

    await expect(
      withPluginCoordinationLock(makeConfig(), plugin, async () => 'blocked')
    ).rejects.toMatchObject({
      name: 'LockTimeoutError',
      reason: 'lock_timeout',
      timeoutSeconds: 0.05,
    });
    expect(clients).toHaveLength(1);

    releaseHolder?.();
    await holderPromise;
    await expect(withPluginCoordinationLock(makeConfig(), plugin, async () => 'entered')).resolves.toBe(
      'entered'
    );
    expect(clients).toHaveLength(2);
    expect(clients.every((client) => client.released)).toBe(true);
  });

  it('bypasses the PG advisory lock when locking is disabled', async () => {
    const { clients } = installFakePool(() => {
      throw new Error('PG advisory lock should not be acquired');
    });

    await expect(
      withPluginCoordinationLock(
        makeConfig(0.05, false),
        { pluginId: 'crm', pluginInstance: 'default' },
        async () => 'entered'
      )
    ).resolves.toBe('entered');

    expect(clients).toHaveLength(0);
  });
});
