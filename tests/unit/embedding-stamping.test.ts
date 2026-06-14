import { describe, expect, it, vi } from 'vitest';
import {
  documentChunkEmbeddingTarget,
  documentEmbeddingTarget,
  scheduleBackgroundEmbedding,
  updateTargetEmbedding,
} from '../../src/embedding/background-embed.js';
import type { EmbeddingProvider } from '../../src/embedding/provider.js';

function makeProvider(vector: number[]): EmbeddingProvider {
  return {
    embed: vi.fn().mockResolvedValue(vector),
    getDimensions: () => vector.length,
    getProviderInfo: () => ({ provider: 'openai-main', model: 'text-embedding-3-small' }),
  };
}

function makeSupabaseMock() {
  const updates: Record<string, unknown>[] = [];
  const eqCalls: Array<[string, unknown]> = [];

  const chain = {
    eq: vi.fn((column: string, value: unknown) => {
      eqCalls.push([column, value]);
      return chain;
    }),
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

  return { client: { from }, updates, eqCalls };
}

describe('embedding write stamping', () => {
  it('T-U-006 writes endpoint model and provider stamping, not the entry alias', async () => {
    const supabase = makeSupabaseMock();

    await scheduleBackgroundEmbedding({
      target: documentEmbeddingTarget({ instanceId: 'inst', id: 'doc-1' }),
      embedText: 'hello',
      provider: makeProvider([0.1, 0.2, 0.3]),
      supabase: supabase.client,
      embeddingName: 'primary',
    });

    expect(supabase.updates).toContainEqual(
      expect.objectContaining({
        table: 'fqc_documents',
        embedding_primary: JSON.stringify([0.1, 0.2, 0.3]),
        embedding_primary_model: 'text-embedding-3-small',
        embedding_primary_dimensions: 3,
        embedding_primary_provider: 'openai-main',
        embedding_primary_truncated: false,
      })
    );
    expect(supabase.updates).not.toContainEqual(
      expect.objectContaining({ embedding_primary_model: 'primary' })
    );
  });

  it('T-U-007 writes vector and all four stamping columns in the same update payload', async () => {
    const supabase = makeSupabaseMock();

    await updateTargetEmbedding(
      documentEmbeddingTarget({ instanceId: 'inst', id: 'doc-2' }),
      [0.4, 0.5],
      supabase.client,
      undefined,
      {
        embeddingName: 'analysis',
        model: 'nomic-embed-text',
        provider: 'ollama-local',
        truncated: true,
      }
    );

    expect(supabase.updates).toHaveLength(1);
    expect(supabase.updates[0]).toMatchObject({
      table: 'fqc_documents',
      embedding_analysis: JSON.stringify([0.4, 0.5]),
      embedding_analysis_model: 'nomic-embed-text',
      embedding_analysis_dimensions: 2,
      embedding_analysis_provider: 'ollama-local',
      embedding_analysis_truncated: true,
    });
  });

  it('T-U-029 chunk stamped write populates only the active entry indexed_at column', async () => {
    const supabase = makeSupabaseMock();

    await updateTargetEmbedding(
      documentChunkEmbeddingTarget({
        instanceId: 'inst',
        id: '33333333-3333-4333-8333-333333333333',
        documentPath: 'Guide.md',
        headingPath: 'Guide > Setup',
      }),
      [0.7, 0.8],
      supabase.client,
      undefined,
      {
        embeddingName: 'primary',
        model: 'text-embedding-3-small',
        provider: 'openai-main',
        truncated: false,
      }
    );

    expect(supabase.updates).toHaveLength(1);
    expect(supabase.updates[0]).toMatchObject({
      table: 'fqc_chunks',
      embedding_primary: JSON.stringify([0.7, 0.8]),
      embedding_primary_model: 'text-embedding-3-small',
      embedding_primary_dimensions: 2,
      embedding_primary_provider: 'openai-main',
      embedding_primary_truncated: false,
    });
    expect(supabase.updates[0]).toHaveProperty('embedding_primary_indexed_at');
    expect(supabase.updates[0]).not.toHaveProperty('updated_at');
    expect(supabase.updates[0]).not.toHaveProperty('embedding_analysis_indexed_at');
  });
});
