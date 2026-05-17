# Changelog

All notable changes to FlashQuery will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.1.0] - 2026-05-17

This release introduces FlashQuery macros: a deterministic orchestration layer for multi-step MCP workflows. Macros can call approved FlashQuery tools, branch on structured results, load reusable source blocks from vault documents, and expose dry-run, trace, progress, timeout, and cancellation controls for safer automation.

### Added
- Add `call_macro` as a host MCP tool for running inline macros or vault-backed `source_ref` macro blocks.
- Add the FlashQuery macro language runtime with lexer/parser support, bindings, loops, conditionals, pipelines, structured `exit`, `fail`, `input_var`, and recoverable tool-error branching.
- Add macro dispatch through the native FlashQuery tool registry, with host exposure filtering, delegated-call hard exclusions, permission pre-scan diagnostics, and template-masquerade protection.
- Add macro source libraries through fenced `fqm` blocks, including named-block selection with `path::name` references and archived-source hiding.
- Add macro observability and controls, including task IDs, isolated invocation scope, cancellation safe points, trace modes, milestone progress notifications, dry-run analysis, token/model/external-tool budgets, and timeout envelopes.
- Add read-only macro shell verbs with vault-jailed path handling, forbidden mutation-flag rejection, brokered `_exists` checks, and namespace introspection.
- Add runnable macro examples and POC fixtures covering common document, shell, input, cancellation, and recovery workflows.

### Changed
- Keep `call_macro` out of delegated model-visible native tool registries so recursive model orchestration stays host-controlled.
- Run the full directed and integration scenario suites by default.
- Update the MCP tool guide, architecture notes, LLM provider guidance, and setup docs for the current macro and final MCP tool surfaces.
- Keep macro parser dependencies compatible with the existing Node.js 20+ support contract.

### Fixed
- Fix macro task lifecycle cleanup so failed macro tasks are cleared on unexpected errors.
- Fix macro cancellation and timeout behavior so execution stops at safe points without continuing later side effects.
- Fix macro source selector validation and source-ref error envelopes before execution.
- Fix macro builtin validation, registry allowlist separation, permission pre-scan coverage, and delegated hard-exclusion handling.
- Fix heading extraction so Markdown headings inside fenced code blocks do not affect document outline or section-boundary behavior.
- Fix directed and integration scenario coverage for final JSON tool contracts, call-model fallback behavior, reconciliation workflows, and macro scenario closure.

### Security
- Enforce JWT `nbf` and `exp` claims for newly issued access and refresh tokens while preserving compatibility with legacy signed tokens and raw-secret bearer auth.
- Harden macro shell execution boundaries by rejecting vault-jail escapes and forbidden mutation flags before execution.
- Harden macro dispatch boundaries by rejecting forbidden native tool references before any nested result or side effect can occur.

## [3.0.0] - 2026-05-14

This release consolidates FlashQuery's MCP surface into a smaller, structured, metadata-backed tool set. It replaces legacy one-off tools with final primitives for documents, memories, search, records, directories, and vault maintenance, while standardizing JSON response contracts across the public MCP API.

### Added
- Add centralized MCP tool metadata for host exposure, delegated model exposure, categories, tiers, legacy-name suggestions, and hard-exclusion rules.
- Add shared JSON response helpers for success envelopes, canonical error envelopes, warnings, batch responses, and entity identification blocks.
- Add `host_mcp_tools` configuration for filtering the host-visible MCP surface by exact tool name, tier, category, and final exclusions.
- Add `write_document` as the final document create/update primitive, including reserved frontmatter protection and structured document identification output.
- Add `write_memory` as the final memory create/update primitive, including versioned memory updates and structured memory identification output.
- Add unified `search` across documents and memories, with explicit filesystem, semantic, and mixed modes plus list-mode support.
- Add `write_record` as the final plugin record create/update primitive with schema-aware validation and structured record identification output.
- Add `remove_document` for archive-before-trash/delete document removal with ordered batch results and git-aware filesystem handling.
- Add `manage_directory` for create/remove directory operations with ordered per-path JSON results, idempotent creation, empty-directory-only removal, and traversal protection.
- Add `maintain_vault` for vault `sync`, `repair`, and `status` operations with structured action results, dry-run repair support, background sync jobs, and conflict handling.
- Add delegated tier derivation from canonical tool metadata so `tier:read-only` and `tier:read-write` stay aligned with the final data-tool surface.

### Changed
- Standardize migrated MCP tool responses around parseable JSON envelopes instead of prose/table-oriented output.
- Change expected validation, not-found, permission, conflict, unsupported, and partial-batch failures to return canonical JSON envelopes instead of runtime errors.
- Change `get_document`, `archive_document`, `copy_document`, `move_document`, and `list_vault` to return structured JSON while preserving their core behavior.
- Change `insert_in_doc` and `replace_doc_section` to expose explicit nested-section semantics and structured mutation metadata.
- Change `apply_tags` to accept explicit cross-domain targets for documents and memories.
- Change plugin registration, plugin info, record read/search/archive, and pending-review tools to return structured plugin, record, and review envelopes.
- Change delegated model tool tiers to include corrected data tools such as `list_vault`, `copy_document`, `insert_in_doc`, and `replace_doc_section`, while keeping admin, LLM, host-ineligible, and hard-excluded tools out of broad tier expansion.
- Update MCP tool documentation, LLM delegated-tool guidance, architecture docs, and example configuration to describe the final consolidated surface.

### Removed
- **BREAKING:** Remove legacy document tools `create_document`, `update_document`, `update_doc_header`, `append_to_doc`, and `search_documents`; use `write_document`, `insert_in_doc`, and `search` instead.
- **BREAKING:** Remove legacy memory tools `save_memory`, `update_memory`, `search_memory`, and `list_memories`; use `write_memory`, `get_memory`, `archive_memory`, and `search` instead.
- **BREAKING:** Remove legacy search tool `search_all`; use `search` with `entity_types` instead.
- **BREAKING:** Remove legacy directory and maintenance tools `create_directory`, `remove_directory`, `force_file_scan`, and `reconcile_documents`; use `manage_directory` and `maintain_vault` instead.
- **BREAKING:** Remove legacy record tools `create_record` and `update_record`; use `write_record` instead.
- **BREAKING:** Keep dead project tools `list_projects` and `get_project_info` absent from the MCP surface.
- Remove stale source, tests, scenario references, and docs guidance for removed legacy tools except explicit migration-reference tables.

### Fixed
- Preserve canonical expected-error envelopes for `get_document` and other migrated tools without incorrectly marking expected failures as runtime errors.
- Preserve document identity and reference durability across copy, move, archive, remove, and section-edit workflows.
- Harden document write validation around path conflicts, reserved frontmatter, tag operations, and section replacement/deletion.
- Harden search and memory consolidation behavior for archived filtering, disabled-category degradation, list mode, global limits, and versioned memory updates.
- Harden record and plugin consolidation around generated-field rejection, unknown-field validation, include-gated data, taggable record search, and pending-review actions.
- Harden vault maintenance and directory behavior around concurrent maintenance conflicts, background job status, non-empty directory conflicts, traversal rejection, trash collision handling, and timestamped trash overwrites.
- Fix delegated LLM tool exposure so the final `search` tool and corrected tier-derived data tools are available where configured.

## [2.0.0] - 2026-05-07

This release turns `call_model` into a bounded agentic delegation surface.
Purposes can now expose native FlashQuery tools and template-backed skills to
delegated models, with capability admission, loop guardrails, usage accounting,
and discovery diagnostics built into the protocol.

### Added
- Managed tool loops for `call_model` purpose calls, including native FlashQuery
  tool dispatch, final assistant envelopes, bounded iteration/cost/token/time
  guardrails, cooperative shutdown handling, and `metadata.tools` diagnostics.
- Purpose-level native tool exposure via configured tool tiers, explicit tool
  names, and `excluded_tools`, with protected tools kept out of delegated
  model-visible registries.
- Template parameterization for document references via `template_params`,
  including path-keyed templates, aliases with `_template`, ordered `_items`
  lists, document parameters, defaults, and typed template validation failures
  before provider dispatch.
- Template-backed model-visible tools generated from vault documents with
  `fq_template`, `fq_expose_as_tool`, `fq_namespace`, `fq_desc`, and `fq_params`
  frontmatter.
- Purpose template binding storage and startup sync through
  `fqc_purpose_templates`, preserving runtime-over-YAML precedence and restoring
  YAML bindings after runtime removal.
- `call_model` `return_messages` support for execution calls, returning hydrated
  input messages plus the final assistant message when requested.
- `call_model` `resolver: "help"` for a no-network protocol help payload
  covering execution, discovery, references, templates, tools, guardrails, and
  examples.
- Richer discovery diagnostics in `list_models`, `list_purposes`, and `search`,
  including capability states, native tool diagnostics, template tool metadata,
  dangling template paths, collisions, and help metadata.

### Changed
- **BREAKING:** `{{id:...}}` placeholders are now treated as literal text. Use
  `{{ref:<fq_id>}}`, `{{ref:path}}`, `{{ref:path#Section}}`, or
  `{{ref:path->pointer}}` for active document hydration.
- `call_model` purpose execution now validates model capabilities before
  provider dispatch when tools, templates, usage-on-tool-calls, or structured
  outputs with tools are requested.
- `list_purposes` now exposes fresh template-tool metadata from vault
  frontmatter on each discovery call.
- LLM configuration examples now include first-class purpose tooling, template
  bindings, structured capability fields, local provider metadata, and loop
  guardrail defaults.
- Docker and setup guidance now align with the LLM configuration model and
  bundled environment templates.

### Fixed
- Preserve unknown-purpose errors and make discovery/help diagnostics actionable
  instead of collapsing distinct configuration failures.
- Harden template tool dispatch with provider-safe generated names, reserved
  `flashquery_` prefix handling, collision diagnostics, symlink rejection, and
  reverse-map routing.
- Preserve optional template parameters in strict schemas and reject plain
  documents masquerading as invalid templates.
- Keep aggregate usage rows correct for managed tool loops, including trace
  filtering, direct model calls, and no-usage-row discovery/help/reference-failure
  paths.
- Keep the full-stack Docker Compose configuration on Docker-specific
  environment wiring.
- Fix the config-template preflight test harness so active `${OLLAMA_URL}`
  example providers validate with the documented default.

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

[Unreleased]: https://github.com/FlashQuery/flashquery/compare/v3.1.0...HEAD
[3.1.0]: https://github.com/FlashQuery/flashquery/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/FlashQuery/flashquery/compare/v2.0.0...v3.0.0
[2.0.0]: https://github.com/FlashQuery/flashquery/compare/v1.3.0...v2.0.0
[1.3.0]: https://github.com/FlashQuery/flashquery/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/FlashQuery/flashquery/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/FlashQuery/flashquery/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/FlashQuery/flashquery/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/FlashQuery/flashquery/releases/tag/v1.0.0
