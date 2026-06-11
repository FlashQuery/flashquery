import { describe, expect, it, vi } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/types.js';

const createPgClientIPv4 = vi.fn();
const verifySchema = vi.fn();
const repairEmbeddingDimensionDrift = vi.fn();

vi.mock('../../src/utils/pg-client.js', () => ({
  createPgClientIPv4,
}));

vi.mock('../../src/storage/schema-verify.js', () => ({
  verifySchema,
}));

vi.mock('../../src/storage/test-dev-repair.js', () => ({
  repairEmbeddingDimensionDrift,
}));

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function makeConfig(databaseUrl: string): FlashQueryConfig {
  return {
    instance: {
      id: 'startup-validation-test',
      name: 'Startup Validation Test',
      vault: {
        path: '/tmp/fqc-startup-validation-test',
        markdownExtensions: ['.md'],
      },
    },
    supabase: {
      url: 'http://127.0.0.1:54321',
      serviceRoleKey: 'test-service-role-key',
      databaseUrl,
    },
    embedding: {
      provider: 'none',
      model: '',
      apiKey: '',
      dimensions: 3,
    },
    llm: {
      providers: [
        {
          name: 'openai-main',
          provider: 'openai',
          apiKey: 'sk-test',
          models: [{ name: 'text-embedding-3-small', model: 'text-embedding-3-small' }],
        },
      ],
    },
    embeddings: [
      {
        name: 'primary',
        dimensions: 3,
        endpoints: [{ providerName: 'openai-main', model: 'text-embedding-3-small' }],
      },
    ],
  } as FlashQueryConfig;
}

describe('verifyStartupEmbeddingCatalog', () => {
  it('skips direct pg validation when embeddings are configured but databaseUrl is empty', async () => {
    const { verifyStartupEmbeddingCatalog } = await import('../../src/embedding/startup-validation.js');

    await expect(verifyStartupEmbeddingCatalog(makeConfig(''))).resolves.toBeUndefined();

    expect(createPgClientIPv4).not.toHaveBeenCalled();
    expect(verifySchema).not.toHaveBeenCalled();
    expect(repairEmbeddingDimensionDrift).not.toHaveBeenCalled();
  });

  it('uses direct pg validation when databaseUrl is available', async () => {
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      end: vi.fn().mockResolvedValue(undefined),
    };
    createPgClientIPv4.mockReturnValue(client);
    verifySchema.mockResolvedValue(undefined);

    const { verifyStartupEmbeddingCatalog } = await import('../../src/embedding/startup-validation.js');

    await expect(
      verifyStartupEmbeddingCatalog(makeConfig('postgres://postgres:postgres@127.0.0.1:54322/postgres'))
    ).resolves.toBeUndefined();

    expect(createPgClientIPv4).toHaveBeenCalledWith(
      'postgres://postgres:postgres@127.0.0.1:54322/postgres'
    );
    expect(client.connect).toHaveBeenCalledOnce();
    expect(verifySchema).toHaveBeenCalledWith(client, { instanceId: 'startup-validation-test' });
    expect(client.end).toHaveBeenCalledOnce();
  });
});
