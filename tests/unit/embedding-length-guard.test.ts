import { describe, expect, it, vi } from 'vitest';
import {
  FallbackEmbeddingProvider,
  OllamaProvider,
  OpenAICompatibleProvider,
  type EmbeddingProvider,
} from '../../src/embedding/provider.js';

function mockFetchSuccess(responseBody: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => responseBody,
  } as unknown as Response);
}

describe('embedding provider length guard', () => {
  it('T-U-008 OpenAICompatibleProvider.embed() throws with provider, model, expected width, and actual width', async () => {
    globalThis.fetch = mockFetchSuccess({ data: [{ embedding: [0.1, 0.2] }] });
    const provider = new OpenAICompatibleProvider(
      'https://api.openai.com',
      'text-embedding-3-small',
      'sk-test',
      3,
      'OpenAI'
    );

    await expect(provider.embed('hello')).rejects.toThrow(
      /OpenAI.*text-embedding-3-small.*expected.*3.*actual.*2/i
    );
  });

  it('T-U-009 OllamaProvider.embed() applies the same guard', async () => {
    globalThis.fetch = mockFetchSuccess({ embedding: [0.1, 0.2, 0.3, 0.4] });
    const provider = new OllamaProvider('http://localhost:11434', 'nomic-embed-text', 3);

    await expect(provider.embed('hello')).rejects.toThrow(
      /Ollama.*nomic-embed-text.*expected.*3.*actual.*4/i
    );
  });

  it('T-U-010 length guard fires for a single endpoint provider before callers can write', async () => {
    globalThis.fetch = mockFetchSuccess({ data: [{ embedding: [0.1] }] });
    const provider: EmbeddingProvider = new OpenAICompatibleProvider(
      'https://single.example',
      'native-3',
      'sk-test',
      3,
      'single-provider'
    );

    await expect(provider.embed('hello')).rejects.toThrow(/single-provider.*native-3.*expected.*3.*actual.*1/i);
  });

  it('T-U-011 fallback wrapper records the leaf length failure and tries the next endpoint', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: [0.1] }] }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      } as unknown as Response);
    const first = new OpenAICompatibleProvider('https://first.example', 'bad-width', 'sk-test', 3, 'first');
    const second = new OpenAICompatibleProvider('https://second.example', 'good-width', 'sk-test', 3, 'second');
    const provider = new FallbackEmbeddingProvider(
      [
        { name: 'first', provider: first },
        { name: 'second', provider: second },
      ],
      3
    );

    await expect(provider.embed('hello')).resolves.toEqual([0.1, 0.2, 0.3]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
