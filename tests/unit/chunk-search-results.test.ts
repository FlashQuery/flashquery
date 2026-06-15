import { describe, expect, it } from 'vitest';
import {
  fuseRrfSearchResults,
  mergeRrfWithSupplementalResults,
} from '../../src/mcp/tools/compound.js';
import {
  mergeSearchResults,
  validateSearchInput,
  type SearchResultItem,
} from '../../src/mcp/utils/search-results.js';

function chunk(id: string, score: number, embeddingName: string, rank: number) {
  return {
    chunk_id: id,
    heading_path: id === 'chunk-a' ? 'Guide > Alpha' : 'Guide > Beta',
    breadcrumb: id === 'chunk-a' ? 'Guide > Alpha' : 'Guide > Beta',
    content: `${id} content`,
    span_start: null,
    span_end: null,
    score,
    per_embedding_ranks: { [embeddingName]: rank },
    indexed_at: { primary: embeddingName === 'primary' ? '2026-06-14T00:00:00.000Z' : null, analysis: null },
  };
}

describe('chunk search result aggregation', () => {
  it('T-U-034 aggregates chunk hits to one document result keyed by parent document', () => {
    const [result] = mergeSearchResults([
      {
        entity_type: 'document',
        identifier: 'docs/guide.md',
        path: 'docs/guide.md',
        fq_id: 'doc-1',
        score: 0.8,
        match_source: ['semantic'],
        matched_chunks: [chunk('chunk-a', 0.8, 'primary', 1)],
      },
      {
        entity_type: 'document',
        identifier: 'docs/guide.md',
        path: 'docs/guide.md',
        fq_id: 'doc-1',
        score: 0.9,
        match_source: ['semantic'],
        matched_chunks: [chunk('chunk-b', 0.9, 'primary', 2)],
      },
    ], 10);

    expect(result).toMatchObject({
      fq_id: 'doc-1',
      score: 0.9,
      matched_chunks: [
        expect.objectContaining({ chunk_id: 'chunk-b' }),
        expect.objectContaining({ chunk_id: 'chunk-a' }),
      ],
    });
  });

  it('T-U-035 fuses multi-entry chunk rankings and retains per-entry rank metadata', () => {
    const [result] = fuseRrfSearchResults([
      {
        embeddingName: 'primary',
        hits: [{
          entity_type: 'document',
          identifier: 'docs/guide.md',
          path: 'docs/guide.md',
          fq_id: 'doc-1',
          score: 0.8,
          rank: 1,
          match_source: ['semantic'],
          matched_chunks: [chunk('chunk-a', 0.8, 'primary', 1)],
        }],
      },
      {
        embeddingName: 'analysis',
        hits: [{
          entity_type: 'document',
          identifier: 'docs/guide.md',
          path: 'docs/guide.md',
          fq_id: 'doc-1',
          score: 0.7,
          rank: 3,
          match_source: ['semantic'],
          matched_chunks: [chunk('chunk-a', 0.7, 'analysis', 3)],
        }],
      },
    ], 10);

    expect(result.per_embedding_ranks).toEqual({ primary: 1, analysis: 3 });
    expect(result.matched_chunks?.[0]).toMatchObject({
      chunk_id: 'chunk-a',
      score: 0.8,
      per_embedding_ranks: { primary: 1, analysis: 3 },
    });
  });

  it('T-U-036 merges mixed filesystem result with chunk semantic result by document id', () => {
    const [result] = mergeRrfWithSupplementalResults([
      {
        entity_type: 'document',
        identifier: 'docs/guide.md',
        path: 'docs/guide.md',
        fq_id: 'doc-1',
        score: 0.8,
        match_source: ['semantic'],
        matched_chunks: [chunk('chunk-a', 0.8, 'primary', 1)],
      } as SearchResultItem,
      {
        entity_type: 'document',
        identifier: 'Guide',
        path: 'docs/guide.md',
        fq_id: 'doc-1',
        match_source: ['filesystem'],
      },
    ], 10);

    expect(result).toMatchObject({
      fq_id: 'doc-1',
      match_source: ['semantic', 'filesystem'],
      matched_chunks: [expect.objectContaining({ chunk_id: 'chunk-a' })],
    });
  });

  it('T-U-037 caps matched_chunks independently of global result limit', () => {
    const [result] = mergeSearchResults([
      {
        entity_type: 'document',
        identifier: 'docs/guide.md',
        path: 'docs/guide.md',
        fq_id: 'doc-1',
        score: 0.9,
        matched_chunks: [
          chunk('chunk-a', 0.9, 'primary', 1),
          chunk('chunk-b', 0.8, 'primary', 2),
        ],
      },
    ], 1);

    expect(result?.matched_chunks).toHaveLength(2);
  });

  it('T-U-038 rejects invalid limit_chunks_per_result', () => {
    expect(validateSearchInput({
      query: 'guide',
      mode: 'semantic',
      limit_chunks_per_result: 0,
    })).toEqual(expect.objectContaining({
      error: 'invalid_input',
      identifier: 'limit_chunks_per_result',
    }));
  });

  it('T-U-039 includes indexed_at map entries for active embeddings', () => {
    const indexed = chunk('chunk-a', 0.9, 'primary', 1).indexed_at;
    expect(indexed).toEqual({
      primary: '2026-06-14T00:00:00.000Z',
      analysis: null,
    });
  });
});
