import { beforeEach, describe, expect, it, vi } from 'vitest';

const poolConnect = vi.fn();
const poolQuery = vi.fn();
const poolEnd = vi.fn();
const poolConstructor = vi.fn();

vi.mock('pg', () => ({
  default: {
    Client: vi.fn(),
    Pool: poolConstructor,
    escapeIdentifier: vi.fn((s: string) => `"${s}"`),
    types: {
      setTypeParser: vi.fn(),
    },
  },
}));

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

import { logger } from '../../src/logging/logger.js';
import {
  closePgPools,
  createPgClientIPv4,
  queryPgPool,
  withPgClient,
} from '../../src/utils/pg-client.js';

describe('pg pool helper', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await closePgPools();

    poolConstructor.mockImplementation((config: unknown) => ({
      config,
      connect: poolConnect,
      query: poolQuery,
      end: poolEnd,
    }));
    poolConnect.mockResolvedValue({ release: vi.fn() });
    poolQuery.mockResolvedValue({ rows: [] });
    poolEnd.mockResolvedValue(undefined);
  });

  it('preserves IPv4 connection-string behavior and pool query configuration', async () => {
    const connectionString = 'postgres://user:pass@localhost:5432/fq';

    createPgClientIPv4(connectionString);
    await queryPgPool(connectionString, 'SELECT $1::int AS value', [1]);

    expect(poolConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString,
        allowExitOnIdle: true,
      })
    );
    expect(poolQuery).toHaveBeenCalledWith('SELECT $1::int AS value', [1]);
  });

  it('releases borrowed clients in finally when work fails', async () => {
    const release = vi.fn();
    poolConnect.mockResolvedValue({ query: vi.fn(), release });

    await expect(
      withPgClient('postgres://user:pass@localhost:5432/fq', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(release).toHaveBeenCalledTimes(1);
  });

  it('logs release and close errors owned by the pool abstraction', async () => {
    const release = vi.fn(() => {
      throw new Error('release failed');
    });
    poolConnect.mockResolvedValue({ query: vi.fn(), release });
    poolEnd.mockRejectedValue(new Error('end failed'));

    await withPgClient('postgres://user:pass@localhost:5432/fq', async () => 'ok');
    await closePgPools();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('pg client release failed')
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('pg pool close failed'));
  });
});
