import { randomUUID } from 'node:crypto';
import type http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express, { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { initLogger, logger } from '../logging/logger.js';
import { generateCorrelationId, initializeContext } from '../logging/context.js';
import { createAuthMiddleware, generateToken, generateRefreshToken, generateAuthCode, validateAuthCode } from './auth.js';
import { redactToken } from './redaction.js';
import { registerMemoryTools } from './tools/memory.js';
import { registerDocumentTools } from './tools/documents.js';
import { registerPluginTools } from './tools/plugins.js';
import { registerRecordTools } from './tools/records.js';
import { registerCompoundTools } from './tools/compound.js';
import { registerScanTools } from './tools/scan.js';
import { registerPendingReviewTools } from './tools/pending-review.js';
import type { FlashQueryConfig } from '../config/loader.js';

// ── HTTP Error Code and Message Mapping (D-04) ──

interface HttpErrorInfo {
  errorCode: string;
  message: string;
}

function mapStatusToErrorInfo(statusCode: number): HttpErrorInfo {
  if (statusCode === 400) return { errorCode: 'bad_request', message: 'Request could not be processed' };
  if (statusCode === 401) return { errorCode: 'unauthorized', message: 'Authentication required' };
  if (statusCode === 403) return { errorCode: 'forbidden', message: 'Insufficient permissions' };
  if (statusCode === 404) return { errorCode: 'not_found', message: 'Resource not found' };
  // All 5xx errors and any other unrecognized codes
  return { errorCode: 'server_error', message: 'An unexpected error occurred' };
}

/**
 * ServerInfoResponse — the JSON shape returned by GET /mcp/info (D-03, INFO-01–INFO-03).
 * Only safe fields are included; no secrets, DB URLs, or API keys.
 */
export interface ServerInfoResponse {
  name: string;
  version: string;
  auth_schemes: string[];
  http_port: number;
  mcp_version: string;
  instance_id: string;
}

/**
 * Factory that creates the GET /mcp/info route handler (D-02, D-03, INFO-01–INFO-03).
 *
 * Returns an Express request handler that produces the server discovery response.
 * Exported for direct unit testing without starting the HTTP server.
 *
 * The handler must be registered BEFORE auth middleware so the endpoint is public.
 * Response fields: name, version, auth_schemes, http_port, mcp_version, instance_id.
 * Threat T-49-12: whitelist-only response — never include auth_secret or credentials.
 */
export function createInfoHandler(config: FlashQueryConfig, version: string) {
  return (_req: Request, res: Response): void => {
    const body: ServerInfoResponse = {
      name: 'FlashQuery',
      version,
      auth_schemes: ['bearer'],
      http_port: config.mcp.port ?? 3100,
      mcp_version: '1.0.0',
      instance_id: config.instance.id,
    };
    res.json(body);
  };
}

/**
 * Global Express error handler middleware (D-04, T-49-07, T-49-08, T-49-09).
 *
 * Must have exactly 4 parameters — Express identifies error handlers by arity.
 * Converts all HTTP errors to consistent JSON format: { error, message, code }.
 * Never includes stack traces or implementation details in the response.
 * Stack trace logged server-side only via logger.error.
 *
 * CRITICAL: Must be registered AFTER all route handlers.
 */
export function createGlobalErrorHandler() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (err: Error & { statusCode?: number }, req: Request, res: Response, next: NextFunction): void => {
    // Derive HTTP status: prefer explicitly-set res.statusCode if it indicates error,
    // else fall back to err.statusCode (e.g. http-errors library), else 500.
    const statusCode =
      res.statusCode && res.statusCode >= 400
        ? res.statusCode
        : (err.statusCode ?? 500);

    const { errorCode, message } = mapStatusToErrorInfo(statusCode);

    // Log full error server-side (stack trace stays here, never in response)
    logger.error(
      `[ERROR_HANDLER] HTTP error ${statusCode} ${req.method} ${req.path}: ${err.message}`
    );
    logger.detail(`[ERROR_HANDLER] headers: content-type=${req.headers['content-type']}`);
    logger.detail(`[ERROR_HANDLER] body: ${JSON.stringify(req.body)}`);
    if (err.stack) {
      logger.detail(`[ERROR_HANDLER] stack: ${err.stack}`);
    }

    // T-49-09: Guard against double-send errors (headers may be sent by SSE streams)
    if (!res.headersSent) {
      res.status(statusCode).json({
        error: errorCode,
        message,
        code: statusCode,
      });
    }
  };
}

/**
 * Wraps a McpServer's .tool() method so every registered tool handler runs inside
 * an AsyncLocalStorage context with a unique correlation ID. This enables all log
 * messages from a single MCP request — including fire-and-forget operations — to
 * share the same REQ:uuid identifier for grep-based troubleshooting.
 *
 * Approach: monkey-patch server.tool() before any tool registrations occur.
 * This is more portable than wrapping individual handlers in each tool file.
 */
function wrapServerWithCorrelationIds(server: McpServer): McpServer {
  const originalTool = server.tool.bind(server);
  // Override tool() to wrap the last argument (the handler) with initializeContext
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).tool = (...args: any[]) => {
    const lastIdx = args.length - 1;
    const originalHandler = args[lastIdx];
    if (typeof originalHandler === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      args[lastIdx] = async (params: any) => {
        const correlationId = generateCorrelationId();
        return await initializeContext(correlationId, () => originalHandler(params));
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return (originalTool as (...a: unknown[]) => unknown)(...args);
  };
  return server;
}

/**
 * Parse HTTP Basic Auth header.
 * Format: "Basic base64(username:password)"
 * Returns: { username, password } or null if invalid.
 * Per D-06: credentials are username:password encoded in base64 per RFC 7617.
 */
function parseBasicAuth(authHeader: string | undefined): { username: string; password: string } | null {
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return null;
  }

  try {
    const encoded = authHeader.slice(6); // Remove "Basic " prefix
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const [username, ...passwordParts] = decoded.split(':');
    const password = passwordParts.join(':'); // Handle passwords containing colons

    if (!username || !password) {
      return null;
    }

    return { username, password };
  } catch {
    return null; // Invalid base64 or encoding
  }
}

/**
 * Factory that creates the POST /token endpoint handler (D-02, D-06, TOKEN-01–TOKEN-08, Phase 51 extension).
 *
 * Supports two grant types:
 * 1. HTTP Basic Auth (Phase 50, existing)
 * 2. grant_type=authorization_code (Phase 51, NEW)
 *
 * Per D-05: token endpoint is PUBLIC (not protected by auth middleware).
 * Clients can request tokens without a pre-existing Bearer token.
 */
export function createTokenHandler(config: FlashQueryConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      logger.info(`[POST /token] ENTRY: method=${req.method} path=${req.path}`);

      // Extract grant_type from body or query (OAuth 2.0 allows both)
      const grantType = (req.body as Record<string, unknown>)?.grant_type || req.query?.grant_type;
      logger.detail(`[POST /token] extracted grant_type: ${grantType || '(none)'}`);

      // ── Branch 1: grant_type=authorization_code (Phase 51, D-07) ──
      if (grantType === 'authorization_code') {
        // Extract authorization code from body or query
        const code = (req.body as Record<string, unknown>)?.code || req.query?.code;

        if (!code || typeof code !== 'string') {
          logger.info('[token] authorization_code grant: missing code parameter');
          res.status(400).json({
            error: 'invalid_request',
            error_description: 'Authorization code required (code parameter)',
          });
          return;
        }

        // DEBUG: Log code validation attempt (D-09)
        logger.debug('[token] validating authorization code');

        // D-BUG-01: Guard against missing authSecret before crypto calls (type narrowing)
        if (!config.mcp.authSecret) {
          logger.error('[token] authorization_code grant: server authSecret not configured');
          res.status(500).json({
            error: 'server_error',
            error_description: 'Server authentication not configured',
          });
          return;
        }

        // Validate authorization code JWT
        const { valid, payload } = validateAuthCode(code, config.mcp.authSecret);

        if (!valid) {
          logger.info('[token] authorization_code grant: invalid or expired authorization code');
          res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Authorization code invalid or expired',
          });
          return;
        }

        // DEBUG: Log successful validation (D-09)
        logger.debug(`[token] code validation succeeded: code_id=${payload?.code_id}`);

        // After this point authSecret is narrowed to string
        const authSecret = config.mcp.authSecret;

        // Issue new tokens (same path as HTTP Basic Auth)
        const accessTokenLifetime = config.mcp.tokenLifetime ?? 24; // hours
        const accessToken = generateToken(config.instance.id, authSecret);
        const refreshToken = generateRefreshToken(
          config.instance.id,
          authSecret,
          accessTokenLifetime
        );

        const expiresInSeconds = accessTokenLifetime * 3600;
        res.json({
          access_token: accessToken,
          refresh_token: refreshToken,
          token_type: 'Bearer',
          expires_in: expiresInSeconds,
          scope: '', // v1: no scopes
        });

        // INFO: Log successful code-to-token exchange (D-09)
        logger.info('[token] exchanged authorization code for access token');
        return;
      }

      // ── Branch 2: HTTP Basic Auth (Phase 50, D-06) ──
      // (Existing code, unchanged)
      const authHeader = req.headers.authorization;

      // Parse HTTP Basic Auth
      const creds = parseBasicAuth(authHeader);
      if (!creds) {
        logger.info('[token] missing or invalid authorization header');
        res.status(401).json({
          error: 'invalid_client',
          error_description: 'HTTP Basic Auth required (Authorization: Basic ...)',
        });
        return;
      }

      // Validate password against configured secret
      // Per D-05: token endpoint requires explicit credentials (no pre-existing token needed)
      if (!config.mcp.authSecret || creds.password !== config.mcp.authSecret) {
        logger.info('[token] invalid credentials');
        res.status(401).json({
          error: 'invalid_client',
          error_description: 'Client authentication failed',
        });
        return;
      }

      // Generate tokens
      const accessTokenLifetime = config.mcp.tokenLifetime ?? 24; // hours
      const accessToken = generateToken(config.instance.id, config.mcp.authSecret);
      const refreshToken = generateRefreshToken(
        config.instance.id,
        config.mcp.authSecret,
        accessTokenLifetime
      );

      // Return OAuth 2.0 token response (D-07)
      const expiresInSeconds = accessTokenLifetime * 3600;
      res.json({
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: expiresInSeconds,
        scope: '', // v1: no scopes (all tokens have access to all resources)
      });

      logger.info('[token] issued new token pair');
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Factory that creates the GET /authorize endpoint handler (D-01–D-06, AUTH-01–AUTH-06).
 *
 * Auto-consents without user prompt (v1 single-user model, D-01).
 * Generates short-lived JWT-based authorization code (60 seconds, D-02).
 * Accepts OAuth 2.0 query parameters per RFC 6749 Section 4.1.1 (D-03).
 * Returns 302 redirect to redirect_uri with code and state in query parameters (D-04).
 * Accepts any client_id and redirect_uri in v1 (D-05, D-06; validation via Zod URL parsing).
 *
 * Per D-09: DEBUG logs for validation steps, INFO log for successful code issuance.
 */
export function createAuthorizeHandler(config: FlashQueryConfig) {
  return (req: Request, res: Response): void => {
    try {
      // Parse and validate query parameters per D-03
      const AuthorizeParamsSchema = z.object({
        client_id: z.string().min(1).describe('Client identifier'),
        redirect_uri: z
          .string()
          .url()
          .refine(
            (uri) => {
              try {
                const parsed = new URL(uri);
                return ['http:', 'https:'].includes(parsed.protocol);
              } catch {
                return false;
              }
            },
            { message: 'redirect_uri must use http:// or https:// protocol' }
          )
          .describe('Client callback URL (must be valid URL per D-06)'),
        response_type: z.literal('code').describe('Must be "code" for authorization code flow (D-04)'),
        state: z.string().optional().describe('CSRF token (opaque to server, echoed back)'),
        scope: z.string().optional().describe('(Ignored in v1; all tokens have same access)'),
      });

      const params = AuthorizeParamsSchema.parse(req.query);

      // DEBUG: Log parameter validation successful (D-09)
      logger.debug(
        `[authorize] request: client_id=${params.client_id}, redirect_uri=${params.redirect_uri}, response_type=${params.response_type}` +
          (params.state ? `, state=${params.state.slice(0, 8)}***` : ', state=(none)')
      );

      // D-BUG-01: Guard against missing authSecret before generateAuthCode (type narrowing)
      if (!config.mcp.authSecret) {
        logger.error('[authorize] server authSecret not configured');
        res.status(500).json({
          error: 'server_error',
          error_description: 'Server authentication not configured',
        });
        return;
      }

      // After this point authSecret is narrowed to string
      const authSecret = config.mcp.authSecret;

      // Generate authorization code (D-02: short-lived JWT with 60s lifetime)
      const authCode = generateAuthCode(config.instance.id, authSecret);

      // DEBUG: Log code generation (D-09, redact code for security)
      const expirationTime = Math.floor(Date.now() / 1000) + 60;
      logger.debug(`[authorize] generated authorization code (expires at ${expirationTime})`);

      // Build redirect URL with code and optional state (RFC 6749 Section 4.1.2)
      const redirectUrl = new URL(params.redirect_uri);
      redirectUrl.searchParams.append('code', authCode);
      if (params.state) {
        redirectUrl.searchParams.append('state', params.state);
        logger.debug(`[authorize] including state parameter in redirect`);
      }

      // INFO: Log successful authorization (D-09)
      logger.info(`[authorize] successful: issued authorization code for ${params.client_id}`);

      // DEBUG: Log redirect response (D-09)
      logger.debug(`[authorize] redirecting to ${params.redirect_uri}`);

      // Respond with 302 Found redirect (D-04)
      res.redirect(302, redirectUrl.toString());
    } catch (err) {
      // Handle validation errors (Zod) and unexpected errors
      if (err instanceof z.ZodError) {
        // Invalid parameters — return OAuth 2.0 error (RFC 6749 Section 4.1.2.1, D-08)
        const issueKey = err.issues[0]?.path?.[0] ?? 'unknown';

        // DEBUG: Log validation failure (D-09)
        logger.debug(`[authorize] validation error: ${issueKey}`);

        // Determine error code based on which parameter failed
        let errorCode = 'invalid_request';
        let errorDescription = `Missing or invalid parameter: ${issueKey}`;

        if (issueKey === 'response_type') {
          errorCode = 'unsupported_response_type';
          errorDescription = 'response_type must be "code"';
        } else if (issueKey === 'redirect_uri') {
          errorCode = 'invalid_request';
          errorDescription = 'redirect_uri must be a valid URL';
        }

        res.status(400).json({
          error: errorCode,
          error_description: errorDescription,
        });
        return;
      }

      // Unexpected server error
      logger.error(`[authorize] error: ${(err as Error).message}`);
      res.status(500).json({
        error: 'server_error',
        error_description: 'An unexpected error occurred',
      });
    }
  };
}

/**
 * Factory that creates a fully-configured McpServer instance with all tools registered.
 * Called once for stdio transport, and once per HTTP client session for HTTP transport.
 * Wraps the server with correlation ID context before tool registration so all handlers
 * automatically propagate REQ:uuid through their async call stacks.
 */
function createMcpServer(config: FlashQueryConfig, version: string): McpServer {
  const server = new McpServer({ name: 'flashquery-core', version });
  // Apply correlation ID wrapping BEFORE tool registration so all 26 tools
  // automatically inherit context without modifying individual tool files.
  wrapServerWithCorrelationIds(server);
  registerMemoryTools(server, config);
  registerDocumentTools(server, config);
  registerPluginTools(server, config);
  registerRecordTools(server, config);
  registerCompoundTools(server, config);
  registerScanTools(server, config);
  registerPendingReviewTools(server, config);
  return server;
}

export async function initMCP(
  config: FlashQueryConfig,
  version = '0.1.0',
  transportOverride?: 'stdio' | 'streamable-http'
): Promise<http.Server | undefined> {
  // Step 1: ensure logging doesn't use stdout (reserved for MCP protocol).
  // If file logging is configured, keep it as-is. Otherwise force stderr.
  // This applies to BOTH transports.
  if (config.logging.output !== 'file') {
    initLogger(config, (line: string) => {
      process.stderr.write(line + '\n');
    });
  }

  const transportType = transportOverride ?? config.mcp.transport;

  logger.info('Correlation ID tracking enabled — all MCP requests logged with REQ:uuid');

  if (transportType === 'stdio') {
    // Stdio path — identical to v1.5 behavior (HTTP-06)
    const server = createMcpServer(config, version);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('MCP server: ready (stdio transport)');
  } else {
    // HTTP path — Streamable HTTP transport (HTTP-01 through HTTP-05)

    // Session map: keyed by session ID string
    // Note: stale entries may persist briefly after TCP drop (up to OS keep-alive timeout,
    // typically 30–60s). This is acceptable — the transport rejects requests for unknown sessions.
    const transports: Record<string, StreamableHTTPServerTransport> = {};

    // Express app — plain instance with JSON body parsing.
    // createMcpExpressApp() adds JSON-RPC validation middleware that rejects non-RPC POST requests,
    // which breaks the /token endpoint. Using plain express() instead.
    const app = express();
    app.use(express.json());

    // ── GET /mcp/info — Public discovery endpoint (D-02, D-03, INFO-01 through INFO-03) ──
    // Registered BEFORE auth middleware so clients can discover server capabilities
    // without a Bearer token. This route is intentionally unauthenticated.
    // Uses createInfoHandler factory (exported) so the handler is unit-testable without
    // starting the HTTP server. Response is whitelist-only — no secrets (T-49-12).
    app.get('/mcp/info', createInfoHandler(config, version));

    // ── POST /token — Token issuance endpoint (D-02, D-05, D-06, TOKEN-01–TOKEN-08) ──
    // Registered BEFORE auth middleware so token endpoint is public (clients can request
    // tokens without a pre-existing Bearer token). This is the "bootstrap" mechanism.
    // Uses createTokenHandler factory (exported) so the handler is unit-testable.
    // Per D-06: accepts HTTP Basic Auth (base64-encoded username:password).
    // Per D-07: returns OAuth 2.0 token response with access_token, refresh_token.
    const tokenHandler = createTokenHandler(config);
    app.post('/token', tokenHandler);

    // ── GET /authorize — Authorization code issuance endpoint (D-01–D-06, AUTH-01–AUTH-06) ──
    // Registered BEFORE auth middleware so clients can request authorization codes
    // without a pre-existing Bearer token. This enables the Authorization Code flow.
    // Uses createAuthorizeHandler factory (exported) so the handler is unit-testable.
    // Per D-02: returns authorization code as short-lived JWT (60s lifetime).
    // Per D-04: auto-consents and redirects to redirect_uri with code and state.
    app.get('/authorize', createAuthorizeHandler(config));

    // ── GET /health — Health check endpoint (D-08, D-09, D-13) ──
    // Registered BEFORE auth middleware so health checks are accessible without authentication.
    // Minimal response with no database checks, no async operations, no external dependencies.
    // Used by Docker, Kubernetes, load balancers, and monitoring tools for liveness checks.
    // Response: 200 OK with JSON {"status": "ok"}.
    app.get('/health', (req: Request, res: Response) => {
      res.status(200).json({ status: 'ok' });
    });

    // Bearer token authentication (SEC-01, D-15, D-16)
    // Registered AFTER /mcp/info so all other /mcp routes require a valid Bearer token.
    if (config.mcp.authSecret) {
      const token = generateToken(config.instance.id, config.mcp.authSecret);
      app.use('/mcp', createAuthMiddleware(config.mcp.authSecret));
      logger.info(`MCP auth: Bearer token required for HTTP transport`);
      logger.info(`MCP auth: Generated JWT token for clients:`);
      logger.info(`MCP auth:   Authorization: Bearer ${redactToken(token)}`);
      logger.info(`MCP auth: Alternatively, send the raw secret:`);
      logger.info(`MCP auth:   Authorization: Bearer ${redactToken(config.mcp.authSecret)}`);
    } else {
      logger.warn(
        'WARNING: HTTP transport active without authentication configured. ' +
          'Set mcp.auth_secret in flashquery.yml or MCP_AUTH_SECRET env var. ' +
          'See https://github.com/flashquery/flashquery-core/blob/main/docs/SECURITY-TOKENS.md'
      );
    }

    // POST /mcp — handles new initialization requests and messages for existing sessions
    app.post('/mcp', async (req, res, next) => {
      try {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (sessionId && transports[sessionId]) {
          // Existing session — reuse transport
          await transports[sessionId].handleRequest(req, res, req.body);
        } else if (!sessionId && isInitializeRequest(req.body)) {
          // New session — create transport + server per session (HTTP-05)
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            // Register in callback (not inline) to avoid race condition (Pitfall 1):
            // transport.sessionId is assigned asynchronously during handleRequest.
            onsessioninitialized: (sid) => {
              transports[sid] = transport;
            },
          });

          // Cleanup session map entry when transport closes
          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid && transports[sid]) delete transports[sid];
          };

          const server = createMcpServer(config, version);
          await server.connect(transport);
          await transport.handleRequest(req, res, req.body);
        } else {
          res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: No valid session ID' },
            id: null,
          });
        }
      } catch (err) {
        next(err);
      }
    });

    // GET /mcp — SSE stream for server-initiated notifications
    app.get('/mcp', async (req, res, next) => {
      try {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !transports[sessionId]) {
          res.status(400).send('Invalid or missing session ID');
          return;
        }
        await transports[sessionId].handleRequest(req, res);
      } catch (err) {
        next(err);
      }
    });

    // DELETE /mcp — explicit session termination
    app.delete('/mcp', async (req, res, next) => {
      try {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !transports[sessionId]) {
          res.status(400).send('Invalid or missing session ID');
          return;
        }
        await transports[sessionId].handleRequest(req, res);
      } catch (err) {
        next(err);
      }
    });

    // Global error handler — MUST be registered LAST (after all routes).
    // Express identifies error handlers by 4-parameter arity: (err, req, res, next).
    // Converts all unhandled HTTP errors to consistent JSON format (D-04).
    app.use(createGlobalErrorHandler());

    // Bind to IPv6 dual-stack (::) which accepts both IPv6 and IPv4 on Linux
    // Note: 0.0.0.0 can cause issues on some Linux systems; :: with IPV6_V6ONLY=0 (Linux default)
    // allows both IPv6 and IPv4-mapped connections to work properly
    const port = config.mcp.port ?? 3100;
    const httpServer = await new Promise<http.Server>((resolve, reject) => {
      const server = app.listen(port, '::', () => {
        resolve(server);
      });
      server.on('error', (err) => {
        logger.error(`HTTP server error: ${(err as Error).message}`);
        reject(err);
      });
    });

    logger.info(`MCP server: ready (streamable-http transport on [::]:${port}, dual-stack)`);

    // Return the HTTP server so the caller (index.ts) can pass it to ShutdownCoordinator
    return httpServer;
  }

  // Stdio transport returns undefined (no HTTP server)
  return undefined;
}
