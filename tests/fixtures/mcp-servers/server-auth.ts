import process from 'node:process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

if (!process.env.POC_API_KEY) {
  process.stderr.write('FATAL: POC_API_KEY environment variable is required.\n');
  process.exit(2);
}

const server = new McpServer({ name: 'fq-auth-fixture', version: '1.0.0' });

server.registerTool(
  'auth_echo',
  {
    description: 'Echoes only when auth env exists.',
    inputSchema: z.object({ value: z.string() }),
  },
  async ({ value }) => ({ content: [{ type: 'text', text: value }] })
);

await server.connect(new StdioServerTransport());
