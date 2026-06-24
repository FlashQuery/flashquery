import { describe, expect, it, vi } from 'vitest';

import {
  listGraphDeadLetterJobs,
  processPendingGraphEdges,
  type PendingGraphEdgeRow,
} from '../../src/graph/pending-worker.js';

function row(overrides: Partial<PendingGraphEdgeRow> = {}): PendingGraphEdgeRow {
  return {
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
    ...overrides,
  };
}

function fakeSupabase(rows: PendingGraphEdgeRow[]) {
  const updates: Array<{ table: string; payload: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; rows: Record<string, unknown>[] }> = [];
  const deletes: Array<{ table: string; filters: Record<string, unknown> }> = [];

  const applyFilters = <T extends Record<string, unknown>>(inputRows: T[], filters: Record<string, unknown>) =>
    inputRows.filter((item) => Object.entries(filters).every(([key, value]) => item[key] === value));

  const makeBuilder = (table: string, operation: 'select' | 'update' | 'insert' | 'delete', payload?: unknown) => {
    const filters: Record<string, unknown> = {};
    let limitCount: number | undefined;
    const builder = {
      eq(column: string, value: unknown) {
        filters[column] = value;
        return builder;
      },
      in(column: string, value: unknown[]) {
        filters[column] = value;
        return builder;
      },
      or() {
        return builder;
      },
      order() {
        return builder;
      },
      limit(count: number) {
        limitCount = count;
        return builder;
      },
      single() {
        return Promise.resolve({ data: applyFilters(tableRows(table), filters)[0] ?? null, error: null });
      },
      select() {
        return builder;
      },
      then(resolve: (value: { data: unknown; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
        try {
          if (operation === 'select') {
            let data = applyFilters(tableRows(table), filters);
            if (limitCount !== undefined) data = data.slice(0, limitCount);
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          }
          if (operation === 'update') {
            updates.push({ table, payload: payload as Record<string, unknown>, filters });
            for (const item of applyFilters(tableRows(table), filters)) {
              Object.assign(item, payload);
            }
          }
          if (operation === 'insert') {
            const insertRows = Array.isArray(payload) ? payload : [payload];
            inserts.push({ table, rows: insertRows as Record<string, unknown>[] });
          }
          if (operation === 'delete') {
            deletes.push({ table, filters });
          }
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        } catch (error) {
          return Promise.reject(error).then(resolve, reject);
        }
      },
    };
    return builder;
  };

  function tableRows(table: string): Array<Record<string, unknown>> {
    if (table === 'fqc_pending_edges') return rows as unknown as Array<Record<string, unknown>>;
    if (table === 'fqc_graph_nodes') {
      return [
        {
          chunk_id: '11111111-1111-4111-8111-111111111111',
          instance_id: 'graph-inst',
          key_claims: ['source claim'],
          analyzed_at: '2026-06-24T00:00:00.000Z',
        },
        {
          chunk_id: '22222222-2222-4222-8222-222222222222',
          instance_id: 'graph-inst',
          key_claims: ['target claim'],
          analyzed_at: '2026-06-24T00:00:00.000Z',
        },
      ];
    }
    return [];
  }

  return {
    updates,
    inserts,
    deletes,
    from(table: string) {
      return {
        select: () => makeBuilder(table, 'select'),
        update: (payload: Record<string, unknown>) => makeBuilder(table, 'update', payload),
        insert: (payload: Record<string, unknown> | Array<Record<string, unknown>>) =>
          makeBuilder(table, 'insert', payload),
        delete: () => makeBuilder(table, 'delete'),
      };
    },
  };
}

describe('graph pending edge worker', () => {
  it('T-U-041 transient failure increments attempts and schedules retry', async () => {
    const supabase = fakeSupabase([row()]);

    const result = await processPendingGraphEdges({
      supabase,
      instanceId: 'graph-inst',
      limit: 5,
      now: () => new Date('2026-06-24T00:00:00.000Z'),
      retryBackoffMs: 60_000,
      classifyCandidate: vi.fn(async () => ({ status: 'parse_failed', error: { error: 'bad_json', message: 'bad json' } })),
    });

    expect(result).toMatchObject({ selected: 1, processed: 1, succeeded: 0, failed: 1, dead_letter: 0 });
    expect(supabase.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'fqc_pending_edges',
          payload: expect.objectContaining({
            status: 'pending',
            attempt_count: 1,
            last_error: expect.stringContaining('bad json'),
            next_retry_at: '2026-06-24T00:01:00.000Z',
          }),
          filters: expect.objectContaining({ id: 'pending-1', instance_id: 'graph-inst' }),
        }),
      ])
    );
  });

  it('T-U-042 max attempts moves job to dead letter and stops automatic retry', async () => {
    const supabase = fakeSupabase([row({ attempt_count: 2, max_attempts: 3 })]);

    const result = await processPendingGraphEdges({
      supabase,
      instanceId: 'graph-inst',
      now: () => new Date('2026-06-24T00:00:00.000Z'),
      classifyCandidate: vi.fn(async () => ({
        status: 'validation_failed',
        error: new Error('Unknown graph relation'),
      })),
    });

    expect(result).toMatchObject({ failed: 1, dead_letter: 1 });
    expect(supabase.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'fqc_pending_edges',
          payload: expect.objectContaining({
            status: 'dead_letter',
            attempt_count: 3,
            next_retry_at: null,
            result: expect.objectContaining({
              remediation: expect.stringContaining('Review graph configuration'),
            }),
          }),
          filters: expect.objectContaining({ id: 'pending-1', instance_id: 'graph-inst' }),
        }),
      ])
    );
  });

  it('T-U-072 respects shutdown state and per-run limit', async () => {
    const supabase = fakeSupabase([
      row({ id: 'pending-1' }),
      row({ id: 'pending-2', source_chunk_id: '33333333-3333-4333-8333-333333333333' }),
    ]);
    let calls = 0;

    const result = await processPendingGraphEdges({
      supabase,
      instanceId: 'graph-inst',
      limit: 1,
      getIsShuttingDown: () => calls++ > 1,
      classifyCandidate: vi.fn(async () => ({ status: 'classified', edges: [], written: 0 })),
    });

    expect(result.selected).toBe(1);
    expect(result.processed).toBe(1);
    expect(supabase.updates.filter((entry) => entry.payload.status === 'processing')).toHaveLength(1);
  });

  it('T-U-073 enumerates dead-letter jobs with remediation detail', async () => {
    const supabase = fakeSupabase([
      row({
        status: 'dead_letter',
        last_error: 'validation failed',
        result: { remediation: 'Review graph configuration and retry manually.' },
      }),
    ]);

    const jobs = await listGraphDeadLetterJobs({ supabase, instanceId: 'graph-inst', limit: 10 });

    expect(jobs).toEqual([
      expect.objectContaining({
        id: 'pending-1',
        source_chunk_id: '11111111-1111-4111-8111-111111111111',
        last_error: 'validation failed',
        remediation: 'Review graph configuration and retry manually.',
      }),
    ]);
  });

  it('uses stale completion after successful classification when a graph client is provided', async () => {
    const supabase = fakeSupabase([row()]);
    const graphClient = {
      query: vi.fn(async () => ({ rows: [] })),
    };

    const result = await processPendingGraphEdges({
      supabase,
      graphClient,
      instanceId: 'graph-inst',
      classifyCandidate: vi.fn(async () => ({ status: 'classified', edges: [], written: 0 })),
    });

    expect(result.succeeded).toBe(1);
    expect(graphClient.query).toHaveBeenCalledWith(expect.stringContaining('SELECT id, relation'), [
      'graph-inst',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);
  });
});
