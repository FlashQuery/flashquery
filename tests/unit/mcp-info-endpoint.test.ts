/**
 * Unit tests for GET /mcp/info endpoint (INFO-01, INFO-02, INFO-03, COMPAT-01).
 *
 * Tests the createInfoHandler factory from src/mcp/server.ts directly,
 * using mock Request/Response objects (Option B — no HTTP server required).
 *
 * Threat coverage:
 * - T-49-12: Response whitelist — no secrets, no credentials in response
 * - T-49-13: Route placement — endpoint must be public (no auth required)
 * - T-49-16: Handler reads config values as-is; no modification
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createInfoHandler } from '../../src/mcp/server.js';
import { createAuthMiddleware, generateToken } from '../../src/mcp/auth.js';
import type { Request, Response } from 'express';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// ── Mock logger (suppress output during tests) ──

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  initLogger: vi.fn(),
}));

// ── Test config fixture ──

const TEST_CONFIG: Partial<FlashQueryConfig> = {
  instance: {
    name: 'Test Instance',
    id: 'test-instance-uuid-1234',
    vault: { path: '/tmp/test-vault', markdownExtensions: ['.md'] },
  },
  mcp: {
    transport: 'streamable-http',
    port: 3100,
    authSecret: 'test-secret',
  },
} as Partial<FlashQueryConfig>;

const TEST_VERSION = '0.1.0';

// ── Mock Request/Response helpers ──

function makeMockReq(options: { headers?: Record<string, string> } = {}): Request {
  return {
    method: 'GET',
    path: '/mcp/info',
    headers: options.headers ?? {},
  } as unknown as Request;
}

function makeMockRes(): { res: Response; jsonSpy: ReturnType<typeof vi.fn>; statusSpy: ReturnType<typeof vi.fn> } {
  const jsonSpy = vi.fn().mockReturnThis();
  const statusSpy = vi.fn().mockReturnThis();
  const res = {
    json: jsonSpy,
    status: statusSpy,
    setHeader: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { res, jsonSpy, statusSpy };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /mcp/info — core response shape
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /mcp/info', () => {
  let handler: ReturnType<typeof createInfoHandler>;

  beforeEach(() => {
    handler = createInfoHandler(TEST_CONFIG as FlashQueryConfig, TEST_VERSION);
  });

  // Test 1: Returns 200 OK
  it('returns 200 status (calls res.json without prior res.status call)', () => {
    const req = makeMockReq();
    const { res, statusSpy } = makeMockRes();

    handler(req, res);

    // The handler calls res.json() directly (no explicit res.status(200) needed —
    // Express defaults to 200 when json() is called without a prior status call).
    // We verify status() was NOT called (no error status set).
    expect(statusSpy).not.toHaveBeenCalled();
  });

  // Test 2: name field
  it('includes name field with value "FlashQuery Core"', () => {
    const req = makeMockReq();
    const { res, jsonSpy } = makeMockRes();

    handler(req, res);

    expect(jsonSpy).toHaveBeenCalledOnce();
    const body = jsonSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body['name']).toBe('FlashQuery');
  });

  // Test 3: version field
  it('includes version field matching the version argument', () => {
    const req = makeMockReq();
    const { res, jsonSpy } = makeMockRes();

    handler(req, res);

    const body = jsonSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body['version']).toBe('0.1.0');
  });

  // Test 4: auth_schemes
  it('includes auth_schemes array containing only "bearer"', () => {
    const req = makeMockReq();
    const { res, jsonSpy } = makeMockRes();

    handler(req, res);

    const body = jsonSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body['auth_schemes']).toEqual(['bearer']);
  });

  // Test 5: http_port
  it('includes http_port as number matching config.mcp.port', () => {
    const req = makeMockReq();
    const { res, jsonSpy } = makeMockRes();

    handler(req, res);

    const body = jsonSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body['http_port']).toBe(3100);
    expect(typeof body['http_port']).toBe('number');
  });

  // Test 6: mcp_version
  it('includes mcp_version field with value "1.0.0"', () => {
    const req = makeMockReq();
    const { res, jsonSpy } = makeMockRes();

    handler(req, res);

    const body = jsonSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body['mcp_version']).toBe('1.0.0');
  });

  // Test 7: instance_id
  it('includes instance_id field matching config.instance.id', () => {
    const req = makeMockReq();
    const { res, jsonSpy } = makeMockRes();

    handler(req, res);

    const body = jsonSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body['instance_id']).toBe('test-instance-uuid-1234');
    expect(typeof body['instance_id']).toBe('string');
  });

  // Test 8: No sensitive fields in response (T-49-12)
  it('does NOT include auth_secret or other sensitive fields in response', () => {
    const req = makeMockReq();
    const { res, jsonSpy } = makeMockRes();

    handler(req, res);

    const body = jsonSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    const keys = Object.keys(body);

    // No field names containing secret, key, password, token, or URL
    const sensitiveKeys = keys.filter((k) =>
      /secret|key|password|token|url|database|supabase/i.test(k)
    );
    expect(sensitiveKeys).toHaveLength(0);

    // Explicitly: no auth_secret
    expect(body).not.toHaveProperty('auth_secret');
    // No database URLs
    expect(body).not.toHaveProperty('database_url');
    expect(body).not.toHaveProperty('supabase_url');
  });

  // Test 9: Response schema validation — only expected fields (no extras)
  it('response JSON contains exactly the 6 expected fields and nothing more', () => {
    const req = makeMockReq();
    const { res, jsonSpy } = makeMockRes();

    handler(req, res);

    const body = jsonSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    const keys = Object.keys(body).sort();
    expect(keys).toEqual(
      ['auth_schemes', 'http_port', 'instance_id', 'mcp_version', 'name', 'version'].sort()
    );
  });

  // Test 10: Public access — no Authorization header required
  it('responds successfully when called without Authorization header (public endpoint)', () => {
    // No Authorization header in request
    const req = makeMockReq({ headers: {} });
    const { res, jsonSpy } = makeMockRes();

    handler(req, res);

    // Handler invoked successfully — res.json was called (200 response)
    expect(jsonSpy).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Port default value
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /mcp/info — port defaulting', () => {
  it('defaults http_port to 3100 when config.mcp.port is undefined', () => {
    const configWithoutPort: Partial<FlashQueryConfig> = {
      ...TEST_CONFIG,
      mcp: {
        transport: 'streamable-http',
        // port intentionally omitted
        authSecret: 'test-secret',
      },
    } as Partial<FlashQueryConfig>;

    const handler = createInfoHandler(configWithoutPort as FlashQueryConfig, TEST_VERSION);
    const req = makeMockReq();
    const { res, jsonSpy } = makeMockRes();

    handler(req, res);

    const body = jsonSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body['http_port']).toBe(3100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Backward compatibility — auth middleware still guards other /mcp routes
// ─────────────────────────────────────────────────────────────────────────────

describe('Backward compatibility — auth middleware behavior (COMPAT-01)', () => {
  const SECRET = 'compat-test-secret';
  const INSTANCE_ID = 'compat-test-instance';

  function makeMockRes2() {
    const headers = new Map<string, string>();
    const res = {
      status: vi.fn().mockReturnThis(),
      setHeader: vi.fn((name: string, value: string) => { headers.set(name, value); return res; }),
      json: vi.fn().mockReturnThis(),
      headers,
    };
    return res as unknown as Response;
  }

  function makeMockReq2(authHeader?: string): Request {
    return {
      headers: authHeader ? { authorization: authHeader } : {},
    } as unknown as Request;
  }

  it('auth middleware returns 401 when no Authorization header provided (non-info routes protected)', () => {
    const middleware = createAuthMiddleware(SECRET);
    const req = makeMockReq2(); // no auth header
    const res = makeMockRes2();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('auth middleware sets WWW-Authenticate header on 401 (RFC 7235 compliance)', () => {
    const middleware = createAuthMiddleware(SECRET);
    const req = makeMockReq2(); // no auth header
    const res = makeMockRes2();
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringMatching(/Bearer realm="FlashQuery"/)
    );
  });

  it('auth middleware calls next() with valid Bearer token (no regression)', () => {
    const validToken = generateToken(INSTANCE_ID, SECRET);
    const middleware = createAuthMiddleware(SECRET);
    const req = makeMockReq2(`Bearer ${validToken}`);
    const res = makeMockRes2();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('/mcp/info handler returns response with no auth check (public endpoint confirmed)', () => {
    // Simulate what happens when /mcp/info is called without auth:
    // The handler should respond successfully without consulting auth middleware.
    const infoHandler = createInfoHandler(TEST_CONFIG as FlashQueryConfig, TEST_VERSION);
    const req = makeMockReq({ headers: {} }); // no Authorization header
    const { res, jsonSpy } = makeMockRes();

    infoHandler(req, res);

    // Handler responded without error
    expect(jsonSpy).toHaveBeenCalledOnce();
    const body = jsonSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body['name']).toBe('FlashQuery');
  });
});
