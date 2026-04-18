import pg from 'pg';

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
export function createPgClientIPv4(connectionString: string): pg.Client {
  return new pg.Client({ connectionString });
}
