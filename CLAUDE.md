# FlashQuery

## What This Is

FlashQuery is an open source, local-first data management layer for AI workflows. It sits between AI tools (any LLM, via MCP) and a unified data store (Supabase + local Obsidian vault). It manages memory, documents, and (eventually) relational data, files, and vector embeddings. The user owns all data.

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

FlashQuery runs as a server process started from the CLI. At v1, it uses **stdio MCP transport** (Claude Desktop/Code spawns it as a subprocess). It connects to a local or hosted Supabase instance for relational data and vector search, and manages a local folder of markdown files that doubles as an Obsidian vault.

## Current Build Phase

**IMPORTANT: At the start of every session, read `STATUS.md` first.** It tells you the current phase, what's been completed, and any notes from previous phases.

Check the `tasks/` directory for numbered task files. Work through them in order. Each task file contains everything you need for that phase — do NOT read the full definition document (it's 130KB and will consume your context window).

**Definition document location:** `../Definition/FlashQuery-Core Definition.md` — reference specific sections only when a task file points you there. Never read the whole thing.

## Build Status Protocol

FlashQuery uses two mechanisms to maintain continuity across sessions:

### STATUS.md (project-level log)
- **Read it first** at the start of every session
- **Update it** at the end of every phase with: what was built, test results, decisions made, known issues, and actual package versions installed
- This is how the next session knows what state the project is in

### Completion Log (per-task)
- Every task file has a `## Completion Log` section at the bottom
- **Fill it in** when you finish the phase: what was done, test output, any deviations from the spec
- This keeps the record co-located with the task definition

### Session workflow
1. Read `STATUS.md` — understand current state
2. Read the current task file (e.g., `tasks/03-logging.md`)
3. Implement the phase
4. Run tests, verify the "Done When" checklist
5. Update the task file's Completion Log
6. Update `STATUS.md` with the phase summary
7. Advance "Current Phase" in `STATUS.md` to the next task

## Technology Stack

- **Runtime:** Node.js >= 20 LTS
- **Language:** TypeScript (strict mode)
- **Module system:** ESM (`"type": "module"`)
- **MCP SDK:** `@modelcontextprotocol/sdk` v1.27.1 (with `zod` peer dependency)
- **Supabase:** `@supabase/supabase-js` for data ops, `pg` for DDL
- **Build:** `tsup` for production, `tsx` for development
- **Test:** Vitest
- **Other:** `simple-git`, `js-yaml`, `gray-matter` (frontmatter parsing)

## Build & Execution (Phase 17+)

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

Or with `npx` (shorthand, if you prefer):
```bash
npm run build
npx fqc start --config ./flashquery.yml
```

### Important: Local Repo vs. Published Package

The `"bin"` entry in `package.json` exists for **when FQC is published to npm**. When you `npm install flashquery-core` (the published package) globally or as a package dependency, npm automatically creates the `fqc` binary in your PATH.

**For a cloned repo, always use:**
- `npm run dev` — preferred for active development
- `node dist/index.js` — for running the built binary
- `npx fqc` — shorthand (after `npm run build`)

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
├── index.ts                # CLI entry point, startup sequence
├── config/
│   └── loader.ts           # YAML config parsing and validation
├── mcp/
│   ├── server.ts           # MCP server setup and tool registration
│   └── tools/
│       ├── memory.ts       # save_memory, search_memory, list_memories
│       ├── documents.ts    # create_document, get_document, search_documents
│       └── projects.ts     # list_projects, get_project_info
├── storage/
│   ├── supabase.ts         # Supabase client wrapper (both pg and supabase-js)
│   └── vault.ts            # File system operations for the vault
├── embedding/
│   └── provider.ts         # Embedding generation (OpenAI, OpenRouter)
└── logging/
    └── logger.ts           # Structured logging
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
- MCP protocol tests: `tests/mcp/*.test.ts` — spawn FQC as subprocess, connect via MCP client
- Run unit tests: `npm test`
- Run integration tests: `npm run test:integration`

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
- Do NOT use `@modelcontextprotocol/server` — that package does not exist on npm. Use `@modelcontextprotocol/sdk` (v1.27.1 installed).
- Do NOT build a web UI. v1 is CLI + MCP only.
- Do NOT implement Git auto-commit (deferred to v1.5).
- Do NOT implement the plugin system (deferred to v1.5).
- Do NOT implement relational record CRUD (deferred to v1.5).
- Do NOT implement Tier 2 compound tools (deferred to v1.5).
- Do NOT implement server-side session state. MCP is stateless; project context is per-call.
