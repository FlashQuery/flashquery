import { describe, expect, it, vi } from 'vitest';

import { processPendingGraphEdges, type PendingGraphEdgeRow } from '../../src/graph/pending-worker.js';

describe('graph cost controls', () => {
  it('T-U-043 graph worker returns processing counts', async () => {
    const row: PendingGraphEdgeRow = {
      id: 'pending-1',
      instance_id: 'graph-inst',
      source_chunk_id: '11111111-1111-4111-8111-111111111111',
      target_chunk_id: '22222222-2222-4222-8222-222222222222',
      relation_hint: null,
      status: 'pending',
      attempt_count: 0,
      max_attempts: 3,
      result: null,
      last_error: null,
      next_retry_at: null,
    };
    const supabase = {
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn(function eq(this: unknown) {
            return this;
          }),
          in: vi.fn(function inFilter(this: unknown) {
            return this;
          }),
          or: vi.fn(function orFilter(this: unknown) {
            return this;
          }),
          order: vi.fn(function order(this: unknown) {
            return this;
          }),
          limit: vi.fn(function limit(this: unknown) {
            return this;
          }),
          then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
            resolve({
              data:
                table === 'fqc_pending_edges'
                  ? [row]
                  : [
                      {
                        chunk_id: row.source_chunk_id,
                        key_claims: ['source claim'],
                        analyzed_at: '2026-06-24T00:00:00.000Z',
                      },
                      {
                        chunk_id: row.target_chunk_id,
                        key_claims: ['target claim'],
                        analyzed_at: '2026-06-24T00:00:00.000Z',
                      },
                    ],
              error: null,
            }),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(function eq(this: unknown) {
            return this;
          }),
          then: (resolve: (value: { data: null; error: null }) => unknown) => resolve({ data: null, error: null }),
        })),
        insert: vi.fn(() => ({
          select: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn(function eq(this: unknown) {
            return this;
          }),
          then: (resolve: (value: { data: null; error: null }) => unknown) => resolve({ data: null, error: null }),
        })),
      })),
    };

    const result = await processPendingGraphEdges({
      supabase,
      instanceId: 'graph-inst',
      classifyCandidate: vi.fn(async () => ({ status: 'classified', edges: [], written: 0 })),
    });

    expect(result).toEqual({
      selected: 1,
      processed: 1,
      succeeded: 1,
      failed: 0,
      dead_letter: 0,
      skipped: 0,
      warnings: [],
    });
  });
});
