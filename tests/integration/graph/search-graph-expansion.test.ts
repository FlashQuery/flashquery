import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EmbeddingSearchHarness } from '../embedding/search-test-helpers.js';
import {
  addSearchDocument,
  createEmbeddingSearchHarness,
  destroyEmbeddingSearchHarness,
  parseToolJson,
} from '../embedding/search-test-helpers.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const ENTRY_PRIMARY = 'primary';

async function addGraphNode(harness: EmbeddingSearchHarness, documentId: string, input: {
  communityId?: string | null;
  communityLabel?: string | null;
} = {}): Promise<string> {
  const chunk = await harness.client.query<{ id: string }>(
    `SELECT id::text AS id FROM fqc_chunks WHERE instance_id = $1 AND document_id = $2 LIMIT 1`,
    [harness.config.instance.id, documentId]
  );
  const chunkId = chunk.rows[0]!.id;
  await harness.client.query(
    `INSERT INTO fqc_graph_nodes (chunk_id, instance_id, community_id, community_label, community_summary)
     VALUES ($1, $2, $3, $4, $4)`,
    [chunkId, harness.config.instance.id, input.communityId ?? null, input.communityLabel ?? null]
  );
  return chunkId;
}

async function addGraphEdge(harness: EmbeddingSearchHarness, input: {
  sourceChunkId: string;
  targetChunkId: string;
  relation?: string;
  confidenceScore?: number;
  status?: 'active' | 'stale';
}): Promise<void> {
  await harness.client.query(
    `INSERT INTO fqc_graph_edges (
       id, instance_id, source_chunk_id, target_chunk_id, relation, confidence, confidence_score, status
     )
     VALUES ($1, $2, $3, $4, $5, 'INFERRED', $6, $7)`,
    [
      randomUUID(),
      harness.config.instance.id,
      input.sourceChunkId,
      input.targetChunkId,
      input.relation ?? 'supports',
      input.confidenceScore ?? 0.9,
      input.status ?? 'active',
    ]
  );
}

describe.skipIf(!HAS_SUPABASE).sequential('search graph expansion integration', () => {
  let harness: EmbeddingSearchHarness | undefined;

  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1, 0, 0] }] }),
    } as Response);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (harness) {
      await destroyEmbeddingSearchHarness(harness, [ENTRY_PRIMARY]);
      harness = undefined;
    }
  });

  it('T-I-010 existing mixed search output remains backward compatible without graph params', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'search-graph-compat-it',
      entries: [{ name: ENTRY_PRIMARY }],
    });
    await addSearchDocument({
      harness,
      path: 'Seed.md',
      title: 'Seed',
      vectorByEntry: { [ENTRY_PRIMARY]: [1, 0, 0] },
    });

    const payload = parseToolJson<{ results: Array<Record<string, unknown>> }>(await harness.server.search({
      query: 'Seed',
      entity_types: ['documents'],
      mode: 'mixed',
      limit: 5,
    }));

    expect(payload.results[0]).not.toHaveProperty('graph_context');
    expect(payload.results[0]).toMatchObject({
      entity_type: 'document',
      path: 'Seed.md',
      match_source: expect.arrayContaining(['filesystem']),
    });
  }, 120_000);

  it('T-I-011 adds bounded graph-connected results with graph match attribution', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'search-graph-expanded-it',
      entries: [{ name: ENTRY_PRIMARY }],
    });
    harness.config.graph = { enabled: true };
    const seedDoc = await addSearchDocument({
      harness,
      path: 'Seed.md',
      title: 'Seed',
      vectorByEntry: { [ENTRY_PRIMARY]: [1, 0, 0] },
    });
    const connectedDoc = await addSearchDocument({
      harness,
      path: 'Connected.md',
      title: 'Connected',
      vectorByEntry: { [ENTRY_PRIMARY]: [0, 1, 0] },
    });
    const seedChunk = await addGraphNode(harness, seedDoc);
    const connectedChunk = await addGraphNode(harness, connectedDoc);
    await addGraphEdge(harness, { sourceChunkId: seedChunk, targetChunkId: connectedChunk, relation: 'supports' });

    const payload = parseToolJson<{ results: Array<{ path: string; match_source: string[]; graph_context?: { seed_chunk_id: string; relation: string } }> }>(
      await harness.server.search({
        query: 'Seed',
        entity_types: ['documents'],
        mode: 'semantic',
        limit: 5,
        graph_expand: true,
      })
    );

    const connected = payload.results.find((result) => result.path === 'Connected.md');
    expect(connected).toMatchObject({
      match_source: expect.arrayContaining(['graph']),
      graph_context: {
        seed_chunk_id: seedChunk,
        relation: 'supports',
      },
    });
  }, 120_000);

  it('T-I-012 disabled graph expansion warns without graph DB mutation', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'search-graph-disabled-it',
      entries: [{ name: ENTRY_PRIMARY }],
    });
    await addSearchDocument({
      harness,
      path: 'Seed.md',
      title: 'Seed',
      vectorByEntry: { [ENTRY_PRIMARY]: [1, 0, 0] },
    });
    const before = await harness.client.query(
      'SELECT count(*)::int AS count FROM fqc_graph_edges WHERE instance_id = $1',
      [harness.config.instance.id]
    );

    const payload = parseToolJson<{ warnings: string[]; results: Array<{ path: string }> }>(await harness.server.search({
      query: 'Seed',
      entity_types: ['documents'],
      mode: 'semantic',
      limit: 5,
      graph_expand: true,
    }));
    const after = await harness.client.query(
      'SELECT count(*)::int AS count FROM fqc_graph_edges WHERE instance_id = $1',
      [harness.config.instance.id]
    );

    expect(payload.warnings).toContain('graph_disabled');
    expect(payload.results.map((result) => result.path)).toContain('Seed.md');
    expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
  }, 120_000);

  it('T-I-038 include_community and path_to add bounded metadata without changing base results', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'search-graph-community-path-it',
      entries: [{ name: ENTRY_PRIMARY }],
    });
    harness.config.graph = { enabled: true };
    const seedDoc = await addSearchDocument({
      harness,
      path: 'Seed.md',
      title: 'Seed',
      vectorByEntry: { [ENTRY_PRIMARY]: [1, 0, 0] },
    });
    const connectedDoc = await addSearchDocument({
      harness,
      path: 'Connected.md',
      title: 'Connected',
      vectorByEntry: { [ENTRY_PRIMARY]: [0, 1, 0] },
    });
    const seedChunk = await addGraphNode(harness, seedDoc, { communityId: 'comm-a', communityLabel: 'Cluster A' });
    const connectedChunk = await addGraphNode(harness, connectedDoc, { communityId: 'comm-a', communityLabel: 'Cluster A' });
    await addGraphEdge(harness, { sourceChunkId: seedChunk, targetChunkId: connectedChunk, relation: 'supports' });

    const payload = parseToolJson<{ results: Array<{ path: string; graph_context?: { community?: { community_id: string }; path_to?: { found: boolean } } }> }>(
      await harness.server.search({
        query: 'Seed',
        entity_types: ['documents'],
        mode: 'semantic',
        limit: 5,
        graph_expand: true,
        include_community: true,
        path_to: connectedChunk,
      })
    );

    const connected = payload.results.find((result) => result.path === 'Connected.md');
    expect(connected?.graph_context).toMatchObject({
      community: { community_id: 'comm-a' },
      path_to: { found: true },
    });
  }, 120_000);
});
