import { describe, expect, it, vi } from 'vitest';
import {
  OpenAICompatibleProvider,
  truncateEmbeddingInput,
  type EmbeddingProvider,
} from '../../src/embedding/provider.js';
import { documentEmbeddingTarget, scheduleBackgroundEmbedding } from '../../src/embedding/background-embed.js';

function makeSupabaseMock() {
  const updates: Record<string, unknown>[] = [];
  const chain = {
    eq: vi.fn(() => chain),
    then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
  };
  const from = vi.fn((table: string) => ({
    update: vi.fn((payload: Record<string, unknown>) => {
      updates.push({ table, ...payload });
      return chain;
    }),
    delete: vi.fn(() => chain),
    select: vi.fn(() => chain),
    upsert: vi.fn(async () => ({ error: null })),
  }));
  return { client: { from }, updates };
}

describe('embedding input truncation', () => {
  it('T-U-016 truncates oversized input at the nearest preceding paragraph boundary', () => {
    const input = `first paragraph\n\nsecond paragraph should not be sent ${'x'.repeat(40)}`;
    const result = truncateEmbeddingInput(input, 32);

    expect(result.text).toBe('first paragraph');
    expect(result.truncated).toBe(true);
  });

  it('T-U-017 falls back to a sentence boundary when no paragraph boundary is in range', () => {
    const input = `First sentence. Second sentence is too long ${'x'.repeat(40)}`;
    const result = truncateEmbeddingInput(input, 35);

    expect(result.text).toBe('First sentence.');
    expect(result.truncated).toBe(true);
  });

  it('T-U-018 stamps truncated true for successful truncated rows and false otherwise', async () => {
    const truncatedProvider: EmbeddingProvider = {
      embed: vi.fn(async () => [0.1, 0.2, 0.3]),
      getDimensions: () => 3,
      getProviderInfo: () => ({ provider: 'test-provider', model: 'test-model' }),
      getLastEmbeddingMetadata: () => ({ truncated: true, warnings: ['truncated_inputs'] }),
    };
    const normalProvider: EmbeddingProvider = {
      embed: vi.fn(async () => [0.4, 0.5, 0.6]),
      getDimensions: () => 3,
      getProviderInfo: () => ({ provider: 'test-provider', model: 'test-model' }),
      getLastEmbeddingMetadata: () => ({ truncated: false, warnings: [] }),
    };
    const supabase = makeSupabaseMock();

    await scheduleBackgroundEmbedding({
      target: documentEmbeddingTarget({ instanceId: 'inst', id: 'doc-1' }),
      embedText: 'long',
      provider: truncatedProvider,
      supabase: supabase.client,
      embeddingName: 'primary',
    });
    await scheduleBackgroundEmbedding({
      target: documentEmbeddingTarget({ instanceId: 'inst', id: 'doc-2' }),
      embedText: 'short',
      provider: normalProvider,
      supabase: supabase.client,
      embeddingName: 'primary',
    });

    expect(supabase.updates[0]).toMatchObject({ embedding_primary_truncated: true });
    expect(supabase.updates[1]).toMatchObject({ embedding_primary_truncated: false });
  });

  it('retries provider over-limit once at 75 percent of max_input_chars', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'input length exceeds context length',
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      } as unknown as Response);
    globalThis.fetch = fetchMock;
    const provider = new OpenAICompatibleProvider(
      'https://example.test',
      'model',
      'sk-test',
      3,
      'test-provider',
      40
    );

    await expect(provider.embed('Sentence one. Sentence two. Sentence three. Sentence four.')).resolves.toEqual([0.1, 0.2, 0.3]);
    const firstBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as { input: string };
    const secondBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string) as { input: string };
    expect(firstBody.input.length).toBeLessThanOrEqual(40);
    expect(secondBody.input.length).toBeLessThanOrEqual(30);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
