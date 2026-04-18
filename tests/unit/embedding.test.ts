import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createEmbeddingProvider,
  initEmbedding,
  NullEmbeddingProvider,
  type EmbeddingProvider,
} from '../../src/embedding/provider.js';
import * as providerModule from '../../src/embedding/provider.js';

// Mock the logger module
vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Fetch mock helpers
// ─────────────────────────────────────────────────────────────────────────────

function mockFetchSuccess(responseBody: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => responseBody,
  } as unknown as Response);
}

function mockFetchError(status: number): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({}),
  } as unknown as Response);
}

function mockFetchNetworkError(): ReturnType<typeof vi.fn> {
  return vi.fn().mockRejectedValue(new TypeError('fetch failed'));
}

// ─────────────────────────────────────────────────────────────────────────────
// createEmbeddingProvider
// ─────────────────────────────────────────────────────────────────────────────

describe('createEmbeddingProvider', () => {
  it('creates OpenAI provider with getDimensions() === 1536', () => {
    const provider = createEmbeddingProvider({
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
      dimensions: 1536,
    });
    expect(provider.getDimensions()).toBe(1536);
  });

  it('creates OpenRouter provider with getDimensions() === 1536', () => {
    const provider = createEmbeddingProvider({
      provider: 'openrouter',
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
      dimensions: 1536,
    });
    expect(provider.getDimensions()).toBe(1536);
  });

  it('creates Ollama provider with getDimensions() === 768', () => {
    const provider = createEmbeddingProvider({
      provider: 'ollama',
      model: 'nomic-embed-text',
      dimensions: 768,
    });
    expect(provider.getDimensions()).toBe(768);
  });

  it('throws for unsupported provider', () => {
    expect(() =>
      createEmbeddingProvider({
        provider: 'unknown' as 'openai',
        model: 'test',
        dimensions: 1536,
      })
    ).toThrow("Embedding error: Unsupported provider 'unknown'. Use 'openai', 'openrouter', or 'ollama'.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI embed()
// ─────────────────────────────────────────────────────────────────────────────

describe('OpenAI embed()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls fetch with correct URL, headers, and body', async () => {
    const mockEmbedding = [0.1, 0.2, 0.3];
    globalThis.fetch = mockFetchSuccess({ data: [{ embedding: mockEmbedding }] });

    const provider = createEmbeddingProvider({
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
      dimensions: 1536,
    });
    const result = await provider.embed('hello world');

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');
    expect(JSON.parse(options.body as string)).toEqual({
      model: 'text-embedding-3-small',
      input: 'hello world',
    });
    expect(result).toEqual(mockEmbedding);
  });

  it('uses endpoint override when provided', async () => {
    globalThis.fetch = mockFetchSuccess({ data: [{ embedding: [0.1] }] });

    const provider = createEmbeddingProvider({
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
      endpoint: 'https://custom.api.com',
      dimensions: 1536,
    });
    await provider.embed('hello');

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://custom.api.com/v1/embeddings');
  });

  it('throws on 401 with clear message', async () => {
    globalThis.fetch = mockFetchError(401);
    const provider = createEmbeddingProvider({
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'sk-bad',
      dimensions: 1536,
    });
    await expect(provider.embed('hello')).rejects.toThrow(
      'Embedding error: OpenAI API returned 401 Unauthorized. Check the API key in flashquery.yaml.'
    );
  });

  it('throws on 429 with rate limit message', async () => {
    globalThis.fetch = mockFetchError(429);
    const provider = createEmbeddingProvider({
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
      dimensions: 1536,
    });
    await expect(provider.embed('hello')).rejects.toThrow(
      'Embedding error: OpenAI rate limit exceeded. Wait and retry.'
    );
  });

  it('throws on network error with connection message', async () => {
    globalThis.fetch = mockFetchNetworkError();
    const provider = createEmbeddingProvider({
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
      dimensions: 1536,
    });
    await expect(provider.embed('hello')).rejects.toThrow(
      'Embedding error: Could not reach OpenAI API. Check your internet connection.'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OpenRouter embed()
// ─────────────────────────────────────────────────────────────────────────────

describe('OpenRouter embed()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls fetch with correct URL and OpenAI-compatible shape', async () => {
    const mockEmbedding = [0.4, 0.5, 0.6];
    globalThis.fetch = mockFetchSuccess({ data: [{ embedding: mockEmbedding }] });

    const provider = createEmbeddingProvider({
      provider: 'openrouter',
      model: 'text-embedding-3-small',
      apiKey: 'sk-or-test',
      dimensions: 1536,
    });
    const result = await provider.embed('hello world');

    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/embeddings');
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-or-test');
    expect(JSON.parse(options.body as string)).toEqual({
      model: 'text-embedding-3-small',
      input: 'hello world',
    });
    expect(result).toEqual(mockEmbedding);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ollama embed()
// ─────────────────────────────────────────────────────────────────────────────

describe('Ollama embed()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls fetch with /api/embeddings endpoint and {model, prompt} body', async () => {
    const mockEmbedding = [0.7, 0.8, 0.9];
    globalThis.fetch = mockFetchSuccess({ embedding: mockEmbedding });

    const provider = createEmbeddingProvider({
      provider: 'ollama',
      model: 'nomic-embed-text',
      dimensions: 768,
    });
    const result = await provider.embed('hello world');

    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/api/embeddings');
    expect(options.method).toBe('POST');
    // Ollama does NOT send Authorization header
    expect((options.headers as Record<string, string>)['Authorization']).toBeUndefined();
    expect(JSON.parse(options.body as string)).toEqual({
      model: 'nomic-embed-text',
      prompt: 'hello world',
    });
    // Flat response (not data[0].embedding)
    expect(result).toEqual(mockEmbedding);
  });

  it('uses endpoint override when provided', async () => {
    globalThis.fetch = mockFetchSuccess({ embedding: [0.1] });

    const provider = createEmbeddingProvider({
      provider: 'ollama',
      model: 'nomic-embed-text',
      endpoint: 'http://192.168.1.100:11434',
      dimensions: 768,
    });
    await provider.embed('hello');

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://192.168.1.100:11434/api/embeddings');
  });

  it('throws on network error', async () => {
    globalThis.fetch = mockFetchNetworkError();
    const provider = createEmbeddingProvider({
      provider: 'ollama',
      model: 'nomic-embed-text',
      dimensions: 768,
    });
    await expect(provider.embed('hello')).rejects.toThrow(
      'Embedding error: Could not reach Ollama API. Check your internet connection.'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// initEmbedding validation
// ─────────────────────────────────────────────────────────────────────────────

describe('initEmbedding validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets NullEmbeddingProvider and warns when OpenAI has no API key (D-05B)', async () => {
    const { logger } = await import('../../src/logging/logger.js');
    const config = {
      embedding: { provider: 'openai', model: 'text-embedding-3-small', dimensions: 1536 },
    } as Parameters<typeof initEmbedding>[0];
    initEmbedding(config);
    expect(providerModule.embeddingProvider).toBeInstanceOf(NullEmbeddingProvider);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('semantic search DISABLED'));
  });

  it('sets NullEmbeddingProvider and warns when OpenRouter has no API key (D-05B)', async () => {
    const { logger } = await import('../../src/logging/logger.js');
    const config = {
      embedding: { provider: 'openrouter', model: 'text-embedding-3-small', dimensions: 1536 },
    } as Parameters<typeof initEmbedding>[0];
    initEmbedding(config);
    expect(providerModule.embeddingProvider).toBeInstanceOf(NullEmbeddingProvider);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('semantic search DISABLED'));
  });

  it('sets NullEmbeddingProvider silently when provider is "none" (D-05A)', async () => {
    const { logger } = await import('../../src/logging/logger.js');
    const config = {
      embedding: { provider: 'none', model: '', dimensions: 1536 },
    } as Parameters<typeof initEmbedding>[0];
    initEmbedding(config);
    expect(providerModule.embeddingProvider).toBeInstanceOf(NullEmbeddingProvider);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does NOT throw when Ollama has no API key', () => {
    const config = {
      embedding: { provider: 'ollama', model: 'nomic-embed-text', dimensions: 768 },
    } as Parameters<typeof initEmbedding>[0];
    expect(() => initEmbedding(config)).not.toThrow();
  });

  it('sets real provider (not NullEmbeddingProvider) when OpenAI has valid API key', () => {
    const config = {
      embedding: { provider: 'openai', model: 'text-embedding-3-small', apiKey: 'sk-test', dimensions: 1536 },
    } as Parameters<typeof initEmbedding>[0];
    initEmbedding(config);
    expect(providerModule.embeddingProvider).not.toBeInstanceOf(NullEmbeddingProvider);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NullEmbeddingProvider
// ─────────────────────────────────────────────────────────────────────────────

describe('NullEmbeddingProvider', () => {
  it('is exported from provider.ts', () => {
    expect(NullEmbeddingProvider).toBeDefined();
  });

  it('getDimensions() returns constructor argument', () => {
    const provider = new NullEmbeddingProvider(1536);
    expect(provider.getDimensions()).toBe(1536);
  });

  it('embed() rejects with message containing "Semantic search unavailable"', async () => {
    const provider = new NullEmbeddingProvider(1536);
    await expect(provider.embed('hello')).rejects.toThrow('Semantic search unavailable');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// error handling
// ─────────────────────────────────────────────────────────────────────────────

describe('error handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('OpenAI throws generic status error for non-401/429 HTTP errors', async () => {
    globalThis.fetch = mockFetchError(500);
    const provider = createEmbeddingProvider({
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
      dimensions: 1536,
    });
    await expect(provider.embed('hello')).rejects.toThrow(
      'Embedding error: OpenAI API returned 500.'
    );
  });

  it('Ollama throws generic status error for non-ok responses', async () => {
    globalThis.fetch = mockFetchError(503);
    const provider = createEmbeddingProvider({
      provider: 'ollama',
      model: 'nomic-embed-text',
      dimensions: 768,
    });
    await expect(provider.embed('hello')).rejects.toThrow(
      'Embedding error: Ollama API returned 503.'
    );
  });
});
