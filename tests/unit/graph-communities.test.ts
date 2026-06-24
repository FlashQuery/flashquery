import { describe, expect, it } from 'vitest';
import { detectTopologyCommunities } from '../../src/graph/communities.js';

describe('graph topology communities', () => {
  it('T-U-047 writes deterministic ephemeral community labels from stored topology inputs', () => {
    const communities = detectTopologyCommunities({
      nodes: [
        { chunk_id: 'aaaaaaaa-0000-4000-8000-000000000001', document_id: 'doc-a', document_path: '/a.md' },
        { chunk_id: 'aaaaaaaa-0000-4000-8000-000000000002', document_id: 'doc-a', document_path: '/a.md' },
        { chunk_id: 'aaaaaaaa-0000-4000-8000-000000000003', document_id: 'doc-b', document_path: '/b.md' },
      ],
      edges: [
        { source_chunk_id: 'aaaaaaaa-0000-4000-8000-000000000001', target_chunk_id: 'aaaaaaaa-0000-4000-8000-000000000002', confidence_score: 1, status: 'active', relation: 'references' },
        { source_chunk_id: 'aaaaaaaa-0000-4000-8000-000000000002', target_chunk_id: 'aaaaaaaa-0000-4000-8000-000000000003', confidence_score: 0.8, status: 'active', relation: 'supports' },
      ],
    });

    expect(communities).toHaveLength(1);
    expect(communities[0]).toMatchObject({
      community_id: expect.stringMatching(/^comm-1-/),
      community_label: 'Graph Community 1',
      member_chunk_ids: [
        'aaaaaaaa-0000-4000-8000-000000000001',
        'aaaaaaaa-0000-4000-8000-000000000002',
        'aaaaaaaa-0000-4000-8000-000000000003',
      ],
      document_ids: ['doc-a', 'doc-b'],
      document_paths: ['/a.md', '/b.md'],
    });
  });

  it('T-U-048 overwrites labels deterministically on later lint runs', () => {
    const input = {
      nodes: [
        { chunk_id: 'b0000000-0000-4000-8000-000000000001', document_id: 'doc-a', document_path: '/a.md' },
        { chunk_id: 'b0000000-0000-4000-8000-000000000002', document_id: 'doc-a', document_path: '/a.md' },
        { chunk_id: 'b0000000-0000-4000-8000-000000000003', document_id: 'doc-b', document_path: '/b.md' },
      ],
      edges: [
        { source_chunk_id: 'b0000000-0000-4000-8000-000000000001', target_chunk_id: 'b0000000-0000-4000-8000-000000000002', confidence_score: 1, status: 'active', relation: 'references' },
        { source_chunk_id: 'b0000000-0000-4000-8000-000000000002', target_chunk_id: 'b0000000-0000-4000-8000-000000000003', confidence_score: 1, status: 'active', relation: 'supports' },
      ],
    };

    expect(detectTopologyCommunities(input)).toEqual(detectTopologyCommunities(input));
  });

  it('T-U-049 refuses to use embedding similarity as stored topology', () => {
    const communities = detectTopologyCommunities({
      nodes: [
        { chunk_id: 'c0000000-0000-4000-8000-000000000001', document_id: 'doc-a', document_path: '/a.md' },
        { chunk_id: 'c0000000-0000-4000-8000-000000000002', document_id: 'doc-b', document_path: '/b.md' },
        { chunk_id: 'c0000000-0000-4000-8000-000000000003', document_id: 'doc-c', document_path: '/c.md' },
      ],
      edges: [],
    });

    expect(communities).toEqual([]);
  });

  it('T-U-064 yields no communities for sparse topology', () => {
    const communities = detectTopologyCommunities({
      nodes: [
        { chunk_id: 'd0000000-0000-4000-8000-000000000001', document_id: 'doc-a', document_path: '/a.md' },
        { chunk_id: 'd0000000-0000-4000-8000-000000000002', document_id: 'doc-b', document_path: '/b.md' },
      ],
      edges: [
        { source_chunk_id: 'd0000000-0000-4000-8000-000000000001', target_chunk_id: 'd0000000-0000-4000-8000-000000000002', confidence_score: 1, status: 'active', relation: 'references' },
      ],
    });

    expect(communities).toEqual([]);
  });
});
