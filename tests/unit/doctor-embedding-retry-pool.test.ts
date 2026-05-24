import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/loader.js';

const pgClientMock = vi.hoisted(() => ({
  queryPgPool: vi.fn(),
  createPgClientIPv4: vi.fn(() => {
    throw new Error('direct pg client should not be used by doctor retry diagnostics');
  }),
}));

vi.mock('../../src/utils/pg-client.js', () => pgClientMock);

const { checkEmbeddingRetryGaps } = await import('../../src/cli/doctor.js');

function makeConfig(databaseUrl = 'postgres://user:pass@localhost:5432/fq'): FlashQueryConfig {
  return {
    instance: {
      name: 'doctor-pool-test',
      id: 'doctor-pool-test',
      vault: { path: '/tmp/doctor-pool-test', markdownExtensions: ['.md'] },
    },
    supabase: {
      url: 'http://localhost:54321',
      serviceRoleKey: 'test-key',
      databaseUrl,
      skipDdl: true,
    },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    locking: { enabled: false, ttlSeconds: 30 },
  } as unknown as FlashQueryConfig;
}

describe('doctor embedding retry diagnostics pg usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the shared pg pool for document, memory, and record gap queries', async () => {
    pgClientMock.queryPgPool
      .mockResolvedValueOnce({ rows: [{ id: 'doc-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ table_name: 'fqcp_doctor_records' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'rec-1' }], rowCount: 1 });

    const result = await checkEmbeddingRetryGaps(makeConfig());

    expect(result.passed).toBe(false);
    expect(result.issue).toContain('documents=1 [doc-1]');
    expect(result.issue).toContain('records=1 [fqcp_doctor_records:rec-1]');
    expect(pgClientMock.createPgClientIPv4).not.toHaveBeenCalled();
    expect(pgClientMock.queryPgPool).toHaveBeenCalledTimes(4);
    expect(pgClientMock.queryPgPool).toHaveBeenNthCalledWith(
      1,
      'postgres://user:pass@localhost:5432/fq',
      expect.stringContaining('FROM fqc_documents d'),
      ['doctor-pool-test']
    );
    expect(pgClientMock.queryPgPool).toHaveBeenNthCalledWith(
      2,
      'postgres://user:pass@localhost:5432/fq',
      expect.stringContaining('FROM fqc_memory m'),
      ['doctor-pool-test']
    );
    expect(pgClientMock.queryPgPool).toHaveBeenNthCalledWith(
      3,
      'postgres://user:pass@localhost:5432/fq',
      expect.stringContaining('information_schema.columns')
    );
    expect(pgClientMock.queryPgPool).toHaveBeenNthCalledWith(
      4,
      'postgres://user:pass@localhost:5432/fq',
      expect.stringContaining('FROM "fqcp_doctor_records" t'),
      ['doctor-pool-test', 'fqcp_doctor_records']
    );
  });

  it('skips the diagnostic when DATABASE_URL is absent', async () => {
    const result = await checkEmbeddingRetryGaps(makeConfig(''));

    expect(result).toEqual({ name: 'Embedding retry coverage', passed: true });
    expect(pgClientMock.queryPgPool).not.toHaveBeenCalled();
  });
});
