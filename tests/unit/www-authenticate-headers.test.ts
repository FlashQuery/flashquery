import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateToken, createAuthMiddleware } from '../../src/mcp/auth.js';
import type { Request, Response, NextFunction } from 'express';

// Mock the logger to suppress output during tests
vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Test helper ──

function parseWwwAuthenticateHeader(headerValue: string) {
  const match = headerValue.match(
    /Bearer realm="([^"]+)", error="([^"]+)", error_description="([^"]+)"/
  );
  return match ? { realm: match[1], error: match[2], description: match[3] } : null;
}

// ── Mock factories ──

function makeMockRes() {
  const headers = new Map<string, string>();
  const res = {
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn((name: string, value: string) => {
      headers.set(name, value);
      return res;
    }),
    json: vi.fn().mockReturnThis(),
    headers,
  };
  return res as unknown as Response & { headers: Map<string, string> };
}

function makeMockReq(authHeader?: string): Request {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  } as unknown as Request;
}

// ─────────────────────────────────────────────────────────────────────────────
// WWW-Authenticate Header Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('WWW-Authenticate Header Tests', () => {
  const SECRET = 'test-header-secret';
  const INSTANCE_ID = 'test-header-instance';
  let validToken: string;
  let middleware: (req: Request, res: Response, next: NextFunction) => void;

  beforeEach(() => {
    validToken = generateToken(INSTANCE_ID, SECRET);
    middleware = createAuthMiddleware(SECRET);
  });

  it('Test 1: Missing Authorization header returns 401 with WWW-Authenticate error="invalid_request"', () => {
    const req = makeMockReq();
    const res = makeMockRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', expect.any(String));
    const headerValue = (res as unknown as { headers: Map<string, string> }).headers.get('WWW-Authenticate')!;
    const parsed = parseWwwAuthenticateHeader(headerValue);
    expect(parsed).not.toBeNull();
    expect(parsed!.error).toBe('invalid_request');
  });

  it('Test 2: Invalid Bearer scheme returns 401 with WWW-Authenticate error="invalid_request"', () => {
    const req = makeMockReq(`Token ${validToken}`);
    const res = makeMockRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', expect.any(String));
    const headerValue = (res as unknown as { headers: Map<string, string> }).headers.get('WWW-Authenticate')!;
    const parsed = parseWwwAuthenticateHeader(headerValue);
    expect(parsed).not.toBeNull();
    expect(parsed!.error).toBe('invalid_request');
  });

  it('Test 3: Invalid token returns 401 with WWW-Authenticate error="invalid_token"', () => {
    const badToken = generateToken(INSTANCE_ID, 'wrong-secret');
    const req = makeMockReq(`Bearer ${badToken}`);
    const res = makeMockRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', expect.any(String));
    const headerValue = (res as unknown as { headers: Map<string, string> }).headers.get('WWW-Authenticate')!;
    const parsed = parseWwwAuthenticateHeader(headerValue);
    expect(parsed).not.toBeNull();
    expect(parsed!.error).toBe('invalid_token');
  });

  it('Test 4: WWW-Authenticate header includes realm="FlashQuery Core"', () => {
    const req = makeMockReq();
    const res = makeMockRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    const headerValue = (res as unknown as { headers: Map<string, string> }).headers.get('WWW-Authenticate')!;
    const parsed = parseWwwAuthenticateHeader(headerValue);
    expect(parsed).not.toBeNull();
    expect(parsed!.realm).toBe('FlashQuery');
  });

  it('Test 5: WWW-Authenticate header includes error_description (max 50 chars, no special chars)', () => {
    // Test all three 401 paths for description constraints
    const cases: Array<{ req: Request; desc: string }> = [
      { req: makeMockReq(), desc: 'missing header path' },
      { req: makeMockReq('Basic dXNlcjpwYXNz'), desc: 'wrong scheme path' },
      { req: makeMockReq(`Bearer ${generateToken(INSTANCE_ID, 'bad-secret')}`), desc: 'invalid token path' },
    ];

    for (const { req } of cases) {
      const res = makeMockRes();
      const next = vi.fn() as NextFunction;
      middleware(req, res, next);

      const headerValue = (res as unknown as { headers: Map<string, string> }).headers.get('WWW-Authenticate')!;
      const parsed = parseWwwAuthenticateHeader(headerValue);
      expect(parsed).not.toBeNull();
      // description must be present and <= 50 chars
      expect(parsed!.description.length).toBeGreaterThan(0);
      expect(parsed!.description.length).toBeLessThanOrEqual(50);
      // no special chars (quotes, semicolons, angle brackets, etc.)
      expect(parsed!.description).toMatch(/^[\w\s-]+$/);
    }
  });

  it('Test 6: Header syntax matches RFC 7235 pattern: Bearer realm="...", error="...", error_description="..."', () => {
    const req = makeMockReq();
    const res = makeMockRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    const headerValue = (res as unknown as { headers: Map<string, string> }).headers.get('WWW-Authenticate')!;
    expect(headerValue).toMatch(/^Bearer realm="[^"]+", error="[^"]+", error_description="[^"]+"$/);
  });

  it('Test 7: Valid Bearer token does NOT include WWW-Authenticate header (only on 401)', () => {
    const req = makeMockReq(`Bearer ${validToken}`);
    const res = makeMockRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.setHeader).not.toHaveBeenCalledWith('WWW-Authenticate', expect.any(String));
    expect((res as unknown as { headers: Map<string, string> }).headers.has('WWW-Authenticate')).toBe(false);
  });

  it('Test 8: Multiple calls to same endpoint produce same WWW-Authenticate header value (no random params)', () => {
    const results: string[] = [];

    for (let i = 0; i < 3; i++) {
      const req = makeMockReq();
      const res = makeMockRes();
      const next = vi.fn() as NextFunction;
      middleware(req, res, next);
      const headerValue = (res as unknown as { headers: Map<string, string> }).headers.get('WWW-Authenticate')!;
      results.push(headerValue);
    }

    // All three invocations must produce identical header values
    expect(results[0]).toBe(results[1]);
    expect(results[1]).toBe(results[2]);
  });
});
