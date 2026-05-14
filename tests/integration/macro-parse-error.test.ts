import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { createMcpServer } from '../../src/mcp/server.js';

const mockConfig = {
  instance: { id: 'macro-parse-error-test', vault: { path: '/tmp/vault' } },
  supabase: {
    url: 'http://localhost:54321',
    serviceRoleKey: 'test-key',
    databaseUrl: 'postgresql://localhost',
  },
  mcp: { port: 3100 },
  embedding: { provider: 'openai', dimensions: 1536, openaiApiKey: 'test-key' },
  logging: { level: 'info', output: 'stderr' },
  locking: { enabled: false },
} as unknown as FlashQueryConfig;

function parseToolText(result: unknown): Record<string, unknown> {
  return JSON.parse(
    (result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}'
  ) as Record<string, unknown>;
}

describe('call_macro parse-error integration', () => {
  it('T-I-001 returns canonical parse_error for invalid inline source with isError false', async () => {
    const server = createMcpServer(mockConfig, '0.1.0');
    const client = new Client({ name: 'macro-parse-error-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain('call_macro');

      const result = await client.callTool({ name: 'call_macro', arguments: { source: 'for = 5' } });
      const payload = parseToolText(result);

      expect(result.isError).toBe(false);
      expect(payload).toMatchObject({
        error: 'parse_error',
        details: {
          reason: 'reserved_keyword_assignment',
          at_line: 1,
          near_token: 'for',
        },
      });
    } finally {
      await client.close();
    }
  });
});
