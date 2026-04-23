# FlashQuery — Deployment Guide

This guide covers production and semi-production deployment concerns for FlashQuery: running it as a managed service, exposing it to the public internet via a reverse proxy, backing it up, and the reality of what the "FlashQuery binary" is (and isn't) today.

For **how to get started quickly** — local dev, Docker Compose bundled stack, or pointing at Supabase Cloud — see the [README](../README.md) and the Quick Start there.

For **the full set of deployment paths** (Full Docker, DB-Only Docker, Manual Postgres, Standalone), see [ARCHITECTURE.md § Deployment Paths](./ARCHITECTURE.md#deployment-paths). This guide builds on those and is specifically about what changes when you move a working install into production.

## Table of Contents

- [Choosing a deployment path](#choosing-a-deployment-path)
- [What "the FlashQuery binary" actually is](#what-the-flashquery-binary-actually-is)
- [Running as a managed service](#running-as-a-managed-service)
  - [systemd (Linux)](#systemd-linux)
  - [launchd (macOS)](#launchd-macos)
  - [Docker (any OS)](#docker-any-os)
- [Exposing FlashQuery behind a reverse proxy](#exposing-flashquery-behind-a-reverse-proxy)
  - [Why you want a reverse proxy in front](#why-you-want-a-reverse-proxy-in-front)
  - [Prerequisites](#prerequisites)
  - [Caddy (simplest)](#caddy-simplest)
  - [nginx (most common in production)](#nginx-most-common-in-production)
  - [Cloudflare Tunnel](#cloudflare-tunnel)
  - [The response-buffering gotcha](#the-response-buffering-gotcha)
  - [Bearer tokens through the proxy](#bearer-tokens-through-the-proxy)
- [Backup and recovery](#backup-and-recovery)
- [Logging and observability](#logging-and-observability)
- [Related documentation](#related-documentation)

---

## Choosing a deployment path

FlashQuery supports four base deployment shapes (detailed in [ARCHITECTURE.md](./ARCHITECTURE.md#deployment-paths)):

| Path | Supabase lives | FlashQuery lives | Good for |
|------|----------------|-------------------|----------|
| **Full Docker** | Bundled in `docker/` | Bundled container | Self-hosted single-box deployments |
| **DB-Only Docker** | Bundled Postgres+pgvector | Runs directly on host | Developers who want to debug FlashQuery easily |
| **Manual Postgres** | External (Supabase Cloud or self-managed) | Runs directly on host | Production with managed DB |
| **Standalone** | None — file-based | Runs directly on host | Demos only; memories don't persist |

This deployment guide is mostly about layering production concerns (a reverse proxy, process supervision, backups) on top of one of these. Pick the path that matches your environment from ARCHITECTURE.md first, then come back here.

---

## What "the FlashQuery binary" actually is

This is worth stating plainly because the language in various docs has been imprecise.

**There is no standalone static binary today.** FlashQuery does not ship as a single-file executable — nothing produced by tools like `pkg`, Node SEA (single-executable application), or similar.

What exists:

- **`npm run build`** runs tsup over `src/index.ts` and produces `dist/index.js` — a bundled ESM JavaScript module. You still need Node.js 20+ installed on the target machine to run it.
- **`package.json`'s `"bin"` field** exposes the `flashquery` CLI command, which becomes available on your PATH when the package is installed globally (via `npm install -g flashquery`). This is just `dist/index.js` with a shebang; it calls into Node.
- **`flashquery start --config ./flashquery.yml`** is the normal way to run it once installed. `npm run dev` (during development) and `node dist/index.js start --config ./flashquery.yml` (after a build) do the same thing.

Practically, this means any production deployment needs Node.js on the host. If you want a true single-file binary in the future (for air-gapped or minimal-image deployments), that's a separate build target — Node SEA is the most likely path, but it isn't set up yet.

---

## Running as a managed service

FlashQuery itself doesn't daemonize or fork. Use your OS's service manager (systemd, launchd, Docker, etc.) to supervise it.

### systemd (Linux)

Create `/etc/systemd/system/flashquery.service`:

```ini
[Unit]
Description=FlashQuery
After=network.target
# If your Supabase is on the same host via Docker, also wait for it:
# After=docker.service
# Requires=docker.service

[Service]
Type=simple
User=flashquery
Group=flashquery
WorkingDirectory=/opt/flashquery
EnvironmentFile=/opt/flashquery/.env
ExecStart=/usr/bin/node /opt/flashquery/dist/index.js start --config /opt/flashquery/flashquery.yml
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# Hardening (optional but recommended)
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/flashquery/vault /opt/flashquery/logs

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo useradd --system --home /opt/flashquery --shell /usr/sbin/nologin flashquery
sudo chown -R flashquery:flashquery /opt/flashquery
sudo systemctl daemon-reload
sudo systemctl enable --now flashquery
sudo journalctl -u flashquery -f   # tail the logs
```

Notes:

- `EnvironmentFile` loads your `.env` directly into the service environment. The service doesn't need to `cd` into the working directory to pick it up.
- The `ReadWritePaths` hardening restricts writes to only the vault and log directories — adjust if you've configured alternate paths.
- If you're using the bundled Docker Supabase stack, make the service depend on `docker.service` so Supabase comes up first.

### launchd (macOS)

Create `~/Library/LaunchAgents/dev.flashquery.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>dev.flashquery</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/you/flashquery/dist/index.js</string>
        <string>start</string>
        <string>--config</string>
        <string>/Users/you/flashquery/flashquery.yml</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/you/flashquery</string>
    <key>EnvironmentVariables</key>
    <dict>
        <!-- launchd doesn't natively load .env files; paste key vars here,
             or wrap ProgramArguments in a shell script that sources .env -->
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/you/flashquery/logs/flashquery.stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/you/flashquery/logs/flashquery.stderr.log</string>
</dict>
</plist>
```

Then:

```bash
launchctl load ~/Library/LaunchAgents/dev.flashquery.plist
launchctl start dev.flashquery
tail -f ~/flashquery-core/logs/flashquery.stdout.log
```

launchd doesn't load `.env` files automatically. Either list the environment variables inline in the plist, or wrap `node …` in a tiny shell script that `source`s the `.env` before exec'ing.

### Docker (any OS)

The bundled `docker-compose.yml` already has `restart: unless-stopped` on the FlashQuery container, so supervision is handled. Use this path when you want consistent service management across hosts without dealing with systemd or launchd.

---

## Exposing FlashQuery behind a reverse proxy

This is the expected way to expose FlashQuery on a public FQDN like `fq.yourdomain.com`.

### Why you want a reverse proxy in front

FlashQuery:

- Doesn't terminate TLS. It speaks plain HTTP on its configured port.
- Doesn't route by host header. It serves any request that reaches it, regardless of the domain name used.
- Doesn't implement per-client rate limits, IP allowlists, WAF rules, or centralized request logging.

A reverse proxy (Caddy, nginx, Cloudflare Tunnel, HAProxy, etc.) handles all of that and forwards clean HTTP requests to FlashQuery on an internal port that isn't exposed to the public internet.

### Prerequisites

- FlashQuery running and healthy on an internal port (default `3100`) — verify with `curl http://localhost:3100/health` before you touch any proxy config.
- The port FlashQuery is bound to is **not reachable from the public internet** — firewall it off, or bind only to the loopback interface by putting FlashQuery behind Docker's default bridge network.
- DNS for your FQDN pointed at the host running the proxy.
- A way to obtain TLS certificates (Caddy handles this automatically; nginx typically uses certbot).

### Caddy (simplest)

Caddy auto-provisions Let's Encrypt certificates and disables response buffering by default in the config below.

```caddy
fq.yourdomain.com {
    reverse_proxy localhost:3100 {
        # Pass the bearer token through unchanged
        header_up Authorization {http.request.header.Authorization}

        # Disable response buffering so streamable-http server-sent events
        # reach the client in real time
        flush_interval -1
    }
}
```

Start Caddy with that Caddyfile and FlashQuery is reachable at `https://fq.yourdomain.com/mcp` with a valid TLS certificate within 60 seconds.

### nginx (most common in production)

nginx needs explicit configuration for the streaming case. A minimal working config:

```nginx
server {
    listen 443 ssl http2;
    server_name fq.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/fq.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/fq.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;

        # Pass bearer tokens and forwarding headers through
        proxy_set_header Authorization $http_authorization;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Critical: disable buffering so server-sent events stream through
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
    }
}
```

Redirect port 80 to 443 with a second `server` block if you want clean HTTP → HTTPS redirects.

### Cloudflare Tunnel

Cloudflare Tunnel is a good option when you don't want to expose any port on your host at all — the tunnel agent makes an outbound connection to Cloudflare and Cloudflare forwards incoming HTTPS requests through it.

A minimal `config.yml` for `cloudflared`:

```yaml
tunnel: <your-tunnel-id>
credentials-file: /etc/cloudflared/<tunnel-id>.json

ingress:
  - hostname: fq.yourdomain.com
    service: http://localhost:3100
    originRequest:
      # Stream server-sent events without buffering
      disableChunkedEncoding: false
      noTLSVerify: true  # only if FlashQuery is on the same host
  - service: http_status:404
```

On some Cloudflare plan tiers, the edge proxy buffers response bodies by default. Verify streaming works end-to-end with a real MCP client before you commit to this path in production.

### The response-buffering gotcha

This is the single most common cause of "FlashQuery works locally but the remote MCP client just hangs."

FlashQuery's streamable-http transport uses server-sent events for some tool responses. The client expects bytes to arrive as they're produced. If anything in the path (the proxy, a CDN, a load balancer) buffers the response body until EOF, the client sees nothing until the full response completes — which might be seconds or never, depending on what the tool is doing.

The fix is configuration-level in every proxy that supports it:

- **Caddy**: `flush_interval -1` in the `reverse_proxy` block.
- **nginx**: `proxy_buffering off` and `proxy_cache off` in the `location` block.
- **Cloudflare**: verify your plan doesn't buffer; consider their non-buffering "full" proxy mode if available.
- **HAProxy**: `option http-no-delay` or similar; check current docs.

When in doubt, test with an MCP client that uses streaming responses (Claude Code, Claude Cowork) rather than a curl command — streaming-sensitive clients surface the problem immediately.

### Bearer tokens through the proxy

FlashQuery authenticates with HMAC-SHA256-signed JWT bearer tokens (details in [docs/SECURITY-TOKENS.md](./SECURITY-TOKENS.md)). Token verification happens inside FlashQuery — the proxy's only job is to forward the `Authorization: Bearer <token>` header unchanged.

Don't:

- Terminate or transform tokens at the proxy.
- Strip the `Authorization` header.
- Add per-proxy auth (basic auth, IP allowlists that break localhost) on top of the token without adjusting clients to match.

If you want an additional security layer in front of the bearer token, put it at the network level (VPN, WireGuard, Tailscale, IP allowlist for specific client IPs). The bearer token is FlashQuery's contract; anything else is bonus.

---

## Backup and recovery

FlashQuery ships a `flashquery backup` CLI command that writes a JSON snapshot of every FlashQuery table to `<vault>/.fqc/backup.json` and commits it to the vault's git repo if one exists.

Run it on a schedule via cron or launchd. Example nightly-at-2am cron entry:

```cron
0 2 * * * /usr/local/bin/flashquery backup --config /opt/flashquery/flashquery.yml
```

Use `--db-only` to skip the full vault commit+tag if you only want the database snapshot.

Recovery from a backup is a manual operation today — stop FlashQuery, restore the JSON into Supabase with `psql` or a custom script, and restart. A guided `flashquery restore` command is on the roadmap.

---

## Logging and observability

FlashQuery logs to stdout by default (`logging.output: "stdout"` in `flashquery.yml`). For production:

- **systemd**: stdout goes to the journal — query with `journalctl -u flashquery`.
- **launchd**: redirect stdout/stderr to files via the plist's `StandardOutPath` / `StandardErrorPath`.
- **Docker**: `docker logs flashquery-core` or integrate with your log-collection stack (Loki, ELK, CloudWatch, etc.).

If you prefer file-based logging:

```yaml
logging:
  level: info
  output: file
  file: /var/log/flashquery/flashquery.log
```

Log rotation is your responsibility — FlashQuery doesn't rotate its own file logs. Use `logrotate` on Linux or `newsyslog` on macOS.

There are no Prometheus metrics or structured-tracing endpoints today. If you need those, they're a roadmap item.

---

## Related documentation

- [README](../README.md) — getting started in under five minutes
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design and the four deployment paths this guide builds on
- [docs/SECURITY-TOKENS.md](./SECURITY-TOKENS.md) — bearer token generation, lifetime, troubleshooting
- [`.env.example`](../.env.example) and [`flashquery.example.yml`](../flashquery.example.yml) — annotated config templates
