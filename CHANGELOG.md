# Changelog

All notable changes to FlashQuery will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2026-05-05

This release introduces pass-by-reference document injection in `call_model`,
consolidates `get_document` and `get_doc_outline` into a single structured tool,
and adds model/purpose discovery — enabling a calling LLM to evaluate available
models, delegate work via document references (without first reading documents
into its own context), and inspect cost rates before dispatching. Together these
extensions form a "pre-agentic" layer for intelligent token-cost-aware delegation.

### Added
- Reference syntax in `call_model` messages — `{{ref:path}}`, `{{ref:path#Section}}`,
  `{{ref:path->pointer}}`, `{{id:uuid}}`, `{{id:uuid#Section}}`, and `{{id:uuid->pointer}}`
  placeholders are inline-resolved before LLM dispatch. The calling LLM never has
  to read the document into its own context — FlashQuery resolves and injects
  the content server-side. Fail-fast `reference_resolution_failed` error on any
  unresolvable reference (no LLM call is made).
- `injected_references[]` and `prompt_chars` fields in the `call_model` response
  envelope when references are resolved — enables per-reference cost attribution
  via `tokens.input × (ref.chars / prompt_chars)`.
- Discovery resolvers in `call_model`: `resolver: "list_models"` returns
  `{ models: [...] }` with hard cost rates and capability metadata,
  `resolver: "list_purposes"` returns `{ purposes: [...] }` with model chains and
  cost rates derived from the primary model, and `resolver: "search"` performs
  case-insensitive substring search over names and descriptions. `name` and
  `messages` are optional for these resolvers — discovery is a free, no-network
  operation.
- `local: true` field on Ollama-backed model entries in `list_models` responses,
  auto-derived from `provider.type === 'ollama'` (or set explicitly via the
  provider's `local: true` field). Surfaces the local-vs-remote distinction so
  callers can route accordingly.
- Optional `description`, `context_window`, and `capabilities` fields on model
  entries in `list_models` responses — preserved verbatim when declared in
  `flashquery.yml`, omitted entirely when undeclared (no `null` placeholders,
  no defaulted empty arrays). Explicitly-declared empty values like
  `capabilities: []` are preserved.
- Batch retrieval in `get_document` — `identifiers` accepts a string or an array.
  Array input returns an array response with per-element success/error objects;
  the call itself never fails for partial errors.
- `follow_ref` parameter in `get_document` — dot-separated path into the source
  document's frontmatter (e.g., `"supersedes"` or `"projections.summary"`)
  resolves to a target document identifier whose content is returned nested
  under `followed_ref`. Works with both single and array `identifiers`.
- `reconcile_documents` MCP tool — scans the database for documents whose vault
  file is missing, then either updates `vault_path` (file moved, `fqc_id`
  matched at new location) or marks the row archived (file genuinely gone).
  Supports `dry_run`.

### Changed
- **`get_document` returns a structured JSON envelope** — every successful
  response includes `identifier`, `title`, `path`, `fq_id`, `modified`, and
  `size.chars`, regardless of which fields are requested. New `include`
  parameter (`("body" | "frontmatter" | "headings")[]`, default `["body"]`)
  picks what to include. Section matching is now case-insensitive substring;
  numeric queries (starting with a digit) are anchored to the heading start
  (so `"3"` matches `"3. Scope"` but not `"13. Conversations"`). New
  `max_depth`, `include_nested`, and `occurrence` parameters.
- `search_documents` `mode` parameter now accepts a third value `"mixed"`
  (semantic-ranked first, unindexed appended) in addition to `"filesystem"`
  and `"semantic"`.
- `call_model` `messages` is now optional for discovery resolvers
  (`list_models`, `list_purposes`, `search`) — previously required for all
  resolvers.

### Removed
- **BREAKING:** `get_doc_outline` MCP tool removed. Its functionality is fully
  available via `get_document` with `include: ["frontmatter", "headings"]` —
  same heading data, same frontmatter, same `max_depth` parameter, plus
  consistent error semantics with the rest of `get_document`. Callers that
  invoke `get_doc_outline` directly will fail; migrate to the new shape.

### Fixed
- Discovery resolver responses now correctly omit optional fields when
  undeclared in config (per OQ #16) — previously some implementations defaulted
  to `null` or `[]` placeholders, which misled callers about whether a model
  truly lacked capabilities vs. simply hadn't been documented.
- Reference resolution failures now fail fast before any LLM call, with a
  structured `failed_references[]` listing per-reference reasons (path missing,
  section not found, pointer absent, `#`/`->` mixed, etc.) — eliminates the
  silent half-resolved-prompt failure mode.
- `occurrence_out_of_range` error code surfaced consistently across `get_document`
  section extraction (was previously folded into a generic error in some paths).
- Various test scenarios hardened with value-bound substring assertions
  (TC4-W5) — discovery and reference-syntax tests now distinguish
  `"input_cost_per_million"` (key presence) from `"input_cost_per_million":0.15`
  (key + value match), preventing silent regressions where a configured value
  was returned as empty.

### Documentation
- Full rewrite of `get_document` and `call_model` sections in
  `docs/FlashQuery MCP Tool Guide.md` to cover the new structured envelope,
  `include` parameter, batch retrieval, `follow_ref`, all six reference-syntax
  placeholder forms, response metadata (`injected_references[]`, `prompt_chars`),
  and discovery resolver response shapes.
- Removed `get_doc_outline` documentation; added migration note pointing users
  at `get_document` with `include: ["frontmatter", "headings"]`.
- Corrected three frontmatter-field-name references (`fqc_id`/`fqc_instance`/
  `fqc_title` → canonical `fq_id`/`fq_instance`/`fq_title` per
  `src/constants/frontmatter-fields.ts`).
- Added a Deprecated Tools appendix documenting the `list_projects` and
  `get_project_info` stubs (deprecated since v1.7).

## [1.2.0] - 2026-05-01

This release adds native LLM calling and cost tracking to FlashQuery. Skills and agents
can now invoke language models directly through MCP, with every call logged to a usage
table that reports token counts, latency, USD cost, and call volume aggregated by model
or purpose.

### Added
- `call_model` MCP tool — sends a message array to any configured LLM model or purpose
  and returns the text response with a diagnostic envelope containing token counts,
  computed cost, and latency. Supports a `trace_id` parameter to correlate calls across
  a multi-step skill run and accumulate cumulative totals in the response envelope.
- `get_llm_usage` MCP tool — queries `fqc_llm_usage` and returns aggregated statistics
  in four modes: `summary` (totals and period cost), `recent` (last N calls with
  individual costs), `by_purpose` (per-purpose call counts and primary-model hit rates),
  and `by_model` (per-model usage and average fallback position). Supports filtering by
  `trace_id`, `purpose_name`, `model_name`, and date range.
- Three-layer LLM configuration (`llm.providers`, `llm.models`, `llm.purposes`) in
  `flashquery.yml` with per-purpose fallback model chains, per-call parameter defaults,
  and automatic DB sync on startup via five new `fqc_llm_*` tables.
- Purpose resolver with multi-model fallback chain — when a purpose's primary model
  fails, the resolver tries successive fallbacks in order and records the fallback
  position in the response envelope.
- `fqc_llm_usage` table for persistent cost and token-count tracking; writes are queued
  in memory and flushed asynchronously to avoid blocking tool responses, with a drain
  step in the graceful shutdown sequence to prevent data loss on exit.
- `OPENAI_API_KEY` promoted to an active, documented entry in `.env.example`;
  `OPENROUTER_API_KEY` added to `.env.test.example`.

### Changed
- Embedding is now configured through the `llm:` system as an `embedding`-typed purpose,
  replacing the legacy top-level `embedding:` section. Existing `embedding:` configs are
  accepted with a deprecation warning when an `llm:` embedding purpose is also present.
  `flashquery.example.yml` has been updated to the three-layer format.
- `EMBEDDING_PROVIDER` and `EMBEDDING_MODEL` environment variables removed from
  `docker-compose.yml` — embedding is now configured in `flashquery.yml` via the `llm:`
  section. Users of the bundled Docker stack who relied on these variables should migrate
  to the `llm:` config format.
- Startup banner now reports `Semantic search: ENABLED (via LLM purpose: <model>)` when
  embedding is routed through an LLM purpose.

### Fixed
- Setup script (`setup.sh`) now populates `OPENAI_API_KEY` alongside Supabase
  credentials so LLM features are available immediately after first-run setup.
- Trailing slash stripped from provider base URLs (embedding and LLM clients) to prevent
  double-slash path errors when constructing API endpoints.
- Example config endpoints in `flashquery.example.yml` no longer include a `/v1` suffix
  — the SDK appends it automatically, so including it produced invalid double-slash URLs.
- `get_llm_usage` `recent` mode now includes the `period` field in the response envelope.
- `get_llm_usage` raises an explicit error when `to_date` is provided without `from_date`
  rather than silently ignoring the filter.
- `get_llm_usage` `pct_of_total_calls` corrected to return a fraction in `[0, 1]` rather
  than a percentage in `[0, 100]`.

## [1.1.1] - 2026-04-25

### Fixed
- Supabase Studio container always reported `(unhealthy)` in `make status` despite
  functioning correctly — Next.js 16 no longer binds to `127.0.0.1`, so the image's
  built-in healthcheck (which probes `http://localhost:3000/...`) always returned
  `ECONNREFUSED`. The healthcheck in `docker/docker-compose.yml` is now overridden
  to probe the container's network hostname instead of localhost.

## [1.1.0] - 2026-04-25

This release introduces native filesystem navigation to the vault. The new `create_directory` and `list_vault` tools give AI agents direct control over vault structure, replacing `list_files` with a significantly more capable listing interface that supports filtering by type, date, extension, and format.

### Added
- `create_directory` MCP tool for creating subdirectories within the vault, with path traversal protection and conflict detection
- `list_vault` MCP tool for browsing vault files and directories with filtering by date, type, and subdirectory
- `remove_directory` tool migrated from `documents.ts` to the new filesystem module (`files.ts`) with vault-root guard
- Shared path-validation utilities (`src/mcp/utils/path-validation.ts`): sanitization, illegal-character detection, null-byte rejection, and 4096-byte path length enforcement
- Response-format utilities: `formatTableHeader`, `formatTableRow`, `formatFileSize`, `parseDateFilter`
- Filesystem integration test suite covering 16 composition scenarios (IF-01..IF-16)
- Directed scenario test coverage for `create_directory` (34 scenarios) and `list_vault` (F-08..F-97)
- New FlashQuery MCP Tool Guide.md under /docs/

### Changed
- `remove_directory` is now part of the filesystem tool group alongside `create_directory` and `list_vault`

### Removed
- `list_files` tool replaced by the more capable `list_vault`

### Fixed
- Path traversal edge case in `create_directory` when a segment contains null bytes
- Sanitization trigger condition in `sanitized_directory_usable` that failed to activate on certain illegal character inputs
- `remove_directory`: vault-root guard now applied before path validation, preventing removal of the vault root
- Path bug in IF-03 filesystem integration test
- `SIGHUP` now triggers graceful shutdown; previously an unhandled `SIGHUP` caused Node.js to exit immediately, bypassing the shutdown coordinator and leaving Supabase connections and the git mutex in an inconsistent state

## [1.0.0] - 2026-04-23 (INITIAL OPEN SOURCE RELEASE)

### Added
- TypeScript ESM scaffold with `flashquery` CLI entry point
- YAML configuration system with Zod validation and `${ENV_VAR}` expansion
- Structured logging with stdout and file output, configurable log levels
- Supabase connection with pgvector support and two-client architecture (anon + service-role)
- Vault initialization with markdown project hierarchy and gray-matter frontmatter parsing
- Embedding providers: OpenAI, OpenRouter, Ollama
- MCP server with stdio transport — memory tools: `save_memory`, `search_memory`, `list_memories`, `list_projects`
- MCP document tools: `create_document`, `get_document`, `search_documents`
- MCP project tools: `get_project_info`
- Compound tools: `append_to_doc`, `update_doc_header`, `insert_doc_link`, `apply_tags`, `get_briefing`, `get_doc_outline`
- Relational record CRUD via plugin system with dynamic table creation
- Git integration with fire-and-forget vault commits and optional auto-push
- Unified taxonomy with tag synchronization, archive lifecycle, and memory versioning
- Discrepancy detection (`flashquery scan`) for vault/database integrity checks
- HTTP transport support via `flashquery start --transport http`
- Docker and Docker Compose configurations for full-stack, FlashQuery-only, and db-only deployments
- Interactive `setup.sh` script for guided first-run deployment
- CI/CD pipeline with GitHub Actions (lint, test, publish, Docker smoke test)
- MCP client configuration examples for Claude Desktop, Claude Code, and Cursor (stdio and HTTP)
- Community health files: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.env.example`
- Apache 2.0 license with `NOTICE`, `CLA.md`, and `CLA-CORPORATE.md`
- `npm run preflight` script and pre-push skill for CI validation before pushing
- Demo CRM plugin as reference implementation with integration tests

### Fixed
- `search_memory` and `search_all` degrade gracefully when the embedding API is unreachable
- 59 integration test failures from frontmatter field renames and MCP protocol corrections
- 10 macOS-only unit test failures in git-manager and compound tools
- Supabase builder type narrowing in the vault scanner
- Package renamed from `flashquery-core` to `flashquery`; binary standardized to `flashquery`

### Security
- Credential management via environment variables; `.gitignore` blocks `.env` commits
- DNS rebinding protection for HTTP transport
- Session cleanup on TCP disconnect for HTTP transport
- Vulnerability reporting policy in `SECURITY.md` with 48-hour response SLA

---

[Unreleased]: https://github.com/FlashQuery/flashquery/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/FlashQuery/flashquery/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/FlashQuery/flashquery/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/FlashQuery/flashquery/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/FlashQuery/flashquery/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/FlashQuery/flashquery/releases/tag/v1.0.0
