import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initLogger } from '../../src/logging/logger.js';
import { createMcpServer } from '../../src/mcp/server.js';

const MCP_ACCEPT = 'application/json, text/event-stream';
const INSTANCE_ID = `macro-http-e2e-${randomUUID().slice(0, 8)}`;

const MCP_INITIALIZE_REQUEST = {
  jsonrpc: '2.0',
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'macro-call-macro-e2e', version: '1.0.0' },
  },
  id: 1,
};

let server: Server;
let port: number;
let vaultPath: string;

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'Macro Call Macro E2E',
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
      tools: ['write_document', 'search', 'call_macro'],
      excludedTools: [],
    },
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
  return new Promise((resolve, reject) => {
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
          resolve({
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
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Tool response text was not JSON: ${text}`, { cause: error });
  }
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
  const sessionId = response.headers['mcp-session-id'];
  expect(typeof sessionId).toBe('string');
  return sessionId as string;
}

async function callMacro(
  sessionId: string,
  id: number,
  args: Record<string, unknown>,
  meta?: Record<string, unknown>
): Promise<Array<Record<string, unknown>>> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'call_macro',
      arguments: args,
      ...(meta === undefined ? {} : { _meta: meta }),
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
  vaultPath = await mkdtemp(join(tmpdir(), 'fq-macro-call-macro-e2e-'));
  const config = makeConfig();
  initLogger(config);
  const transports: Record<string, StreamableHTTPServerTransport> = {};
  const app = createMcpExpressApp();

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && transports[sessionId]) {
      await transports[sessionId].handleRequest(req, res, req.body);
    } else if (!sessionId && isInitializeRequest(req.body)) {
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
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', () => resolve()).on('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unexpected server address');
  port = address.port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  await rm(vaultPath, { recursive: true, force: true });
});

describe('call_macro real MCP transport', () => {
  it('T-E-001 returns a canonical success envelope for inline source over StreamableHTTPServerTransport', async () => {
    const sessionId = await initializeSession(101);
    const messages = await callMacro(sessionId, 102, { source: 'exit "transport-ok"' });
    const payload = parseToolPayload(responseById(messages, 102));

    expect(payload).toMatchObject({
      task_id: expect.any(String),
      result: 'transport-ok',
    });
  });

  it('T-E-002 returns parsed_ok for dry-run and performs no write side effect', async () => {
    const sessionId = await initializeSession(201);
    const dryRunPath = 'macro-e2e/dry-run.md';
    const messages = await callMacro(sessionId, 202, {
      dry_run: true,
      source: `
        fq.write_document({
          mode: "create",
          path: "${dryRunPath}",
          title: "Macro Dry Run",
          content: "This file must not be written."
        })
      `,
    });
    const payload = parseToolPayload(responseById(messages, 202));

    expect(payload).toMatchObject({
      parsed_ok: true,
      tool_references: ['fq.write_document'],
      server_references: ['fq'],
    });
    expect(existsSync(join(vaultPath, dryRunPath))).toBe(false);
  });

  it('T-E-003 returns parse_error over the real MCP transport with isError false', async () => {
    const sessionId = await initializeSession(301);
    const messages = await callMacro(sessionId, 302, { source: 'for = 5' });
    const response = responseById(messages, 302);
    const result = response['result'] as Record<string, unknown>;
    const payload = parseToolPayload(response);

    expect(result['isError']).toBe(false);
    expect(payload).toMatchObject({
      error: 'parse_error',
      details: {
        reason: 'reserved_keyword_assignment',
        at_line: 1,
        near_token: 'for',
      },
    });
  });

  it('T-E-004 observes notifications/progress with a request progressToken', async () => {
    const sessionId = await initializeSession(401);
    const progressToken = 'macro-progress-token';
    const messages = await callMacro(
      sessionId,
      402,
      {
        source: `
          status --progress 1 --total 2 "halfway"
          exit "done"
        `,
        progress: 'full',
      },
      { progressToken }
    );
    const progress = messages.find((message) => message['method'] === 'notifications/progress');
    const payload = parseToolPayload(responseById(messages, 402));

    expect(progress).toMatchObject({
      method: 'notifications/progress',
      params: {
        progressToken,
        progress: 1,
        total: 2,
        message: 'halfway',
      },
    });
    expect(payload).toMatchObject({
      result: 'done',
    });
  });
});
