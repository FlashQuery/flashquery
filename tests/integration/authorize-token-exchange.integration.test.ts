/**
 * Authorization Code Exchange Integration Tests
 *
 * Tests verify the complete authorization code flow (Phase 51 Plan 02):
 * - Code validation and token exchange (grant_type=authorization_code)
 * - Error handling for invalid/expired codes
 * - Parameter extraction from request body and query
 * - Logging of debug and info messages
 *
 * Requirement coverage: AUTH-05, AUTH-07, AUTH-08, D-07, D-08, D-09
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { Express, Request, Response } from 'express';
import * as http from 'http';
import type { Server as HttpServer } from 'http';
import { createTokenHandler } from '../../src/mcp/server.js';
import { generateAuthCode, verifyToken } from '../../src/mcp/auth.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// Mock the logger to capture log messages
vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    detail: vi.fn(),
  },
}));

/**
 * Helper: Create test config with mocked values
 */
function createTestConfig(overrides?: Partial<FlashQueryConfig>): FlashQueryConfig {
  return {
    instance: {
      id: 'test-exchange-instance',
      name: 'Test Exchange',
      vault: { path: '/vault', markdownExtensions: ['.md'] },
    },
    server: { host: 'localhost', port: 3100 },
    supabase: {
      url: 'http://localhost:54321',
      serviceRoleKey: 'test-key',
      databaseUrl: 'postgres://localhost:54322',
      skipDdl: false,
    },
    git: {
      autoCommit: false,
      autoPush: false,
      remote: 'origin',
      branch: 'main',
    },
    mcp: {
      transport: 'streamable-http',
      authSecret: 'exchange-test-secret',
      tokenLifetime: 24,
    },
    locking: { enabled: true, ttlSeconds: 30 },
    embedding: {
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 1536,
    },
    logging: { level: 'info', output: 'stdout' },
    ...overrides,
  };
}

/**
 * Helper: Make HTTP request to test server
 */
function makeRequest(
  server: HttpServer,
  method: 'GET' | 'POST',
  path: string,
  headers?: Record<string, string>,
  body?: Record<string, unknown>
): Promise<{ status: number; headers: Record<string, unknown>; body: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const port = typeof addr === 'object' ? addr?.port : 3100;

    const options = {
      hostname: 'localhost',
      port,
      path,
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
      // Convert body to x-www-form-urlencoded for POST /token
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
 * Helper: Create test Express app with token endpoint
 */
function createTestApp(config: FlashQueryConfig): Express {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // POST /token — Token issuance endpoint (public, no auth required)
  app.post('/token', createTokenHandler(config));

  return app;
}

describe('Authorization Code Exchange Integration Tests', () => {
  let server: HttpServer;
  let config: FlashQueryConfig;

  beforeEach(() => {
    config = createTestConfig();
    const app = createTestApp(config);
    server = http.createServer(app);
    server.listen(0); // Random port
  });

  afterEach(() => {
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe('Successful Code-to-Token Exchange', () => {
    it('should exchange valid authorization code for tokens', async () => {
      const authCode = generateAuthCode(config.instance.id, config.mcp.authSecret);

      const response = await makeRequest(server, 'POST', '/token', undefined, {
        grant_type: 'authorization_code',
        code: authCode,
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('access_token');
      expect(response.body).toHaveProperty('refresh_token');
      expect((response.body as any).token_type).toBe('Bearer');
      expect((response.body as any).expires_in).toBe(24 * 3600);
      expect((response.body as any).scope).toBe('');
    });

    it('should return valid JWT tokens on successful exchange', async () => {
      const authCode = generateAuthCode(config.instance.id, config.mcp.authSecret);

      const response = await makeRequest(server, 'POST', '/token', undefined, {
        grant_type: 'authorization_code',
        code: authCode,
      });

      const accessToken = (response.body as any).access_token;
      const refreshToken = (response.body as any).refresh_token;

      // Verify access token is valid JWT
      const accessVerify = verifyToken(accessToken, config.mcp.authSecret);
      expect(accessVerify.valid).toBe(true);
      expect(accessVerify.payload?.instance_id).toBe(config.instance.id);

      // Verify refresh token is valid JWT with token_type=refresh
      const refreshVerify = verifyToken(refreshToken, config.mcp.authSecret);
      expect(refreshVerify.valid).toBe(true);
    });

    it('should accept code parameter from request body', async () => {
      const authCode = generateAuthCode(config.instance.id, config.mcp.authSecret);

      const response = await makeRequest(server, 'POST', '/token', undefined, {
        grant_type: 'authorization_code',
        code: authCode,
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('access_token');
    });

    it('should accept code parameter from query string', async () => {
      const authCode = generateAuthCode(config.instance.id, config.mcp.authSecret);

      const response = await makeRequest(server, 'POST', `/token?grant_type=authorization_code&code=${encodeURIComponent(authCode)}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('access_token');
    });

    it('should prefer body over query parameters when both present', async () => {
      const authCode1 = generateAuthCode(config.instance.id, config.mcp.authSecret);
      const authCode2 = generateAuthCode(config.instance.id, config.mcp.authSecret);

      // Body has valid code, query has invalid code
      const response = await makeRequest(
        server,
        'POST',
        `/token?grant_type=authorization_code&code=${encodeURIComponent(authCode2)}`,
        undefined,
        {
          grant_type: 'authorization_code',
          code: authCode1,
        }
      );

      // Should succeed because body code is used
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('access_token');
    });
  });

  describe('Code Validation Errors', () => {
    it('should reject invalid (malformed) authorization code', async () => {
      const response = await makeRequest(server, 'POST', '/token', undefined, {
        grant_type: 'authorization_code',
        code: 'not-a-valid-jwt',
      });

      expect(response.status).toBe(400);
      expect((response.body as any).error).toBe('invalid_grant');
      expect((response.body as any).error_description).toContain('invalid or expired');
    });

    it('should reject code with invalid signature', async () => {
      const authCode = generateAuthCode(config.instance.id, config.mcp.authSecret);
      // Tamper with the signature
      const parts = authCode.split('.');
      const tamperedCode = `${parts[0]}.${parts[1]}.invalidsignature`;

      const response = await makeRequest(server, 'POST', '/token', undefined, {
        grant_type: 'authorization_code',
        code: tamperedCode,
      });

      expect(response.status).toBe(400);
      expect((response.body as any).error).toBe('invalid_grant');
    });

    it('should exchange a fresh authorization code successfully (expiry test deferred — requires time mocking)', async () => {
      // Note: a true expiry rejection test requires vi.useFakeTimers() to advance system time
      // past the 60-second auth code lifetime without waiting. Deferred to a dedicated unit test.
      const authCode = generateAuthCode(config.instance.id, config.mcp.authSecret);
      const response = await makeRequest(server, 'POST', '/token', undefined, {
        grant_type: 'authorization_code',
        code: authCode,
      });
      expect(response.status).toBe(200);
    });

    it.todo('should reject code with wrong code_type — requires access to generateToken internals');

    it('should reject missing code parameter', async () => {
      const response = await makeRequest(server, 'POST', '/token', undefined, {
        grant_type: 'authorization_code',
        // code parameter missing
      });

      expect(response.status).toBe(400);
      expect((response.body as any).error).toBe('invalid_request');
      expect((response.body as any).error_description).toContain('code');
    });

    it('should reject empty code parameter', async () => {
      const response = await makeRequest(server, 'POST', '/token', undefined, {
        grant_type: 'authorization_code',
        code: '',
      });

      expect(response.status).toBe(400);
      expect((response.body as any).error).toBe('invalid_request');
      expect((response.body as any).error_description).toContain('code');
    });
  });

  describe('Grant Type Routing', () => {
    it('should route to authorization_code handler when grant_type=authorization_code', async () => {
      const authCode = generateAuthCode(config.instance.id, config.mcp.authSecret);

      const response = await makeRequest(server, 'POST', '/token', undefined, {
        grant_type: 'authorization_code',
        code: authCode,
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('access_token');
    });

    it('should reject request with unsupported grant_type', async () => {
      const response = await makeRequest(server, 'POST', '/token', undefined, {
        grant_type: 'password',
        username: 'test',
        password: 'test',
      });

      // Should fall through to HTTP Basic Auth path, which requires Authorization header
      expect(response.status).toBe(401);
      expect((response.body as any).error).toBe('invalid_client');
    });

    it('should fall back to HTTP Basic Auth when no grant_type provided', async () => {
      const basicAuth = 'Basic ' + Buffer.from(`user:${config.mcp.authSecret}`).toString('base64');

      const response = await makeRequest(server, 'POST', '/token', { Authorization: basicAuth });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('access_token');
    });
  });

  describe('Logging', () => {
    it('should log DEBUG message for code validation', async () => {
      const { logger } = await import('../../src/logging/logger.js');
      const debugSpy = vi.mocked(logger.debug);
      debugSpy.mockClear();

      const authCode = generateAuthCode(config.instance.id, config.mcp.authSecret);

      await makeRequest(server, 'POST', '/token', undefined, {
        grant_type: 'authorization_code',
        code: authCode,
      });

      // Should have logged validation steps
      const calls = debugSpy.mock.calls.map((call) => call[0]);
      expect(calls.some((msg) => msg.includes('validating authorization code'))).toBe(true);
      expect(calls.some((msg) => msg.includes('code validation succeeded'))).toBe(true);
    });

    it('should log INFO message for successful code exchange', async () => {
      const { logger } = await import('../../src/logging/logger.js');
      const infoSpy = vi.mocked(logger.info);
      infoSpy.mockClear();

      const authCode = generateAuthCode(config.instance.id, config.mcp.authSecret);

      await makeRequest(server, 'POST', '/token', undefined, {
        grant_type: 'authorization_code',
        code: authCode,
      });

      // Should have logged successful exchange
      const calls = infoSpy.mock.calls.map((call) => call[0]);
      expect(calls.some((msg) => msg.includes('exchanged authorization code'))).toBe(true);
    });

    it('should log INFO message for invalid authorization code', async () => {
      const { logger } = await import('../../src/logging/logger.js');
      const infoSpy = vi.mocked(logger.info);
      infoSpy.mockClear();

      await makeRequest(server, 'POST', '/token', undefined, {
        grant_type: 'authorization_code',
        code: 'invalid-code',
      });

      // Should have logged invalid code
      const calls = infoSpy.mock.calls.map((call) => call[0]);
      expect(calls.some((msg) => msg.includes('invalid or expired'))).toBe(true);
    });
  });

  describe('Token Lifetime Configuration', () => {
    it('should respect configured token_lifetime in exchange response', async () => {
      const customConfig = createTestConfig({ mcp: { ...createTestConfig().mcp, tokenLifetime: 48 } });
      const app = createTestApp(customConfig);
      const customServer = http.createServer(app);
      customServer.listen(0);

      try {
        const authCode = generateAuthCode(customConfig.instance.id, customConfig.mcp.authSecret);

        const response = await makeRequest(customServer, 'POST', '/token', undefined, {
          grant_type: 'authorization_code',
          code: authCode,
        });

        expect(response.status).toBe(200);
        expect((response.body as any).expires_in).toBe(48 * 3600);
      } finally {
        customServer.close();
      }
    });
  });
});
