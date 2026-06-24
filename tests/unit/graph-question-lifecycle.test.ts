import { describe, expect, it } from 'vitest';
import { createInMemoryGraphQueryStore, queryGraph, type GraphQueryStoreSeed } from '../../src/graph/queries.js';

function parseResult(result: { content: Array<{ type: 'text'; text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? '{}');
}

describe('graph question lifecycle reads', () => {
  it('T-U-031 surfaces question_status and question_resolution from stored graph rows', async () => {
    const seed: GraphQueryStoreSeed = {
      nodes: [
        {
          chunk_id: 'question',
          instance_id: 'question-test',
          document_id: 'doc-question',
          document_path: 'Questions.md',
          document_title: 'Questions',
          document_status: 'active',
          heading_path: 'Open Question',
          breadcrumb: 'Open Question',
          provenance_basis: null,
          question_status: 'resolved',
          question_resolution: 'Resolved by implementation notes.',
          community_id: null,
          community_label: null,
          community_summary: null,
        },
      ],
      edges: [],
    };

    const result = await queryGraph(createInMemoryGraphQueryStore(seed), {
      instance_id: 'question-test',
      action: 'node',
      chunk_id: 'question',
    });

    expect(parseResult(result)).toMatchObject({
      data: {
        node: {
          chunk_id: 'question',
          question_status: 'resolved',
          question_resolution: 'Resolved by implementation notes.',
        },
      },
    });
  });

  it('returns seeded community metadata through community_for and community_members', async () => {
    const seed: GraphQueryStoreSeed = {
      nodes: [
        {
          chunk_id: 'member-a',
          instance_id: 'community-test',
          document_id: 'doc-a',
          document_path: 'A.md',
          document_title: 'A',
          document_status: 'active',
          heading_path: 'A',
          breadcrumb: 'A',
          provenance_basis: null,
          question_status: null,
          question_resolution: null,
          community_id: 'comm-seeded',
          community_label: 'Seeded Community',
          community_summary: 'Seeded summary',
        },
        {
          chunk_id: 'member-b',
          instance_id: 'community-test',
          document_id: 'doc-b',
          document_path: 'B.md',
          document_title: 'B',
          document_status: 'active',
          heading_path: 'B',
          breadcrumb: 'B',
          provenance_basis: null,
          question_status: null,
          question_resolution: null,
          community_id: 'comm-seeded',
          community_label: 'Seeded Community',
          community_summary: 'Seeded summary',
        },
      ],
      edges: [],
    };
    const store = createInMemoryGraphQueryStore(seed);

    expect(
      parseResult(
        await queryGraph(store, {
          instance_id: 'community-test',
          action: 'community_for',
          chunk_id: 'member-a',
        })
      )
    ).toMatchObject({
      data: {
        community: {
          community_id: 'comm-seeded',
          community_label: 'Seeded Community',
          community_summary: 'Seeded summary',
          member_count: 2,
        },
      },
    });

    const members = parseResult(
      await queryGraph(store, {
        instance_id: 'community-test',
        action: 'community_members',
        community_id: 'comm-seeded',
        limit: 1,
      })
    ) as { data: { members: Array<{ chunk_id: string }> } };

    expect(members.data.members.map((member) => member.chunk_id)).toEqual(['member-a']);
  });
});
