/**
 * HTTP Transport Integration Tests
 *
 * Starts a real Express/StreamableHTTP server using the same SDK primitives
 * as production (createMcpExpressApp, StreamableHTTPServerTransport) and
 * exercises it with fetch() and Node http.request(). No Supabase or live
 * subsystems required — the test server registers a single lightweight 'echo' tool.
 *
 * Implementation notes:
 * - MCP Streamable HTTP requires Accept: application/json, text/event-stream on all
 *   POST requests; responses arrive as Server-Sent Events (text/event-stream).
 * - Node's built-in fetch() treats Host as a "forbidden header" (RFC 9110 compliance)
 *   so DNS rebinding tests use Node's http.request() directly to set a custom Host.
 *
 * Tests verify:
 *   HTTP-01: Server starts and accepts MCP initialize requests
 *   HTTP-03: DNS rebinding protection rejects invalid Host headers
 *   HTTP-05: Per-session isolation and session cleanup on DELETE
 *
 * Run: npx vitest run --config vitest.http.config.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { z } from 'zod';
import { generateToken, createAuthMiddleware } from '../../src/mcp/auth.js';
import { initLogger } from '../../src/logging/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Server setup — mirrors production server.ts HTTP path exactly
// ─────────────────────────────────────────────────────────────────────────────

let server: Server;
let port: number;

/**
 * Standard MCP initialize request body per the 2025-03-26 spec.
 */
const MCP_INITIALIZE_REQUEST = {
  jsonrpc: '2.0',
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  },
  id: 1,
};

/**
 * MCP Streamable HTTP requires Accept: application/json, text/event-stream
 * on all POST requests (per spec — server returns 406 without this).
 * Responses arrive as Server-Sent Events (text/event-stream), not plain JSON.
 */
const MCP_ACCEPT = 'application/json, text/event-stream';

/**
 * Factory matching production's createMcpServer() — creates a fresh McpServer
 * with a single 'echo' tool that avoids needing Supabase or vault access.
 */
function createTestMcpServer(): McpServer {
  const mcpServer = new McpServer({ name: 'test-server', version: '0.0.1' });
  mcpServer.tool(
    'echo',
    'Returns the input message unchanged',
    { message: z.string() },
    async ({ message }) => ({
      content: [{ type: 'text' as const, text: message }],
    })
  );
  return mcpServer;
}

beforeAll(async () => {
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  // Same pattern as production server.ts HTTP path (HTTP-01, HTTP-03)
  const app = createMcpExpressApp();

  // POST /mcp — initialize or continue session
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

      const mcpServer = createTestMcpServer();
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

  // GET /mcp — SSE stream for server-initiated notifications
  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  // DELETE /mcp — explicit session termination
  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  // Bind to 127.0.0.1:0 — OS assigns an ephemeral port (avoids conflicts)
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', () => resolve()).on('error', reject);
  });

  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Unexpected server address');
  port = addr.port;
});

afterAll(() => {
  server.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mcpUrl(): string {
  return `http://127.0.0.1:${port}/mcp`;
}

/**
 * Parse the first JSON object out of an SSE response body.
 * MCP Streamable HTTP responses use format:
 *   event: message\ndata: <JSON>\n\n
 */
function parseSseJson(body: string): unknown {
  const dataMatch = body.match(/^data:\s*(.+)$/m);
  if (!dataMatch) throw new Error(`No SSE data line found in body: ${JSON.stringify(body)}`);
  return JSON.parse(dataMatch[1]);
}

/**
 * Low-level HTTP request using Node's http module.
 * Required for tests that need to set a custom Host header —
 * fetch() treats Host as a forbidden header and overrides it.
 */
function rawHttpRequest(options: {
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}): Promise<{ status: number; headers: Record<string, string | string[]>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: options.path,
        method: options.method,
        headers: options.headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[]>,
            body: data,
          })
        );
      }
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('HTTP transport', () => {
  // ── HTTP-01: Server starts and accepts initialize requests ─────────────────

  it('HTTP server starts and accepts MCP initialize request', async () => {
    const bodyStr = JSON.stringify(MCP_INITIALIZE_REQUEST);
    const res = await rawHttpRequest({
      path: '/mcp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: MCP_ACCEPT,
        Host: 'localhost',
        'Content-Length': String(Buffer.byteLength(bodyStr)),
      },
      body: bodyStr,
    });

    expect(res.status).toBe(200);

    const sessionId = res.headers['mcp-session-id'] as string;
    expect(sessionId).toBeTruthy();

    const parsed = parseSseJson(res.body) as Record<string, unknown>;
    expect(parsed).toHaveProperty('result');
    const result = parsed.result as Record<string, unknown>;
    expect(result).toHaveProperty('serverInfo');
  });

  // ── HTTP-03: DNS rebinding protection rejects invalid Host header ──────────

  it('DNS rebinding protection rejects invalid Host header', async () => {
    const bodyStr = JSON.stringify(MCP_INITIALIZE_REQUEST);
    const res = await rawHttpRequest({
      path: '/mcp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: MCP_ACCEPT,
        Host: 'evil.com',
        'Content-Length': String(Buffer.byteLength(bodyStr)),
      },
      body: bodyStr,
    });

    expect(res.status).toBe(403);

    const body = JSON.parse(res.body) as Record<string, unknown>;
    const error = body.error as Record<string, unknown>;
    expect(typeof error.message).toBe('string');
    expect((error.message as string).toLowerCase()).toContain('invalid host');
  });

  // ── HTTP-05a: Per-session isolation — two clients get different sessions ───

  it('per-session isolation: two initialize requests produce different session IDs', async () => {
    const bodyStr1 = JSON.stringify({ ...MCP_INITIALIZE_REQUEST, id: 10 });
    const bodyStr2 = JSON.stringify({ ...MCP_INITIALIZE_REQUEST, id: 11 });

    const [init1, init2] = await Promise.all([
      rawHttpRequest({
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: MCP_ACCEPT,
          Host: 'localhost',
          'Content-Length': String(Buffer.byteLength(bodyStr1)),
        },
        body: bodyStr1,
      }),
      rawHttpRequest({
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: MCP_ACCEPT,
          Host: 'localhost',
          'Content-Length': String(Buffer.byteLength(bodyStr2)),
        },
        body: bodyStr2,
      }),
    ]);

    expect(init1.status).toBe(200);
    expect(init2.status).toBe(200);

    const session1 = init1.headers['mcp-session-id'] as string;
    const session2 = init2.headers['mcp-session-id'] as string;

    expect(session1).toBeTruthy();
    expect(session2).toBeTruthy();
    expect(session1).not.toBe(session2);

    // Both sessions should accept subsequent tools/list requests
    const listBody1 = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', params: {}, id: 20 });
    const listBody2 = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', params: {}, id: 21 });

    const [toolsList1, toolsList2] = await Promise.all([
      rawHttpRequest({
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: MCP_ACCEPT,
          Host: 'localhost',
          'mcp-session-id': session1,
          'Content-Length': String(Buffer.byteLength(listBody1)),
        },
        body: listBody1,
      }),
      rawHttpRequest({
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: MCP_ACCEPT,
          Host: 'localhost',
          'mcp-session-id': session2,
          'Content-Length': String(Buffer.byteLength(listBody2)),
        },
        body: listBody2,
      }),
    ]);

    expect(toolsList1.status).toBe(200);
    expect(toolsList2.status).toBe(200);
  });

  // ── HTTP-05b: Session cleanup on DELETE ────────────────────────────────────

  it('session cleanup: DELETE removes session; subsequent POST returns 400', async () => {
    // Initialize a session
    const initBody = JSON.stringify({ ...MCP_INITIALIZE_REQUEST, id: 30 });
    const init = await rawHttpRequest({
      path: '/mcp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: MCP_ACCEPT,
        Host: 'localhost',
        'Content-Length': String(Buffer.byteLength(initBody)),
      },
      body: initBody,
    });
    expect(init.status).toBe(200);
    const sessionId = init.headers['mcp-session-id'] as string;
    expect(sessionId).toBeTruthy();

    // DELETE the session
    const del = await rawHttpRequest({
      path: '/mcp',
      method: 'DELETE',
      headers: {
        Host: 'localhost',
        'mcp-session-id': sessionId,
        'Content-Length': '0',
      },
    });
    expect(del.status).toBe(200);

    // Subsequent POST with the now-deleted session ID should return 400
    // (server.ts falls through to the "no valid session" else branch)
    const staleBody = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', params: {}, id: 31 });
    const stale = await rawHttpRequest({
      path: '/mcp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: MCP_ACCEPT,
        Host: 'localhost',
        'mcp-session-id': sessionId,
        'Content-Length': String(Buffer.byteLength(staleBody)),
      },
      body: staleBody,
    });
    expect(stale.status).toBe(400);
  });

  // ── Missing session ID on non-initialize request ───────────────────────────

  it('missing session ID on non-initialize POST returns 400', async () => {
    const bodyStr = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', params: {}, id: 40 });
    const res = await rawHttpRequest({
      path: '/mcp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: MCP_ACCEPT,
        Host: 'localhost',
        'Content-Length': String(Buffer.byteLength(bodyStr)),
      },
      body: bodyStr,
    });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bearer token authentication tests (SEC-01 through SEC-04)
// ─────────────────────────────────────────────────────────────────────────────

describe('Bearer token authentication', () => {
  const AUTH_SECRET = 'test-secret-for-ci';
  const AUTH_INSTANCE_ID = 'auth-test-instance';

  let authServer: Server;
  let authPort: number;

  // Build an auth-enabled server for this describe block
  beforeAll(async () => {
    // Initialize logger so auth middleware can log without crashing
    // Suppress at 'error' level so auth info logs don't appear in test output
    initLogger(
      { logging: { level: 'error', output: 'stdout' } } as unknown as import('../../src/config/loader.js').FlashQueryConfig
    );

    const transports: Record<string, StreamableHTTPServerTransport> = {};

    // Mirror production HTTP path, but with createAuthMiddleware applied
    const app = createMcpExpressApp();

    // Apply auth middleware (same pattern as server.ts with authSecret configured)
    app.use('/mcp', createAuthMiddleware(AUTH_SECRET));

    // POST /mcp
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

        const mcpServer = new McpServer({ name: 'auth-test-server', version: '0.0.1' });
        mcpServer.tool(
          'echo',
          'Returns the input message unchanged',
          { message: z.string() },
          async ({ message }) => ({ content: [{ type: 'text' as const, text: message }] })
        );
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

    // GET /mcp
    app.get('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !transports[sessionId]) {
        res.status(400).send('Invalid or missing session ID');
        return;
      }
      await transports[sessionId].handleRequest(req, res);
    });

    // DELETE /mcp
    app.delete('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !transports[sessionId]) {
        res.status(400).send('Invalid or missing session ID');
        return;
      }
      await transports[sessionId].handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      authServer = app.listen(0, '127.0.0.1', () => resolve()).on('error', reject);
    });

    const addr = authServer.address();
    if (!addr || typeof addr === 'string') throw new Error('Unexpected server address');
    authPort = addr.port;
  });

  afterAll(() => {
    authServer.close();
  });

  function authUrl(): string {
    return `http://127.0.0.1:${authPort}/mcp`;
  }

  function rawAuthRequest(options: {
    path: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<{ status: number; headers: Record<string, string | string[]>; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: authPort,
          path: options.path,
          method: options.method,
          headers: options.headers,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => (data += chunk.toString()));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers as Record<string, string | string[]>,
              body: data,
            })
          );
        }
      );
      req.on('error', reject);
      if (options.body) req.write(options.body);
      req.end();
    });
  }

  // ── SEC-01: Valid Bearer token accepted ────────────────────────────────────

  it('HTTP POST /mcp with valid Bearer token is accepted (200)', async () => {
    const validToken = generateToken(AUTH_INSTANCE_ID, AUTH_SECRET);
    const bodyStr = JSON.stringify({ ...MCP_INITIALIZE_REQUEST, id: 100 });

    const res = await rawAuthRequest({
      path: '/mcp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: MCP_ACCEPT,
        Host: 'localhost',
        Authorization: `Bearer ${validToken}`,
        'Content-Length': String(Buffer.byteLength(bodyStr)),
      },
      body: bodyStr,
    });

    // Auth passed — 200 from MCP handler, not 401 from middleware
    expect(res.status).toBe(200);
    const sessionId = res.headers['mcp-session-id'] as string;
    expect(sessionId).toBeTruthy();
  });

  // ── SEC-01: Missing Authorization header returns 401 ───────────────────────

  it('HTTP POST /mcp without Authorization header returns 401 Unauthorized', async () => {
    const bodyStr = JSON.stringify({ ...MCP_INITIALIZE_REQUEST, id: 101 });

    const res = await rawAuthRequest({
      path: '/mcp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: MCP_ACCEPT,
        Host: 'localhost',
        'Content-Length': String(Buffer.byteLength(bodyStr)),
      },
      body: bodyStr,
    });

    expect(res.status).toBe(401);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).toBe('Unauthorized');
  });

  // ── SEC-01: Invalid Bearer token returns 401 ──────────────────────────────

  it('HTTP POST /mcp with invalid Bearer token returns 401 Unauthorized', async () => {
    const invalidToken = generateToken(AUTH_INSTANCE_ID, 'wrong-secret');
    const bodyStr = JSON.stringify({ ...MCP_INITIALIZE_REQUEST, id: 102 });

    const res = await rawAuthRequest({
      path: '/mcp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: MCP_ACCEPT,
        Host: 'localhost',
        Authorization: `Bearer ${invalidToken}`,
        'Content-Length': String(Buffer.byteLength(bodyStr)),
      },
      body: bodyStr,
    });

    expect(res.status).toBe(401);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).toBe('Unauthorized');
  });

  // ── SEC-03: Wrong auth scheme returns 401 ─────────────────────────────────

  it('HTTP POST /mcp with Authorization: Token <valid> (wrong scheme) returns 401', async () => {
    const validToken = generateToken(AUTH_INSTANCE_ID, AUTH_SECRET);
    const bodyStr = JSON.stringify({ ...MCP_INITIALIZE_REQUEST, id: 103 });

    const res = await rawAuthRequest({
      path: '/mcp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: MCP_ACCEPT,
        Host: 'localhost',
        Authorization: `Token ${validToken}`,
        'Content-Length': String(Buffer.byteLength(bodyStr)),
      },
      body: bodyStr,
    });

    expect(res.status).toBe(401);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).toBe('Unauthorized');
  });
});
