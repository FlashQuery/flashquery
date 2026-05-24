import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMock = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
}));

vi.mock('../../src/logging/logger.js', () => ({
  logger: loggerMock,
}));

import {
  __setPgPoolFactoryForTesting,
  closePgPools,
  createPgClientIPv4,
  queryPgPool,
  withPgClient,
} from '../../src/utils/pg-client.js';

describe('pg pool helper', () => {
  beforeEach(async () => {
    await closePgPools();
    __setPgPoolFactoryForTesting(null);
    vi.clearAllMocks();
  });

  it('preserves IPv4 connection-string behavior and pool query configuration', async () => {
    const connectionString = 'postgres://user:pass@localhost:5432/fq';
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const connect = vi.fn();
    const end = vi.fn().mockResolvedValue(undefined);
    const factory = vi.fn(() => ({ query, connect, end }));
    __setPgPoolFactoryForTesting(factory);

    const client = createPgClientIPv4(connectionString);
    await queryPgPool(connectionString, 'SELECT $1::int AS value', [1]);

    expect(client.connectionParameters.host).toBe('localhost');
    expect(factory).toHaveBeenCalledWith(connectionString);
    expect(query).toHaveBeenCalledWith('SELECT $1::int AS value', [1]);
  });

  it('releases borrowed clients in finally when work fails', async () => {
    const release = vi.fn();
    __setPgPoolFactoryForTesting(() => ({
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue({ query: vi.fn(), release }),
      end: vi.fn().mockResolvedValue(undefined),
    }));

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
    __setPgPoolFactoryForTesting(() => ({
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue({ query: vi.fn(), release }),
      end: vi.fn().mockRejectedValue(new Error('end failed')),
    }));

    await withPgClient('postgres://user:pass@localhost:5432/fq', async () => 'ok');
    await closePgPools();

    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('pg client release failed')
    );
    expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining('pg pool close failed'));
  });
});
