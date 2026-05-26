import { afterEach, describe, expect, it } from 'vitest';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import {
  assertSessionAdvisoryLocksOrThrow,
  verifySessionAdvisoryLocks,
} from '../../src/services/lock-startup.js';
import { closePgPools, __setPgPoolFactoryForTesting } from '../../src/utils/pg-client.js';
import { HAS_SUPABASE, TEST_DATABASE_URL } from '../helpers/test-env.js';

class TransactionModeClient {
  released = false;

  constructor(
    private readonly role: 'owner' | 'observer',
    private readonly state: { locked: boolean }
  ) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    sql: string
  ): Promise<QueryResult<Row>> {
    if (sql.includes('pg_advisory_lock')) {
      this.state.locked = true;
      return { rows: [] as Row[] } as QueryResult<Row>;
    }
    if (sql.includes('pg_locks')) {
      return { rows: [{ visible: false }] as Row[] } as QueryResult<Row>;
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

function installTransactionModePool(): void {
  const state = { locked: false };
  let checkoutCount = 0;
  __setPgPoolFactoryForTesting(() => ({
    async query<Row extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<Row>> {
      return { rows: [] as Row[] } as QueryResult<Row>;
    },
    async connect(): Promise<PoolClient> {
      const role = checkoutCount++ === 0 ? 'owner' : 'observer';
      return new TransactionModeClient(role, state) as unknown as PoolClient;
    },
    async end(): Promise<void> {},
  }));
}

describe('REQ-005 lock-startup session-capable integration', () => {
  afterEach(async () => {
    await closePgPools();
    __setPgPoolFactoryForTesting(null);
  });

  it.skipIf(!HAS_SUPABASE)(
    'T-I-007 lock-startup session-capable DATABASE_URL passes the advisory-lock self-test',
    async () => {
      await expect(verifySessionAdvisoryLocks(TEST_DATABASE_URL)).resolves.toEqual({ ok: true });
    },
    20_000
  );

  it('T-I-008 lock-startup fake transaction-mode pooler throws startup-fatal session-capability guidance', async () => {
    installTransactionModePool();

    await expect(assertSessionAdvisoryLocksOrThrow('postgres://fq/transaction-pooler')).rejects.toThrow(
      /session-capable Postgres.*transaction-mode pooler/i
    );
  });
});
