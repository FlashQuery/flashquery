import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { selectGraphEdgeCandidates } from '../../../src/graph/candidates.js';
import { processPendingGraphEdges, type PendingGraphEdgeRow } from '../../../src/graph/pending-worker.js';
import { DEFAULT_GRAPH_PROMPTS } from '../../../src/graph/prompts.js';
import { DEFAULT_GRAPH_RELATIONS } from '../../../src/graph/vocabulary.js';
import { initLogger } from '../../../src/logging/logger.js';
import { registerGraphTools } from '../../../src/mcp/tools/graph.js';
import { maintainVault, resetMaintenanceStateForTests } from '../../../src/services/maintenance.js';
import { initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import type { LlmClient, LlmCompletionResult } from '../../../src/llm/runtime-types.js';
import { setupTestSupabase } from '../../helpers/supabase.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, '../../fixtures/flashquery.test.yml');
const TEST_INSTANCE_ID = 'graph-pending-worker-real-it';
const LIVE_SOURCE_CHUNK_ID = '00000000-0000-4000-8000-000000000001';
const LIVE_TARGET_CHUNK_ID = '00000000-0000-4000-8000-000000000002';

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

function completion(text: string): LlmCompletionResult {
  return {
    text,
    modelName: 'real-worker-mock-model',
    providerName: 'mock-provider',
    inputTokens: 17,
    outputTokens: 23,
    latencyMs: 3,
  };
}

function nodePayload(claim: string, hash: string): string {
  return JSON.stringify({
    key_claims: [claim],
    chunk_summary: `Summary for ${claim}`,
    provenance_basis: 'source text',
    question_status: null,
    question_resolution: null,
    certainty_level: 'high',
    staleness_risk: 'low',
    external_refs: [],
    temporal_markers: [],
    analyzed_content_hash: hash,
  });
}

function edgePayload(): string {
  return JSON.stringify({
    edges: [
      {
        relation: 'contradicts',
        reasoning: 'The source claim conflicts with the target claim.',
        source_claims_referenced: [0],
        target_claims_referenced: [0],
        confidence_score: 0.91,
        metadata: {
          llm_assessment: 'strong',
          low_confidence_flag: false,
        },
      },
    ],
  });
}

function mockGraphLlm(options?: { failTargetNode?: boolean }): LlmClient {
  return {
    completeByPurpose: vi.fn(async (_purpose, _messages, _parameters, traceId) => {
      if (traceId.includes('graph-edge-classification')) return completion(edgePayload());
      const isTarget = traceId.includes(LIVE_TARGET_CHUNK_ID);
      if (options?.failTargetNode && isTarget) return completion('{"key_claims":"not-an-array"}');
      const claim = isTarget ? 'Target claim from node analysis' : 'Source claim from node analysis';
      const hash = isTarget ? 'target-hash' : 'source-hash';
      return completion(nodePayload(claim, hash));
    }),
    complete: vi.fn(),
    chat: vi.fn(),
    chatByPurpose: vi.fn(),
    chatByPurposeUnrecorded: vi.fn(),
    getModelForPurpose: vi.fn(),
  } as unknown as LlmClient;
}

interface CapturedGraphServer {
  queryGraph(params: Record<string, unknown>): Promise<unknown>;
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

function configForLiveTest(): FlashQueryConfig {
  const config = loadConfig(configPath);
  if (process.env.SUPABASE_URL) config.supabase.url = process.env.SUPABASE_URL;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) config.supabase.serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.DATABASE_URL) config.supabase.databaseUrl = process.env.DATABASE_URL;
  config.supabase.skipDdl = false;
  config.instance.id = TEST_INSTANCE_ID;
  config.embeddings = [];
  config.graph = {
    enabled: true,
    classificationPurpose: 'graph-classifier',
    resolvedRelations: DEFAULT_GRAPH_RELATIONS,
    resolvedPrompts: DEFAULT_GRAPH_PROMPTS,
  };
  return config;
}

async function insertLiveChunk(
  client: pg.Client,
  input: { slug: 'source' | 'target'; title: string; content: string }
): Promise<string> {
  const document = await client.query<{ id: string }>(
    `
    INSERT INTO fqc_documents (id, instance_id, path, title, tags, status)
    VALUES (gen_random_uuid(), $1, $2, $3, ARRAY['graph'], 'active')
    RETURNING id::text AS id
    `,
    [TEST_INSTANCE_ID, `/real-worker/${input.slug}.md`, input.title]
  );
  const chunk = await client.query<{ id: string }>(
    `
    INSERT INTO fqc_chunks (
      id, instance_id, document_id, heading_path, heading_level, breadcrumb,
      content, content_hash, chunk_index
    )
    VALUES ($5::uuid, $1, $2, $3, 1, $3, $4, $6, 0)
    RETURNING id::text AS id
    `,
    [
      TEST_INSTANCE_ID,
      document.rows[0]!.id,
      input.title,
      input.content,
      input.slug === 'source' ? LIVE_SOURCE_CHUNK_ID : LIVE_TARGET_CHUNK_ID,
      `${input.slug}-hash`,
    ]
  );
  const chunkId = chunk.rows[0]!.id;
  await client.query(
    `
    INSERT INTO fqc_graph_nodes (chunk_id, instance_id)
    VALUES ($1, $2)
    `,
    [chunkId, TEST_INSTANCE_ID]
  );
  return chunkId;
}

async function insertPendingEdge(client: pg.Client, source: string, target: string): Promise<void> {
  await client.query(
    `
    INSERT INTO fqc_pending_edges (
      id, instance_id, source_chunk_id, target_chunk_id, status, attempt_count, max_attempts, next_retry_at
    )
    VALUES (gen_random_uuid(), $1, $2, $3, 'pending', 0, 3, null)
    `,
    [TEST_INSTANCE_ID, source, target]
  );
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

describe.skipIf(!HAS_SUPABASE).sequential('graph pending edge worker real inference integration', () => {
  let client: pg.Client;
  let config: FlashQueryConfig;
  let graph: CapturedGraphServer;

  beforeAll(async () => {
    config = configForLiveTest();
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

  it('T-I-029/T-I-030/GR-024B runs real node analysis before edge classification and reads the produced edge publicly', async () => {
    const source = await insertLiveChunk(client, {
      slug: 'source',
      title: 'Real Worker Source',
      content: 'The migration is approved.',
    });
    const target = await insertLiveChunk(client, {
      slug: 'target',
      title: 'Real Worker Target',
      content: 'The migration is blocked.',
    });
    await insertPendingEdge(client, source, target);

    const llmClient = mockGraphLlm();
    const worker = await processPendingGraphEdges({
      supabase: supabaseManager.getClient(),
      instanceId: TEST_INSTANCE_ID,
      llmClient,
      graphConfig: config.graph,
      relations: DEFAULT_GRAPH_RELATIONS,
      promptVersion: 'edge-v1',
      nodePromptVersion: 'node-v1',
      now: () => new Date('2026-06-24T00:00:00.000Z'),
    });

    expect(worker).toMatchObject({ selected: 1, processed: 1, succeeded: 1, failed: 0 });

    const calls = vi.mocked(llmClient.completeByPurpose).mock.calls;
    expect(calls.map((call) => call[3])).toEqual([
      `graph-node-analysis:${source}`,
      `graph-node-analysis:${target}`,
      `graph-edge-classification:${source}:${target}`,
    ]);
    const edgePrompt = calls[2]![1][0]!.content;
    expect(edgePrompt).toContain('Classify the relationship between two document chunks using these graph types:');
    expect(edgePrompt).toContain('contradicts');
    expect(edgePrompt).toContain('Source claim from node analysis');
    expect(edgePrompt).not.toContain('{{graph:classified_types}}');

    const analyzed = await client.query<{
      chunk_id: string;
      key_claims: string[];
      analyzed_at: string | null;
      analyzed_by_model: string | null;
    }>(
      `
      SELECT chunk_id::text, key_claims, analyzed_at::text, analyzed_by_model
      FROM fqc_graph_nodes
      WHERE instance_id = $1 AND chunk_id = ANY($2::uuid[])
      ORDER BY chunk_id
      `,
      [TEST_INSTANCE_ID, [source, target]]
    );
    expect(analyzed.rows).toHaveLength(2);
    expect(analyzed.rows.every((row) => Array.isArray(row.key_claims) && row.key_claims.length === 1)).toBe(true);
    expect(analyzed.rows.every((row) => row.analyzed_at !== null && row.analyzed_by_model === 'real-worker-mock-model@node-v1')).toBe(true);

    const edge = await client.query<{
      relation: string;
      confidence: string;
      reasoning: string | null;
    }>(
      `
      SELECT relation, confidence, reasoning
      FROM fqc_graph_edges
      WHERE instance_id = $1 AND source_chunk_id = $2 AND target_chunk_id = $3
      `,
      [TEST_INSTANCE_ID, source, target]
    );
    expect(edge.rows).toEqual([
      {
        relation: 'contradicts',
        confidence: 'INFERRED',
        reasoning: 'The source claim conflicts with the target claim.',
      },
    ]);

    const contradictions = parseToolJson<{ data: { edges: Array<{ relation: string; reasoning: string | null }> } }>(
      await graph.queryGraph({ action: 'contradictions' })
    );
    expect(contradictions.data.edges).toEqual([
      expect.objectContaining({
        relation: 'contradicts',
        reasoning: 'The source claim conflicts with the target claim.',
      }),
    ]);

    const lint = await maintainVault(config, { action: 'graph_lint', rules: ['LINT-C1'] });
    expect(lint.ok).toBe(true);
    if (!lint.ok || !('actions' in lint.payload)) throw new Error('expected graph_lint action payload');
    const payload = lint.payload.actions[0]?.action === 'graph_lint' ? lint.payload.actions[0].payload : null;
    expect(payload?.contradictions.items).toEqual([
      expect.objectContaining({
        reasoning: 'The source claim conflicts with the target claim.',
      }),
    ]);
  }, 120_000);

  it('T-I-038 records dependency failure and skips edge classification when node analysis fails', async () => {
    const source = await insertLiveChunk(client, {
      slug: 'source',
      title: 'Dependency Source',
      content: 'Source dependency content.',
    });
    const target = await insertLiveChunk(client, {
      slug: 'target',
      title: 'Dependency Target',
      content: 'Target dependency content.',
    });
    await insertPendingEdge(client, source, target);

    const llmClient = mockGraphLlm({ failTargetNode: true });
    const worker = await processPendingGraphEdges({
      supabase: supabaseManager.getClient(),
      instanceId: TEST_INSTANCE_ID,
      llmClient,
      graphConfig: config.graph,
      relations: DEFAULT_GRAPH_RELATIONS,
      promptVersion: 'edge-v1',
      nodePromptVersion: 'node-v1',
      now: () => new Date('2026-06-24T00:00:00.000Z'),
    });

    expect(worker).toMatchObject({ selected: 1, processed: 1, succeeded: 0, failed: 0, skipped: 1 });
    const calls = vi.mocked(llmClient.completeByPurpose).mock.calls;
    expect(calls.map((call) => call[3])).toEqual([
      `graph-node-analysis:${source}`,
      `graph-node-analysis:${target}`,
    ]);
    expect(calls.map((call) => call[3]).some((traceId) => traceId.includes('graph-edge-classification'))).toBe(false);

    const pending = await client.query<{ status: string; result: Record<string, unknown>; attempt_count: number }>(
      `
      SELECT status, result, attempt_count
      FROM fqc_pending_edges
      WHERE instance_id = $1 AND source_chunk_id = $2 AND target_chunk_id = $3
      `,
      [TEST_INSTANCE_ID, source, target]
    );
    expect(pending.rows[0]).toMatchObject({
      status: 'dependency_failed',
      attempt_count: 0,
      result: {
        status: 'dependency_failed',
        code: 'graph_node_analysis_required',
        source_ready: true,
        target_ready: false,
      },
    });

    const edge = await client.query<{ count: string }>(
      `
      SELECT count(*)::text AS count
      FROM fqc_graph_edges
      WHERE instance_id = $1 AND source_chunk_id = $2 AND target_chunk_id = $3
      `,
      [TEST_INSTANCE_ID, source, target]
    );
    expect(Number(edge.rows[0]?.count ?? 0)).toBe(0);
  }, 120_000);
});
