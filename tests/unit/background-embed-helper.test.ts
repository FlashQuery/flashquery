import { describe, expect, it, vi } from 'vitest';
import {
  EMBEDDING_DEFERRED_WARNING,
  documentEmbeddingTarget,
  memoryEmbeddingTarget,
  recordEmbeddingTarget,
  scheduleBackgroundEmbedding,
} from '../../src/embedding/background-embed.js';
import { jsonToolResult, withWarnings } from '../../src/mcp/utils/response-formats.js';
import type { EmbeddingProvider } from '../../src/embedding/provider.js';

type TableMock = {
  update: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function makeProvider(result: number[] | Error): EmbeddingProvider {
  return {
    embed: result instanceof Error ? vi.fn().mockRejectedValue(result) : vi.fn().mockResolvedValue(result),
    getDimensions: () => 3,
  };
}

function makeSupabaseMock(options: {
  updateError?: { message: string };
  existingAttemptCount?: number;
} = {}) {
  const tables = new Map<string, TableMock>();
  const eqCalls: Array<[string, unknown]> = [];

  const makeEqChain = (finalResult: unknown) => {
    const chain = {
      eq: vi.fn((key: string, value: unknown) => {
        eqCalls.push([key, value]);
        return chain;
      }),
      then: (resolve: (value: unknown) => void) => resolve(finalResult),
    };
    return chain;
  };

  const from = vi.fn((table: string) => {
    if (!tables.has(table)) {
      tables.set(table, {
        update: vi.fn(() => makeEqChain({ error: options.updateError ?? null })),
        upsert: vi.fn(async () => ({ error: null })),
        delete: vi.fn(() => makeEqChain({ error: null })),
        select: vi.fn(() =>
          makeEqChain({
            data:
              options.existingAttemptCount === undefined
                ? []
                : [{ attempt_count: options.existingAttemptCount }],
            error: null,
          })
        ),
      });
    }
    return tables.get(table)!;
  });

  return { client: { from }, tables, eqCalls };
}

describe('background embedding helper', () => {
  it('T-U-006 updates document, memory, and record target embeddings on provider success', async () => {
    const targets = [
      { table: 'fqc_documents', target: documentEmbeddingTarget({ instanceId: 'inst', id: 'doc-1', label: 'Doc' }) },
      { table: 'fqc_memory', target: memoryEmbeddingTarget({ instanceId: 'inst', id: 'mem-1', label: 'Memory' }) },
      { table: 'fqcp_crm_contacts', target: recordEmbeddingTarget({ instanceId: 'inst', targetTable: 'fqcp_crm_contacts', id: 'rec-1', label: 'Record' }) },
    ];

    for (const { table, target } of targets) {
      const supabase = makeSupabaseMock();
      const result = await scheduleBackgroundEmbedding({
        target,
        embedText: 'hello',
        provider: makeProvider([0.1, 0.2, 0.3]),
        supabase: supabase.client,
      });

      expect(result.warnings).toEqual([]);
      expect(supabase.tables.get(table)?.update).toHaveBeenCalledWith(
        expect.objectContaining({ embedding: JSON.stringify([0.1, 0.2, 0.3]) })
      );
      expect(supabase.tables.get('fqc_pending_embeds')?.upsert).not.toHaveBeenCalled();
      expect(supabase.tables.get('fqc_pending_embeds')?.delete).toHaveBeenCalled();
    }
  });

  it('clears a stale pending row when a later foreground embedding succeeds', async () => {
    const supabase = makeSupabaseMock();

    const result = await scheduleBackgroundEmbedding({
      target: documentEmbeddingTarget({ instanceId: 'inst', id: 'doc-1', label: 'Doc' }),
      embedText: 'fresh text',
      provider: makeProvider([0.1, 0.2, 0.3]),
      supabase: supabase.client,
    });

    expect(result.warnings).toEqual([]);
    expect(supabase.tables.get('fqc_pending_embeds')?.delete).toHaveBeenCalled();
    expect(supabase.eqCalls).toEqual(
      expect.arrayContaining([
        ['instance_id', 'inst'],
        ['target_kind', 'document'],
        ['target_table', 'fqc_documents'],
        ['target_id', 'doc-1'],
      ])
    );
  });

  it('T-U-007 upserts durable pending state and logs background_embed_failed on provider failure', async () => {
    const supabase = makeSupabaseMock();
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };

    const result = await scheduleBackgroundEmbedding({
      target: documentEmbeddingTarget({ instanceId: 'inst', id: 'doc-1', label: 'Doc One' }),
      embedText: 'retry this text',
      provider: makeProvider(new Error('provider down')),
      supabase: supabase.client,
      logger,
    });

    expect(result.warnings).toEqual([EMBEDDING_DEFERRED_WARNING]);
    expect(supabase.tables.get('fqc_pending_embeds')?.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        instance_id: 'inst',
        target_kind: 'document',
        target_table: 'fqc_documents',
        target_id: 'doc-1',
        target_label: 'Doc One',
        embed_text: 'retry this text',
        attempt_count: 1,
        last_error: 'provider down',
        status: 'pending',
      }),
      { onConflict: 'instance_id,target_kind,target_table,target_id' }
    );
    expect(logger.error).toHaveBeenCalledWith(
      'background_embed_failed',
      expect.objectContaining({
        target_kind: 'document',
        target_table: 'fqc_documents',
        target_id: 'doc-1',
        error: 'provider down',
      })
    );
  });

  it('T-U-007 records pending state when the target embedding update fails', async () => {
    const supabase = makeSupabaseMock({
      updateError: { message: 'update rejected' },
      existingAttemptCount: 2,
    });

    const result = await scheduleBackgroundEmbedding({
      target: memoryEmbeddingTarget({ instanceId: 'inst', id: 'mem-1' }),
      embedText: 'memory text',
      provider: makeProvider([0.3, 0.2, 0.1]),
      supabase: supabase.client,
    });

    expect(result.warnings).toEqual([EMBEDDING_DEFERRED_WARNING]);
    expect(supabase.tables.get('fqc_pending_embeds')?.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        target_kind: 'memory',
        target_table: 'fqc_memory',
        target_id: 'mem-1',
        attempt_count: 3,
        last_error: 'update rejected',
      }),
      { onConflict: 'instance_id,target_kind,target_table,target_id' }
    );
  });

  it('T-U-008 helper warnings compose into success response envelopes', async () => {
    const response = jsonToolResult(withWarnings({ id: 'doc-1' }, [EMBEDDING_DEFERRED_WARNING]));

    expect(JSON.parse(response.content[0].text)).toEqual({
      id: 'doc-1',
      warnings: ['embedding_deferred'],
    });
  });
});
