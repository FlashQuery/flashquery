import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { runMacroSource, transitionTaskFromResult } from '../../src/mcp/tools/macro.js';
import type { McpBroker } from '../../src/services/mcp-broker.js';
import type { ToolResult } from '../../src/mcp/utils/response-formats.js';
import { MacroTaskRegistry } from '../../src/macro/task-registry.js';

const mockConfig = {
  instance: { id: 'macro-json-repair-test', vault: { path: '/tmp/vault' } },
  supabase: {
    url: 'http://localhost:54321',
    serviceRoleKey: 'test-key',
    databaseUrl: 'postgresql://localhost',
  },
  mcp: { port: 3100 },
  embedding: { provider: 'openai', dimensions: 1536, openaiApiKey: 'test-key' },
  logging: { level: 'info', output: 'stderr' },
  locking: { enabled: false },
  mcpServers: {},
  host: { mcpServers: [], toolSearch: 'disabled' },
  llm: {
    providers: [],
    models: [],
    purposes: [],
  },
} as unknown as FlashQueryConfig;

function parseToolText(result: ToolResult | unknown): Record<string, unknown> {
  return JSON.parse(
    (result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}'
  ) as Record<string, unknown>;
}

function nativeDispatchContext() {
  return {
    signal: new AbortController().signal,
    instanceId: 'macro-json-repair-test',
    logger: undefined,
    logContext: {},
  };
}

class RepairBroker implements McpBroker {
  async ensureConnected(): Promise<void> {}

  async callTool(): Promise<ToolResult> {
    return {
      content: [{
        type: 'text',
        text: '```json\n{answer: 42, branch: "repaired", nested: { ok: true, },}\n```',
      }],
    };
  }

  async isConnected(): Promise<boolean> {
    return true;
  }

  async listToolsForConsumer() {
    return [{
      serverId: 'json',
      toolName: 'payload',
      registryKey: 'json__payload',
      description: 'Returns a repairable structured payload.',
      inputSchema: {},
      tofuHash: 'hash',
      costPerCall: 0,
    }];
  }

  getPendingSchemaDrift() {
    return [];
  }

  resolveSchemaDrift() {
    return [];
  }

  async shutdown(): Promise<void> {}
}

describe('macro JSON repair public workflow integration', () => {
  it('T-I-001 exposes call_macro through the in-memory MCP public surface', async () => {
    const server = createMcpServer(mockConfig, '0.1.0');
    const client = new Client({ name: 'macro-json-repair-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain('call_macro');
    } finally {
      await client.close();
    }
  });

  it('T-I-001 returns repaired structured data from the macro workflow result', async () => {
    const { result } = await runMacroSource({
      source: 'payload = json.payload({})\nexit { answer: $payload.answer, branch: $payload.branch }',
      config: mockConfig,
      catalog: [],
      broker: new RepairBroker(),
      nativeDispatchContext: nativeDispatchContext(),
      brokerTools: [{ server: 'json', label: 'JSON fixture', tools: ['payload'] }],
    });

    expect(result.isError).toBeFalsy();
    expect(parseToolText(result)).toMatchObject({
      result: {
        answer: 42,
        branch: 'repaired',
      },
    });
    expect(parseToolText(result)).not.toHaveProperty('repaired');
  });

  it('T-I-002 surfaces malformed task envelopes as task failure results', async () => {
    const registry = new MacroTaskRegistry();
    const task = registry.create({ taskId: 'task-malformed', sessionId: 'session-a' });
    const result = transitionTaskFromResult(
      registry,
      task,
      {
        content: [{ type: 'text', text: '{task_id: "task-malformed", result: 1 2}' }],
      },
      undefined
    );

    expect(result?.isError).toBe(true);
    expect(parseToolText(result)).toMatchObject({
      error: 'invalid_json_payload',
      message: 'Structured JSON payload could not be parsed.',
      details: { site: 'macro_task_result' },
    });
    expect(registry.get('task-malformed', 'session-a')).toBeUndefined();
  });
});
