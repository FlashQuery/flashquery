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

FlashQuery runs as an MCP server, so any AI tool that speaks MCP can connect to it. Think of it as "Obsidian for AI workflows": local, yours, composable.

![How FlashQuery works](https://flashquery.ai/assets/img/core/FQC-diagram-sm.jpg)

---

## At a glance

```bash
# Clone and install
git clone https://github.com/FlashQuery/flashquery.git
cd flashquery
npm install

# First time — generates .env, flashquery.yml, and (for the bundled stack) docker/.env.docker
npm run setup

# ── Option A: Bundled Docker stack (Supabase + FlashQuery, everything local) ───────────────────
make up                 # or: docker compose --env-file docker/.env.docker -f docker/docker-compose.yml up -d
# Register with Claude Code — see docs/CLAUDE-CODE-SETUP.md

# ── Option B: Dev mode (database in Docker, FlashQuery on the host for hot reload) ─────────────
make db-up              # or: docker compose --env-file docker/.env.docker -f docker/docker-compose.db-only.yml up -d
npm run dev             # FlashQuery runs locally with hot reload
# Register with Claude Code — see docs/CLAUDE-CODE-SETUP.md

# ── Option C: FlashQuery in Docker, Supabase external/cloud ─────────────────────────────────────
make fq-up              # or: docker compose --env-file docker/.env.docker -f docker/docker-compose.flashquery-only.yml up -d
# Register with Claude Code — see docs/CLAUDE-CODE-SETUP.md

# ── Option D: Supabase Cloud or existing self-hosted (no local Docker needed) ──────────────────
npm run dev             # FlashQuery connects to your external Supabase
# Register with Claude Code — see docs/CLAUDE-CODE-SETUP.md
```

---

## Quick Start

Three steps, regardless of how you're hosting Supabase.

### 1. Clone and install

```bash
git clone https://github.com/FlashQuery/flashquery.git
cd flashquery
npm install
```

Prerequisites: **Node.js 20+** and **git**. If you plan to use the bundled Docker stack, you also need **Docker Desktop** (or Docker Engine + Compose).

### 2. Run setup

```bash
npm run setup
```

The interactive setup script asks you a handful of questions and generates everything you need:

- `./.env` — FlashQuery application config (secrets, instance identity, vault path, embedding provider)
- `./flashquery.yml` — structural config (copied from `flashquery.example.yml`, references `.env` for values)
- `./docker/.env.docker` — **only if** you choose the bundled Docker stack

The first question it asks is how you're running Supabase:

1. **Supabase Cloud** — you have a project at supabase.com. Fastest path; `setup/setup.sh` prompts for your Supabase URL, service role key, and database connection string.
2. **Existing self-hosted Supabase** — you already run Supabase somewhere. Same prompts, with sensible defaults for a local self-hosted instance.
3. **Bundled Docker stack** — run Supabase locally via `docker/docker-compose.yml`. `setup/setup.sh` auto-generates every secret you need (Postgres password, JWT secret, anon and service-role keys) and wires them together.

`setup/setup.sh` is re-runnable. If you later want to change your vault path, log level, or instance name, just run it again — existing values become the defaults for prompts, and it warns you before letting you change anything sensitive (database URL, instance ID, embedding model).

### 3. Start FlashQuery

**Supabase Cloud or self-hosted (no local Docker):**

```bash
npm run dev

# Or build and run the compiled binary:
npm run build
node dist/index.js start --config ./flashquery.yml

# The `flashquery` command is only available globally after: npm install -g flashquery
```

**Bundled Docker stack (everything local):**

```bash
# Start the full stack (Postgres, PostgREST, GoTrue, Kong, Studio, FlashQuery)
make up
# or: docker compose --env-file docker/.env.docker -f docker/docker-compose.yml up -d
```

FlashQuery runs inside the container — no separate `npm run dev` needed. Wait ~20 seconds for all services to be healthy, then check logs to confirm FlashQuery is up:

```bash
make logs
```

FlashQuery will print a bearer token in its container logs. Retrieve it with:

```bash
make logs 2>&1 | grep -i "bearer\|token"
```

Copy that token — you'll use it to connect MCP clients.

On first run, if your vault directory isn't a git repository, `setup/setup.sh` offers to `git init` it for you (the default `flashquery.yml` enables auto-commit, which needs a git repo).

---

## Connect an MCP Client

FlashQuery uses **streamable-http** transport out of the box — no configuration needed. It listens on `http://localhost:3100/mcp` and works with Claude Code, Claude Desktop (modern versions), and any other HTTP-capable MCP client.

### Claude Code

See [`docs/CLAUDE-CODE-SETUP.md`](./docs/CLAUDE-CODE-SETUP.md) for step-by-step registration instructions, prerequisites, and troubleshooting.

### Claude Desktop (stdio fallback)

Streamable-http is the default. If you're on an older Claude Desktop version that doesn't support HTTP MCP, you can fall back to stdio: edit `flashquery.yml`, change `mcp.transport` to `"stdio"`, then add to your Claude Desktop config:

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

Use absolute paths — Claude Desktop spawns processes from its own directory, not yours.

### Cloud / remote deployments

FlashQuery itself doesn't terminate TLS or route by host header. To expose it at a public FQDN (e.g. `fq.yourdomain.com`), run it behind a reverse proxy like Caddy, nginx, or Cloudflare Tunnel. There's one gotcha: disable response buffering in the proxy so streamable-http's server-sent events reach the client in real time. See [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) for worked Caddy / nginx / Cloudflare Tunnel examples and production setup (systemd, launchd, backups, logging).

---

## How configuration works

FlashQuery's config is split across two files for good reasons:

- **`./.env`** holds values that vary between installations — secrets, URLs, your vault path, your instance's name. Gitignored. Every value in here is per-install.
- **`./flashquery.yml`** holds the application's structural config — default behaviors, schema for each section, `${VAR}` references into `.env`. Safe to read; can be committed if you want.

If you chose the bundled Docker stack at setup time, there's also a **`./docker/.env.docker`** holding Docker-orchestration values (Postgres password, JWT secret, anon key, service-role key). This file is specifically for the Docker stack — the FlashQuery app itself reads `./.env`.

See [`.env.example`](./.env.example) and [`flashquery.example.yml`](./flashquery.example.yml) for the full list of values with inline comments explaining each one.

## Known Limitations

### Symlinks in Vault

FlashQuery does not follow symbolic links in your vault. Symlinks are skipped during scanning; original files sync normally. Symlink handling is unreliable on network filesystems (NFS, SMB) and in containerized environments, so this limitation is deliberate. The scanner logs skipped symlinks at INFO level.

### Multiple Instances on Same Vault

Running two FlashQuery instances against the same vault simultaneously can lead to race conditions on document updates and stale plugin table references. Recommendation: one instance per vault. Multi-instance coordination is planned for v2.1.

### Plugin Table Consistency

Plugin tables reference documents by `fqc_id`. The periodic scanner and MCP tools both keep these up to date; in rare cases (external file edits stripping frontmatter) references can be temporarily orphaned. Run `fqc scan` to recover. File watcher support is planned for v2.1.

For technical details on all three, see [ARCHITECTURE.md § Plugin Propagation Design](./docs/ARCHITECTURE.md#plugin-propagation-design).

## Further Reading

- [**flashquery-plugins**](https://github.com/FlashQuery/flashquery-plugins) — Claude skills and demo apps that showcase what FlashQuery can do
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — system design, data flow, the four base deployment paths
- [`docs/CLAUDE-CODE-SETUP.md`](./docs/CLAUDE-CODE-SETUP.md) — registering FlashQuery with Claude Code
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) — production deployment: reverse proxy, service supervision (systemd / launchd), backups, logging
- [`docs/SECURITY-TOKENS.md`](./docs/SECURITY-TOKENS.md) — bearer token authentication, token lifetime configuration, troubleshooting
- [`tests/scenarios/README.md`](./tests/scenarios/README.md) — scenario testing framework (behaviors, writing new tests, running the suite)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — development setup, test commands, PR guidelines
- [`CHANGELOG.md`](./CHANGELOG.md) — release history

## Development Commands

### Application

```bash
npm run setup            # Interactive first-time setup (generates .env + flashquery.yml)
npm run dev              # Run FlashQuery with hot reload (reads ./flashquery.yml)
npm run dev:test         # Run with .env.test credentials (for manual integration testing)
npm run build            # Compile TypeScript to dist/ via tsup
npm run start            # Run the compiled binary (after npm run build)
```

### Testing

```bash
npm test                 # Unit tests (fast, no external deps)
npm run test:watch       # Unit tests in watch mode
npm run test:integration # Integration tests (requires Supabase via .env.test)
npm run test:e2e         # End-to-end tests (spawns FlashQuery as subprocess)
npm run test:benchmark   # Performance benchmarks (vault discovery, search throughput)
```

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
make fq-up     # Start in background
make fq-down   # Stop
make fq-logs   # Tail logs
make fq-status # Show container status
make fq-build  # Build image
make fq-rebuild # Force rebuild with no cache
make fq-shell  # Open a shell in the container
make fq-watch  # Start in foreground (logs stream to terminal)
```

**Database only** (Postgres + pgvector; FlashQuery runs locally via `npm run dev`):

```bash
make db-up     # Start in background
make db-down   # Stop
make db-logs   # Tail logs
make db-status # Show container status
```
