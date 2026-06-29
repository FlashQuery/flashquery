import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { registerGraphTools } from '../../../src/mcp/tools/graph.js';
import { processPendingGraphEdges } from '../../../src/graph/pending-worker.js';
import type { GraphNodePayload } from '../../../src/graph/queries.js';
import { initLogger } from '../../../src/logging/logger.js';
import { maintainVault, resetMaintenanceStateForTests } from '../../../src/services/maintenance.js';
import { initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import { setupTestSupabase } from '../../helpers/supabase.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, '../../fixtures/flashquery.test.yml');
const TEST_INSTANCE_ID = 'query-graph-public-it';

interface CapturedGraphServer {
  queryGraph(params: Record<string, unknown>): Promise<unknown>;
}

interface SeededGraph {
  root: string;
  child: string;
  claim: string;
  evidence: string;
  weak: string;
  isolated: string;
}

function parseToolJson<T>(result: unknown): T {
  return JSON.parse((result as { content: Array<{ text: string }> }).content[0]!.text) as T;
}

function captureGraphServer(config: FlashQueryConfig): CapturedGraphServer {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers[name] = handler;
    },
  } as unknown as McpServer;
  registerGraphTools(server, config);
  return {
    queryGraph: (params) => handlers.query_graph!(params),
  };
}

function configForTest(graphEnabled: boolean): FlashQueryConfig {
  const config = loadConfig(configPath);
  if (process.env.SUPABASE_URL) config.supabase.url = process.env.SUPABASE_URL;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) config.supabase.serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.DATABASE_URL) config.supabase.databaseUrl = process.env.DATABASE_URL;
  config.supabase.skipDdl = false;
  config.instance.id = TEST_INSTANCE_ID;
  config.embeddings = [];
  config.graph = { enabled: graphEnabled };
  return config;
}

async function insertChunk(
  client: pg.Client,
  input: {
    path: string;
    title: string;
    heading: string;
    status?: string;
    provenanceBasis?: string | null;
    communityId?: string | null;
    communityLabel?: string | null;
    communitySummary?: string | null;
  }
): Promise<string> {
  const document = await client.query<{ id: string }>(
    `
    INSERT INTO fqc_documents (id, instance_id, path, title, tags, status)
    VALUES (gen_random_uuid(), $1, $2, $3, ARRAY['graph'], $4)
    RETURNING id::text AS id
    `,
    [TEST_INSTANCE_ID, input.path, input.title, input.status ?? 'active']
  );
  const chunk = await client.query<{ id: string }>(
    `
    INSERT INTO fqc_chunks (
      id, instance_id, document_id, heading_path, heading_level, breadcrumb,
      content, content_hash, chunk_index
    )
    VALUES (gen_random_uuid(), $1, $2, $3, 1, $3, $4, md5($4), 0)
    RETURNING id::text AS id
    `,
    [TEST_INSTANCE_ID, document.rows[0]!.id, input.heading, `content for ${input.heading}`]
  );
  const chunkId = chunk.rows[0]!.id;
  await client.query(
    `
    INSERT INTO fqc_graph_nodes (
      chunk_id, instance_id, provenance_basis, community_id, community_label, community_summary
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      chunkId,
      TEST_INSTANCE_ID,
      input.provenanceBasis ?? null,
      input.communityId ?? null,
      input.communityLabel ?? null,
      input.communitySummary ?? null,
    ]
  );
  return chunkId;
}

async function insertEdge(
  client: pg.Client,
  input: {
    source: string;
    target: string;
    relation: string;
    confidence?: 'EXTRACTED' | 'INFERRED';
    score?: number;
    status?: 'active' | 'stale';
    reasoning?: string | null;
  }
): Promise<void> {
  await client.query(
    `
    INSERT INTO fqc_graph_edges (
      instance_id, source_chunk_id, target_chunk_id, relation,
      confidence, confidence_score, reasoning, model, status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      TEST_INSTANCE_ID,
      input.source,
      input.target,
      input.relation,
      input.confidence ?? 'EXTRACTED',
      input.score ?? 1,
      input.reasoning ?? null,
      input.confidence === 'INFERRED' ? 'mock-graph-model' : null,
      input.status ?? 'active',
    ]
  );
}

async function seedGraph(client: pg.Client): Promise<SeededGraph> {
  const root = await insertChunk(client, {
    path: 'Root.md',
    title: 'Root',
    heading: 'Root',
    provenanceBasis: 'source:root',
    communityId: 'comm-a',
    communityLabel: 'Cluster A',
    communitySummary: 'Seeded cluster summary',
  });
  const child = await insertChunk(client, {
    path: 'Child.md',
    title: 'Child',
    heading: 'Child',
    provenanceBasis: 'source:child',
    communityId: 'comm-a',
    communityLabel: 'Cluster A',
    communitySummary: 'Seeded cluster summary',
  });
  const claim = await insertChunk(client, {
    path: 'Claim.md',
    title: 'Claim',
    heading: 'Claim',
    provenanceBasis: null,
  });
  const evidence = await insertChunk(client, {
    path: 'Evidence.md',
    title: 'Evidence',
    heading: 'Evidence',
    status: 'archived',
    provenanceBasis: 'source:evidence',
  });
  const weak = await insertChunk(client, {
    path: 'Weak.md',
    title: 'Weak',
    heading: 'Weak',
    provenanceBasis: 'source:weak',
  });
  const isolated = await insertChunk(client, {
    path: 'Isolated.md',
    title: 'Isolated',
    heading: 'Isolated',
    provenanceBasis: null,
  });

  await insertEdge(client, { source: root, target: child, relation: 'contains' });
  await insertEdge(client, { source: child, target: claim, relation: 'references' });
  await insertEdge(client, {
    source: evidence,
    target: claim,
    relation: 'supports',
    confidence: 'INFERRED',
    score: 0.93,
    reasoning: 'Evidence supports the claim',
  });
  await insertEdge(client, {
    source: claim,
    target: weak,
    relation: 'depends_on',
    confidence: 'INFERRED',
    score: 0.41,
    reasoning: 'Weak dependency',
  });
  await insertEdge(client, {
    source: root,
    target: claim,
    relation: 'contradicts',
    confidence: 'INFERRED',
    score: 0.82,
    status: 'stale',
    reasoning: 'Stale contradiction',
  });
  await insertEdge(client, {
    source: claim,
    target: isolated,
    relation: 'supports',
    confidence: 'INFERRED',
    score: 0.77,
    reasoning: 'Ungrounded support',
  });

  return { root, child, claim, evidence, weak, isolated };
}

describe.skipIf(!HAS_SUPABASE).sequential('query_graph public MCP integration', () => {
  let client: pg.Client;
  let graph: CapturedGraphServer;

  beforeAll(async () => {
    const config = configForTest(true);
    initLogger(config);
    await initSupabase(config);
    client = await setupTestSupabase();
    graph = captureGraphServer(config);
  }, 90_000);

  beforeEach(async () => {
    resetMaintenanceStateForTests();
    await client.query('DELETE FROM fqc_graph_lint_runs WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    await client.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  });

  afterAll(async () => {
    await client?.query('DELETE FROM fqc_graph_lint_runs WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.end().catch(() => undefined);
    await supabaseManager?.close();
  });

  it('T-I-029/T-I-030/GR-024B reads worker-produced classified edges through public graph surfaces', async () => {
    const source = await insertChunk(client, {
      path: 'Produced Source.md',
      title: 'Produced Source',
      heading: 'Produced Source',
      provenanceBasis: 'source:produced',
    });
    const target = await insertChunk(client, {
      path: 'Produced Target.md',
      title: 'Produced Target',
      heading: 'Produced Target',
      provenanceBasis: null,
    });
    await client.query(
      `
      UPDATE fqc_graph_nodes
      SET key_claims = $3::jsonb,
          analyzed_at = now(),
          analyzed_by_model = 'mock-node@v1'
      WHERE instance_id = $1 AND chunk_id = ANY($2::uuid[])
      `,
      [TEST_INSTANCE_ID, [source, target], JSON.stringify(['migration status'])]
    );
    await client.query(
      `
      INSERT INTO fqc_pending_edges (
        id, instance_id, source_chunk_id, target_chunk_id, status, attempt_count, max_attempts
      )
      VALUES (gen_random_uuid(), $1, $2, $3, 'pending', 0, 3)
      `,
      [TEST_INSTANCE_ID, source, target]
    );

    const worker = await processPendingGraphEdges({
      supabase: supabaseManager.getClient(),
      instanceId: TEST_INSTANCE_ID,
      classifyCandidate: async (row) => ({
        status: 'classified',
        written: 0,
        edges: [
          {
            sourceChunkId: row.source_chunk_id,
            targetChunkId: row.target_chunk_id,
            relation: 'contradicts',
            reasoning: 'Worker-produced edge says the source and target conflict.',
            confidenceScore: 0.91,
            sourceClaimsReferenced: [0],
            targetClaimsReferenced: [0],
            model: 'mock-graph-model',
            metadata: { produced_by: 'pending_worker_test' },
          },
        ],
      }),
    });

    expect(worker).toMatchObject({ selected: 1, processed: 1, succeeded: 1 });
    const stored = await client.query<{ count: string }>(
      `
      SELECT count(*)::text AS count
      FROM fqc_graph_edges
      WHERE instance_id = $1 AND source_chunk_id = $2 AND target_chunk_id = $3 AND relation = 'contradicts'
      `,
      [TEST_INSTANCE_ID, source, target]
    );
    expect(Number(stored.rows[0]?.count ?? 0)).toBe(1);

    const contradictions = parseToolJson<{ data: { edges: Array<{ relation: string; reasoning: string | null }> } }>(
      await graph.queryGraph({ action: 'contradictions' })
    );
    expect(contradictions.data.edges).toEqual([
      expect.objectContaining({
        relation: 'contradicts',
        reasoning: 'Worker-produced edge says the source and target conflict.',
      }),
    ]);

    const weakPaths = parseToolJson<{ data: { edges: Array<{ relation: string; confidence_score: number }> } }>(
      await graph.queryGraph({ action: 'weak_paths', confidence_threshold: 0.95 })
    );
    expect(weakPaths.data.edges).toEqual([
      expect.objectContaining({ relation: 'contradicts', confidence_score: 0.91 }),
    ]);

    const ungrounded = parseToolJson<{ data: { edges: Array<{ target: { chunk_id: string } }> } }>(
      await graph.queryGraph({ action: 'ungrounded_edges', relations: ['contradicts'] })
    );
    expect(ungrounded.data.edges).toEqual([
      expect.objectContaining({ target: expect.objectContaining({ chunk_id: target }) }),
    ]);

    const lint = await maintainVault(configForTest(true), { action: 'graph_lint', rules: ['LINT-P1', 'LINT-C1'] });
    expect(lint.ok).toBe(true);
    if (!lint.ok || !('actions' in lint.payload)) return;
    const payload = lint.payload.actions[0]?.action === 'graph_lint' ? lint.payload.actions[0].payload : null;
    expect(payload?.contradictions.items).toEqual([
      expect.objectContaining({ edge_id: expect.any(String), reasoning: 'Worker-produced edge says the source and target conflict.' }),
    ]);
    expect(payload?.provenance.ungrounded).toEqual([
      expect.objectContaining({ chunk_id: target }),
    ]);
  }, 120_000);

  it('T-I-008/T-I-026/T-I-029/T-I-030/T-I-036/T-I-037/T-I-042 returns bounded primitive and compound graph reads', async () => {
    const seeded = await seedGraph(client);

    await client.query(
      `
      UPDATE fqc_graph_nodes n
      SET key_claims = '["The root claim is grounded"]'::jsonb,
          chunk_summary = 'Root analysis summary.',
          certainty_level = 'high',
          staleness_risk = 'low',
          external_refs = '["RFC 8259"]'::jsonb,
          temporal_markers = '["Q3 2026"]'::jsonb,
          analyzed_content_hash = c.content_hash,
          analyzed_by_model = 'mock-node@v1',
          analyzed_at = '2026-06-23T00:00:00.000Z'::timestamptz
      FROM fqc_chunks c
      WHERE n.instance_id = $1 AND n.chunk_id = $2 AND c.id = n.chunk_id
      `,
      [TEST_INSTANCE_ID, seeded.root]
    );
    await client.query(
      `
      UPDATE fqc_graph_nodes
      SET analyzed_content_hash = 'stale-analysis-hash',
          analyzed_by_model = 'mock-node@v1',
          analyzed_at = '2026-06-23T00:01:00.000Z'::timestamptz
      WHERE instance_id = $1 AND chunk_id = $2
      `,
      [TEST_INSTANCE_ID, seeded.claim]
    );

    const analyzedNode = parseToolJson<{
      data: {
        node: Pick<
          GraphNodePayload,
          | 'chunk_id'
          | 'key_claims'
          | 'chunk_summary'
          | 'certainty_level'
          | 'staleness_risk'
          | 'external_refs'
          | 'temporal_markers'
          | 'analyzed_at'
          | 'analyzed_by_model'
          | 'stale'
        >;
      };
    }>(
      await graph.queryGraph({ action: 'node', chunk_id: seeded.root })
    );
    expect(analyzedNode.data.node).toMatchObject({
      chunk_id: seeded.root,
      key_claims: ['The root claim is grounded'],
      chunk_summary: 'Root analysis summary.',
      certainty_level: 'high',
      staleness_risk: 'low',
      external_refs: ['RFC 8259'],
      temporal_markers: ['Q3 2026'],
      analyzed_at: '2026-06-23T00:00:00.000Z',
      analyzed_by_model: 'mock-node@v1',
      stale: false,
    });

    const node = parseToolJson<{ data: { node: { chunk_id: string; document: { status: string }; stale: boolean } } }>(
      await graph.queryGraph({ action: 'node', chunk_id: seeded.claim })
    );
    expect(node.data.node).toMatchObject({
      chunk_id: seeded.claim,
      document: { status: 'active' },
      stale: true,
    });

    const edges = parseToolJson<{ data: { edges: Array<{ relation: string; stale: boolean }> } }>(
      await graph.queryGraph({ action: 'edges', chunk_id: seeded.claim, include_stale: true })
    );
    expect(edges.data.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: 'references', stale: false }),
      expect.objectContaining({ relation: 'supports', stale: false }),
      expect.objectContaining({ relation: 'depends_on', stale: false }),
      expect.objectContaining({ relation: 'contradicts', stale: true }),
    ]));

    const neighbors = parseToolJson<{ data: { nodes: Array<{ chunk_id: string }>; edges: Array<{ direction: string }> } }>(
      await graph.queryGraph({ action: 'neighbors', chunk_id: seeded.root, relations: ['contains'], max_depth: 1 })
    );
    expect(neighbors.data.nodes.map((entry) => entry.chunk_id)).toContain(seeded.child);
    expect(neighbors.data.edges).toEqual([expect.objectContaining({ direction: 'out' })]);

    const path = parseToolJson<{ data: { found: boolean; nodes: Array<{ chunk_id: string }> } }>(
      await graph.queryGraph({ action: 'path', from: seeded.root, to: seeded.claim, max_hops: 3 })
    );
    expect(path.data.found).toBe(true);
    expect(path.data.nodes.map((entry) => entry.chunk_id)).toEqual([seeded.root, seeded.child, seeded.claim]);

    const subgraph = parseToolJson<{ data: { nodes: Array<{ chunk_id: string }>; max_depth: number } }>(
      await graph.queryGraph({ action: 'subgraph', chunk_id: seeded.root, max_depth: 5, limit: 3 })
    );
    expect(subgraph.data.max_depth).toBe(5);
    expect(subgraph.data.nodes.length).toBeLessThanOrEqual(3);

    const stats = parseToolJson<{ data: { node_count: number; by_relation: Record<string, number> } }>(
      await graph.queryGraph({ action: 'stats' })
    );
    expect(stats.data.node_count).toBe(6);
    expect(stats.data.by_relation).toMatchObject({ contains: 1, supports: 2 });

    const archivedStats = parseToolJson<{
      data: { node_count: number; by_document_status: Record<string, number> };
    }>(
      await graph.queryGraph({ action: 'stats', document_status: 'archived' })
    );
    expect(archivedStats.data).toMatchObject({
      node_count: 1,
      by_document_status: { archived: 1 },
    });

    const schema = parseToolJson<{ data: { relations: Array<{ name: string }>; features: { enabled: boolean } } }>(
      await graph.queryGraph({ action: 'schema' })
    );
    expect(schema.data.features.enabled).toBe(true);
    expect(schema.data.relations).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'contains' })]));

    const contradictions = parseToolJson<{ data: { edges: Array<{ relation: string; stale: boolean }> } }>(
      await graph.queryGraph({ action: 'contradictions', include_resolved: true })
    );
    expect(contradictions.data.edges).toEqual([
      expect.objectContaining({ relation: 'contradicts', stale: true }),
    ]);

    const impact = parseToolJson<{ data: { root: string; edges: Array<{ direction: string }> } }>(
      await graph.queryGraph({ action: 'impact', chunk_id: seeded.root, max_depth: 2 })
    );
    expect(impact.data.root).toBe(seeded.root);
    expect(impact.data.edges.every((edge) => edge.direction === 'out')).toBe(true);

    const provenance = parseToolJson<{ data: { chain: Array<{ confidence: string; source: { chunk_id: string } }> } }>(
      await graph.queryGraph({ action: 'provenance_chain', chunk_id: seeded.claim, max_depth: 1 })
    );
    expect(provenance.data.chain.map((edge) => edge.source.chunk_id)).toEqual([
      seeded.child,
      seeded.evidence,
      seeded.root,
    ]);

    const weakPaths = parseToolJson<{
      data: {
        threshold: number;
        paths: Array<{
          nodes: Array<{ chunk_id: string }>;
          edges: Array<{ relation: string; confidence_score: number; stale: boolean }>;
          weakest_confidence_score: number;
        }>;
      };
    }>(
      await graph.queryGraph({ action: 'weak_paths', confidence_threshold: 0.5 })
    );
    expect(weakPaths.data.threshold).toBe(0.5);
    expect(weakPaths.data.paths).toEqual([
      expect.objectContaining({
        nodes: [
          expect.objectContaining({ chunk_id: seeded.claim }),
          expect.objectContaining({ chunk_id: seeded.weak }),
        ],
        edges: [
          expect.objectContaining({
            relation: 'depends_on',
            confidence_score: 0.41,
            stale: false,
          }),
        ],
        weakest_confidence_score: 0.41,
      }),
    ]);

    const ungrounded = parseToolJson<{ data: { edges: Array<{ target: { chunk_id: string } }> } }>(
      await graph.queryGraph({ action: 'ungrounded_edges', relations: ['supports'] })
    );
    expect(ungrounded.data.edges).toEqual(
      expect.arrayContaining([expect.objectContaining({ target: expect.objectContaining({ chunk_id: seeded.isolated }) })])
    );

    const ungroundedWithoutFilter = parseToolJson<{ data: { edges: Array<{ relation: string }> } }>(
      await graph.queryGraph({ action: 'ungrounded_edges' })
    );
    expect(ungroundedWithoutFilter.data.edges.map((edge) => edge.relation)).toEqual(
      expect.arrayContaining(['supports', 'depends_on'])
    );
    expect(ungroundedWithoutFilter.data.edges.map((edge) => edge.relation)).not.toEqual(
      expect.arrayContaining(['contains', 'references'])
    );
  }, 120_000);

  it('T-I-031/T-I-032/T-I-033 reads seeded community metadata through public actions', async () => {
    const seeded = await seedGraph(client);

    const communityFor = parseToolJson<{
      data: { community: { community_id: string; community_label: string | null; community_summary: string | null; member_count: number } | null };
    }>(await graph.queryGraph({ action: 'community_for', chunk_id: seeded.root }));
    expect(communityFor.data.community).toMatchObject({
      community_id: 'comm-a',
      community_label: 'Cluster A',
      community_summary: 'Seeded cluster summary',
      member_count: 2,
    });

    const members = parseToolJson<{ data: { members: Array<{ chunk_id: string; community_label: string | null }> } }>(
      await graph.queryGraph({ action: 'community_members', community_id: 'comm-a', limit: 1 })
    );
    expect(members.data.members).toHaveLength(1);
    expect(members.data.members[0]).toMatchObject({ community_label: 'Cluster A' });

    const communities = parseToolJson<{
      data: {
        communities: Array<{
          community_id: string;
          member_count: number;
          strength_score: number;
          edge_density: number;
          representative_members: unknown[];
        }>;
      };
    }>(await graph.queryGraph({ action: 'list_communities', min_members: 2 }));
    expect(communities.data.communities).toEqual([
      expect.objectContaining({
        community_id: 'comm-a',
        member_count: 2,
        strength_score: expect.any(Number),
        edge_density: expect.any(Number),
        representative_members: expect.any(Array),
      }),
    ]);
  }, 120_000);

  it('T-I-005/T-I-006/T-I-007 applies include_content defaults and overrides against live rows', async () => {
    const seeded = await seedGraph(client);

    const nodeDefault = parseToolJson<{ data: { node: GraphNodePayload } }>(
      await graph.queryGraph({ action: 'node', chunk_id: seeded.root })
    );
    expect(nodeDefault.data.node.content).toBe('content for Root');

    const nodeSuppressed = parseToolJson<{ data: { node: GraphNodePayload } }>(
      await graph.queryGraph({ action: 'node', chunk_id: seeded.root, include_content: false })
    );
    expect(nodeSuppressed.data.node).toMatchObject({
      chunk_id: seeded.root,
      content: null,
      chunk_summary: null,
    });

    const neighborsDefault = parseToolJson<{
      data: { nodes: GraphNodePayload[]; edges: Array<{ source: GraphNodePayload; target: GraphNodePayload }> };
    }>(
      await graph.queryGraph({ action: 'neighbors', chunk_id: seeded.root, max_depth: 1 })
    );
    expect(neighborsDefault.data.nodes.every((node) => node.content === null)).toBe(true);
    expect(neighborsDefault.data.edges.flatMap((edge) => [edge.source, edge.target]).every((node) => node.content === null)).toBe(true);

    const neighborsWithContent = parseToolJson<{
      data: { nodes: GraphNodePayload[]; edges: Array<{ source: GraphNodePayload; target: GraphNodePayload }> };
    }>(
      await graph.queryGraph({ action: 'neighbors', chunk_id: seeded.root, max_depth: 1, include_content: true })
    );
    expect(neighborsWithContent.data.nodes.map((node) => [node.chunk_id, node.content])).toEqual(
      expect.arrayContaining([
        [seeded.root, 'content for Root'],
        [seeded.child, 'content for Child'],
      ])
    );
    expect(neighborsWithContent.data.edges.flatMap((edge) => [edge.source.content, edge.target.content])).toEqual(
      expect.arrayContaining(['content for Root', 'content for Child'])
    );
  }, 120_000);

  it('T-I-009 returns canonical unsupported expected-error envelope when graph is disabled', async () => {
    const disabledGraph = captureGraphServer(configForTest(false));

    const result = await disabledGraph.queryGraph({ action: 'schema' });
    const payload = parseToolJson<{ error: string; details: { code: string; remediation: string } }>(result);

    expect((result as { isError?: boolean }).isError).toBe(false);
    expect(payload).toMatchObject({
      error: 'unsupported',
      details: {
        code: 'graph_disabled',
      },
    });
    expect(payload.details.remediation).toContain('Enable graph.enabled:true');
  });
});
