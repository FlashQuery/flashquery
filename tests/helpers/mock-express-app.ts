/**
 * Test helper for Express app with global error handler.
 *
 * Provides factory functions and mock utilities for testing the
 * createGlobalErrorHandler middleware from src/mcp/server.ts.
 * Used by tests/integration/http-error-handler.test.ts.
 */

import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import { vi } from 'vitest';
import { createGlobalErrorHandler } from '../../src/mcp/server.js';

// ── Mock logger setup ──

/**
 * Mock logger that captures calls for assertion in tests.
 * Replaces the real logger for testing — prevents stderr output during tests.
 */
export const mockLogger = {
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  detail: vi.fn(),
};

// Patch the logger module before any import of server.ts routes to prevent
// "logger is undefined" errors if initLogger hasn't been called.
// We inject a stub via vi.mock in test files instead (see http-error-handler.test.ts).

// ── Express App Factories ──

/**
 * Creates a test Express app with:
 * - A normal test route: GET /test → { ok: true }
 * - An error-throwing route: GET /test-error → throws Error('Test error')
 * - A configurable status code route: GET /test-status/:code → res.status(code)
 *   then next(new Error('Status error'))
 * - The global error handler middleware registered last
 *
 * Suitable for integration tests that make HTTP requests through supertest or
 * call error handlers end-to-end.
 */
export function createTestExpressApp(): Express {
  const app = express();
  app.use(express.json());

  // Normal route — should NOT trigger error handler
  app.get('/test', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Error-throwing route — triggers error handler via unhandled throw
  // Express wraps sync route handlers and calls next(err) on thrown errors
  app.get('/test-error', (_req: Request, _res: Response) => {
    throw new Error('Test error from route');
  });

  // Configurable status + error route — useful for testing specific status codes
  // Sets res.statusCode before calling next(err) so error handler picks it up
  app.get('/test-status/:code', (req: Request, res: Response, next: NextFunction) => {
    const code = parseInt(req.params['code'] ?? '500', 10);
    res.status(code);
    next(new Error(`Synthetic ${code} error`));
  });

  // Global error handler — MUST be registered last
  app.use(createGlobalErrorHandler());

  return app;
}

/**
 * Creates a minimal test Express app with error handler but WITHOUT
 * pre-defined error-throwing routes. Use this when tests want to call
 * the error handler directly via next(err) or custom route setup.
 *
 * Returns the app and a handle to register additional routes before use.
 */
export function createTestExpressAppWithErrors(): Express {
  const app = express();
  app.use(express.json());

  // Global error handler — MUST be registered last
  app.use(createGlobalErrorHandler());

  return app;
}

// ── Mock Request / Response Factories ──

/**
 * Options for creating a mock Express Request.
 */
export interface MockRequestOptions {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string>;
}

/**
 * Creates a mock Express Request object for unit-testing middleware directly.
 * All properties are plain values; no actual HTTP connection required.
 */
export function makeMockRequest(options: MockRequestOptions = {}): Request {
  return {
    method: options.method ?? 'GET',
    path: options.path ?? '/',
    headers: options.headers ?? {},
    body: options.body ?? {},
    params: options.params ?? {},
  } as unknown as Request;
}

/**
 * Mock Express Response tracking object. Returned alongside the response mock
 * to allow assertions on captured calls.
 */
export interface MockResponseTracker {
  statusCalls: number[];
  jsonCalls: unknown[];
  sendCalls: unknown[];
}

/**
 * Mock Express Response instance with vitest spy functions.
 *
 * - status(code): tracks call, returns this (chainable)
 * - json(body): tracks call, returns this
 * - send(body): tracks call, returns this
 * - statusCode: settable property (default 200)
 * - headersSent: settable boolean (default false)
 *
 * Usage:
 *   const { res, tracker } = makeMockResponse();
 *   handler(err, req, res, next);
 *   expect(tracker.statusCalls).toContain(500);
 */
export function makeMockResponse(options: { statusCode?: number; headersSent?: boolean } = {}): {
  res: Response;
  tracker: MockResponseTracker;
} {
  const tracker: MockResponseTracker = {
    statusCalls: [],
    jsonCalls: [],
    sendCalls: [],
  };

  const res: Partial<Response> & { statusCode: number; headersSent: boolean } = {
    statusCode: options.statusCode ?? 200,
    headersSent: options.headersSent ?? false,
    status: vi.fn(function (this: typeof res, code: number) {
      tracker.statusCalls.push(code);
      this.statusCode = code;
      return this as unknown as Response;
    }),
    json: vi.fn(function (this: typeof res, body: unknown) {
      tracker.jsonCalls.push(body);
      return this as unknown as Response;
    }),
    send: vi.fn(function (this: typeof res, body: unknown) {
      tracker.sendCalls.push(body);
      return this as unknown as Response;
    }),
    setHeader: vi.fn(),
    getHeader: vi.fn(),
  };

  return { res: res as unknown as Response, tracker };
}
