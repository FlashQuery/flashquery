import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { z } from 'zod';
import type { LifecycleScope } from '../embedding/lifecycle/types.js';
import type { EmbeddingProvider } from '../embedding/provider.js';
import { parseLlmJson } from '../llm/json-repair.js';
import type { LlmClient } from '../llm/runtime-types.js';
import { createPgClientIPv4 } from '../utils/pg-client.js';
import { detectAndApplyTopologyCommunities, type DetectedCommunity } from './communities.js';
import type { GraphRuntimeConfig } from './config.js';
import { resolveGraphLlmCompletion } from './llm-analysis.js';
import {
  applyDeltas,
  capGraphLintPayload,
  stableFindingId,
  type GraphLintListPayload,
  type GraphLintPayload,
  type LintCategoryInput,
} from './lint-categories.js';

export interface GraphLintOptions {
  databaseUrl: string;
  instanceId: string;
  graphConfig?: GraphRuntimeConfig;
  llmClient?: LlmClient;
  resolutionEmbeddingProvider?: EmbeddingProvider;
  rules?: string[];
  scope?: LifecycleScope;
  dryRun?: boolean;
  maxFindings?: number;
  now?: () => Date;
  promptVersion?: string;
}

export interface GraphLintStatusOptions {
  databaseUrl: string;
  instanceId: string;
  runId?: string;
  limit?: number;
  maxFindings?: number;
}

export interface GraphLintPruneOptions {
  databaseUrl: string;
  instanceId: string;
  keepLast?: number;
  olderThan?: string;
}

interface LintNodeRow {
  chunk_id: string;
  document_id: string;
  document_path: string;
  document_status: string;
  heading_path: string;
  content: string;
  chunk_updated_at: string | null;
  provenance_basis: string | null;
  question_status: string | null;
  question_resolution: string | null;
  community_id: string | null;
  community_label: string | null;
  community_summary: string | null;
  analyzed_at: string | null;
  analyzed_by_model: string | null;
}

interface LintEdgeRow {
  id: string;
  source_chunk_id: string;
  target_chunk_id: string;
  relation: string;
  confidence: string;
  confidence_score: number;
  reasoning: string | null;
  model: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  source_status: string;
  target_status: string;
}

interface DeadLetterRow {
  id: string;
  source_chunk_id: string;
  target_chunk_id: string;
  attempt_count: number;
  max_attempts: number;
  last_error: string | null;
  result: Record<string, unknown> | null;
}

const ALL_RULES = new Set([
  'LINT-Q1',
  'LINT-P1',
  'LINT-C1',
  'LINT-R2',
  'LINT-COMMUNITY',
  'LINT-I1',
  'LINT-I3',
  'LINT-DLQ',
]);

const DuplicateEquivalenceSchema = z.object({
  decision: z.enum(['equivalent', 'diverges']),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().min(1).max(500).optional(),
});

export async function runGraphLint(options: GraphLintOptions): Promise<GraphLintPayload> {
  return await withClient(options.databaseUrl, async (client) => {
    const timestamp = (options.now ?? (() => new Date()))().toISOString();
    const runId = randomUUID();
    const scopeApplied = normalizeScope(options.scope);
    const pathPrefix = typeof scopeApplied?.path_prefix === 'string' ? scopeApplied.path_prefix : undefined;
    const selectedRules = new Set(options.rules ?? ALL_RULES);
    const previous = await loadLatestPayload(client, options.instanceId);
    const previousFindingIds = new Set(previous?.raw_findings.map((finding) => finding.finding_id) ?? []);
    const runWarnings: string[] = [];

    const communities = selectedRules.has('LINT-COMMUNITY')
      ? await detectAndApplyTopologyCommunities({
          client,
          instanceId: options.instanceId,
          pathPrefix,
          dryRun: options.dryRun === true,
        })
      : [];
    const nodes = await loadLintNodes(client, options.instanceId, pathPrefix);
    if (selectedRules.has('LINT-Q1') && options.dryRun !== true) {
      runWarnings.push(
        ...(await applyResolutionSimilarityEdges(client, options.instanceId, nodes, {
          graphConfig: options.graphConfig,
          embeddingProvider: options.resolutionEmbeddingProvider,
        }))
      );
    }
    const edges = await loadLintEdges(client, options.instanceId, pathPrefix);
    const deadLetters = await loadDeadLetters(client, options.instanceId);
    const duplicatePropagation = selectedRules.has('LINT-R2')
      ? await applyDuplicateEdgePropagation(client, options.instanceId, nodes, edges, {
          dryRun: options.dryRun === true,
          graphConfig: options.graphConfig,
          llmClient: options.llmClient,
          warnings: runWarnings,
        })
      : new Map<string, DuplicatePropagationReport>();

    const categoryFindings = {
      questions: selectedRules.has('LINT-Q1') ? questionFindings(nodes, edges, new Date(timestamp)) : [],
      provenance: selectedRules.has('LINT-P1') ? provenanceFindings(nodes, edges) : [],
      contradictions: selectedRules.has('LINT-C1') ? contradictionFindings(nodes, edges) : [],
      duplicates: selectedRules.has('LINT-R2') ? duplicateFindings(nodes, edges, duplicatePropagation) : [],
      communities: selectedRules.has('LINT-COMMUNITY') ? communityFindings(communities) : [],
      integrity: [
        ...(selectedRules.has('LINT-I1') ? integrityFindings(edges, options.dryRun === true) : []),
        ...(selectedRules.has('LINT-I3') && options.promptVersion
          ? promptStalenessFindings(nodes, options.promptVersion)
          : []),
        ...(selectedRules.has('LINT-DLQ') ? deadLetterFindings(deadLetters) : []),
      ],
    };

    const applied = {
      questions: applyDeltas(categoryFindings.questions, previousFindingIds),
      provenance: applyDeltas(categoryFindings.provenance, previousFindingIds),
      contradictions: applyDeltas(categoryFindings.contradictions, previousFindingIds),
      duplicates: applyDeltas(categoryFindings.duplicates, previousFindingIds),
      communities: applyDeltas(categoryFindings.communities, previousFindingIds),
      integrity: applyDeltas(categoryFindings.integrity, previousFindingIds),
    };
    const rawFindings = [
      ...applied.questions.raw,
      ...applied.provenance.raw,
      ...applied.contradictions.raw,
      ...applied.duplicates.raw,
      ...applied.communities.raw,
      ...applied.integrity.raw,
    ];
    const currentIds = new Set(rawFindings.map((finding) => finding.finding_id));
    const itemsResolved = [...previousFindingIds].filter((id) => !currentIds.has(id)).length;
    const itemsNew = Object.values(applied).reduce((sum, category) => sum + category.newCount, 0);
    const graphEpoch = await graphEpochFor(client, options.instanceId);
    const payload: GraphLintPayload = {
      run_id: runId,
      timestamp,
      graph_epoch: graphEpoch,
      scope_applied: scopeApplied,
      counts: {
        chunks_scanned: nodes.length,
        edges_traversed: edges.length,
        items_total: rawFindings.length,
        items_new: itemsNew,
        items_resolved: itemsResolved,
      },
      questions: {
        summary: summarizeQuestions(applied.questions.items),
        items: applied.questions.items,
      },
      provenance: {
        summary: {
          unclassified_terminus_count: applied.provenance.items.filter((item) => item.kind === 'ungrounded').length,
          load_bearing_unclassified_count: applied.provenance.items.filter((item) => item.kind === 'ungrounded').length,
          shallow_chain_count: applied.provenance.items.filter((item) => item.kind === 'shallow_chain').length,
          weak_chain_count: applied.provenance.items.filter((item) => item.kind === 'weak_chain').length,
        },
        items: applied.provenance.items,
        ungrounded: applied.provenance.items.filter((item) => item.kind === 'ungrounded'),
        shallow_chains: applied.provenance.items.filter((item) => item.kind === 'shallow_chain'),
        weak_chains: applied.provenance.items.filter((item) => item.kind === 'weak_chain'),
      },
      contradictions: {
        summary: {
          total: applied.contradictions.items.length,
          fresh_count: applied.contradictions.items.filter((item) => item.stale !== true).length,
          stale_count: applied.contradictions.items.filter((item) => item.stale === true).length,
          cross_document_count: applied.contradictions.items.filter((item) => item.same_document !== true).length,
          same_document_count: applied.contradictions.items.filter((item) => item.same_document === true).length,
        },
        items: applied.contradictions.items,
      },
      duplicates: {
        summary: {
          duplicate_pair_count: applied.duplicates.items.length,
          edges_propagated_count: applied.duplicates.items.reduce((sum, item) => sum + arrayLength(item.edges_propagated), 0),
          edges_skipped_count: applied.duplicates.items.reduce((sum, item) => sum + arrayLength(item.edges_skipped), 0),
        },
        items: applied.duplicates.items,
      },
      communities: {
        summary: summarizeCommunities(applied.communities.items),
        items: applied.communities.items,
      },
      integrity: {
        summary: {
          fixes_applied_count: options.dryRun === true ? 0 : applied.integrity.items.length,
        },
        items: applied.integrity.items,
      },
      raw_findings: rawFindings,
      warnings: lintWarnings(deadLetters, selectedRules, options.dryRun === true, runWarnings),
    };

    if (options.dryRun !== true) {
      await clearStaleEdges(client, options.instanceId, applied.integrity.items);
      await persistGraphLintRun(client, options.instanceId, payload);
    }

    return capGraphLintPayload(payload, options.maxFindings);
  });
}

export async function getGraphLintStatus(
  options: GraphLintStatusOptions
): Promise<GraphLintPayload | GraphLintListPayload> {
  return await withClient(options.databaseUrl, async (client) => {
    if (options.limit !== undefined && options.runId !== undefined) {
      throw new Error('run_id and limit are mutually exclusive for graph_lint_status');
    }
    if (options.limit !== undefined) {
      const limit = Math.min(Math.max(1, options.limit), 50);
      const result = await client.query<{
        run_id: string;
        timestamp: string;
        graph_epoch: string;
        counts: GraphLintPayload['counts'];
      }>(
        `
        SELECT run_id::text, timestamp::text, graph_epoch::text, counts
        FROM fqc_graph_lint_runs
        WHERE instance_id = $1
        ORDER BY timestamp DESC
        LIMIT $2
        `,
        [options.instanceId, limit]
      );
      return {
        runs: result.rows.map((row) => ({
          run_id: row.run_id,
          timestamp: row.timestamp,
          graph_epoch: Number(row.graph_epoch),
          counts: row.counts,
        })),
      };
    }

    const params = options.runId === undefined ? [options.instanceId] : [options.instanceId, options.runId];
    const result = await client.query<{ payload: GraphLintPayload }>(
      `
      SELECT payload
      FROM fqc_graph_lint_runs
      WHERE instance_id = $1
        ${options.runId === undefined ? '' : 'AND run_id = $2::uuid'}
      ORDER BY timestamp DESC
      LIMIT 1
      `,
      params
    );
    const payload = result.rows[0]?.payload;
    if (!payload) {
      throw new Error(options.runId === undefined ? 'No graph lint runs found' : `No graph lint run found for ${options.runId}`);
    }
    return capGraphLintPayload(payload, options.maxFindings);
  });
}

export async function pruneGraphLintRuns(options: GraphLintPruneOptions): Promise<{
  deleted: number;
  keep_last?: number;
  older_than?: string;
}> {
  if (options.keepLast === undefined && options.olderThan === undefined) {
    throw new Error('graph_lint_prune requires keep_last or older_than');
  }
  return await withClient(options.databaseUrl, async (client) => {
    let deleted = 0;
    if (options.olderThan !== undefined) {
      const result = await client.query<{ id: string }>(
        `
        DELETE FROM fqc_graph_lint_runs
        WHERE instance_id = $1
          AND timestamp < $2::timestamptz
        RETURNING id
        `,
        [options.instanceId, options.olderThan]
      );
      deleted += result.rows.length;
    }
    if (options.keepLast !== undefined) {
      const result = await client.query<{ id: string }>(
        `
        DELETE FROM fqc_graph_lint_runs
        WHERE instance_id = $1
          AND id IN (
            SELECT id
            FROM fqc_graph_lint_runs
            WHERE instance_id = $1
            ORDER BY timestamp DESC
            OFFSET $2
          )
        RETURNING id
        `,
        [options.instanceId, Math.max(0, options.keepLast)]
      );
      deleted += result.rows.length;
    }
    return {
      deleted,
      ...(options.keepLast === undefined ? {} : { keep_last: options.keepLast }),
      ...(options.olderThan === undefined ? {} : { older_than: options.olderThan }),
    };
  });
}

async function withClient<T>(databaseUrl: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = createPgClientIPv4(databaseUrl);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function loadLatestPayload(client: pg.Client, instanceId: string): Promise<GraphLintPayload | null> {
  const result = await client.query<{ payload: GraphLintPayload }>(
    `
    SELECT payload
    FROM fqc_graph_lint_runs
    WHERE instance_id = $1
    ORDER BY timestamp DESC
    LIMIT 1
    `,
    [instanceId]
  );
  return result.rows[0]?.payload ?? null;
}

async function persistGraphLintRun(
  client: pg.Client,
  instanceId: string,
  payload: GraphLintPayload
): Promise<void> {
  await client.query(
    `
    INSERT INTO fqc_graph_lint_runs (instance_id, run_id, graph_epoch, timestamp, scope, counts, payload)
    VALUES ($1, $2::uuid, $3, $4::timestamptz, $5::jsonb, $6::jsonb, $7::jsonb)
    `,
    [
      instanceId,
      payload.run_id,
      payload.graph_epoch,
      payload.timestamp,
      payload.scope_applied === null ? null : JSON.stringify(payload.scope_applied),
      JSON.stringify(payload.counts),
      JSON.stringify(payload),
    ]
  );
}

async function loadLintNodes(client: pg.Client, instanceId: string, pathPrefix?: string): Promise<LintNodeRow[]> {
  const result = await client.query<LintNodeRow>(
    `
    SELECT
      n.chunk_id::text,
      d.id::text AS document_id,
      d.path AS document_path,
      COALESCE(d.status, 'active') AS document_status,
      c.heading_path,
      c.content,
      c.updated_at::text AS chunk_updated_at,
      n.provenance_basis,
      n.question_status,
      n.question_resolution,
      n.community_id,
      n.community_label,
      n.community_summary,
      n.analyzed_at::text,
      n.analyzed_by_model
    FROM fqc_graph_nodes n
    JOIN fqc_chunks c ON c.id = n.chunk_id
    JOIN fqc_documents d ON d.id = c.document_id
    WHERE n.instance_id = $1
      AND ($2::text IS NULL OR d.path LIKE $2::text || '%')
    ORDER BY d.path, c.chunk_index
    `,
    [instanceId, pathPrefix ?? null]
  );
  return result.rows;
}

async function loadLintEdges(client: pg.Client, instanceId: string, pathPrefix?: string): Promise<LintEdgeRow[]> {
  const result = await client.query<LintEdgeRow>(
    `
    SELECT
      e.id::text,
      e.source_chunk_id::text,
      e.target_chunk_id::text,
      e.relation,
      e.confidence,
      e.confidence_score,
      e.reasoning,
      e.model,
      e.status,
      e.metadata,
      COALESCE(sd.status, 'active') AS source_status,
      COALESCE(td.status, 'active') AS target_status
    FROM fqc_graph_edges e
    JOIN fqc_chunks sc ON sc.id = e.source_chunk_id
    JOIN fqc_documents sd ON sd.id = sc.document_id
    JOIN fqc_chunks tc ON tc.id = e.target_chunk_id
    JOIN fqc_documents td ON td.id = tc.document_id
    WHERE e.instance_id = $1
      AND ($2::text IS NULL OR sd.path LIKE $2::text || '%' OR td.path LIKE $2::text || '%')
    ORDER BY e.created_at, e.id
    `,
    [instanceId, pathPrefix ?? null]
  );
  return result.rows.filter((edge) => !(edge.source_status !== 'active' && edge.target_status !== 'active'));
}

async function loadDeadLetters(client: pg.Client, instanceId: string): Promise<DeadLetterRow[]> {
  const result = await client.query<DeadLetterRow>(
    `
    SELECT id::text, source_chunk_id::text, target_chunk_id::text, attempt_count, max_attempts, last_error, result
    FROM fqc_pending_edges
    WHERE instance_id = $1
      AND status = 'dead_letter'
    ORDER BY updated_at DESC
    LIMIT 50
    `,
    [instanceId]
  );
  return result.rows;
}

async function graphEpochFor(client: pg.Client, instanceId: string): Promise<number> {
  const result = await client.query<{ epoch: string }>(
    `
    SELECT (
      (SELECT count(*) FROM fqc_graph_nodes WHERE instance_id = $1) +
      (SELECT count(*) FROM fqc_graph_edges WHERE instance_id = $1) +
      (SELECT count(*) FROM fqc_pending_edges WHERE instance_id = $1)
    )::text AS epoch
    `,
    [instanceId]
  );
  return Number(result.rows[0]?.epoch ?? 0);
}

async function clearStaleEdges(client: pg.Client, instanceId: string, integrityItems: Array<Record<string, unknown>>): Promise<void> {
  const edgeIds = integrityItems
    .filter((item) => item.fix_type === 'stale_edge_cleared' && item.applied === true)
    .map((item) => item.affected_id)
    .filter(isString);
  if (edgeIds.length === 0) return;
  await client.query(
    `
    DELETE FROM fqc_graph_edges
    WHERE instance_id = $1
      AND id = ANY($2::uuid[])
      AND status = 'stale'
    `,
    [instanceId, edgeIds]
  );
}

interface DuplicatePropagationReport {
  propagated: Array<{
    direction: string;
    relation: string;
    other_chunk_id: string;
    new_edge_id: string | null;
    dry_run?: boolean;
  }>;
  skipped: Array<{
    reason: string;
    relation?: string;
    other_chunk_id?: string;
    source_edge_id?: string;
    detail?: string;
  }>;
}

async function applyDuplicateEdgePropagation(
  client: pg.Client,
  instanceId: string,
  nodes: LintNodeRow[],
  edges: LintEdgeRow[],
  options: {
    dryRun: boolean;
    graphConfig?: GraphRuntimeConfig;
    llmClient?: LlmClient;
    warnings: string[];
  }
): Promise<Map<string, DuplicatePropagationReport>> {
  const reports = new Map<string, DuplicatePropagationReport>();
  const byChunk = new Map(nodes.map((node) => [node.chunk_id, node]));
  const knownNodes = new Set(nodes.map((node) => node.chunk_id));
  const existing = new Set(edges.map((edge) => edgeKey(edge.source_chunk_id, edge.target_chunk_id, edge.relation)));
  const duplicates = edges.filter((edge) => edge.relation === 'duplicates' && edge.status === 'active');
  const costCap = Math.max(0, options.graphConfig?.maxClassificationJobsPerSave ?? 10);
  let llmCalls = 0;

  for (const duplicate of duplicates) {
    const report: DuplicatePropagationReport = { propagated: [], skipped: [] };
    reports.set(duplicate.id, report);
    const pairs = [
      { from: duplicate.source_chunk_id, to: duplicate.target_chunk_id },
      { from: duplicate.target_chunk_id, to: duplicate.source_chunk_id },
    ];
    for (const pair of pairs) {
      const sourceEdges = edges.filter((edge) => edge.relation !== 'duplicates' && edge.status === 'active' && (edge.source_chunk_id === pair.from || edge.target_chunk_id === pair.from));
      for (const sourceEdge of sourceEdges) {
        const sourceIsFrom = sourceEdge.source_chunk_id === pair.from;
        const newSource = sourceIsFrom ? pair.to : sourceEdge.source_chunk_id;
        const newTarget = sourceIsFrom ? sourceEdge.target_chunk_id : pair.to;
        const otherChunkId = sourceIsFrom ? sourceEdge.target_chunk_id : sourceEdge.source_chunk_id;
        if (newSource === newTarget || otherChunkId === pair.to || !knownNodes.has(newSource) || !knownNodes.has(newTarget)) continue;
        const key = edgeKey(newSource, newTarget, sourceEdge.relation);
        if (existing.has(key)) continue;
        if (!options.llmClient || !options.graphConfig || (!options.graphConfig.classificationPurpose && !options.graphConfig.classificationModel)) {
          report.skipped.push({
            reason: 'missing_llm_equivalence_gate',
            relation: sourceEdge.relation,
            other_chunk_id: otherChunkId,
            source_edge_id: sourceEdge.id,
          });
          addWarningOnce(options.warnings, 'graph_lint_duplicate_propagation_skipped_missing_llm_gate');
          continue;
        }
        if (llmCalls >= costCap) {
          report.skipped.push({
            reason: 'cost_cap_reached',
            relation: sourceEdge.relation,
            other_chunk_id: otherChunkId,
            source_edge_id: sourceEdge.id,
          });
          addWarningOnce(options.warnings, 'graph_lint_duplicate_propagation_cost_cap_reached');
          continue;
        }
        llmCalls += 1;
        const gate = await evaluateDuplicatePropagationGate({
          llmClient: options.llmClient,
          graphConfig: options.graphConfig,
          duplicate,
          fromNode: byChunk.get(pair.from),
          toNode: byChunk.get(pair.to),
          otherNode: byChunk.get(otherChunkId),
          sourceEdge,
        });
        if (gate.decision !== 'equivalent') {
          report.skipped.push({
            reason: 'content_diverges',
            relation: sourceEdge.relation,
            other_chunk_id: otherChunkId,
            source_edge_id: sourceEdge.id,
            ...(gate.reason ? { detail: gate.reason } : {}),
          });
          continue;
        }
        existing.add(key);
        if (options.dryRun) {
          report.propagated.push({
            direction: sourceIsFrom ? 'out' : 'in',
            relation: sourceEdge.relation,
            other_chunk_id: otherChunkId,
            new_edge_id: null,
            dry_run: true,
          });
          continue;
        }
        const inserted = await client.query<{ id: string }>(
          `
          INSERT INTO fqc_graph_edges (
            instance_id, source_chunk_id, target_chunk_id, relation, confidence, confidence_score,
            reasoning, model, status, metadata
          )
          VALUES ($1, $2::uuid, $3::uuid, $4, 'INFERRED', $5, $6, $7, 'active', $8::jsonb)
          ON CONFLICT DO NOTHING
          RETURNING id::text AS id
          `,
          [
            instanceId,
            newSource,
            newTarget,
            sourceEdge.relation,
            Math.min(sourceEdge.confidence_score, duplicate.confidence_score),
            sourceEdge.reasoning ?? 'Propagated across duplicate chunks by graph lint.',
            sourceEdge.model ?? 'graph_lint',
            JSON.stringify({
              created_by: 'graph_lint_lint_r2',
              duplicate_edge_id: duplicate.id,
              propagated_from_edge_id: sourceEdge.id,
              propagation_gate: 'content_equivalent',
              propagation_gate_reason: gate.reason ?? null,
              propagation_gate_confidence: gate.confidence ?? null,
            }),
          ]
        );
        const newEdgeId = inserted.rows[0]?.id ?? null;
        if (newEdgeId) {
          report.propagated.push({
            direction: sourceIsFrom ? 'out' : 'in',
            relation: sourceEdge.relation,
            other_chunk_id: otherChunkId,
            new_edge_id: newEdgeId,
          });
        }
      }
    }
    if (report.propagated.length === 0 && report.skipped.length === 0) {
      report.skipped.push({ reason: 'no_supported_edges_to_propagate' });
    }
  }
  return reports;
}

async function applyResolutionSimilarityEdges(
  client: pg.Client,
  instanceId: string,
  nodes: LintNodeRow[],
  options: { graphConfig?: GraphRuntimeConfig; embeddingProvider?: EmbeddingProvider }
): Promise<string[]> {
  const warnings: string[] = [];
  const resolvedQuestions = nodes.filter((node) => node.question_status === 'resolved' && node.question_resolution);
  if (resolvedQuestions.length === 0) return warnings;
  const embeddingName = options.graphConfig?.embeddingName;
  if (!embeddingName || !options.embeddingProvider) {
    warnings.push('graph_lint_resolution_similarity_skipped_missing_embedding');
    return warnings;
  }
  const threshold = options.graphConfig?.similarityThreshold ?? 0.78;
  const matchCount = Math.max(5, options.graphConfig?.maxClassificationJobsPerSave ?? 10);
  for (const question of resolvedQuestions) {
    const queryVector = await options.embeddingProvider.embed(question.question_resolution ?? '');
    const candidates = await matchResolutionChunks(client, {
      embeddingName,
      instanceId,
      queryVector,
      threshold,
      matchCount,
      excludeChunkId: question.chunk_id,
      allowedChunkIds: new Set(nodes.map((node) => node.chunk_id)),
    });
    for (const candidate of candidates) {
      await client.query(
        `
        INSERT INTO fqc_graph_edges (
          instance_id, source_chunk_id, target_chunk_id, relation, confidence, confidence_score,
          reasoning, model, status, metadata
        )
        VALUES ($1, $2::uuid, $3::uuid, 'resolves', 'INFERRED', $4, $5, 'graph_lint', 'active', $6::jsonb)
        ON CONFLICT DO NOTHING
        `,
        [
          instanceId,
          question.chunk_id,
          candidate.chunk_id,
          candidate.similarity,
          'Resolution text matched candidate chunk embedding during graph lint.',
          JSON.stringify({
            created_by: 'graph_lint_resolution_similarity',
            source: 'resolution_embedding_similarity',
            embedding_name: embeddingName,
          }),
        ]
      );
    }
  }
  return warnings;
}

async function evaluateDuplicatePropagationGate(options: {
  llmClient: LlmClient;
  graphConfig: GraphRuntimeConfig;
  duplicate: LintEdgeRow;
  fromNode?: LintNodeRow;
  toNode?: LintNodeRow;
  otherNode?: LintNodeRow;
  sourceEdge: LintEdgeRow;
}): Promise<{ decision: 'equivalent' | 'diverges'; confidence?: number; reason?: string }> {
  const traceId = `graph-lint-duplicate-equivalence:${options.duplicate.id}:${options.sourceEdge.id}:${options.toNode?.chunk_id ?? 'unknown'}`;
  const completion = await resolveGraphLlmCompletion({
    llmClient: options.llmClient,
    graphConfig: options.graphConfig,
    traceId,
    messages: [
      {
        role: 'system',
        content:
          'Decide whether a duplicate chunk is content-equivalent enough to inherit one graph edge. Return only JSON with decision, confidence, and reason.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          duplicate_edge_id: options.duplicate.id,
          source_edge: {
            id: options.sourceEdge.id,
            relation: options.sourceEdge.relation,
            reasoning: options.sourceEdge.reasoning,
            confidence_score: options.sourceEdge.confidence_score,
          },
          original_duplicate_chunk: nodeGatePayload(options.fromNode),
          inheriting_duplicate_chunk: nodeGatePayload(options.toNode),
          edge_other_chunk: nodeGatePayload(options.otherNode),
        }),
      },
    ],
    parameters: { temperature: 0 },
  });
  if (!completion.ok) {
    return { decision: 'diverges', reason: 'Graph LLM resolver unavailable for duplicate propagation.' };
  }
  const parsed = parseLlmJson(completion.text, DuplicateEquivalenceSchema);
  if (!parsed.ok) {
    return { decision: 'diverges', reason: 'Graph LLM equivalence response did not match schema.' };
  }
  return parsed.data;
}

function nodeGatePayload(node: LintNodeRow | undefined): Record<string, unknown> | null {
  if (!node) return null;
  return {
    chunk_id: node.chunk_id,
    document_path: node.document_path,
    heading_path: node.heading_path,
    content: excerpt(node.content, 1_200),
    provenance_basis: node.provenance_basis,
    question_status: node.question_status,
    question_resolution: node.question_resolution,
  };
}

async function matchResolutionChunks(
  client: pg.Client,
  input: {
    embeddingName: string;
    instanceId: string;
    queryVector: number[];
    threshold: number;
    matchCount: number;
    excludeChunkId: string;
    allowedChunkIds: Set<string>;
  }
): Promise<Array<{ chunk_id: string; similarity: number }>> {
  const rpcName = pg.escapeIdentifier(`match_chunks_${input.embeddingName}`);
  // Use named-argument invocation (matching the Supabase `.rpc()` convention in
  // src/graph/candidates.ts) so this call stays resilient to RPC signature
  // reordering/additions; trailing params (filter_tags, filter_tag_match,
  // include_archived) keep their function defaults.
  const result = await client.query<{ chunk_id: string; similarity: number }>(
    `
    SELECT chunk_id::text AS chunk_id, similarity::float AS similarity
    FROM ${rpcName}(
      query_embedding => $1::vector,
      match_threshold => $2::double precision,
      match_count => $3::integer,
      filter_instance_id => $4::text
    )
    `,
    [vectorRpcArgument(input.queryVector), input.threshold, input.matchCount, input.instanceId]
  );
  return result.rows.filter(
    (row) =>
      row.chunk_id !== input.excludeChunkId &&
      input.allowedChunkIds.has(row.chunk_id) &&
      Number.isFinite(row.similarity) &&
      row.similarity >= input.threshold
  );
}

function vectorRpcArgument(value: number[]): string {
  return `[${value.join(',')}]`;
}

function addWarningOnce(warnings: string[], warning: string): void {
  if (!warnings.includes(warning)) warnings.push(warning);
}

function questionFindings(nodes: LintNodeRow[], edges: LintEdgeRow[], now = new Date()): LintCategoryInput[] {
  const byChunk = new Map(nodes.map((node) => [node.chunk_id, node]));
  return nodes
    .filter((node) => node.question_status === 'open' || node.question_status === 'deferred' || node.question_status === 'resolved')
    .map((node) => {
      const dependents = edges
        .filter((edge) => edge.target_chunk_id === node.chunk_id || edge.source_chunk_id === node.chunk_id)
        .map((edge) => edge.source_chunk_id === node.chunk_id ? edge.target_chunk_id : edge.source_chunk_id);
      const resolutionTime = parseResolutionTime(node.question_resolution);
      const unchangedDependents = resolutionTime
        ? dependents.filter((id) => {
            const dependent = byChunk.get(id);
            if (!dependent?.chunk_updated_at) return false;
            const updatedAt = new Date(dependent.chunk_updated_at).getTime();
            return Number.isFinite(updatedAt) && updatedAt <= resolutionTime.getTime();
          })
        : [];
      return {
        rule: 'LINT-Q1',
        severity: node.question_status === 'resolved' ? 'info' : 'attention',
        stableParts: ['question', node.chunk_id, node.question_status],
        summary: `Question ${node.question_status} in ${node.document_path}`,
        chunkIds: [node.chunk_id],
        documentIds: [node.document_id],
        item: {
          chunk_id: node.chunk_id,
          document_id: node.document_id,
          document_path: node.document_path,
          heading_path: node.heading_path,
          excerpt: excerpt(node.content),
          question_status: node.question_status,
          age_days: ageDays(node.analyzed_at, now),
          community_id: node.community_id,
          community_label: node.community_label,
          downstream_impact_count: dependents.length,
          dependent_chunk_ids: dependents,
          stale: unchangedDependents.length > 0 || dependents.some((id) => edges.some((edge) => edge.status === 'stale' && (edge.source_chunk_id === id || edge.target_chunk_id === id))),
          follow_up_required_chunk_ids: unchangedDependents,
          unfolded_dependents: node.question_status === 'resolved' ? dependents : [],
        },
      };
    });
}

interface ProvenanceChainRecord {
  kind: 'shallow_chain' | 'weak_chain';
  chain_depth: number;
  chain: Array<Record<string, unknown>>;
  chunk_ids: string[];
  edge_ids: string[];
  terminus_chunk_id?: string;
  terminus_classified?: boolean;
  weakest_edge?: string;
  weakest_confidence_score?: number;
}

function buildProvenanceChains(nodes: LintNodeRow[], edges: LintEdgeRow[], weakThreshold = 0.7): {
  shallowChains: ProvenanceChainRecord[];
  weakChains: ProvenanceChainRecord[];
} {
  const byChunk = new Map(nodes.map((node) => [node.chunk_id, node]));
  const outgoing = new Map<string, LintEdgeRow[]>();
  for (const edge of edges.filter((candidate) => candidate.confidence === 'INFERRED' && candidate.status === 'active')) {
    const list = outgoing.get(edge.source_chunk_id) ?? [];
    list.push(edge);
    outgoing.set(edge.source_chunk_id, list);
  }
  const shallowChains: ProvenanceChainRecord[] = [];
  const weakChains: ProvenanceChainRecord[] = [];
  const seenShallow = new Set<string>();
  const seenWeak = new Set<string>();
  for (const root of nodes) {
    const queue: Array<{ chunkId: string; chunkIds: string[]; edgeIds: string[]; edgeRows: LintEdgeRow[] }> = [
      { chunkId: root.chunk_id, chunkIds: [root.chunk_id], edgeIds: [], edgeRows: [] },
    ];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || current.edgeIds.length >= 4) continue;
      for (const edge of outgoing.get(current.chunkId) ?? []) {
        if (current.chunkIds.includes(edge.target_chunk_id)) continue;
        const chunkIds = [...current.chunkIds, edge.target_chunk_id];
        const edgeIds = [...current.edgeIds, edge.id];
        const edgeRows = [...current.edgeRows, edge];
        const chain = alternatingChain(chunkIds, edgeRows, byChunk);
        const terminus = byChunk.get(edge.target_chunk_id);
        const terminusClassified = Boolean(
          terminus?.provenance_basis || edges.some((candidate) => candidate.target_chunk_id === edge.target_chunk_id && candidate.confidence === 'EXTRACTED')
        );
        if (!terminusClassified && edgeIds.length > 1) {
          const key = edgeIds.join('>');
          if (!seenShallow.has(key)) {
            seenShallow.add(key);
            shallowChains.push({
              kind: 'shallow_chain',
              chain_depth: edgeIds.length,
              terminus_chunk_id: edge.target_chunk_id,
              terminus_classified: false,
              chain,
              chunk_ids: chunkIds,
              edge_ids: edgeIds,
            });
          }
        }
        const weakest = edgeRows.reduce((min, candidate) => candidate.confidence_score < min.confidence_score ? candidate : min, edgeRows[0] ?? edge);
        if (edgeIds.length > 1 && weakest.confidence_score < weakThreshold) {
          const key = edgeIds.join('>');
          if (!seenWeak.has(key)) {
            seenWeak.add(key);
            weakChains.push({
              kind: 'weak_chain',
              chain_depth: edgeIds.length,
              chain,
              chunk_ids: chunkIds,
              edge_ids: edgeIds,
              weakest_edge: weakest.id,
              weakest_confidence_score: weakest.confidence_score,
            });
          }
        }
        queue.push({ chunkId: edge.target_chunk_id, chunkIds, edgeIds, edgeRows });
      }
    }
  }
  if (weakChains.length === 0) {
    for (const edge of edges.filter((candidate) => candidate.confidence_score < weakThreshold)) {
      weakChains.push({
        kind: 'weak_chain',
        chain_depth: 1,
        chain: alternatingChain([edge.source_chunk_id, edge.target_chunk_id], [edge], byChunk),
        chunk_ids: [edge.source_chunk_id, edge.target_chunk_id],
        edge_ids: [edge.id],
        weakest_edge: edge.id,
        weakest_confidence_score: edge.confidence_score,
      });
    }
  }
  return { shallowChains, weakChains };
}

function provenanceFindings(nodes: LintNodeRow[], edges: LintEdgeRow[]): LintCategoryInput[] {
  const chains = buildProvenanceChains(nodes, edges);
  const ungrounded = nodes
    .filter((node) => !node.provenance_basis && !edges.some((edge) => edge.target_chunk_id === node.chunk_id && edge.confidence === 'EXTRACTED'))
    .map((node) => ({
      rule: 'LINT-P1',
      severity: 'warning' as const,
      stableParts: ['provenance', node.chunk_id],
      summary: `No extracted provenance for ${node.document_path}`,
      chunkIds: [node.chunk_id],
      documentIds: [node.document_id],
      item: {
        kind: 'ungrounded',
        chunk_id: node.chunk_id,
        document_id: node.document_id,
        document_path: node.document_path,
        heading_path: node.heading_path,
        excerpt: excerpt(node.content),
        outgoing_edge_count: edges.filter((edge) => edge.source_chunk_id === node.chunk_id).length,
        downstream_dependent_count: edges.filter((edge) => edge.target_chunk_id === node.chunk_id).length,
      },
    }));
  const shallowChains = chains.shallowChains
    .map((chain) => ({
        rule: 'LINT-P1',
        severity: 'warning' as const,
        stableParts: ['provenance', 'shallow_chain', ...chain.edge_ids],
        summary: `Provenance chain terminates at unclassified node ${chain.terminus_chunk_id}`,
        chunkIds: chain.chunk_ids,
        edgeIds: chain.edge_ids,
        documentIds: chain.chunk_ids.map((id) => nodes.find((node) => node.chunk_id === id)?.document_id).filter(isString),
        item: {
          kind: 'shallow_chain',
          chain_depth: chain.chain_depth,
          terminus_chunk_id: chain.terminus_chunk_id,
          terminus_classified: chain.terminus_classified,
          chain: chain.chain,
        },
      }));
  const weakChains = chains.weakChains
    .map((chain) => ({
      rule: 'LINT-P1',
      severity: 'info' as const,
      stableParts: ['provenance', 'weak_chain', ...chain.edge_ids],
      summary: `Weak provenance path through ${chain.weakest_edge}`,
      chunkIds: chain.chunk_ids,
      edgeIds: chain.edge_ids,
      item: {
        kind: 'weak_chain',
        chain_depth: chain.chain_depth,
        chain: chain.chain,
        weakest_edge: chain.weakest_edge,
        weakest_confidence_score: chain.weakest_confidence_score,
      },
    }));
  return [...ungrounded, ...shallowChains, ...weakChains];
}

function contradictionFindings(nodes: LintNodeRow[], edges: LintEdgeRow[]): LintCategoryInput[] {
  const byChunk = new Map(nodes.map((node) => [node.chunk_id, node]));
  return edges
    .filter((edge) => edge.relation === 'contradicts')
    .map((edge) => {
      const source = byChunk.get(edge.source_chunk_id);
      const target = byChunk.get(edge.target_chunk_id);
      return {
        rule: 'LINT-C1',
        severity: edge.status === 'stale' ? 'info' : 'attention',
        stableParts: ['contradiction', edge.id],
        summary: `Contradiction edge ${edge.id}`,
        chunkIds: [edge.source_chunk_id, edge.target_chunk_id],
        edgeIds: [edge.id],
        documentIds: [source?.document_id, target?.document_id].filter(isString),
        item: {
          edge_id: edge.id,
          source: source ? nodeRef(source) : { chunk_id: edge.source_chunk_id },
          target: target ? nodeRef(target) : { chunk_id: edge.target_chunk_id },
          reasoning: edge.reasoning,
          confidence_score: edge.confidence_score,
          stale: edge.status === 'stale',
          same_document: source?.document_id === target?.document_id,
        },
      };
    });
}

function duplicateFindings(
  nodes: LintNodeRow[],
  edges: LintEdgeRow[],
  propagation = new Map<string, DuplicatePropagationReport>()
): LintCategoryInput[] {
  const byChunk = new Map(nodes.map((node) => [node.chunk_id, node]));
  return edges
    .filter((edge) => edge.relation === 'duplicates')
    .map((edge) => {
      const source = byChunk.get(edge.source_chunk_id);
      const target = byChunk.get(edge.target_chunk_id);
      const report = propagation.get(edge.id);
      return {
        rule: 'LINT-R2',
        severity: 'info',
        stableParts: ['duplicate', edge.source_chunk_id, edge.target_chunk_id],
        summary: `Duplicate pair ${edge.source_chunk_id} -> ${edge.target_chunk_id}`,
        chunkIds: [edge.source_chunk_id, edge.target_chunk_id],
        edgeIds: [edge.id],
        documentIds: [source?.document_id, target?.document_id].filter(isString),
        item: {
          chunk_a: source ? nodeRef(source) : { chunk_id: edge.source_chunk_id },
          chunk_b: target ? nodeRef(target) : { chunk_id: edge.target_chunk_id },
          overlap_extent: edge.confidence_score >= 0.8 ? 'substantial' : 'partial',
          edges_propagated: report?.propagated ?? [],
          edges_skipped: report?.skipped ?? [{ reason: 'duplicate_propagation_not_run' }],
        },
      };
    });
}

function communityFindings(communities: DetectedCommunity[]): LintCategoryInput[] {
  return communities.map((community) => ({
    rule: 'LINT-COMMUNITY',
    severity: community.sparse ? 'warning' : 'info',
    stableParts: ['community', community.member_chunk_ids],
    summary: community.community_summary,
    chunkIds: community.member_chunk_ids,
    documentIds: community.document_ids,
    item: {
      community_id: community.community_id,
      label: community.community_label,
      summary: community.community_summary,
      member_count: community.member_chunk_ids.length,
      document_ids: community.document_ids,
      document_paths: community.document_paths,
      strength_score: community.strength_score,
      edge_density: community.edge_density,
      avg_internal_confidence: community.avg_internal_confidence,
      provenance_coverage: community.provenance_coverage,
      unclassified_pair_ratio: Number((1 - community.provenance_coverage).toFixed(4)),
      sparse: community.sparse,
      fragile_conclusion_count: community.fragile_conclusion_count,
      hub_without_support_count: community.hub_without_support_count,
      unclassified_bridges_to: community.unclassified_bridges_to,
    },
  }));
}

function integrityFindings(edges: LintEdgeRow[], dryRun: boolean): LintCategoryInput[] {
  const staleFindings = edges
    .filter((edge) => edge.status === 'stale')
    .map((edge) => ({
      rule: 'LINT-I1',
      severity: 'info' as const,
      stableParts: ['integrity', 'stale_edge', edge.id],
      summary: dryRun ? `Would clear stale edge ${edge.id}` : `Cleared stale edge ${edge.id}`,
      edgeIds: [edge.id],
      chunkIds: [edge.source_chunk_id, edge.target_chunk_id],
      item: {
        fix_type: 'stale_edge_cleared',
        affected_id: edge.id,
        description: dryRun ? 'Dry run: stale edge would be reviewed.' : 'Stale edge reviewed by lint.',
        applied: dryRun ? false : true,
      },
    }));
  const activeInactiveFindings = edges
    .filter((edge) => exactlyOneInactive(edge.source_status, edge.target_status))
    .map((edge) => ({
      rule: 'LINT-I2',
      severity: 'info' as const,
      stableParts: ['integrity', 'active_inactive_edge', edge.id],
      summary: `Active graph edge ${edge.id} points to inactive content`,
      edgeIds: [edge.id],
      chunkIds: [edge.source_chunk_id, edge.target_chunk_id],
      item: {
        fix_type: 'active_inactive_reference',
        affected_id: edge.id,
        description: 'Active-to-inactive edge retained for historical provenance and surfaced for review.',
        applied: false,
        source_status: edge.source_status,
        target_status: edge.target_status,
      },
    }));

  return [...staleFindings, ...activeInactiveFindings];
}

function promptStalenessFindings(nodes: LintNodeRow[], currentPromptVersion: string): LintCategoryInput[] {
  return nodes.flatMap((node) => {
    const storedVersion = promptVersionFromAnalyzedByModel(node.analyzed_by_model);
    if (!storedVersion || storedVersion === currentPromptVersion) return [];
    return [{
      rule: 'LINT-I3',
      severity: 'attention' as const,
      stableParts: ['integrity', 'prompt_version_stale', node.chunk_id, storedVersion, currentPromptVersion],
      summary: `Graph node ${node.chunk_id} was analyzed with stale prompt version ${storedVersion}`,
      chunkIds: [node.chunk_id],
      documentIds: [node.document_id],
      item: {
        fix_type: 'prompt_version_reanalysis_required',
        affected_id: node.chunk_id,
        description: 'Graph node analysis prompt version changed; node should be prioritized for re-analysis.',
        applied: false,
        stored_prompt_version: storedVersion,
        current_prompt_version: currentPromptVersion,
        analyzed_by_model: node.analyzed_by_model,
      },
    }];
  });
}

function deadLetterFindings(rows: DeadLetterRow[]): LintCategoryInput[] {
  return rows.map((row) => ({
    rule: 'LINT-DLQ',
    severity: 'attention',
    stableParts: ['dead_letter', row.id],
    summary: `Dead-letter graph job ${row.id}`,
    chunkIds: [row.source_chunk_id, row.target_chunk_id],
    item: {
      fix_type: 'dead_letter_review_required',
      affected_id: row.id,
      description: 'Graph classification job reached max attempts and requires operator review.',
      attempt_count: row.attempt_count,
      max_attempts: row.max_attempts,
      last_error: row.last_error,
      remediation: typeof row.result?.remediation === 'string'
        ? row.result.remediation
        : 'Review graph configuration, source/target node analysis, and relation vocabulary before retrying manually.',
    },
  }));
}

function normalizeScope(scope: LifecycleScope | undefined): Record<string, unknown> | null {
  if (!scope) return null;
  const output: Record<string, unknown> = {};
  if ('path_prefix' in scope && typeof scope.path_prefix === 'string') output.path_prefix = scope.path_prefix;
  if ('tags' in scope && Array.isArray(scope.tags)) output.tags = scope.tags;
  if ('status' in scope && typeof scope.status === 'string') output.status = scope.status;
  return Object.keys(output).length === 0 ? null : output;
}

function summarizeQuestions(items: Array<Record<string, unknown>>): Record<string, unknown> {
  const totalByStatus: Record<string, number> = {};
  for (const item of items) {
    const status = typeof item.question_status === 'string' ? item.question_status : 'unknown';
    totalByStatus[status] = (totalByStatus[status] ?? 0) + 1;
  }
  const highest = [...items].sort((a, b) => numberValue(b.downstream_impact_count) - numberValue(a.downstream_impact_count))[0];
  return {
    total_by_status: totalByStatus,
    oldest_open_age_days: Math.max(
      0,
      ...items
        .filter((item) => item.question_status === 'open')
        .map((item) => numberValue(item.age_days))
    ),
    highest_impact_chunk_id: typeof highest?.chunk_id === 'string' ? highest.chunk_id : null,
  };
}

function summarizeCommunities(items: Array<Record<string, unknown>>): Record<string, unknown> {
  const largest = [...items].sort((a, b) => numberValue(b.member_count) - numberValue(a.member_count))[0];
  const strongest = [...items].sort((a, b) => numberValue(b.strength_score) - numberValue(a.strength_score))[0];
  const weakest = [...items].sort((a, b) => numberValue(a.strength_score) - numberValue(b.strength_score))[0];
  return {
    total_communities: items.length,
    largest_community_id: largest?.community_id ?? null,
    strongest_community_id: strongest?.community_id ?? null,
    weakest_community_id: weakest?.community_id ?? null,
  };
}

function lintWarnings(deadLetters: DeadLetterRow[], rules: Set<string>, dryRun: boolean, extraWarnings: string[]): string[] {
  const warnings = [...extraWarnings];
  if (deadLetters.length > 0) warnings.push('graph_dead_letters_present');
  if (!rules.has('LINT-R2')) warnings.push('graph_lint_duplicate_propagation_skipped_by_rules');
  if (dryRun) warnings.push('graph_lint_dry_run_no_persistence');
  return warnings;
}

function nodeRef(node: LintNodeRow): Record<string, unknown> {
  return {
    chunk_id: node.chunk_id,
    document_id: node.document_id,
    document_path: node.document_path,
    heading_path: node.heading_path,
    excerpt: excerpt(node.content),
    community_id: node.community_id,
    community_label: node.community_label,
  };
}

function excerpt(content: string, maxLength = 240): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function ageDays(timestamp: string | null, now: Date): number {
  if (!timestamp) return 0;
  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor((now.getTime() - parsed) / 86_400_000));
}

function exactlyOneInactive(sourceStatus: string, targetStatus: string): boolean {
  return (sourceStatus === 'active') !== (targetStatus === 'active');
}

function promptVersionFromAnalyzedByModel(value: string | null): string | null {
  if (!value) return null;
  const separator = value.lastIndexOf('@');
  if (separator < 0 || separator === value.length - 1) return null;
  return value.slice(separator + 1);
}

function parseResolutionTime(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function edgeKey(source: string, target: string, relation: string): string {
  return `${source}\u0000${target}\u0000${relation}`;
}

function alternatingChain(
  chunkIds: string[],
  edges: LintEdgeRow[],
  nodes: Map<string, LintNodeRow>
): Array<Record<string, unknown>> {
  const chain: Array<Record<string, unknown>> = [];
  for (let index = 0; index < chunkIds.length; index += 1) {
    const node = nodes.get(chunkIds[index]);
    chain.push({
      kind: 'chunk',
      chunk_id: chunkIds[index],
      ...(node?.document_id ? { document_id: node.document_id } : {}),
      ...(node?.document_path ? { document_path: node.document_path } : {}),
    });
    const edge = edges[index];
    if (edge) {
      chain.push({
        kind: 'edge',
        edge_id: edge.id,
        relation: edge.relation,
        confidence_score: edge.confidence_score,
      });
    }
  }
  return chain;
}

export const __testing = {
  stableFindingId,
  questionFindings,
  buildProvenanceChains,
  provenanceFindings,
  contradictionFindings,
  duplicateFindings,
  communityFindings,
  integrityFindings,
  promptStalenessFindings,
};
