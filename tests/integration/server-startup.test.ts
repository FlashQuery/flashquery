/**
 * Integration test for PORT-07: Verify FQC startup fails with actionable error
 * message when configured HTTP port is already in use.
 *
 * This test spawns two FQC instances with the same config and port to verify:
 * 1. First instance starts successfully and binds to port 3100
 * 2. Second instance fails immediately with error message "Port 3100 already in use..."
 * 3. Second instance exits with code 1
 * 4. No orphaned processes left after test completes
 */

import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as net from 'node:net';

const __dirname = import.meta.dirname;
const projectRoot = join(__dirname, '../..');

/** Find a free TCP port by binding to :0 and immediately releasing it. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on('error', reject);
  });
}

interface SpawnedProcess {
  process: ChildProcess;
  stdout: { value: string };
  stderr: { value: string };
}

describe('Server Startup — Port Availability (Integration)', () => {
  let firstProcess: SpawnedProcess | null = null;
  let secondProcess: SpawnedProcess | null = null;

  /**
   * Helper to spawn FQC process with config and capture output
   */
  function spawnFQC(configPath: string): Promise<SpawnedProcess> {
    return new Promise((resolve, reject) => {
      const stdout = { value: '' };
      const stderr = { value: '' };

      const proc = spawn('node', ['dist/index.js', 'start', '--config', configPath], {
        cwd: projectRoot,
        stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr as pipes
      });

      proc.stdout.on('data', (data: Buffer) => {
        stdout.value += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr.value += data.toString();
      });

      proc.on('error', (err: Error) => {
        reject(new Error(`Failed to spawn FQC: ${err.message}`));
      });

      // Resolve immediately when process is spawned (don't wait for exit)
      resolve({ process: proc, stdout, stderr });
    });
  }

  afterAll(async () => {
    // Cleanup: terminate both processes if still running
    if (firstProcess) {
      firstProcess.process.kill('SIGTERM');
      // Wait for process to exit
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 1000);
        firstProcess!.process.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    if (secondProcess) {
      secondProcess.process.kill('SIGTERM');
      // Wait for process to exit
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 1000);
        secondProcess!.process.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
  });

  beforeEach(() => {
    // Reset process references before each test
    firstProcess = null;
    secondProcess = null;
  });

  it('PORT-07: startup fails with actionable error when port is already in use', async () => {
    // Use a dynamically allocated free port to avoid conflicts with any running server
    const testPort = await findFreePort();
    const tempConfigPath = join(tmpdir(), `fqc-port-test-${testPort}.yml`);
    await fs.writeFile(
      tempConfigPath,
      `instance:
  name: "Port Test FlashQuery"
  id: "test-fqc-port-${testPort}"
  vault:
    path: "${tmpdir()}/fqc-port-test-vault-${testPort}"
    markdown_extensions: [".md"]
supabase:
  url: "https://test.supabase.co"
  service_role_key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.dummy"
  database_url: "postgresql://postgres:testpass@localhost:5432/postgres"
  skip_ddl: true
git:
  auto_commit: false
  auto_push: false
mcp:
  transport: "streamable-http"
  host: "127.0.0.1"
  port: ${testPort}
embedding:
  provider: "none"
  model: ""
  dimensions: 1536
logging:
  level: "info"
  output: "stdout"
`
    );

    // 1. Start first FQC instance (should succeed)
    firstProcess = await spawnFQC(tempConfigPath);

    // Wait for first instance to bind to port (wait for "ready" message)
    // The instance should get past port check and log "Port 3100 available" and then "ready"
    await new Promise<void>((resolve, reject) => {
      let hasExited = false;
      const timeout = setTimeout(() => {
        if (!hasExited) {
          reject(new Error('First FQC instance did not reach ready state within 5 seconds'));
        }
      }, 5000);

      const checkReady = () => {
        // Check for various success indicators that the port check passed
        if (
          firstProcess!.stderr.value.includes(`Port ${testPort} available`) ||
          firstProcess!.stderr.value.includes('Core ready') ||
          firstProcess!.stderr.value.includes('MCP')
        ) {
          clearTimeout(timeout);
          resolve();
        }
      };

      // Monitor for process exit (would indicate failure)
      firstProcess!.process.on('exit', (code: number | null) => {
        hasExited = true;
        clearTimeout(timeout);
        // Reject with actual stderr to help debug
        reject(new Error(`First FQC instance exited with code ${code}.\nStderr: ${firstProcess!.stderr.value}`));
      });

      // Poll stderr output while waiting
      const pollInterval = setInterval(() => {
        checkReady();
      }, 100);

      // Final check after timeout period
      setTimeout(() => {
        clearInterval(pollInterval);
        if (!hasExited) {
          checkReady();
        }
      }, 5000);
    });

    // Small delay to ensure first process is fully listening on port
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 2. Start second FQC instance with same config (should fail on port check)
    secondProcess = await spawnFQC(tempConfigPath);

    // 3. Wait for second instance to exit (should be immediate due to port check failure)
    const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Second FQC instance did not exit within 3 seconds'));
      }, 3000);

      secondProcess!.process.on('exit', (code: number | null) => {
        clearTimeout(timeout);
        resolve({ code, stderr: secondProcess!.stderr.value });
      });

      secondProcess!.process.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(new Error(`Second FQC spawn error: ${err.message}`));
      });
    });

    // 4. Verify exit code is 1
    expect(result.code).toBe(1);

    // 5. Verify error message contains key phrases
    expect(result.stderr).toContain(`Port ${testPort} already in use`);
    expect(result.stderr).toContain('change mcp.port');
  }, 10000); // 10 second timeout for integration test
});
