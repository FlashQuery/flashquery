# FlashQuery

## What This Is

FlashQuery is an open source, local-first data management layer for AI workflows. It sits between AI tools (any LLM, via MCP) and a unified data store (Supabase + local Obsidian vault). It manages memory, documents, relational records, and vector embeddings. The user owns all data.

## Prerequisites

- Node.js >= 20 LTS (enforced via `package.json` `engines` field — `npm install` on Node < 20 prints an `EBADENGINE` warning)
- A Supabase instance (local or hosted) — see docs/ARCHITECTURE.md for setup
- An embedding API key (OpenAI or OpenRouter) or a local Ollama instance
- A `.env.test` file for running integration and E2E tests — copy `.env.test.example` and fill in the values

## Architecture Summary

```
AI Tools (Claude, ChatGPT, Cursor) ──via MCP──> FlashQuery ──> Supabase (memory, vectors, relational)
                                                                ──> Local vault (markdown files, Obsidian-compatible)
```

FlashQuery runs as a server process started from the CLI. It uses **stdio MCP transport** (Claude Desktop/Code spawns it as a subprocess). It connects to a local or hosted Supabase instance for relational data and vector search, and manages a local folder of markdown files that doubles as an Obsidian vault.

## Technology Stack

- **Runtime:** Node.js >= 20 LTS
- **Language:** TypeScript (strict mode)
- **Module system:** ESM (`"type": "module"`)
- **MCP SDK:** `@modelcontextprotocol/sdk` (with `zod` peer dependency)
- **Supabase:** `@supabase/supabase-js` for data ops, `pg` for DDL
- **Build:** `tsup` for production, `tsx` for development
- **Test:** Vitest
- **Other:** `simple-git`, `js-yaml`, `gray-matter` (frontmatter parsing), `async-mutex`, `uuid`

## Build & Execution

**From the project root directory:**

### Development (Recommended)
```bash
npm run dev
```
Runs TypeScript directly via `tsx` with hot reload. No build step needed. Reads `./flashquery.yml` config.

### Production Build
```bash
npm run build
```
Compiles TypeScript to ESM JavaScript in `dist/` via `tsup`. Creates `dist/index.js` (executable) and `dist/index.d.ts` (type declarations).

### Run After Build
```bash
node dist/index.js start --config ./flashquery.yml
```

### Important: Local Repo vs. Published Package

The `"bin"` entry in `package.json` maps the `flashquery` command to `dist/index.js`. This binary is only available in your PATH when the package is installed via npm (`npm install -g flashquery`). From a cloned repo, use:

- `npm run dev` — preferred for active development
- `node dist/index.js start --config ./flashquery.yml` — for running the built binary

**Never use `npm link` for local development** — it installs globally outside the project folder, which is not appropriate for a cloned repository that multiple developers might work on.

## Conventions

### Code Style
- Use `async/await` throughout (no raw Promises or callbacks)
- All functions that can fail return typed errors, not thrown exceptions, at module boundaries
- MCP tool handlers use try/catch internally and return `isError: true` responses on failure
- Use Zod for all external input validation (config, MCP params)

### File Organization
```
src/
├── index.ts                    # CLI entry point, startup sequence
├── cli/
│   ├── commands/
│   │   └── unlock.ts           # Vault lock management command
│   └── doctor.ts               # Diagnostics command
├── config/
│   └── loader.ts               # YAML config parsing and validation
├── constants/
│   └── frontmatter-fields.ts   # Canonical frontmatter field name constants
├── embedding/
│   └── provider.ts             # Embedding generation (OpenAI, OpenRouter)
├── git/
│   └── manager.ts              # Git operations for the vault
├── logging/
│   ├── logger.ts               # Structured logging
│   └── context.ts              # Per-request logging context
├── mcp/
│   ├── server.ts               # MCP server setup and tool registration
│   ├── auth.ts                 # MCP authentication
│   ├── redaction.ts            # Sensitive field redaction
│   ├── tools/
│   │   ├── memory.ts           # save_memory, search_memory, list_memories
│   │   ├── documents.ts        # create_document, get_document, search_documents
│   │   ├── projects.ts         # list_projects, get_project_info
│   │   ├── records.ts          # Relational record CRUD
│   │   ├── compound.ts         # Compound / multi-step tools
│   │   ├── scan.ts             # Vault scanning tools
│   │   ├── plugins.ts          # Plugin management tools
│   │   └── pending-review.ts   # Pending review queue tools
│   └── utils/
│       ├── frontmatter-sanitizer.ts
│       ├── markdown-sections.ts
│       ├── markdown-utils.ts
│       ├── resolve-document.ts
│       └── response-formats.ts
├── plugins/
│   └── manager.ts              # Plugin lifecycle management
├── projects/
│   └── seeder.ts               # Project seeding utilities
├── server/
│   ├── port-checker.ts
│   ├── shutdown.ts
│   └── shutdown-state.ts
├── services/
│   ├── scanner.ts              # Vault file scanner
│   ├── manifest-loader.ts
│   ├── plugin-propagation.ts
│   ├── plugin-reconciliation.ts
│   └── write-lock.ts
├── storage/
│   ├── supabase.ts             # Supabase client wrapper
│   ├── vault.ts                # File system operations for the vault
│   └── schema-verify.ts        # DB schema verification
└── utils/
    ├── frontmatter.ts
    ├── pg-client.ts
    ├── schema-migration.ts
    ├── tag-validator.ts
    └── uuid.ts
```

### Naming
- Files: `kebab-case.ts`
- Types/Interfaces: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Supabase tables: `snake_case` with `fqc_` prefix for internal tables

### Testing
- Unit tests: `tests/unit/*.test.ts` — mock external deps, run fast
- Integration tests: `tests/integration/*.test.ts` — require Supabase (local or cloud)
- E2E tests: `tests/e2e/*.test.ts` — full stack, spawn FQC as subprocess
- Scenario tests: `tests/scenarios/` — directed, integration, MCP, framework, and DB tool scenario suites
- Run unit tests: `npm test`
- Run integration tests: `npm run test:integration`
- Run E2E tests: `npm run test:e2e`

### Test Environment Setup
Integration and E2E tests read connection credentials from `.env.test` (gitignored).
To set up: `cp .env.test.example .env.test` then fill in your Supabase URL, service role key, database URL, and OpenAI API key. Tests that require Supabase will skip gracefully when `.env.test` is missing or incomplete. The centralized config lives in `tests/helpers/test-env.ts`.

### MCP Tool Responses
All MCP tools return `{ content: [{ type: "text", text: "..." }] }`. On error, add `isError: true`. Response text is human-readable (the AI model is the consumer). Include IDs and key metadata so the AI can reference them in follow-up calls.

### Logging Format
```
[YYYY-MM-DD HH:MM:SS] LEVEL  Message
[YYYY-MM-DD HH:MM:SS] DEBUG    key: value (indented details)
```

## Important: What NOT To Do

- Do NOT use CommonJS (`require`). Everything is ESM.
- Do NOT use `@modelcontextprotocol/server` — that package does not exist on npm. Use `@modelcontextprotocol/sdk`.
- Do NOT build a web UI. FlashQuery is CLI + MCP only.
- Do NOT implement server-side session state. MCP is stateless; project context is per-call.
