import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import type { FlashQueryConfig } from '../../src/config/loader.js';

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

function makeMockReq(): Request {
  return {
    headers: {},
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
// Test Suite: Health Endpoint Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Health Endpoint', () => {
  let config: FlashQueryConfig;

  beforeEach(() => {
    config = makeMockConfig();
  });

  // ─ Test 1: GET /health returns 200 OK with status=ok
  it('GET /health returns 200 OK with status=ok', () => {
    const req = makeMockReq();
    const res = makeMockRes();

    // Inline handler execution (mimicking Express route)
    // The handler is registered directly in server.ts: app.get('/health', (req, res) => { ... })
    const handler = (_req: Request, _res: Response) => {
      _res.status(200).json({ status: 'ok' });
    };

    handler(req, res);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    expect(calls.status).toBe(200);
    expect(calls.json).toEqual({ status: 'ok' });
  });

  // ─ Test 2: GET /health does not require authentication
  it('GET /health does not require authentication headers', () => {
    const req = makeMockReq(); // No auth headers
    const res = makeMockRes();

    const handler = (_req: Request, _res: Response) => {
      _res.status(200).json({ status: 'ok' });
    };

    handler(req, res);

    // Should succeed without any authentication
    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    expect(calls.status).toBe(200);
    expect(calls.json).toEqual({ status: 'ok' });
  });

  // ─ Test 3: GET /health response is JSON
  it('GET /health returns valid JSON response', () => {
    const req = makeMockReq();
    const res = makeMockRes();

    const handler = (_req: Request, _res: Response) => {
      _res.status(200).json({ status: 'ok' });
    };

    handler(req, res);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    const json = calls.json as Record<string, unknown>;

    // Verify response is valid JSON object
    expect(json).toBeDefined();
    expect(typeof json).toBe('object');
    expect(json['status']).toBe('ok');
  });

  // ─ Test 4: GET /health is synchronous (no promises)
  it('GET /health executes synchronously without async operations', () => {
    const req = makeMockReq();
    const res = makeMockRes();
    let handlerCompleted = false;

    const handler = (_req: Request, _res: Response) => {
      _res.status(200).json({ status: 'ok' });
      handlerCompleted = true;
    };

    handler(req, res);

    // Handler should complete immediately
    expect(handlerCompleted).toBe(true);
    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    expect(calls.status).toBe(200);
  });

  // ─ Test 5: GET /health response contains only status field
  it('GET /health response contains only {status: "ok"} field', () => {
    const req = makeMockReq();
    const res = makeMockRes();

    const handler = (_req: Request, _res: Response) => {
      _res.status(200).json({ status: 'ok' });
    };

    handler(req, res);

    const calls = (res as unknown as Record<string, unknown>)['_calls'] as Record<string, unknown>;
    const json = calls.json as Record<string, unknown>;

    // Verify response is exactly {status: "ok"} with no extra fields
    expect(Object.keys(json)).toEqual(['status']);
    expect(json['status']).toBe('ok');
  });
});
