/**
 * MCP Server Fixture for E2E Tests
 *
 * Manages the lifecycle of the FlashQuery Core MCP server subprocess via
 * StdioClientTransport. The transport owns the subprocess: it spawns the
 * process on connect and terminates it (SIGTERM → SIGKILL) on close.
 *
 * Usage:
 *   const { client, transport } = await startMcpServerFixture();
 *   // ... run tests ...
 *   await stopMcpServerFixture(client, transport);
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Start MCP server subprocess and return connected client + transport.
 * StdioClientTransport spawns and owns the server process lifecycle.
 *
 * @returns Promise resolving to {client, transport} when connected
 * @throws Error if client connection fails or process fails to spawn
 */
export async function startMcpServerFixture(): Promise<{
  client: Client;
  transport: StdioClientTransport;
}> {
  const configPath = resolve(__dirname, '../fixtures/flashquery.e2e.yaml');
  const entryPoint = resolve(__dirname, '../../src/index.ts');
  const projectRoot = resolve(__dirname, '../../');

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', entryPoint, 'start', '--config', configPath],
    stderr: 'pipe',
    env: process.env as Record<string, string>,
    cwd: projectRoot,
  });

  const client = new Client({ name: 'e2e-test-client', version: '1.0.0' });
  await client.connect(transport);

  return { client, transport };
}

/**
 * Gracefully stop MCP server and close client connection.
 * Calls client.close() then transport.close(). The transport's close()
 * method handles subprocess termination: stdin end → SIGTERM → SIGKILL.
 *
 * @param client - MCP Client instance to close
 * @param transport - StdioClientTransport owning the server subprocess
 */
export async function stopMcpServerFixture(
  client: Client,
  transport: StdioClientTransport,
): Promise<void> {
  try {
    await client.close();
  } catch {
    // swallow — best-effort shutdown
  }
  try {
    await transport.close();
  } catch {
    // swallow — transport may already be closed by client.close()
  }
}
