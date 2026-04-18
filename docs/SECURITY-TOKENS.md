# Bearer Token Authentication

FlashQuery supports Bearer token authentication for the HTTP (streamable-http) transport. This protects remote MCP tool invocations from unauthorized access.

## Overview

- **Stdio transport:** No authentication needed (local IPC, inherently secure)
- **HTTP transport:** Optional Bearer token authentication via `Authorization: Bearer <token>` header

## Configuration

### Step 1: Generate a signing secret

Generate a secure random secret (HMAC-SHA256, 64 hex chars):

```bash
openssl rand -hex 32
```

### Step 2: Store in environment

Add the secret to your `.env` file (never commit this file):

```bash
# .env
MCP_AUTH_SECRET=<your-64-char-hex-secret>
```

### Step 3: Reference in flashquery.yml via env var expansion

```yaml
mcp:
  transport: streamable-http
  port: 3100
  auth_secret: ${MCP_AUTH_SECRET}
```

FlashQuery's config loader expands `${MCP_AUTH_SECRET}` from your environment at startup. This aligns with SEC-02: the signing secret is stored in `.env` as an environment variable, not hardcoded in config. The `auth_secret` field supports `${ENV_VAR}` syntax for all environment-based secret management scenarios.

## Token Generation

On startup, FlashQuery generates a JWT token using HMAC-SHA256 from the resolved `auth_secret` and logs it:

```
[INFO] MCP auth: Bearer token required for HTTP transport
[INFO] MCP auth: Token for clients: eyJhbGciOi...
```

Copy this token and configure your MCP client with it.

## Using the Token

Include the token in every HTTP request to FlashQuery:

```bash
curl -X POST http://127.0.0.1:3100/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOi..." \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{...},"id":1}'
```

## Token Rotation

To rotate the token:

1. Change `MCP_AUTH_SECRET` environment variable (or `mcp.auth_secret` value)
2. Restart FlashQuery
3. Copy the new token from startup logs
4. Update all MCP clients with the new token

The old token is immediately invalid after restart.

## Security Best Practices

1. **Never hardcode secrets** in `flashquery.yml` — use `${MCP_AUTH_SECRET}` env var syntax
2. **Never commit secrets** to version control — add `.env` to `.gitignore`
3. **Use HTTPS in production** if FlashQuery is exposed beyond localhost (reverse proxy with TLS)
4. **Rotate tokens regularly** by changing the secret and restarting
5. **Monitor auth failures** — FlashQuery logs invalid token attempts at INFO level

## No Authentication Warning

If HTTP transport is enabled without `auth_secret`, FlashQuery logs:

```
[WARN] WARNING: HTTP transport active without authentication configured.
```

This is a security risk. Configure `auth_secret` for any non-local deployment.

## Technical Details

- **Algorithm:** HMAC-SHA256 (HS256)
- **Token format:** JWT (header.payload.signature, base64url encoded)
- **Token payload:** `{ instance_id, issued_at, version: 1 }` — no expiry claim
- **Validation:** Constant-time signature comparison via `crypto.timingSafeEqual`
- **No external dependencies:** Uses Node.js built-in `node:crypto` module
- **Config expansion:** `auth_secret` supports `${ENV_VAR}` syntax for environment-based secret management
