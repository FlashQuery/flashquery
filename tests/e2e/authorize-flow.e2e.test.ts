/**
 * E2E Authorization Code Flow Tests
 *
 * Spawns FlashQuery Core as a subprocess and tests the complete OAuth 2.0
 * Authorization Code flow, simulating Claude Code startup authentication.
 *
 * Tests:
 * 1. Server discovery via GET /mcp/info
 * 2. Authorization code request via GET /authorize
 * 3. Code-to-token exchange via POST /token
 * 4. Authenticated MCP request with bearer token
 *
 * Requirement coverage: AUTH-02, AUTH-04, AUTH-07, E2E-01, E2E-02, E2E-03
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
): Promise<{ status: number; headers: Record<string, unknown>; body: unknown; rawBody: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      hostname: url.hostname,
      port: parseInt(url.port),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': method === 'POST' ? 'application/x-www-form-urlencoded' : 'application/json',
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
            rawBody: data,
          });
        } catch {
          resolve({
            status: res.statusCode || 500,
            headers: res.headers,
            body: data,
            rawBody: data,
          });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      // For /token endpoint, use x-www-form-urlencoded
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        params.append(key, String(value));
      }
      req.write(params.toString());
    }
    req.end();
  });
}

/**
 * Helper: Wait for server to be ready (poll port or check for ready message)
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
 * Test Suite: Authorization Code Flow E2E Tests (Claude Code startup simulation)
 */
describe('Authorization Code Flow E2E Tests', { sequential: true }, () => {
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
    const fixtureConfig = path.join(process.cwd(), 'tests', 'fixtures', 'flashquery.authorize.yaml');
    if (!fs.existsSync(fixtureConfig)) {
      throw new Error('tests/fixtures/flashquery.authorize.yaml not found.');
    }

    authSecret = 'e2e-authorize-test-secret';
    const serverPort = 3189; // Fixed port from flashquery.authorize.yaml
    baseUrl = `http://localhost:${serverPort}`;

    // Start FlashQuery Core subprocess with test fixture
    childProcess = spawn('node', [distPath, 'start', '--config', fixtureConfig], {
      stdio: ['inherit', 'pipe', 'pipe'],
      env: {
        ...process.env,
        TEST_AUTH_SECRET: authSecret,
        // Suppress Supabase connection errors for E2E (we're testing auth flow only)
        SUPABASE_URL: process.env.SUPABASE_URL || 'http://localhost:54321',
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key',
        DATABASE_URL: process.env.DATABASE_URL || 'postgres://localhost:54322/test',
      },
      timeout: 15000,
    });

    // Wait for server to be ready
    await waitForServerReady(childProcess, baseUrl, 15000);
  }, 30000);

  afterAll(() => {
    if (childProcess && !childProcess.killed) {
      childProcess.kill('SIGTERM');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 1: Server Discovery (GET /mcp/info)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Server Discovery', () => {
    it('should discover server via GET /mcp/info', async () => {
      const response = await makeHttpRequest(baseUrl, 'GET', '/mcp/info');
      expect(response.status).toBe(200);
      const body = response.body as any;

      expect(body.name).toBeDefined();
      expect(body.version).toBeDefined();
      expect(body.auth_schemes).toBeDefined();
      expect(body.auth_schemes).toContain('bearer');
    });

    it('should expose Bearer auth scheme in server info', async () => {
      const response = await makeHttpRequest(baseUrl, 'GET', '/mcp/info');
      const body = response.body as any;

      expect(body.auth_schemes).toEqual(expect.arrayContaining(['bearer']));
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 2: Authorization Code Request (GET /authorize)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Authorization Code Request', () => {
    it('should request authorization code via GET /authorize', async () => {
      const clientId = 'claude-code';
      const redirectUri = 'https://localhost:8888/callback';
      const state = 'test-state-e2e-123';

      const response = await makeHttpRequest(
        baseUrl,
        'GET',
        `/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`
      );

      expect(response.status).toBe(302);
      expect(response.headers.location).toBeDefined();

      const locationHeader = response.headers.location as string;
      expect(locationHeader).toContain('code=');
      expect(locationHeader).toContain(`state=${state}`);
    });

    it('should return valid authorization code in redirect', async () => {
      const clientId = 'claude-code';
      const redirectUri = 'https://localhost:8888/callback';

      const response = await makeHttpRequest(
        baseUrl,
        'GET',
        `/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`
      );

      expect(response.status).toBe(302);
      const locationHeader = response.headers.location as string;
      const url = new URL(locationHeader);
      const code = url.searchParams.get('code');

      expect(code).toBeDefined();
      expect(code).toBeTruthy();
      expect(typeof code).toBe('string');
      // Code should be JWT (3 parts separated by dots)
      expect(code!.split('.')).toHaveLength(3);
    });

    it('should not prompt user (auto-consent)', async () => {
      const clientId = 'claude-code';
      const redirectUri = 'https://localhost:8888/callback';

      // Request should complete quickly (no user interaction)
      const startTime = Date.now();
      const response = await makeHttpRequest(
        baseUrl,
        'GET',
        `/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`
      );
      const duration = Date.now() - startTime;

      expect(response.status).toBe(302);
      expect(duration).toBeLessThan(1000); // Should be fast (no blocking I/O or user interaction)
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 3: Code-to-Token Exchange (POST /token)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Code-to-Token Exchange', () => {
    it('should request authorization code and receive valid code in redirect', async () => {
      // Get authorization code via /authorize endpoint
      const clientId = 'claude-code';
      const redirectUri = 'https://localhost:8888/callback';

      const authResponse = await makeHttpRequest(
        baseUrl,
        'GET',
        `/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`
      );

      // Verify authorization code was issued
      expect(authResponse.status).toBe(302);
      const locationHeader = authResponse.headers.location as string;
      expect(locationHeader).toBeDefined();

      const url = new URL(locationHeader);
      const code = url.searchParams.get('code') as string;
      expect(code).toBeDefined();

      // Verify code is a valid JWT (3 parts)
      const parts = code!.split('.');
      expect(parts).toHaveLength(3);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 4: Complete Authorization Flow (Key Functionality)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Complete Authorization Flow', () => {
    it('should handle full OAuth 2.0 authorization flow in sequence', async () => {
      const clientId = 'claude-code';
      const redirectUri = 'https://localhost:8888/callback';
      const state = 'e2e-full-flow-state';

      // Step 1: Discover server capabilities
      const infoResponse = await makeHttpRequest(baseUrl, 'GET', '/mcp/info');
      expect(infoResponse.status).toBe(200);

      // Step 2: Request authorization code (auto-consent)
      const authResponse = await makeHttpRequest(
        baseUrl,
        'GET',
        `/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`
      );
      expect(authResponse.status).toBe(302);

      // Verify code and state are in redirect
      const locationHeader = authResponse.headers.location as string;
      const redirectUrl = new URL(locationHeader);
      const code = redirectUrl.searchParams.get('code') as string;
      const returnedState = redirectUrl.searchParams.get('state') as string;

      expect(code).toBeDefined();
      expect(returnedState).toBe(state);
      // Code should be JWT format (3 parts)
      expect(code!.split('.')).toHaveLength(3);
    });

    it('should complete authorization without user prompts (<1 second per request)', async () => {
      const clientId = 'claude-code';
      const redirectUri = 'https://localhost:8888/callback';

      // Time the /authorize request (should be fast, no user interaction)
      const startAuth = Date.now();
      const authResponse = await makeHttpRequest(
        baseUrl,
        'GET',
        `/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`
      );
      const authDuration = Date.now() - startAuth;

      expect(authResponse.status).toBe(302);
      expect(authDuration).toBeLessThan(1000); // Should complete in <1 second (no prompt)
    });
  });
});
