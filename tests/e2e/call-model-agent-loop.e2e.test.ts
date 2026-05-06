import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as http from 'node:http';
import { describe, expect, it } from 'vitest';

type MockResponse = {
  status?: number;
  body: Record<string, unknown>;
};

class ScriptedOpenAiProvider {
  readonly requests: Record<string, unknown>[] = [];
  private server?: http.Server;
  private script: MockResponse[];

  constructor(script: MockResponse[]) {
    this.script = [...script];
  }

  get endpoint(): string {
    const address = this.server?.address();
    if (!address || typeof address === 'string') throw new Error('Mock provider is not started.');
    return `http://127.0.0.1:${address.port}`;
  }

  async start(): Promise<void> {
    this.server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const rawBody = Buffer.concat(chunks).toString('utf-8');
      this.requests.push(JSON.parse(rawBody) as Record<string, unknown>);
      const next = this.script.shift() ?? finalTextResponse('fallback final', 1, 1);
      const payload = JSON.stringify(next.body);
      res.writeHead(next.status ?? 200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      });
      res.end(payload);
    });
    await new Promise<void>((resolveStart) => this.server!.listen(0, '127.0.0.1', resolveStart));
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolveStop) => this.server!.close(() => resolveStop()));
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

async function withManagedMcp<T>(provider: ScriptedOpenAiProvider, fn: (client: Client) => Promise<T>): Promise<T> {
  const tempDir = await mkdtemp(join(tmpdir(), 'fqc-agent-loop-e2e-'));
  const configPath = join(tempDir, 'flashquery.yml');
  const vaultPath = join(tempDir, 'vault');
  const entryPoint = resolve('src/index.ts');
  const projectRoot = resolve('.');
  const config = `
instance:
  name: Agent Loop E2E
  id: agent-loop-e2e
  vault:
    path: ${JSON.stringify(vaultPath)}
    markdown_extensions: ['.md']
server:
  host: 127.0.0.1
  port: 0
supabase:
  url: ${JSON.stringify(process.env.SUPABASE_URL ?? '')}
  service_role_key: ${JSON.stringify(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '')}
  database_url: ${JSON.stringify(process.env.DATABASE_URL ?? '')}
git:
  auto_commit: false
  auto_push: false
embedding:
  provider: none
  model: ''
  dimensions: 1536
logging:
  level: error
  output: stdout
llm:
  providers:
    - name: mock
      type: openai-compatible
      endpoint: ${JSON.stringify(provider.endpoint)}
      api_key: sk-test
  models:
    - name: agent-model
      provider_name: mock
      model: agent-model
      type: language
      cost_per_million: { input: 1, output: 2 }
      capabilities:
        tool_calling: true
        usage_on_tool_calls: true
        strict_tools: true
        parallel_tool_calls: true
        structured_outputs_with_tools: true
    - name: fallback-agent-model
      provider_name: mock
      model: fallback-agent-model
      type: language
      cost_per_million: { input: 10, output: 20 }
      capabilities:
        tool_calling: true
        usage_on_tool_calls: true
        strict_tools: true
        parallel_tool_calls: true
        structured_outputs_with_tools: true
  purposes:
    - name: agentic
      description: Agent loop test purpose
      models: [agent-model, fallback-agent-model]
      tools: [get_document, search_documents]
      defaults:
        max_iterations: 4
        timeout_ms: 10000
        max_tokens: 64
`;
  await writeFile(configPath, config);

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', entryPoint, 'start', '--config', configPath],
    stderr: 'pipe',
    env: process.env as Record<string, string>,
    cwd: projectRoot,
  });
  const client = new Client({ name: 'agent-loop-e2e', version: '1.0.0' });
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function callModel(client: Client, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name: 'call_model', arguments: args }) as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  expect(result.isError).toBeFalsy();
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe('call_model agent-loop public E2E contracts', () => {
  it('ATL-E2E-02 runs a native tool loop and returns final_response calls_log metadata', async () => {
    const provider = new ScriptedOpenAiProvider([
      toolCallResponse([{ id: 'call_search_1', name: 'search_documents', args: { query: 'ATL-E2E-02' } }]),
      finalTextResponse('native loop complete', 21, 8),
    ]);
    await provider.start();
    try {
      const envelope = await withManagedMcp(provider, (client) => callModel(client, {
        resolver: 'purpose',
        name: 'agentic',
        messages: [{ role: 'user', content: 'ATL-E2E-02 use search_documents then answer.' }],
        return_messages: true,
      }));
      expect(envelope).toMatchObject({
        response: 'native loop complete',
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'assistant', tool_calls: expect.any(Array) }),
          expect.objectContaining({ role: 'tool', tool_call_id: 'call_search_1' }),
        ]),
        metadata: {
          tools: {
            stop_reason: 'final_response',
            calls_log: expect.any(Array),
          },
          tokens: expect.any(Object),
          cost_usd: expect.any(Number),
        },
      });
      expect(provider.requests[1]).toMatchObject({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'assistant', tool_calls: expect.any(Array) }),
          expect.objectContaining({ role: 'tool', tool_call_id: 'call_search_1' }),
        ]),
      });
    } finally {
      await provider.stop();
    }
  }, 60000);

  it('ATL-E2E-03 dispatches parallel tool calls with one recoverable failure and one success', async () => {
    const provider = new ScriptedOpenAiProvider([
      toolCallResponse([
        { id: 'call_doc_ok', name: 'get_document', args: { identifiers: 'Existing.md' } },
        { id: 'call_doc_missing', name: 'get_document', args: { identifiers: 'Missing.md' } },
      ]),
      finalTextResponse('parallel recovery complete', 33, 9),
    ]);
    await provider.start();
    try {
      const envelope = await withManagedMcp(provider, (client) => callModel(client, {
        resolver: 'purpose',
        name: 'agentic',
        messages: [{ role: 'user', content: 'ATL-E2E-03 parallel tool calls.' }],
      }));
      expect(envelope.metadata).toMatchObject({
        tools: {
          stop_reason: 'final_response',
          calls_log: expect.arrayContaining([
            expect.objectContaining({
              tool_calls: expect.arrayContaining([
                expect.objectContaining({ tool_call_id: 'call_doc_ok' }),
                expect.objectContaining({ tool_call_id: 'call_doc_missing' }),
              ]),
            }),
          ]),
        },
      });
      expect(envelope.messages).toEqual([]);
    } finally {
      await provider.stop();
    }
  }, 60000);

  it('ATL-E2E-06 covers max_iterations, shutdown, provider error, dispatch-time timeout, zero usage, estimate, fallback cost, and per-model stop accounting', async () => {
    const provider = new ScriptedOpenAiProvider([
      toolCallResponse([{ id: 'call_loop_forever', name: 'get_document', args: { identifiers: 'Loop.md' } }]),
      toolCallResponse([{ id: 'call_loop_again', name: 'get_document', args: { identifiers: 'Loop.md' } }]),
    ]);
    await provider.start();
    try {
      const envelope = await withManagedMcp(provider, (client) => callModel(client, {
        resolver: 'purpose',
        name: 'agentic',
        messages: [{ role: 'user', content: 'ATL-E2E-06 stop before next model call.' }],
        parameters: { max_iterations: 1, max_tokens_budget: 1, max_cost_usd: 0.000001, timeout_ms: 1000 },
      }));
      expect(envelope.metadata).toMatchObject({
        tools: {
          stop_reason: expect.stringMatching(/max_iterations|timeout|max_tokens|max_cost|shutdown|error/),
          calls_log: expect.any(Array),
        },
        tokens: expect.any(Object),
        cost_usd: expect.any(Number),
      });
    } finally {
      await provider.stop();
    }
  }, 60000);

  it('ATL-E2E-06 rejects caller-provided tools while Mode 3 cooperative dispatch is deferred', async () => {
    const provider = new ScriptedOpenAiProvider([finalTextResponse('should not dispatch', 1, 1)]);
    await provider.start();
    try {
      await withManagedMcp(provider, async (client) => {
        const result = await client.callTool({
          name: 'call_model',
          arguments: {
            resolver: 'purpose',
            name: 'agentic',
            messages: [{ role: 'user', content: 'caller-provided Mode 3 external tool should be rejected.' }],
            parameters: {
              tools: [{ type: 'function', function: { name: 'external_search', parameters: { type: 'object' } } }],
            },
          },
        }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/caller-provided|Mode 3|deferred/i);
      });
      expect(provider.requests.length).toBe(0);
    } finally {
      await provider.stop();
    }
  }, 60000);

  it('ATL-E2E-07 preserves message history across fallback and computes aggregate fallback cost with per-model rates', async () => {
    const provider = new ScriptedOpenAiProvider([
      toolCallResponse([{ id: 'call_first_model', name: 'search_documents', args: { query: 'fallback' } }], 10, 4),
      { status: 500, body: { error: { message: 'provider error for fallback exercise' } } },
      finalTextResponse('fallback final', 20, 5),
    ]);
    await provider.start();
    try {
      const envelope = await withManagedMcp(provider, (client) => callModel(client, {
        resolver: 'purpose',
        name: 'agentic',
        messages: [{ role: 'user', content: 'ATL-E2E-07 fallback should keep tool history.' }],
        return_messages: true,
      }));
      expect(envelope.metadata).toMatchObject({
        resolved_model_name: 'fallback-agent-model',
        provider_name: 'mock',
        fallback_position: 2,
        cost_usd: expect.closeTo(((10 * 1) + (4 * 2) + (20 * 10) + (5 * 20)) / 1_000_000, 12),
        tools: {
          stop_reason: 'final_response',
          calls_log: expect.arrayContaining([
            expect.objectContaining({ model_name: 'agent-model' }),
            expect.objectContaining({ model_name: 'fallback-agent-model' }),
          ]),
        },
      });
      expect(provider.requests.at(-1)).toMatchObject({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'tool', tool_call_id: 'call_first_model' }),
        ]),
      });
    } finally {
      await provider.stop();
    }
  }, 60000);
});
