import { describe, expect, it } from 'vitest';
import { fuseRrfSearchResults } from '../../src/mcp/tools/compound.js';

describe('RRF deterministic tie breaks', () => {
  it('T-U-026 sorts by fused_score descending first', () => {
    const results = fuseRrfSearchResults([
      {
        embeddingName: 'primary',
        hits: [
          { entity_type: 'document', identifier: 'doc-low', path: 'b.md', fq_id: 'doc-low', rank: 5, match_source: ['semantic'] },
          { entity_type: 'document', identifier: 'doc-high', path: 'a.md', fq_id: 'doc-high', rank: 1, match_source: ['semantic'] },
        ],
      },
    ], 10);

    expect(results.map((result) => result.identifier)).toEqual(['doc-high', 'doc-low']);
  });

  it('T-U-027 uses rank_sum ascending when fused scores tie', () => {
    const results = fuseRrfSearchResults([
      {
        embeddingName: 'primary',
        hits: [
          { entity_type: 'document', identifier: 'doc-better', path: 'b.md', fq_id: 'doc-better', rank: 1, match_source: ['semantic'] },
          { entity_type: 'document', identifier: 'doc-worse', path: 'a.md', fq_id: 'doc-worse', rank: 2, match_source: ['semantic'] },
        ],
      },
      {
        embeddingName: 'analysis',
        hits: [
          { entity_type: 'document', identifier: 'doc-worse', path: 'a.md', fq_id: 'doc-worse', rank: 1, match_source: ['semantic'] },
          { entity_type: 'document', identifier: 'doc-better', path: 'b.md', fq_id: 'doc-better', rank: 2, match_source: ['semantic'] },
        ],
      },
      {
        embeddingName: 'third',
        hits: [
          { entity_type: 'document', identifier: 'doc-better', path: 'b.md', fq_id: 'doc-better', rank: 1, match_source: ['semantic'] },
          { entity_type: 'document', identifier: 'doc-worse', path: 'a.md', fq_id: 'doc-worse', rank: 2, match_source: ['semantic'] },
        ],
      },
    ], 10);

    expect(results.map((result) => result.identifier)).toEqual(['doc-better', 'doc-worse']);
  });

  it('T-U-028 uses identifier ascending when fused score and rank_sum tie', () => {
    const results = fuseRrfSearchResults([
      {
        embeddingName: 'primary',
        hits: [
          { entity_type: 'document', identifier: 'doc-b', path: 'b.md', fq_id: 'doc-b', rank: 1, match_source: ['semantic'] },
          { entity_type: 'document', identifier: 'doc-a', path: 'a.md', fq_id: 'doc-a', rank: 1, match_source: ['semantic'] },
        ],
      },
    ], 10);

    expect(results.map((result) => result.identifier)).toEqual(['doc-a', 'doc-b']);
  });

  it('T-U-029 limits fused results after deterministic sorting', () => {
    const retrieverResults = [
      {
        embeddingName: 'primary',
        hits: [
          { entity_type: 'document', identifier: 'doc-b', path: 'b.md', fq_id: 'doc-b', rank: 1, match_source: ['semantic'] },
          { entity_type: 'document', identifier: 'doc-a', path: 'a.md', fq_id: 'doc-a', rank: 1, match_source: ['semantic'] },
        ],
      },
    ];
    const first = fuseRrfSearchResults(retrieverResults, 1);
    const second = fuseRrfSearchResults(retrieverResults, 1);

    expect(first.map((result) => result.identifier)).toEqual(['doc-a']);
    expect(second.map((result) => result.identifier)).toEqual(['doc-a']);
    expect(second).toEqual(first);
  });
});
