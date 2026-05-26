import { describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { getCurrentCorrelationId } from '../../src/logging/context.js';
import { createMcpServer, getMcpRequestLifecycleForServer } from '../../src/mcp/server.js';
import { getRegisteredMcpServers, unregisterMcpServerForShutdown } from '../../src/mcp/request-lifecycle-registry.js';
import { getNativeToolCatalog } from '../../src/mcp/tool-catalog.js';

type CapturedHandler = (args: unknown, extra: unknown) => Promise<CallToolResult> | CallToolResult;

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'MCP Server Correlation Unit',
      id: 'mcp-server-correlation-unit',
      vault: {
        path: '/tmp/fqc-mcp-server-correlation-unit-vault',
        markdownExtensions: ['.md'],
      },
    },
    server: {
      host: 'localhost',
      port: 3100,
    },
    mcp: {
      transport: 'stdio',
      port: 3100,
    },
    supabase: {
      url: process.env.SUPABASE_URL ?? 'http://localhost:54321',
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'test-key',
      databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:54322/postgres',
      skipDdl: true,
    },
    git: {
      autoCommit: false,
      autoPush: false,
      remote: 'origin',
      branch: 'main',
    },
    locking: {
      enabled: false,
      ttlSeconds: 30,
    },
    trashFolder: {
      enabled: false,
      path: '.flashquery/removed',
      collisionStrategy: 'suffix',
    },
    embedding: {
      provider: 'none',
      model: '',
      dimensions: 1536,
    },
    logging: {
      level: 'info',
      output: 'stderr',
    },
    mcpServers: {},
    host: {
      mcpServers: [],
      toolSearch: 'disabled',
    },
    macro: {
      defaultTimeoutMs: 60000,
    },
    llm: {
      providers: [],
      models: [],
      purposes: [],
    },
  };
}

function createServerWithCapturedRegistrations(): {
  server: McpServer;
  handlers: Map<string, CapturedHandler>;
  registerSpy: ReturnType<typeof vi.spyOn>;
  toolSpy: ReturnType<typeof vi.spyOn>;
} {
  const handlers = new Map<string, CapturedHandler>();
  const registerSpy = vi.spyOn(McpServer.prototype, 'registerTool').mockImplementation(
    ((name: string, _config: unknown, handler: CapturedHandler) => {
      handlers.set(name, handler);
      return undefined;
    }) as McpServer['registerTool']
  );
  const toolSpy = vi.spyOn(McpServer.prototype, 'tool');

  const server = createMcpServer(makeConfig(), 'test');

  return { server, handlers, registerSpy, toolSpy };
}

describe('MCP server registerTool correlation wrapper', () => {
  it('T-U-037 registers createMcpServer lifecycle state for shutdown lookup', () => {
    const { server, registerSpy, toolSpy } = createServerWithCapturedRegistrations();

    expect(getRegisteredMcpServers()).toContain(server);
    expect(getMcpRequestLifecycleForServer(server).getInFlightCount()).toBe(0);

    unregisterMcpServerForShutdown(server);
    registerSpy.mockRestore();
    toolSpy.mockRestore();
  });

  it('T-U-017 provides a correlation ID inside registerTool handlers on every invocation', async () => {
    const { server, registerSpy, toolSpy } = createServerWithCapturedRegistrations();
    const observedCorrelationIds: string[] = [];

    server.registerTool(
      'correlation_probe',
      { description: 'Correlation probe', inputSchema: {} },
      (async () => {
        observedCorrelationIds.push(getCurrentCorrelationId() ?? '');
        return { content: [{ type: 'text' as const, text: 'ok' }] };
      }) as never
    );

    const handler = getNativeToolCatalog(server).find((tool) => tool.name === 'correlation_probe')?.handler;

    expect(handler).toBeDefined();

    await handler?.({}, {});
    await handler?.({}, {});

    expect(observedCorrelationIds).toHaveLength(2);
    expect(observedCorrelationIds.every((id) => id.length > 0)).toBe(true);
    expect(toolSpy).not.toHaveBeenCalled();

    registerSpy.mockRestore();
    toolSpy.mockRestore();
  });

  it('T-U-018 registers production tools through registerTool without requiring a server.tool branch', () => {
    const { server, registerSpy, toolSpy } = createServerWithCapturedRegistrations();

    expect(getNativeToolCatalog(server).map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'search_tools',
      'get_document',
      'list_vault',
    ]));
    expect(toolSpy).not.toHaveBeenCalled();

    registerSpy.mockRestore();
    toolSpy.mockRestore();
  });

  it('REQ-009 tracks registerTool handler invocations in the MCP lifecycle tracker', async () => {
    const { server, registerSpy, toolSpy } = createServerWithCapturedRegistrations();
    const lifecycle = getMcpRequestLifecycleForServer(server);
    let releaseHandler: (() => void) | undefined;

    server.registerTool(
      'lifecycle_probe',
      { description: 'Lifecycle probe', inputSchema: {} },
      (async () => {
        await new Promise<void>((resolve) => {
          releaseHandler = resolve;
        });
        return { content: [{ type: 'text' as const, text: 'ok' }] };
      }) as never
    );

    const handler = getNativeToolCatalog(server).find((tool) => tool.name === 'lifecycle_probe')?.handler;

    expect(handler).toBeDefined();
    expect(lifecycle.getInFlightCount()).toBe(0);

    const resultPromise = handler?.({}, {});

    expect(lifecycle.getInFlightCount()).toBe(1);
    releaseHandler?.();
    const result = await resultPromise;

    expect(result?.content[0]?.type).toBe('text');
    expect(lifecycle.getInFlightCount()).toBe(0);
    await expect(lifecycle.waitForIdle(0)).resolves.toMatchObject({
      timedOut: false,
      remaining: 0,
    });

    registerSpy.mockRestore();
    toolSpy.mockRestore();
  });
});
