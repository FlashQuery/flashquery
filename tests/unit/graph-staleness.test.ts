import { describe, expect, it, vi } from 'vitest';

import type { ParsedChunk } from '../../src/embedding/chunks/types.js';
import {
  buildChangedChunkStalenessPlan,
  markChangedChunkGraphEdgesStale,
  planSynchronousTier1Refresh,
} from '../../src/graph/staleness.js';

function chunk(id: string): ParsedChunk {
  return {
    id,
    document_id: '55555555-5555-4555-8555-555555555555',
    heading_path: `Heading ${id}`,
    heading_level: 1,
    breadcrumb: `Heading ${id}`,
    content: `content ${id}`,
    content_hash: `hash-${id}`,
    chunk_index: 0,
    parent_chunk_id: null,
    embed_text: `Heading ${id}\n\ncontent ${id}`,
    source_section_heading_path: `Heading ${id}`,
    source_start_line: 1,
    source_end_line: 3,
    merged_heading_paths: [],
  };
}

describe('graph staleness helpers', () => {
  it('T-U-025 changed chunk diff plans stale marking for touching non-structural edges', () => {
    const changed = chunk('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const unchanged = chunk('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

    const plan = buildChangedChunkStalenessPlan({
      changedChunks: [changed],
      newChunks: [],
      unchangedChunks: [unchanged],
      orphanChunks: [],
      chunksNeedingEmbedding: [changed],
    });

    expect(plan.changedChunkIds).toEqual([changed.id]);
    expect(plan.markRelations).toBe('non_structural');
  });

  it('T-U-025 marks touching non-structural edges stale for the current instance only', async () => {
    const changed = chunk('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        return { rows: [] };
      }),
    };

    await markChangedChunkGraphEdgesStale(client, {
      instanceId: 'stale-instance',
      diff: {
        changedChunks: [changed],
        newChunks: [],
        unchangedChunks: [],
        orphanChunks: [],
        chunksNeedingEmbedding: [changed],
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain('UPDATE fqc_graph_edges');
    expect(calls[0]!.sql).toContain('instance_id = $1');
    expect(calls[0]!.sql).toContain("relation <> ALL($3::text[])");
    expect(calls[0]!.params).toEqual([
      'stale-instance',
      [changed.id],
      ['contains', 'references'],
    ]);
  });

  it('T-U-025 does not issue stale update when no chunks changed', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [] })),
    };

    await markChangedChunkGraphEdgesStale(client, {
      instanceId: 'stale-instance',
      diff: {
        changedChunks: [],
        newChunks: [chunk('cccccccc-cccc-4ccc-8ccc-cccccccccccc')],
        unchangedChunks: [],
        orphanChunks: [],
        chunksNeedingEmbedding: [],
      },
    });

    expect(client.query).not.toHaveBeenCalled();
  });

  it('T-U-025 keeps Tier 1 refresh synchronous and does not enqueue Tier 2 or Tier 3 work', () => {
    const changed = chunk('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

    const plan = planSynchronousTier1Refresh({
      changedChunks: [changed],
      newChunks: [],
      unchangedChunks: [],
      orphanChunks: [],
      chunksNeedingEmbedding: [changed],
    });

    expect(plan.refreshStructuralEdges).toBe(true);
    expect(plan.enqueueTier2Candidates).toBe(false);
    expect(plan.enqueueTier3Classification).toBe(false);
    expect(plan.changedChunkIds).toEqual([changed.id]);
  });
});
