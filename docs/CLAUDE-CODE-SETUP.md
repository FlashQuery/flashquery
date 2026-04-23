# Connecting FlashQuery to Claude Code

This guide covers how to register a running FlashQuery instance as an MCP server with Claude Code so you can use FlashQuery's tools directly in your Claude Code sessions.

## Prerequisites

1. **FlashQuery running.** The server must be up and reachable before registration — the script fetches a bearer token from the live instance.

   ```bash
   npm run dev
   # or, after building: node dist/index.js start --config ./flashquery.yml
   ```

2. **`.env` with `MCP_AUTH_SECRET`.** `setup/setup.sh` generates this automatically. If you set up manually, run `openssl rand -hex 32` and add `MCP_AUTH_SECRET=<result>` to `.env`.

3. **Claude Code CLI installed.**

   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

4. **`curl` and `jq` installed.** Both are typically pre-installed on macOS and most Linux distributions.

---

## Register FlashQuery with Claude Code

```bash
./setup/setup-claude-mcp.sh
```

Or with a custom host or port:

```bash
./setup/setup-claude-mcp.sh 192.168.1.100 3100
```

The script will:
1. Read `MCP_AUTH_SECRET` from `.env`
2. Fetch a bearer token from `POST /token` on the running FlashQuery instance
3. Run `claude mcp add flashquery http://localhost:3100/mcp -t http -H "Authorization: Bearer <token>"`

On success it prints confirmation and tells you to restart Claude Code to load the new configuration.

---

## Token lifetime

FlashQuery bearer tokens are valid until `MCP_AUTH_SECRET` is rotated — they do not expire on a time limit. Once Claude Code stores the token, the registration persists indefinitely. You only need to re-run `./setup/setup-claude-mcp.sh` if you change `MCP_AUTH_SECRET` (e.g., you ran `setup/setup.sh` again and a new secret was generated, or you manually rotated it for security reasons).

---

## Verification

After registration, restart Claude Code. Then check the config:

```bash
cat ~/.claude/claude.json | jq '.mcpServers'
```

You should see a `flashquery` entry with the MCP URL and Authorization header. In a Claude Code session, FlashQuery tools will be available immediately.

---

## Troubleshooting

**`curl: (7) Failed to connect`** — FlashQuery is not running. Start it with `npm run dev` and try again.

**`401 Unauthorized` when fetching a token** — `MCP_AUTH_SECRET` in `.env` doesn't match the secret FlashQuery started with. Verify the values match, or re-run `npm run setup` and then `./setup/setup-claude-mcp.sh`.

**`claude: command not found`** — Claude Code CLI is not installed. Run `npm install -g @anthropic-ai/claude-code`.

**`base64: invalid option -- w`** — The script has a built-in fallback for systems where `base64 -w 0` is not supported. If you see this error, the fallback should have triggered automatically. If it didn't, run the manual command below.

---

## Manual registration (if the script fails)

```bash
# 1. Load your auth secret
source .env

# 2. Generate base64 without line wrapping (Linux)
AUTH_BASIC=$(echo -n "client:$MCP_AUTH_SECRET" | base64 -w 0)
# or on macOS:
AUTH_BASIC=$(echo -n "client:$MCP_AUTH_SECRET" | base64 | tr -d '\n')

# 3. Fetch a bearer token
TOKEN=$(curl -s -X POST http://localhost:3100/token \
  -H "Authorization: Basic $AUTH_BASIC" \
  -H "Content-Type: application/json" \
  -d '{}' | jq -r '.access_token')

# 4. Register with Claude Code
claude mcp add flashquery http://localhost:3100/mcp \
  -t http \
  -s user \
  -H "Authorization: Bearer $TOKEN"
```

---

## Related

- [`setup/setup-claude-mcp.sh`](../setup/setup-claude-mcp.sh) — the script this guide documents
- [`docs/SECURITY-TOKENS.md`](./SECURITY-TOKENS.md) — bearer token authentication internals
- [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md) — deploying FlashQuery behind a reverse proxy (for remote access)
- [`docs/client-configs/README.md`](./client-configs/README.md) — configuration examples for other MCP clients
