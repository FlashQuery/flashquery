import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { registerGraphTools } from '../../../src/mcp/tools/graph.js';
import { initLogger } from '../../../src/logging/logger.js';
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
    await client.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  });

  afterAll(async () => {
    await client?.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.end().catch(() => undefined);
    await supabaseManager?.close();
  });

  it('T-I-008/T-I-026/T-I-036/T-I-037/T-I-042 returns bounded primitive and compound graph reads', async () => {
    const seeded = await seedGraph(client);

    const node = parseToolJson<{ data: { node: { chunk_id: string; document: { status: string } } } }>(
      await graph.queryGraph({ action: 'node', chunk_id: seeded.claim })
    );
    expect(node.data.node).toMatchObject({
      chunk_id: seeded.claim,
      document: { status: 'active' },
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

    const weakPaths = parseToolJson<{ data: { threshold: number; edges: Array<{ confidence_score: number }> } }>(
      await graph.queryGraph({ action: 'weak_paths', confidence_threshold: 0.5 })
    );
    expect(weakPaths.data.threshold).toBe(0.5);
    expect(weakPaths.data.edges).toEqual([expect.objectContaining({ confidence_score: 0.41 })]);

    const ungrounded = parseToolJson<{ data: { edges: Array<{ target: { chunk_id: string } }> } }>(
      await graph.queryGraph({ action: 'ungrounded_edges', relations: ['supports'] })
    );
    expect(ungrounded.data.edges).toEqual(
      expect.arrayContaining([expect.objectContaining({ target: expect.objectContaining({ chunk_id: seeded.isolated }) })])
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
      data: { communities: Array<{ community_id: string; member_count: number; representative_members: unknown[] }> };
    }>(await graph.queryGraph({ action: 'list_communities', min_members: 2 }));
    expect(communities.data.communities).toEqual([
      expect.objectContaining({
        community_id: 'comm-a',
        member_count: 2,
        representative_members: expect.any(Array),
      }),
    ]);
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
