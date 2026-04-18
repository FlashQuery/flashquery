import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateToken, verifyToken, createAuthMiddleware } from '../../src/mcp/auth.js';
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

// ─────────────────────────────────────────────────────────────────────────────
// generateToken
// ─────────────────────────────────────────────────────────────────────────────

describe('generateToken', () => {
  it('returns a string with 3 dot-separated parts (header.payload.signature)', () => {
    const token = generateToken('test-instance', 'test-secret');
    expect(typeof token).toBe('string');
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    // Each part should be non-empty
    parts.forEach((part) => expect(part.length).toBeGreaterThan(0));
  });

  it('generates different tokens for different instance IDs (issued_at may match, but payload differs)', () => {
    const token1 = generateToken('instance-a', 'same-secret');
    const token2 = generateToken('instance-b', 'same-secret');
    // Payloads differ due to different instance_id values
    const payload1 = token1.split('.')[1];
    const payload2 = token2.split('.')[1];
    expect(payload1).not.toBe(payload2);
  });

  it('generates tokens that can be verified by verifyToken with the same secret', () => {
    const secret = 'my-secret-key';
    const token = generateToken('my-instance', secret);
    const result = verifyToken(token, secret);
    expect(result.valid).toBe(true);
    expect(result.payload?.instance_id).toBe('my-instance');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verifyToken
// ─────────────────────────────────────────────────────────────────────────────

describe('verifyToken', () => {
  const SECRET = 'verification-secret';
  const INSTANCE_ID = 'verify-test-instance';
  let validToken: string;

  beforeEach(() => {
    validToken = generateToken(INSTANCE_ID, SECRET);
  });

  it('returns { valid: true } with payload when token and secret are correct', () => {
    const result = verifyToken(validToken, SECRET);
    expect(result.valid).toBe(true);
    expect(result.payload).toBeDefined();
    expect(result.payload?.instance_id).toBe(INSTANCE_ID);
    expect(typeof result.payload?.issued_at).toBe('number');
    expect(result.payload?.version).toBe(1);
  });

  it('returns { valid: false } when secret is wrong', () => {
    const result = verifyToken(validToken, 'wrong-secret');
    expect(result.valid).toBe(false);
    expect(result.payload).toBeUndefined();
  });

  it('returns { valid: false } when token has fewer than 3 parts (malformed)', () => {
    expect(verifyToken('only.two', SECRET).valid).toBe(false);
    expect(verifyToken('just-one-part', SECRET).valid).toBe(false);
    expect(verifyToken('', SECRET).valid).toBe(false);
  });

  it('returns { valid: false } when token has too many parts', () => {
    const result = verifyToken('a.b.c.d', SECRET);
    expect(result.valid).toBe(false);
  });

  it('returns { valid: false } when payload is tampered', () => {
    const parts = validToken.split('.');
    // Modify the payload to a different base64url value
    const tamperedPayload = Buffer.from('{"instance_id":"hacked","issued_at":0,"version":1}').toString('base64url');
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    const result = verifyToken(tamperedToken, SECRET);
    expect(result.valid).toBe(false);
  });

  it('returns { valid: false } when signature is tampered', () => {
    const parts = validToken.split('.');
    const tamperedToken = `${parts[0]}.${parts[1]}.tampered-signature`;
    const result = verifyToken(tamperedToken, SECRET);
    expect(result.valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createAuthMiddleware
// ─────────────────────────────────────────────────────────────────────────────

describe('createAuthMiddleware', () => {
  const SECRET = 'middleware-secret';
  const INSTANCE_ID = 'middleware-test-instance';
  let validToken: string;
  let middleware: (req: Request, res: Response, next: NextFunction) => void;

  // Mock Express objects
  function makeMockRes() {
    const headers = new Map<string, string>();
    const res = {
      status: vi.fn().mockReturnThis(),
      setHeader: vi.fn((name: string, value: string) => { headers.set(name, value); return res; }),
      json: vi.fn().mockReturnThis(),
      headers,
    };
    return res as unknown as Response;
  }

  function makeMockReq(authHeader?: string): Request {
    return {
      headers: authHeader ? { authorization: authHeader } : {},
    } as unknown as Request;
  }

  beforeEach(() => {
    validToken = generateToken(INSTANCE_ID, SECRET);
    middleware = createAuthMiddleware(SECRET);
  });

  it('calls next() when a valid Bearer token is provided', () => {
    const req = makeMockReq(`Bearer ${validToken}`);
    const res = makeMockRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('does NOT include WWW-Authenticate header when valid Bearer token is provided', () => {
    const req = makeMockReq(`Bearer ${validToken}`);
    const res = makeMockRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.setHeader).not.toHaveBeenCalledWith('WWW-Authenticate', expect.any(String));
  });

  it('returns 401 when Authorization header is absent', () => {
    const req = makeMockReq();
    const res = makeMockRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(res.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringMatching(/Bearer realm="FlashQuery Core"/)
    );
  });

  it('returns 401 when Authorization header uses wrong scheme (e.g., Token)', () => {
    const req = makeMockReq(`Token ${validToken}`);
    const res = makeMockRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(res.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringMatching(/Bearer realm="FlashQuery Core"/)
    );
  });

  it('returns 401 when Authorization header uses Basic scheme', () => {
    const req = makeMockReq('Basic dXNlcjpwYXNz');
    const res = makeMockRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringMatching(/Bearer realm="FlashQuery Core"/)
    );
  });

  it('returns 401 when Bearer token is invalid (wrong secret)', () => {
    const badToken = generateToken(INSTANCE_ID, 'different-secret');
    const req = makeMockReq(`Bearer ${badToken}`);
    const res = makeMockRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(res.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringMatching(/Bearer realm="FlashQuery Core"/)
    );
  });

  it('returns 401 when Bearer token is a random garbage string', () => {
    const req = makeMockReq('Bearer not.a.valid.jwt.token');
    const res = makeMockRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringMatching(/Bearer realm="FlashQuery Core"/)
    );
  });

  it('returns 401 when Authorization header is "Bearer " with no token', () => {
    const req = makeMockReq('Bearer ');
    const res = makeMockRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringMatching(/Bearer realm="FlashQuery Core"/)
    );
  });
});
