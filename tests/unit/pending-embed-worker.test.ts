import { describe, expect, it, vi } from 'vitest';
import type { EmbeddingProvider } from '../../src/embedding/provider.js';
import { processPendingEmbeddings } from '../../src/embedding/pending-worker.js';

type PendingRow = {
  id: string;
  instance_id: string;
  target_kind: 'document' | 'document_chunk' | 'memory' | 'record';
  target_table: string;
  target_id: string;
  target_label: string | null;
  embed_text: string | null;
  attempt_count: number;
};

function makeProvider(result: number[] | Error): EmbeddingProvider {
  return {
    embed: result instanceof Error ? vi.fn().mockRejectedValue(result) : vi.fn().mockResolvedValue(result),
    getDimensions: () => 3,
  };
}

function makeSupabaseMock(rows: PendingRow[]) {
  const updates: Record<string, unknown>[] = [];
  const deletes: Array<[string, unknown]> = [];
  const eqCalls: Array<[string, unknown]> = [];

  const chain = <T>(result: T) => {
    const query = {
      eq: vi.fn((column: string, value: unknown) => {
        eqCalls.push([column, value]);
        return query;
      }),
      is: vi.fn(() => query),
      lte: vi.fn(() => query),
      or: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(() => query),
      single: vi.fn(() => Promise.resolve(result)),
      then: (resolve: (value: T) => void) => resolve(result),
    };
    return query;
  };

  const from = vi.fn((table: string) => {
    if (table === 'fqc_pending_embeds') {
      return {
        select: vi.fn(() => chain({ data: rows, error: null })),
        update: vi.fn((payload: Record<string, unknown>) => {
          updates.push(payload);
          return chain({ data: null, error: null });
        }),
        delete: vi.fn(() => {
          deletes.push([table, rows[0]?.id]);
          return chain({ data: null, error: null });
        }),
      };
    }

    if (table === 'fqc_memory') {
      return {
        select: vi.fn(() => chain({ data: { content: 'computed memory text' }, error: null })),
        update: vi.fn((payload: Record<string, unknown>) => {
          updates.push({ table, ...payload });
          return chain({ data: null, error: null });
        }),
      };
    }

    if (table === 'fqc_chunks') {
      return {
        select: vi.fn(() => chain({ data: { breadcrumb: 'Guide > Setup', content: 'computed chunk text' }, error: null })),
        update: vi.fn((payload: Record<string, unknown>) => {
          updates.push({ table, ...payload });
          return chain({ data: null, error: null });
        }),
      };
    }

    return {
      select: vi.fn(() => chain({ data: null, error: null })),
      update: vi.fn((payload: Record<string, unknown>) => {
        updates.push({ table, ...payload });
        return chain({ data: null, error: null });
      }),
    };
  });

  return { client: { from }, updates, deletes, eqCalls };
}

describe('pending embedding retry worker', () => {
  it('T-U-009 selects instance-scoped eligible pending rows and reuses stored embed text', async () => {
    const supabase = makeSupabaseMock([
      {
        id: 'pending-1',
        instance_id: 'inst-1',
        target_kind: 'document',
        target_table: 'fqc_documents',
        target_id: 'doc-1',
        target_label: 'Doc One',
        embed_text: 'stored document text',
        attempt_count: 0,
      },
    ]);
    const provider = makeProvider([0.1, 0.2, 0.3]);

    const result = await processPendingEmbeddings({
      supabase: supabase.client,
      provider,
      instanceId: 'inst-1',
      limit: 5,
      now: () => new Date('2026-05-24T00:00:00.000Z'),
    });

    expect(result).toEqual({ selected: 1, processed: 1, succeeded: 1, failed: 0 });
    expect(provider.embed).toHaveBeenCalledWith('stored document text');
    expect(supabase.eqCalls).toContainEqual(['instance_id', 'inst-1']);
    expect(supabase.eqCalls).toContainEqual(['status', 'pending']);
    expect(supabase.updates).toContainEqual(
      expect.objectContaining({ table: 'fqc_documents', embedding: JSON.stringify([0.1, 0.2, 0.3]) })
    );
    expect(supabase.deletes.length).toBe(1);
  });

  it('T-U-009 computes memory embed text when the pending row lacks stored text', async () => {
    const supabase = makeSupabaseMock([
      {
        id: 'pending-2',
        instance_id: 'inst-1',
        target_kind: 'memory',
        target_table: 'fqc_memory',
        target_id: 'mem-1',
        target_label: null,
        embed_text: null,
        attempt_count: 0,
      },
    ]);
    const provider = makeProvider([0.1, 0.2, 0.3]);

    await processPendingEmbeddings({
      supabase: supabase.client,
      provider,
      instanceId: 'inst-1',
      limit: 5,
    });

    expect(provider.embed).toHaveBeenCalledWith('computed memory text');
  });

  it('T-U-010 repeated failures retain last_error and increment attempt_count', async () => {
    const supabase = makeSupabaseMock([
      {
        id: 'pending-3',
        instance_id: 'inst-1',
        target_kind: 'record',
        target_table: 'fqcp_test_records',
        target_id: 'rec-1',
        target_label: 'Record One',
        embed_text: 'record text',
        attempt_count: 2,
      },
    ]);

    const result = await processPendingEmbeddings({
      supabase: supabase.client,
      provider: makeProvider(new Error('provider still down')),
      instanceId: 'inst-1',
      limit: 5,
      now: () => new Date('2026-05-24T00:00:00.000Z'),
    });

    expect(result).toEqual({ selected: 1, processed: 1, succeeded: 0, failed: 1 });
    expect(supabase.updates).toContainEqual(
      expect.objectContaining({
        attempt_count: 3,
        last_error: 'provider still down',
        status: 'pending',
        last_attempt_at: '2026-05-24T00:00:00.000Z',
      })
    );
  });

  it('T-U-030 reconstructs document_chunk target and clears retry row on success', async () => {
    const supabase = makeSupabaseMock([
      {
        id: 'pending-chunk-1',
        instance_id: 'inst-1',
        target_kind: 'document_chunk',
        target_table: 'fqc_chunks',
        target_id: '33333333-3333-4333-8333-333333333333',
        target_label: 'Guide.md > Guide > Setup',
        embed_text: null,
        attempt_count: 0,
      },
    ]);
    const provider = makeProvider([0.1, 0.2, 0.3]);

    const result = await processPendingEmbeddings({
      supabase: supabase.client,
      provider,
      instanceId: 'inst-1',
      embeddingName: 'primary',
      limit: 5,
      now: () => new Date('2026-06-14T00:00:00.000Z'),
    });

    expect(result).toEqual({ selected: 1, processed: 1, succeeded: 1, failed: 0 });
    expect(provider.embed).toHaveBeenCalledWith('Guide > Setup\n\ncomputed chunk text');
    expect(supabase.updates).toContainEqual(
      expect.objectContaining({
        table: 'fqc_chunks',
        embedding_primary: JSON.stringify([0.1, 0.2, 0.3]),
        embedding_primary_indexed_at: expect.any(String),
      })
    );
    expect(supabase.deletes.length).toBe(1);
  });
});
