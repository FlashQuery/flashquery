import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initLogger } from '../../src/logging/logger.js';
import { createMcpServer } from '../../src/mcp/server.js';
import {
  clearBrokeredToolCallTrace,
  getBrokeredToolCallTraceSnapshot,
} from '../../src/services/mcp-broker/trace.js';

const MCP_ACCEPT = 'application/json, text/event-stream';
const INSTANCE_ID = `mcp-broker-e2e-${randomUUID().slice(0, 8)}`;
const fixtureDir = resolve(fileURLToPath(new URL('../fixtures/mcp-servers', import.meta.url)));
const basicServer = resolve(fixtureDir, 'server-basic.ts');

const MCP_INITIALIZE_REQUEST = {
  jsonrpc: '2.0',
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'mcp-broker-e2e', version: '1.0.0' },
  },
  id: 1,
};

let server: Server;
let port: number;
let vaultPath: string;
let sessionId: string | undefined;

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'MCP Broker E2E',
      id: INSTANCE_ID,
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    server: { host: 'localhost', port: 0 },
    supabase: {
      url: 'http://localhost:54321',
      serviceRoleKey: 'test-key',
      databaseUrl: 'postgresql://localhost',
      skipDdl: true,
    },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'http' },
    locking: { enabled: false, ttlSeconds: 30 },
    trashFolder: { enabled: false, path: '.flashquery/removed', collisionStrategy: 'suffix' },
    hostMcpTools: {
      tools: ['call_macro'],
      excludedTools: [],
    },
    mcpServers: {
      basic: {
        transport: 'stdio',
        command: process.execPath,
        args: ['--import', 'tsx', basicServer],
        env: {},
        costPerCall: 0.125,
        perCallTimeoutMs: 30000,
        toolOverrides: {
          echo: { costPerCall: 0.25 },
        },
      },
    },
    host: { mcpServers: ['basic'], toolSearch: 'disabled' },
    llm: { providers: [], models: [], purposes: [] },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stderr' },
    macro: { defaultTimeoutMs: 60000 },
  } as FlashQueryConfig;
}

function rawHttpRequest(options: {
  method: string;
  headers: Record<string, string>;
  body?: string;
}): Promise<{ status: number; headers: Record<string, string | string[]>; body: string }> {
  return new Promise((resolveRequest, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/mcp',
        method: options.method,
        headers: options.headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          resolveRequest({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[]>,
            body: data,
          });
        });
      }
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function parseSseJsonMessages(body: string): Array<Record<string, unknown>> {
  return [...body.matchAll(/^data:\s*(.+)$/gm)].map((match) => JSON.parse(match[1] ?? '{}') as Record<string, unknown>);
}

function parseToolPayload(response: Record<string, unknown>): Record<string, unknown> {
  const result = response['result'] as Record<string, unknown>;
  const content = result['content'] as Array<Record<string, unknown>>;
  const text = String(content[0]?.['text'] ?? '{}');
  return JSON.parse(text) as Record<string, unknown>;
}

async function initializeSession(id: number): Promise<string> {
  const body = JSON.stringify({ ...MCP_INITIALIZE_REQUEST, id });
  const response = await rawHttpRequest({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: MCP_ACCEPT,
      Host: 'localhost',
      'Content-Length': String(Buffer.byteLength(body)),
    },
    body,
  });
  expect(response.status).toBe(200);
  const nextSessionId = response.headers['mcp-session-id'];
  expect(typeof nextSessionId).toBe('string');
  return nextSessionId as string;
}

async function callMacro(id: number, args: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
  if (sessionId === undefined) throw new Error('MCP session was not initialized.');
  const body = JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'call_macro',
      arguments: args,
    },
    id,
  });
  const response = await rawHttpRequest({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: MCP_ACCEPT,
      Host: 'localhost',
      'mcp-session-id': sessionId,
      'Content-Length': String(Buffer.byteLength(body)),
    },
    body,
  });
  expect(response.status).toBe(200);
  return parseSseJsonMessages(response.body);
}

function responseById(messages: Array<Record<string, unknown>>, id: number): Record<string, unknown> {
  const response = messages.find((message) => message['id'] === id);
  expect(response).toBeDefined();
  return response as Record<string, unknown>;
}

beforeAll(async () => {
  vaultPath = await mkdtemp(join(tmpdir(), 'fq-mcp-broker-e2e-'));
  const config = makeConfig();
  initLogger(config);
  const transports: Record<string, StreamableHTTPServerTransport> = {};
  const app = createMcpExpressApp();

  app.post('/mcp', async (req, res) => {
    const requestSessionId = req.headers['mcp-session-id'] as string | undefined;

    if (requestSessionId && transports[requestSessionId]) {
      await transports[requestSessionId].handleRequest(req, res, req.body);
    } else if (!requestSessionId && isInitializeRequest(req.body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport;
        },
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) delete transports[sid];
      };

      const mcpServer = createMcpServer(config, '0.1.0');
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID' },
        id: null,
      });
    }
  });

  app.get('/mcp', async (req, res) => {
    const requestSessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!requestSessionId || !transports[requestSessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    await transports[requestSessionId].handleRequest(req, res);
  });

  await new Promise<void>((resolveServer, reject) => {
    server = app.listen(0, '127.0.0.1', () => resolveServer()).on('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unexpected server address');
  port = address.port;
  sessionId = await initializeSession(101);
});

afterAll(async () => {
  clearBrokeredToolCallTrace();
  await new Promise<void>((resolveServer, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolveServer();
    });
  });
  await rm(vaultPath, { recursive: true, force: true });
});

describe('Phase A MCP broker E2E', () => {
  it('T-E-A1 invokes a stdio brokered fixture tool through public call_macro and records resolved cost', async () => {
    const messages = await callMacro(102, {
      trace: 'summary',
      source: `
        echoed = basic.echo({ value: { phrase: "broker-ok", count: 1 } })
        exit $echoed
      `,
    });
    const response = responseById(messages, 102);
    const result = response['result'] as Record<string, unknown>;
    const payload = parseToolPayload(response);

    expect(result['isError']).not.toBe(true);
    expect(payload).toMatchObject({
      result: { value: { phrase: 'broker-ok', count: 1 } },
      external_tool_calls: 1,
    });
    expect(JSON.stringify(payload)).not.toContain('No MCP broker is configured');
    expect(getBrokeredToolCallTraceSnapshot(sessionId ?? '')).toEqual([
      { server: 'basic', tool: 'echo', count: 1, cost: 0.25 },
    ]);
  });
});
