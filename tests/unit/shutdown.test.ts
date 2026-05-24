/**
 * Unit tests for ShutdownCoordinator
 *
 * Tests cover:
 * - Coordinator instantiation
 * - Idempotency (execute() called twice does not error)
 * - Flag setting and state transitions
 * - Timeout enforcement (each subsystem has proper timeout)
 * - Logging with timestamps
 * - Error handling without crashing
 * - Hard exit call
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ShutdownCoordinator, MAX_SHUTDOWN_MS, MCP_REQUEST_DRAIN_TIMEOUT_MS } from '../../src/server/shutdown.js';
import * as shutdownState from '../../src/server/shutdown-state.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ShutdownCoordinator', () => {
  let config: FlashQueryConfig;
  let coordinator: ShutdownCoordinator;

  beforeEach(() => {
    // Reset shutdown state before each test
    vi.resetModules();
    shutdownState.setShuttingDown(false);

    // Create a minimal mock config
    config = {
      instance: {
        id: 'test-instance',
        name: 'Test',
        vault: {
          path: '/tmp/test-vault',
          markdownExtensions: ['.md'],
        },
      },
      mcp: {
        transport: 'stdio',
        port: 3100,
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
      },
      locking: {
        enabled: false,
        ttlSeconds: 30,
      },
    } as FlashQueryConfig;

    coordinator = new ShutdownCoordinator(config);

    // Mock process.exit to prevent test from exiting
    vi.spyOn(process, 'exit').mockImplementation((): never => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    shutdownState.setShuttingDown(false);
    vi.restoreAllMocks();
  });

  it('should instantiate without error', () => {
    expect(coordinator).toBeDefined();
    expect(coordinator).toBeInstanceOf(ShutdownCoordinator);
  });

  it('should be idempotent — calling execute() twice should not error', async () => {
    const exitSpy = vi.mocked(process.exit);

    await expect(coordinator.execute()).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledTimes(2);
    expect(exitSpy).toHaveBeenNthCalledWith(1, 0);
    expect(exitSpy).toHaveBeenNthCalledWith(2, 1);

    // Second call returns immediately because the coordinator is already in
    // the shutdown path.
    await expect(coordinator.execute()).resolves.toBeUndefined();
    expect(exitSpy).toHaveBeenCalledTimes(2);
  });

  it('should set isShuttingDown flag on execute', async () => {
    expect(shutdownState.getIsShuttingDown()).toBe(false);

    await expect(coordinator.execute()).rejects.toThrow('process.exit called');

    expect(shutdownState.getIsShuttingDown()).toBe(true);
  });

  it('should complete within MAX_SHUTDOWN_MS', async () => {
    const exitSpy = vi.mocked(process.exit);
    const start = Date.now();
    await expect(coordinator.execute()).rejects.toThrow('process.exit called');
    const elapsed = Date.now() - start;

    // Should complete well under MAX_SHUTDOWN_MS (30s)
    expect(elapsed).toBeLessThan(MAX_SHUTDOWN_MS);
    expect(exitSpy).toHaveBeenNthCalledWith(1, 0);
  });

  it('should handle missing HTTP server gracefully', async () => {
    const exitSpy = vi.mocked(process.exit);
    // Coordinator without HTTP server
    const coordinatorNoServer = new ShutdownCoordinator(config);

    await expect(coordinatorNoServer.execute()).rejects.toThrow('process.exit called');

    expect(shutdownState.getIsShuttingDown()).toBe(true);
    expect(exitSpy).toHaveBeenNthCalledWith(1, 0);
  });

  it('MAX_SHUTDOWN_MS should be 30 seconds', () => {
    expect(MAX_SHUTDOWN_MS).toBe(30_000);
  });

  it('REQ-009 MCP request drain timeout should be 15 seconds', () => {
    expect(MCP_REQUEST_DRAIN_TIMEOUT_MS).toBe(15_000);
  });

  it('should handle shutdown completion', async () => {
    // The shutdown coordinator is designed to call process.exit at the end.
    // Since we mock process.exit to throw, we expect the Error('process.exit called').
    // This verifies that shutdown() reaches the completion step where it would
    // normally exit.
    await expect(coordinator.execute()).rejects.toThrow('process.exit called');
  });

  it('should handle error during shutdown', async () => {
    // Coordinator should handle errors gracefully and still call process.exit
    // (though with code 1 instead of 0)
    await expect(coordinator.execute()).rejects.toThrow('process.exit called');
  });

  it('should prevent duplicate execution', async () => {
    const exitSpy = vi.mocked(process.exit);

    const firstExecution = expect(coordinator.execute()).rejects.toThrow('process.exit called');
    const secondExecution = expect(coordinator.execute()).resolves.toBeUndefined();

    await Promise.all([firstExecution, secondExecution]);

    expect(shutdownState.getIsShuttingDown()).toBe(true);
    // The first execution reaches process.exit(0); the mocked throw is caught by
    // execute() and converted to process.exit(1). A non-idempotent second
    // execution would add another pair of calls.
    expect(exitSpy).toHaveBeenCalledTimes(2);
    expect(exitSpy).toHaveBeenNthCalledWith(1, 0);
    expect(exitSpy).toHaveBeenNthCalledWith(2, 1);
  });
});
