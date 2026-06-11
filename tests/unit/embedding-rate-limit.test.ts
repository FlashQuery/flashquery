import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/types.js';
import { createEmbeddingProviderForCatalogEntry } from '../../src/embedding/provider.js';

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'test',
      id: 'test-instance',
      vault: { path: '/tmp/fq-test', markdownExtensions: ['.md'] },
    },
    server: { host: '127.0.0.1', port: 3100 },
    supabase: {
      url: 'http://127.0.0.1:54321',
      serviceRoleKey: 'test-service-role',
      databaseUrl: '',
      skipDdl: true,
    },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: false, lockTimeoutSeconds: 10 },
    trashFolder: { enabled: false, path: '.trash', collisionStrategy: 'suffix' },
    mcpServers: {},
    host: { mcpServers: [], toolSearch: 'disabled' },
    macro: { defaultTimeoutMs: 30_000 },
    logging: { level: 'error', output: 'stdout' },
    llm: {
      providers: [
        {
          name: 'openai',
          type: 'openai-compatible',
          endpoint: 'https://api.openai.test',
          apiKey: 'sk-test',
        },
      ],
      models: [],
      purposes: [],
    },
  };
}

function mockEmbeddingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
  } as unknown as Response);
}

describe('embedding endpoint rate limiting', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('T-U-019 enforces min_delay_ms between calls on a configured endpoint', async () => {
    vi.useFakeTimers();
    const fetchMock = mockEmbeddingFetch();
    globalThis.fetch = fetchMock;
    const provider = createEmbeddingProviderForCatalogEntry(makeConfig(), {
      name: 'primary',
      dimensions: 3,
      endpoints: [
        {
          providerName: 'openai',
          model: 'text-embedding-3-small',
          rateLimit: { minDelayMs: 100 },
        },
      ],
    });

    await provider.embed('first');
    const second = provider.embed('second');
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('T-U-022 does not throttle endpoints without a rate_limit block', async () => {
    vi.useFakeTimers();
    const fetchMock = mockEmbeddingFetch();
    globalThis.fetch = fetchMock;
    const provider = createEmbeddingProviderForCatalogEntry(makeConfig(), {
      name: 'primary',
      dimensions: 3,
      endpoints: [
        {
          providerName: 'openai',
          model: 'text-embedding-3-small',
        },
      ],
    });

    await provider.embed('first');
    await provider.embed('second');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
