import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startMcpServerFixture, stopMcpServerFixture } from '../helpers/mcp-server-fixture.js';
import { cleanupTestRows, setupTestSupabase } from '../helpers/supabase.js';
import { HAS_SUPABASE } from '../helpers/test-env.js';

const E2E_INSTANCE_ID = 'e2e-shutdown-test';
const VAULT_E2E = resolve(process.cwd(), 'tests/fixtures/vault-e2e');

let client: Client;
let transport: StdioClientTransport;

function textOf(result: { content?: Array<{ type: string; text: string }> }): string {
  expect(result.content).toBeDefined();
  expect(result.content?.[0]).toMatchObject({ type: 'text', text: expect.any(String) });
  return result.content![0]!.text;
}

function parseToolJson<T>(result: { content?: Array<{ type: string; text: string }> }): T {
  return JSON.parse(textOf(result)) as T;
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
