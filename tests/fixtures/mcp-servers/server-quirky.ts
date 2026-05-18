import process from 'node:process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const server = new McpServer({ name: 'fq-quirky-fixture', version: '1.0.0' });

server.registerTool(
  'safe_echo',
  {
    description: 'Echoes without requiring reverse-request capabilities.',
    inputSchema: z.object({ value: z.unknown() }),
  },
  async ({ value }) => ({
    content: [{ type: 'text', text: JSON.stringify({ value }) }],
    structuredContent: { value },
  })
);

server.registerTool(
  'trigger_reverse_request',
  {
    description: 'Attempts a sampling reverse request for audit-path testing.',
    inputSchema: z.object({ prompt: z.string().default('hello') }),
  },
  async ({ prompt }) => {
    process.stderr.write('QUIRK_REVERSE_REQUEST:sampling/createMessage\n');
    try {
      await server.server.createMessage(
        {
          messages: [{ role: 'user', content: { type: 'text', text: prompt } }],
          maxTokens: 16,
        },
        { timeout: 250 }
      );
    } catch (error) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        error instanceof Error ? error.message : 'sampling/createMessage rejected'
      );
    }
    return { content: [{ type: 'text', text: 'unexpected reverse success' }] };
  }
);

await server.connect(new StdioServerTransport());
