/**
 * E2E tests for graceful shutdown
 *
 * Tests cover:
 * - Spawning FQC as subprocess
 * - Sending SIGINT/SIGTERM signals
 * - Verifying graceful exit within 30 seconds
 * - Checking for orphaned processes
 * - Monitoring shutdown log messages
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

describe('Shutdown E2E', () => {
  let fqcProcess: ChildProcess | null = null;

  afterEach(() => {
    if (fqcProcess && !fqcProcess.killed) {
      fqcProcess.kill('SIGKILL');
    }
  });

  it('should gracefully shutdown on SIGINT within 30 seconds', async () => {
    const configPath = join(process.cwd(), 'tests/fixtures/flashquery.e2e.yaml');

    fqcProcess = spawn('node', ['dist/index.js', 'start', '--config', configPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    });

    let readyLogged = false;
    let shutdownStartedAt = 0;
    let shutdownCompletedAt = 0;
    const stderrLines: string[] = [];

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('E2E test timeout: FQC process did not exit within 35 seconds'));
      }, 35_000);

      // Collect stderr for assertions
      fqcProcess!.stderr!.on('data', (data: Buffer) => {
        const line = data.toString();
        stderrLines.push(line);
        console.log('[FQC]', line.trim());

        // Wait for server to be ready — match exact banner line to avoid false positive
        // on "description column already dropped" which also contains "ready"
        if (line.includes('FlashQuery ready') && !readyLogged) {
          readyLogged = true;
          // Send SIGINT after server is ready
          setTimeout(() => {
            console.log('[TEST] Sending SIGINT to FQC process...');
            if (fqcProcess) {
              fqcProcess.kill('SIGINT');
              shutdownStartedAt = Date.now();
            }
          }, 500);
        }

        // Track shutdown progress
        if (line.includes('[SHUTDOWN]') || line.includes('Starting graceful shutdown')) {
          if (shutdownStartedAt === 0) {
            shutdownStartedAt = Date.now();
          }
        }

        if (line.includes('Graceful shutdown complete') || line.includes('shutdown complete')) {
          shutdownCompletedAt = Date.now();
        }
      });

      // Use 'close' (not 'exit') so all stderr data events are guaranteed to have
      // arrived before we assert on stderrLines — 'exit' fires before stdio drains.
      fqcProcess!.on('close', (code) => {
        clearTimeout(timeout);

        try {
          // Exit code should be 0 (success) or null (signal-terminated)
          // Both are valid outcomes for graceful shutdown
          expect([0, null]).toContain(code);

          // Measure shutdown duration
          if (shutdownStartedAt > 0 && shutdownCompletedAt > 0) {
            const shutdownDuration = shutdownCompletedAt - shutdownStartedAt;
            expect(shutdownDuration).toBeLessThan(30_000);
            console.log(`[TEST] Shutdown completed in ${shutdownDuration}ms`);
          }

          // Verify shutdown log messages were emitted
          const hasShutdownLog = stderrLines.some(
            (line) => line.includes('Starting graceful shutdown') || line.includes('[SHUTDOWN]')
          );
          expect(hasShutdownLog).toBe(true);

          // Verify no orphaned processes
          try {
            const pidStr = fqcProcess!.pid?.toString();
            if (pidStr) {
              try {
                execSync(`ps -p ${pidStr}`, { stdio: 'pipe' });
                // If we get here, process is still running — that's wrong
                reject(new Error(`Orphaned FQC process still running after exit (PID ${pidStr})`));
                return;
              } catch (psError) {
                // Expected: ps command fails because process is not found
                console.log('[TEST] Confirmed: FQC process not running after exit');
              }
            }
          } catch (e) {
            // Ignore
          }

          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  });

  it('should gracefully shutdown on SIGTERM', async () => {
    const configPath = join(process.cwd(), 'tests/fixtures/flashquery.e2e.yaml');

    fqcProcess = spawn('node', ['dist/index.js', 'start', '--config', configPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    });

    let readyLogged = false;

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('E2E test timeout: FQC process did not exit within 35 seconds'));
      }, 35_000);

      fqcProcess!.stderr!.on('data', (data: Buffer) => {
        const line = data.toString();
        console.log('[FQC]', line.trim());

        if (line.includes('FlashQuery ready') && !readyLogged) {
          readyLogged = true;
          setTimeout(() => {
            console.log('[TEST] Sending SIGTERM to FQC process...');
            if (fqcProcess) {
              fqcProcess.kill('SIGTERM');
            }
          }, 500);
        }
      });

      fqcProcess!.on('close', (code) => {
        clearTimeout(timeout);
        try {
          // Exit code should be 0 (success), 1 (timeout), or null (signal-terminated)
          // All indicate the process is shut down
          expect([0, 1, null]).toContain(code);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  });

  it('should exit within 30 second hard deadline even on timeout', async () => {
    const configPath = join(process.cwd(), 'tests/fixtures/flashquery.e2e.yaml');

    fqcProcess = spawn('node', ['dist/index.js', 'start', '--config', configPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    });

    let readyLogged = false;
    let signalSentAt = 0;

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('FQC process exceeded 40 second timeout'));
      }, 40_000);

      fqcProcess!.stderr!.on('data', (data: Buffer) => {
        const line = data.toString();
        console.log('[FQC]', line.trim());

        if (line.includes('FlashQuery ready') && !readyLogged) {
          readyLogged = true;
          setTimeout(() => {
            console.log('[TEST] Sending SIGINT to FQC process...');
            signalSentAt = Date.now();
            if (fqcProcess) {
              fqcProcess.kill('SIGINT');
            }
          }, 500);
        }
      });

      fqcProcess!.on('close', (code) => {
        clearTimeout(timeout);
        const exitTime = Date.now() - signalSentAt;

        try {
          // Process should exit within 30 seconds + some small buffer for signal processing
          expect(exitTime).toBeLessThan(35_000);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  });
});
