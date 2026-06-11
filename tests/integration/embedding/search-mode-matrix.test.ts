import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addSearchDocument,
  createEmbeddingSearchHarness,
  destroyEmbeddingSearchHarness,
  parseToolJson,
  type EmbeddingSearchHarness,
} from './search-test-helpers.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const ENTRY_PRIMARY = 's166_matrix_primary';

describe.skipIf(!HAS_SUPABASE).sequential('embedding search mode matrix', () => {
  let harness: EmbeddingSearchHarness;

  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1, 0, 0] }] }),
    } as Response);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (harness) {
      await destroyEmbeddingSearchHarness(harness, [ENTRY_PRIMARY]);
    }
  });

  it('T-I-045 returns unsupported for semantic search when zero catalog entries are active', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'phase-166-search-zero-semantic',
      entries: [{ name: ENTRY_PRIMARY, status: 'deactivated' }],
    });

    const result = await harness.server.search({
      query: 'alpha',
      mode: 'semantic',
      entity_types: ['documents'],
    }) as { isError?: boolean };
    const payload = parseToolJson<{ error: string; identifier: string; details: { reason: string } }>(result);

    expect(result.isError).toBeFalsy();
    expect(payload).toMatchObject({
      error: 'unsupported',
      identifier: 'search',
      details: { reason: 'zero_active_embeddings' },
    });
  }, 90_000);

  it('T-I-046 returns filesystem-only mixed results with embedding_unavailable when zero entries are active', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'phase-166-search-zero-mixed',
      entries: [{ name: ENTRY_PRIMARY, status: 'deactivated' }],
    });
    await addSearchDocument({ harness, path: 'alpha.md', title: 'Alpha Matrix' });

    const result = await harness.server.search({
      query: 'alpha',
      mode: 'mixed',
      entity_types: ['documents'],
    });
    const payload = parseToolJson<{
      embeddings_queried: string[];
      fusion: string;
      warnings: string[];
      results: Array<{ match_source: string[]; score?: number }>;
    }>(result);

    expect(payload.embeddings_queried).toEqual([]);
    expect(payload.fusion).toBe('none');
    expect(payload.warnings).toContain('embedding_unavailable');
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0]).toMatchObject({ match_source: ['filesystem'] });
    expect(payload.results[0]).not.toHaveProperty('score');
  }, 90_000);

  it('T-I-048 queries the only active entry with fusion none', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'phase-166-search-one-active',
      entries: [{ name: ENTRY_PRIMARY }],
    });
    await addSearchDocument({
      harness,
      path: 'semantic-alpha.md',
      title: 'Semantic Alpha',
      vectorByEntry: { [ENTRY_PRIMARY]: [1, 0, 0] },
    });

    const result = await harness.server.search({
      query: 'alpha',
      mode: 'semantic',
      entity_types: ['documents'],
      limit: 5,
    });
    const payload = parseToolJson<{
      embeddings_queried: string[];
      fusion: string;
      results: Array<{ path: string; score: number; match_source: string[] }>;
    }>(result);

    expect(payload.embeddings_queried).toEqual([ENTRY_PRIMARY]);
    expect(payload.fusion).toBe('none');
    expect(payload.results[0]).toMatchObject({
      path: 'semantic-alpha.md',
      match_source: ['semantic'],
    });
    expect(payload.results[0]!.score).toBeGreaterThan(0.99);
  }, 90_000);
});
