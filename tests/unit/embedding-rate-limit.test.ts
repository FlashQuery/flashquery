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
        {
          name: 'backup',
          type: 'openai-compatible',
          endpoint: 'https://backup.openai.test',
          apiKey: 'sk-backup',
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

  it('T-U-020 retries HTTP 429 with exponential backoff on the same endpoint before failover', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'too many requests',
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      } as unknown as Response);
    globalThis.fetch = fetchMock;
    const provider = createEmbeddingProviderForCatalogEntry(makeConfig(), {
      name: 'primary',
      dimensions: 3,
      endpoints: [
        {
          providerName: 'openai',
          model: 'text-embedding-3-small',
          rateLimit: { maxBackoffRetries: 2, backoffBaseMs: 50 },
        },
        {
          providerName: 'backup',
          model: 'text-embedding-3-small',
        },
      ],
    });

    const result = provider.embed('hello');
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(49);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.openai.test/v1/embeddings',
      'https://api.openai.test/v1/embeddings',
    ]);
  });

  it('T-U-020 doubles 429 backoff delays before a same-endpoint success', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'too many requests' } as unknown as Response)
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'too many requests' } as unknown as Response)
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'too many requests' } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      } as unknown as Response);
    globalThis.fetch = fetchMock;
    const provider = createEmbeddingProviderForCatalogEntry(makeConfig(), {
      name: 'primary',
      dimensions: 3,
      endpoints: [
        {
          providerName: 'openai',
          model: 'text-embedding-3-small',
          rateLimit: { maxBackoffRetries: 3, backoffBaseMs: 50 },
        },
      ],
    });

    const result = provider.embed('hello');
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(200);

    await expect(result).resolves.toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('T-U-020 exhausts max_backoff_retries, fails over, and preserves rate-limit warning metadata', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'too many requests' } as unknown as Response)
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'too many requests' } as unknown as Response)
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'too many requests' } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      } as unknown as Response);
    globalThis.fetch = fetchMock;
    const provider = createEmbeddingProviderForCatalogEntry(makeConfig(), {
      name: 'primary',
      dimensions: 3,
      endpoints: [
        {
          providerName: 'openai',
          model: 'text-embedding-3-small',
          rateLimit: { maxBackoffRetries: 2, backoffBaseMs: 50 },
        },
        {
          providerName: 'backup',
          model: 'text-embedding-3-small',
        },
      ],
    });

    const result = provider.embed('hello');
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(100);

    await expect(result).resolves.toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.openai.test/v1/embeddings',
      'https://api.openai.test/v1/embeddings',
      'https://api.openai.test/v1/embeddings',
      'https://backup.openai.test/v1/embeddings',
    ]);
    expect(provider.getLastEmbeddingMetadata?.().warnings).toContain('rate_limit_events');
  });

  it('T-U-021 fails over immediately on non-429 endpoint errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'server unavailable',
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      } as unknown as Response);
    globalThis.fetch = fetchMock;
    const provider = createEmbeddingProviderForCatalogEntry(makeConfig(), {
      name: 'primary',
      dimensions: 3,
      endpoints: [
        {
          providerName: 'openai',
          model: 'text-embedding-3-small',
          rateLimit: { maxBackoffRetries: 2, backoffBaseMs: 50 },
        },
        {
          providerName: 'backup',
          model: 'text-embedding-3-small',
        },
      ],
    });

    await expect(provider.embed('hello')).resolves.toEqual([0.1, 0.2, 0.3]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.openai.test/v1/embeddings',
      'https://backup.openai.test/v1/embeddings',
    ]);
  });
});
