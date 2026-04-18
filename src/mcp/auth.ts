import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { logger } from '../logging/logger.js';
import { redactToken } from './redaction.js';
import type { Request, Response, NextFunction } from 'express';

// ── Base64url helpers ──

function base64UrlEncode(input: string): string {
  return Buffer.from(input).toString('base64url');
}

// ── Token generation (D-11) ──

/**
 * Generate an access token (short-lived JWT).
 * Used for authenticating requests to MCP endpoints.
 * Per D-07: token format is HMAC-SHA256 JWT with instance_id and issued_at claims.
 */
export function generateToken(instanceId: string, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    instance_id: instanceId,
    issued_at: Math.floor(Date.now() / 1000),
    version: 1,
  };

  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const message = `${headerEncoded}.${payloadEncoded}`;
  const signature = createHmac('sha256', secret).update(message).digest('base64url');

  return `${message}.${signature}`;
}

/**
 * Generate a refresh token (longer-lived JWT).
 * Refresh tokens allow clients to obtain new access tokens without re-authenticating.
 * Per D-04: refresh token lifetime = 7× access token lifetime (default: 7×24h = 168h = 7 days).
 * Token format: same as access tokens (HMAC-SHA256 JWT).
 */
export function generateRefreshToken(
  instanceId: string,
  secret: string,
  accessTokenLifetimeHours: number = 24
): string {
  // Refresh token lifetime: 7x access token (with sensible bounds)
  const refreshLifetimeHours = Math.min(accessTokenLifetimeHours * 7, 8760); // cap at 1 year

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    instance_id: instanceId,
    issued_at: Math.floor(Date.now() / 1000),
    version: 1,
    token_type: 'refresh', // Distinguish from access tokens (for future validation)
    lifetime_hours: refreshLifetimeHours,
  };

  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const message = `${headerEncoded}.${payloadEncoded}`;
  const signature = createHmac('sha256', secret).update(message).digest('base64url');

  return `${message}.${signature}`;
}

// ── Authorization code generation (D-02: short-lived JWT with 60-second lifetime) ──

/**
 * Generate an authorization code (short-lived JWT).
 * Used for OAuth 2.0 Authorization Code flow (Phase 51).
 * Per D-02: authorization code format is HMAC-SHA256 JWT with 60-second lifetime.
 * Payload includes code_id (UUID), issued_at, expires_at, instance_id, code_type, version.
 */
export function generateAuthCode(instanceId: string, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    code_id: randomUUID(),
    issued_at: issuedAt,
    expires_at: issuedAt + 60, // 60-second lifetime (D-02)
    instance_id: instanceId,
    code_type: 'authorization',
    version: 1,
  };

  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const message = `${headerEncoded}.${payloadEncoded}`;
  const signature = createHmac('sha256', secret).update(message).digest('base64url');

  return `${message}.${signature}`;
}

/**
 * Validate an authorization code JWT.
 * Per D-02: validates JWT structure, signature, expiration, and code_type.
 * Uses constant-time comparison (timingSafeEqual) to prevent timing attacks (RESEARCH.md Pitfall 6).
 * Returns { valid: true, payload } on success or { valid: false } on any validation failure.
 */
export function validateAuthCode(
  code: string,
  secret: string,
  expectedInstanceId?: string
): {
  valid: boolean;
  payload?: { code_id: string; issued_at: number; expires_at: number; instance_id: string; code_type: string };
} {
  const parts = code.split('.');

  // JWT must have exactly 3 parts separated by dots
  if (parts.length !== 3) {
    return { valid: false };
  }

  const [headerEncoded, payloadEncoded, signatureEncoded] = parts;
  const message = `${headerEncoded}.${payloadEncoded}`;
  const expectedSignature = createHmac('sha256', secret).update(message).digest('base64url');

  // Constant-time comparison (prevent timing attacks)
  const actualBuf = Buffer.from(signatureEncoded, 'utf8');
  const expectedBuf = Buffer.from(expectedSignature, 'utf8');

  if (actualBuf.length !== expectedBuf.length) return { valid: false };

  if (!timingSafeEqual(actualBuf, expectedBuf)) return { valid: false };

  try {
    const payload = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString()) as {
      code_id: string;
      issued_at: number;
      expires_at: number;
      instance_id: string;
      code_type: string;
      version: number;
    };

    // Validate code_type is 'authorization' (prevent reuse of other JWT types)
    if (payload.code_type !== 'authorization') {
      return { valid: false };
    }

    // Validate instance_id matches expected instance (if provided)
    if (expectedInstanceId && payload.instance_id !== expectedInstanceId) {
      return { valid: false };
    }

    // Reject if code has expired (expires_at must be >= current timestamp)
    const currentTime = Math.floor(Date.now() / 1000);
    if (payload.expires_at < currentTime) {
      return { valid: false };
    }

    return {
      valid: true,
      payload: {
        code_id: payload.code_id,
        issued_at: payload.issued_at,
        expires_at: payload.expires_at,
        instance_id: payload.instance_id,
        code_type: payload.code_type,
      },
    };
  } catch {
    return { valid: false };
  }
}

// ── Token verification (D-14, SEC-03: constant-time comparison) ──

export function verifyToken(
  token: string,
  secret: string
): { valid: boolean; payload?: { instance_id: string; issued_at: number; version: number } } {
  const parts = token.split('.');

  // If token contains 2 dots, treat as JWT. Otherwise treat as raw secret.
  if (parts.length === 3) {
    // JWT format: validate signature
    const [headerEncoded, payloadEncoded, signatureEncoded] = parts;
    const message = `${headerEncoded}.${payloadEncoded}`;
    const expectedSignature = createHmac('sha256', secret).update(message).digest('base64url');

    // Constant-time comparison (SEC-03)
    const actualBuf = Buffer.from(signatureEncoded, 'utf8');
    const expectedBuf = Buffer.from(expectedSignature, 'utf8');

    if (actualBuf.length !== expectedBuf.length) return { valid: false };

    if (!timingSafeEqual(actualBuf, expectedBuf)) return { valid: false };

    try {
      const payload = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString()) as {
        instance_id: string;
        issued_at: number;
        version: number;
      };
      return { valid: true, payload };
    } catch {
      return { valid: false };
    }
  } else {
    // Raw secret format: constant-time comparison with provided secret (SEC-03)
    const tokenBuf = Buffer.from(token, 'utf8');
    const secretBuf = Buffer.from(secret, 'utf8');

    if (tokenBuf.length !== secretBuf.length) return { valid: false };

    if (!timingSafeEqual(tokenBuf, secretBuf)) return { valid: false };

    return { valid: true };
  }
}

// ── RFC 7235 WWW-Authenticate header builder (T-49-01, T-49-04, T-49-06) ──

// Validates that a header parameter value contains only safe characters.
// Allows: alphanumeric, hyphens, underscores, spaces (for realm display name).
// Prevents header injection via untrusted input (T-49-01).
function isSafeHeaderParam(value: string): boolean {
  return /^[\w\s-]+$/.test(value);
}

export function buildWwwAuthenticateHeader(
  realm: string,
  error: string,
  errorDescription: string
): string {
  // Sanitize all parameters — values are constants, but guard defensively (T-49-01)
  const safeRealm = isSafeHeaderParam(realm) ? realm : 'FlashQuery';
  const safeError = isSafeHeaderParam(error) ? error : 'invalid_request';
  const safeDescription = isSafeHeaderParam(errorDescription)
    ? errorDescription
    : 'Authentication failed';

  return `Bearer realm="${safeRealm}", error="${safeError}", error_description="${safeDescription}"`;
}

// ── Express middleware (D-15, D-17, D-27) ──

export function createAuthMiddleware(secret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      logger.info('[auth] missing authorization header');
      res.status(401);
      res.setHeader(
        'WWW-Authenticate',
        buildWwwAuthenticateHeader(
          'FlashQuery',
          'invalid_request',
          'Authorization header required'
        )
      );
      res.json({ error: 'Unauthorized' });
      return;
    }

    const [scheme, token] = authHeader.split(' ');
    if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
      logger.info('[auth] invalid authorization scheme');
      res.status(401);
      res.setHeader(
        'WWW-Authenticate',
        buildWwwAuthenticateHeader(
          'FlashQuery',
          'invalid_request',
          'Bearer token required'
        )
      );
      res.json({ error: 'Unauthorized' });
      return;
    }

    const { valid } = verifyToken(token, secret);
    if (!valid) {
      logger.info(`[auth] invalid bearer token: ${redactToken(token)}`);
      res.status(401);
      res.setHeader(
        'WWW-Authenticate',
        buildWwwAuthenticateHeader(
          'FlashQuery',
          'invalid_token',
          'Token invalid or expired'
        )
      );
      res.json({ error: 'Unauthorized' });
      return;
    }

    next();
  };
}
