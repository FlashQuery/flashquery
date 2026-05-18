import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initLogger } from '../../src/logging/logger.js';
import { OpenAICompatibleLlmClient } from '../../src/llm/client.js';
import { executeAgentLoop } from '../../src/llm/agent-loop.js';
import { createMcpServer } from '../../src/mcp/server.js';
import {
  clearBrokerAuditTrace,
  clearBrokeredToolCallTrace,
  getBrokerAuditTraceSnapshot,
  getBrokeredToolCallTraceSnapshot,
} from '../../src/services/mcp-broker/trace.js';
import { createBroker } from '../../src/services/mcp-broker.js';

const MCP_ACCEPT = 'application/json, text/event-stream';
const INSTANCE_ID = `mcp-broker-e2e-${randomUUID().slice(0, 8)}`;
const fixtureDir = resolve(fileURLToPath(new URL('../fixtures/mcp-servers', import.meta.url)));
const basicServer = resolve(fixtureDir, 'server-basic.ts');
const quirkyServer = resolve(fixtureDir, 'server-quirky.ts');
const stableToolV1 = {
  name: 'stable',
  description: 'Stable test fixture tool.',
  inputSchema: {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
  },
};
const stableToolV2 = {
  name: 'stable',
  description: 'Stable test fixture tool with token.',
  inputSchema: {
    type: 'object',
    properties: { value: { type: 'string' }, token: { type: 'string' } },
    required: ['value', 'token'],
  },
};
const phaseCOverride = 'Override echo brokered diagnostic discovery target.';

type MockResponse = {
  status?: number;
  body: Record<string, unknown>;
};

class ScriptedOpenAiProvider {
  readonly requests: Record<string, unknown>[] = [];
  #server?: Server;
  #script: MockResponse[] = [];

  get endpoint(): string {
    const address = this.#server?.address();
    if (!address || typeof address === 'string') throw new Error('Mock provider is not started.');
    return `http://127.0.0.1:${address.port}`;
  }

  enqueue(script: MockResponse[]): void {
    this.#script.push(...script);
  }

  async start(): Promise<void> {
    this.#server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const rawBody = Buffer.concat(chunks).toString('utf-8');
      this.requests.push(JSON.parse(rawBody) as Record<string, unknown>);
      const next = this.#script.shift() ?? finalTextResponse('fallback final', 1, 1);
      const payload = JSON.stringify(next.body);
      res.writeHead(next.status ?? 200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      });
      res.end(payload);
    });
    await new Promise<void>((resolveStart) => this.#server!.listen(0, '127.0.0.1', resolveStart));
  }

  async stop(): Promise<void> {
    if (!this.#server) return;
    await new Promise<void>((resolveStop) => this.#server!.close(() => resolveStop()));
  }
}

function finalTextResponse(content: string, promptTokens: number, completionTokens: number): MockResponse {
  return {
    body: {
      id: 'chatcmpl-final',
      object: 'chat.completion',
      model: 'agent-model',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
    },
  };
}

function toolCallResponse(toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>, promptTokens = 12, completionTokens = 4): MockResponse {
  return {
    body: {
      id: 'chatcmpl-tools',
      object: 'chat.completion',
      model: 'agent-model',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.args) },
          })),
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
    },
  };
}

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
let provider: ScriptedOpenAiProvider;
const brokers: Array<ReturnType<typeof createBroker>> = [];

function makeConfig(options: { includeLlm?: boolean } = {}): FlashQueryConfig {
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
      tools: options.includeLlm ? ['call_model'] : ['call_macro'],
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
          echo: { costPerCall: 0.25, descriptionOverride: phaseCOverride },
        },
      },
      quirky: {
        transport: 'stdio',
        command: process.execPath,
        args: ['--import', 'tsx', quirkyServer],
        env: {
          QUIRK_INITIAL_TOOLS: JSON.stringify([stableToolV1]),
          QUIRK_LATER_TOOLS: JSON.stringify([stableToolV2]),
          QUIRK_EMIT_LIST_CHANGED_MS: '150',
        },
        costPerCall: 0,
        perCallTimeoutMs: 30000,
        toolOverrides: {},
      },
    },
    host: { mcpServers: ['basic', 'quirky'], toolSearch: 'disabled' },
    ...(options.includeLlm
      ? {
          llm: {
            providers: [{
              name: 'mock',
              type: 'openai-compatible',
              endpoint: provider.endpoint,
              apiKey: 'sk-test',
            }],
            models: [{
              name: 'agent-model',
              providerName: 'mock',
              model: 'agent-model',
              type: 'language',
              costPerMillion: { input: 1, output: 2 },
              capabilities: {
                tool_calling: true,
                usage_on_tool_calls: true,
                strict_tools: true,
                parallel_tool_calls: true,
                structured_outputs_with_tools: true,
              },
            }],
            purposes: [{
              name: 'phase_c_search',
              description: 'Phase C brokered search purpose',
              models: ['agent-model'],
              tools: [],
              mcpServers: ['basic'],
              toolSearch: 'enabled',
              defaults: { max_iterations: 4, timeout_ms: 10000, max_tokens: 64 },
            }],
          },
        }
      : {}),
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
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Failed to parse tool payload JSON: ${text}`, { cause: error });
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
  const nextSessionId = response.headers['mcp-session-id'];
  expect(typeof nextSessionId).toBe('string');
  return nextSessionId as string;
}

async function callTool(id: number, name: string, args: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
  if (sessionId === undefined) throw new Error('MCP session was not initialized.');
  const body = JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name,
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

async function callMacro(id: number, args: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
  return callTool(id, 'call_macro', args);
}

function responseById(messages: Array<Record<string, unknown>>, id: number): Record<string, unknown> {
  const response = messages.find((message) => message['id'] === id);
  expect(response).toBeDefined();
  return response as Record<string, unknown>;
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for E2E condition.');
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
}

beforeAll(async () => {
  vaultPath = await mkdtemp(join(tmpdir(), 'fq-mcp-broker-e2e-'));
  provider = new ScriptedOpenAiProvider();
  await provider.start();
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

      const broker = createBroker(config);
      brokers.push(broker);
      const mcpServer = createMcpServer(config, '0.1.0', { broker });
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
  clearBrokerAuditTrace();
  clearBrokeredToolCallTrace();
  await Promise.allSettled(brokers.splice(0).map((broker) => broker.shutdown(50)));
  await new Promise<void>((resolveServer, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolveServer();
    });
  });
  await rm(vaultPath, { recursive: true, force: true });
  await provider.stop();
});

describe('Phase A MCP broker E2E', () => {
  it('T-E-A1 / T-E-D1 invokes a stdio brokered fixture tool through public call_macro and records host trace scope', async () => {
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
      {
        server: 'basic',
        tool: 'echo',
        count: 1,
        cost: 0.25,
        consumer_kind: 'host',
        trace_id: sessionId,
      },
    ]);
  });
});

describe('Phase B MCP broker E2E', () => {
  it('T-E-B1 surfaces TOFU drift through public call_macro and completes after approval', async () => {
    clearBrokerAuditTrace();

    const firstMessages = await callMacro(201, {
      trace: 'summary',
      source: `
        echoed = quirky.stable({ value: "first" })
        exit $echoed
      `,
    });
    const firstPayload = parseToolPayload(responseById(firstMessages, 201));
    expect(firstPayload).toMatchObject({
      result: { tool: 'stable', arguments: { value: 'first' } },
      external_tool_calls: 1,
    });

    await waitForCondition(() => brokers[0]?.getPendingSchemaDrift().length === 1);

    const driftMessages = await callMacro(202, {
      trace: 'summary',
      source: `
        echoed = quirky.stable({ value: "second", token: "approved" })
        exit $echoed
      `,
    });
    const driftPayload = parseToolPayload(responseById(driftMessages, 202));

    expect(driftPayload).toMatchObject({
      reason: 'needs_user_input',
      payload: {
        event: 'schema_drift_detected',
        server: 'quirky',
        tool: 'stable',
        old_schema: expect.objectContaining({ name: 'stable' }),
        new_schema: expect.objectContaining({ name: 'stable' }),
      },
    });

    const finalMessages = await callMacro(203, {
      trace: 'summary',
      input_vars: {
        frontmatter: {
          user_decisions: {
            quirky__stable: { tofu_decision: 'approve' },
          },
        },
      },
      source: `
        echoed = quirky.stable({ value: "second", token: "approved" })
        exit $echoed
      `,
    });
    const finalPayload = parseToolPayload(responseById(finalMessages, 203));
    expect(finalPayload).toMatchObject({
      result: { tool: 'stable', arguments: { value: 'second', token: 'approved' } },
      external_tool_calls: 1,
    });
    expect(getBrokerAuditTraceSnapshot()).toContainEqual(
      expect.objectContaining({
        type: 'mcp_broker_tofu_decision',
        server: 'quirky',
        tool: 'stable',
        decision: 'approve',
      })
    );
  });
});

describe('Phase C MCP broker E2E', () => {
  it('T-E-C1 discovers and dispatches a brokered tool via fq.search_tools', async () => {
    provider.requests.length = 0;
    provider.enqueue([
      toolCallResponse([{
        id: 'call_search_tools_phase_c',
        name: 'search_tools',
        args: { query: 'override echo brokered diagnostic discovery target', limit: 5 },
      }]),
      toolCallResponse([{
        id: 'call_basic_echo_phase_c',
        name: 'basic__echo',
        args: { value: { phase: 'c', ok: true } },
      }]),
      finalTextResponse('phase c dispatch complete', 25, 7),
    ]);

    const localTransports: Record<string, StreamableHTTPServerTransport> = {};
    const localApp = createMcpExpressApp();
    let localServer: Server | undefined;
    let restServer: Server | undefined;
    let localPort = 0;
    let restPort = 0;
    let localSessionId = '';

    const localRaw = (options: { method: string; headers: Record<string, string>; body?: string }) => new Promise<{
      status: number;
      headers: Record<string, string | string[]>;
      body: string;
    }>((resolveRequest, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: localPort,
        path: '/mcp',
        method: options.method,
        headers: options.headers,
      }, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => resolveRequest({
          status: res.statusCode ?? 0,
          headers: res.headers as Record<string, string | string[]>,
          body: data,
        }));
      });
      req.on('error', reject);
      if (options.body) req.write(options.body);
      req.end();
    });

    localApp.post('/mcp', async (req, res) => {
      const requestSessionId = req.headers['mcp-session-id'] as string | undefined;
      if (requestSessionId && localTransports[requestSessionId]) {
        await localTransports[requestSessionId].handleRequest(req, res, req.body);
      } else if (!requestSessionId && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            localTransports[sid] = transport;
          },
        });
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && localTransports[sid]) delete localTransports[sid];
        };
        const localConfig = makeConfig({ includeLlm: true });
        const localBroker = createBroker(localConfig);
        brokers.push(localBroker);
        const localLlmClient = new OpenAICompatibleLlmClient(localConfig.llm!, localConfig.instance.id);
        const mcpServer = new McpServer({ name: 'phase-c-search-e2e', version: '0.1.0' });
        mcpServer.registerTool(
          'call_model',
          {
            description: 'Phase C test call_model shim.',
            inputSchema: {
              resolver: z.literal('purpose'),
              name: z.string(),
              messages: z.array(z.object({ role: z.string(), content: z.string().nullable().optional() })),
              return_messages: z.boolean().optional(),
              trace_id: z.string().optional(),
            },
          },
          async (args) => {
            const loopEnvelope = await executeAgentLoop({
              instanceId: localConfig.instance.id,
              purposeName: String(args.name),
              initialMessages: args.messages as Array<{ role: 'user' | 'assistant' | 'system'; content: string | null }>,
              nativeToolNames: [],
              providerTools: [],
              nativeToolCatalog: [],
              broker: localBroker,
              toolSearch: 'enabled',
              traceId: args.trace_id ?? null,
              chatByPurpose: localLlmClient.chatByPurposeUnrecorded.bind(localLlmClient),
              recordUsage: () => undefined,
              parameters: { max_iterations: 4, timeout_ms: 10000, max_tokens: 64 },
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify(loopEnvelope) }] };
          }
        );
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } else {
        res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: No valid session ID' }, id: null });
      }
    });

    try {
      restServer = http.createServer((_req, res) => {
        const payload = '[]';
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        });
        res.end(payload);
      });
      await new Promise<void>((resolveServer, reject) => {
        restServer = restServer!.listen(0, '127.0.0.1', () => resolveServer()).on('error', reject);
      });
      const restAddress = restServer.address();
      if (!restAddress || typeof restAddress === 'string') throw new Error('Unexpected REST server address');
      restPort = restAddress.port;

      await new Promise<void>((resolveServer, reject) => {
        localServer = localApp.listen(0, '127.0.0.1', () => resolveServer()).on('error', reject);
      });
      const address = localServer.address();
      if (!address || typeof address === 'string') throw new Error('Unexpected local server address');
      localPort = address.port;
      const initializeBody = JSON.stringify({ ...MCP_INITIALIZE_REQUEST, id: 3010 });
      const initializeResponse = await localRaw({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: MCP_ACCEPT,
          Host: 'localhost',
          'Content-Length': String(Buffer.byteLength(initializeBody)),
        },
        body: initializeBody,
      });
      expect(initializeResponse.status).toBe(200);
      expect(typeof initializeResponse.headers['mcp-session-id']).toBe('string');
      localSessionId = initializeResponse.headers['mcp-session-id'] as string;

      const callBody = JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'call_model',
          arguments: {
      resolver: 'purpose',
      name: 'phase_c_search',
      messages: [{ role: 'user', content: 'Find the brokered echo tool, then call it.' }],
      return_messages: true,
      trace_id: 'trace-phase-c-e2e',
          },
        },
        id: 301,
      });
      const callResponse = await localRaw({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: MCP_ACCEPT,
          Host: 'localhost',
          'mcp-session-id': localSessionId,
          'Content-Length': String(Buffer.byteLength(callBody)),
        },
        body: callBody,
      });
      expect(callResponse.status).toBe(200);
      const messages = parseSseJsonMessages(callResponse.body);
    const response = responseById(messages, 301);
    const envelope = parseToolPayload(response);

    expect(provider.requests[0]).toMatchObject({
      tools: [
        expect.objectContaining({ function: expect.objectContaining({ name: 'search_tools' }) }),
      ],
    });
    expect(JSON.stringify(provider.requests[0]?.['tools'])).not.toContain('basic__echo');

    const toolMessages = (envelope['messages'] as Array<Record<string, unknown>>).filter((message) => message['role'] === 'tool');
    const searchPayload = JSON.parse(String(toolMessages.find((message) => message['tool_call_id'] === 'call_search_tools_phase_c')?.['content'] ?? '{}')) as {
      result?: { content?: Array<{ text?: string }> };
    };
    const searchResults = JSON.parse(searchPayload.result?.content?.[0]?.text ?? '[]') as Array<Record<string, unknown>>;
    expect(searchResults).toContainEqual(expect.objectContaining({
      registry_key: 'basic__echo',
      description: phaseCOverride,
      has_help: false,
    }));
    expect(searchResults.find((result) => result['registry_key'] === 'basic__echo')).not.toHaveProperty('help_hint');

    const dispatchPayload = JSON.parse(String(toolMessages.find((message) => message['tool_call_id'] === 'call_basic_echo_phase_c')?.['content'] ?? '{}')) as {
      ok?: boolean;
      result?: { content?: Array<{ text?: string }> };
    };
    expect(dispatchPayload.ok).toBe(true);
    expect(JSON.parse(dispatchPayload.result?.content?.[0]?.text ?? '{}')).toEqual({ value: { phase: 'c', ok: true } });
    expect(envelope).toMatchObject({ response: 'phase c dispatch complete' });
    } finally {
      if (localServer) {
        await new Promise<void>((resolveServer) => localServer!.close(() => resolveServer()));
      }
      if (restServer) {
        await new Promise<void>((resolveServer) => restServer!.close(() => resolveServer()));
      }
    }
  }, 60000);
});
