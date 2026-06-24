import { createHash } from 'node:crypto';

export type GraphLintDelta = 'new' | 'recurring' | null;
export type GraphLintSeverity = 'info' | 'warning' | 'attention';

export interface GraphLintCounts {
  chunks_scanned: number;
  edges_traversed: number;
  items_total: number;
  items_new: number;
  items_resolved: number;
}

export interface GraphLintRawFinding {
  finding_id: string;
  rule: string;
  severity: GraphLintSeverity;
  delta: GraphLintDelta;
  summary: string;
  chunk_ids: string[];
  edge_ids: string[];
  document_ids: string[];
}

export interface GraphLintPayload {
  run_id: string;
  timestamp: string;
  graph_epoch: number;
  scope_applied: Record<string, unknown> | null;
  counts: GraphLintCounts;
  questions: { summary: Record<string, unknown>; items: Array<Record<string, unknown>> };
  provenance: { summary: Record<string, unknown>; items: Array<Record<string, unknown>> };
  contradictions: { summary: Record<string, unknown>; items: Array<Record<string, unknown>> };
  duplicates: { summary: Record<string, unknown>; items: Array<Record<string, unknown>> };
  communities: { summary: Record<string, unknown>; items: Array<Record<string, unknown>> };
  integrity: { summary: Record<string, unknown>; items: Array<Record<string, unknown>> };
  raw_findings: GraphLintRawFinding[];
  warnings: string[];
}

export interface GraphLintListPayload {
  runs: Array<{
    run_id: string;
    timestamp: string;
    graph_epoch: number;
    counts: GraphLintCounts;
  }>;
}

export interface LintCategoryInput {
  rule: string;
  severity: GraphLintSeverity;
  stableParts: unknown[];
  summary: string;
  chunkIds?: string[];
  edgeIds?: string[];
  documentIds?: string[];
  item: Record<string, unknown>;
}

export function stableFindingId(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
}

export function applyDeltas(
  findings: LintCategoryInput[],
  previousFindingIds: Set<string>
): { items: Array<Record<string, unknown>>; raw: GraphLintRawFinding[]; newCount: number } {
  let newCount = 0;
  const items: Array<Record<string, unknown>> = [];
  const raw: GraphLintRawFinding[] = [];

  for (const finding of findings) {
    const findingId = stableFindingId(finding.stableParts);
    const delta: GraphLintDelta = previousFindingIds.size === 0
      ? null
      : previousFindingIds.has(findingId)
        ? 'recurring'
        : 'new';
    if (delta === 'new') newCount++;
    items.push({ ...finding.item, finding_id: findingId, delta });
    raw.push({
      finding_id: findingId,
      rule: finding.rule,
      severity: finding.severity,
      delta,
      summary: finding.summary,
      chunk_ids: finding.chunkIds ?? [],
      edge_ids: finding.edgeIds ?? [],
      document_ids: finding.documentIds ?? [],
    });
  }

  return { items, raw, newCount };
}

export function capGraphLintPayload(payload: GraphLintPayload, maxFindings?: number): GraphLintPayload {
  if (maxFindings === undefined) return payload;
  const cap = Math.max(0, maxFindings);
  let remaining = cap;
  const capItems = (category: GraphLintPayload['questions']): GraphLintPayload['questions'] => {
    const items = category.items.slice(0, remaining);
    remaining -= items.length;
    return { ...category, items };
  };
  const capped = {
    ...payload,
    questions: capItems(payload.questions),
    provenance: capItems(payload.provenance),
    contradictions: capItems(payload.contradictions),
    duplicates: capItems(payload.duplicates),
    communities: capItems(payload.communities),
    integrity: capItems(payload.integrity),
  };
  const visible = new Set(
    [
      ...capped.questions.items,
      ...capped.provenance.items,
      ...capped.contradictions.items,
      ...capped.duplicates.items,
      ...capped.communities.items,
      ...capped.integrity.items,
    ].map((item) => String(item.finding_id))
  );
  return { ...capped, raw_findings: payload.raw_findings.filter((finding) => visible.has(finding.finding_id)) };
}
