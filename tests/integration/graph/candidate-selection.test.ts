import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { selectGraphEdgeCandidates } from '../../../src/graph/candidates.js';

type QueryResult<Row = Record<string, unknown>> = {
  data?: Row[] | Row | null;
  error?: { message: string } | null;
};

function chain<T>(result: T) {
  const query = {
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
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
  const from = vi.fn((table: string) => {
    if (table !== 'fqc_chunks') {
      return { select: vi.fn(() => chain<QueryResult>({ data: [], error: null })) };
    }
    return {
      select: vi.fn(() => chain<QueryResult>({ data: input.sourceRows ?? [], error: null })),
    };
  });
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return Promise.resolve({ data: input.rpcRows ?? [], error: null });
  });
  return { client: { from, rpc }, rpcCalls };
}

const graph = {
  enabled: true,
  embeddingName: 'primary',
  classificationPurpose: 'graph',
  similarityMode: 'threshold' as const,
  similarityThreshold: 0.7,
  maxClassificationJobsPerSave: 5,
};

describe('graph candidate selection integration contracts', () => {
  it('T-I-018 calls configured match_chunks RPC with filter_instance_id', async () => {
    const supabase = makeSupabaseMock({
      sourceRows: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          document_id: 'doc-a',
          instance_id: 'candidate-instance',
          embedding_primary: [0.1, 0.2, 0.3],
        },
      ],
      rpcRows: [
        {
          chunk_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          document_id: 'doc-b',
          similarity: 0.8,
        },
      ],
    });

    const result = await selectGraphEdgeCandidates({
      supabase: supabase.client,
      instanceId: 'candidate-instance',
      graph,
      changedChunkIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    });

    expect(result.candidates).toHaveLength(1);
    expect(supabase.rpcCalls).toEqual([
      expect.objectContaining({
        name: 'match_chunks_primary',
        args: expect.objectContaining({
          filter_instance_id: 'candidate-instance',
          include_archived: false,
        }),
      }),
    ]);
  });

  it('T-I-040 surfaces warning when changed chunks are missing embeddings', async () => {
    const result = await selectGraphEdgeCandidates({
      supabase: makeSupabaseMock({
        sourceRows: [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            document_id: 'doc-a',
            instance_id: 'candidate-instance',
            embedding_primary: null,
          },
        ],
      }).client,
      instanceId: 'candidate-instance',
      graph,
      changedChunkIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    });

    expect(result.candidates).toEqual([]);
    expect(result.skippedReasons).toContain('missing_source_embedding');
    expect(result.warnings).toContain('graph classification skipped: missing chunk embeddings');
  });

  it('T-I-041 scheduler imports candidate enqueue helpers without graph LLM analysis helpers', () => {
    const scheduler = readFileSync('src/embedding/chunks/scheduler.ts', 'utf-8');

    expect(scheduler).toContain("from '../../graph/candidates.js'");
    expect(scheduler).toContain("from '../../graph/pending-edges.js'");
    expect(scheduler).not.toContain('llm-analysis');
    expect(scheduler).not.toContain('classify');
  });
});
