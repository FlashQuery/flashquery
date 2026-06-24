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
  expect(serialized).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
  expect(serialized).not.toMatch(/\b(?:at\s+\S+\s+\(|Error:\s+.*\n\s*at\s+)/);
  expect(serialized).not.toContain('RAW_LLM_COMPLETION_SHOULD_NOT_LEAK');
  expect(serialized.length).toBeLessThan(20_000);
}

describe.skipIf(!HAS_SUPABASE).sequential('graph query MCP E2E', () => {
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

  it('T-E-001 calls query_graph through MCP transport and receives a JSON response envelope', async () => {
    const result = await client.callTool({
      name: 'query_graph',
      arguments: { action: 'schema' },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    const payload = parseToolJson<{
      ok?: boolean;
      action?: string;
      data?: unknown;
      error?: string;
      details?: { code?: string };
    }>(result);

    expectBoundedPublicPayload(payload);
    if (payload.ok === true) {
      expect(result.isError).toBeFalsy();
      expect(payload).toMatchObject({
        action: 'schema',
        data: expect.any(Object),
      });
      return;
    }

    expect(result.isError).not.toBe(true);
    expect(payload).toMatchObject({
      error: 'unsupported',
      details: { code: 'graph_disabled' },
    });
  }, 30_000);

  it('query_graph expected errors stay JSON-shaped and bounded', async () => {
    const result = await client.callTool({
      name: 'query_graph',
      arguments: { action: 'neighbors' },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    const payload = parseToolJson<Record<string, unknown>>(result);
    expect(payload).toHaveProperty('error');
    expect(result.isError).not.toBe(true);
    expectBoundedPublicPayload(payload);
  }, 30_000);
});
