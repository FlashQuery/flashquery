import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { LifecycleScope } from '../embedding/lifecycle/types.js';
import { createPgClientIPv4 } from '../utils/pg-client.js';
import { detectAndApplyTopologyCommunities, type DetectedCommunity } from './communities.js';
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
  rules?: string[];
  scope?: LifecycleScope;
  dryRun?: boolean;
  maxFindings?: number;
  now?: () => Date;
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
  provenance_basis: string | null;
  question_status: string | null;
  question_resolution: string | null;
  community_id: string | null;
  community_label: string | null;
  community_summary: string | null;
  analyzed_at: string | null;
}

interface LintEdgeRow {
  id: string;
  source_chunk_id: string;
  target_chunk_id: string;
  relation: string;
  confidence: string;
  confidence_score: number;
  reasoning: string | null;
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
  'LINT-DLQ',
]);

export async function runGraphLint(options: GraphLintOptions): Promise<GraphLintPayload> {
  return await withClient(options.databaseUrl, async (client) => {
    const timestamp = (options.now ?? (() => new Date()))().toISOString();
    const runId = randomUUID();
    const scopeApplied = normalizeScope(options.scope);
    const pathPrefix = typeof scopeApplied?.path_prefix === 'string' ? scopeApplied.path_prefix : undefined;
    const selectedRules = new Set(options.rules ?? ALL_RULES);
    const previous = await loadLatestPayload(client, options.instanceId);
    const previousFindingIds = new Set(previous?.raw_findings.map((finding) => finding.finding_id) ?? []);

    const communities = selectedRules.has('LINT-COMMUNITY')
      ? await detectAndApplyTopologyCommunities({
          client,
          instanceId: options.instanceId,
          pathPrefix,
          dryRun: options.dryRun === true,
        })
      : [];
    const nodes = await loadLintNodes(client, options.instanceId, pathPrefix);
    const edges = await loadLintEdges(client, options.instanceId, pathPrefix);
    const deadLetters = await loadDeadLetters(client, options.instanceId);

    const categoryFindings = {
      questions: selectedRules.has('LINT-Q1') ? questionFindings(nodes, edges) : [],
      provenance: selectedRules.has('LINT-P1') ? provenanceFindings(nodes, edges) : [],
      contradictions: selectedRules.has('LINT-C1') ? contradictionFindings(nodes, edges) : [],
      duplicates: selectedRules.has('LINT-R2') ? duplicateFindings(nodes, edges) : [],
      communities: selectedRules.has('LINT-COMMUNITY') ? communityFindings(communities) : [],
      integrity: [
        ...(selectedRules.has('LINT-I1') ? integrityFindings(edges, options.dryRun === true) : []),
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
          unclassified_terminus_count: applied.provenance.items.length,
          load_bearing_unclassified_count: applied.provenance.items.length,
          shallow_chain_count: 0,
          weak_chain_count: 0,
        },
        items: applied.provenance.items,
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
      warnings: lintWarnings(deadLetters, selectedRules, options.dryRun === true),
    };

    if (options.dryRun !== true) {
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
      n.provenance_basis,
      n.question_status,
      n.question_resolution,
      n.community_id,
      n.community_label,
      n.community_summary,
      n.analyzed_at::text
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

function questionFindings(nodes: LintNodeRow[], edges: LintEdgeRow[]): LintCategoryInput[] {
  return nodes
    .filter((node) => node.question_status === 'open' || node.question_status === 'deferred' || node.question_status === 'resolved')
    .map((node) => {
      const dependents = edges
        .filter((edge) => edge.target_chunk_id === node.chunk_id || edge.source_chunk_id === node.chunk_id)
        .map((edge) => edge.source_chunk_id === node.chunk_id ? edge.target_chunk_id : edge.source_chunk_id);
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
          age_days: 0,
          community_id: node.community_id,
          community_label: node.community_label,
          downstream_impact_count: dependents.length,
          dependent_chunk_ids: dependents,
          stale: dependents.some((id) => edges.some((edge) => edge.status === 'stale' && (edge.source_chunk_id === id || edge.target_chunk_id === id))),
          unfolded_dependents: node.question_status === 'resolved' ? dependents : [],
        },
      };
    });
}

function provenanceFindings(nodes: LintNodeRow[], edges: LintEdgeRow[]): LintCategoryInput[] {
  return nodes
    .filter((node) => !node.provenance_basis && !edges.some((edge) => edge.target_chunk_id === node.chunk_id && edge.confidence === 'EXTRACTED'))
    .map((node) => ({
      rule: 'LINT-P1',
      severity: 'warning',
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

function duplicateFindings(nodes: LintNodeRow[], edges: LintEdgeRow[]): LintCategoryInput[] {
  const byChunk = new Map(nodes.map((node) => [node.chunk_id, node]));
  return edges
    .filter((edge) => edge.relation === 'duplicates')
    .map((edge) => {
      const source = byChunk.get(edge.source_chunk_id);
      const target = byChunk.get(edge.target_chunk_id);
      const propagated = edges
        .filter((candidate) => candidate.source_chunk_id === edge.source_chunk_id && candidate.relation !== 'duplicates')
        .map((candidate) => ({
          direction: 'out',
          relation: candidate.relation,
          other_chunk_id: candidate.target_chunk_id,
          new_edge_id: candidate.id,
        }));
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
          edges_propagated: propagated,
          edges_skipped: propagated.length === 0 ? [{ reason: 'no_supported_edges_to_propagate' }] : [],
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
      fragile_conclusion_count: 0,
      hub_without_support_count: 0,
      unclassified_bridges_to: [],
    },
  }));
}

function integrityFindings(edges: LintEdgeRow[], dryRun: boolean): LintCategoryInput[] {
  return edges
    .filter((edge) => edge.status === 'stale')
    .map((edge) => ({
      rule: 'LINT-I1',
      severity: 'info',
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
    oldest_open_age_days: 0,
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

function lintWarnings(deadLetters: DeadLetterRow[], rules: Set<string>, dryRun: boolean): string[] {
  const warnings: string[] = [];
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

function excerpt(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export const __testing = {
  stableFindingId,
  questionFindings,
  provenanceFindings,
  contradictionFindings,
  duplicateFindings,
  communityFindings,
  integrityFindings,
};
