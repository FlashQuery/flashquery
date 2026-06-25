import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import type { EmbeddingProvider } from '../../../src/embedding/provider.js';
import { runGraphLint } from '../../../src/graph/lint.js';
import { initLogger } from '../../../src/logging/logger.js';
import { createPgGraphQueryStore, queryGraph } from '../../../src/graph/queries.js';
import { maintainVault, resetMaintenanceStateForTests } from '../../../src/services/maintenance.js';
import { createCoreEmbeddingColumnSet, initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import { setupTestSupabase } from '../../helpers/supabase.js';
import { HAS_SUPABASE, TEST_EMBEDDING_DIMENSIONS } from '../../helpers/test-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, '../../fixtures/flashquery.test.yml');
const TEST_INSTANCE_ID = 'graph-provenance-question-test';
const EMBEDDING_NAME = 'primary';
const EMBEDDING_DIMENSIONS = Math.min(TEST_EMBEDDING_DIMENSIONS, 3);

function parseResult(result: { content: Array<{ type: 'text'; text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? '{}');
}

function configForTest(): FlashQueryConfig {
  const config = loadConfig(configPath);
  if (process.env.SUPABASE_URL) config.supabase.url = process.env.SUPABASE_URL;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) config.supabase.serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.DATABASE_URL) config.supabase.databaseUrl = process.env.DATABASE_URL;
  config.supabase.skipDdl = false;
  config.instance.id = TEST_INSTANCE_ID;
  config.embeddings = [{ name: EMBEDDING_NAME, dimensions: EMBEDDING_DIMENSIONS, endpoints: [] }];
  config.graph = {
    ...(config.graph ?? {}),
    enabled: true,
    embeddingName: EMBEDDING_NAME,
    similarityMode: 'threshold',
    similarityThreshold: 0.78,
  };
  return config;
}

async function resetPrimaryEmbeddingColumns(client: pg.Client): Promise<void> {
  for (const table of ['fqc_chunks', 'fqc_memory']) {
    await client.query(`DROP INDEX IF EXISTS ${pg.escapeIdentifier(`idx_${table}_embedding_${EMBEDDING_NAME}`)}`);
    for (const suffix of ['', '_model', '_dimensions', '_provider', '_truncated', '_indexed_at']) {
      await client.query(
        `ALTER TABLE IF EXISTS ${table} DROP COLUMN IF EXISTS ${pg.escapeIdentifier(
          `embedding_${EMBEDDING_NAME}${suffix}`
        )} CASCADE`
      );
    }
  }
}

async function insertChunk(
  client: pg.Client,
  input: { path: string; heading: string; content?: string; status?: string; embedding?: number[] }
): Promise<string> {
  const document = await client.query<{ id: string }>(
    `
    INSERT INTO fqc_documents (id, instance_id, path, title, tags, status)
    VALUES (gen_random_uuid(), $1, $2, $3, ARRAY['graph'], $4)
    RETURNING id::text AS id
    `,
    [TEST_INSTANCE_ID, input.path, input.heading, input.status ?? 'active']
  );
  const chunk = await client.query<{ id: string }>(
    `
    INSERT INTO fqc_chunks (
      id, instance_id, document_id, heading_path, heading_level, breadcrumb,
      content, content_hash, chunk_index, embedding_primary, embedding_primary_model,
      embedding_primary_dimensions, embedding_primary_provider, embedding_primary_truncated,
      embedding_primary_indexed_at
    )
    VALUES (
      gen_random_uuid(), $1, $2, $3, 1, $3, $4, md5($4), 0,
      $5::vector, 'mock-embedding', $6, 'mock-provider', false, now()
    )
    RETURNING id::text AS id
    `,
    [
      TEST_INSTANCE_ID,
      document.rows[0].id,
      input.heading,
      input.content ?? 'content',
      `[${(input.embedding ?? vector(2)).join(',')}]`,
      EMBEDDING_DIMENSIONS,
    ]
  );
  return chunk.rows[0].id;
}

function vector(activeIndex: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => (index === activeIndex ? 1 : 0));
}

function resolutionEmbeddingProvider(vector: number[]): EmbeddingProvider {
  return {
    embed: async () => vector,
    getDimensions: () => EMBEDDING_DIMENSIONS,
    getProviderInfo: () => ({ provider: 'mock-provider', model: 'mock-embedding' }),
  };
}

describe.skipIf(!HAS_SUPABASE).sequential('graph provenance and question reads', () => {
  let client: pg.Client;

  beforeAll(async () => {
    const config = configForTest();
    initLogger(config);
    client = await setupTestSupabase();
    await resetPrimaryEmbeddingColumns(client);
    await initSupabase(config);
    await createCoreEmbeddingColumnSet(config, { name: EMBEDDING_NAME, dimensions: EMBEDDING_DIMENSIONS });
  }, 90000);

  beforeEach(async () => {
    resetMaintenanceStateForTests();
    await client.query('DELETE FROM fqc_graph_lint_runs WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    await client.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  });

  afterAll(async () => {
    await client?.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqc_graph_lint_runs WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.end().catch(() => undefined);
    await supabaseManager?.close();
  });

  it('T-I-017 queries provenance and question metadata through persisted graph rows', async () => {
    const claim = await insertChunk(client, { path: '/claim.md', heading: 'Claim' });
    const extractedSource = await insertChunk(client, {
      path: '/source.md',
      heading: 'Source',
      status: 'archived',
    });
    const inferredSource = await insertChunk(client, { path: '/inferred.md', heading: 'Inferred' });

    await client.query(
      `
      INSERT INTO fqc_graph_nodes (
        chunk_id, instance_id, provenance_basis, question_status, question_resolution,
        community_id, community_label, community_summary
      )
      VALUES
        ($1, $4, NULL, 'resolved', 'Resolved by source.', 'comm-a', 'Source Cluster', 'Seeded summary'),
        ($2, $4, 'source:external', NULL, NULL, 'comm-a', 'Source Cluster', 'Seeded summary'),
        ($3, $4, 'model:inferred', NULL, NULL, NULL, NULL, NULL)
      `,
      [claim, extractedSource, inferredSource, TEST_INSTANCE_ID]
    );
    await client.query(
      `
      INSERT INTO fqc_graph_edges (
        instance_id, source_chunk_id, target_chunk_id, relation, confidence, confidence_score, reasoning, model
      )
      VALUES
        ($1, $3, $2, 'supports', 'INFERRED', 0.94, 'model support', 'mock'),
        ($1, $4, $2, 'references', 'EXTRACTED', 1.0, NULL, NULL)
      `,
      [TEST_INSTANCE_ID, claim, inferredSource, extractedSource]
    );

    const store = createPgGraphQueryStore(client);
    const nodeResult = parseResult(
      await queryGraph(store, { instance_id: TEST_INSTANCE_ID, action: 'node', chunk_id: claim })
    );
    expect(nodeResult).toMatchObject({
      data: {
        node: {
          chunk_id: claim,
          question_status: 'resolved',
          question_resolution: 'Resolved by source.',
          community_id: 'comm-a',
          community_label: 'Source Cluster',
          community_summary: 'Seeded summary',
        },
      },
    });

    const provenance = parseResult(
      await queryGraph(store, {
        instance_id: TEST_INSTANCE_ID,
        action: 'provenance_chain',
        chunk_id: claim,
        max_depth: 1,
      })
    ) as { data: { chain: Array<{ confidence: string; source: { document: { status: string } } }> } };
    expect(provenance.data.chain.map((edge) => edge.confidence)).toEqual(['EXTRACTED', 'INFERRED']);
    expect(provenance.data.chain[0]?.source.document.status).toBe('archived');

    const communityFor = parseResult(
      await queryGraph(store, { instance_id: TEST_INSTANCE_ID, action: 'community_for', chunk_id: claim })
    ) as { data: { community: { community_id: string; community_label: string | null; member_count: number } | null } };
    expect(communityFor.data.community).toMatchObject({
      community_id: 'comm-a',
      community_label: 'Source Cluster',
      member_count: 2,
    });

    const communityMembers = parseResult(
      await queryGraph(store, {
        instance_id: TEST_INSTANCE_ID,
        action: 'community_members',
        community_id: 'comm-a',
        limit: 1,
      })
    ) as { data: { members: Array<{ chunk_id: string; community_summary: string | null }> } };
    expect(communityMembers.data.members).toEqual([
      expect.objectContaining({ chunk_id: claim, community_summary: 'Seeded summary' }),
    ]);

    const communities = parseResult(
      await queryGraph(store, { instance_id: TEST_INSTANCE_ID, action: 'list_communities' })
    ) as { data: { communities: Array<{ community_id: string; community_label: string | null; member_count: number }> } };
    expect(communities.data.communities).toEqual([
      expect.objectContaining({
        community_id: 'comm-a',
        community_label: 'Source Cluster',
        member_count: 2,
      }),
    ]);
  });

  it('T-I-028 graph lint flags resolved question dependents and creates resolution-similarity resolves edges', async () => {
    const question = await insertChunk(client, { path: '/question.md', heading: 'Question' });
    const dependent = await insertChunk(client, { path: '/dependent.md', heading: 'Dependent' });
    const resolution = await insertChunk(client, {
      path: '/resolution.md',
      heading: 'Resolution',
      content: 'Credential seasoning rotation repaired the stale cache authenticator failure.',
      embedding: vector(0),
    });
    const unrelated = await insertChunk(client, {
      path: '/unrelated.md',
      heading: 'Unrelated',
      content: 'Quarterly billing invoices need a new export format.',
      embedding: vector(1),
    });

    await client.query(
      `
      INSERT INTO fqc_graph_nodes (
        chunk_id, instance_id, provenance_basis, question_status, question_resolution
      )
      VALUES
        ($1, $4, NULL, 'resolved', 'Resolved by rotating the token salt.'),
        ($2, $4, NULL, NULL, NULL),
        ($3, $4, NULL, NULL, NULL),
        ($5, $4, NULL, NULL, NULL)
      `,
      [question, dependent, resolution, TEST_INSTANCE_ID, unrelated]
    );
    await client.query(
      `
      INSERT INTO fqc_graph_edges (
        instance_id, source_chunk_id, target_chunk_id, relation, confidence, confidence_score, reasoning, model
      )
      VALUES ($1, $3, $2, 'supports', 'INFERRED', 0.91, 'dependent support', 'mock')
      `,
      [TEST_INSTANCE_ID, question, dependent]
    );

    const graphConfig = configForTest();
    const result = await runGraphLint({
      databaseUrl: graphConfig.supabase.databaseUrl,
      instanceId: TEST_INSTANCE_ID,
      rules: ['LINT-Q1'],
      graphConfig: graphConfig.graph,
      resolutionEmbeddingProvider: resolutionEmbeddingProvider(vector(0)),
    });

    expect(result.questions.items[0]).toMatchObject({
      chunk_id: question,
      question_status: 'resolved',
      downstream_impact_count: 2,
      unfolded_dependents: expect.arrayContaining([dependent, resolution]),
    });
    const edge = await client.query<{ id: string; metadata: Record<string, unknown> }>(
      `
      SELECT id::text, metadata
      FROM fqc_graph_edges
      WHERE instance_id = $1
        AND source_chunk_id = $2
        AND target_chunk_id = $3
        AND relation = 'resolves'
      `,
      [TEST_INSTANCE_ID, question, resolution]
    );
    expect(edge.rows[0]).toMatchObject({
      id: expect.any(String),
      metadata: expect.objectContaining({
        created_by: 'graph_lint_resolution_similarity',
        source: 'resolution_embedding_similarity',
      }),
    });
    const unrelatedEdge = await client.query<{ id: string }>(
      `
      SELECT id::text
      FROM fqc_graph_edges
      WHERE instance_id = $1
        AND source_chunk_id = $2
        AND target_chunk_id = $3
        AND relation = 'resolves'
      `,
      [TEST_INSTANCE_ID, question, unrelated]
    );
    expect(unrelatedEdge.rows).toHaveLength(0);
  });
});
