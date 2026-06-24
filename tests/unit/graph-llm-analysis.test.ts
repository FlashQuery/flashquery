import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  buildGraphLlmErrorEnvelope,
  parseGraphEdgeClassificationPayload,
  parseGraphNodeAnalysisPayload,
  resolveGraphLlmCompletion,
} from '../../src/graph/llm-analysis.js';
import { analyzeGraphNode } from '../../src/graph/node-analysis.js';
import { classifyGraphEdgeCandidate } from '../../src/graph/edge-analysis.js';
import { DEFAULT_GRAPH_RELATIONS } from '../../src/graph/vocabulary.js';
import type { LlmClient, LlmCompletionResult } from '../../src/llm/runtime-types.js';

const completion = (text: string, modelName = 'graph-model'): LlmCompletionResult => ({
  text,
  modelName,
  providerName: 'mock-provider',
  inputTokens: 11,
  outputTokens: 13,
  latencyMs: 7,
});

function mockLlm(text: string): LlmClient {
  return {
    complete: vi.fn(async () => completion(text, 'direct-graph-model')),
    completeByPurpose: vi.fn(async () => ({
      ...completion(text, 'purpose-graph-model'),
      purposeName: 'graph-classifier',
      fallbackPosition: 1,
    })),
    chat: vi.fn(),
    chatByPurpose: vi.fn(),
    chatByPurposeUnrecorded: vi.fn(),
    getModelForPurpose: vi.fn(),
  } as unknown as LlmClient;
}

function nodePayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    key_claims: ['Claim A', 'Claim B'],
    chunk_summary: 'A concise chunk summary.',
    provenance_basis: 'source text',
    question_status: 'resolved',
    question_resolution: 'The question is answered by Claim B.',
    certainty_level: 'high',
    staleness_risk: 'low',
    external_refs: ['https://example.test/ref'],
    temporal_markers: ['2026-06-24'],
    analyzed_content_hash: 'hash-1',
    ...overrides,
  });
}

function edgePayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    edges: [
      {
        relation: 'contradicts',
        reasoning: 'Claim A conflicts with Claim C.',
        source_claims_referenced: [0],
        target_claims_referenced: [0],
        confidence_score: 0.88,
        metadata: {
          llm_assessment: 'strong',
          low_confidence_flag: false,
        },
      },
    ],
    ...overrides,
  });
}

describe('graph LLM parsing', () => {
  it('T-U-039 repairs malformed node JSON through parseLlmJson', () => {
    const result = parseGraphNodeAnalysisPayload(`{
      key_claims: ['Claim A'],
      chunk_summary: 'Summary',
      provenance_basis: 'source',
      question_status: 'open',
      question_resolution: null,
      certainty_level: 'medium',
      staleness_risk: 'low',
      external_refs: [],
      temporal_markers: [],
      analyzed_content_hash: 'hash-1',
    }`);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected parse success');
    expect(result.repaired).toBe(true);
    expect(result.data.key_claims).toEqual(['Claim A']);
  });

  it('T-U-040 returns a bounded retryable failure for schema-invalid JSON', () => {
    const result = parseGraphNodeAnalysisPayload('{"key_claims":"not-an-array"}');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected parse failure');
    expect(result.retryable).toBe(true);
    expect(result.failure).toBe('schema');
    expect(result.summary).toContain('key_claims');
    expect(result.summary).not.toContain('not-an-array');
  });

  it('T-U-062 builds bounded public errors without raw LLM output or secrets', () => {
    const raw =
      '{"key_claims":"not-an-array","secret":"sk-live-123","db":"postgres://user:pass@example/db"}';
    const result = parseGraphNodeAnalysisPayload(raw);
    if (result.ok) throw new Error('expected parse failure');

    const envelope = buildGraphLlmErrorEnvelope(result, {
      operation: 'graph_node_analysis',
      traceId: 'graph-node-analysis:chunk-1',
    });
    const serialized = JSON.stringify(envelope);

    expect(envelope.error).toBe('invalid_graph_llm_json');
    expect(serialized).toContain('graph_node_analysis');
    expect(serialized).not.toContain(raw);
    expect(serialized).not.toContain('sk-live-123');
    expect(serialized).not.toContain('postgres://');
    expect(serialized).not.toContain('Prompt');
  });

  it('source assertion: graph llm-analysis uses parseLlmJson and not direct JSON.parse on LLM output', () => {
    const source = readFileSync(new URL('../../src/graph/llm-analysis.ts', import.meta.url), 'utf8');

    expect(source).toMatch(/parseLlmJson/);
    expect(source).not.toMatch(/JSON\.parse/);
  });
});

describe('graph node analysis', () => {
  it('T-U-037 validates node output and populates graph node metadata', async () => {
    const updates: unknown[] = [];
    const supabase = {
      from: vi.fn(() => ({
        upsert: vi.fn((row: unknown) => {
          updates.push(row);
          return { select: vi.fn(() => ({ single: vi.fn(async () => ({ data: row, error: null })) })) };
        }),
      })),
    };

    const result = await analyzeGraphNode({
      supabase,
      instanceId: 'inst',
      chunk: { id: 'chunk-1', content: 'A chunk', contentHash: 'hash-1' },
      llmClient: mockLlm(nodePayload()),
      graphConfig: { enabled: true, classificationPurpose: 'graph-classifier' },
      promptVersion: 'node-v1',
      analyzedAt: new Date('2026-06-24T00:00:00.000Z'),
    });

    expect(result.status).toBe('analyzed');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      chunk_id: 'chunk-1',
      instance_id: 'inst',
      key_claims: ['Claim A', 'Claim B'],
      chunk_summary: 'A concise chunk summary.',
      provenance_basis: 'source text',
      question_status: 'resolved',
      question_resolution: 'The question is answered by Claim B.',
      certainty_level: 'high',
      staleness_risk: 'low',
      analyzed_content_hash: 'hash-1',
      analyzed_by_model: 'purpose-graph-model@node-v1',
      analyzed_at: '2026-06-24T00:00:00.000Z',
    });
  });

  it('T-U-078 records model plus prompt version in analyzed_by_model', async () => {
    const supabase = {
      from: vi.fn(() => ({
        upsert: vi.fn((row: unknown) => ({
          select: vi.fn(() => ({ single: vi.fn(async () => ({ data: row, error: null })) })),
        })),
      })),
    };

    const result = await analyzeGraphNode({
      supabase,
      instanceId: 'inst',
      chunk: { id: 'chunk-1', content: 'A chunk', contentHash: 'hash-1' },
      llmClient: mockLlm(nodePayload()),
      graphConfig: { enabled: true, classificationPurpose: 'graph-classifier' },
      promptVersion: 'prompt-2026-06',
    });

    expect(result.status).toBe('analyzed');
    if (result.status !== 'analyzed') throw new Error('expected analyzed');
    expect(result.node.analyzed_by_model).toBe('purpose-graph-model@prompt-2026-06');
  });
});

describe('graph edge analysis', () => {
  it('T-U-038 does not run Prompt 2 when node analysis dependency failed', async () => {
    const llm = mockLlm(edgePayload());
    const result = await classifyGraphEdgeCandidate({
      instanceId: 'inst',
      sourceChunkId: 'source',
      targetChunkId: 'target',
      sourceNode: null,
      targetNode: {
        chunk_id: 'target',
        key_claims: ['Target claim'],
        analyzed_at: '2026-06-24T00:00:00.000Z',
      },
      llmClient: llm,
      graphConfig: { enabled: true, classificationPurpose: 'graph-classifier' },
      relations: DEFAULT_GRAPH_RELATIONS,
      promptVersion: 'edge-v1',
    });

    expect(result.status).toBe('dependency_failed');
    expect(llm.completeByPurpose).not.toHaveBeenCalled();
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('T-U-078 rejects invalid claim references before writing', async () => {
    const result = await classifyGraphEdgeCandidate({
      instanceId: 'inst',
      sourceChunkId: 'source',
      targetChunkId: 'target',
      sourceNode: {
        chunk_id: 'source',
        key_claims: ['Source claim'],
        analyzed_at: '2026-06-24T00:00:00.000Z',
      },
      targetNode: {
        chunk_id: 'target',
        key_claims: ['Target claim'],
        analyzed_at: '2026-06-24T00:00:00.000Z',
      },
      llmClient: mockLlm(
        edgePayload({
          edges: [
            {
              relation: 'contradicts',
              reasoning: 'Bad refs.',
              source_claims_referenced: [3],
              target_claims_referenced: [],
              confidence_score: 0.9,
              metadata: { llm_assessment: 'weak', low_confidence_flag: false },
            },
          ],
        })
      ),
      graphConfig: { enabled: true, classificationPurpose: 'graph-classifier' },
      relations: DEFAULT_GRAPH_RELATIONS,
      promptVersion: 'edge-v1',
    });

    expect(result.status).toBe('validation_failed');
    expect(result.error.message).toMatch(/source_claims_referenced/i);
    expect(result.error.message).toMatch(/target_claims_referenced/i);
  });

  it('T-U-078 rejects freeform rubric and malformed low-confidence flags at schema parse', () => {
    const result = parseGraphEdgeClassificationPayload(
      edgePayload({
        edges: [
          {
            relation: 'contradicts',
            reasoning: 'Bad metadata.',
            source_claims_referenced: [0],
            target_claims_referenced: [0],
            confidence_score: 0.9,
            metadata: { llm_assessment: '0.7', low_confidence_flag: 'sometimes' },
          },
        ],
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected schema failure');
    expect(result.summary).toMatch(/llm_assessment|low_confidence_flag/);
  });

  it('classifies valid edge drafts with graph purpose/model/trace metadata', async () => {
    const llm = mockLlm(edgePayload());
    const inserted: unknown[] = [];
    const supabase = {
      from: vi.fn(() => ({
        insert: vi.fn((rows: unknown[]) => {
          inserted.push(...rows);
          return { select: vi.fn(async () => ({ data: [{ id: 'edge-1' }], error: null })) };
        }),
      })),
    };
    const result = await classifyGraphEdgeCandidate({
      instanceId: 'inst',
      sourceChunkId: 'source',
      targetChunkId: 'target',
      sourceNode: {
        chunk_id: 'source',
        key_claims: ['Source claim'],
        analyzed_at: '2026-06-24T00:00:00.000Z',
      },
      targetNode: {
        chunk_id: 'target',
        key_claims: ['Target claim'],
        analyzed_at: '2026-06-24T00:00:00.000Z',
      },
      llmClient: llm,
      graphConfig: { enabled: true, classificationPurpose: 'graph-classifier' },
      relations: DEFAULT_GRAPH_RELATIONS,
      promptVersion: 'edge-v1',
      supabase,
    });

    expect(result.status).toBe('classified');
    if (result.status !== 'classified') throw new Error('expected classified');
    expect(result.edges).toEqual([
      expect.objectContaining({
        relation: 'contradicts',
        confidence: 'INFERRED',
        model: 'purpose-graph-model@edge-v1',
        metadata: expect.objectContaining({
          llm_assessment: 'strong',
          source_claims_referenced: [0],
          target_claims_referenced: [0],
        }),
      }),
    ]);
    expect(result.written).toBe(1);
    expect(inserted).toEqual([
      expect.objectContaining({
        instance_id: 'inst',
        source_chunk_id: 'source',
        target_chunk_id: 'target',
        relation: 'contradicts',
        confidence: 'INFERRED',
        confidence_score: 0.88,
        reasoning: 'Claim A conflicts with Claim C.',
        model: 'purpose-graph-model@edge-v1',
      }),
    ]);
    expect(llm.completeByPurpose).toHaveBeenCalledWith(
      'graph-classifier',
      expect.any(Array),
      expect.any(Object),
      'graph-edge-classification:source:target'
    );
  });

  it('routes direct model graph calls with a graph trace id', async () => {
    const llm = mockLlm(nodePayload());
    const result = await resolveGraphLlmCompletion({
      llmClient: llm,
      graphConfig: { enabled: true, classificationModel: 'direct-model' },
      messages: [{ role: 'user', content: 'classify' }],
      traceId: 'graph-node-analysis:chunk-1',
    });

    expect(result.ok).toBe(true);
    expect(llm.complete).toHaveBeenCalledWith(
      'direct-model',
      expect.any(Array),
      expect.any(Object),
      'graph-node-analysis:chunk-1'
    );
  });
});
