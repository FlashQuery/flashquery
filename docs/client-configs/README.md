# MCP Client Configuration Examples

This directory contains sample configurations for connecting FlashQuery to three AI platforms: Claude Desktop, Claude Code, and Cursor.

## Quick Links

- **Claude Desktop:** stdio transport (recommended) or HTTP transport
- **Claude Code:** CLI method (recommended) or manual .mcp.json method
- **Cursor:** stdio transport (recommended) or HTTP transport

## Understanding Transports

**stdio Transport:**
- MCP client (Claude Desktop, Code, Cursor) spawns FlashQuery as a subprocess
- Best for: local development, single-user setups
- Communication: JSON-RPC over stdin/stdout
- Security: inherent (only accessible to the spawning process)
- Example: Claude Desktop spawns `node /path/to/dist/index.js start --config /path/to/flashquery.yaml`

**HTTP Transport:**
- FlashQuery runs as a standalone server on localhost:3100 (or custom port)
- Best for: Docker deployments, team setups, CI/CD
- Communication: JSON-RPC over HTTP
- Security: DNS rebinding protection + origin header validation
- Example: `curl -X POST http://localhost:3100 -H "Content-Type: application/json" -d '{...}'`

## Choosing a Config

| Use Case | Platform | Transport | Config File |
|----------|----------|-----------|-------------|
| Local dev, Mac/Windows | Claude Desktop | stdio | `claude-desktop-stdio.json` |
| Docker deployment | Claude Desktop | HTTP | `claude-desktop-http.json` |
| Local dev, code editor | Claude Code | stdio | `claude-code-stdio.json` |
| Team/CI setup | Claude Code | HTTP | `claude-code-http.json` |
| Editor integration | Cursor | stdio | `cursor-stdio.json` |
| Docker/team setup | Cursor | HTTP | `cursor-http.json` |

## How to Use

1. Choose the config file that matches your setup (table above)
2. Copy the file to your platform's MCP config location (see platform-specific instructions below)
3. Replace `/path/to/flashquery-core` with your actual path (absolute, not relative)
4. Restart the client
5. FlashQuery tools should appear in your tool list

## Platform-Specific Instructions

### Claude Desktop (macOS & Windows)

Config location:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Steps:
1. Close Claude Desktop
2. Open the config file in a text editor
3. Copy the contents of `claude-desktop-stdio.json` (or http variant) into the file
4. Replace `/path/to/flashquery-core` with your actual path
5. Save and close
6. Reopen Claude Desktop
7. Tools should appear in the tool list

**Important:** Use absolute paths. Relative paths will not resolve (Claude Desktop spawns from its own directory).

### Claude Code

**Option A — CLI (Recommended):**
```bash
claude mcp add --transport stdio flashquery-core -- \
  node /path/to/flashquery-core/dist/index.js \
  start --config /path/to/flashquery.yaml
```

Replace `/path/to/flashquery-core` with your absolute path.

**Option B — Manual .mcp.json:**
1. Create or edit `.mcp.json` in your project root (or `~/.claude.json` for global)
2. Copy the contents of `claude-code-stdio.json` into the file
3. Replace `/path/to/flashquery-core` with your absolute path
4. Restart Claude Code
5. Tools should appear

### Cursor

Config location:
- **Cursor Settings:** Settings > Features > Tools > MCP Server
- Or: Edit `~/.cursor/mcp_servers.json` directly

Steps:
1. Use Settings UI or edit `mcp_servers.json`
2. Add a new MCP server entry with contents of `cursor-stdio.json`
3. Replace `/path/to/flashquery-core` with your absolute path
4. Restart Cursor
5. Tools should appear

## Troubleshooting

**"Tools not appearing in client":**
- Ensure FlashQuery process started successfully: check logs for errors
- Verify path is absolute (not relative)
- Check firewall (if using HTTP transport)
- Restart the AI client

**"fqc: command not found":**
- You're using the wrong transport or path
- stdio: use full path to `dist/index.js` (e.g., `/Users/you/flashquery-core/flashquery-core/dist/index.js`)
- http: ensure `fqc start` is running in another terminal on localhost:3100

**"Connection refused":**
- HTTP transport: Is FlashQuery running? `fqc start --config ./flashquery.yaml` in terminal
- stdio: Does the path exist? `ls /path/to/dist/index.js`

## Advanced: Custom Ports & Hosts

For HTTP transport, you can customize the port in `flashquery.yaml`:
```yaml
mcp:
  transport: streamable-http
  http:
    port: 3100  # Change to custom port
    host: 127.0.0.1
```

Then update the config URL: `http://localhost:YOUR_PORT/...`

---

**Questions?** See [ARCHITECTURE.md](./ARCHITECTURE.md) or [README.md](../README.md) for more info.
