import { describe, expect, it, vi } from 'vitest';

import {
  selectGraphEdgeCandidates,
  type GraphCandidate,
} from '../../src/graph/candidates.js';

type QueryResult<Row = Record<string, unknown>> = {
  data?: Row[] | Row | null;
  error?: { message: string } | null;
};

function chain<T>(result: T, eqCalls: Array<[string, unknown]> = []) {
  const query = {
    eq: vi.fn((column: string, value: unknown) => {
      eqCalls.push([column, value]);
      return query;
    }),
    not: vi.fn(() => query),
    then: (resolve: (value: T) => void) => resolve(result),
  };
  return query;
}

function makeSupabaseMock(input: {
  sourceRows?: Array<Record<string, unknown>>;
  rpcRows?: Array<Record<string, unknown>>;
}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const eqCalls: Array<[string, unknown]> = [];
  const from = vi.fn((table: string) => {
    if (table !== 'fqc_chunks') {
      return { select: vi.fn(() => chain({ data: null, error: null }, eqCalls)) };
    }
    return {
      select: vi.fn(() => chain<QueryResult>({ data: input.sourceRows ?? [], error: null }, eqCalls)),
    };
  });
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return Promise.resolve({ data: input.rpcRows ?? [], error: null });
  });
  return { client: { from, rpc }, rpcCalls, eqCalls };
}

const defaultOptions = {
  instanceId: 'inst-graph',
  embeddingName: 'primary',
  graph: {
    enabled: true,
    embeddingName: 'primary',
    classificationPurpose: 'graph',
    similarityMode: 'threshold' as const,
    similarityThreshold: 0.7,
    maxClassificationJobsPerSave: 10,
  },
};

describe('graph candidate selection', () => {
  it('T-U-033 selects threshold candidates through configured chunk RPC with instance filtering', async () => {
    const supabase = makeSupabaseMock({
      sourceRows: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          document_id: 'doc-a',
          embedding_primary: [0.1, 0.2, 0.3],
        },
      ],
      rpcRows: [
        {
          chunk_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          document_id: 'doc-b',
          similarity: 0.82,
        },
        {
          chunk_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          document_id: 'doc-c',
          similarity: 0.69,
        },
      ],
    });

    const result = await selectGraphEdgeCandidates({
      ...defaultOptions,
      supabase: supabase.client,
      changedChunkIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    });

    expect(result.candidates).toEqual<GraphCandidate[]>([
      {
        sourceChunkId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        targetChunkId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        sourceDocumentId: 'doc-a',
        targetDocumentId: 'doc-b',
        similarity: 0.82,
        selectionMode: 'threshold',
      },
    ]);
    expect(supabase.rpcCalls).toEqual([
      expect.objectContaining({
        name: 'match_chunks_primary',
        args: expect.objectContaining({
          filter_instance_id: 'inst-graph',
          match_threshold: 0.7,
        }),
      }),
    ]);
  });

  it('T-U-034 selects percentile candidates deterministically with tie handling', async () => {
    const supabase = makeSupabaseMock({
      sourceRows: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          document_id: 'doc-a',
          embedding_primary: '[0.1,0.2,0.3]',
        },
      ],
      rpcRows: [
        { chunk_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', document_id: 'doc-d', similarity: 0.8 },
        { chunk_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', document_id: 'doc-b', similarity: 0.9 },
        { chunk_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', document_id: 'doc-c', similarity: 0.9 },
        { chunk_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', document_id: 'doc-e', similarity: 0.7 },
      ],
    });

    const result = await selectGraphEdgeCandidates({
      ...defaultOptions,
      supabase: supabase.client,
      graph: {
        ...defaultOptions.graph,
        similarityMode: 'percentile',
        similarityPercentile: 50,
      },
      changedChunkIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    });

    expect(result.candidates.map((candidate) => candidate.targetChunkId)).toEqual([
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    ]);
  });

  it('T-U-035 reports missing Tier 3 resolver instead of enqueueable candidates', async () => {
    const supabase = makeSupabaseMock({
      sourceRows: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          document_id: 'doc-a',
          embedding_primary: [0.1, 0.2, 0.3],
        },
      ],
    });

    const result = await selectGraphEdgeCandidates({
      ...defaultOptions,
      supabase: supabase.client,
      graph: {
        ...defaultOptions.graph,
        classificationPurpose: undefined,
        classificationModel: undefined,
      },
      changedChunkIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    });

    expect(result.candidates).toEqual([]);
    expect(result.skippedReasons).toContain('missing_classification_resolver');
    expect(result.warnings).toContain('graph classification skipped: missing classification resolver');
    expect(supabase.rpcCalls).toEqual([]);
  });

  it('T-U-036 caps candidate count and reports cap-exceeded count', async () => {
    const supabase = makeSupabaseMock({
      sourceRows: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          document_id: 'doc-a',
          embedding_primary: [0.1, 0.2, 0.3],
        },
      ],
      rpcRows: [
        { chunk_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', document_id: 'doc-b', similarity: 0.9 },
        { chunk_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', document_id: 'doc-c', similarity: 0.8 },
        { chunk_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', document_id: 'doc-d', similarity: 0.7 },
      ],
    });

    const result = await selectGraphEdgeCandidates({
      ...defaultOptions,
      supabase: supabase.client,
      graph: { ...defaultOptions.graph, maxClassificationJobsPerSave: 2 },
      changedChunkIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    });

    expect(result.candidates).toHaveLength(2);
    expect(result.capExceededCount).toBe(1);
    expect(result.warnings).toContain('graph classification candidate cap exceeded: skipped 1 candidate');
  });

  it('T-U-058 excludes same-document candidates unless a classified relation allows them', async () => {
    const sourceRow = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      document_id: 'doc-a',
      embedding_primary: [0.1, 0.2, 0.3],
    };
    const rpcRows = [
      { chunk_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', document_id: 'doc-a', similarity: 0.9 },
    ];

    const excluded = await selectGraphEdgeCandidates({
      ...defaultOptions,
      supabase: makeSupabaseMock({ sourceRows: [sourceRow], rpcRows }).client,
      changedChunkIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    });
    expect(excluded.candidates).toEqual([]);
    expect(excluded.skippedReasons).toContain('same_document_excluded');

    const included = await selectGraphEdgeCandidates({
      ...defaultOptions,
      supabase: makeSupabaseMock({ sourceRows: [sourceRow], rpcRows }).client,
      changedChunkIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      relations: [
        {
          name: 'duplicates',
          category: 'classified',
          detectionMethod: 'classified',
          directionality: 'symmetric',
          description: 'same document duplicates',
          metadataSchema: { allow_same_document: true },
        },
      ],
    });
    expect(included.candidates).toHaveLength(1);
  });
});
