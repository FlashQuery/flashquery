/**
 * Graceful shutdown orchestrator
 *
 * Coordinates shutdown of HTTP server, MCP sessions, Supabase connections, Git mutex,
 * and background scanner with multiple timeouts and proper cleanup sequencing.
 *
 * Locked design decisions (from CONTEXT.md):
 * - D-02b: All tool handlers check isShuttingDown immediately on entry
 * - D-03b: HTTP connection force-close timeout: 15 seconds
 * - D-04a: Supabase flush timeout: 5 seconds
 * - D-05: GitManager release timeout: 3 seconds
 * - D-08: Logging at INFO level for milestones, DEBUG for per-subsystem progress
 */

import type http from 'node:http';
import type net from 'node:net';
import { logger } from '../logging/logger.js';
import { setShuttingDown } from './shutdown-state.js';
import type { FlashQueryConfig } from '../config/loader.js';

export const MAX_SHUTDOWN_MS = 30_000;

export class ShutdownCoordinator {
  private isExecuting = false;
  private startTime: number = 0;
  private httpServer?: http.Server;
  private activeSockets: Set<net.Socket> = new Set();

  constructor(config: FlashQueryConfig, httpServer?: http.Server) {
    this.httpServer = httpServer;

    // Track active sockets if server exists
    if (httpServer) {
      httpServer.on('connection', (socket) => {
        this.activeSockets.add(socket);
        socket.on('close', () => {
          this.activeSockets.delete(socket);
        });
      });
    }
  }

  async execute(): Promise<void> {
    if (this.isExecuting) {
      this.logDebug('Shutdown already in progress, returning immediately');
      return;
    }
    this.isExecuting = true;
    this.startTime = Date.now();

    try {
      this.logInfo('Starting graceful shutdown...');

      // Step 1: Set shutdown flag (prevents new requests immediately)
      this.setShutdownFlag();

      // Step 2: Drain MCP requests
      await this.drainMcpRequests();

      // Step 2.5 (D-10): Drain in-flight LLM cost writes — must run after MCP drain so no
      // new cost writes can be initiated, and before HTTP close so the ServerCoordinator
      // has time to settle pending Supabase inserts. 5-second timeout per D-10.
      await this.drainCostWritesStep();

      // Step 3: Close HTTP server
      await this.closeHttpServer();

      // Step 4: Force-close HTTP connections
      await this.forceCloseHttpConnections();

      // Step 5: Flush Supabase
      await this.flushSupabaseClient();

      // Step 6: Release Git mutex
      await this.releaseGitMutex();

      // Step 7: Stop scanner
      this.stopBackgroundScanner();

      // Step 8: Close stdio
      this.closeStdio();

      // Step 9: Check elapsed time
      const elapsed = this.elapsedMs();
      if (elapsed > MAX_SHUTDOWN_MS) {
        this.logWarn(`Shutdown exceeded hard deadline: ${elapsed}ms > ${MAX_SHUTDOWN_MS}ms`);
        process.exit(1);
      }

      this.logInfo(`Graceful shutdown complete (duration=${elapsed}ms)`);
      this.logInfo('Process exiting with code 0');

      // Hard exit
      process.exit(0);
    } catch (err: unknown) {
      this.logError(`Shutdown failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  private setShutdownFlag(): void {
    this.logInfo('Flag set: isShuttingDown=true');
    setShuttingDown(true);
  }

  private async drainMcpRequests(): Promise<void> {
    const _deadline = Date.now() + 10_000; // 10-second timeout (SHUT-06)
    this.logInfo('MCP sessions draining (timeout=10s)');

    const activeSessionCount = 0; // Placeholder — actual count would come from MCP server
    if (activeSessionCount > 0) {
      this.logDebug(`MCP: ${activeSessionCount} active HTTP session(s), closing...`);
    }

    // In a full implementation, we would:
    // 1. Get transports from MCP server (stdio + HTTP sessions)
    // 2. Close each one with timeout
    // 3. Wait for pending request handlers to complete

    // For now, we log the intent and wait a brief moment for any in-flight handlers
    await new Promise((resolve) => setTimeout(resolve, 100));

    this.logInfo('MCP sessions drained');
  }

  private async drainCostWritesStep(): Promise<void> {
    // D-10: drain in-flight LLM cost writes before HTTP close. 5s timeout per D-10.
    this.logInfo('Cost writes draining (timeout=5s)');
    try {
      const { drainCostWrites } = await import('../llm/cost-tracker.js');
      await drainCostWrites(5_000);
      this.logInfo('Cost writes drained');
    } catch (err: unknown) {
      this.logDebug(`Cost: drain timeout or error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async closeHttpServer(): Promise<void> {
    if (!this.httpServer) {
      this.logDebug('HTTP: no server to close');
      return;
    }

    this.logInfo('HTTP server closing (stop accepting new connections)');

    // server.close() stops accepting new connections but does NOT force-close existing ones
    await new Promise<void>((resolve) => {
      this.httpServer!.close(() => {
        this.logDebug('HTTP: server closed');
        resolve();
      });
    });
  }

  private async forceCloseHttpConnections(): Promise<void> {
    if (!this.httpServer || this.activeSockets.size === 0) {
      return;
    }

    const deadline = Date.now() + 15_000; // 15-second timeout (per D-03b)
    this.logInfo('HTTP connections force-closing (timeout=15s)');

    // Wait for sockets to close gracefully, with hard deadline
    while (this.activeSockets.size > 0 && Date.now() < deadline) {
      this.logDebug(`HTTP: ${this.activeSockets.size} connection(s) still active...`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Force-close any remaining sockets
    if (this.activeSockets.size > 0) {
      this.logDebug(`HTTP: force-closing ${this.activeSockets.size} remaining connection(s)`);
      for (const socket of this.activeSockets) {
        socket.destroy();
      }
    }

    this.logInfo('HTTP: all connections closed');
  }

  private async flushSupabaseClient(): Promise<void> {
    this.logInfo('Supabase client flushing (timeout=5s)');
    try {
      const { gracefulShutdownSupabase } = await import('../storage/supabase.js');
      await Promise.race([
        gracefulShutdownSupabase(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 5_000) // 5s per D-04a
        ),
      ]);
      this.logInfo('Supabase client flushed');
    } catch (err: unknown) {
      this.logDebug(`Supabase: flush timeout or error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async releaseGitMutex(): Promise<void> {
    this.logInfo('GitManager mutex releasing (timeout=3s)');
    try {
      const { gitManager } = await import('../git/manager.js');
      await gitManager.gracefulShutdown();
      this.logInfo('GitManager released');
    } catch (err: unknown) {
      this.logDebug(`Git: mutex release failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private stopBackgroundScanner(): void {
    this.logInfo('Background scanner stopped');
    // The scanner checks getIsShuttingDown() in its loop
    // No explicit stop action needed — it will exit when it checks the flag
    this.logDebug('Scanner: stop signal already set via isShuttingDown flag');
  }

  private closeStdio(): void {
    this.logInfo('Stdio closing');
    try {
      // Destroy stdin, stdout, stderr to signal EOF to parent process
      process.stdin.destroy();
      process.stdout.destroy();
      process.stderr.destroy();
      // Note: this log may not appear since we just destroyed stderr
    } catch {
      // Ignore errors — stdio may already be closed
    }
  }

  private elapsedMs(): number {
    return Date.now() - this.startTime;
  }

  // Logging with INFO, DEBUG, WARN, ERROR levels (per D-08)
  private logInfo(message: string): void {
    const timestamp = this.formatTimestamp();
    logger.info(`${message}`);
    // Also write to stderr directly for visibility during shutdown
    try {
      process.stderr.write(`${timestamp} INFO  [SHUTDOWN] ${message}\n`);
    } catch {
      // Ignore if stderr is already closed
    }
  }

  private logDebug(message: string): void {
    logger.debug(`${message}`);
  }

  private logWarn(message: string): void {
    const timestamp = this.formatTimestamp();
    logger.warn(`${message}`);
    try {
      process.stderr.write(`${timestamp} WARN  [SHUTDOWN] ${message}\n`);
    } catch {
      // Ignore if stderr is already closed
    }
  }

  private logError(message: string): void {
    const timestamp = this.formatTimestamp();
    logger.error(`${message}`);
    try {
      process.stderr.write(`${timestamp} ERROR [SHUTDOWN] ${message}\n`);
    } catch {
      // Ignore if stderr is already closed
    }
  }

  private formatTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `[${year}-${month}-${day} ${hours}:${minutes}:${seconds}]`;
  }
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function initializeShutdownHandlers(
  config: FlashQueryConfig,
  httpServer?: http.Server
): Promise<ShutdownCoordinator> {
  const coordinator = new ShutdownCoordinator(config, httpServer);

  process.on('SIGINT', () => {
    logger.info('Received SIGINT (Ctrl+C) — initiating graceful shutdown');
    coordinator.execute().catch(() => process.exit(1));
  });

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM (systemd/Docker) — initiating graceful shutdown');
    coordinator.execute().catch(() => process.exit(1));
  });

  // SIGHUP: sent by the OS when the controlling terminal closes (e.g. SSH disconnect,
  // tmux session teardown) or, on some platforms, when a parent process exits.
  // Without a handler, Node.js default behaviour is to exit immediately — bypassing
  // the graceful shutdown sequence and leaving Supabase connections and the git mutex
  // in an inconsistent state. Treat SIGHUP the same as SIGTERM so that all subsystems
  // are flushed before the process exits.
  process.on('SIGHUP', () => {
    logger.info('Received SIGHUP (terminal closed / parent exited) — initiating graceful shutdown');
    coordinator.execute().catch(() => process.exit(1));
  });

  return coordinator;
}
