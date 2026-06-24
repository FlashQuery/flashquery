import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import matter from 'gray-matter';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { FM } from '../../../src/constants/frontmatter-fields.js';
import { computeVersionToken } from '../../../src/mcp/utils/document-version.js';
import { registerDocumentTools } from '../../../src/mcp/tools/documents.js';
import {
  createEmbeddingSearchHarness,
  destroyEmbeddingSearchHarness,
  parseToolJson,
  type EmbeddingSearchHarness,
} from '../embedding/search-test-helpers.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const ENTRY_PRIMARY = 'primary';

interface CapturedDocumentServer {
  getDocument(params: Record<string, unknown>): Promise<unknown>;
}

function captureDocumentServer(harness: EmbeddingSearchHarness): CapturedDocumentServer {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers[name] = handler;
    },
  } as unknown as McpServer;
  registerDocumentTools(server, harness.config);
  return {
    getDocument: (params) => handlers.get_document!(params),
  };
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

async function insertDocument(input: {
  harness: EmbeddingSearchHarness;
  path: string;
  title: string;
  status?: 'active' | 'archived';
  vector?: number[];
  frontmatter?: Record<string, unknown>;
}): Promise<{ documentId: string; chunkId: string }> {
  const documentId = randomUUID();
  const chunkId = randomUUID();
  const body = `## ${input.title}\n\nBody for ${input.title}`;
  const raw = matter.stringify(body, {
    [FM.ID]: documentId,
    [FM.TITLE]: input.title,
    [FM.STATUS]: input.status ?? 'active',
    [FM.TAGS]: ['get-document-graph-it'],
    ...(input.frontmatter ?? {}),
  });
  await mkdir(dirname(join(input.harness.vaultPath, input.path)), { recursive: true });
  await writeFile(join(input.harness.vaultPath, input.path), raw, 'utf-8');

  await input.harness.client.query(
    `INSERT INTO fqc_documents (id, instance_id, path, title, tags, status, content_hash)
     VALUES ($1, $2, $3, $4, ARRAY['get-document-graph-it'], $5, $6)`,
    [
      documentId,
      input.harness.config.instance.id,
      input.path,
      input.title,
      input.status ?? 'active',
      computeVersionToken(raw),
    ]
  );
  await input.harness.client.query(
    `INSERT INTO fqc_chunks (
       id, instance_id, document_id, heading_path, heading_level, breadcrumb,
       content, content_hash, chunk_index, embedding_primary, embedding_primary_model,
       embedding_primary_dimensions, embedding_primary_provider, embedding_primary_truncated,
       embedding_primary_indexed_at
     )
     VALUES (
       $1, $2, $3, $4, 2, $4,
       $5, $6, 0, $7::vector, 'model-primary',
       3, 'integration', false, now()
     )`,
    [
      chunkId,
      input.harness.config.instance.id,
      documentId,
      input.title,
      `Body for ${input.title}`,
      `hash-${chunkId}`,
      vectorLiteral(input.vector ?? [1, 0, 0]),
    ]
  );
  await input.harness.client.query(
    `INSERT INTO fqc_graph_nodes (
       chunk_id, instance_id, question_status, community_id, community_label, community_summary
     )
     VALUES ($1, $2, NULL, NULL, NULL, NULL)`,
    [chunkId, input.harness.config.instance.id]
  );
  return { documentId, chunkId };
}

async function addGraphNodeMetadata(
  harness: EmbeddingSearchHarness,
  input: { chunkId: string; questionStatus?: string | null; communityId?: string | null; communityLabel?: string | null }
): Promise<void> {
  await harness.client.query(
    `UPDATE fqc_graph_nodes
     SET question_status = $3, community_id = $4, community_label = $5, community_summary = $5
     WHERE instance_id = $1 AND chunk_id = $2`,
    [
      harness.config.instance.id,
      input.chunkId,
      input.questionStatus ?? null,
      input.communityId ?? null,
      input.communityLabel ?? null,
    ]
  );
}

async function addGraphEdge(
  harness: EmbeddingSearchHarness,
  input: {
    sourceChunkId: string;
    targetChunkId: string;
    relation: string;
    confidenceScore: number;
    reasoning?: string | null;
    status?: 'active' | 'stale';
  }
): Promise<void> {
  await harness.client.query(
    `INSERT INTO fqc_graph_edges (
       instance_id, source_chunk_id, target_chunk_id, relation,
       confidence, confidence_score, reasoning, status
     )
     VALUES ($1, $2, $3, $4, 'INFERRED', $5, $6, $7)`,
    [
      harness.config.instance.id,
      input.sourceChunkId,
      input.targetChunkId,
      input.relation,
      input.confidenceScore,
      input.reasoning ?? null,
      input.status ?? 'active',
    ]
  );
}

describe.skipIf(!HAS_SUPABASE).sequential('get_document graph output integration', () => {
  let harness: EmbeddingSearchHarness | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (harness) {
      await destroyEmbeddingSearchHarness(harness, [ENTRY_PRIMARY]);
      harness = undefined;
    }
  });

  it('T-I-013 returns graph_summary counts and flags from stored graph rows without LLM calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('LLM calls are not allowed during get_document graph_summary'));
    harness = await createEmbeddingSearchHarness({
      instanceId: 'get-document-graph-summary-it',
      entries: [{ name: ENTRY_PRIMARY }],
    });
    const docs = captureDocumentServer(harness);
    const source = await insertDocument({ harness, path: 'Source.md', title: 'Source' });
    const target = await insertDocument({ harness, path: 'Target.md', title: 'Target' });
    await addGraphNodeMetadata(harness, {
      chunkId: source.chunkId,
      questionStatus: 'open',
      communityId: 'comm-a',
      communityLabel: 'Claims',
    });
    await addGraphEdge(harness, {
      sourceChunkId: source.chunkId,
      targetChunkId: target.chunkId,
      relation: 'contradicts',
      confidenceScore: 0.83,
      reasoning: 'conflicting stored claim',
    });
    await addGraphEdge(harness, {
      sourceChunkId: target.chunkId,
      targetChunkId: source.chunkId,
      relation: 'supports',
      confidenceScore: 0.72,
      status: 'stale',
    });

    const result = await docs.getDocument({
      identifiers: 'Source.md',
      include: ['graph_summary'],
    });
    const payload = parseToolJson<{
      graph_summary: {
        edge_count: number;
        edge_counts_by_relation: Record<string, number>;
        stale_edge_count: number;
        community_labels: string[];
        has_contradictions: boolean;
        has_open_questions: boolean;
        open_question_count: number;
      };
    }>(result);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload.graph_summary).toMatchObject({
      edge_count: 2,
      edge_counts_by_relation: { contradicts: 1, supports: 1 },
      stale_edge_count: 1,
      community_labels: ['Claims'],
      has_contradictions: true,
      has_open_questions: true,
      open_question_count: 1,
    });
  }, 120_000);

  it('returns graph_summary for follow_ref targets when requested', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'get-document-follow-ref-graph-summary-it',
      entries: [{ name: ENTRY_PRIMARY }],
    });
    const docs = captureDocumentServer(harness);
    const target = await insertDocument({ harness, path: 'Target.md', title: 'Target' });
    const source = await insertDocument({
      harness,
      path: 'Source.md',
      title: 'Source',
      frontmatter: { related_doc: 'Target.md' },
    });
    await addGraphNodeMetadata(harness, {
      chunkId: target.chunkId,
      questionStatus: 'open',
      communityId: 'comm-target',
      communityLabel: 'Referenced Claims',
    });
    await addGraphEdge(harness, {
      sourceChunkId: target.chunkId,
      targetChunkId: source.chunkId,
      relation: 'contradicts',
      confidenceScore: 0.91,
      reasoning: 'target-level stored contradiction',
    });

    const result = await docs.getDocument({
      identifiers: 'Source.md',
      follow_ref: 'related_doc',
      include: ['graph_summary'],
    });
    const payload = parseToolJson<{
      graph_summary?: unknown;
      followed_ref: {
        resolved_to: string;
        graph_summary: {
          edge_count: number;
          has_contradictions: boolean;
          has_open_questions: boolean;
          community_labels: string[];
        };
      };
    }>(result);

    expect(payload.graph_summary).toBeUndefined();
    expect(payload.followed_ref.resolved_to).toBe('Target.md');
    expect(payload.followed_ref.graph_summary).toMatchObject({
      edge_count: 1,
      has_contradictions: true,
      has_open_questions: true,
      community_labels: ['Referenced Claims'],
    });
  }, 120_000);

  it('T-I-014/T-I-015/T-I-016 returns graph-primary connections with explicit embedding-only and inactive opt-ins', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'get-document-graph-connections-it',
      entries: [{ name: ENTRY_PRIMARY }],
    });
    const docs = captureDocumentServer(harness);
    const source = await insertDocument({ harness, path: 'Source.md', title: 'Source', vector: [1, 0, 0] });
    const graphTarget = await insertDocument({ harness, path: 'Graph.md', title: 'Graph', vector: [0, 1, 0] });
    const archivedTarget = await insertDocument({ harness, path: 'Archived.md', title: 'Archived', status: 'archived', vector: [0, 0, 1] });
    await insertDocument({ harness, path: 'Embedding.md', title: 'Embedding', vector: [0.95, 0.05, 0] });
    await addGraphNodeMetadata(harness, {
      chunkId: graphTarget.chunkId,
      questionStatus: 'open',
      communityId: 'comm-a',
      communityLabel: 'Claims',
    });
    await addGraphEdge(harness, {
      sourceChunkId: source.chunkId,
      targetChunkId: graphTarget.chunkId,
      relation: 'supports',
      confidenceScore: 0.92,
      reasoning: 'stored graph support',
    });
    await addGraphEdge(harness, {
      sourceChunkId: source.chunkId,
      targetChunkId: archivedTarget.chunkId,
      relation: 'references',
      confidenceScore: 1,
    });

    const graphOnly = parseToolJson<{
      connections: { overall: Array<{ basis: string; relation?: string; target: { path: string } }> };
    }>(await docs.getDocument({
      identifiers: 'Source.md',
      include: ['connections'],
      connections: { graph_limit_per_chunk: 5, embedding_names: [ENTRY_PRIMARY] },
    }));
    expect(graphOnly.connections.overall.map((connection) => connection.target.path)).toEqual(['Graph.md']);
    expect(graphOnly.connections.overall[0]).toMatchObject({
      basis: 'graph',
      relation: 'supports',
    });

    const withEmbeddingOnly = parseToolJson<{
      connections: { overall: Array<{ basis: string; target: { path: string } }> };
    }>(await docs.getDocument({
      identifiers: 'Source.md',
      include: ['connections'],
      connections: {
        graph_limit_per_chunk: 5,
        embedding_limit_per_chunk: 5,
        include_embedding_only: true,
        embedding_names: [ENTRY_PRIMARY],
      },
    }));
    expect(withEmbeddingOnly.connections.overall.map((connection) => [connection.basis, connection.target.path])).toEqual([
      ['graph', 'Graph.md'],
      ['embedding', 'Embedding.md'],
    ]);

    const withInactive = parseToolJson<{
      connections: { overall: Array<{ basis: string; target: { path: string; document_status?: string } }> };
    }>(await docs.getDocument({
      identifiers: 'Source.md',
      include: ['connections'],
      connections: {
        graph_limit_per_chunk: 5,
        include_inactive_targets: true,
        embedding_names: [ENTRY_PRIMARY],
      },
    }));
    expect(withInactive.connections.overall.map((connection) => connection.target.path)).toEqual([
      'Archived.md',
      'Graph.md',
    ]);
    expect(withInactive.connections.overall.find((connection) => connection.target.path === 'Archived.md')?.target.document_status).toBe('archived');
  }, 120_000);

  it('T-I-027/T-I-039 preserves legacy limit_per_chunk unless graph-aware options are present', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'get-document-graph-limit-validation-it',
      entries: [{ name: ENTRY_PRIMARY }],
    });
    const docs = captureDocumentServer(harness);
    await insertDocument({ harness, path: 'Source.md', title: 'Source', vector: [1, 0, 0] });
    await insertDocument({ harness, path: 'Legacy.md', title: 'Legacy', vector: [0.95, 0.05, 0] });

    const legacy = parseToolJson<{
      connections: { overall: Array<{ target: { path: string } }> };
    }>(await docs.getDocument({
      identifiers: 'Source.md',
      include: ['connections'],
      connections: { limit_per_chunk: 1, embedding_names: [ENTRY_PRIMARY] },
    }));
    expect(legacy.connections.overall.map((connection) => connection.target.path)).toEqual(['Legacy.md']);

    const invalid = parseToolJson<{
      error: string;
      message: string;
      details: { replacements: string[] };
    }>(await docs.getDocument({
      identifiers: 'Source.md',
      include: ['connections'],
      connections: {
        limit_per_chunk: 1,
        graph_limit_per_chunk: 1,
      },
    }));
    expect(invalid).toMatchObject({
      error: 'invalid_input',
      message: expect.stringContaining('embedding_limit_per_chunk'),
      details: {
        replacements: ['graph_limit_per_chunk', 'embedding_limit_per_chunk'],
      },
    });
  }, 120_000);
});
