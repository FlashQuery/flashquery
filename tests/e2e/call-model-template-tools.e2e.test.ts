import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import * as http from 'node:http';
import { describe, expect, it } from 'vitest';

type MockResponse = { status?: number; body: Record<string, unknown> };
const OPENAI_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function invalidToolNameResponse(name: string): MockResponse {
  return {
    status: 400,
    body: {
      error: {
        message: `Invalid function tool name '${name}'`,
        type: 'invalid_request_error',
      },
    },
  };
}

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
      const requestBody = JSON.parse(rawBody) as Record<string, unknown>;
      this.requests.push(requestBody);
      const invalidToolName = (requestBody.tools as Array<{ function?: { name?: string } }> | undefined)
        ?.map((tool) => tool.function?.name)
        .find((name): name is string => typeof name === 'string' && !OPENAI_TOOL_NAME_PATTERN.test(name));
      const next = invalidToolName !== undefined
        ? invalidToolNameResponse(invalidToolName)
        : this.script.shift() ?? finalTextResponse('fallback final', 1, 1);
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
      id: 'chatcmpl-template-final',
      object: 'chat.completion',
      model: 'template-model',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
    },
  };
}

function toolCallResponse(toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>): MockResponse {
  return {
    body: {
      id: 'chatcmpl-template-tools',
      object: 'chat.completion',
      model: 'template-model',
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
      usage: { prompt_tokens: 12, completion_tokens: 4 },
    },
  };
}

async function writeDoc(vaultPath: string, relPath: string, frontmatter: Record<string, unknown>, body: string): Promise<void> {
  const path = join(vaultPath, relPath);
  await mkdir(dirname(path), { recursive: true });
  const yaml = Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n');
  await writeFile(path, `---\n${yaml}\n---\n\n${body}`);
}

async function withManagedMcp<T>(provider: ScriptedOpenAiProvider, fn: (client: Client, vaultPath: string) => Promise<T>): Promise<T> {
  const tempDir = await mkdtemp(join(tmpdir(), 'fqc-template-tools-e2e-'));
  const configPath = join(tempDir, 'flashquery.yml');
  const vaultPath = join(tempDir, 'vault');
  const entryPoint = resolve('src/index.ts');
  const projectRoot = resolve('.');
  const config = `
instance:
  name: Template Tools E2E
  id: template-tools-e2e
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
templates:
  default_access: permissive
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
    - name: template-model
      provider_name: mock
      model: template-model
      type: language
      cost_per_million: { input: 1, output: 2 }
      capabilities:
        tool_calling: true
        usage_on_tool_calls: true
        strict_tools: true
        parallel_tool_calls: true
        structured_outputs_with_tools: true
  purposes:
    - name: template_agent
      description: Template-only ATL-E2E-04
      models: [template-model]
      templates: [Templates/Research-Skill.md]
      defaults: { max_iterations: 3, timeout_ms: 10000 }
    - name: mixed_agent
      description: Mixed ATL-E2E-05
      models: [template-model]
      tools: [get_document]
      templates: [Templates/Research-Skill.md]
      defaults: { max_iterations: 3, timeout_ms: 10000 }
`;
  await writeFile(configPath, config);
  await writeDoc(vaultPath, 'Templates/Research-Skill.md', {
    fq_template: true,
    fq_expose_as_tool: true,
    fq_namespace: 'skill',
    fq_desc: 'Research skill',
    fq_params: { topic: { type: 'string', required: true } },
  }, 'Research skill says {{topic}}.');
  await writeDoc(vaultPath, 'Docs/Native.md', { fq_status: 'active' }, 'Native document body.');

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', entryPoint, 'start', '--config', configPath],
    stderr: 'pipe',
    env: process.env as Record<string, string>,
    cwd: projectRoot,
  });
  const client = new Client({ name: 'template-tools-e2e', version: '1.0.0' });
  try {
    await client.connect(transport);
    return await fn(client, vaultPath);
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

describe('call_model template-tool masquerade public E2E contracts', () => {
  it('ATL-E2E-04 exposes flashquery_skill_research_skill, dispatches it, and returns hydrated template tool content', async () => {
    const provider = new ScriptedOpenAiProvider([
      toolCallResponse([{ id: 'call_research_skill', name: 'flashquery_skill_research_skill', args: { topic: 'ATL-E2E-04' } }]),
      finalTextResponse('template loop complete', 21, 8),
    ]);
    await provider.start();
    try {
      const envelope = await withManagedMcp(provider, (client) => callModel(client, {
        resolver: 'purpose',
        name: 'template_agent',
        messages: [{ role: 'user', content: 'ATL-E2E-04 use the research skill.' }],
        return_messages: true,
      }));
      expect(provider.requests[0]).toMatchObject({
        tools: expect.arrayContaining([
          expect.objectContaining({ function: expect.objectContaining({ name: 'flashquery_skill_research_skill' }) }),
        ]),
      });
      expect(envelope).toMatchObject({
        response: 'template loop complete',
        metadata: {
          tools: {
            stop_reason: 'final_response',
            calls_log: expect.arrayContaining([
              expect.objectContaining({
                tool_calls: expect.arrayContaining([
                  expect.objectContaining({ kind: 'template', tool_call_id: 'call_research_skill' }),
                ]),
              }),
            ]),
          },
        },
      });
      expect(JSON.stringify(provider.requests[1])).toContain('Research skill says ATL-E2E-04.');
    } finally {
      await provider.stop();
    }
  }, 60000);

  it('ATL-E2E-05 executes native and template tools in one loop and preserves calls-log kind values', async () => {
    const provider = new ScriptedOpenAiProvider([
      toolCallResponse([
        { id: 'call_native_doc', name: 'get_document', args: { identifiers: 'Docs/Native.md' } },
        { id: 'call_template_skill', name: 'flashquery_skill_research_skill', args: { topic: 'ATL-E2E-05' } },
      ]),
      finalTextResponse('mixed loop complete', 24, 9),
    ]);
    await provider.start();
    try {
      const envelope = await withManagedMcp(provider, (client) => callModel(client, {
        resolver: 'purpose',
        name: 'mixed_agent',
        messages: [{ role: 'user', content: 'ATL-E2E-05 use native and template tools.' }],
      }));
      const callsLog = envelope.metadata?.tools?.calls_log as Array<{ tool_calls?: Array<{ kind?: string }> }>;
      const kinds = callsLog.flatMap((entry) => entry.tool_calls ?? []).map((call) => call.kind);
      expect(kinds).toEqual(expect.arrayContaining(['native', 'template']));
      expect(provider.requests[0]).toMatchObject({
        tools: expect.arrayContaining([
          expect.objectContaining({ function: expect.objectContaining({ name: 'get_document' }) }),
          expect.objectContaining({ function: expect.objectContaining({ name: 'flashquery_skill_research_skill' }) }),
        ]),
      });
    } finally {
      await provider.stop();
    }
  }, 60000);
});
