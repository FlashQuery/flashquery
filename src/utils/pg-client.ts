import { Client, Pool, types, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { logger } from '../logging/logger.js';

// pg returns timestamptz/timestamp columns as Date objects by default. Date object
// reference inequality (a !== b even when same time value) breaks the string equality
// checks in plugin-reconciliation.ts classification. Return ISO strings instead so
// comparisons work correctly.
types.setTypeParser(1184, (val: string) => new Date(val).toISOString()); // timestamptz
types.setTypeParser(1114, (val: string) => new Date(val).toISOString()); // timestamp

/**
 * Creates a PostgreSQL client for use on all platforms.
 *
 * IPv4 forcing is handled globally at startup in src/index.ts via:
 *   - dns.setDefaultResultOrder('ipv4first') — DNS returns IPv4 addresses first
 *   - net.setDefaultAutoSelectFamily(false)  — disables Happy Eyeballs so pg's
 *     bare net.Socket doesn't attempt IPv6 connections before IPv4
 *
 * The `family: 4` option is NOT passed here because pg.Client does not forward
 * it to the underlying net.Socket — it is silently ignored.
 *
 * @param connectionString - PostgreSQL connection string (e.g., postgres://user:pass@host:port/db)
 * @returns Configured pg.Client instance
 */
export function createPgClientIPv4(connectionString: string): Client {
  return new Client({ connectionString });
}

interface PgPoolLike {
  query<Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<Row>>;
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
}

interface WithPgClientOptions {
  connectTimeoutMs?: number;
  timeoutError?: Error;
}

let pgPoolFactory: (connectionString: string) => PgPoolLike = (connectionString) =>
  new Pool({
    connectionString,
    allowExitOnIdle: true,
  });

const pgPools = new Map<string, PgPoolLike>();

function getPgPool(connectionString: string): PgPoolLike {
  const existing = pgPools.get(connectionString);
  if (existing) {
    return existing;
  }

  const pool = pgPoolFactory(connectionString);
  pgPools.set(connectionString, pool);
  return pool;
}

export async function queryPgPool<Row extends QueryResultRow = QueryResultRow>(
  connectionString: string,
  sql: string,
  params?: unknown[]
): Promise<QueryResult<Row>> {
  return getPgPool(connectionString).query<Row>(sql, params);
}

export async function withPgClient<T>(
  connectionString: string,
  fn: (client: PoolClient) => Promise<T>,
  options: WithPgClientOptions = {}
): Promise<T> {
  const pool = getPgPool(connectionString);
  let client: PoolClient;
  if (options.connectTimeoutMs === undefined) {
    client = await pool.connect();
  } else {
    const connectTimeoutMs = options.connectTimeoutMs;
    let timeout: NodeJS.Timeout | undefined;
    let timedOut = false;
    const connectPromise = pool.connect();
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        reject(options.timeoutError ?? new Error('pg pool checkout timed out'));
      }, Math.max(0, connectTimeoutMs));
      timeout.unref?.();
    });

    connectPromise
      .then((lateClient) => {
        if (!timedOut) return;
        try {
          lateClient.release();
        } catch (err) {
          logger.warn(
            `pg client release failed after checkout timeout: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      })
      .catch(() => undefined);

    try {
      client = await Promise.race([connectPromise, timeoutPromise]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  try {
    return await fn(client);
  } finally {
    try {
      client.release();
    } catch (err) {
      logger.warn(`pg client release failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export async function closePgPools(): Promise<void> {
  const pools = [...pgPools.entries()];
  pgPools.clear();

  for (const [, pool] of pools) {
    try {
      await pool.end();
    } catch (err) {
      logger.warn(`pg pool close failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export function __setPgPoolFactoryForTesting(
  factory: ((connectionString: string) => PgPoolLike) | null
): void {
  pgPoolFactory =
    factory ??
    ((connectionString) =>
      new Pool({
        connectionString,
        allowExitOnIdle: true,
      }));
}
