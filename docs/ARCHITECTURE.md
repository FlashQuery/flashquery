# FlashQuery — Architecture

**Version:** 0.1.0
**Last Updated:** 2026-05-17

FlashQuery is a local-first data management layer for AI workflows. It exposes MCP tools that let AI agents save memories, create and search documents, and query relational data, with all storage under the user's control. This document describes the system's structure, data flow, and deployment model. For hands-on setup, start with the [README](../README.md); for production concerns, see [`DEPLOYMENT.md`](./DEPLOYMENT.md).

---

## Overview

FlashQuery manages three kinds of data and one delegated execution surface:

- **Memories** — semantic summaries of conversations and insights, indexed with vector embeddings for search.
- **Documents** — markdown files in a local vault, Obsidian-compatible, optionally versioned with git.
- **Relational records** — structured data accessed through plugin tables in Supabase.
- **LLM delegation** — configured model and purpose calls through `call_model`, including document reference hydration, cost tracking, and FlashQuery-managed native/template tool loops.

All three are stored in places the user owns: the vault directory on local disk, and a Postgres database the user provides (Supabase Cloud, a self-hosted Supabase stack, or the bundled Docker stack that ships under `docker/`). FlashQuery runs as an MCP server, so any AI tool that speaks MCP — Claude Code, Claude Cowork, Claude Desktop, Cursor, and others — can connect to it.

---

## System Components (C4 — Container Level)

### External — AI Tools

- **Claude Desktop, Claude Code, Claude Cowork, Cursor** — MCP clients that connect via either streamable-http (the default) or stdio.
- **Obsidian** (optional) — reads and edits markdown files in the vault directly. FlashQuery and Obsidian coexist: FlashQuery watches and indexes the vault; Obsidian treats it as a normal folder of markdown.

### Internal — FlashQuery (the MCP server)

- **CLI entry point** (`src/index.ts`) — parses command-line args, loads config, starts the requested subcommand (`start`, `backup`, `scan`, `doctor`).
- **Config loader** (`src/config/loader.ts`) — reads `flashquery.yml` from the current directory (or `~/.config/flashquery/`), expands `${VAR}` references against the environment, validates against the Zod schema.
- **MCP server** (`src/mcp/server.ts`) — implements the MCP protocol, binds the HTTP listener (when using streamable-http), routes tool requests to handlers, issues and verifies bearer tokens.
- **Tool handlers** (`src/mcp/tools/`) — individual implementations for every MCP tool (documents, memories, plugin records, vault operations, search, and LLM delegation).
- **LLM runtime** (`src/llm/`) — provider client, config sync, cost tracking, document reference hydration, purpose template bindings, and the managed agent loop used by tool-enabled `call_model` purposes.
- **Storage layer** (`src/storage/`) — Supabase/Postgres client, vault filesystem I/O, schema verification.
- **Embedding provider** (`src/embedding/provider.ts`) — generates vectors via OpenAI, OpenRouter, or Ollama.

### External — Data stores

- **Postgres with pgvector** — relational records, memory vectors, document metadata and embeddings, LLM config mirrors, purpose-template bindings, and usage telemetry. The application expects a Supabase-shaped schema (tables prefixed `fqc_*`, service-role access for DDL).
- **Local vault** — a directory of markdown files on disk. Optionally a git repository (enables auto-commit on writes).

### High-level diagram

```
┌──────────────────┐     MCP protocol       ┌───────────────────────┐
│  Claude Desktop  │ ──────────────────────▶│                       │
│  Claude Code     │ ◀──────────────────────│   FlashQuery          │
│  Claude Cowork   │  (streamable-http +    │   (Node.js process)   │
│  Cursor          │   bearer tokens)       │                       │
└──────────────────┘                        └──┬──────────────────┬─┘
                                               │                  │
                             SQL + pgvector    │                  │  Read / Write
                                               ▼                  ▼
                                       ┌──────────────┐     ┌──────────────┐
                                       │   Postgres   │     │  Local Vault │
                                       │ + pgvector   │     │  (markdown)  │
                                       └──────────────┘     └──────────────┘
                                                                 ▲
                                                                 │ Browse / Edit
                                                                 │
                                                          ┌──────┴──────┐
                                                          │   Obsidian  │
                                                          └─────────────┘
```

---

## Data Flow

### Request → response cycle

1. An AI tool sends an MCP request using the final memory writer: `{"method": "tools/call", "params": {"name": "write_memory", "arguments": {...}}}`.
2. The MCP server authenticates the request (bearer token verification for streamable-http; local trust for stdio) and routes it to the matching tool handler.
3. The handler parses and validates the arguments with Zod.
4. The handler calls into the storage layers it needs — typically the embedding provider (to generate a vector), the Supabase client (to write the row), and the vault (if the tool produces a file).
5. The handler returns an MCP text response whose `content[0].text` usually contains JSON, for example a memory identification payload with `memory_id`, timestamps, tags, and optional included fields.
6. The AI tool receives the response and continues its workflow.

### Delegated LLM flow

`call_model` uses the same MCP request path, then adds a model-dispatch layer:

1. The caller selects a model alias or purpose name from the `llm:` section of `flashquery.yml`.
2. Host-authored document references in `system` and `user` messages (`{{ref:...}}` or late-bound `{{ref:@alias}}`) are resolved against the vault before the provider call. Legacy `{{id:...}}` text is not active reference syntax.
3. Mode 1 calls a configured provider directly and returns a `response`, `messages`, and `metadata` envelope.
4. Mode 2 is selected for purpose calls that expose model-visible native tools or template tools. FlashQuery runs the delegated model in a bounded internal loop, dispatches approved tool calls against its own MCP handlers, and returns aggregate loop metadata under `metadata.tools`.
5. Usage is recorded once per completed `call_model` invocation in `fqc_llm_usage`; per-iteration loop detail stays in the response envelope and runtime logs.

### Concurrency

- Each MCP session has its own server instance; there is no shared per-session state.
- The Supabase client handles connection pooling.
- Embedding API calls are fire-and-forget on the write path — they return an ID immediately and compute the embedding asynchronously, so tool calls don't block on the embedding provider.
- Vault file writes are synchronous per tool call to guarantee on-disk consistency before the response is returned.
- Concurrent writes from multiple FlashQuery instances pointed at the same database can be coordinated via the `locking` section in `flashquery.yml` (enabled by default). See the Known Limitations section below for the current boundaries on multi-instance operation.

---

## Plugin Propagation Design

When a document's `fqc_id` changes — after a file rename, an external edit, or duplicate detection — FlashQuery updates all references in plugin tables to preserve consistency. This is called "propagation."

### Example

A CRM plugin has a `fqcp_crm_default_contacts` table with an `fqc_id` column linking each contact to its source document. If document `uuid-123` becomes `uuid-456`:

```sql
-- Before: contact linked to old document ID
SELECT * FROM fqcp_crm_default_contacts WHERE fqc_id = 'uuid-123';
-- id=99, fqc_id='uuid-123', name='Alice'

-- Propagation updates the reference
UPDATE fqcp_crm_default_contacts SET fqc_id = 'uuid-456' WHERE fqc_id = 'uuid-123';

-- After: contact now linked to new document ID
SELECT * FROM fqcp_crm_default_contacts WHERE fqc_id = 'uuid-456';
```

### When propagation runs

Propagation is triggered at two points:

1. **During periodic scanning** — the background scanner detects identity changes (hash mismatch, path move, duplicate file) and calls `propagateFqcIdChange()` in the same cycle that detected the change. Renames, moves, and external edits are all handled inside one scan.
2. **During MCP tool pre-scans** — before a tool call writes a file, a targeted scan resolves the document's identity. If the identity changed between the pre-scan and the write, propagation runs immediately before the frontmatter is committed.

Both paths are fail-safe. Propagation errors are caught, logged at WARN level, and do not block the primary operation. A fresh full scan (`flashquery scan`) recovers any reference that propagation missed.

### Identity resolution chain

The scanner uses a four-tier fallback chain to determine old and new `fqc_id` values:

| Tier | Method | When used |
|------|--------|-----------|
| 1 — Hash match | Same SHA-256 content hash as an existing row | File content unchanged; reuse the existing ID |
| 2 — Frontmatter ID | File has `fqc_id` in its YAML frontmatter | Adopt the ID declared by the file |
| 3 — Path-based lookup | File path matches a known row in the path-to-row map | Known file path even without frontmatter |
| 4 — Generate new | No match found | Assign a fresh UUID |

When both old and new IDs are known (Tiers 1 or 2 combined with any other tier), propagation proceeds immediately.

### Unknown-old-ID edge case

Occasionally an external tool (Obsidian, VS Code, another editor) strips the YAML frontmatter from a file, removing the `fqc_id`. The scanner detects this by computing a new content hash with no match and finding no frontmatter ID. It then falls back to a path-based lookup in the path-to-row map. If the path isn't recognized either, the scanner logs a WARN — `"Cannot propagate fqc_id change — old ID unknown for document {path}"` — and skips propagation for that document. Running `flashquery scan` after external edits recovers any references that were skipped this way.

### Plugin table discovery

Propagation finds plugin tables dynamically using PostgreSQL's `information_schema`:

```sql
SELECT table_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name LIKE 'fqcp_%'
  AND column_name = 'fqc_id'
ORDER BY table_name;
```

This query finds every table prefixed `fqcp_` that has an `fqc_id` column. Dynamic discovery means propagation covers plugins registered after FlashQuery started — no hardcoded table list is needed.

### Permissions

Propagation needs read access to `information_schema` (standard Postgres behavior) and write access to plugin tables. Both are provided by the same service-role key FlashQuery uses for its own DDL and data operations. No additional grants are needed for standard Supabase deployments.

### Performance

- The information_schema query typically completes in under 100ms for schemas with fewer than 5,000 columns.
- Each UPDATE is bounded by the number of rows matching the old `fqc_id` — fast when plugin tables have an index on that column (FlashQuery creates this index during plugin registration).
- Total propagation time for a single identity change is typically under 500ms for vaults with one to five plugin tables.

---

## Configuration

FlashQuery's configuration is split across two files by design:

- **`./.env`** holds per-install values: secrets (API keys, JWT signing keys), endpoint URLs, the vault path, the instance name and ID, and any environment-specific overrides. Gitignored. Every value in this file is something that varies between installations.
- **`./flashquery.yml`** holds the structural contract: which fields exist, their defaults, and `${VAR}` references into `.env` for the values that live there. Safe to read; can be committed if you want a shared structural config across a team.

The setup script (`./setup/setup.sh`, invoked via `npm run setup`) generates both files from the annotated templates in the repo — [`../.env.example`](../.env.example) and [`../flashquery.example.yml`](../flashquery.example.yml) — and substitutes user input into `.env` while copying the yaml verbatim. Re-running the script picks up existing values as defaults, preserves generated secrets, and warns before changing sensitive routing values such as the database URL or instance ID.

If you're running the bundled Supabase stack in `docker/`, a third file — **`./docker/.env.docker`** — is generated from [`../docker/.env.docker.example`](../docker/.env.docker.example). Full-stack Docker uses that file as its source of truth for Supabase orchestration values (Postgres password, shared JWT secret, anon key, service-role key) and for the environment passed into the FlashQuery container. The root `.env` remains the source of truth for local FlashQuery runs, FlashQuery-only Docker, and database-only Docker.

The root `.env` and `docker/.env.docker` each stand on their own. Shared values such as `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAULT_PATH`, instance identity, and default LLM provider variables are duplicated in both when you choose the bundled Docker path, and `setup/setup.sh` keeps them in sync.

For the full list of fields and their meanings, see the inline comments in `.env.example`, `docker/.env.docker.example`, and `flashquery.example.yml`.

### LLM and template configuration

The optional `llm:` section uses a three-layer shape:

- `providers:` name OpenAI-compatible or Ollama endpoints and their API key source.
- `models:` define aliases, provider mapping, underlying model IDs, type, cost, optional context window, tags, and tool capability declarations.
- `purposes:` define fallback chains and defaults. A purpose can also expose FlashQuery-managed native tools with `tools`, remove items from a tier with `excluded_tools`, and bind vault templates with `templates`.

Purpose tool exposure supports `tier:read-only`, `tier:read-write`, and explicit native tool names. Hard-excluded tools such as `call_model`, `call_macro`, `register_plugin`, `unregister_plugin`, `get_plugin_info`, `clear_pending_reviews`, and `maintain_vault` are removed from delegated model-visible registries even if listed.

Vault templates are ordinary documents with `fq_template: true` frontmatter. Purpose-bound templates can be exposed as generated provider-safe tools named `flashquery_<namespace>_<slug>`, or injected by host-authored references through `template_params`.

---

## Deployment Paths

FlashQuery supports three deployment shapes. All three use the same FlashQuery application; what differs is where Supabase lives and how the pieces are orchestrated.

### Path 1 — Bundled Docker stack

Everything runs on your machine in Docker: Postgres with pgvector, the Supabase services (PostgREST, GoTrue, Kong, Studio), and optionally FlashQuery itself.

**When to use:** you want a fully self-contained local setup without creating a Supabase Cloud account, and you don't already have Postgres running.

**How to set up:** run `npm run setup` and choose option 3 ("Bundled Docker stack"). The script generates strong secrets for `POSTGRES_PASSWORD` and the shared JWT secret, signs the anon and service-role keys, writes both `.env` and `docker/.env.docker`, and prints the command to start the stack. The README Quick Start walks through the full sequence.

### Path 2 — External Supabase (Cloud or existing self-hosted)

Supabase runs somewhere else — Supabase Cloud or a self-hosted instance you already operate — and FlashQuery runs on your machine or a cloud host, connecting over the network.

**When to use:** you already have Supabase, or you're deploying FlashQuery to a cloud host and want a managed database behind it.

**How to set up:** run `npm run setup` and choose option 1 ("Supabase Cloud") or option 2 ("Existing self-hosted"). The script prompts for your Supabase URL, service-role key, and database connection string. Nothing in `docker/` is touched.

### Path 3 — Database-only Docker (developer / CI)

Postgres runs in Docker via `docker/docker-compose.db-only.yml`, but FlashQuery runs directly on the host via `npm run dev`. You get database isolation without the overhead of the full bundled stack.

**When to use:** iterating on FlashQuery code with hot reload, debugging from your editor, or running integration tests in CI.

**How to set up:** run `make db-up` from the repo root, or run `docker compose --env-file .env -f docker/docker-compose.db-only.yml up -d`. Configure `.env` to point at `localhost:5432` for `DATABASE_URL`, make sure `POSTGRES_PASSWORD` matches that URL, and run `npm run dev` from the repo root.

### Production concerns

All three paths share the same production-deployment story: run FlashQuery as a managed service (systemd, launchd, or a Docker restart policy), expose it behind a reverse proxy if you need a public FQDN, schedule regular `flashquery backup` runs, and collect logs appropriately for your environment. See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for the full production guide including reverse-proxy examples and service-supervision templates.

---

## CLI Commands

When the package is installed globally (`npm install -g flashquery`), the `flashquery` binary becomes available on your PATH. It is registered in `package.json`'s `"bin"` field and points to `dist/index.js`. It accepts all six subcommands:

- **`start --config <path>`** — starts the MCP server using the given `flashquery.yml`. Accepts `--transport http` (streamable-http) or `--transport stdio` to override the yaml setting for a single run.
- **`doctor`** — runs health checks against the current config: database reachable, pgvector extension present, vault path writable, embedding provider configured, git available if auto-commit is on. Prints a pass/fail line per check.
- **`scan`** — runs a full vault scan: detects identity changes, triggers plugin propagation. Normally the background scanner handles this automatically; the standalone command is useful after external edits or to recover from skipped propagations.
- **`backup`** — writes a JSON snapshot of every FlashQuery table to `<vault>/.fqc/backup.json` and (if the vault is a git repo) commits it. Use `--db-only` to skip the full vault commit+tag and write only the database snapshot. Schedule this with cron or launchd for regular backups — see [`DEPLOYMENT.md`](./DEPLOYMENT.md) for examples.
- **`unlock`** — removes rows from the `fqc_write_locks` table. Use this to clear orphaned locks left behind if FlashQuery exits uncleanly and subsequent starts refuse to acquire a lock. `--resource <type>` clears locks for a specific resource type (e.g., `memory`, `documents`, `records`); omitting it clears all locks.
- **`discover`** — discovers and assigns plugin ownership for documents that have been flagged as needing an owner. `--path <vault-relative-path>` targets a specific document; `--batch` suppresses the interactive ownership prompts and uses auto-determined ownership.

---

## Known Limitations

### Symlinks in vault

FlashQuery does not follow symbolic links in the vault. Symlinks are skipped during scanning; the original files sync normally. This limitation is deliberate — symlink handling is unreliable on network filesystems (NFS, SMB) and in containers. The scanner logs each skipped symlink at INFO level so operators can find them.

### Multiple instances on the same vault

Running two FlashQuery instances against the same vault simultaneously can still race at the filesystem level. Database-backed write locks coordinate shared `documents`, `memory`, and `records` writes when enabled, but they do not make the vault itself a fully multi-writer filesystem. Recommendation: one primary writer per vault; use additional instances only when you understand the lock boundaries.

### Plugin table consistency after external edits

When an external tool strips frontmatter from a vault file, FlashQuery can detect the condition but can't always recover the old `fqc_id` automatically. The scanner logs a WARN; running `flashquery scan` resolves the orphaned references. A file-watcher mode that catches these changes in real time (rather than waiting for the next periodic scan) is a roadmap item.

---

## File Structure

```
flashquery/
├── src/
│   ├── index.ts                      # CLI entry (start / doctor / scan / backup)
│   ├── config/
│   │   └── loader.ts                 # YAML parsing + env expansion + Zod validation
│   ├── mcp/
│   │   ├── server.ts                 # MCP protocol, HTTP listener, token endpoints
│   │   └── tools/                    # Individual tool handlers
│   ├── storage/
│   │   ├── supabase.ts               # Postgres + pgvector client
│   │   ├── vault.ts                  # Markdown file I/O
│   │   └── schema-verify.ts          # DDL check at startup
│   ├── llm/
│   │   ├── client.ts                 # Provider dispatch and purpose fallback
│   │   ├── agent-loop.ts             # Managed tool loop for delegated models
│   │   ├── reference-resolver.ts     # call_model document/template hydration
│   │   └── config-sync.ts            # YAML-to-DB LLM config mirroring
│   └── embedding/
│       └── provider.ts               # OpenAI / OpenRouter / Ollama
├── tests/
│   ├── unit/                         # Unit tests
│   ├── integration/                  # Integration tests
│   ├── e2e/                          # End-to-end tests
│   └── scenarios/                    # Scenario tests (see tests/scenarios/README.md)
├── docker/
│   ├── docker-compose.yml            # Full bundled stack (Postgres + Supabase services + FlashQuery)
│   ├── docker-compose.db-only.yml    # Database-only stack
│   ├── docker-compose.flashquery-only.yml   # FlashQuery-only stack (points at external Supabase)
│   └── .env.docker.example           # Template for the docker stack env file
├── docs/
│   ├── DEPLOYMENT.md                 # Production deployment guide
│   ├── SECURITY-TOKENS.md            # Bearer token auth reference
│   └── client-configs/               # MCP client configuration examples
├── Dockerfile                        # Production image
├── setup/
│   ├── setup.sh                      # Interactive setup
│   └── setup-claude-mcp.sh           # Register with Claude Code MCP
├── flashquery.example.yml            # Structural config template
├── .env.example                      # Application env template
├── README.md                         # Quick start and entry point
└── docs/ARCHITECTURE.md              # This file
```

---

## Related documentation

- [README](../README.md) — getting started, MCP client connection basics
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — reverse-proxy setup, service supervision, backups, logging
- [`Document Reference System.md`](./Document%20Reference%20System.md) — reference placeholders, section references, pointer dereferences, and templates
- [`LLM Providers Models and Purposes.md`](./LLM%20Providers%20Models%20and%20Purposes.md) — provider/model/purpose configuration and purpose template tools
- [`SECURITY-TOKENS.md`](./SECURITY-TOKENS.md) — bearer token authentication
- [`client-configs/README.md`](./client-configs/README.md) — worked MCP client configuration examples
- [`tests/scenarios/README.md`](../tests/scenarios/README.md) — scenario testing framework
- [`.env.example`](../.env.example) and [`flashquery.example.yml`](../flashquery.example.yml) — annotated config templates
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — development setup and contribution guidelines
