import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateAuthCode, validateAuthCode } from '../../src/mcp/auth.js';
import { createAuthorizeHandler } from '../../src/mcp/server.js';
import { createHmac } from 'node:crypto';
import type { Request, Response } from 'express';
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
// Mock Express objects
// ─────────────────────────────────────────────────────────────────────────────

function makeMockRes(): Response {
  const calls: {
    status?: number;
    json?: Record<string, unknown>;
    redirectCode?: number;
    redirectUrl?: string;
  } = {};
  const res = {
    status: vi.fn(function (code: number) {
      calls.status = code;
      return this;
    }),
    json: vi.fn(function (body: Record<string, unknown>) {
      calls.json = body;
      return this;
    }),
    redirect: vi.fn(function (code: number, url: string) {
      calls.redirectCode = code;
      calls.redirectUrl = url;
      return this;
    }),
  };
  // Store calls on the res object for easy access in tests
  (res as unknown as Record<string, unknown>)['_calls'] = calls;
  return res as unknown as Response;
}

function makeMockReq(queryParams: Record<string, unknown> = {}): Request {
  return {
    query: queryParams,
  } as unknown as Request;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock config
// ─────────────────────────────────────────────────────────────────────────────

function makeMockConfig(overrides?: Partial<FlashQueryConfig>): FlashQueryConfig {
  return {
    instance: { id: 'test-instance', name: 'Test', vault: { path: '/vault', markdownExtensions: ['.md'] } },
    server: { host: 'localhost', port: 3100 },
    supabase: {
      url: 'http://localhost:54321',
      serviceRoleKey: 'test-key',
      databaseUrl: 'postgres://localhost:54322',
      skipDdl: false,
    },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'streamable-http', authSecret: 'test-secret-12345', tokenLifetime: 24, port: 3100 },
    locking: { enabled: true, ttlSeconds: 30 },
    embedding: { provider: 'openai', model: 'text-embedding-3-small', dimensions: 1536 },
    logging: { level: 'info', output: 'stdout' },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite: Authorization Code Generation Tests (AUTH-01, AUTH-02)
// ─────────────────────────────────────────────────────────────────────────────

describe('generateAuthCode()', () => {
  it('returns a valid JWT string (3 parts separated by dots)', () => {
    const code = generateAuthCode('test-instance', 'test-secret');
    const parts = code.split('.');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBeDefined(); // header
    expect(parts[1]).toBeDefined(); // payload
    expect(parts[2]).toBeDefined(); // signature
  });

  it('payload contains code_id, issued_at, expires_at, instance_id, code_type, version', () => {
    const code = generateAuthCode('test-instance', 'test-secret');
    const parts = code.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

    expect(payload.code_id).toBeDefined();
    expect(typeof payload.code_id).toBe('string');
    expect(payload.issued_at).toBeDefined();
    expect(typeof payload.issued_at).toBe('number');
    expect(payload.expires_at).toBeDefined();
    expect(typeof payload.expires_at).toBe('number');
    expect(payload.instance_id).toBe('test-instance');
    expect(payload.code_type).toBe('authorization');
    expect(payload.version).toBe(1);
  });

  it('expires_at is exactly 60 seconds after issued_at (hardcoded lifetime)', () => {
    const code = generateAuthCode('test-instance', 'test-secret');
    const parts = code.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

    expect(payload.expires_at - payload.issued_at).toBe(60);
  });

  it('code_type field is always "authorization"', () => {
    const code = generateAuthCode('test-instance', 'test-secret');
    const parts = code.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

    expect(payload.code_type).toBe('authorization');
  });

  it('version field is always 1', () => {
    const code = generateAuthCode('test-instance', 'test-secret');
    const parts = code.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

    expect(payload.version).toBe(1);
  });

  it('different calls produce different code_ids', () => {
    const code1 = generateAuthCode('test-instance', 'test-secret');
    const code2 = generateAuthCode('test-instance', 'test-secret');

    const parts1 = code1.split('.');
    const parts2 = code2.split('.');
    const payload1 = JSON.parse(Buffer.from(parts1[1], 'base64url').toString());
    const payload2 = JSON.parse(Buffer.from(parts2[1], 'base64url').toString());

    expect(payload1.code_id).not.toBe(payload2.code_id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite: Authorization Code Validation Tests (AUTH-02, AUTH-03)
// ─────────────────────────────────────────────────────────────────────────────

describe('validateAuthCode()', () => {
  it('returns { valid: true } for valid authorization code', () => {
    const code = generateAuthCode('test-instance', 'test-secret');
    const result = validateAuthCode(code, 'test-secret');

    expect(result.valid).toBe(true);
    expect(result.payload).toBeDefined();
  });

  it('returns { valid: false } for invalid JWT (missing parts)', () => {
    const result = validateAuthCode('invalid.jwt', 'test-secret');
    expect(result.valid).toBe(false);
  });

  it('returns { valid: false } for invalid JWT (bad signature)', () => {
    const code = generateAuthCode('test-instance', 'test-secret');
    const parts = code.split('.');
    const tamperedCode = `${parts[0]}.${parts[1]}.invalidsignature`;

    const result = validateAuthCode(tamperedCode, 'test-secret');
    expect(result.valid).toBe(false);
  });

  it('returns { valid: false } for expired code', () => {
    // Manually create an expired authorization code
    const header = { alg: 'HS256', typ: 'JWT' };
    const issuedAt = Math.floor(Date.now() / 1000) - 120; // issued 2 minutes ago
    const payload = {
      code_id: '12345-67890',
      issued_at: issuedAt,
      expires_at: issuedAt + 60, // expired 1 minute ago
      instance_id: 'test-instance',
      code_type: 'authorization',
      version: 1,
    };

    const base64UrlEncode = (input: string): string =>
      Buffer.from(input).toString('base64url');

    const headerEncoded = base64UrlEncode(JSON.stringify(header));
    const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
    const message = `${headerEncoded}.${payloadEncoded}`;
    const signature = createHmac('sha256', 'test-secret').update(message).digest('base64url');
    const expiredCode = `${message}.${signature}`;

    const result = validateAuthCode(expiredCode, 'test-secret');
    expect(result.valid).toBe(false);
  });

  it('rejects code with code_type != "authorization"', () => {
    // Create a JWT with code_type = "token" instead of "authorization"
    const header = { alg: 'HS256', typ: 'JWT' };
    const issuedAt = Math.floor(Date.now() / 1000);
    const payload = {
      code_id: '12345-67890',
      issued_at: issuedAt,
      expires_at: issuedAt + 60,
      instance_id: 'test-instance',
      code_type: 'token', // Wrong type
      version: 1,
    };

    const base64UrlEncode = (input: string): string =>
      Buffer.from(input).toString('base64url');

    const headerEncoded = base64UrlEncode(JSON.stringify(header));
    const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
    const message = `${headerEncoded}.${payloadEncoded}`;
    const signature = createHmac('sha256', 'test-secret').update(message).digest('base64url');
    const wrongTypeCode = `${message}.${signature}`;

    const result = validateAuthCode(wrongTypeCode, 'test-secret');
    expect(result.valid).toBe(false);
  });

  it('payload includes code_id, issued_at, expires_at, instance_id, code_type', () => {
    const code = generateAuthCode('test-instance', 'test-secret');
    const result = validateAuthCode(code, 'test-secret');

    expect(result.valid).toBe(true);
    expect(result.payload).toBeDefined();
    expect(result.payload!.code_id).toBeDefined();
    expect(result.payload!.issued_at).toBeDefined();
    expect(result.payload!.expires_at).toBeDefined();
    expect(result.payload!.instance_id).toBe('test-instance');
    expect(result.payload!.code_type).toBe('authorization');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite: Parameter Validation Tests (AUTH-01, AUTH-06)
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /authorize Parameter Validation', () => {
  let config: FlashQueryConfig;
  let handler: (req: Request, res: Response) => void;

  beforeEach(() => {
    config = makeMockConfig();
    handler = createAuthorizeHandler(config);
  });

  it('accepts valid request with client_id, redirect_uri, response_type', () => {
    const req = makeMockReq({
      client_id: 'claude-code',
      redirect_uri: 'https://localhost:8888/callback',
      response_type: 'code',
    });
    const res = makeMockRes();

    handler(req, res);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    expect(calls.redirectCode).toBe(302);
    expect(calls.redirectUrl).toBeDefined();
  });

  it('missing client_id returns 400 error: invalid_request', () => {
    const req = makeMockReq({
      redirect_uri: 'https://localhost:8888/callback',
      response_type: 'code',
    });
    const res = makeMockRes();

    handler(req, res);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    expect(calls.status).toBe(400);
    const errorResponse = calls.json as Record<string, unknown>;
    expect(errorResponse['error']).toBe('invalid_request');
  });

  it('missing redirect_uri returns 400 error: invalid_request', () => {
    const req = makeMockReq({
      client_id: 'claude-code',
      response_type: 'code',
    });
    const res = makeMockRes();

    handler(req, res);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    expect(calls.status).toBe(400);
    const errorResponse = calls.json as Record<string, unknown>;
    expect(errorResponse['error']).toBe('invalid_request');
  });

  it('invalid redirect_uri (not a valid URL) returns 400 error: invalid_request', () => {
    const req = makeMockReq({
      client_id: 'claude-code',
      redirect_uri: 'not-a-url',
      response_type: 'code',
    });
    const res = makeMockRes();

    handler(req, res);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    expect(calls.status).toBe(400);
    const errorResponse = calls.json as Record<string, unknown>;
    expect(errorResponse['error']).toBe('invalid_request');
  });

  it('missing response_type returns 400 error', () => {
    const req = makeMockReq({
      client_id: 'claude-code',
      redirect_uri: 'https://localhost:8888/callback',
    });
    const res = makeMockRes();

    handler(req, res);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    expect(calls.status).toBe(400);
    const errorResponse = calls.json as Record<string, unknown>;
    expect(errorResponse['error']).toBeDefined();
    expect(['invalid_request', 'unsupported_response_type']).toContain(errorResponse['error']);
  });

  it('response_type != "code" returns 400 error: unsupported_response_type', () => {
    const req = makeMockReq({
      client_id: 'claude-code',
      redirect_uri: 'https://localhost:8888/callback',
      response_type: 'token',
    });
    const res = makeMockRes();

    handler(req, res);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    expect(calls.status).toBe(400);
    const errorResponse = calls.json as Record<string, unknown>;
    expect(errorResponse['error']).toBe('unsupported_response_type');
  });

  it('optional state parameter is passed through without validation', () => {
    const req = makeMockReq({
      client_id: 'claude-code',
      redirect_uri: 'https://localhost:8888/callback',
      response_type: 'code',
      state: 'csrf-token-12345',
    });
    const res = makeMockRes();

    handler(req, res);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    expect(calls.redirectUrl).toContain('state=csrf-token-12345');
  });

  it('optional scope parameter is accepted', () => {
    const req = makeMockReq({
      client_id: 'claude-code',
      redirect_uri: 'https://localhost:8888/callback',
      response_type: 'code',
      scope: 'read write',
    });
    const res = makeMockRes();

    handler(req, res);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    expect(calls.redirectCode).toBe(302);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite: Handler Response Tests (AUTH-04)
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /authorize Handler Response', () => {
  let config: FlashQueryConfig;
  let handler: (req: Request, res: Response) => void;

  beforeEach(() => {
    config = makeMockConfig();
    handler = createAuthorizeHandler(config);
  });

  it('valid request returns 302 Found status', () => {
    const req = makeMockReq({
      client_id: 'claude-code',
      redirect_uri: 'https://localhost:8888/callback',
      response_type: 'code',
    });
    const res = makeMockRes();

    handler(req, res);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    expect(calls.redirectCode).toBe(302);
  });

  it('response redirects to redirect_uri as base URL', () => {
    const redirectUri = 'https://localhost:8888/callback';
    const req = makeMockReq({
      client_id: 'claude-code',
      redirect_uri: redirectUri,
      response_type: 'code',
    });
    const res = makeMockRes();

    handler(req, res);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    expect(calls.redirectUrl).toContain(redirectUri);
  });

  it('response includes code in query parameters', () => {
    const req = makeMockReq({
      client_id: 'claude-code',
      redirect_uri: 'https://localhost:8888/callback',
      response_type: 'code',
    });
    const res = makeMockRes();

    handler(req, res);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    expect(calls.redirectUrl).toContain('code=');
  });

  it('response includes state in query parameters if provided', () => {
    const req = makeMockReq({
      client_id: 'claude-code',
      redirect_uri: 'https://localhost:8888/callback',
      response_type: 'code',
      state: 'xyz-123',
    });
    const res = makeMockRes();

    handler(req, res);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    expect(calls.redirectUrl).toContain('state=xyz-123');
  });

  it('response excludes state in query parameters if not provided', () => {
    const req = makeMockReq({
      client_id: 'claude-code',
      redirect_uri: 'https://localhost:8888/callback',
      response_type: 'code',
    });
    const res = makeMockRes();

    handler(req, res);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    expect(calls.redirectUrl).not.toContain('state=');
  });

  it('authorization code in Location header is different from JWT in subsequent requests', () => {
    const req1 = makeMockReq({
      client_id: 'claude-code',
      redirect_uri: 'https://localhost:8888/callback',
      response_type: 'code',
    });
    const res1 = makeMockRes();
    handler(req1, res1);

    const calls1 = (res1 as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    const url1 = new URL(calls1.redirectUrl as string);
    const code1 = url1.searchParams.get('code');

    // Generate second code from a new request
    const req2 = makeMockReq({
      client_id: 'claude-code',
      redirect_uri: 'https://localhost:8888/callback',
      response_type: 'code',
    });
    const res2 = makeMockRes();
    handler(req2, res2);

    const calls2 = (res2 as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    const url2 = new URL(calls2.redirectUrl as string);
    const code2 = url2.searchParams.get('code');

    expect(code1).not.toBe(code2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite: Error Response Format Tests (AUTH-06)
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /authorize Error Response Format', () => {
  let config: FlashQueryConfig;
  let handler: (req: Request, res: Response) => void;

  beforeEach(() => {
    config = makeMockConfig();
    handler = createAuthorizeHandler(config);
  });

  it('error responses include { error: "...", error_description: "..." }', () => {
    const req = makeMockReq({
      client_id: 'claude-code',
      redirect_uri: 'not-a-url',
      response_type: 'code',
    });
    const res = makeMockRes();

    handler(req, res);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    const errorResponse = calls.json as Record<string, unknown>;
    expect(errorResponse['error']).toBeDefined();
    expect(errorResponse['error_description']).toBeDefined();
    expect(typeof errorResponse['error']).toBe('string');
    expect(typeof errorResponse['error_description']).toBe('string');
  });

  it('error_description is human-readable (e.g., "Missing or invalid parameter: client_id")', () => {
    const req = makeMockReq({
      redirect_uri: 'https://localhost:8888/callback',
      response_type: 'code',
    });
    const res = makeMockRes();

    handler(req, res);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    const errorResponse = calls.json as Record<string, unknown>;
    expect(typeof errorResponse['error_description']).toBe('string');
    const desc = errorResponse['error_description'] as string;
    expect(desc.length).toBeGreaterThan(0);
    expect(desc.toLowerCase()).toContain('invalid');
  });
});
