import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateToken, generateRefreshToken, verifyToken } from '../../src/mcp/auth.js';
import { createTokenHandler } from '../../src/mcp/server.js';
import type { Request, Response, NextFunction } from 'express';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// Mock the logger to suppress output during tests
vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    detail: vi.fn(),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Encode Basic Auth header
// ─────────────────────────────────────────────────────────────────────────────

function encodeBasicAuth(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock Express objects
// ─────────────────────────────────────────────────────────────────────────────

function makeMockRes(): Response {
  const calls: { status?: number; json?: Record<string, unknown> } = {};
  const res = {
    status: vi.fn(function (code: number) {
      calls.status = code;
      return this;
    }),
    json: vi.fn(function (body: Record<string, unknown>) {
      calls.json = body;
      return this;
    }),
  };
  // Store calls on the res object for easy access in tests
  (res as unknown as Record<string, unknown>)['_calls'] = calls;
  return res as unknown as Response;
}

function makeMockReq(authHeader?: string): Request {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  } as unknown as Request;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock config
// ─────────────────────────────────────────────────────────────────────────────

function makeMockConfig(overrides?: Partial<FlashQueryConfig>): FlashQueryConfig {
  return {
    instance: { id: 'test-instance', name: 'Test', vault: { path: '/vault', markdownExtensions: ['.md'] } },
    server: { host: 'localhost', port: 3100 },
    supabase: { url: 'http://localhost:54321', serviceRoleKey: 'test-key', databaseUrl: 'postgres://localhost:54322', skipDdl: false },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'streamable-http', authSecret: 'test-secret', tokenLifetime: 24 },
    locking: { enabled: true, ttlSeconds: 30 },
    embedding: { provider: 'openai', model: 'text-embedding-3-small', dimensions: 1536 },
    logging: { level: 'info', output: 'stdout' },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite: Token Endpoint Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Token Endpoint Tests', () => {
  let config: FlashQueryConfig;
  let handler: (req: Request, res: Response, next: NextFunction) => void;

  beforeEach(() => {
    config = makeMockConfig();
    handler = createTokenHandler(config);
  });

  // ─ Test 1: Valid HTTP Basic Auth returns 200 + access_token
  it('POST /token with valid HTTP Basic Auth returns 200 + access_token', () => {
    const req = makeMockReq(encodeBasicAuth('client', 'test-secret'));
    const res = makeMockRes();
    const next = vi.fn();

    handler(req, res, next);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    // Note: no explicit status(200) call, but json() defaults to 200 in Express
    expect(calls.json).toBeDefined();
    const tokenResponse = calls.json as Record<string, unknown>;
    expect(tokenResponse['access_token']).toBeDefined();
    expect(typeof tokenResponse['access_token']).toBe('string');
    const parts = (tokenResponse['access_token'] as string).split('.');
    expect(parts).toHaveLength(3); // Valid JWT: header.payload.signature
  });

  // ─ Test 2: Response includes refresh_token
  it('POST /token response includes refresh_token', () => {
    const req = makeMockReq(encodeBasicAuth('client', 'test-secret'));
    const res = makeMockRes();
    const next = vi.fn();

    handler(req, res, next);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    const tokenResponse = calls.json as Record<string, unknown>;
    expect(tokenResponse['refresh_token']).toBeDefined();
    expect(typeof tokenResponse['refresh_token']).toBe('string');
    const parts = (tokenResponse['refresh_token'] as string).split('.');
    expect(parts).toHaveLength(3); // Valid JWT
  });

  // ─ Test 3: Response includes token_type: "Bearer"
  it('POST /token response includes token_type: "Bearer"', () => {
    const req = makeMockReq(encodeBasicAuth('client', 'test-secret'));
    const res = makeMockRes();
    const next = vi.fn();

    handler(req, res, next);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    const tokenResponse = calls.json as Record<string, unknown>;
    expect(tokenResponse['token_type']).toBe('Bearer');
  });

  // ─ Test 4: Response includes expires_in (in seconds, matches tokenLifetime × 3600)
  it('POST /token response includes expires_in (in seconds, matches tokenLifetime × 3600)', () => {
    config = makeMockConfig({ mcp: { ...config.mcp, tokenLifetime: 24 } });
    handler = createTokenHandler(config);
    const req = makeMockReq(encodeBasicAuth('client', 'test-secret'));
    const res = makeMockRes();
    const next = vi.fn();

    handler(req, res, next);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    const tokenResponse = calls.json as Record<string, unknown>;
    expect(tokenResponse['expires_in']).toBe(24 * 3600); // 24 hours in seconds
  });

  // ─ Test 5: Response includes scope: ""
  it('POST /token response includes scope: ""', () => {
    const req = makeMockReq(encodeBasicAuth('client', 'test-secret'));
    const res = makeMockRes();
    const next = vi.fn();

    handler(req, res, next);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    const tokenResponse = calls.json as Record<string, unknown>;
    expect(tokenResponse['scope']).toBe('');
  });

  // ─ Test 6: Invalid credentials return 401
  it('POST /token with invalid credentials returns 401', () => {
    const req = makeMockReq(encodeBasicAuth('client', 'wrong-secret'));
    const res = makeMockRes();
    const next = vi.fn();

    handler(req, res, next);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    expect(calls.status).toBe(401);
    const errorResponse = calls.json as Record<string, unknown>;
    expect(errorResponse['error']).toBe('invalid_client');
    expect(errorResponse['error_description']).toBeDefined();
  });

  // ─ Test 7: Missing Authorization header returns 401
  it('POST /token with missing Authorization header returns 401', () => {
    const req = makeMockReq(); // No auth header
    const res = makeMockRes();
    const next = vi.fn();

    handler(req, res, next);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    expect(calls.status).toBe(401);
    const errorResponse = calls.json as Record<string, unknown>;
    expect(errorResponse['error']).toBe('invalid_client');
  });

  // ─ Test 8: Invalid base64 Basic Auth returns 401
  it('POST /token with invalid base64 Basic Auth returns 401', () => {
    const req = makeMockReq('Basic !!!invalid-base64!!!');
    const res = makeMockRes();
    const next = vi.fn();

    handler(req, res, next);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    expect(calls.status).toBe(401);
    const errorResponse = calls.json as Record<string, unknown>;
    expect(errorResponse['error']).toBe('invalid_client');
  });

  // ─ Test 9: Issued access token validates successfully with verifyToken()
  it('Issued access token validates successfully with verifyToken()', () => {
    const req = makeMockReq(encodeBasicAuth('client', 'test-secret'));
    const res = makeMockRes();
    const next = vi.fn();

    handler(req, res, next);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    const tokenResponse = calls.json as Record<string, unknown>;
    const accessToken = tokenResponse['access_token'] as string;

    const result = verifyToken(accessToken, config.mcp.authSecret!);
    expect(result.valid).toBe(true);
    expect(result.payload?.instance_id).toBe(config.instance.id);
  });

  // ─ Test 10: Issued refresh token validates successfully with verifyToken()
  it('Issued refresh token validates successfully with verifyToken()', () => {
    const req = makeMockReq(encodeBasicAuth('client', 'test-secret'));
    const res = makeMockRes();
    const next = vi.fn();

    handler(req, res, next);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    const tokenResponse = calls.json as Record<string, unknown>;
    const refreshToken = tokenResponse['refresh_token'] as string;

    const result = verifyToken(refreshToken, config.mcp.authSecret!);
    expect(result.valid).toBe(true);
    expect(result.payload?.instance_id).toBe(config.instance.id);
  });

  // ─ Test 11: generateRefreshToken produces valid JWT
  it('generateRefreshToken produces valid JWT', () => {
    const refreshToken = generateRefreshToken('test-instance', 'test-secret', 24);
    const parts = refreshToken.split('.');
    expect(parts).toHaveLength(3); // Valid JWT format

    const result = verifyToken(refreshToken, 'test-secret');
    expect(result.valid).toBe(true);
    expect(result.payload?.instance_id).toBe('test-instance');
  });

  // ─ Test 12: Token endpoint error response includes error and error_description fields
  it('Token endpoint error response includes error and error_description fields', () => {
    const req = makeMockReq(encodeBasicAuth('client', 'wrong-secret'));
    const res = makeMockRes();
    const next = vi.fn();

    handler(req, res, next);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    const errorResponse = calls.json as Record<string, unknown>;
    expect(errorResponse['error']).toBeDefined();
    expect(errorResponse['error_description']).toBeDefined();
    expect(typeof errorResponse['error']).toBe('string');
    expect(typeof errorResponse['error_description']).toBe('string');
  });
});
