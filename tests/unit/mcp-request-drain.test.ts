import { describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpRequestLifecycle } from '../../src/mcp/request-lifecycle.js';
import {
  getMcpRequestLifecycleForServer,
  getRegisteredMcpServers,
  registerMcpRequestLifecycle,
  unregisterMcpServerForShutdown,
} from '../../src/mcp/request-lifecycle-registry.js';

type McpTextResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: true;
};

const okResult: McpTextResult = {
  content: [{ type: 'text', text: 'ok' }],
};

const errorResult: McpTextResult = {
  content: [{ type: 'text', text: 'handled error' }],
  isError: true,
};

describe('MCP request lifecycle drain tracking', () => {
  it('T-U-019 increments while a successful handler runs and decrements after completion', async () => {
    const lifecycle = createMcpRequestLifecycle();
    const observedCounts: number[] = [];

    const handler = lifecycle.trackHandler(async () => {
      observedCounts.push(lifecycle.getInFlightCount());
      return okResult;
    });

    expect(lifecycle.getInFlightCount()).toBe(0);

    await expect(handler()).resolves.toEqual(okResult);

    expect(observedCounts).toEqual([1]);
    expect(lifecycle.getInFlightCount()).toBe(0);
  });

  it('T-U-019 decrements after a handler returns an isError result', async () => {
    const lifecycle = createMcpRequestLifecycle();
    const observedCounts: number[] = [];

    const handler = lifecycle.trackHandler(async () => {
      observedCounts.push(lifecycle.getInFlightCount());
      return errorResult;
    });

    await expect(handler()).resolves.toEqual(errorResult);

    expect(observedCounts).toEqual([1]);
    expect(lifecycle.getInFlightCount()).toBe(0);
  });

  it('T-U-019 decrements before a thrown handler error reaches the caller', async () => {
    const lifecycle = createMcpRequestLifecycle();
    const handler = lifecycle.trackHandler(async () => {
      expect(lifecycle.getInFlightCount()).toBe(1);
      throw new Error('handler failed');
    });

    await expect(handler()).rejects.toThrow('handler failed');

    expect(lifecycle.getInFlightCount()).toBe(0);
  });

  it('T-U-020 returns timeout metadata without clearing hung in-flight work', async () => {
    const lifecycle = createMcpRequestLifecycle();
    const handler = lifecycle.trackHandler(
      async () => new Promise<McpTextResult>(() => undefined)
    );

    void handler();

    await Promise.resolve();
    expect(lifecycle.getInFlightCount()).toBe(1);

    const drainResult = await lifecycle.waitForIdle(25);

    expect(drainResult).toMatchObject({
      timedOut: true,
      remaining: 1,
    });
    expect(drainResult.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(lifecycle.getInFlightCount()).toBe(1);
  });

  it('T-U-037 registers, looks up, lists, and unregisters MCP server lifecycle state', () => {
    const server = new McpServer(
      { name: 'lifecycle-registry-unit', version: 'test' },
      { capabilities: { tools: {} } }
    );
    const lifecycle = createMcpRequestLifecycle();

    registerMcpRequestLifecycle(server, lifecycle);

    expect(getMcpRequestLifecycleForServer(server)).toBe(lifecycle);
    expect(getRegisteredMcpServers()).toContain(server);

    unregisterMcpServerForShutdown(server);

    expect(getRegisteredMcpServers()).not.toContain(server);
    expect(() => getMcpRequestLifecycleForServer(server)).toThrow(
      'MCP request lifecycle has not been initialized for this server'
    );
  });
});
