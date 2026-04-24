[![Build Status](https://github.com/FlashQuery/flashquery/actions/workflows/ci.yml/badge.svg)](https://github.com/FlashQuery/flashquery/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![Node >= 20](https://img.shields.io/badge/Node-20+-brightgreen.svg)](./.nvmrc)

# FlashQuery

Local-first data management layer for AI workflows — save and search memories, documents, and relational data owned entirely by you.

**[flashquery.ai/open](https://flashquery.ai/open)** &nbsp;·&nbsp; [Plugins & demos](https://github.com/FlashQuery/flashquery-plugins) &nbsp;·&nbsp; [Architecture](./docs/ARCHITECTURE.md) &nbsp;·&nbsp; [Deployment](./docs/DEPLOYMENT.md) &nbsp;·&nbsp; [Contributing](./CONTRIBUTING.md)

---

## What it is

FlashQuery is a persistent data layer for AI workflows. It sits between AI tools (Claude, Cursor, ChatGPT) and your data, managing three things:

- **Memories** — semantic, searchable summaries of conversations, indexed with vector embeddings.
- **Documents** — markdown files in a vault you own and can version in Obsidian.
- **Relational records** — structured data in your Supabase instance (via plugins).

Every interaction an AI has with FlashQuery is logged and searchable. When Claude asks for "memories about the project," FlashQuery retrieves relevant stored summaries using vector search. When it creates a new meeting note, the note is saved both to your vault (as markdown) and indexed in the database. You own all of it — no vendor lock-in, no training on your data.

FlashQuery exposes its tools via [MCP (Model Context Protocol)](https://modelcontextprotocol.io), Anthropic's open standard for connecting AI assistants to external data and services. Any MCP-capable client — Claude Code, Claude Desktop, Cursor — can connect to it. Think of it as "Obsidian for AI workflows": local, yours, composable.

![How FlashQuery works](https://flashquery.ai/assets/img/core/FQC-diagram-sm.jpg)

---

## Quick Start

This walks you from `git clone` to FlashQuery tools available inside Claude Code. Takes about 5 minutes.

### Before you begin

You need:

- **Node.js 20+** and **git**
- **A database** — pick one:
  - **Supabase Cloud** — free project at [supabase.com](https://supabase.com), nothing to install
  - **Bundled Docker stack** — Docker Desktop (or Engine + Compose) is all you need;  FlashQuery's setup can provision Supabase for you automatically
  - **Existing self-hosted Supabase** — if you already run one
- An **embedding API key** (OpenAI or OpenRouter) — or a local [Ollama](https://ollama.ai) instance, or choose `none` to disable semantic search entirely

> **Node.js 18:** Will install and start FlashQuery but `npm install` shows an `EBADENGINE` warning and `supabase-js` logs a runtime deprecation notice. Node 20 LTS is required for supported operation.

### 1. Clone and install

```bash
git clone https://github.com/FlashQuery/flashquery.git
cd flashquery
npm install
```

### 2. Run setup

```bash
npm run setup
```

The interactive script asks a handful of questions and writes three files:

| File | Purpose |
|---|---|
| `.env` | Secrets, URLs, vault path, instance identity — gitignored, per-install |
| `flashquery.yml` | Structural config and defaults — safe to read and commit |
| `.env.test` | Test credentials synced from `.env` — gitignored, used by `npm run test:integration` |
| `docker/.env.docker` | Generated only when you choose the bundled Docker stack |

The first question picks your Supabase backend:

1. **Supabase Cloud** — project at supabase.com. Fastest path. Prompts for your URL, service role key, and database connection string.
2. **Existing self-hosted** — a Supabase instance you already run. Same prompts.
3. **Bundled Docker stack** — generates all secrets and wires up Supabase locally. Requires Docker Desktop or Docker Engine + Compose.

`npm run setup` is safe to re-run at any time. Existing values become defaults; it warns before letting you change anything sensitive (database URL, instance ID, embedding model).

### 3. Start FlashQuery

**Supabase Cloud or self-hosted (options 1 and 2):**

```bash
npm run dev
```

**Bundled Docker stack (option 3 — starts Supabase and FlashQuery together):**

```bash
make up
# Wait ~20 seconds for all services to be healthy, then verify:
make logs
```

In both cases you'll see `FlashQuery ready.` in the output when the server is up.

### 4. Register with Claude Code

```bash
./setup/setup-claude-mcp.sh
```

The script reads `MCP_AUTH_SECRET` from `.env`, fetches a bearer token from the running server, and calls `claude mcp add` for you. Once it succeeds, restart Claude Code.

Verify the registration:

```bash
claude mcp list
```

You should see `flashquery` listed with the MCP URL. FlashQuery tools are now available in every Claude Code session.

> **Token note:** Startup logs show a masked token (`Bearer eyJhbGci***`) for confirmation only. The full usable secret is `MCP_AUTH_SECRET` in `.env` and is accepted directly as a Bearer token by all FlashQuery endpoints.

---

## Deployment Options

Four ways to run, depending on what you already have:

```bash
# A — Docker full local stack: Supabase + FlashQuery are in the one docker compose file (easiest)
make up

# B — Dev mode: Supabase in Docker, FlashQuery on the host with hot reload
make db-up && npm run dev

# C — FlashQuery in Docker, Supabase external or cloud
make fq-up

# D — No Docker: FlashQuery on the host, Supabase Cloud or existing self-hosted
npm run dev
```

Run `make help` to see all available targets. For production deployment (reverse proxy, TLS, systemd/launchd, backups): [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

---

## Connect an MCP Client

FlashQuery uses **streamable-http** transport by default, listening on `http://localhost:3100/mcp`.

### Claude Code

```bash
./setup/setup-claude-mcp.sh
```

See [`docs/CLAUDE-CODE-SETUP.md`](./docs/CLAUDE-CODE-SETUP.md) for custom host/port, manual registration steps, and troubleshooting.

### Claude Desktop (stdio fallback)

Streamable-http works with modern Claude Desktop versions. If you're on an older build that doesn't support HTTP MCP, fall back to stdio: set `mcp.transport: "stdio"` in `flashquery.yml`, then add to your Claude Desktop config:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "flashquery": {
      "command": "node",
      "args": [
        "/absolute/path/to/flashquery/dist/index.js",
        "start",
        "--config",
        "/absolute/path/to/flashquery/flashquery.yml"
      ]
    }
  }
}
```

Use absolute paths — Claude Desktop spawns processes from its own working directory, not yours.

### Cloud / remote deployments

FlashQuery doesn't terminate TLS or route by host header. To expose it at a public URL, put it behind Caddy, nginx, or Cloudflare Tunnel. Disable response buffering in the proxy so streamable-http's server-sent events reach clients in real time. See [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) for worked Caddy, nginx, and Cloudflare Tunnel examples.

---

## How Configuration Works

Config is split across two files deliberately:

- **`.env`** — everything that varies per install: secrets, URLs, vault path, instance identity. Gitignored.
- **`flashquery.yml`** — structural config and defaults. References `.env` via `${VAR}`. Safe to commit.

If you chose the bundled Docker stack, there's also **`docker/.env.docker`** — orchestration values (Postgres password, JWT secret, anon/service-role keys) used only by the Docker Compose stack. The FlashQuery app itself reads `.env`.

See [`.env.example`](./.env.example) and [`flashquery.example.yml`](./flashquery.example.yml) for all available values with inline documentation.

### Non-interactive setup

For CI or scripted installs, pass a pre-filled answers file to skip all prompts:

```bash
npm run setup -- --answers-file /path/to/answers.env
```

The file is `KEY=value` format (lines starting with `#` are ignored). Any key omitted falls back to its default. Example for Supabase Cloud:

```ini
SUPABASE_CHOICE=1          # 1=Cloud  2=self-hosted  3=bundled Docker
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
DATABASE_URL=postgresql://postgres:...@db.xxx.supabase.co:5432/postgres
INSTANCE_NAME=My FlashQuery
VAULT_PATH=./vault
EMBEDDING_PROVIDER=openai  # openai | openrouter | ollama | none
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_API_KEY=sk-...
LOG_LEVEL=info
```

---

## Known Limitations

**Symlinks in vault** — FlashQuery does not follow symbolic links. Symlinks are skipped during scanning; original files sync normally. Symlink handling is unreliable on network filesystems (NFS, SMB) and in containers, so this is deliberate.

**Multiple instances on the same vault** — Concurrent writes from two instances can cause race conditions on document updates and stale plugin table references. One instance per vault is recommended. Multi-instance coordination is planned for v2.1.

**Plugin table consistency** — Plugin tables reference documents by `fqc_id`. In rare cases (external file edits that strip frontmatter) references can be temporarily orphaned. Run `fqc scan` to recover. File watcher support is planned for v2.1.

For technical details on all three: [ARCHITECTURE.md § Plugin Propagation Design](./docs/ARCHITECTURE.md#plugin-propagation-design).

---

## Further Reading

**Using FlashQuery**
- [**flashquery-plugins**](https://github.com/FlashQuery/flashquery-plugins) — Claude skills and demo apps that showcase what FlashQuery can do
- [`docs/CLAUDE-CODE-SETUP.md`](./docs/CLAUDE-CODE-SETUP.md) — Claude Code registration, token management, troubleshooting
- [`docs/SECURITY-TOKENS.md`](./docs/SECURITY-TOKENS.md) — bearer token internals and lifetime configuration

**Operating FlashQuery**
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) — reverse proxy, TLS, systemd/launchd, backups, logging
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — system design, data flow, the four deployment paths

**Contributing**
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — development setup, test commands, PR guidelines
- [`tests/scenarios/README.md`](./tests/scenarios/README.md) — scenario testing framework
- [`CHANGELOG.md`](./CHANGELOG.md) — release history

---

## Development Commands

### Application

```bash
npm run setup            # Interactive first-time setup (generates .env + flashquery.yml)
npm run dev              # Development: run TypeScript directly via tsx, hot-reloads on file changes
npm run dev:test         # Same as dev but using .env.test credentials (manual integration testing)
npm run build            # Compile TypeScript to dist/ via tsup (required before npm run start)
npm run start            # Production: run the compiled dist/ binary — same behavior as dev, no hot reload; use for PM2/systemd
```

### Testing

```bash
npm test                 # Unit tests (fast, no external deps)
npm run test:watch       # Unit tests in watch mode
npm run test:integration # Integration tests (requires Supabase via .env.test)
npm run test:e2e         # End-to-end tests (spawns FlashQuery as subprocess)
npm run test:benchmark   # Performance benchmarks (vault discovery, search throughput)
```

The `tests/scenarios/` directory contains a higher-level test suite: directed tests in Python (`directed/`) and YAML-driven integration tests (`integration/`), run by a Python runner script. See [`tests/scenarios/README.md`](./tests/scenarios/README.md).

### Code Quality

```bash
npm run lint             # ESLint — zero warnings policy
npm run format           # Auto-format with Prettier
npm run format:check     # Check formatting without writing
```

### Docker

Docker operations use `make` from the repo root. Run `make help` to see all targets.

**Full stack** (Postgres + Supabase services + FlashQuery):

```bash
make up        # Start in background
make down      # Stop
make restart   # Restart all containers
make logs      # Tail all logs
make status    # Show container health and ports
make build     # Build FlashQuery image
make rebuild   # Force rebuild with no cache
make shell     # Open a shell in the FlashQuery container
make clean     # Stop and remove all volumes  ⚠ wipes data
```

**FlashQuery only** (connect to external/cloud Supabase):

```bash
make fq-up      # Start in background
make fq-down    # Stop
make fq-logs    # Tail logs
make fq-status  # Show container status
make fq-build   # Build image
make fq-rebuild # Force rebuild with no cache
make fq-shell   # Open a shell in the container
make fq-watch   # Start in foreground (logs stream to terminal)
```

**Database only** (Postgres + pgvector; FlashQuery runs locally via `npm run dev`):

```bash
make db-up     # Start in background
make db-down   # Stop
make db-logs   # Tail logs
make db-status # Show container status
```
