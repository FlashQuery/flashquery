import { afterEach, describe, expect, it } from 'vitest';
import {
  addSearchDocument,
  createEmbeddingSearchHarness,
  destroyEmbeddingSearchHarness,
  parseToolJson,
  type EmbeddingSearchHarness,
} from './search-test-helpers.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const ENTRY_NAME = 's166_zero_mixed';

describe.skipIf(!HAS_SUPABASE).sequential('zero-active mixed search', () => {
  let harness: EmbeddingSearchHarness;

  afterEach(async () => {
    if (harness) await destroyEmbeddingSearchHarness(harness, [ENTRY_NAME]);
  });

  it('T-I-057 returns filesystem-only results and no scores when embeddings are unavailable', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'phase-166-zero-active-mixed-file',
      entries: [{ name: ENTRY_NAME, status: 'deactivated' }],
    });
    await addSearchDocument({ harness, path: 'mixed-only.md', title: 'Mixed Only' });

    const result = await harness.server.search({
      query: 'mixed',
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
    expect(payload.results).toEqual([
      expect.objectContaining({ match_source: ['filesystem'] }),
    ]);
    expect(payload.results[0]).not.toHaveProperty('score');
  }, 90_000);
});
