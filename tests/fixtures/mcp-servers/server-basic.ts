import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'fq-basic-fixture', version: '1.0.0' });

if (process.env.BASIC_HANG_LIST === 'after-first') {
  setTimeout(() => {
    process.kill(process.pid, 'SIGSTOP');
  }, 250);
}

server.registerTool(
  'echo',
  {
    description: 'Echoes the provided value without mutation.',
    inputSchema: z.object({ value: z.unknown() }),
  },
  async ({ value }) => ({
    content: [{ type: 'text', text: JSON.stringify({ value }) }],
    structuredContent: { value },
  })
);

server.registerTool(
  'slow',
  {
    description: 'Waits for the requested number of milliseconds.',
    inputSchema: z.object({ ms: z.number().int().nonnegative() }),
  },
  async ({ ms }) => {
    await delay(ms);
    return { content: [{ type: 'text', text: `waited:${ms}` }] };
  }
);

server.registerTool(
  'crash',
  {
    description: 'Terminates the fixture process after acknowledging the call.',
    inputSchema: z.object({ code: z.number().int().default(42) }),
  },
  async ({ code }) => {
    setImmediate(() => process.exit(code));
    return { content: [{ type: 'text', text: 'crashing' }] };
  }
);

server.registerTool(
  'stderr_write',
  {
    description: 'Writes a deterministic line to stderr and returns normally.',
    inputSchema: z.object({ message: z.string().default('fixture stderr line') }),
  },
  async ({ message }) => {
    process.stderr.write(`BASIC_STDERR:${message}\n`);
    return { content: [{ type: 'text', text: 'stderr-written' }] };
  }
);

await server.connect(new StdioServerTransport());
