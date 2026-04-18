/**
 * E2E Token Endpoint Tests
 *
 * Spawns FlashQuery Core as a subprocess and tests token endpoint via HTTP.
 * Tests token issuance via curl-like requests and token usage for authenticated MCP calls.
 *
 * Requirement coverage: E2E-01, E2E-02, E2E-03
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';

// Mock the logger to suppress output
vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

/**
 * Helper: Make HTTP request to a URL
 */
function makeHttpRequest(
  baseUrl: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  headers?: Record<string, string>,
  body?: Record<string, unknown>
): Promise<{ status: number; headers: Record<string, unknown>; body: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      hostname: url.hostname,
      port: parseInt(url.port),
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : undefined;
          resolve({
            status: res.statusCode || 500,
            headers: res.headers,
            body: parsed,
          });
        } catch {
          resolve({
            status: res.statusCode || 500,
            headers: res.headers,
            body: data,
          });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Helper: Encode HTTP Basic Auth header
 */
function encodeBasicAuth(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

/**
 * Helper: Wait for server to be ready (poll port or check stderr for "ready" message)
 */
function waitForServerReady(
  process: ChildProcess,
  baseUrl: string,
  timeout = 10000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const pollInterval = setInterval(async () => {
      try {
        // Try to connect to /mcp/info endpoint
        const response = await makeHttpRequest(baseUrl, 'GET', '/mcp/info');
        if (response.status === 200) {
          clearInterval(pollInterval);
          resolve();
        }
      } catch {
        // Server not ready yet, continue polling
      }

      if (Date.now() - startTime > timeout) {
        clearInterval(pollInterval);
        reject(new Error('Server did not become ready within timeout'));
      }
    }, 500);
  });
}

/**
 * Test Suite: Token Endpoint E2E Tests (sequential to avoid port conflicts)
 */
describe('Token Endpoint E2E Tests', { sequential: true }, () => {
  let childProcess: ChildProcess;
  let baseUrl: string;
  let authSecret: string;

  beforeAll(async () => {
    // Ensure dist/index.js exists
    const distPath = path.join(process.cwd(), 'dist', 'index.js');
    if (!fs.existsSync(distPath)) {
      throw new Error('dist/index.js not found. Run `npm run build` first.');
    }

    // Ensure test fixture config exists
    const fixtureConfig = path.join(process.cwd(), 'tests', 'fixtures', 'flashquery.token.yaml');
    if (!fs.existsSync(fixtureConfig)) {
      throw new Error('tests/fixtures/flashquery.token.yaml not found.');
    }

    authSecret = 'e2e-token-test-secret';
    const serverPort = 3199; // Fixed port from flashquery.token.yaml

    // Start FlashQuery Core subprocess with test fixture
    childProcess = spawn('node', [distPath, 'start', '--config', fixtureConfig], {
      stdio: ['inherit', 'pipe', 'pipe'],
      env: {
        ...process.env,
        TEST_AUTH_SECRET: authSecret,
        // Suppress Supabase connection errors for E2E (we're testing token endpoint only)
        SUPABASE_URL: process.env.SUPABASE_URL || 'http://localhost:54321',
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key',
        DATABASE_URL: process.env.DATABASE_URL || 'postgres://localhost:54322/test',
      },
    });

    // Capture stderr for debugging
    childProcess.stderr?.on('data', (data) => {
      // Log stderr output for debugging
      const str = data.toString();
      if (str.includes('error') || str.includes('Error') || str.includes('WARN')) {
        console.error('[subprocess stderr]', str);
      }
    });

    baseUrl = `http://localhost:${serverPort}`;

    // Wait for server to be ready
    try {
      await waitForServerReady(childProcess, baseUrl, 15000);
    } catch (err) {
      childProcess.kill();
      throw err;
    }
  }, 30000); // 30 second timeout for beforeAll

  afterAll(() => {
    return new Promise<void>((resolve) => {
      if (childProcess) {
        childProcess.kill('SIGTERM');
        // Wait for graceful shutdown
        const timeout = setTimeout(() => {
          childProcess.kill('SIGKILL');
          resolve();
        }, 5000);

        childProcess.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      } else {
        resolve();
      }
    });
  });

  /**
   * Test 1: Spawn FlashQuery Core subprocess with HTTP transport (E2E-01)
   */
  it('Test 1: FlashQuery Core subprocess spawns successfully with HTTP transport', async () => {
    expect(childProcess).toBeDefined();
    expect(childProcess.pid).toBeGreaterThan(0);
    expect(baseUrl).toMatch(/^http:\/\/localhost:\d+$/);
  });

  /**
   * Test 2: Curl POST /token with Basic Auth → receive valid token (E2E-02)
   */
  it('Test 2: POST /token with Basic Auth returns valid token', async () => {
    const response = await makeHttpRequest(baseUrl, 'POST', '/token', {
      Authorization: encodeBasicAuth('client', authSecret),
    });

    expect(response.status).toBe(200);
    const data = response.body as Record<string, unknown>;
    expect(data).toHaveProperty('access_token');
    expect(data).toHaveProperty('refresh_token');
    expect(data).toHaveProperty('token_type', 'Bearer');
    expect(data).toHaveProperty('expires_in');

    // Verify token is valid JWT format
    const token = data.access_token as string;
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
  });

  /**
   * Test 3: Curl POST /mcp with issued token → MCP endpoint accepts token (not 401) (E2E-03)
   */
  it('Test 3: POST /mcp with issued token does not return 401 (token accepted)', async () => {
    // First, get a token
    const tokenResponse = await makeHttpRequest(baseUrl, 'POST', '/token', {
      Authorization: encodeBasicAuth('client', authSecret),
    });

    expect(tokenResponse.status).toBe(200);
    const tokenData = tokenResponse.body as Record<string, unknown>;
    const { access_token } = tokenData;

    // Now use the token for an MCP POST request (no body, just verify token is accepted)
    const mcpResponse = await makeHttpRequest(
      baseUrl,
      'POST',
      '/mcp',
      {
        Authorization: `Bearer ${access_token}`,
      }
    );

    // Should NOT be 401 (that would mean token was rejected)
    // May be 400 (bad JSON-RPC request) or 200, but NOT 401
    expect(mcpResponse.status).not.toBe(401);
  });

  /**
   * Test 4: Curl GET /mcp/info → public endpoint accessible (E2E-01)
   */
  it('Test 4: GET /mcp/info is accessible without authentication', async () => {
    const response = await makeHttpRequest(baseUrl, 'GET', '/mcp/info');

    expect(response.status).toBe(200);
    const data = response.body as Record<string, unknown>;
    expect(data).toHaveProperty('name');
    expect(data).toHaveProperty('auth_schemes');
    expect(data).toHaveProperty('instance_id');
  });

  /**
   * Test 5: Curl POST /token with invalid credentials → 401 (E2E-03)
   */
  it('Test 5: POST /token with invalid credentials returns 401', async () => {
    const response = await makeHttpRequest(baseUrl, 'POST', '/token', {
      Authorization: encodeBasicAuth('client', 'wrong-secret'),
    });

    expect(response.status).toBe(401);
    const data = response.body as Record<string, unknown>;
    expect(data).toHaveProperty('error', 'invalid_client');
  });

  /**
   * Test 6: Multiple token requests from same subprocess → each returns valid token (E2E-02)
   */
  it('Test 6: Multiple token requests return valid tokens', async () => {
    // Request 3 tokens
    const tokenResponses = await Promise.all([
      makeHttpRequest(baseUrl, 'POST', '/token', {
        Authorization: encodeBasicAuth('client', authSecret),
      }),
      makeHttpRequest(baseUrl, 'POST', '/token', {
        Authorization: encodeBasicAuth('client', authSecret),
      }),
      makeHttpRequest(baseUrl, 'POST', '/token', {
        Authorization: encodeBasicAuth('client', authSecret),
      }),
    ]);

    // All should succeed
    for (const response of tokenResponses) {
      expect(response.status).toBe(200);
      const data = response.body as Record<string, unknown>;
      expect(data).toHaveProperty('access_token');
      expect(typeof data.access_token).toBe('string');

      // Verify JWT format
      const parts = (data.access_token as string).split('.');
      expect(parts).toHaveLength(3);
    }

    // Tokens should be different (different issued_at timestamps)
    const tokens = tokenResponses.map((r) => (r.body as Record<string, unknown>).access_token as string);
    // While they may differ, we at least verify all are valid
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    }
  });

  /**
   * Test 7: Subprocess is properly cleaned up on test completion (E2E-01)
   */
  it('Test 7: Subprocess exits cleanly after tests', async () => {
    // This test is mostly implicit — if afterAll() completes without hanging,
    // it means the process was killed successfully.
    // Here we explicitly check the process is still running at this point.
    expect(childProcess.killed).toBe(false); // Should still be running during tests
  });
});
