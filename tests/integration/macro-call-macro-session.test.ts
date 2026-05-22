import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'node:crypto';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { MacroTaskRegistry } from '../../src/macro/task-registry.js';
import { initLogger } from '../../src/logging/logger.js';
import { wrapServerWithToolCatalog } from '../../src/mcp/tool-catalog.js';
import { assembleMacroTemplateMetadata, registerMacroTools, type RegisterMacroToolsResult } from '../../src/mcp/tools/macro.js';
import { NullMcpBroker } from '../../src/services/mcp-broker.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { TEST_DATABASE_URL, TEST_SUPABASE_KEY, TEST_SUPABASE_URL } from '../helpers/test-env.js';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function testConfig(templateAccess: 'permissive' | 'restrictive' = 'restrictive'): FlashQueryConfig {
  return {
    instance: {
      id: 'macro-call-macro-session-integration',
      vault: { path: process.cwd(), markdownExtensions: ['.md'] },
    },
    server: {},
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: true,
    },
    hostMcpTools: { tools: ['call_macro'] },
    llm: { providers: [], models: [], purposes: [] },
    templates: { defaultAccess: templateAccess },
  } as FlashQueryConfig;
}

function parseToolText(result: unknown): Record<string, unknown> {
  const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}';
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Expected JSON tool text, got: ${text}`, { cause: error });
  }
}

async function connectClient(
  sessionId: string,
  taskRegistry: MacroTaskRegistry
): Promise<Client> {
  const server = wrapServerWithToolCatalog(new McpServer({ name: `macro-session-${sessionId}`, version: '1.0.0' }));
  registerMacroTools(server, testConfig(), {
    broker: new NullMcpBroker(),
    taskRegistry,
    sessionIdProvider: () => sessionId,
  });
  const client = new Client({ name: `macro-session-client-${sessionId}`, version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function connectClientWithNaturalSessionFallback(
  name: string,
  taskRegistry: MacroTaskRegistry
): Promise<{ client: Client; registration: RegisterMacroToolsResult }> {
  const server = wrapServerWithToolCatalog(new McpServer({ name: `macro-natural-session-${name}`, version: '1.0.0' }));
  const registration = registerMacroTools(server, testConfig(), {
    broker: new NullMcpBroker(),
    taskRegistry,
  });
  const client = new Client({ name: `macro-natural-session-client-${name}`, version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, registration };
}

describe('call_macro public session scoping integration', () => {
  beforeAll(async () => {
    const config = testConfig();
    initLogger({ ...config, logging: { level: 'error', output: 'stderr' } } as FlashQueryConfig);
    await initSupabase(config);
  }, 30000);

  afterAll(async () => {
    await supabaseManager.getClient().from('fqc_documents').delete().eq('instance_id', 'macro-call-macro-session-integration');
    await supabaseManager?.close();
  });

  it('A/T-I-009 assembles macro template metadata from the index without changing the macro surface', async () => {
    const now = new Date().toISOString();
    const { error } = await supabaseManager.getClient().from('fqc_documents').insert([
      {
        id: randomUUID(),
        instance_id: 'macro-call-macro-session-integration',
        path: 'Templates/Macro Skill.md',
        title: 'Macro Skill',
        tags: [],
        content_hash: 'macro-template-hash',
        status: 'active',
        created_at: now,
        updated_at: now,
        template_meta: {
          fq_template: true,
          fq_expose_as_tool: true,
          fq_namespace: 'macro',
          fq_desc: 'Macro visible template',
          fq_params: {},
        },
      },
      ...Array.from({ length: 25 }, (_, index) => ({
        id: randomUUID(),
        instance_id: 'macro-call-macro-session-integration',
        path: `Docs/Plain-${index}.md`,
        title: `Plain ${index}`,
        tags: [],
        content_hash: `macro-plain-${index}`,
        status: 'active',
        created_at: now,
        updated_at: now,
        template_meta: null,
      })),
    ]);
    expect(error).toBeNull();

    const metadata = await assembleMacroTemplateMetadata({
      config: testConfig('permissive'),
      callerContext: { origin: 'host' },
      catalog: [],
    });

    expect(metadata.templateToolNames).toEqual(['flashquery_macro_macro_skill']);
    expect([...metadata.templateReverseMap.entries()]).toEqual([
      ['flashquery_macro_macro_skill', 'Templates/Macro Skill.md'],
    ]);
    expect(JSON.stringify(metadata)).not.toContain('Plain-');
    expect(JSON.stringify(metadata)).not.toContain('template_tool_warnings');
  });

  it('T-I-002b derives public handler session IDs and isolates list_tasks across clients', async () => {
    const taskRegistry = new MacroTaskRegistry();
    const firstClient = await connectClient('session-a', taskRegistry);
    const secondClient = await connectClient('session-b', taskRegistry);

    try {
      const source = `
        sleep 500
        visible = list_tasks
        exit { task_id: task_id, visible: $visible }
      `;
      const firstCall = firstClient.callTool({ name: 'call_macro', arguments: { source } });
      const secondCall = secondClient.callTool({ name: 'call_macro', arguments: { source } });

      const [firstResult, secondResult] = await Promise.all([firstCall, secondCall]);
      const firstPayload = parseToolText(firstResult);
      const secondPayload = parseToolText(secondResult);
      const firstValue = firstPayload['result'] as Record<string, unknown>;
      const secondValue = secondPayload['result'] as Record<string, unknown>;
      const firstVisible = firstValue['visible'] as Array<Record<string, unknown>>;
      const secondVisible = secondValue['visible'] as Array<Record<string, unknown>>;

      expect(firstValue['task_id']).toBe(firstPayload['task_id']);
      expect(secondValue['task_id']).toBe(secondPayload['task_id']);
      expect(firstPayload['task_id']).not.toBe(secondPayload['task_id']);
      expect(firstVisible.map((task) => task['task_id'])).toEqual([firstPayload['task_id']]);
      expect(secondVisible.map((task) => task['task_id'])).toEqual([secondPayload['task_id']]);
      expect(JSON.stringify(firstVisible)).not.toContain(String(secondPayload['task_id']));
      expect(JSON.stringify(secondVisible)).not.toContain(String(firstPayload['task_id']));
      expect(taskRegistry.list('session-a')).toEqual([]);
      expect(taskRegistry.list('session-b')).toEqual([]);
    } finally {
      await Promise.all([firstClient.close(), secondClient.close()]);
    }
  });

  it('T-I-002c uses distinct registration-scoped UUID fallback sessions when SDK extra has no session ID', async () => {
    const taskRegistry = new MacroTaskRegistry();
    const first = await connectClientWithNaturalSessionFallback('a', taskRegistry);
    const second = await connectClientWithNaturalSessionFallback('b', taskRegistry);
    const config = testConfig();

    try {
      expect(first.registration.registrationSessionId).toMatch(UUID_V4_PATTERN);
      expect(second.registration.registrationSessionId).toMatch(UUID_V4_PATTERN);
      expect(first.registration.registrationSessionId).not.toBe(second.registration.registrationSessionId);
      expect(first.registration.registrationSessionId).not.toBe(config.instance.id);
      expect(second.registration.registrationSessionId).not.toBe(config.instance.id);
      expect(first.registration.registrationSessionId).not.toBe(`host:${config.instance.id}`);
      expect(second.registration.registrationSessionId).not.toBe(`host:${config.instance.id}`);

      const source = `
        sleep 500
        visible = list_tasks
        exit { task_id: task_id, visible: $visible }
      `;
      const firstCall = first.client.callTool({ name: 'call_macro', arguments: { source } });
      const secondCall = second.client.callTool({ name: 'call_macro', arguments: { source } });

      const [firstResult, secondResult] = await Promise.all([firstCall, secondCall]);
      const firstPayload = parseToolText(firstResult);
      const secondPayload = parseToolText(secondResult);
      const firstValue = firstPayload['result'] as Record<string, unknown>;
      const secondValue = secondPayload['result'] as Record<string, unknown>;
      const firstVisible = firstValue['visible'] as Array<Record<string, unknown>>;
      const secondVisible = secondValue['visible'] as Array<Record<string, unknown>>;

      expect(firstValue['task_id']).toBe(firstPayload['task_id']);
      expect(secondValue['task_id']).toBe(secondPayload['task_id']);
      expect(firstVisible.map((task) => task['task_id'])).toEqual([firstPayload['task_id']]);
      expect(secondVisible.map((task) => task['task_id'])).toEqual([secondPayload['task_id']]);
      expect(JSON.stringify(firstVisible)).not.toContain(String(secondPayload['task_id']));
      expect(JSON.stringify(secondVisible)).not.toContain(String(firstPayload['task_id']));
      expect(taskRegistry.list(first.registration.registrationSessionId)).toEqual([]);
      expect(taskRegistry.list(second.registration.registrationSessionId)).toEqual([]);
    } finally {
      await Promise.all([first.client.close(), second.client.close()]);
    }
  });
});
