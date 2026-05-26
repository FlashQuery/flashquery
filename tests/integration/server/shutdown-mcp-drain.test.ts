import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  ShutdownCoordinator,
  MCP_REQUEST_DRAIN_TIMEOUT_MS,
} from '../../../src/server/shutdown.js';
import type { FlashQueryConfig } from '../../../src/config/loader.js';
import { createMcpServer, getMcpRequestLifecycleForServer } from '../../../src/mcp/server.js';
import { unregisterMcpServerForShutdown } from '../../../src/mcp/request-lifecycle-registry.js';
import { getNativeToolCatalog } from '../../../src/mcp/tool-catalog.js';
import { logger } from '../../../src/logging/logger.js';

vi.mock('../../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

type CatalogHandler = (args: unknown, context: unknown) => Promise<CallToolResult> | CallToolResult;
type TestMcpServer = ReturnType<typeof createMcpServer>;

let registeredServers: TestMcpServer[] = [];

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'Shutdown MCP Drain Integration',
      id: 'shutdown-mcp-drain-integration',
      vault: {
        path: '/tmp/fqc-shutdown-mcp-drain-integration-vault',
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
  } as FlashQueryConfig;
}

function registerProbeHandler(
  server: TestMcpServer,
  name: string,
  handler: CatalogHandler
): CatalogHandler {
  server.registerTool(
    name,
    { description: `${name} probe`, inputSchema: {} },
    handler as never
  );
  const registeredHandler = getNativeToolCatalog(server).find((tool) => tool.name === name)?.handler;
  if (!registeredHandler) {
    throw new Error(`missing catalog handler for ${name}`);
  }
  return registeredHandler;
}

function createRegisteredTestMcpServer(): TestMcpServer {
  const server = createMcpServer(makeConfig(), 'test');
  registeredServers.push(server);
  return server;
}

async function drainMcpRequests(coordinator: ShutdownCoordinator): Promise<void> {
  await (coordinator as unknown as { drainMcpRequests(): Promise<void> }).drainMcpRequests();
}

describe('ShutdownCoordinator MCP request drain integration', () => {
  beforeEach(() => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.warn).mockClear();
    registeredServers = [];
  });

  afterEach(() => {
    for (const server of registeredServers) {
      unregisterMcpServerForShutdown(server);
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('T-I-009 returns promptly with zero in-flight MCP requests and no fixed 100ms sleep', async () => {
    const server = createRegisteredTestMcpServer();
    const lifecycle = getMcpRequestLifecycleForServer(server);
    const coordinator = new ShutdownCoordinator(makeConfig());

    expect(lifecycle.getInFlightCount()).toBe(0);

    const startedAt = Date.now();
    await drainMcpRequests(coordinator);
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(100);
  });

  it('waits for an already-running tracked handler before continuing', async () => {
    const server = createRegisteredTestMcpServer();
    const lifecycle = getMcpRequestLifecycleForServer(server);
    const coordinator = new ShutdownCoordinator(makeConfig());
    let releaseHandler: (() => void) | undefined;

    const handler = registerProbeHandler(server, 'shutdown_active_probe', async () => {
      await new Promise<void>((resolve) => {
        releaseHandler = resolve;
      });
      return { content: [{ type: 'text', text: 'ok' }] };
    });

    const handlerPromise = handler({}, {});
    expect(lifecycle.getInFlightCount()).toBe(1);

    let drainSettled = false;
    const drainPromise = drainMcpRequests(coordinator).then(() => {
      drainSettled = true;
    });
    await Promise.resolve();

    expect(drainSettled).toBe(false);

    releaseHandler?.();
    await handlerPromise;
    await drainPromise;

    expect(drainSettled).toBe(true);
    expect(lifecycle.getInFlightCount()).toBe(0);
  });

  it('T-I-011 warns with the remaining in-flight count when the MCP drain deadline expires', async () => {
    vi.useFakeTimers();
    const server = createRegisteredTestMcpServer();
    const lifecycle = getMcpRequestLifecycleForServer(server);
    const coordinator = new ShutdownCoordinator(makeConfig());
    const warnSpy = vi.spyOn(logger, 'warn');

    const handler = registerProbeHandler(
      server,
      'shutdown_hung_probe',
      async () => new Promise<CallToolResult>(() => undefined)
    );

    void handler({}, {});
    await vi.runAllTicks();
    expect(lifecycle.getInFlightCount()).toBe(1);

    const drainPromise = drainMcpRequests(coordinator);
    await vi.advanceTimersByTimeAsync(MCP_REQUEST_DRAIN_TIMEOUT_MS);
    await drainPromise;

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('1 in-flight'));
    expect(lifecycle.getInFlightCount()).toBe(1);
  });

  it('excludes unregistered per-session MCP servers from the global shutdown drain', async () => {
    vi.useFakeTimers();
    const closedSessionServer = createRegisteredTestMcpServer();
    const closedSessionLifecycle = getMcpRequestLifecycleForServer(closedSessionServer);
    const activeSessionServer = createRegisteredTestMcpServer();
    const coordinator = new ShutdownCoordinator(makeConfig());
    const warnSpy = vi.spyOn(logger, 'warn');

    const handler = registerProbeHandler(
      closedSessionServer,
      'closed_session_hung_probe',
      async () => new Promise<CallToolResult>(() => undefined)
    );

    void handler({}, {});
    await vi.runAllTicks();
    expect(closedSessionLifecycle.getInFlightCount()).toBe(1);

    unregisterMcpServerForShutdown(closedSessionServer);

    const drainPromise = drainMcpRequests(coordinator);
    await vi.advanceTimersByTimeAsync(MCP_REQUEST_DRAIN_TIMEOUT_MS);
    await drainPromise;

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('in-flight'));
    expect(getMcpRequestLifecycleForServer(activeSessionServer).getInFlightCount()).toBe(0);
    expect(closedSessionLifecycle.getInFlightCount()).toBe(1);
  });
});
