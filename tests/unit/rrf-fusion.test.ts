import { describe, expect, it } from 'vitest';
import {
  fuseRrfSearchResults,
  mergeRrfWithSupplementalResults,
  searchPrefetchSize,
} from '../../src/mcp/tools/compound.js';

describe('RRF fusion', () => {
  it('T-U-023 computes sum(1 / (60 + rank)) per result', () => {
    const [result] = fuseRrfSearchResults([
      {
        embeddingName: 'primary',
        hits: [{ entity_type: 'document', identifier: 'doc-a', path: 'doc-a.md', fq_id: 'doc-a', rank: 1, match_source: ['semantic'] }],
      },
      {
        embeddingName: 'analysis',
        hits: [{ entity_type: 'document', identifier: 'doc-a', path: 'doc-a.md', fq_id: 'doc-a', rank: 3, match_source: ['semantic'] }],
      },
    ], 10);

    expect(result!.fused_score).toBeCloseTo((1 / 61) + (1 / 63), 12);
    expect(result!.rank_sum).toBe(4);
    expect(result!.per_embedding_ranks).toEqual({ primary: 1, analysis: 3 });
  });

  it('T-U-024 gives absent retrievers zero contribution', () => {
    const results = fuseRrfSearchResults([
      {
        embeddingName: 'primary',
        hits: [{ entity_type: 'document', identifier: 'doc-a', path: 'doc-a.md', fq_id: 'doc-a', rank: 1, match_source: ['semantic'] }],
      },
      {
        embeddingName: 'analysis',
        hits: [{ entity_type: 'document', identifier: 'doc-b', path: 'doc-b.md', fq_id: 'doc-b', rank: 1, match_source: ['semantic'] }],
      },
    ], 10);

    expect(results).toHaveLength(2);
    expect(results.find((result) => result.identifier === 'doc-a')!.per_embedding_ranks).toEqual({ primary: 1 });
    expect(results.find((result) => result.identifier === 'doc-b')!.per_embedding_ranks).toEqual({ analysis: 1 });
  });

  it('T-U-025 caps prefetch at 100 with a minimum of 20', () => {
    expect(searchPrefetchSize(1)).toBe(20);
    expect(searchPrefetchSize(10)).toBe(20);
    expect(searchPrefetchSize(30)).toBe(60);
    expect(searchPrefetchSize(500)).toBe(100);
  });

  it('dedupes mixed-mode RRF semantic hits with filesystem hits while preserving fused metadata', () => {
    const [result] = mergeRrfWithSupplementalResults([
      {
        entity_type: 'document',
        identifier: 'Project Plan',
        path: 'Projects/Plan.md',
        fq_id: 'doc-1',
        score: 0.93,
        match_source: ['semantic'],
        fused_score: 1 / 61,
        rank_sum: 1,
        per_embedding_ranks: { primary: 1 },
      },
      {
        entity_type: 'document',
        identifier: 'Projects/Plan.md',
        path: 'Projects/Plan.md',
        fq_id: 'doc-1',
        match_source: ['filesystem'],
      },
    ], 10);

    expect(result).toMatchObject({
      fq_id: 'doc-1',
      fused_score: 1 / 61,
      rank_sum: 1,
      per_embedding_ranks: { primary: 1 },
      match_source: ['semantic', 'filesystem'],
    });
  });
});
