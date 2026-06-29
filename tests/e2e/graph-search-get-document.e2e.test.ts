import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startMcpServerFixture, stopMcpServerFixture } from '../helpers/mcp-server-fixture.js';
import { cleanupTestRows, setupTestSupabase } from '../helpers/supabase.js';
import { HAS_SUPABASE } from '../helpers/test-env.js';

const E2E_INSTANCE_ID = 'e2e-shutdown-test';
const VAULT_E2E = resolve(process.cwd(), 'tests/fixtures/vault-e2e');
const GRAPH_CONFIG = resolve(process.cwd(), 'tests/fixtures/flashquery.graph.e2e.yaml');

let client: Client;
let transport: StdioClientTransport;

function textOf(result: { content?: Array<{ type: string; text: string }> }): string {
  expect(result.content).toBeDefined();
  expect(result.content?.[0]).toMatchObject({ type: 'text', text: expect.any(String) });
  return result.content![0]!.text;
}

function parseToolJson<T>(result: { content?: Array<{ type: string; text: string }> }): T {
  const text = textOf(result);
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf('{');
    if (start < 0) throw new Error(`No JSON object found in tool text: ${text}`);
    let depth = 0;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(start, index + 1)) as T;
    }
    throw new Error(`Unterminated JSON object in tool text: ${text}`);
  }
}

function expectBoundedPublicPayload(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toMatch(/sk-[A-Za-z0-9_-]{12,}/);
  expect(serialized).not.toMatch(/postgres(?:ql)?:\/\/[^"\\\s]+/i);
  expect(serialized).not.toMatch(/\b(?:at\s+\S+\s+\(|Error:\s+.*\n\s*at\s+)/);
  expect(serialized).not.toContain('RAW_LLM_COMPLETION_SHOULD_NOT_LEAK');
  expect(serialized.length).toBeLessThan(20_000);
}

describe.skipIf(!HAS_SUPABASE).sequential('graph search and get_document MCP E2E', () => {
  beforeAll(async () => {
    await rm(VAULT_E2E, { recursive: true, force: true });
    await cleanupTestRows(await setupTestSupabase(), E2E_INSTANCE_ID);
    const fixture = await startMcpServerFixture();
    client = fixture.client;
    transport = fixture.transport;
  }, 60_000);

  afterAll(async () => {
    if (client && transport) {
      await stopMcpServerFixture(client, transport);
    }
    await rm(VAULT_E2E, { recursive: true, force: true }).catch(() => undefined);
    await cleanupTestRows(await setupTestSupabase(), E2E_INSTANCE_ID).catch(() => undefined);
  });

  it('T-E-002 calls graph-expanded search and graph-aware get_document through MCP transport', async () => {
    const create = await client.callTool({
      name: 'write_document',
      arguments: {
        mode: 'create',
        path: 'graph-e2e/seed.md',
        title: 'Graph E2E Seed',
        content: 'Graph E2E Seed body for public transport validation.',
        tags: ['graph-e2e'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    const created = parseToolJson<{ fq_id: string; path: string }>(create);
    expect(create.isError).toBeFalsy();
    expect(created.fq_id).toEqual(expect.any(String));

    const search = await client.callTool({
      name: 'search',
      arguments: {
        query: 'Graph E2E Seed',
        mode: 'filesystem',
        entity_types: ['documents'],
        graph_expand: true,
        graph_max_depth: 2,
        include_community: true,
        limit: 5,
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    const searchPayload = parseToolJson<{
      results: Array<{ path: string; match_source?: string[]; graph_context?: unknown }>;
      warnings?: string[];
    }>(search);
    expect(search.isError).toBeFalsy();
    expect(searchPayload.results.map((result) => result.path)).toContain('graph-e2e/seed.md');
    expect(searchPayload.warnings ?? []).toEqual(expect.arrayContaining(['graph_disabled']));
    expectBoundedPublicPayload(searchPayload);

    const document = await client.callTool({
      name: 'get_document',
      arguments: {
        identifiers: created.fq_id,
        include: ['graph_summary'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    const documentPayload = parseToolJson<{
      fq_id: string;
      graph_summary: {
        edge_count: number;
        edge_counts_by_relation: Record<string, number>;
        stale_edge_count: number;
      };
    }>(document);
    expect(document.isError).toBeFalsy();
    expect(documentPayload).toMatchObject({
      fq_id: created.fq_id,
      graph_summary: {
        edge_count: expect.any(Number),
        edge_counts_by_relation: expect.any(Object),
        stale_edge_count: expect.any(Number),
      },
    });
    expectBoundedPublicPayload(documentPayload);
  }, 60_000);

  it('graph-aware get_document connections return a bounded JSON envelope when no graph edges exist', async () => {
    const result = await client.callTool({
      name: 'get_document',
      arguments: {
        identifiers: 'graph-e2e/seed.md',
        include: ['connections'],
        connections: { graph_limit_per_chunk: 2 },
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    const payload = parseToolJson<Record<string, unknown>>(result);

    expect(payload).toMatchObject({
      path: 'graph-e2e/seed.md',
      connections: {
        overall: [],
        source_chunks: expect.any(Array),
      },
    });
    expect(result.isError).not.toBe(true);
    expectBoundedPublicPayload(payload);
  }, 30_000);
});

describe.skipIf(!HAS_SUPABASE).sequential('graph get_document MCP E2E with graph rows', () => {
  let graphClient: Client;
  let graphTransport: StdioClientTransport;

  beforeAll(async () => {
    await rm(VAULT_E2E, { recursive: true, force: true });
    await cleanupTestRows(await setupTestSupabase(), E2E_INSTANCE_ID);
    const fixture = await startMcpServerFixture({ configPath: GRAPH_CONFIG });
    graphClient = fixture.client;
    graphTransport = fixture.transport;
  }, 60_000);

  afterAll(async () => {
    if (graphClient && graphTransport) {
      await stopMcpServerFixture(graphClient, graphTransport);
    }
    await rm(VAULT_E2E, { recursive: true, force: true }).catch(() => undefined);
    await cleanupTestRows(await setupTestSupabase(), E2E_INSTANCE_ID).catch(() => undefined);
  });

  it('T-E-001 returns promoted connection target fields through MCP transport', async () => {
    const pgClient = await setupTestSupabase();
    const sourceDoc = randomUUID();
    const targetDoc = randomUUID();
    const missingDoc = randomUUID();
    const sourceChunk = randomUUID();
    const targetChunk = randomUUID();
    const missingChunk = randomUUID();
    const sourcePath = 'graph-e2e/source.md';
    const targetPath = 'graph-e2e/target.md';
    const missingPath = 'graph-e2e/unanalyzed.md';
    for (const [path, title] of [[sourcePath, 'Source'], [targetPath, 'Target'], [missingPath, 'Unanalyzed']]) {
      const fullPath = resolve(VAULT_E2E, path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, `# ${title}\n\n${title} body`, 'utf-8');
    }

    await pgClient.query(
      `INSERT INTO fqc_documents (id, instance_id, path, title, tags, status)
       VALUES ($1, $2, $3, 'Source', ARRAY['graph-e2e'], 'active'),
              ($4, $2, $5, 'Target', ARRAY['graph-e2e'], 'active'),
              ($6, $2, $7, 'Unanalyzed', ARRAY['graph-e2e'], 'active')`,
      [sourceDoc, E2E_INSTANCE_ID, sourcePath, targetDoc, targetPath, missingDoc, missingPath]
    );
    await pgClient.query(
      `INSERT INTO fqc_chunks (id, instance_id, document_id, heading_path, heading_level, breadcrumb, content, content_hash, chunk_index)
       VALUES ($1, $2, $3, 'Source Graph Seed', 1, 'Source Graph Seed', 'Source chunk body', 'hash-source', 90),
              ($4, $2, $5, 'Target Graph Seed', 1, 'Target Graph Seed', 'Target chunk body', 'hash-target', 91),
              ($6, $2, $7, 'Unanalyzed Graph Seed', 1, 'Unanalyzed Graph Seed', 'Unanalyzed chunk body', 'hash-unanalyzed', 92)`,
      [sourceChunk, E2E_INSTANCE_ID, sourceDoc, targetChunk, targetDoc, missingChunk, missingDoc]
    );
    await graphClient.callTool({
      name: 'get_document',
      arguments: { identifiers: sourcePath, include: ['connections'], connections: { graph_limit_per_chunk: 1 } },
    });
    const scannedSource = await pgClient.query<{ id: string; content_hash: string | null }>(
      `SELECT id::text AS id, content_hash
       FROM fqc_chunks
       WHERE instance_id = $1 AND document_id = $2 AND chunk_index = 0
       ORDER BY id
       LIMIT 1`,
      [E2E_INSTANCE_ID, sourceDoc]
    );
    const graphSourceChunk = scannedSource.rows[0]?.id ?? sourceChunk;
    const graphSourceHash = scannedSource.rows[0]?.content_hash ?? 'hash-source';
    await pgClient.query(
      `INSERT INTO fqc_graph_nodes (
         chunk_id, instance_id, question_status, community_id, community_label,
         chunk_summary, analyzed_content_hash, analyzed_at
       )
       VALUES ($1, $2, NULL, NULL, NULL, NULL, 'hash-source', '2026-06-29T00:00:00Z'::timestamptz),
              ($3, $2, 'open', 'comm-e2e', 'E2E Cluster', 'Target summary', 'hash-target', '2026-06-29T00:00:00Z'::timestamptz),
              ($4, $2, NULL, NULL, NULL, NULL, NULL, NULL)
       ON CONFLICT (chunk_id) DO UPDATE
       SET question_status = EXCLUDED.question_status,
           community_id = EXCLUDED.community_id,
           community_label = EXCLUDED.community_label,
           chunk_summary = EXCLUDED.chunk_summary,
           analyzed_content_hash = EXCLUDED.analyzed_content_hash,
           analyzed_at = EXCLUDED.analyzed_at`,
      [graphSourceChunk, E2E_INSTANCE_ID, targetChunk, missingChunk]
    );
    await pgClient.query(
      `UPDATE fqc_graph_nodes
       SET analyzed_content_hash = $3
       WHERE instance_id = $1 AND chunk_id = $2`,
      [E2E_INSTANCE_ID, graphSourceChunk, graphSourceHash]
    );
    await pgClient.query(
      `INSERT INTO fqc_graph_edges (instance_id, source_chunk_id, target_chunk_id, relation, confidence, confidence_score, reasoning, status)
       VALUES ($1, $2, $3, 'supports', 'INFERRED', 0.9, 'target support', 'active'),
              ($1, $2, $4, 'mentions', 'INFERRED', 0.7, 'missing analysis', 'active')`,
      [E2E_INSTANCE_ID, graphSourceChunk, targetChunk, missingChunk]
    );
    await pgClient.end().catch(() => undefined);

    const result = await graphClient.callTool({
      name: 'get_document',
      arguments: {
        identifiers: sourcePath,
        include: ['connections'],
        connections: { graph_limit_per_chunk: 10 },
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    const payload = parseToolJson<{
      connections: { overall: Array<{ relation?: string; community_label?: string | null; target: Record<string, unknown> }> };
    }>(result);
    expect(payload, JSON.stringify(payload)).toHaveProperty('connections');
    const byPath = new Map(payload.connections.overall.map((connection) => [connection.target.path, connection]));

    expect(byPath.get(targetPath), JSON.stringify(payload)).toMatchObject({
      relation: 'supports',
      community_label: 'E2E Cluster',
      target: {
        chunk_summary: 'Target summary',
        stale: false,
        community_id: 'comm-e2e',
      },
    });
    expect(byPath.get(missingPath)?.target).toMatchObject({
      chunk_summary: null,
      stale: true,
      analyzed_at: null,
      community_id: null,
    });
    expectBoundedPublicPayload(payload);
  }, 60_000);
});
