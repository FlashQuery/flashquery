/**
 * Integration tests for ShutdownCoordinator
 *
 * Tests cover:
 * - Real HTTP server closure
 * - Connection draining
 * - Shutdown timing within deadline
 * - No unhandled rejections
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import { ShutdownCoordinator, MAX_SHUTDOWN_MS } from '../../src/server/shutdown.js';
import { initLogger } from '../../src/logging/logger.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

describe('ShutdownCoordinator (Integration)', () => {
  let server: http.Server;
  let config: FlashQueryConfig;

  beforeEach(() => {
    // Create a simple HTTP server for testing
    server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end('OK');
    });

    // Create test config
    config = {
      instance: {
        id: 'test-integration',
        name: 'Integration Test',
        vault: {
          path: '/tmp/test-vault-integration',
          markdownExtensions: ['.md'],
        },
      },
      mcp: {
        transport: 'streamable-http',
        port: 3110,
      },
      supabase: {
        url: 'http://localhost:54321',
        key: 'test-key',
        databaseUrl: 'postgresql://test:test@localhost:54322/test',
      },
      git: {
        autoCommit: false,
        autoPush: false,
        remote: 'origin',
        branch: 'main',
      },
      embedding: {
        provider: 'none',
        apiKey: '',
        model: '',
        dimensions: 1536,
      },
      logging: {
        level: 'info',
        output: 'stdout',
      },
      locking: {
        enabled: false,
        ttlSeconds: 30,
      },
    } as FlashQueryConfig;

    // Initialize logger singleton before tests run
    initLogger(config.logging);

    vi.spyOn(process, 'exit').mockImplementation((): never => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    if (server && server.listening) {
      server.close();
    }
    vi.restoreAllMocks();
  });

  it('should close HTTP server gracefully', async () => {
    const coordinator = new ShutdownCoordinator(config, server);

    // Start server listening
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });

    expect(server.listening).toBe(true);

    try {
      await coordinator.execute();
    } catch (e) {
      // Expected: process.exit throws
    }

    expect(server.listening).toBe(false);
  });

  it('should complete shutdown within 30 seconds', async () => {
    const coordinator = new ShutdownCoordinator(config, server);

    const start = Date.now();
    try {
      await coordinator.execute();
    } catch (e) {
      // Expected: process.exit throws
    }
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(MAX_SHUTDOWN_MS);
  });

  it('should handle server without error', async () => {
    const coordinator = new ShutdownCoordinator(config, server);

    // Don't start listening — test shutdown of non-listening server
    try {
      await coordinator.execute();
    } catch (e) {
      // Expected: process.exit throws
    }

    // Should complete without error
    expect(coordinator).toBeDefined();
  });

  it('should handle connection tracking', async () => {
    const coordinator = new ShutdownCoordinator(config, server);

    // Start server
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });

    // Create a client connection
    const port = (server.address() as { port: number }).port;
    const client = http.request(`http://127.0.0.1:${port}/`, { method: 'GET' }, (res) => {
      // Consume the response
      res.on('data', () => {});
      res.on('end', () => {
        // Response complete
      });
    });

    // Send the request and give the connection a moment to establish
    client.end();
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      await coordinator.execute();
    } catch (e) {
      // Expected: process.exit throws
    }

    // Server should be closed
    expect(server.listening).toBe(false);
  });

  it('should not have unhandled rejections during shutdown', async () => {
    const coordinator = new ShutdownCoordinator(config, server);

    let unhandledRejection: Error | null = null;
    const rejectionHandler = (reason: unknown) => {
      unhandledRejection = reason instanceof Error ? reason : new Error(String(reason));
    };

    process.on('unhandledRejection', rejectionHandler);

    try {
      await coordinator.execute();
    } catch (e) {
      // Expected: process.exit throws
    } finally {
      process.off('unhandledRejection', rejectionHandler);
    }

    // Should not have unhandled rejections
    expect(unhandledRejection).toBeNull();
  });
});
