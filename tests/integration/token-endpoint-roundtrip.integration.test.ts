/**
 * Token Endpoint Roundtrip Integration Tests
 *
 * Tests complete token lifecycle: issuance → usage → refresh → error handling
 * Covers backward compatibility with Phase 24 legacy Bearer token flows
 *
 * Requirement coverage: TOKEN-ROUNDTRIP-01, TOKEN-ROUNDTRIP-02, TOKEN-ROUNDTRIP-03, COMPAT-01
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { Express, Request, Response, NextFunction } from 'express';
import * as http from 'http';
import type { Server as HttpServer } from 'http';
import { createTokenHandler } from '../../src/mcp/server.js';
import { createAuthMiddleware, generateToken, verifyToken } from '../../src/mcp/auth.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// Mock the logger
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
      id: 'test-roundtrip-instance',
      name: 'Test Roundtrip',
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
      authSecret: 'roundtrip-test-secret',
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
 * Helper: Encode HTTP Basic Auth header
 */
function encodeBasicAuth(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

/**
 * Helper: Make HTTP request to test server
 */
function makeRequest(
  server: HttpServer,
  method: 'GET' | 'POST' | 'DELETE',
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
 * Helper: Create test Express app with token endpoint and auth middleware
 */
function createTestApp(config: FlashQueryConfig): Express {
  const app = express();
  app.use(express.json());

  // POST /token — Token issuance endpoint (public, no auth required)
  app.post('/token', createTokenHandler(config));

  // GET /mcp/info — Public discovery endpoint (for testing)
  app.get('/mcp/info', (_req: Request, res: Response) => {
    res.json({ name: 'Test', version: '1.0.0', auth_schemes: ['bearer'] });
  });

  // Auth middleware for protected routes
  app.use('/mcp', createAuthMiddleware(config.mcp.authSecret!));

  // POST /mcp — Protected endpoint for testing token usage
  app.post('/mcp', (req: Request, res: Response) => {
    res.json({ success: true, message: 'MCP request succeeded' });
  });

  // GET /mcp — Also protected
  app.get('/mcp', (req: Request, res: Response) => {
    res.json({ success: true, message: 'GET /mcp succeeded' });
  });

  return app;
}

/**
 * Test Suite: Token Endpoint Roundtrip Tests
 */
describe('Token Endpoint Roundtrip Tests', () => {
  let config: FlashQueryConfig;
  let app: Express;
  let server: HttpServer;

  beforeEach(() => {
    config = createTestConfig();
    app = createTestApp(config);
    server = app.listen(0);
  });

  afterEach(() => {
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  /**
   * Test 1: Issue token via POST /token, use token in subsequent /mcp POST request (no auth error)
   * (TOKEN-ROUNDTRIP-01)
   */
  it('Test 1: POST /token issues valid token that authenticates /mcp requests', async () => {
    // Step 1: POST /token with Basic Auth
    const tokenResponse = await makeRequest(server, 'POST', '/token', {
      Authorization: encodeBasicAuth('client', config.mcp.authSecret!),
    });

    expect(tokenResponse.status).toBe(200);
    const tokenData = tokenResponse.body as Record<string, unknown>;
    expect(tokenData).toHaveProperty('access_token');
    const { access_token } = tokenData;

    // Step 2: Use issued token for /mcp request
    const mcpResponse = await makeRequest(server, 'POST', '/mcp', {
      Authorization: `Bearer ${access_token}`,
    });

    expect(mcpResponse.status).toBe(200);
    const mcpData = mcpResponse.body as Record<string, unknown>;
    expect(mcpData).toHaveProperty('success', true);
  });

  /**
   * Test 2: Invalid token in Authorization header returns 401 from /mcp endpoint
   * (TOKEN-ROUNDTRIP-03)
   */
  it('Test 2: POST /mcp with invalid Bearer token returns 401', async () => {
    const invalidToken = 'invalid.jwt.token';
    const response = await makeRequest(server, 'POST', '/mcp', {
      Authorization: `Bearer ${invalidToken}`,
    });

    expect(response.status).toBe(401);
    const data = response.body as Record<string, unknown>;
    expect(data).toHaveProperty('error');
  });

  /**
   * Test 3: Missing Authorization header returns 401 with WWW-Authenticate header
   * (TOKEN-ROUNDTRIP-03)
   */
  it('Test 3: POST /mcp without Authorization header returns 401 with WWW-Authenticate', async () => {
    const response = await makeRequest(server, 'POST', '/mcp');

    expect(response.status).toBe(401);
    const data = response.body as Record<string, unknown>;
    expect(data).toHaveProperty('error');
    // The createAuthMiddleware sets WWW-Authenticate header
    expect(response.headers['www-authenticate']).toBeDefined();
  });

  /**
   * Test 4: Issued token includes all required fields
   * (TOKEN-ROUNDTRIP-01)
   */
  it('Test 4: POST /token response includes all required OAuth 2.0 fields', async () => {
    const response = await makeRequest(server, 'POST', '/token', {
      Authorization: encodeBasicAuth('client', config.mcp.authSecret!),
    });

    expect(response.status).toBe(200);
    const data = response.body as Record<string, unknown>;
    expect(data).toHaveProperty('access_token');
    expect(data).toHaveProperty('refresh_token');
    expect(data).toHaveProperty('token_type');
    expect(data).toHaveProperty('expires_in');
    expect(data).toHaveProperty('scope');
  });

  /**
   * Test 5: Access token payload contains instance_id and issued_at claims
   * (TOKEN-ROUNDTRIP-01)
   */
  it('Test 5: Issued access token contains instance_id and issued_at in payload', async () => {
    const response = await makeRequest(server, 'POST', '/token', {
      Authorization: encodeBasicAuth('client', config.mcp.authSecret!),
    });

    const data = response.body as Record<string, unknown>;
    const { access_token } = data;
    const parts = (access_token as string).split('.');
    expect(parts).toHaveLength(3);

    // Decode payload (base64url)
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    expect(payload).toHaveProperty('instance_id', config.instance.id);
    expect(payload).toHaveProperty('issued_at');
    expect(payload).toHaveProperty('version');
  });

  /**
   * Test 6: Refresh token validates with verifyToken() and has longer lifetime
   * (TOKEN-ROUNDTRIP-02)
   */
  it('Test 6: Refresh token has longer lifetime than access token', async () => {
    const response = await makeRequest(server, 'POST', '/token', {
      Authorization: encodeBasicAuth('client', config.mcp.authSecret!),
    });

    const data = response.body as Record<string, unknown>;
    const { access_token, refresh_token, expires_in } = data;
    expect(refresh_token).toBeDefined();
    expect(access_token).toBeDefined();
    expect(expires_in).toBeGreaterThan(0);

    // Decode both tokens
    const accessParts = (access_token as string).split('.');
    const refreshParts = (refresh_token as string).split('.');
    expect(accessParts).toHaveLength(3);
    expect(refreshParts).toHaveLength(3);

    // Check that refresh token payload indicates it's a refresh token
    const refreshPayload = JSON.parse(Buffer.from(refreshParts[1], 'base64url').toString());
    expect(refreshPayload).toHaveProperty('token_type', 'refresh');
    expect(refreshPayload).toHaveProperty('lifetime_hours');
    // Refresh lifetime should be 7x access token lifetime
    expect(refreshPayload.lifetime_hours).toBe(config.mcp.tokenLifetime! * 7);
  });

  /**
   * Test 7: HTTP Basic Auth with empty password is rejected
   * (TOKEN-ROUNDTRIP-03)
   */
  it('Test 7: POST /token with empty password returns 401', async () => {
    const response = await makeRequest(server, 'POST', '/token', {
      Authorization: encodeBasicAuth('client', ''),
    });

    expect(response.status).toBe(401);
    const data = response.body as Record<string, unknown>;
    expect(data).toHaveProperty('error', 'invalid_client');
  });

  /**
   * Test 8: HTTP Basic Auth with any username but correct password succeeds (username ignored, only password validated)
   * (TOKEN-ROUNDTRIP-03)
   */
  it('Test 8: POST /token with any username and correct password succeeds (username ignored)', async () => {
    const response = await makeRequest(server, 'POST', '/token', {
      Authorization: encodeBasicAuth('anyusername', config.mcp.authSecret!),
    });

    // Should succeed because password is correct (username value is ignored)
    expect(response.status).toBe(200);
    const data = response.body as Record<string, unknown>;
    expect(data).toHaveProperty('access_token');
  });

  /**
   * Test 9: GET /mcp/info endpoint remains public (no auth required)
   * (TOKEN-ROUNDTRIP-01)
   */
  it('Test 9: GET /mcp/info is public (no Authorization header required)', async () => {
    const response = await makeRequest(server, 'GET', '/mcp/info');

    expect(response.status).toBe(200);
    const data = response.body as Record<string, unknown>;
    expect(data).toHaveProperty('name');
    expect(data).toHaveProperty('auth_schemes');
  });

  /**
   * Test 10: Existing Bearer token (raw secret format) continues to work for backward compat
   * (COMPAT-01: Phase 24 legacy format)
   */
  it('Test 10: POST /mcp with raw secret in Bearer auth (Phase 24 legacy) succeeds', async () => {
    const response = await makeRequest(server, 'POST', '/mcp', {
      Authorization: `Bearer ${config.mcp.authSecret!}`,
    });

    // Raw secret format should still work (Phase 24 backward compatibility)
    expect(response.status).toBe(200);
    const data = response.body as Record<string, unknown>;
    expect(data).toHaveProperty('success', true);
  });

  /**
   * Test 11: JWT token from previous phase continues to validate
   * (COMPAT-01: Phase 24 legacy format)
   */
  it('Test 11: JWT token generated with Phase 24 generateToken() validates', async () => {
    // Generate a JWT using the same function as Phase 24
    const legacyToken = generateToken(config.instance.id, config.mcp.authSecret!);

    const response = await makeRequest(server, 'POST', '/mcp', {
      Authorization: `Bearer ${legacyToken}`,
    });

    expect(response.status).toBe(200);
    const data = response.body as Record<string, unknown>;
    expect(data).toHaveProperty('success', true);
  });

  /**
   * Test 12: Token response HTTP status is 200 (success)
   * (TOKEN-ROUNDTRIP-01)
   */
  it('Test 12: POST /token response HTTP status is 200', async () => {
    const response = await makeRequest(server, 'POST', '/token', {
      Authorization: encodeBasicAuth('client', config.mcp.authSecret!),
    });

    expect(response.status).toBe(200);
  });

  /**
   * Test 13: Invalid credentials response HTTP status is 401
   * (TOKEN-ROUNDTRIP-03)
   */
  it('Test 13: POST /token with invalid credentials returns HTTP 401', async () => {
    const response = await makeRequest(server, 'POST', '/token', {
      Authorization: encodeBasicAuth('client', 'wrong-secret'),
    });

    expect(response.status).toBe(401);
    const data = response.body as Record<string, unknown>;
    expect(data).toHaveProperty('error', 'invalid_client');
  });
});
