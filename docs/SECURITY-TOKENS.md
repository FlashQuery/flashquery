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
  token_lifetime: 24
```

FlashQuery's config loader expands `${MCP_AUTH_SECRET}` from your environment at startup. This aligns with SEC-02: the signing secret is stored in `.env` as an environment variable, not hardcoded in config. The `auth_secret` field supports `${ENV_VAR}` syntax for all environment-based secret management scenarios. `token_lifetime` controls the `expires_in` value returned by `POST /token` (default `24`, minimum `1`, maximum `8760` hours).

## Token Generation

FlashQuery exposes `POST /token` to issue OAuth-style bearer tokens. Send HTTP Basic Auth where the username can be any non-empty value and the password is the configured `MCP_AUTH_SECRET`:

```bash
AUTH_BASIC=$(echo -n "client:$MCP_AUTH_SECRET" | base64 | tr -d '\n')

curl -s -X POST http://127.0.0.1:3100/token \
  -H "Authorization: Basic $AUTH_BASIC" \
  -H "Content-Type: application/json" \
  -d '{}'
```

The response includes an access token and refresh token:

```json
{
  "access_token": "eyJhbGciOi...",
  "refresh_token": "eyJhbGciOi...",
  "token_type": "Bearer",
  "expires_in": 86400,
  "scope": ""
}
```

On startup, FlashQuery also logs redacted auth guidance:

```
[INFO] MCP auth: Bearer token required for HTTP transport
[INFO] MCP auth: Generated JWT token for clients:
[INFO] MCP auth:   Authorization: Bearer eyJhbGci***
[INFO] MCP auth: Alternatively, send the raw secret:
[INFO] MCP auth:   Authorization: Bearer ***
```

The log is for confirmation and troubleshooting; use `POST /token` or the setup script when configuring HTTP MCP clients.

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
3. Fetch a fresh token from `POST /token`
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
- **Token endpoint:** `POST /token` supports HTTP Basic Auth and an authorization-code grant used by compatible clients
- **Legacy compatibility:** raw `MCP_AUTH_SECRET` is still accepted as `Authorization: Bearer <secret>`
- **Validation:** Constant-time signature comparison via `crypto.timingSafeEqual`
- **No external dependencies:** Uses Node.js built-in `node:crypto` module
- **Config expansion:** `auth_secret` supports `${ENV_VAR}` syntax for environment-based secret management
