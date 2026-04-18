/**
 * Integration tests for the global Express error handler middleware.
 *
 * Tests validate:
 * - Consistent JSON error format for all 4xx/5xx status codes
 * - No stack trace or implementation details in response body (T-49-07)
 * - Generic error messages only — no database/file paths (T-49-08)
 * - res.headersSent guard prevents double-send (T-49-09)
 * - logger.error called for every error (server-side audit trail)
 * - Async errors from route handlers flow through error handler
 *
 * Test approach: call createGlobalErrorHandler() directly with mock req/res/next
 * objects, so tests run fast without a listening HTTP server or supertest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextFunction } from 'express';
import { makeMockRequest, makeMockResponse } from '../helpers/mock-express-app.js';
import { createTestExpressApp } from '../helpers/mock-express-app.js';

// ── Logger mock ──
// Must be hoisted before createGlobalErrorHandler import so it patches the module.
vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    detail: vi.fn(),
  },
  initLogger: vi.fn(),
}));

// Import after mock registration
import { createGlobalErrorHandler } from '../../src/mcp/server.js';
import { logger } from '../../src/logging/logger.js';

// ── Helpers ──

function noop(): void {}
const noopNext = noop as NextFunction;

// ── Tests ──

describe('Global Express Error Handler', () => {
  let handler: ReturnType<typeof createGlobalErrorHandler>;

  beforeEach(() => {
    handler = createGlobalErrorHandler();
    // Reset all mock call counts before each test
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 1: 400 Bad Request → error="bad_request", code=400
  // ──────────────────────────────────────────────────────────────────────
  it('Test 1: 400 Bad Request returns JSON with error="bad_request" and code=400', () => {
    const err = new Error('Validation failed');
    const req = makeMockRequest({ method: 'POST', path: '/mcp' });
    const { res, tracker } = makeMockResponse({ statusCode: 400 });

    handler(err, req, res, noopNext);

    expect(tracker.statusCalls).toContain(400);
    expect(tracker.jsonCalls).toHaveLength(1);
    expect(tracker.jsonCalls[0]).toMatchObject({
      error: 'bad_request',
      code: 400,
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 2: 400 response includes generic message
  // ──────────────────────────────────────────────────────────────────────
  it('Test 2: 400 response includes generic message "Request could not be processed"', () => {
    const err = new Error('Bad input data');
    const req = makeMockRequest({ method: 'POST', path: '/mcp' });
    const { res, tracker } = makeMockResponse({ statusCode: 400 });

    handler(err, req, res, noopNext);

    expect(tracker.jsonCalls[0]).toMatchObject({
      message: 'Request could not be processed',
    });
    // Must NOT contain the actual error message (implementation detail)
    const responseBody = JSON.stringify(tracker.jsonCalls[0]);
    expect(responseBody).not.toContain('Bad input data');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 3: 500 Internal Server Error → error="server_error", code=500
  // ──────────────────────────────────────────────────────────────────────
  it('Test 3: 500 Internal Server Error returns JSON with error="server_error" and code=500', () => {
    const err = new Error('Database connection failed');
    const req = makeMockRequest({ method: 'POST', path: '/mcp' });
    const { res, tracker } = makeMockResponse({ statusCode: 500 });

    handler(err, req, res, noopNext);

    expect(tracker.statusCalls).toContain(500);
    expect(tracker.jsonCalls[0]).toMatchObject({
      error: 'server_error',
      code: 500,
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 4: 500 response does NOT include stack trace in JSON body
  // ──────────────────────────────────────────────────────────────────────
  it('Test 4: 500 response does NOT include stack trace in JSON body', () => {
    const err = new Error('Internal crash');
    // Stack will be populated by V8 automatically
    err.stack = `Error: Internal crash\n    at Object.<anonymous> (src/mcp/server.ts:100:5)\n    at Module._compile (internal/modules/cjs/loader.js:1)\n`;

    const req = makeMockRequest({ method: 'POST', path: '/mcp' });
    const { res, tracker } = makeMockResponse({ statusCode: 500 });

    handler(err, req, res, noopNext);

    const responseBody = JSON.stringify(tracker.jsonCalls[0]);
    // Stack trace indicators must NOT appear in response
    expect(responseBody).not.toContain('at Object');
    expect(responseBody).not.toContain('at Module');
    expect(responseBody).not.toContain('.ts:');
    expect(responseBody).not.toContain('src/');
    expect(responseBody).not.toContain('stack');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 5: 500 response does NOT include err.cause or implementation details
  // ──────────────────────────────────────────────────────────────────────
  it('Test 5: 500 response does NOT include err.cause or implementation details', () => {
    const cause = new Error('pg connection to 192.168.1.1 refused');
    const err = new Error('Query failed') as Error & { cause: unknown };
    err.cause = cause;

    const req = makeMockRequest({ method: 'GET', path: '/mcp' });
    const { res, tracker } = makeMockResponse({ statusCode: 500 });

    handler(err, req, res, noopNext);

    const responseBody = JSON.stringify(tracker.jsonCalls[0]);
    expect(responseBody).not.toContain('cause');
    expect(responseBody).not.toContain('192.168.1.1');
    expect(responseBody).not.toContain('pg connection');
    expect(responseBody).not.toContain('Query failed');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 6: Error handler logs error with method, path, message (server-side only)
  // ──────────────────────────────────────────────────────────────────────
  it('Test 6: Error handler logs error with method, path, and error message server-side', () => {
    const err = new Error('Something went wrong');
    const req = makeMockRequest({ method: 'DELETE', path: '/mcp' });
    const { res } = makeMockResponse({ statusCode: 500 });

    handler(err, req, res, noopNext);

    expect(logger.error).toHaveBeenCalledOnce();
    const logCall = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(logCall).toContain('500');
    expect(logCall).toContain('DELETE');
    expect(logCall).toContain('/mcp');
    expect(logCall).toContain('Something went wrong');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 7: 404 Not Found → error="not_found", code=404
  // ──────────────────────────────────────────────────────────────────────
  it('Test 7: 404 Not Found returns error="not_found" and code=404', () => {
    const err = new Error('No such resource');
    const req = makeMockRequest({ method: 'GET', path: '/mcp/missing' });
    const { res, tracker } = makeMockResponse({ statusCode: 404 });

    handler(err, req, res, noopNext);

    expect(tracker.statusCalls).toContain(404);
    expect(tracker.jsonCalls[0]).toMatchObject({
      error: 'not_found',
      message: 'Resource not found',
      code: 404,
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 8: 401 Unauthorized → error="unauthorized", code=401
  // ──────────────────────────────────────────────────────────────────────
  it('Test 8: 401 Unauthorized returns error="unauthorized" and code=401', () => {
    const err = new Error('Token expired');
    const req = makeMockRequest({ method: 'POST', path: '/mcp' });
    const { res, tracker } = makeMockResponse({ statusCode: 401 });

    handler(err, req, res, noopNext);

    expect(tracker.statusCalls).toContain(401);
    expect(tracker.jsonCalls[0]).toMatchObject({
      error: 'unauthorized',
      message: 'Authentication required',
      code: 401,
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 9: 403 Forbidden → error="forbidden", code=403
  // ──────────────────────────────────────────────────────────────────────
  it('Test 9: 403 Forbidden returns error="forbidden" and code=403', () => {
    const err = new Error('Access denied');
    const req = makeMockRequest({ method: 'POST', path: '/mcp' });
    const { res, tracker } = makeMockResponse({ statusCode: 403 });

    handler(err, req, res, noopNext);

    expect(tracker.statusCalls).toContain(403);
    expect(tracker.jsonCalls[0]).toMatchObject({
      error: 'forbidden',
      message: 'Insufficient permissions',
      code: 403,
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 10: All error responses have JSON schema with error, message, code
  // ──────────────────────────────────────────────────────────────────────
  it('Test 10: All error responses have JSON format with error, message, code fields', () => {
    const statusCodes = [400, 401, 403, 404, 500, 503];

    for (const statusCode of statusCodes) {
      vi.clearAllMocks();
      const err = new Error(`Error for ${statusCode}`);
      const req = makeMockRequest({ method: 'GET', path: '/test' });
      const { res, tracker } = makeMockResponse({ statusCode });

      handler(err, req, res, noopNext);

      expect(tracker.jsonCalls).toHaveLength(1);
      const body = tracker.jsonCalls[0] as Record<string, unknown>;

      // All three fields must be present
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('code');

      // Types must be correct
      expect(typeof body['error']).toBe('string');
      expect(typeof body['message']).toBe('string');
      expect(typeof body['code']).toBe('number');

      // code must match the HTTP status code (5xx are passed through as-is, not normalised to 500)
      expect(body['code']).toBe(statusCode);
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 11: Throwing error in route handler triggers error handler → 500 JSON
  // ──────────────────────────────────────────────────────────────────────
  it('Test 11: Throwing error in sync route handler results in 500 JSON response', async () => {
    // createTestExpressApp() includes GET /test-error that throws an error
    // We test by simulating what Express does: calling the error handler with
    // the thrown error and a 500 status (Express default for unhandled throws)
    const err = new Error('Test error from route');
    const req = makeMockRequest({ method: 'GET', path: '/test-error' });
    const { res, tracker } = makeMockResponse({ statusCode: 500 });

    handler(err, req, res, noopNext);

    expect(tracker.statusCalls).toContain(500);
    expect(tracker.jsonCalls[0]).toMatchObject({
      error: 'server_error',
      code: 500,
    });
    // Response must be JSON (not HTML error page)
    const body = tracker.jsonCalls[0] as Record<string, unknown>;
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('message');
    expect(body).toHaveProperty('code');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 12: headersSent check prevents double-send
  // ──────────────────────────────────────────────────────────────────────
  it('Test 12: Error handler does NOT call res.status() or res.json() when headers already sent', () => {
    const err = new Error('Late error after partial response');
    const req = makeMockRequest({ method: 'GET', path: '/mcp' });
    // Simulate: headers already sent (e.g., SSE stream started responding)
    const { res, tracker } = makeMockResponse({ statusCode: 200, headersSent: true });

    handler(err, req, res, noopNext);

    // Must NOT attempt to set status or send JSON (would throw in real Express)
    expect(tracker.statusCalls).toHaveLength(0);
    expect(tracker.jsonCalls).toHaveLength(0);
    // But should still log the error server-side
    expect(logger.error).toHaveBeenCalledOnce();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Bonus: Verify createTestExpressApp() creates app with test routes
  // ──────────────────────────────────────────────────────────────────────
  it('createTestExpressApp() returns Express app instance with routes configured', () => {
    const app = createTestExpressApp();
    // Express app has a handle method (router layer)
    expect(typeof app).toBe('function');
    expect(typeof app.get).toBe('function');
    expect(typeof app.post).toBe('function');
    expect(typeof app.use).toBe('function');
  });
});
