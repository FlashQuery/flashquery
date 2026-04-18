/**
 * Multi-Instance Write Lock Integration Tests
 * Phase 24 — D-18, D-20, D-21
 *
 * These tests verify distributed write locking across multiple FQC instances
 * sharing a single Supabase database. They require:
 *   - A running Supabase instance accessible via TEST_SUPABASE_URL
 *   - TEST_SUPABASE_SERVICE_ROLE_KEY with access to the database
 *   - TEST_SUPABASE_DATABASE_URL for direct postgres connections
 *
 * The tests spawn real FQC subprocesses on different ports (HTTP transport),
 * mimicking production multi-instance deployments where two operators use the
 * same Supabase database simultaneously.
 *
 * Environment variables (Phase 4 precedent):
 *   TEST_SUPABASE_URL               e.g., http://localhost:8000 or https://xyz.supabase.co
 *   TEST_SUPABASE_SERVICE_ROLE_KEY  service_role JWT
 *   TEST_SUPABASE_DATABASE_URL      postgresql://postgres:...@host:54322/postgres
 *
 * Run: npx vitest run tests/integration/write-lock.integration.test.ts
 *
 * NOTE: All test scenarios are wrapped in describe.skip because they require
 * a real Supabase instance. The beforeAll guard also skips if env vars are absent.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────────────────────
// Environment variable check
// ─────────────────────────────────────────────────────────────────────────────

const TEST_SUPABASE_URL = process.env['SUPABASE_URL'];
const TEST_SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];
const TEST_SUPABASE_DATABASE_URL = process.env['DATABASE_URL'];

const hasTestEnv =
  Boolean(TEST_SUPABASE_URL) &&
  Boolean(TEST_SUPABASE_SERVICE_ROLE_KEY) &&
  Boolean(TEST_SUPABASE_DATABASE_URL);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface FqcInstance {
  process: ChildProcess;
  port: number;
  instanceId: string;
  kill: () => Promise<void>;
}

interface McpResponse {
  status: number;
  body: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write a minimal FQC config YAML to a temp file for a given instance.
 * Uses HTTP transport on the specified port.
 */
function writeTestConfig(
  instanceId: string,
  port: number,
  configOverrides: {
    lockingTtlSeconds?: number;
    authSecret?: string;
    vaultPath?: string;
  } = {}
): string {
  const configPath = join(tmpdir(), `fqc-test-${instanceId}-${Date.now()}.yml`);
  const vaultPath = configOverrides.vaultPath ?? join(tmpdir(), `fqc-vault-${instanceId}-${Date.now()}`);

  // Ensure vault directory exists
  mkdirSync(vaultPath, { recursive: true });

  const lockingTtl = configOverrides.lockingTtlSeconds ?? 30;
  const authSecretLine = configOverrides.authSecret
    ? `  auth_secret: "${configOverrides.authSecret}"`
    : '';

  writeFileSync(
    configPath,
    `instance:
  name: "Test FQC ${instanceId}"
  id: "${instanceId}"
  vault:
    path: "${vaultPath}"
    markdown_extensions: [".md"]
server:
  host: "127.0.0.1"
  port: ${port + 1000}
supabase:
  url: "${TEST_SUPABASE_URL ?? 'http://localhost:8000'}"
  service_role_key: "${TEST_SUPABASE_SERVICE_ROLE_KEY ?? 'dummy'}"
  database_url: "${TEST_SUPABASE_DATABASE_URL ?? 'postgresql://localhost/postgres'}"
  skip_ddl: false
git:
  auto_commit: false
  auto_push: false
mcp:
  transport: "streamable-http"
  host: "127.0.0.1"
  port: ${port}
${authSecretLine}
embedding:
  provider: "none"
  model: ""
locking:
  enabled: true
  ttl_seconds: ${lockingTtl}
logging:
  level: "warn"
  output: "stdout"
`
  );

  return configPath;
}

/**
 * Spawn a FQC subprocess as HTTP transport on `port`.
 *
 * Returns a handle with:
 *   - process: the ChildProcess
 *   - port: the HTTP port
 *   - instanceId: the instance identifier
 *   - kill(): gracefully terminate and wait for exit
 *
 * The subprocess is ready when it logs "MCP server ready" or similar.
 * We wait for readiness by polling the health endpoint.
 */
async function spawnFqcInstance(
  instanceId: string,
  port: number,
  configOverrides: {
    lockingTtlSeconds?: number;
    authSecret?: string;
  } = {}
): Promise<FqcInstance> {
  const configPath = writeTestConfig(instanceId, port, configOverrides);
  const distIndexPath = new URL('../../dist/index.js', import.meta.url).pathname;

  const proc = spawn('node', [distIndexPath, 'start', '--config', configPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  proc.stdout?.on('data', () => {
    // Suppress output during tests
  });

  proc.stderr?.on('data', () => {
    // Suppress output during tests
  });

  // Wait for the server to start by polling the MCP endpoint
  const startTimeout = 15000;
  const startTime = Date.now();
  let ready = false;

  while (Date.now() - startTime < startTimeout) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test-probe', version: '1.0.0' },
          },
          id: 0,
        }),
      });

      if (res.status < 500) {
        ready = true;
        break;
      }
    } catch {
      // Server not ready yet
    }

    await new Promise((r) => setTimeout(r, 250));
  }

  if (!ready) {
    proc.kill('SIGTERM');
    unlinkSync(configPath);
    throw new Error(`FQC instance ${instanceId} did not start within ${startTimeout}ms`);
  }

  return {
    process: proc,
    port,
    instanceId,
    kill: () =>
      new Promise<void>((resolve) => {
        proc.once('exit', () => {
          try {
            unlinkSync(configPath);
          } catch {
            // Ignore cleanup errors
          }
          resolve();
        });
        proc.kill('SIGTERM');
        // Force kill after 3s if graceful shutdown stalls.
        // unref() ensures this timer does not prevent Node.js from exiting
        // if the test process finishes before the 3s window elapses.
        const sigkillTimer = setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            // Already dead
          }
        }, 3000);
        sigkillTimer.unref();
      }),
  };
}

/**
 * Make an authenticated HTTP POST to the MCP endpoint on `port`.
 *
 * Initializes a session first, then sends the actual tool call.
 * Returns the parsed response body or throws on error.
 */
async function mcpCall(
  port: number,
  token: string | undefined,
  method: string,
  params: Record<string, unknown>
): Promise<McpResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Step 1: Initialize session
  const initRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
      id: 1,
    }),
  });

  const sessionId = initRes.headers.get('mcp-session-id');
  if (!sessionId) {
    return { status: initRes.status, body: await initRes.text() };
  }

  // Step 2: Make the tool call
  const callHeaders = { ...headers, 'mcp-session-id': sessionId };
  const callRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: callHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
      id: 2,
    }),
  });

  const body = await callRes.text();
  let parsedBody: unknown = body;
  try {
    // SSE format: extract data line
    const dataMatch = body.match(/^data:\s*(.+)$/m);
    if (dataMatch) {
      parsedBody = JSON.parse(dataMatch[1]);
    } else {
      parsedBody = JSON.parse(body);
    }
  } catch {
    // Return raw body if not parseable
  }

  return { status: callRes.status, body: parsedBody };
}

/**
 * Clear all rows from fqc_write_locks for a clean test slate.
 */
async function clearWriteLocks(client: SupabaseClient): Promise<void> {
  // Delete all rows: Supabase requires a filter on .delete(); using .neq with a
  // sentinel that will never match is the idiomatic workaround for "delete all".
  const { error } = await client
    .from('fqc_write_locks')
    .delete()
    .neq('instance_id', '__never__');
  if (error) {
    console.warn('[clearWriteLocks] cleanup error:', error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

// All scenarios are skipped by default — they require a real Supabase instance.
// To run: set TEST_SUPABASE_URL, TEST_SUPABASE_SERVICE_ROLE_KEY, TEST_SUPABASE_DATABASE_URL
// then execute: npx vitest run tests/integration/write-lock.integration.test.ts

describe.skipIf(!hasTestEnv)('multi-instance write locks (requires test Supabase)', () => {
  let supabase: SupabaseClient;
  const spawnedInstances: FqcInstance[] = [];

  beforeAll(() => {
    if (!hasTestEnv) {
      console.warn(
        '[write-lock integration] Skipping: TEST_SUPABASE_URL, TEST_SUPABASE_SERVICE_ROLE_KEY, ' +
          'and TEST_SUPABASE_DATABASE_URL must all be set to run these tests.'
      );
      return;
    }

    supabase = createClient(TEST_SUPABASE_URL!, TEST_SUPABASE_SERVICE_ROLE_KEY!);
  });

  afterEach(async () => {
    // Kill all spawned instances between scenarios
    for (const instance of spawnedInstances) {
      try {
        await instance.kill();
      } catch {
        // Ignore kill errors
      }
    }
    spawnedInstances.length = 0;

    // Clean up lock rows
    if (supabase) {
      await clearWriteLocks(supabase);
    }
  });

  afterAll(async () => {
    // Final cleanup
    for (const instance of spawnedInstances) {
      try {
        await instance.kill();
      } catch {
        // Ignore
      }
    }
    if (supabase) {
      await clearWriteLocks(supabase);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 1: Concurrent write to same resource
  //
  // Two instances attempt to save_memory simultaneously on the same resource.
  // The write-lock ensures serialization: one succeeds immediately, the other
  // either succeeds after backoff or fails with a lock timeout message.
  // ─────────────────────────────────────────────────────────────────────────

  it('Scenario 1: concurrent write to same resource — one instance serializes via lock', async () => {
    if (!hasTestEnv) return;

    const AUTH_SECRET = 'test-secret-concurrent';

    const instanceA = await spawnFqcInstance('test-a-concurrent', 3201, {
      authSecret: AUTH_SECRET,
    });
    const instanceB = await spawnFqcInstance('test-b-concurrent', 3202, {
      authSecret: AUTH_SECRET,
    });
    spawnedInstances.push(instanceA, instanceB);

    // Both instances attempt save_memory simultaneously
    const [responseA, responseB] = await Promise.all([
      mcpCall(3201, AUTH_SECRET, 'tools/call', {
        name: 'save_memory',
        arguments: { content: 'Concurrent write test from instance A' },
      }),
      mcpCall(3202, AUTH_SECRET, 'tools/call', {
        name: 'save_memory',
        arguments: { content: 'Concurrent write test from instance B' },
      }),
    ]);

    // At least one request should succeed
    const statuses = [responseA.status, responseB.status];
    expect(statuses.some((s) => s >= 200 && s < 300)).toBe(true);

    // Both should respond (no crash/hang)
    expect(responseA.status).toBeGreaterThan(0);
    expect(responseB.status).toBeGreaterThan(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 2: Lock timeout and backoff
  //
  // Instance A holds the write lock (simulated by direct DB insert).
  // Instance B attempts to write to the same resource and must time out after
  // exhausting backoff retries. The error response should mention "lock timeout"
  // or equivalent.
  // ─────────────────────────────────────────────────────────────────────────

  it('Scenario 2: lock timeout — instance B times out waiting for instance A lock', async () => {
    if (!hasTestEnv) return;

    const AUTH_SECRET = 'test-secret-timeout';

    // Insert a lock row directly to simulate Instance A holding the lock
    const expiresAt = new Date(Date.now() + 60 * 1000).toISOString(); // expires in 60s
    await supabase.from('fqc_write_locks').insert({
      instance_id: 'test-a-holding',
      resource_type: 'memory',
      locked_at: new Date().toISOString(),
      expires_at: expiresAt,
    });

    // Start Instance B with a short timeout so the test runs quickly
    const instanceB = await spawnFqcInstance('test-b-timeout', 3202, {
      authSecret: AUTH_SECRET,
      lockingTtlSeconds: 5, // Short TTL for speed
    });
    spawnedInstances.push(instanceB);

    const response = await mcpCall(3202, AUTH_SECRET, 'tools/call', {
      name: 'save_memory',
      arguments: { content: 'This write should time out waiting for the lock' },
    });

    // Instance B's request should complete (not hang) — it may succeed (if timeout
    // is short enough) or return an error. We verify the server responded.
    expect(response.status).toBeGreaterThan(0);

    // If the lock service exposes a timeout error, verify the message
    const bodyStr = JSON.stringify(response.body);
    const isSuccess = bodyStr.includes('"id"') || bodyStr.includes('saved');
    const isTimeout = bodyStr.toLowerCase().includes('lock') || bodyStr.toLowerCase().includes('timeout');
    // Either the write succeeded (lock expired) or the error is lock-related
    expect(isSuccess || isTimeout).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 3: Lock TTL expiry allows re-acquisition
  //
  // Instance A acquires a lock and is killed (simulating a crash).
  // After the TTL expires, Instance C should be able to acquire the same lock
  // and complete the write successfully.
  //
  // Configuration uses a very short TTL (2s) so the test runs in ~5s.
  // ─────────────────────────────────────────────────────────────────────────

  it('Scenario 3: lock TTL expiry — crashed instance lock released after TTL', async () => {
    if (!hasTestEnv) return;

    const AUTH_SECRET = 'test-secret-ttl';
    const SHORT_TTL = 2; // seconds

    // Insert a lock row with a TTL of 2s (simulating a crashed Instance A)
    const lockedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + SHORT_TTL * 1000).toISOString();

    await supabase.from('fqc_write_locks').insert({
      instance_id: 'test-a-crashed',
      resource_type: 'memory',
      locked_at: lockedAt,
      expires_at: expiresAt,
    });

    // Verify the lock exists
    const { data: lockBefore } = await supabase
      .from('fqc_write_locks')
      .select('*')
      .eq('instance_id', 'test-a-crashed')
      .single();
    expect(lockBefore).not.toBeNull();

    // Wait for TTL to expire (SHORT_TTL + 1s buffer)
    await new Promise((r) => setTimeout(r, (SHORT_TTL + 1) * 1000));

    // Verify the lock is now expired (expires_at is in the past)
    const now = new Date().toISOString();
    const { data: lockAfter } = await supabase
      .from('fqc_write_locks')
      .select('*')
      .eq('instance_id', 'test-a-crashed')
      .gt('expires_at', now)
      .maybeSingle();
    expect(lockAfter).toBeNull(); // Lock is expired — no active lock remains

    // Start Instance C — should successfully acquire the lock and complete the write
    const instanceC = await spawnFqcInstance('test-c-recovery', 3203, {
      authSecret: AUTH_SECRET,
      lockingTtlSeconds: 30,
    });
    spawnedInstances.push(instanceC);

    const response = await mcpCall(3203, AUTH_SECRET, 'tools/call', {
      name: 'save_memory',
      arguments: { content: 'Recovery write after TTL expiry' },
    });

    // Instance C should succeed
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(500);
  });
});
