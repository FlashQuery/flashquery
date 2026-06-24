import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { selectGraphEdgeCandidates } from '../../../src/graph/candidates.js';
import { processPendingGraphEdges, type PendingGraphEdgeRow } from '../../../src/graph/pending-worker.js';

function pendingRow(overrides: Partial<PendingGraphEdgeRow> = {}): PendingGraphEdgeRow {
  return {
    id: 'pending-1',
    instance_id: 'graph-it',
    source_chunk_id: '11111111-1111-4111-8111-111111111111',
    target_chunk_id: '22222222-2222-4222-8222-222222222222',
    relation_hint: null,
    status: 'pending',
    attempt_count: 0,
    max_attempts: 3,
    result: null,
    last_error: null,
    next_retry_at: null,
    ...overrides,
  };
}

function chain<T>(result: T) {
  const query = {
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    or: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    then: (resolve: (value: T) => void) => resolve(result),
  };
  return query;
}

describe('graph pending edge worker integration contracts', () => {
  it('T-I-019 drains eligible jobs for one instance only', async () => {
    const updates: Array<{ payload: Record<string, unknown>; filters: Record<string, unknown> }> = [];
    const rows = [pendingRow(), pendingRow({ id: 'other-1', instance_id: 'other-instance' })];
    const supabase = {
      from: vi.fn((table: string) => ({
        select: vi.fn(() =>
          chain({
            data:
              table === 'fqc_pending_edges'
                ? rows
                : [
                    {
                      chunk_id: '11111111-1111-4111-8111-111111111111',
                      key_claims: ['source'],
                      analyzed_at: '2026-06-24T00:00:00.000Z',
                    },
                    {
                      chunk_id: '22222222-2222-4222-8222-222222222222',
                      key_claims: ['target'],
                      analyzed_at: '2026-06-24T00:00:00.000Z',
                    },
                  ],
            error: null,
          })
        ),
        update: vi.fn((payload: Record<string, unknown>) => {
          const filters: Record<string, unknown> = {};
          const builder = {
            eq: vi.fn((column: string, value: unknown) => {
              filters[column] = value;
              return builder;
            }),
            then: (resolve: (value: { data: null; error: null }) => void) => {
              updates.push({ payload, filters });
              resolve({ data: null, error: null });
            },
          };
          return builder;
        }),
        insert: vi.fn(() => ({ select: vi.fn(async () => ({ data: [], error: null })) })),
        delete: vi.fn(() => chain({ data: null, error: null })),
      })),
    };

    const result = await processPendingGraphEdges({
      supabase,
      instanceId: 'graph-it',
      classifyCandidate: vi.fn(async () => ({ status: 'classified', edges: [], written: 0 })),
    });

    expect(result).toMatchObject({
      selected: 1,
      processed: 1,
      succeeded: 1,
      failed: 0,
      dead_letter: 0,
    });
    expect(updates.every((update) => update.filters.instance_id === 'graph-it')).toBe(true);
  });

  it('T-I-040 surfaces warning when graph classification is skipped for missing embeddings', async () => {
    const result = await selectGraphEdgeCandidates({
      supabase: {
        from: vi.fn(() => ({
          select: vi.fn(() =>
            chain({
              data: [
                {
                  id: '11111111-1111-4111-8111-111111111111',
                  document_id: 'doc-a',
                  instance_id: 'graph-it',
                  embedding_primary: null,
                },
              ],
              error: null,
            })
          ),
        })),
        rpc: vi.fn(),
      },
      instanceId: 'graph-it',
      graph: {
        enabled: true,
        embeddingName: 'primary',
        classificationPurpose: 'graph-classifier',
        maxClassificationJobsPerSave: 1,
      },
      changedChunkIds: ['11111111-1111-4111-8111-111111111111'],
    });

    expect(result.candidates).toEqual([]);
    expect(result.warnings).toContain('graph classification skipped: missing chunk embeddings');
  });

  it('T-I-041 scanner and maintenance expose queue-driven graph worker without synchronous LLM writes', () => {
    const scanner = readFileSync('src/services/scanner.ts', 'utf-8');
    const maintenance = readFileSync('src/services/maintenance.ts', 'utf-8');

    expect(scanner).toContain("import('../graph/pending-worker.js')");
    expect(scanner).not.toContain("import('../graph/llm-analysis.js')");
    expect(maintenance).toContain("action === 'graph_worker'");
    expect(maintenance).toContain('selected: result.selected');
    expect(maintenance).not.toContain('setInterval');
    expect(maintenance).not.toContain('setTimeout');
  });
});
