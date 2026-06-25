import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { runGraphLint } from '../../../src/graph/lint.js';
import { initLogger } from '../../../src/logging/logger.js';
import { recordLlmUsage, drainCostWrites } from '../../../src/llm/cost-tracker.js';
import type { LlmClient, LlmCompletionResult } from '../../../src/llm/runtime-types.js';
import { maintainVault, resetMaintenanceStateForTests } from '../../../src/services/maintenance.js';
import { initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import { setupTestSupabase } from '../../helpers/supabase.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, '../../fixtures/flashquery.test.yml');
const TEST_INSTANCE_ID = 'graph-lint-test';

function configForTest(): FlashQueryConfig {
  const config = loadConfig(configPath);
  if (process.env.SUPABASE_URL) config.supabase.url = process.env.SUPABASE_URL;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) config.supabase.serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.DATABASE_URL) config.supabase.databaseUrl = process.env.DATABASE_URL;
  config.supabase.skipDdl = false;
  config.instance.id = TEST_INSTANCE_ID;
  config.embeddings = [];
  config.graph = { ...(config.graph ?? {}), enabled: true };
  return config;
}

async function insertChunk(
  client: pg.Client,
  input: { path: string; heading: string; content?: string; status?: string }
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
      content, content_hash, chunk_index
    )
    VALUES (gen_random_uuid(), $1, $2, $3, 1, $3, $4, md5($4), 0)
    RETURNING id::text AS id
    `,
    [TEST_INSTANCE_ID, document.rows[0].id, input.heading, input.content ?? input.heading]
  );
  await client.query(
    `
    INSERT INTO fqc_graph_nodes (chunk_id, instance_id, question_status, question_resolution, provenance_basis)
    VALUES ($1, $2, NULL, NULL, NULL)
    `,
    [chunk.rows[0].id, TEST_INSTANCE_ID]
  );
  return chunk.rows[0].id;
}

async function seedGraph(client: pg.Client): Promise<{ chunks: string[] }> {
  const a = await insertChunk(client, { path: '/lint/a.md', heading: 'A', content: 'Question: should this be resolved?' });
  const b = await insertChunk(client, { path: '/lint/b.md', heading: 'B', content: 'Source evidence.' });
  const c = await insertChunk(client, { path: '/lint/c.md', heading: 'C', content: 'Duplicate evidence.' });
  const d = await insertChunk(client, { path: '/lint/d.md', heading: 'D', content: 'Divergent evidence.' });
  await client.query(
    `
    UPDATE fqc_graph_nodes
    SET question_status = 'open'
    WHERE instance_id = $1 AND chunk_id = $2
    `,
    [TEST_INSTANCE_ID, a]
  );
  await client.query(
    `
    INSERT INTO fqc_graph_edges (
      instance_id, source_chunk_id, target_chunk_id, relation, confidence, confidence_score, reasoning, model, status
    )
    VALUES
      ($1, $2, $3, 'references', 'EXTRACTED', 1.0, NULL, NULL, 'active'),
      ($1, $3, $4, 'supports', 'INFERRED', 0.88, 'support', 'mock', 'active'),
      ($1, $2, $5, 'depends_on', 'INFERRED', 0.77, 'divergent dependency', 'mock', 'active'),
      ($1, $2, $4, 'duplicates', 'INFERRED', 0.92, 'overlap', 'mock', 'active')
    `,
    [TEST_INSTANCE_ID, a, b, c, d]
  );
  return { chunks: [a, b, c, d] };
}

function duplicateGateMock(decisions: Array<'equivalent' | 'diverges'>): LlmClient {
  const result = (decision: 'equivalent' | 'diverges'): LlmCompletionResult => ({
    text: JSON.stringify({
      decision,
      confidence: decision === 'equivalent' ? 0.93 : 0.91,
      reason: decision === 'equivalent' ? 'The duplicate chunk preserves the same claim.' : 'The candidate changes the operational meaning.',
    }),
    modelName: 'graph-lint-mock',
    providerName: 'mock-provider',
    inputTokens: 12,
    outputTokens: 8,
    latencyMs: 1,
  });
  return {
    completeByPurpose: vi.fn(async (_purpose, _messages, _parameters, traceId) => {
      const completion = result(decisions.shift() ?? 'equivalent');
      recordLlmUsage({
        instanceId: TEST_INSTANCE_ID,
        purposeName: 'graph-classifier',
        modelName: completion.modelName,
        providerName: completion.providerName,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        costUsd: 0,
        latencyMs: completion.latencyMs,
        fallbackPosition: 1,
        traceId: traceId ?? null,
      });
      return { ...completion, purposeName: 'graph-classifier', fallbackPosition: 1 };
    }),
    complete: vi.fn(),
    chat: vi.fn(),
    chatByPurpose: vi.fn(),
    chatByPurposeUnrecorded: vi.fn(),
    getModelForPurpose: vi.fn(),
  } as unknown as LlmClient;
}

describe.skipIf(!HAS_SUPABASE).sequential('graph lint maintenance actions', () => {
  let client: pg.Client;
  let config: FlashQueryConfig;

  beforeAll(async () => {
    config = configForTest();
    initLogger(config);
    await initSupabase(config);
    client = await setupTestSupabase();
  }, 90000);

  beforeEach(async () => {
    resetMaintenanceStateForTests();
    await client.query('DELETE FROM fqc_graph_lint_runs WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    await client.query('DELETE FROM fqc_llm_usage WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    await client.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  });

  afterAll(async () => {
    await client?.query('DELETE FROM fqc_llm_usage WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqc_graph_lint_runs WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.end().catch(() => undefined);
    await supabaseManager?.close();
  });

  it('T-I-024 persists semantic-category findings and reports deltas across runs', async () => {
    await seedGraph(client);

    const first = await maintainVault(config, { action: 'graph_lint' });
    const second = await maintainVault(config, { action: 'graph_lint' });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok || !('actions' in first.payload) || !('actions' in second.payload)) return;
    const firstPayload = first.payload.actions[0]?.action === 'graph_lint' ? first.payload.actions[0].payload : null;
    const secondPayload = second.payload.actions[0]?.action === 'graph_lint' ? second.payload.actions[0].payload : null;

    expect(firstPayload).toMatchObject({
      questions: { items: [expect.objectContaining({ question_status: 'open' })] },
      communities: { items: [expect.objectContaining({ strength_score: expect.any(Number) })] },
      raw_findings: expect.any(Array),
    });
    expect(secondPayload?.raw_findings.some((finding) => finding.delta === 'recurring')).toBe(true);
  });

  it('T-I-034 gates duplicate edge propagation with LLM equivalence and honors dry-run', async () => {
    const { chunks } = await seedGraph(client);
    const before = await client.query<{ id: string }>(
      `
      SELECT id::text
      FROM fqc_graph_edges
      WHERE instance_id = $1
      `,
      [TEST_INSTANCE_ID]
    );
    const beforeIds = new Set(before.rows.map((row) => row.id));

    const result = await runGraphLint({
      databaseUrl: config.supabase.databaseUrl,
      instanceId: TEST_INSTANCE_ID,
      rules: ['LINT-R2'],
      graphConfig: { enabled: true, classificationPurpose: 'graph-classifier', maxClassificationJobsPerSave: 10 },
      llmClient: duplicateGateMock(['equivalent', 'diverges']),
    });
    await drainCostWrites(2_000);

    expect(result.duplicates.items[0]).toMatchObject({
      overlap_extent: 'substantial',
      edges_propagated: expect.any(Array),
      edges_skipped: expect.any(Array),
    });
    const propagated = result.duplicates.items[0]?.edges_propagated ?? [];
    expect(propagated.some((edge) => edge.new_edge_id && !beforeIds.has(edge.new_edge_id))).toBe(true);
    expect(result.duplicates.items[0]?.edges_skipped).toEqual([
      expect.objectContaining({
        reason: 'content_diverges',
        detail: 'The candidate changes the operational meaning.',
        source_edge_id: expect.any(String),
      }),
    ]);
    const created = await client.query<{ count: string }>(
      `
      SELECT count(*)::text AS count
      FROM fqc_graph_edges
      WHERE instance_id = $1
        AND source_chunk_id = $2
        AND target_chunk_id = $3
        AND relation = 'references'
        AND metadata->>'created_by' = 'graph_lint_lint_r2'
      `,
      [TEST_INSTANCE_ID, chunks[2], chunks[1]]
    );
    expect(Number(created.rows[0]?.count ?? 0)).toBe(1);

    const usage = await client.query<{ count: string }>(
      `
      SELECT count(*)::text AS count
      FROM fqc_llm_usage
      WHERE instance_id = $1
        AND purpose_name = 'graph-classifier'
        AND trace_id LIKE 'graph-lint-duplicate-equivalence:%'
      `,
      [TEST_INSTANCE_ID]
    );
    expect(Number(usage.rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(2);

    await client.query('DELETE FROM fqc_graph_edges WHERE instance_id = $1 AND metadata->>\'created_by\' = \'graph_lint_lint_r2\'', [TEST_INSTANCE_ID]);
    const dryRun = await runGraphLint({
      databaseUrl: config.supabase.databaseUrl,
      instanceId: TEST_INSTANCE_ID,
      rules: ['LINT-R2'],
      dryRun: true,
      graphConfig: { enabled: true, classificationPurpose: 'graph-classifier', maxClassificationJobsPerSave: 10 },
      llmClient: duplicateGateMock(['equivalent', 'diverges']),
    });
    expect(dryRun.duplicates.items[0]?.edges_propagated).toContainEqual(
      expect.objectContaining({ dry_run: true, new_edge_id: null })
    );
    const afterDryRun = await client.query<{ count: string }>(
      `
      SELECT count(*)::text AS count
      FROM fqc_graph_edges
      WHERE instance_id = $1
        AND metadata->>'created_by' = 'graph_lint_lint_r2'
      `,
      [TEST_INSTANCE_ID]
    );
    expect(Number(afterDryRun.rows[0]?.count ?? 0)).toBe(0);
  });

  it('deletes stale edges in non-dry-run lint and leaves them untouched during dry-run', async () => {
    const { chunks } = await seedGraph(client);
    const stale = await client.query<{ id: string }>(
      `
      INSERT INTO fqc_graph_edges (
        instance_id, source_chunk_id, target_chunk_id, relation, confidence, confidence_score, reasoning, model, status
      )
      VALUES ($1, $2, $3, 'elaborates', 'INFERRED', 0.51, 'stale', 'mock', 'stale')
      RETURNING id::text AS id
      `,
      [TEST_INSTANCE_ID, chunks[0], chunks[1]]
    );

    const dryRun = await maintainVault(config, { action: 'graph_lint', rules: ['LINT-I1'], dry_run: true });
    expect(dryRun.ok).toBe(true);
    const afterDryRun = await client.query<{ status: string }>(
      'SELECT status FROM fqc_graph_edges WHERE instance_id = $1 AND id = $2',
      [TEST_INSTANCE_ID, stale.rows[0].id]
    );
    expect(afterDryRun.rows[0]?.status).toBe('stale');

    const applied = await maintainVault(config, { action: 'graph_lint', rules: ['LINT-I1'] });
    expect(applied.ok).toBe(true);
    const afterApplied = await client.query<{ status: string }>(
      'SELECT status FROM fqc_graph_edges WHERE instance_id = $1 AND id = $2',
      [TEST_INSTANCE_ID, stale.rows[0].id]
    );
    expect(afterApplied.rows).toHaveLength(0);
  });

  it('T-I-035 returns stored semantic categories by latest and run_id without rerunning lint', async () => {
    await seedGraph(client);
    const lint = await maintainVault(config, { action: 'graph_lint' });
    expect(lint.ok).toBe(true);
    if (!lint.ok || !('actions' in lint.payload)) return;
    const runId = lint.payload.actions[0]?.action === 'graph_lint' ? lint.payload.actions[0].payload.run_id : '';

    const latest = await maintainVault(config, { action: 'graph_lint_status' });
    const byRun = await maintainVault(config, { action: 'graph_lint_status', run_id: runId });

    expect(latest.ok).toBe(true);
    expect(byRun.ok).toBe(true);
    if (!latest.ok || !byRun.ok || 'runs' in latest.payload || 'runs' in byRun.payload) return;
    expect(latest.payload.run_id).toBe(runId);
    expect(byRun.payload.questions).toMatchObject(latest.payload.questions);
  });

  it('T-I-043 lists recent run summaries and graph_lint_prune retains keep_last records', async () => {
    await seedGraph(client);
    await maintainVault(config, { action: 'graph_lint' });
    await maintainVault(config, { action: 'graph_lint' });
    await maintainVault(config, { action: 'graph_lint' });

    const list = await maintainVault(config, { action: 'graph_lint_status', limit: 2 });
    const prune = await maintainVault(config, { action: 'graph_lint_prune', keep_last: 1 });
    const after = await maintainVault(config, { action: 'graph_lint_status', limit: 10 });

    expect(list.ok).toBe(true);
    expect(prune.ok).toBe(true);
    expect(after.ok).toBe(true);
    if (!list.ok || !prune.ok || !after.ok || !('runs' in list.payload) || !('runs' in after.payload)) return;
    expect(list.payload.runs).toHaveLength(2);
    expect(list.payload.runs[0]).toMatchObject({
      run_id: expect.any(String),
      timestamp: expect.any(String),
      graph_epoch: expect.any(Number),
      counts: expect.objectContaining({ items_total: expect.any(Number) }),
    });
    expect(prune.payload.deleted).toBeGreaterThanOrEqual(2);
    expect(after.payload.runs).toHaveLength(1);
  });

  it('caps max_findings on graph_lint and graph_lint_status without changing persisted counts', async () => {
    await seedGraph(client);
    const lint = await maintainVault(config, { action: 'graph_lint', max_findings: 1 });
    const status = await maintainVault(config, { action: 'graph_lint_status', max_findings: 1 });

    expect(lint.ok).toBe(true);
    expect(status.ok).toBe(true);
    if (!lint.ok || !status.ok || !('actions' in lint.payload) || 'runs' in status.payload) return;
    const payload = lint.payload.actions[0]?.action === 'graph_lint' ? lint.payload.actions[0].payload : null;
    expect(payload?.raw_findings).toHaveLength(1);
    expect(status.payload.raw_findings).toHaveLength(1);
    expect(status.payload.counts.items_total).toBeGreaterThanOrEqual(1);
  });

  it('background graph_lint returns accepted job_id and status reports existing maintenance job', async () => {
    await seedGraph(client);
    const accepted = await maintainVault(config, { action: 'graph_lint', background: true });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok || !('job_id' in accepted.payload)) return;

    await new Promise((resolve) => setTimeout(resolve, 50));
    const status = await maintainVault(config, { action: 'graph_lint_status', job_id: accepted.payload.job_id });

    expect(status.ok).toBe(true);
    if (!status.ok || !('status' in status.payload)) return;
    expect(['running', 'completed', 'failed']).toContain(status.payload.status);
  });
});
