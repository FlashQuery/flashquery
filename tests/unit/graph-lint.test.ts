import { describe, expect, it } from 'vitest';
import { applyDeltas } from '../../src/graph/lint-categories.js';
import { __testing as lintTesting } from '../../src/graph/lint.js';
import { maintainVault, resetMaintenanceStateForTests } from '../../src/services/maintenance.js';
import { loadConfig } from '../../src/config/loader.js';

function configForValidation() {
  const config = loadConfig('tests/fixtures/flashquery.test.yml');
  config.supabase.databaseUrl = 'postgresql://example.invalid/postgres';
  return config;
}

describe('graph lint category builders', () => {
  it('T-U-044 computes deltas and resolved counts from prior finding IDs', () => {
    const finding = {
      rule: 'LINT-Q1',
      severity: 'attention' as const,
      stableParts: ['question', 'chunk-1'],
      summary: 'open question',
      item: { chunk_id: 'chunk-1' },
    };
    const first = applyDeltas([finding], new Set());
    const second = applyDeltas([finding], new Set(first.raw.map((item) => item.finding_id)));

    expect(first.items[0]?.delta).toBeNull();
    expect(second.items[0]?.delta).toBe('recurring');
    expect(applyDeltas([{ ...finding, stableParts: ['question', 'chunk-2'] }], new Set(first.raw.map((item) => item.finding_id))).items[0]?.delta).toBe('new');
  });

  it('T-U-045 ignores both-inactive edges and reports active-to-inactive findings only after filtering', () => {
    const edges = [
      { id: 'e1', source_chunk_id: 'a', target_chunk_id: 'b', relation: 'contradicts', confidence: 'INFERRED', confidence_score: 0.9, reasoning: 'x', status: 'active', metadata: null, source_status: 'archived', target_status: 'missing' },
      { id: 'e2', source_chunk_id: 'a', target_chunk_id: 'c', relation: 'contradicts', confidence: 'INFERRED', confidence_score: 0.9, reasoning: 'x', status: 'active', metadata: null, source_status: 'active', target_status: 'archived' },
    ];
    const activeFiltered = edges.filter((edge) => !(edge.source_status !== 'active' && edge.target_status !== 'active'));
    const findings = lintTesting.contradictionFindings([], activeFiltered);
    const integrity = lintTesting.integrityFindings(activeFiltered, false);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.edgeIds).toEqual(['e2']);
    expect(integrity).toEqual([
      expect.objectContaining({
        rule: 'LINT-I2',
        severity: 'info',
        edgeIds: ['e2'],
        item: expect.objectContaining({
          fix_type: 'active_inactive_reference',
          source_status: 'active',
          target_status: 'archived',
        }),
      }),
    ]);
  });

  it('T-U-046 graph_lint_prune rejects missing retention parameters before touching storage', async () => {
    resetMaintenanceStateForTests();
    const result = await maintainVault(configForValidation(), { action: 'graph_lint_prune' });

    expect(result).toMatchObject({
      ok: false,
      error: {
        error: 'invalid_input',
        details: { parameter: 'keep_last,older_than' },
      },
    });
  });

  it('T-U-063 preserves lint execution order in source', () => {
    const source = lintTesting;
    expect(Object.keys(source)).toEqual([
      'stableFindingId',
      'questionFindings',
      'buildProvenanceChains',
      'provenanceFindings',
      'contradictionFindings',
      'duplicateFindings',
      'communityFindings',
      'integrityFindings',
      'promptStalenessFindings',
    ]);
  });

  it('builds multi-hop provenance chains with alternating chunk and edge entries', () => {
    const nodes = [
      { chunk_id: 'claim', document_id: 'doc-claim', document_path: '/claim.md', document_status: 'active', heading_path: 'Claim', content: 'Claim', chunk_updated_at: null, provenance_basis: null, question_status: null, question_resolution: null, community_id: null, community_label: null, community_summary: null, analyzed_at: null, analyzed_by_model: null },
      { chunk_id: 'mid', document_id: 'doc-mid', document_path: '/mid.md', document_status: 'active', heading_path: 'Mid', content: 'Middle', chunk_updated_at: null, provenance_basis: 'model:summary', question_status: null, question_resolution: null, community_id: null, community_label: null, community_summary: null, analyzed_at: null, analyzed_by_model: null },
      { chunk_id: 'source', document_id: 'doc-source', document_path: '/source.md', document_status: 'active', heading_path: 'Source', content: 'Source', chunk_updated_at: null, provenance_basis: null, question_status: null, question_resolution: null, community_id: null, community_label: null, community_summary: null, analyzed_at: null, analyzed_by_model: null },
    ];
    const edges = [
      { id: 'edge-1', source_chunk_id: 'claim', target_chunk_id: 'mid', relation: 'supports', confidence: 'INFERRED', confidence_score: 0.92, reasoning: null, status: 'active', metadata: null, source_status: 'active', target_status: 'active' },
      { id: 'edge-2', source_chunk_id: 'mid', target_chunk_id: 'source', relation: 'supports', confidence: 'INFERRED', confidence_score: 0.42, reasoning: null, status: 'active', metadata: null, source_status: 'active', target_status: 'active' },
    ];

    const chains = lintTesting.buildProvenanceChains(nodes, edges, 0.7);

    expect(chains.weakChains[0]).toMatchObject({
      chain_depth: 2,
      weakest_edge: 'edge-2',
      weakest_confidence_score: 0.42,
      chain: [
        { kind: 'chunk', chunk_id: 'claim' },
        { kind: 'edge', edge_id: 'edge-1' },
        { kind: 'chunk', chunk_id: 'mid' },
        { kind: 'edge', edge_id: 'edge-2' },
        { kind: 'chunk', chunk_id: 'source' },
      ],
    });
    expect(chains.shallowChains[0]).toMatchObject({
      chain_depth: 2,
      terminus_chunk_id: 'source',
      terminus_classified: false,
    });
  });

  it('T-U-065 organizes payload categories into typed summary and items shapes', () => {
    const communityItems = lintTesting.communityFindings([
      {
        community_id: 'comm-1',
        community_label: 'Graph Community 1',
        community_summary: '3 chunks',
        member_chunk_ids: ['a', 'b', 'c'],
        document_ids: ['doc-a'],
        document_paths: ['/a.md'],
        strength_score: 0.5,
        edge_density: 0.5,
        avg_internal_confidence: 1,
        provenance_coverage: 1,
        sparse: false,
        fragile_conclusion_count: 1,
        hub_without_support_count: 2,
        unclassified_bridges_to: ['a:b'],
      },
    ]);

    expect(communityItems[0]?.item).toMatchObject({
      community_id: 'comm-1',
      strength_score: 0.5,
      document_ids: ['doc-a'],
      sparse: false,
      fragile_conclusion_count: 1,
      hub_without_support_count: 2,
      unclassified_bridges_to: ['a:b'],
    });
  });

  it('T-U-066 enumerates question lifecycle fields', () => {
    const findings = lintTesting.questionFindings([
      { chunk_id: 'q1', document_id: 'doc', document_path: '/q.md', document_status: 'active', heading_path: 'Q', content: 'Question?', chunk_updated_at: '2026-06-21T00:00:00.000Z', provenance_basis: null, question_status: 'resolved', question_resolution: '2026-06-22T00:00:00.000Z', community_id: 'comm', community_label: 'Community', community_summary: 'Summary', analyzed_at: '2026-06-20T00:00:00.000Z', analyzed_by_model: 'model@1' },
      { chunk_id: 'd1', document_id: 'doc', document_path: '/d.md', document_status: 'active', heading_path: 'D', content: 'Dependent', chunk_updated_at: '2026-06-21T12:00:00.000Z', provenance_basis: null, question_status: null, question_resolution: null, community_id: null, community_label: null, community_summary: null, analyzed_at: null, analyzed_by_model: null },
    ], [
      { id: 'e1', source_chunk_id: 'q1', target_chunk_id: 'd1', relation: 'depends_on', confidence: 'INFERRED', confidence_score: 0.8, reasoning: null, status: 'active', metadata: null, source_status: 'active', target_status: 'active' },
    ], new Date('2026-06-24T00:00:00.000Z'));

    expect(findings[0]?.item).toMatchObject({
      question_status: 'resolved',
      age_days: 4,
      downstream_impact_count: 1,
      stale: true,
      follow_up_required_chunk_ids: ['d1'],
      unfolded_dependents: ['d1'],
    });
  });

  it('T-U-067 includes community structural health fields', () => {
    const [finding] = lintTesting.communityFindings([
      { community_id: 'comm', community_label: 'Label', community_summary: 'Summary', member_chunk_ids: ['a', 'b', 'c'], document_ids: ['doc'], document_paths: ['/doc.md'], strength_score: 0.25, edge_density: 0.5, avg_internal_confidence: 0.5, provenance_coverage: 1, sparse: true, fragile_conclusion_count: 2, hub_without_support_count: 1, unclassified_bridges_to: ['b:c'] },
    ]);

    expect(finding?.item).toMatchObject({
      strength_score: 0.25,
      document_paths: ['/doc.md'],
      unclassified_pair_ratio: 0,
      fragile_conclusion_count: 2,
      hub_without_support_count: 1,
      unclassified_bridges_to: ['b:c'],
    });
  });

  it('surfaces stale graph node prompt versions for re-analysis prioritization', () => {
    const findings = lintTesting.promptStalenessFindings([
      { chunk_id: 'n1', document_id: 'doc', document_path: '/n.md', document_status: 'active', heading_path: 'N', content: 'Node', chunk_updated_at: '2026-06-24T00:00:00.000Z', provenance_basis: 'source', question_status: null, question_resolution: null, community_id: null, community_label: null, community_summary: null, analyzed_at: '2026-06-20T00:00:00.000Z', analyzed_by_model: 'model@1' },
      { chunk_id: 'n2', document_id: 'doc', document_path: '/n2.md', document_status: 'active', heading_path: 'N2', content: 'Node', chunk_updated_at: '2026-06-24T00:00:00.000Z', provenance_basis: 'source', question_status: null, question_resolution: null, community_id: null, community_label: null, community_summary: null, analyzed_at: '2026-06-20T00:00:00.000Z', analyzed_by_model: 'model@2' },
    ], '2');

    expect(findings).toEqual([
      expect.objectContaining({
        rule: 'LINT-I3',
        item: expect.objectContaining({
          fix_type: 'prompt_version_reanalysis_required',
          stored_prompt_version: '1',
          current_prompt_version: '2',
        }),
      }),
    ]);
  });

  it('T-U-068 mirrors semantic items into raw findings', () => {
    const applied = applyDeltas([
      { rule: 'LINT-I1', severity: 'info', stableParts: ['stale', 'e1'], summary: 'stale', edgeIds: ['e1'], item: { affected_id: 'e1' } },
    ], new Set());

    expect(applied.raw).toEqual([
      expect.objectContaining({
        rule: 'LINT-I1',
        severity: 'info',
        edge_ids: ['e1'],
        finding_id: expect.any(String),
      }),
    ]);
  });

  it('T-U-074 validates dry_run on graph_lint and rejects it on status/prune', async () => {
    resetMaintenanceStateForTests();
    const status = await maintainVault(configForValidation(), { action: 'graph_lint_status', dry_run: true });
    const prune = await maintainVault(configForValidation(), { action: 'graph_lint_prune', dry_run: true, keep_last: 1 });

    expect(status.ok).toBe(false);
    expect(prune.ok).toBe(false);
  });

  it('T-U-075 validates graph_lint_prune keep_last and older_than parameters', async () => {
    resetMaintenanceStateForTests();
    const badKeep = await maintainVault(configForValidation(), { action: 'graph_lint_prune', keep_last: -1 });
    const badAge = await maintainVault(configForValidation(), { action: 'graph_lint_prune', older_than: 'not-a-date' });

    expect(badKeep).toMatchObject({ ok: false, error: { details: { parameter: 'keep_last' } } });
    expect(badAge).toMatchObject({ ok: false, error: { details: { parameter: 'older_than' } } });
  });

  it('rejects invalid parameter combinations with canonical expected-error envelopes', async () => {
    resetMaintenanceStateForTests();
    const config = configForValidation();
    const cases = [
      maintainVault(config, { action: 'graph_lint_status', rules: ['LINT-Q1'] }),
      maintainVault(config, { action: 'graph_lint_status', run_id: 'abc', limit: 2 }),
      maintainVault(config, { action: 'graph_lint_prune', max_findings: 1, keep_last: 1 }),
      maintainVault(config, { action: 'graph_lint', job_id: 'abc' }),
      maintainVault(config, { action: 'graph_lint', keep_last: 1 }),
    ];
    const results = await Promise.all(cases);

    expect(results.every((result) => result.ok === false && result.error.error === 'invalid_input')).toBe(true);
  });
});
