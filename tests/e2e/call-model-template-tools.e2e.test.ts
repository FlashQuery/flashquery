import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import * as http from 'node:http';
import { describe, expect, it } from 'vitest';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

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

interface ManagedMcpOptions {
  seedTemplates?: boolean;
  templatesYaml?: string;
}

async function withManagedMcp<T>(
  provider: ScriptedOpenAiProvider,
  fn: (client: Client, vaultPath: string) => Promise<T>,
  options: ManagedMcpOptions = {}
): Promise<T> {
  const tempDir = await mkdtemp(join(tmpdir(), 'fqc-template-tools-e2e-'));
  const configPath = join(tempDir, 'flashquery.yml');
  const vaultPath = join(tempDir, 'vault');
  const entryPoint = resolve('src/index.ts');
  const projectRoot = resolve('.');
  const templatesYaml = options.templatesYaml ?? '  default_access: permissive';
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
${templatesYaml}
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
      templates: [Templates/Research-Skill.md, Templates/Source-Skill.md]
      defaults: { max_iterations: 3, timeout_ms: 10000 }
    - name: mixed_agent
      description: Mixed ATL-E2E-05
      models: [template-model]
      tools: [get_document]
      templates: [Templates/Research-Skill.md]
      defaults: { max_iterations: 3, timeout_ms: 10000 }
`;
  await writeFile(configPath, config);
  if (options.seedTemplates !== false) {
    await writeDoc(vaultPath, 'Templates/Research-Skill.md', {
      fq_template: true,
      fq_expose_as_tool: true,
      fq_namespace: 'skill',
      fq_desc: 'Research skill',
      fq_params: { topic: { type: 'string', required: true } },
    }, 'Research skill says {{topic}}.');
    await writeDoc(vaultPath, 'Templates/Source-Skill.md', {
      fq_template: true,
      fq_expose_as_tool: true,
      fq_namespace: 'skill',
      fq_desc: 'Source skill',
      fq_params: {
        topic: { type: 'string', required: true },
        source: { type: 'document', required: true },
      },
    }, 'Source skill says {{topic}} with {{source}}.');
  }
  await writeDoc(vaultPath, 'Docs/Native.md', { fq_status: 'active' }, 'Native document body.');

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', entryPoint, 'start', '--config', configPath],
    stderr: 'ignore',
    env: process.env as Record<string, string>,
    cwd: projectRoot,
  });
  const client = new Client({ name: 'template-tools-e2e', version: '1.0.0' });
  try {
    await client.connect(transport);
    const sync = await client.callTool({ name: 'maintain_vault', arguments: { action: 'sync' } }) as { isError?: boolean };
    expect(sync.isError).toBeFalsy();
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

async function syncVault(client: Client): Promise<void> {
  const result = await client.callTool({ name: 'maintain_vault', arguments: { action: 'sync' } }) as { isError?: boolean };
  expect(result.isError).toBeFalsy();
}

async function toolNames(client: Client): Promise<string[]> {
  const { tools } = await client.listTools();
  return tools.map((tool) => tool.name);
}

async function getTool(client: Client, name: string) {
  const { tools } = await client.listTools();
  return tools.find((tool) => tool.name === name);
}

describe('call_model template-tool masquerade public E2E contracts', () => {
  it('ATL-E2E-04 lists vault template masquerade tools on the host MCP surface', async () => {
    const provider = new ScriptedOpenAiProvider([
      finalTextResponse('unused', 1, 1),
    ]);
    await provider.start();
    try {
      await withManagedMcp(provider, async (client) => {
        const { tools } = await client.listTools();
        const names = tools.map((tool) => tool.name);

        expect(names).toEqual(expect.arrayContaining([
          'flashquery_skill_research_skill',
          'flashquery_skill_source_skill',
        ]));
      });
    } finally {
      await provider.stop();
    }
  }, 120000);

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

  it('ATL-E2E-04 returns recoverable missing-argument errors and lets the model retry', async () => {
    const provider = new ScriptedOpenAiProvider([
      toolCallResponse([{ id: 'call_missing_topic', name: 'flashquery_skill_research_skill', args: {} }]),
      toolCallResponse([{ id: 'call_retry_topic', name: 'flashquery_skill_research_skill', args: { topic: 'ATL-E2E-04 retry' } }]),
      finalTextResponse('template retry complete', 31, 8),
    ]);
    await provider.start();
    try {
      const envelope = await withManagedMcp(provider, (client) => callModel(client, {
        resolver: 'purpose',
        name: 'template_agent',
        messages: [{ role: 'user', content: 'ATL-E2E-04 retry after missing argument.' }],
      }));
      expect(JSON.stringify(provider.requests[1])).toContain('template_missing_required_param');
      expect(JSON.stringify(provider.requests[2])).toContain('Research skill says ATL-E2E-04 retry.');
      expect(envelope).toMatchObject({
        response: 'template retry complete',
        metadata: {
          tools: {
            stop_reason: 'final_response',
            calls_log: expect.arrayContaining([
              expect.objectContaining({
                tool_calls: expect.arrayContaining([
                  expect.objectContaining({ kind: 'template', tool_call_id: 'call_missing_topic', status: 'error', error_code: 'template_missing_required_param' }),
                ]),
              }),
              expect.objectContaining({
                tool_calls: expect.arrayContaining([
                  expect.objectContaining({ kind: 'template', tool_call_id: 'call_retry_topic', status: 'success' }),
                ]),
              }),
            ]),
          },
        },
      });
    } finally {
      await provider.stop();
    }
  }, 60000);

  it('ATL-E2E-04 returns tool_not_in_registry for generated names absent from the reverse map', async () => {
    const provider = new ScriptedOpenAiProvider([
      toolCallResponse([{ id: 'call_phantom', name: 'flashquery_skill_phantom', args: { topic: 'ATL-E2E-04' } }]),
      finalTextResponse('phantom recovered', 22, 6),
    ]);
    await provider.start();
    try {
      const envelope = await withManagedMcp(provider, (client) => callModel(client, {
        resolver: 'purpose',
        name: 'template_agent',
        messages: [{ role: 'user', content: 'ATL-E2E-04 phantom tool.' }],
      }));
      expect(JSON.stringify(provider.requests[1])).toContain('tool_not_in_registry');
      expect(envelope).toMatchObject({
        response: 'phantom recovered',
        metadata: { tools: { stop_reason: 'final_response' } },
      });
    } finally {
      await provider.stop();
    }
  }, 60000);

  it('ATL-E2E-04 resolves document template parameters through the identifier ladder', async () => {
    const provider = new ScriptedOpenAiProvider([
      toolCallResponse([{
        id: 'call_source_skill',
        name: 'flashquery_skill_source_skill',
        args: { topic: 'ATL-E2E-04 document', source: 'Docs/Native.md' },
      }]),
      finalTextResponse('document param complete', 25, 7),
    ]);
    await provider.start();
    try {
      await withManagedMcp(provider, (client) => callModel(client, {
        resolver: 'purpose',
        name: 'template_agent',
        messages: [{ role: 'user', content: 'ATL-E2E-04 document parameter.' }],
      }));
      const secondRequest = JSON.stringify(provider.requests[1]);
      expect(secondRequest).toContain('Source skill says ATL-E2E-04 document');
      expect(secondRequest).toContain('Native document body.');
      expect(secondRequest).toContain('resolved_to');
      expect(secondRequest).toContain('Docs/Native.md');
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
      const secondRequest = JSON.stringify(provider.requests[1]);
      expect(secondRequest).toContain('Native document body.');
      expect(secondRequest).toContain('Research skill says ATL-E2E-05.');
    } finally {
      await provider.stop();
    }
  }, 60000);

  it('T-E-010 T-E-011 T-E-012 T-E-013 emits tools/list_changed only on host template add/remove/update and listTools reflects it', async () => {
    const provider = new ScriptedOpenAiProvider([
      finalTextResponse('unused', 1, 1),
    ]);
    await provider.start();
    try {
      await withManagedMcp(provider, async (client, vaultPath) => {
        let notified = 0;
        client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
          notified += 1;
        });

        await writeDoc(vaultPath, 'Templates/Notify.md', {
          fq_template: true,
          fq_expose_as_tool: true,
          fq_namespace: 'skill',
          fq_desc: 'Notify v1',
        }, 'Notify body v1');
        await syncVault(client);
        expect(notified).toBeGreaterThanOrEqual(1);
        expect(await toolNames(client)).toContain('flashquery_skill_notify');

        const afterAdd = notified;
        await syncVault(client);
        expect(notified).toBe(afterAdd);

        await writeDoc(vaultPath, 'Templates/Notify.md', {
          fq_template: true,
          fq_expose_as_tool: true,
          fq_namespace: 'skill',
          fq_desc: 'Notify v2',
        }, 'Notify body v2');
        await syncVault(client);
        expect(notified).toBeGreaterThan(afterAdd);
        expect((await getTool(client, 'flashquery_skill_notify'))?.description).toBe('Notify v2');

        const afterUpdate = notified;
        await writeDoc(vaultPath, 'Templates/Notify.md', {
          fq_template: true,
          fq_expose_as_tool: false,
          fq_namespace: 'skill',
          fq_desc: 'Notify v2',
        }, 'Disabled body');
        await syncVault(client);
        expect(notified).toBeGreaterThan(afterUpdate);
        expect(await toolNames(client)).not.toContain('flashquery_skill_notify');
      }, {
        seedTemplates: false,
        templatesYaml: '  default_access: permissive\n  host_access: permissive\n  host_templates: []',
      });
    } finally {
      await provider.stop();
    }
  }, 120000);

  it('T-E-001 T-E-003 T-E-004 T-E-005 T-E-007 T-E-008 refreshes add/remove/update/rename host tools without restart', async () => {
    const provider = new ScriptedOpenAiProvider([
      finalTextResponse('unused', 1, 1),
    ]);
    await provider.start();
    try {
      await withManagedMcp(provider, async (client, vaultPath) => {
        await writeDoc(vaultPath, 'Templates/Dynamic.md', {
          fq_template: true,
          fq_expose_as_tool: true,
          fq_namespace: 'skill',
          fq_desc: 'Dynamic v1',
          fq_params: { topic: { type: 'string', required: true } },
        }, 'Dynamic {{topic}}');
        await syncVault(client);
        expect(await toolNames(client)).toContain('flashquery_skill_dynamic');

        await writeDoc(vaultPath, 'Templates/Dynamic.md', {
          fq_template: true,
          fq_expose_as_tool: true,
          fq_namespace: 'skill',
          fq_desc: 'Dynamic v2',
          fq_params: {
            topic: { type: 'string', required: true },
            audience: { type: 'string', required: true },
          },
        }, 'Dynamic {{topic}} for {{audience}}');
        await syncVault(client);
        const updated = await getTool(client, 'flashquery_skill_dynamic');
        expect(updated?.description).toBe('Dynamic v2');
        expect(JSON.stringify(updated?.inputSchema)).toContain('audience');

        await rename(join(vaultPath, 'Templates', 'Dynamic.md'), join(vaultPath, 'Templates', 'Dynamic Renamed.md'));
        await syncVault(client);
        expect(await toolNames(client)).not.toContain('flashquery_skill_dynamic');
        expect(await toolNames(client)).toContain('flashquery_skill_dynamic_renamed');

        await writeDoc(vaultPath, 'Templates/Dynamic Renamed.md', {
          fq_template: true,
          fq_expose_as_tool: false,
          fq_namespace: 'skill',
          fq_desc: 'Dynamic v2',
        }, 'Disabled dynamic');
        await syncVault(client);
        expect(await toolNames(client)).not.toContain('flashquery_skill_dynamic_renamed');
        const removedCall = await client.callTool({
          name: 'flashquery_skill_dynamic_renamed',
          arguments: { topic: 'removed', audience: 'host' },
        }) as { content: Array<{ text: string }>; isError?: boolean };
        expect(removedCall.isError).toBe(true);
        expect(removedCall.content[0].text).toContain('Tool flashquery_skill_dynamic_renamed not found');
      }, {
        seedTemplates: false,
        templatesYaml: '  default_access: permissive\n  host_access: permissive\n  host_templates: []',
      });
    } finally {
      await provider.stop();
    }
  }, 120000);

  it('T-E-002 T-E-006 calls a generated host template tool and renders current body content', async () => {
    const provider = new ScriptedOpenAiProvider([
      finalTextResponse('unused', 1, 1),
    ]);
    await provider.start();
    try {
      await withManagedMcp(provider, async (client, vaultPath) => {
        const first = await client.callTool({
          name: 'flashquery_skill_research_skill',
          arguments: { topic: 'first' },
        }) as { content: Array<{ text: string }>; isError?: boolean };
        expect(first.isError).toBeFalsy();
        expect(JSON.parse(first.content[0].text)).toMatchObject({
          ok: true,
          result: { content: expect.stringContaining('Research skill says first.') },
        });

        await writeDoc(vaultPath, 'Templates/Research-Skill.md', {
          fq_template: true,
          fq_expose_as_tool: true,
          fq_namespace: 'skill',
          fq_desc: 'Research skill',
          fq_params: { topic: { type: 'string', required: true } },
        }, 'Updated body says {{topic}}.');
        const second = await client.callTool({
          name: 'flashquery_skill_research_skill',
          arguments: { topic: 'second' },
        }) as { content: Array<{ text: string }>; isError?: boolean };
        expect(second.isError).toBeFalsy();
        expect(JSON.parse(second.content[0].text)).toMatchObject({
          ok: true,
          result: { content: expect.stringContaining('Updated body says second.') },
        });
      }, {
        templatesYaml: '  default_access: permissive\n  host_access: permissive\n  host_templates: []',
      });
    } finally {
      await provider.stop();
    }
  }, 120000);

  it('T-E-009 restrictive host_access excludes unbound templates from tools/list', async () => {
    const provider = new ScriptedOpenAiProvider([
      finalTextResponse('unused', 1, 1),
    ]);
    await provider.start();
    try {
      await withManagedMcp(provider, async (client) => {
        expect(await toolNames(client)).not.toContain('flashquery_skill_research_skill');
        expect(await toolNames(client)).toContain('flashquery_skill_source_skill');
      }, {
        templatesYaml: [
          '  default_access: permissive',
          '  host_access: restrictive',
          '  host_templates: [Templates/Source-Skill.md]',
        ].join('\n'),
      });
    } finally {
      await provider.stop();
    }
  }, 120000);
});
