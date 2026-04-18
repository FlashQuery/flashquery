/**
 * Integration tests for token redaction in logging.
 *
 * Verifies that bearer tokens and auth secrets never appear in plaintext in any
 * log output. Tests both startup logging (server.ts) and auth failure logging
 * (auth.ts) using in-process log capture.
 *
 * Strategy: Use initLogger with a custom write function to capture all log lines,
 * then assert on the captured output using negative (NOT present) and positive (IS present)
 * test assertions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initLogger, logger } from '../../src/logging/logger.js';
import { generateToken, createAuthMiddleware } from '../../src/mcp/auth.js';
import { redactToken } from '../../src/mcp/redaction.js';
import type { Request, Response, NextFunction } from 'express';

// ── Test constants ──

const TEST_SECRET = 'sk-test123456789abc';
const TEST_INSTANCE_ID = 'test-instance-redaction';

// ── Log capture helpers ──

let capturedLogs: string[] = [];

function captureLogger(): void {
  capturedLogs = [];
  // Build a minimal FlashQueryConfig with debug logging to capture all output.
  // Cast via unknown to avoid constructing the full config object.
  const minimalConfig = {
    logging: { level: 'debug' as const, output: 'stdout' as const, file: undefined },
  } as unknown as Parameters<typeof initLogger>[0];
  initLogger(minimalConfig, (line: string) => {
    capturedLogs.push(line);
  });
}

function getCapturedOutput(): string {
  return capturedLogs.join('\n');
}

// ── Mock Express objects ──

function makeMockRes() {
  const res = {
    status: (code: number) => {
      void code;
      return res;
    },
    json: (body: unknown) => {
      void body;
      return res;
    },
    setHeader: vi.fn(),
  };
  return res as unknown as Response;
}

function makeMockReq(authHeader?: string): Request {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  } as unknown as Request;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Token redaction in logging', () => {
  let validToken: string;

  beforeEach(() => {
    captureLogger();
    validToken = generateToken(TEST_INSTANCE_ID, TEST_SECRET);
  });

  afterEach(() => {
    capturedLogs = [];
  });

  // ── Startup log tests (simulating server.ts startup) ──

  describe('Startup logging', () => {
    it('should NOT log plaintext auth secret in startup logs', () => {
      // Simulate the server startup log lines from server.ts
      logger.info(`MCP auth: Bearer token required for HTTP transport`);
      logger.info(`MCP auth: Generated JWT token for clients:`);
      logger.info(`MCP auth:   Authorization: Bearer ${redactToken(validToken)}`);
      logger.info(`MCP auth: Alternatively, send the raw secret:`);
      logger.info(`MCP auth:   Authorization: Bearer ${redactToken(TEST_SECRET)}`);

      const output = getCapturedOutput();

      // NEGATIVE: plaintext secret must NOT appear
      expect(output).not.toContain(TEST_SECRET);

      // POSITIVE: redacted secret SHOULD appear
      expect(output).toContain('sk-test12');
      expect(output).toContain('***');
    });

    it('should NOT log plaintext JWT token in startup logs', () => {
      logger.info(`MCP auth:   Authorization: Bearer ${redactToken(validToken)}`);

      const output = getCapturedOutput();

      // NEGATIVE: full JWT token must NOT appear
      expect(output).not.toContain(validToken);

      // POSITIVE: redacted JWT SHOULD appear (first 8 chars + ***)
      const redacted = redactToken(validToken) as string;
      expect(output).toContain(redacted);
      expect(redacted).toContain('***');
    });

    it('should show redacted secret in expected format (sk-[8chars]***)', () => {
      logger.info(`MCP auth:   Authorization: Bearer ${redactToken(TEST_SECRET)}`);

      const output = getCapturedOutput();

      // Verify the redacted secret follows the expected format
      expect(output).toMatch(/sk-test1234\*\*\*/);
    });

    it('should show redacted JWT in expected format (first8chars***)', () => {
      logger.info(`MCP auth:   Authorization: Bearer ${redactToken(validToken)}`);

      const output = getCapturedOutput();

      // JWT token starts with 'eyJ' (base64url of '{"')
      expect(output).toMatch(/eyJ[\w]{5}\*\*\*/);
    });
  });

  // ── Auth middleware tests (simulating auth.ts auth failure path) ──

  describe('Auth failure logging', () => {
    it('should NOT log plaintext token in auth failure logs', () => {
      const middleware = createAuthMiddleware(TEST_SECRET);
      const badToken = generateToken(TEST_INSTANCE_ID, 'wrong-secret');

      const req = makeMockReq(`Bearer ${badToken}`);
      const res = makeMockRes();
      const next: NextFunction = () => {};

      middleware(req, res, next);

      const output = getCapturedOutput();

      // NEGATIVE: full token must NOT appear
      expect(output).not.toContain(badToken);

      // POSITIVE: redacted token SHOULD appear in the log
      const redactedToken = redactToken(badToken) as string;
      expect(output).toContain(redactedToken);
      expect(output).toContain('[auth] invalid bearer token:');
    });

    it('should include redacted token identifier in auth failure message', () => {
      const middleware = createAuthMiddleware(TEST_SECRET);
      const badToken = 'sk-invalid-secret-value';

      const req = makeMockReq(`Bearer ${badToken}`);
      const res = makeMockRes();
      const next: NextFunction = () => {};

      middleware(req, res, next);

      const output = getCapturedOutput();

      // NEGATIVE: full plaintext token must NOT appear
      expect(output).not.toContain('sk-invalid-secret-value');

      // POSITIVE: the auth failure log should show the redacted identifier
      expect(output).toContain('[auth] invalid bearer token: sk-invalid-***');
    });

    it('should redact JWT token in auth failure log', () => {
      const middleware = createAuthMiddleware(TEST_SECRET);
      const badJwt = generateToken(TEST_INSTANCE_ID, 'different-secret');

      const req = makeMockReq(`Bearer ${badJwt}`);
      const res = makeMockRes();
      const next: NextFunction = () => {};

      middleware(req, res, next);

      const output = getCapturedOutput();

      // NEGATIVE: full JWT must NOT appear
      expect(output).not.toContain(badJwt);

      // POSITIVE: failure message should contain redacted JWT format
      expect(output).toContain('[auth] invalid bearer token:');
      expect(output).toMatch(/invalid bearer token: eyJ[\w]{5}\*\*\*/);
    });
  });

  // ── Consistency tests ──

  describe('Redaction consistency', () => {
    it('should produce the same redacted form across multiple log calls', () => {
      // Multiple calls with same token should produce consistent redaction
      logger.info(`First log: ${redactToken(TEST_SECRET)}`);
      logger.info(`Second log: ${redactToken(TEST_SECRET)}`);
      logger.info(`Third log: ${redactToken(TEST_SECRET)}`);

      const output = getCapturedOutput();
      const expectedRedacted = redactToken(TEST_SECRET) as string;

      // All three occurrences should use the same redacted form
      expect(output.split(expectedRedacted).length - 1).toBe(3);
      // Original secret should never appear
      expect(output).not.toContain(TEST_SECRET);
    });

    it('should produce consistent redaction for JWT token across multiple calls', () => {
      const redacted = redactToken(validToken) as string;

      logger.info(`First: ${redactToken(validToken)}`);
      logger.info(`Second: ${redactToken(validToken)}`);

      const output = getCapturedOutput();

      // Both logs should use the same redacted form
      expect(output.split(redacted).length - 1).toBe(2);
      // Original token should never appear
      expect(output).not.toContain(validToken);
    });
  });
});
