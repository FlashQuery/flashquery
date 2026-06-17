import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import matter from 'gray-matter';
import pg from 'pg';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { FM } from '../../../src/constants/frontmatter-fields.js';
import { computeVersionToken } from '../../../src/mcp/utils/document-version.js';
import { registerDocumentTools } from '../../../src/mcp/tools/documents.js';
import {
  createEmbeddingSearchHarness,
  destroyEmbeddingSearchHarness,
  parseToolJson,
  type EmbeddingSearchHarness,
} from './search-test-helpers.js';
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
  tags?: string[];
  chunks: Array<{ heading: string; content: string; vector: number[] }>;
}): Promise<{ documentId: string; chunkIds: string[] }> {
  const documentId = randomUUID();
  const body = input.chunks
    .map((chunk) => `## ${chunk.heading}\n\n${chunk.content}`)
    .join('\n\n');
  const raw = matter.stringify(body, {
    [FM.ID]: documentId,
    [FM.TITLE]: input.title,
    [FM.STATUS]: 'active',
    [FM.TAGS]: input.tags ?? ['connections-it'],
  });
  await mkdir(dirname(join(input.harness.vaultPath, input.path)), { recursive: true });
  await writeFile(join(input.harness.vaultPath, input.path), raw, 'utf-8');

  await input.harness.client.query(
    `INSERT INTO fqc_documents (id, instance_id, path, title, tags, status, content_hash)
     VALUES ($1, $2, $3, $4, $5, 'active', $6)`,
    [
      documentId,
      input.harness.config.instance.id,
      input.path,
      input.title,
      input.tags ?? ['connections-it'],
      computeVersionToken(raw),
    ]
  );

  const chunkIds: string[] = [];
  for (const [index, chunk] of input.chunks.entries()) {
    const chunkId = randomUUID();
    chunkIds.push(chunkId);
    await input.harness.client.query(
      `INSERT INTO fqc_chunks (
         id, instance_id, document_id, heading_path, heading_level, breadcrumb,
         content, content_hash, chunk_index, embedding_primary, embedding_primary_model,
         embedding_primary_dimensions, embedding_primary_provider, embedding_primary_truncated,
         embedding_primary_indexed_at
       )
       VALUES (
         $1, $2, $3, $4, 2, $4,
         $5, $6, $7, $8::vector, 'model-primary',
         3, 'integration', false, now()
       )`,
      [
        chunkId,
        input.harness.config.instance.id,
        documentId,
        chunk.heading,
        chunk.content,
        `hash-${chunkId}`,
        index,
        vectorLiteral(chunk.vector),
      ]
    );
  }

  return { documentId, chunkIds };
}

describe.skipIf(!HAS_SUPABASE).sequential('get_document connections integration', () => {
  let harness: EmbeddingSearchHarness | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (harness) {
      await destroyEmbeddingSearchHarness(harness, [ENTRY_PRIMARY]);
      harness = undefined;
    }
  });

  it('returns stored chunk-vector connections through get_document without embedding query text', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('query embedding should not run'));
    harness = await createEmbeddingSearchHarness({
      instanceId: 'get-document-connections-it',
      entries: [{ name: ENTRY_PRIMARY }],
    });
    const docs = captureDocumentServer(harness);

    const source = await insertDocument({
      harness,
      path: 'Source.md',
      title: 'Source',
      chunks: [
        { heading: 'Source Alpha', content: 'source alpha', vector: [1, 0, 0] },
        { heading: 'Source Beta', content: 'source beta', vector: [0, 1, 0] },
      ],
    });
    await insertDocument({
      harness,
      path: 'Alpha.md',
      title: 'Alpha',
      chunks: [{ heading: 'Alpha', content: 'alpha target', vector: [0.9, 0.1, 0] }],
    });
    await insertDocument({
      harness,
      path: 'Beta.md',
      title: 'Beta',
      chunks: [{ heading: 'Beta', content: 'beta target', vector: [0, 0.8, 0.2] }],
    });
    await insertDocument({
      harness,
      path: 'Gamma.md',
      title: 'Gamma',
      chunks: [{ heading: 'Gamma', content: 'gamma target', vector: [0.6, 0.4, 0] }],
    });

    const result = await docs.getDocument({
      identifiers: 'Source.md',
      include: ['connections'],
      connections: { limit: 3, limit_per_chunk: 3, embedding_names: [ENTRY_PRIMARY] },
    });
    const payload = parseToolJson<{
      fq_id: string;
      connections: {
        overall: Array<{ score: number; target: { document_id: string; path: string } }>;
        source_chunks: Array<{ chunk_id: string; heading_path?: string; connections: Array<{ target: { path: string } }> }>;
      };
    }>(result);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payload.fq_id).toBe(source.documentId);
    expect(payload).not.toHaveProperty('overall');
    expect(payload.connections.overall.map((connection) => connection.target.path)).toEqual([
      'Alpha.md',
      'Beta.md',
      'Gamma.md',
    ]);
    expect(payload.connections.overall.map((connection) => connection.score)).toEqual(
      [...payload.connections.overall.map((connection) => connection.score)].sort((left, right) => right - left)
    );
    expect(payload.connections.overall.every((connection) => connection.target.document_id !== source.documentId)).toBe(true);
    expect(payload.connections.source_chunks.map((chunk) => chunk.chunk_id)).toEqual(source.chunkIds);
    expect(payload.connections.source_chunks[0]?.connections.map((connection) => connection.target.path)).toContain('Alpha.md');
    expect(payload.connections.source_chunks[1]?.connections.map((connection) => connection.target.path)).toContain('Beta.md');
  }, 120_000);
});
