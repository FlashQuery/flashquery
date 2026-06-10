import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../../../src/embedding/provider.js';

function mockFetchEmbedding(vector: number[]): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ embedding: vector }] }),
  } as unknown as Response);
}

describe('embedding dimensions from YAML-native width', () => {
  it('T-I-032 native-width configuration works without sending dimensions', async () => {
    globalThis.fetch = mockFetchEmbedding([0.1, 0.2, 0.3]);
    const provider = new OpenAICompatibleProvider(
      'https://api.openai.com',
      'native-three',
      'sk-test',
      3,
      'openai-main'
    );

    await expect(provider.embed('hello')).resolves.toEqual([0.1, 0.2, 0.3]);
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(options.body as string)).toEqual({ model: 'native-three', input: 'hello' });
  });

  it('T-I-033 misconfigured dimensions fail at length guard with remediation', async () => {
    globalThis.fetch = mockFetchEmbedding(Array.from({ length: 1536 }, () => 0.1));
    const provider = new OpenAICompatibleProvider(
      'https://api.openai.com',
      'text-embedding-3-small',
      'sk-test',
      512,
      'openai-main'
    );

    await expect(provider.embed('hello')).rejects.toThrow(
      /openai-main.*text-embedding-3-small.*expected.*512.*actual.*1536.*change dimensions.*1536.*deferred dimensions-reduction/i
    );
  });
});
