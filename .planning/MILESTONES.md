# FlashQuery Core — Milestones

## v3.8 Codebase Audit Remaining Remediation (Shipped: 2026-05-26)

**Delivered:** Remaining actionable May 2026 codebase audit remediation with behavior-preserving cleanup, type-safety hardening, document-tool decomposition, and targeted residual import-cycle cleanup.

**Phases completed:** 4 phases, 13 plans, 20 tasks
**Archive:** [milestones/v3.8-ROADMAP.md](milestones/v3.8-ROADMAP.md)
**Requirements:** [milestones/v3.8-REQUIREMENTS.md](milestones/v3.8-REQUIREMENTS.md)
**Audit:** [milestones/v3.8-MILESTONE-AUDIT.md](milestones/v3.8-MILESTONE-AUDIT.md)
**Phase artifacts:** [milestones/v3.8-phases/](milestones/v3.8-phases/)

**Key accomplishments:**

- Provider apiKey validation and vault-owned absolute path resolution for plugin reconciliation
- Dead seeder removal, safe pg cleanup diagnostics, and package metadata guards for Phase 151
- Targeted TypeScript escape cleanup for document output, scanner selects, and LLM usage aggregation without public response drift.
- Safe records search timing logs plus final validation evidence for the Phase 152 type-safety cleanup pass.
- Config loader cycle cleanup with leaf config types, leaf LLM tool policy constants, and a targeted T-U-032 madge guard.
- LLM client/resolver runtime contracts moved to leaf modules while preserving fallback behavior, cost recording, and public compatibility exports.
- MCP server and shutdown drain state now share a dependency-light lifecycle registry with preserved 15-second request drain semantics.
- Config-sync adapter contracts and injected-reference/template metadata now live in dependency-light LLM leaf modules.
- Dependency-light embedding dimension policy with storage/provider imports detached from concrete provider cycles.
- Pinned zero-cycle madge guard and full Phase 154 closure gates for residual import-cycle cleanup.

**Known deferred items at close:** 3 tech-debt items accepted from the milestone audit: transient plugin reconciliation integration table setup warning, provider-backed scenario reruns blocked by OpenAI rate limits, and broad full-suite non-document/provider/environment issues outside REQ-009. See STATE.md `## v3.8 Deferred Items`.

---

## v3.7 Technical Debt (Shipped: 2026-05-25)

**Delivered:** Priority remediation for the 23-May-2026 FlashQuery codebase audit.

**Phases completed:** 6 phases, 18 plans, 46 tasks
**Archive:** [milestones/v3.7-ROADMAP.md](milestones/v3.7-ROADMAP.md)
**Requirements:** [milestones/v3.7-REQUIREMENTS.md](milestones/v3.7-REQUIREMENTS.md)
**Audit:** [milestones/v3.7-MILESTONE-AUDIT.md](milestones/v3.7-MILESTONE-AUDIT.md)
**Phase artifacts:** [milestones/v3.7-phases/](milestones/v3.7-phases/)

**Key accomplishments:**

- Fail-closed memory plugin-scope lookup and explicit scanner embed-drain failure status with focused unit and Supabase integration coverage
- Durable pending embedding table plus a centralized helper that records retryable document, memory, and record embedding failures
- MCP write tools now route background embeddings through the durable helper and surface `embedding_deferred` in public success responses.
- Recoverable pending embeddings with scanner reachability and doctor visibility for untracked embedding gaps
- Record embedding updates and record search now use pooled Postgres access with shutdown cleanup and IS-15 coverage.
- npm audit/outdated evidence captured before edits, then wanted non-major lockfile updates applied while preserving Chevrotain and MCP SDK deferrals.
- Knip file/dependency reachability now runs from package scripts and preflight with explicit noise exclusions and T-U-015 coverage.
- Root and nested macro parser packages now resolve to Chevrotain 12 with parser, framework, typecheck, lint, and audit evidence recorded.
- MCP SDK drift is explicitly deferred to Phase 148, while audit, Knip, macro, type/lint, and preflight gates close Phase 147 with documented residuals.
- Dependency-light MCP request lifecycle tracker with RED/GREEN coverage for request counting and drain timeout metadata
- Typed registerTool wrapper composition with correlation IDs, native catalog preservation, and MCP request lifecycle tracking
- 15-second MCP shutdown drain using registered request lifecycle trackers with focused integration coverage
- Transport smoke coverage, public shutdown-during-write validation, and final green lifecycle gates for REQ-008 and REQ-009
- Dependency-light document file/hash/frontmatter primitives consumed by resolver, scanner, plugin services, and document MCP tools
- Macro runtime values, invocation context types, and error classes extracted from evaluator while preserving evaluator imports
- Macro helper modules now consume runtime primitives directly, with evaluator removed from helper runtime import paths
- Targeted madge assertions for removed document/plugin and macro cycle fragments with final command evidence recorded
- Typed WeakMap-backed config runtime metadata with REQ-012 tests for warning, host exposure, and raw LLM API key accessors

**Known deferred items at close:** 4 tech-debt items accepted from the milestone audit: fragile plugin reconciliation integration evidence, pre-existing plugin reconciliation tenant-boundary issue, unrelated baseline cycles outside REQ-010/REQ-011, and partial Nyquist validation metadata hygiene. See STATE.md `## v3.7 Deferred Items`.

---

## v3.6 Bug Fixes & Host Parity (Shipped: 2026-05-24)

**Delivered:** Bounded, index-backed template discovery plus host/delegated native help parity.

**Phases completed:** Phase 144 (6 plans)
**Archive:** [milestones/v3.6-ROADMAP.md](milestones/v3.6-ROADMAP.md)
**Requirements:** [milestones/v3.6-REQUIREMENTS.md](milestones/v3.6-REQUIREMENTS.md)
**Audit:** [milestones/v3.6-MILESTONE-AUDIT.md](milestones/v3.6-MILESTONE-AUDIT.md)

**Key accomplishments:**

- Removed ordinary non-template `not_template` warning noise from template discovery, purpose metadata, and search surfaces while preserving genuine template diagnostics.
- Added template-scoped `fqc_documents.template_meta` and kept it current through write, copy, scanner, and backfill paths.
- Switched production template discovery and macro template metadata to indexed active document rows instead of request-path vault walks.
- Updated `list_purposes` so permissive mode emits exposed `template_tools` once at top level while restrictive mode keeps per-purpose template tools.
- Extracted a shared native dispatch core for delegated model calls and host MCP `tools/call`.
- Added host-native `help: true` parity, optional native help schema advertisement, hidden-tool exposure gating, and brokered-tool pass-through preservation.

**Stats:**

- 36 files changed in the focused phase range
- 2,409 insertions / 249 deletions
- 1 phase, 6 plans, 18 scoped requirements
- Timeline: 2026-05-21 18:01 → 2026-05-21 22:11

**Git range:** `af11fd4` → `d5e012e`

---

## v3.5 MCP Broker (Shipped: 2026-05-19)

**Delivered:** FlashQuery stdio MCP broker for host, delegated model, and macro tool surfaces.

**Phases completed:** Phases 139-143 (34 plans)
**Archive:** [milestones/v3.5-ROADMAP.md](milestones/v3.5-ROADMAP.md)
**Requirements:** [milestones/v3.5-REQUIREMENTS.md](milestones/v3.5-REQUIREMENTS.md)
**Audit:** [milestones/v3.5-MILESTONE-AUDIT.md](milestones/v3.5-MILESTONE-AUDIT.md)

**Key accomplishments:**

- Added `mcp_servers`, host broker visibility, purpose broker visibility, per-tool cost, and description override configuration.
- Built the stdio broker foundation with lazy spawn, restart-on-death, timeout handling, stderr capture, shutdown grace, and process-scoped TOFU state.
- Introduced registry-keyed brokered tool discovery and dispatch for delegated model calls and macro execution while preserving raw `CallToolResult` semantics.
- Added schema pinning, `tools/list_changed` drift handling, approval/rejection flows, audit events, and macro `needs_user_input` signaling.
- Shipped pure TypeScript BM25 tool search, `fq.search_tools`, validated `.tool.md` metadata, help pages, and description override propagation.
- Exposed host-visible brokered tools through the host MCP surface with shared `ConsumerContext`, trace inheritance, host search, and shared lazy-spawn/TOFU behavior.
- Added diagnostic `flashquery list-tools <server>`, macro `_self`, `continue`/`break`, deep `<server>._exists()`, and shared broker concurrency coverage.

**Stats:**

- 5 phases, 34 plans, 118 requirements
- Milestone audit passed: 118/118 requirements, 5/5 phases, 9/9 integration paths, 6/6 flows
- Shipped: 2026-05-19

---

## v3.4 macro-support (Shipped: 2026-05-17)

**Phases completed:** 9 phases, 36 plans, 73 tasks
**Archive:** [milestones/v3.4-ROADMAP.md](milestones/v3.4-ROADMAP.md)

**Key accomplishments:**

- `call_macro` now runs deterministic inline and vault-backed macro workflows through the public MCP handler.
- The v0 macro language ships with parser, evaluator, scoped variables, control flow, structured termination, input variables, and standard builtins.
- Macro tool dispatch routes through FlashQuery's native registry with host/delegated allowlists, static permission pre-scan, hard exclusions, and dispatch-time backstops.
- Macro execution includes vault-jailed read-only shell verbs, `_exists()` namespace introspection, task lifecycle, cooperative cancellation, trace, progress, dry-run, warnings, and budgets.
- Source resolution supports `source_ref`, named `fqm` blocks, archived-source hiding, and canonical invalid-input/not-found error envelopes.
- Full closure evidence exists across unit, integration, E2E, directed scenario, YAML scenario, POC fixture, verification, and milestone audit layers.

**Known deferred items at close:** 1 acknowledged UAT audit label/status mismatch for Phase 130 with 0 open scenarios; see STATE.md `## Deferred Items`.

---

## v3.3 MCP Tools Consolidation (Shipped: 2026-05-14)

**Phases completed:** 9 phases, 46 plans, 67 tasks

**Key accomplishments:**

- Central MCP tool metadata registry with delegated tier selection and catalog-backed completeness checks
- Shared JSON MCP response helpers now back a representative get_document path with unit, integration, E2E, and build proof.
- Frontmatter constants and scenario JSON assertion scaffolding now cover helper-backed MCP responses in unit, directed, and YAML integration layers.
- get_document expected errors now use canonical JSON envelopes with isError:false across unit and integration coverage
- archive_document now returns ordered JSON document identification blocks with persisted, idempotent archived_at lifecycle state
- copy_document and move_document now return structured document identification JSON with canonical expected errors and protocol/scenario coverage
- list_vault now returns parseable JSON entries with include-gated metadata/tracking fields and full five-layer coverage
- Memory lifecycle schema and shared output helpers now support final search and memory tool contracts.
- Mode-based memory writes, JSON memory reads, and chain archival now match the final MCP contract.
- The final `search` primitive is registered with JSON output, mode validation, domain degradation, and deterministic merge helpers.
- Final search and memory tools now pass Supabase-backed integration and MCP protocol round-trip coverage.
- Traceability, trash-folder config, recovery frontmatter, response builders, and final metadata contracts for Phase 127 destructive/admin tools.
- Final `manage_directory` create/remove surface with ordered JSON results, path-safe validation, and directory-scoped locking.
- Final `maintain_vault` admin surface with sync, repair, dry-run, background status, conflict, and shutdown semantics.
- `remove_document` now archives document lifecycle state before hard-delete or trash move, with git-aware vault helpers and destructive-safety integration coverage.
- Final Phase 127 removal, directory, and vault maintenance tools now have MCP protocol, directed scenario, and YAML integration coverage using public final tool names.
- Phase 127 final verification closed with green focused gates, local legacy/prose/frontmatter audits, traceability links, and explicit Phase 128 cleanup exclusion.
- Traceability and legacy audit vocabulary now anchor Phase 128 cleanup before source removal begins
- Central metadata, host validation, delegated registry tests, and protocol discovery now encode the final reduced tool surface
- Active removed/dead MCP handler registrations are gone, with focused tests reduced to final-surface assertions
- Delegated read/write tiers now derive from canonical tool metadata with data-category filtering and U-tier unit coverage.
- Metadata-derived delegated tiers are now proven through unit guards, purpose registry assembly, and call_model public metadata.
- POST-01 is closed with directed and YAML scenario evidence, coverage ledgers, delegated tier docs, and PR-ready migration callout text.

---

## v3.2 Agentic LLM Tools (Shipped: 2026-05-07)

**Phases completed:** 9 phases (112-120)
**Audit:** [milestones/v3.2-MILESTONE-AUDIT.md](milestones/v3.2-MILESTONE-AUDIT.md)

**Key accomplishments:**

- Migrated `call_model` toward agentic mode envelopes with discovery/help short-circuit behavior.
- Added document reference hydration, template parameterization, purpose config bindings, and capability admission.
- Built model-visible native/template tool registry assembly and Mode 2 agent-loop execution.
- Added template discovery and masquerade dispatch, discovery diagnostics, help resolver behavior, and cross-phase ATL validation.
- Final audit passed 62/62 requirements, 9/9 phases, 9/9 integration checks, and 15/15 user flows.

---

## v3.1 Call Model With Reference (Shipped: 2026-05-05)

**Scope:** 17 phases (98-111 + 999.5/999.6/999.9 sidecars) | 52 plans
**Stats:** 262 commits, 209 files changed (25 src/, 166 tests/), +28,161 / -3,171 LOC
**Timeline:** 2026-04-28 → 2026-05-05 (8 days)
**Tests at close:** 1,439 unit / 18 integration / preflight clean
**v3.0 audit:** [milestones/v3.0-MILESTONE-AUDIT.md](milestones/v3.0-MILESTONE-AUDIT.md)

**Note on scope:** v3.0 (Native LLM Access, phases 98-106) was never formally archived via the GSD CLI. This v3.1 close therefore archives both v3.0 and v3.1 work into a single milestone-of-record. The live ROADMAP.md retains the v3.0/v3.1 distinction for historical reference.

**Key Accomplishments:**

- Three-layer LLM config (`providers` × `models` × `purposes`) parsed from `flashquery.yml` with case normalization, four `fqc_llm_*` Supabase tables synced on startup, and `fqc_llm_usage` table created (Phase 98)
- LLM completions client supporting OpenAI-compatible providers + Ollama (LAN-aware via `nodeFetch`), with typed `LlmHttpError`/`LlmNetworkError` and timeout handling (Phase 99)
- Purpose resolver with fallback chain, three-level parameter merge (caller → purpose → model/provider), and transient-vs-permanent error classification (Phase 100)
- `call_model` MCP tool with diagnostic response envelope, `trace_id` echo + `trace_cumulative` aggregation, always-registered (visible even when LLM is unconfigured) (Phase 101)
- Fire-and-forget cost tracking to `fqc_llm_usage` with SIGTERM drain via `ShutdownCoordinator`, `_direct` sentinel for resolver-bypass calls, write-failure isolation (Phase 102)
- `get_llm_usage` MCP tool with four aggregation modes (summary/by_purpose/by_model/recent), client-side TypeScript grouping over usage rows (Phase 103)
- Embedding migration to the new three-layer config; legacy flat `llm:` config detection at startup with clear migration error (Phase 104, 98)
- Consolidated `get_document` MCP tool: structured JSON envelope with `identifier`/`title`/`path`/`fq_id`/`modified`/`size.chars`, `include` parameter for body/frontmatter/headings, case-insensitive section matching, `get_doc_outline` removed (Phase 107, GDOC-01..10)
- Batch + `follow_ref`: array `identifiers[]` with per-element partial-failure semantics, dot-path frontmatter pointer traversal applied uniformly to single and batch calls (Phase 108, FREF-01..05)
- Reference syntax in `call_model`: `{{ref:path}}`, `{{ref:path#Section}}`, `{{ref:path->pointer}}`, `{{id:uuid}}` placeholders inline-resolved before LLM dispatch, with `injected_references[]` + `prompt_chars` in response metadata, fail-fast on unresolvable refs (Phase 109, REFS-01..07)
- Discovery resolvers: `list_models`, `list_purposes`, `search` with hard cost metrics from config; `messages` optional for discovery; `local: true` auto-derived for Ollama-backed models; `description`/`context_window`/`capabilities` omit-when-undeclared per OQ #16 (Phase 110, DISC-01..06)
- CMR verification fix-ups: `occurrence_out_of_range` error code, value-bound assertion hardening (TC1..TC4 waves), discovery resolver Phase 4 test scenarios (Phase 111)

**Known deferred items at close:** 28 (10 stale debug sessions in non-terminal status states, 14 dangling quick-task index entries, 4 audit label/status mismatches on completed UAT files — all predate v3.1; see STATE.md `## Deferred Items`)

---

## v2.9: Filesystem Primitive Tools (Shipped: 2026-04-25)

**Scope:** 7 phases (91–97) + Phase 90 pre-milestone | 13 core plans + 7 pre-milestone plans
**Stats:** 154 commits, 225 files changed, 26,947 insertions, 7,210 deletions
**Timeline:** 2026-04-21 → 2026-04-25 (4 days)
**Tests at close:** 1,199 unit / 47 integration passing

**Key Accomplishments:**

- **`create_directory` MCP tool** — new filesystem tool in `files.ts` with batch support (up to 50 paths), segment sanitization, partial-success semantics, path traversal protection, and idempotency; 7 directed test files (F-19..F-52)
- **`list_vault` MCP tool** — full replacement for `list_files`; DB-enriched metadata, table/detailed formats, show modes (files/directories/all), date and extension filtering, real file sizes; 7 directed test files (F-08..F-97) verified live 2026-04-25
- **`files.ts` filesystem module** — canonical home for all vault filesystem primitives; `remove_directory` migrated from `documents.ts`; `path-validation.ts` utility with 5 shared functions (validateVaultPath, normalizePath, joinWithRoot, sanitizeDirectorySegment, validateSegment)
- **16 integration tests (IF-01..IF-16)** — filesystem composition scenarios: create→list→remove lifecycle, plugin scaffold workflows, format modes, cross-tool regression
- **Plugin documentation updated** — fq-base README, file-browse.md, vault-maintenance.md + fq-skill-creator SKILL.md and flashquery-tools.md all reflect new tool surface; zero stale `list_files` references
- **Phase 90: Frontmatter centralization** — FM constants object, fqc_* → fq_* rename across 26 files; user-defined fields now appear before FQ-managed fields in all vault writes

**Archive:** [milestones/v2.9-ROADMAP.md](milestones/v2.9-ROADMAP.md)

---

## v2.8: Plugin Callback Overhaul (Shipped: 2026-04-21)

**Scope:** 6 phases (84–89), 26 plans
**Archive:** [milestones/v2.8-ROADMAP.md](milestones/v2.8-ROADMAP.md)
**Audit:** [milestones/v2.8-MILESTONE-AUDIT.md](milestones/v2.8-MILESTONE-AUDIT.md)

---

## v2.6: Test Infrastructure & Quality (Shipped: 2026-04-15)

**Scope:** Phases 72-80
**Audit:** [milestones/v2.6-MILESTONE-AUDIT.md](milestones/v2.6-MILESTONE-AUDIT.md)

**Archive note:** This legacy audit recorded gaps at the time of audit; later milestones and maintenance phases carried forward the remaining cleanup. The audit artifact is archived here so no milestone-close evidence remains at `.planning/` root.

---

## v2.5 + v2.5.1: New MCP Document Tools + Gap Closure (Shipped: 2026-04-14)

**Scope:** 8 core phases (61-68) + 3 maintenance phases (69-71)  
**Total Effort:** 47,248 insertions, 2,401 deletions across 186 files  

**Key Accomplishments:**

- **19 specifications** fully implemented and verified
- **37 MCP tools** documented and functional (section tools, advanced ops, plugin system)
- **Response format standardization** across all tools (key-value, batch mode)
- **Plugin lifecycle management** (register → schema migration → unregister)
- **Security hardening** (path traversal defense, DDL migrations, plugin warnings)
- **Complete test coverage** (40/40 E2E tests, 1115+ unit tests)

**v2.5.1 Gap Closure (Phases 69-71):**

- SPEC-19: DDL migration wired into startup ✅
- SPEC-07: Path traversal validation hardened (resolve+relative pattern) ✅
- SPEC-05: Plugin ownership warning implemented ✅
- SPEC-02: Architectural drift fixed (replace_doc_section refactored) ✅
- Test suite: All assertions updated, E2E isolation fixed ✅

**Status:** Production ready

---

## v2.4: Plugin Discovery & Document Interoperability (Shipped: 2026-04-12)

**Scope:** 12 phases (54-60b + code review), 22 plans, 39 tasks

**Key Accomplishments:**

- Plugin discovery system with manifest loading and file change notifications
- Document interoperability with fqc_id preservation and atomic writes
- Scanner architecture refactored for reliability
- 5 code review issues fixed (async chains, dedup logic, path validation)
- Integration test infrastructure hardened
- Code review: resolve+relative path traversal guard, centralized UUID validation

---

## v2.3: HTTP Authentication & Interoperability (Shipped: 2026-04-09)

**Scope:** 4 phases (49-52)

---

## v2.2: Status Model Refactor & Infrastructure Hardening (Shipped: 2026-04-08)

**Scope:** 4 phases (45-48)

---

## v2.1: Test Suite Recovery (Shipped: 2026-04-07)

**Scope:** 12 phases, 31 plans, 57 tasks

**Key Accomplishments:**

- Crash-safe vault writes via atomic .fqc-tmp pattern
- Scan mutex serialization and duplicate detection
- 4-tier identity resolution chain validated end-to-end
- 553/553 unit tests passing

---

## v2.0: Doc Sync Overhaul (Shipped: 2026-04-07)

**Scope:** 5 phases (36-40)

---

## v1.9: MCP Tool Overhaul (Shipped: 2026-04-06)

**Scope:** 4 phases (30-33)

---

## Previous Releases

For detailed information about v1.0-v1.8, see [milestones/](milestones/) directory.

---

## Current Status

**Latest Release:** v2.5 + v2.5.1 (2026-04-14)  
**Next Milestone:** v2.6 (planning phase)  
**For planning:** See REQUIREMENTS.md and ROADMAP.md

---

*Last updated: 2026-04-14 after v2.5 completion*
