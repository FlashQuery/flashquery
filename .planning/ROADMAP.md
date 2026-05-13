# Roadmap: FlashQuery Core

## Milestones

- ✅ **v1.0 MVP** — Phases 1-9 (shipped 2026-03-25)
- ✅ **v1.5 Full MVP** — Phases 10-16 (shipped 2026-03-27)
- ✅ **v1.6 Prep for Open Source** — Phases 17-21 (shipped 2026-03-30)
- ✅ **v1.7 Issues Resolution & Pre-Release Hardening** — Phases 22-25 (shipped 2026-03-31)
- ✅ **v1.8 Bug Fixes: Plugin Scope & Token Security** — Phases 28-29 (shipped 2026-04-01)
- ✅ **v1.9 MCP Tool Overhaul** — Phases 30-33 (shipped 2026-04-06)
- ✅ **v2.0 Doc Sync Overhaul** — Phases 36-40 (shipped 2026-04-07)
- ✅ **v2.1 Test Suite Recovery** — Phases 41-44 (shipped 2026-04-07)
- ✅ **v2.2 Status Model Refactor & Infrastructure Hardening** — Phases 45-48 (shipped 2026-04-08)
- ✅ **v2.3 HTTP Authentication & Interoperability** — Phases 49-52 (shipped 2026-04-09)
- ✅ **v2.4 Plugin Discovery & Document Interoperability** — Phases 54-60b + code review (shipped 2026-04-12)
- ✅ **v2.5 New MCP Document Tools** — Phases 61-68 (shipped 2026-04-13)
- ✅ **v2.5.1 Gap Closure & Test Maintenance** — Phases 69-71 (shipped 2026-04-14)
- ✅ **v2.6 Test Infrastructure & Quality** — Phases 72-80 (shipped 2026-04-15)
- ✅ **v2.7 Name Change & Pre-Launch Preparation** — Phase 83 (shipped 2026-04-16)
- ✅ **v2.8 Plugin Callback Overhaul** — Phases 84-89 (shipped 2026-04-21)
- ✅ **v2.9 Filesystem Primitive Tools** — Phases 90-97 (shipped 2026-04-25)
- ✅ **v3.0 Native LLM Access** — Phases 98-106 (shipped 2026-04-30)
- ✅ **v3.1 Call Model With Reference** — Phases 107-111 (shipped 2026-05-05)
- ✅ **v3.2 Agentic LLM Tools** — Phases 112-120 (shipped 2026-05-07)
- 🚧 **v3.3 MCP Tools Consolidation** — Phases 121-128 (planning)

## Current Milestone: v3.3 MCP Tools Consolidation

**Goal:** Consolidate, update, and standardize all FlashQuery MCP tools with a smaller final surface, consistent JSON contracts, shared host/delegated selection rules, and complete phase-local test coverage.

**Planning sources:**
- MCP Tool Consolidation Requirements.md
- MCP Tool Consolidation Test Plan.md
- `tests/scenarios/directed/*`
- `tests/scenarios/integration/*`

**Milestone test rule:** Every implementation phase must create or update unit, integration, E2E, directed scenario, and integration scenario coverage for the behavior it changes before that phase can complete. Phase 128 is an audit and cleanup phase, not a deferred test dump.

## Proposed Roadmap

**8 phases** | **56 requirements mapped** | All covered

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|------------------|
| 121 | Foundation: Metadata, Response Helpers, Test Harness | 3/3 | Complete    | 2026-05-11 |
| 122 | Host Tool Exposure Config | 4/4 | Complete    | 2026-05-11 |
| 123 | Document Read + Standard Output Migration | 4/4 | Complete    | 2026-05-12 |
| 124 | Document Write Primitives | 7/7 | Complete    | 2026-05-12 |
| 125 | Unified Search + Memory Consolidation | 6/6 | Completed |  |
| 126 | Plugin + Record Consolidation | 5/5 | Complete   | 2026-05-12 |
| 127 | Removal, Directory, And Vault Maintenance | 6/6 | Complete    | 2026-05-12 |
| 128 | Legacy Surface Removal + Final Audit | 2/8 | In Progress|  |

## Phase Details

### Phase 121: Foundation: Metadata, Response Helpers, Test Harness

**Goal:** FlashQuery has the shared metadata, response, frontmatter, and coverage scaffolding needed to migrate tools consistently.

**Depends on:** Phase 120

**Requirements:** FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07, FND-08, TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, TEST-06

**Success Criteria** (what must be TRUE):
1. Tool metadata has one canonical source for names, categories, host eligibility, delegated eligibility, tiers, and hard exclusions.
2. Shared JSON response helpers can emit success payloads, error envelopes, warnings, batch envelopes, and all required entity identification blocks.
3. Canonical expected-error handling and `isError` semantics are covered by focused unit tests and at least one representative handler integration test.
4. Frontmatter field usage in new/migrated foundation code goes through `FM.*` constants.
5. Phase-local traceability format exists and points to concrete unit, integration, E2E, directed scenario, and integration scenario coverage targets.
6. Phase validation runs the new foundation unit/integration/E2E/scenario checks that prove later phases have a stable test pattern.

**Plans:** 3/3 plans complete

**UI hint:** no

### Phase 122: Host Tool Exposure Config

**Goal:** Host MCP tool exposure and delegated model tool exposure resolve from the same selector grammar and metadata registry.

**Depends on:** Phase 121

**Requirements:** CFG-01, CFG-02, CFG-03, CFG-04, CFG-05, CFG-06

**Success Criteria** (what must be TRUE):
1. `host_mcp_tools.tools` and `host_mcp_tools.excluded_tools` parse, validate, and default to today's all-tools-enabled host behavior.
2. Tier, category, explicit-name, additive `doc-write` -> `doc-read`, and final exclusion semantics are implemented for host registration.
3. Delegated native tool assembly starts from the host-enabled set and still applies purpose/model eligibility and hard exclusions.
4. Legacy removed tool names in purpose config fail startup with actionable replacement suggestions.
5. Suspicious category combinations warn without blocking startup.

**Required phase coverage:** Unit tests for selector expansion and validation; integration tests for server registration/listTools; E2E protocol coverage for host-filtered tool listing; directed and integration scenarios for host/delegated filtering.

**Plans:** 4/4 plans complete

Plans:
- [x] 122-01-PLAN.md — Create host selector/config resolution and phase traceability.
- [x] 122-02-PLAN.md — Gate MCP registration and prove host-filtered `listTools`.
- [x] 122-03-PLAN.md — Enforce delegated host intersection and legacy-name validation.
- [x] 122-04-PLAN.md — Add scenario coverage and phase validation evidence.

**UI hint:** no

### Phase 123: Document Read + Standard Output Migration

**Goal:** Existing document read/list/archive/copy/move tools return structured JSON and canonical errors while preserving shipped behavior.

**Depends on:** Phase 122

**Requirements:** DOC-01, DOC-02, DOC-05

**Success Criteria** (what must be TRUE):
1. `get_document` single-result expected errors match canonical batch error envelopes and use `isError: false`.
2. `archive_document` returns ordered identification blocks with persisted `archived_at`, idempotent re-archive behavior, and per-element batch errors.
3. `copy_document` and `move_document` return document identification blocks for the affected destination/current document.
4. `list_vault` returns structured entries instead of table text, with documented optional metadata/tracking payload.
5. Unit, integration, E2E, directed scenario, and integration scenario coverage are updated in the same phase for every touched read/list/archive/copy/move behavior.

**Plans:**
- [x] 123-01-PLAN.md — Create traceability foundation and canonicalize `get_document` expected errors.
- [x] 123-02-PLAN.md — Migrate `archive_document` JSON output and persisted `archived_at` semantics.
- [x] 123-03-PLAN.md — Migrate `copy_document` and `move_document` JSON identification outputs.
- [x] 123-04-PLAN.md — Migrate `list_vault` structured JSON output and close scenario/E2E coverage.

**UI hint:** no

### Phase 124: Document Write Primitives

**Goal:** Document writes are consolidated into explicit primitives with structured output and markdown-aware edit semantics.

**Depends on:** Phase 123

**Requirements:** DOC-03, DOC-04, DOC-06, DOC-07, DOC-08

**Success Criteria** (what must be TRUE):
1. `write_document(mode:"create")` creates documents and rejects path conflicts, accidental `identifier`, and reserved frontmatter fields.
2. `write_document(mode:"update")` updates one resolved document and absorbs frontmatter-only update behavior without changing omitted fields.
3. `insert_in_doc` and `replace_doc_section` expose explicit nested-section behavior and return structured mutation metadata.
4. `apply_tags` uses explicit document/memory targets and returns ordered per-target results with disabled-domain failures in place.
5. Legacy create/update/header/append behavior is ported into new tests before those legacy tools are removed later.
6. Unit, integration, E2E, directed scenario, and integration scenario coverage ship with the phase.

**Plans:** 7/7 plans complete

Plans:
**Wave 1**
- [x] 124-01-PLAN.md — Create traceability and implement `write_document` create/update primitives.

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 124-02-PLAN.md — Migrate `insert_in_doc` nested-section semantics and JSON metadata.

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 124-03-PLAN.md — Migrate `replace_doc_section` nested replacement/deletion semantics.

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 124-04-PLAN.md — Migrate `apply_tags` explicit targets and ordered results.

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 124-05-PLAN.md — Update scenario coverage ledgers and traceability before scenario edits.

**Wave 6** *(blocked on Wave 5 completion)*
- [x] 124-06-PLAN.md — Port directed Python scenarios to final Phase 124 primitives.

**Wave 7** *(blocked on Wave 6 completion)*
- [x] 124-07-PLAN.md — Port YAML integration scenarios and close Phase 124 validation evidence.

**UI hint:** no

### Phase 125: Unified Search + Memory Consolidation

**Goal:** Search and memory tools collapse into a consistent, structured surface that supports mixed document/memory workflows.

**Depends on:** Phase 124

**Requirements:** SRCH-01, SRCH-02, SRCH-03, SRCH-04, SRCH-05, SRCH-06, MEM-01, MEM-02, MEM-03, MEM-04

**Success Criteria** (what must be TRUE):
1. `search` replaces legacy document/memory search surfaces with filesystem, semantic, mixed, and list-mode behavior.
2. Search defaults, empty-query validation, archived filtering, disabled-category degradation, score/source merge, and global limit ordering match the source spec.
3. `write_memory(mode:"create")` and `write_memory(mode:"update")` replace save/update semantics, including latest-version transaction behavior.
4. `get_memory` and `archive_memory` use `memory_ids`, ordered batch semantics, optional content include behavior, and structured memory identification blocks.
5. Legacy memory/search coverage is ported to the consolidated tools before removal.
6. Unit, integration, E2E, directed scenario, and integration scenario coverage ship with the phase.

**Plans:** 6/6 plans executed

**UI hint:** no

### Phase 126: Plugin + Record Consolidation

**Goal:** Plugin and record tools use structured plugin/record envelopes, explicit actions, and unified record writes.

**Depends on:** Phase 125

**Requirements:** REC-01, REC-02, REC-03, REC-04, REC-05, REC-06, REC-07

**Success Criteria** (what must be TRUE):
1. Plugin register/unregister/info tools return plugin identification blocks and include-controlled detail payloads.
2. `write_record(mode:"create")` and `write_record(mode:"update")` replace create/update record tools while validating plugin table schema.
3. `get_record`, `archive_record`, and `search_records` return structured envelopes and preserve plugin reconciliation behavior.
4. `clear_pending_reviews` uses explicit list/clear actions and structured item envelopes.
5. Unit, integration, E2E, directed scenario, and integration scenario coverage ship with the phase.

**Plans:** 5/5 plans complete

Plans:
**Wave 1**
- [x] 126-01-PLAN.md — Create traceability, record validation, and record output helper contracts.

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 126-02-PLAN.md — Migrate plugin register/unregister/info tools to structured envelopes.

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 126-03-PLAN.md — Implement `write_record(mode:"create" | "update")` with integration and E2E coverage.

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 126-04-PLAN.md — Migrate `get_record`, `archive_record`, and `search_records` structured envelopes.

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 126-05-PLAN.md — Migrate `clear_pending_reviews` actions and close scenario/validation coverage.

**UI hint:** no

### Phase 127: Removal, Directory, And Vault Maintenance

**Goal:** Destructive and administrative filesystem operations are explicit, structured, git-aware, and safely tested.

**Depends on:** Phase 126

**Requirements:** DOC-09, SYS-01, SYS-02, SYS-03

**Success Criteria** (what must be TRUE):
1. `remove_document` archives lifecycle state before trash-folder move or hard deletion and returns ordered batch results with git policy honored.
2. `manage_directory(action:"create")` and `manage_directory(action:"remove")` replace directory create/remove tools with ordered per-path results and directory-scoped locking.
3. `maintain_vault` replaces scan/reconcile tools with sync, repair, repair+sync, dry-run, background job, status, and conflict behavior.
4. High-risk destructive/admin behavior has explicit expected-error coverage, including non-empty directory conflicts, invalid trash paths, missing documents, and concurrent maintenance.
5. Unit, integration, E2E, directed scenario, and integration scenario coverage ship with the phase.
6. Scenario tests prove real user workflows across write/search/remove/maintenance, not just handler-level calls.

**Plans:** 6/6 plans complete

Plans:
- [x] 127-01-PLAN.md — Create traceability, trash config, frontmatter constants, response helpers, and final tool metadata.
- [x] 127-02-PLAN.md — Implement `manage_directory(action:"create" | "remove")` with ordered JSON, locks, and integration coverage.
- [x] 127-03-PLAN.md — Implement `maintain_vault(action)` with sync, repair, status, background, and conflict behavior.
- [x] 127-04-PLAN.md — Implement `remove_document` archive-before-trash/delete semantics with git-aware filesystem coverage.
- [x] 127-05-PLAN.md — Add MCP protocol, directed scenario, and YAML integration coverage for Phase 127 workflows.
- [x] 127-06-PLAN.md — Run final validation, local absence/prose/frontmatter audits, and close traceability.

**UI hint:** no

### Phase 128: Legacy Surface Removal + Final Audit

**Goal:** The final host/delegated MCP surface is reduced, documented, tested, and free of stale merged/dead tools.

**Depends on:** Phase 127

**Requirements:** DOC-10, MEM-05, SYS-04, SYS-05, SYS-06, TEST-07, TEST-08

**Success Criteria** (what must be TRUE):
1. Removed/merged tools are absent from host `listTools`, delegated tool assembly, docs, skills, config validation, and scenario coverage references unless explicitly transitional.
2. `call_model` and `get_llm_usage` remain compliant and document reference resolution continues to work independently of hidden document MCP categories.
3. Dead project tools and stale imports/tests are deleted without reintroducing the old project-tool surface.
4. Transitional `get_briefing` and `insert_doc_link` have structured output, clear macro-dependent removal gates, and no accidental final-tool classification.
5. Coverage ledgers and scenario matrices show every v3.3 requirement mapped to implemented unit, integration, E2E, directed scenario, and integration scenario evidence.
6. Final validation runs lint, unit, integration, E2E, directed scenarios, YAML integration scenarios, build, and a coverage audit with no untriaged v3.3 gaps.

**Plans:** 2/8 plans executed

Plans:
- [x] 128-01-PLAN.md — Create traceability and legacy audit harness.
- [x] 128-02-PLAN.md — Finalize metadata, config, delegated, and protocol absence behavior.
- [ ] 128-03-PLAN.md — Remove active legacy/dead handlers and obsolete behavior tests.
- [ ] 128-04-PLAN.md — Port directed scenario ledgers and runnable cases to final surfaces.
- [ ] 128-05-PLAN.md — Port YAML integration scenario cases to final surfaces.
- [ ] 128-06-PLAN.md — Update docs and skill guidance to final tool names.
- [ ] 128-07-PLAN.md — Harden reference-tool and transitional legacy regressions.
- [ ] 128-08-PLAN.md — Run final validation, classify remaining legacy matches, and close traceability.

**UI hint:** no

## Coverage Summary

| Phase | Requirement Count | Coverage Obligation |
|-------|-------------------|---------------------|
| 121 | 14 | Foundation unit/integration/E2E plus scenario scaffolding and traceability format |
| 122 | 6 | Host/delegated selector unit, registration integration, listTools E2E, filtering scenarios |
| 123 | 3 | Document read/list/archive/copy/move coverage across all five test layers |
| 124 | 5 | Document write/edit/tag coverage across all five test layers |
| 125 | 10 | Search + memory coverage across all five test layers |
| 126 | 7 | Plugin + record coverage across all five test layers |
| 127 | 4 | Remove/directory/maintenance coverage across all five test layers |
| 128 | 7 | Absence assertions, transitional gates, full preflight, and final coverage audit |

**Total:** 56 requirements, 56 mapped, 0 unmapped.

## Per-Phase Verification Contract

Every phase must instantiate this contract in its `PLAN.md` before coding begins and close it in that phase's validation artifact before transition. A phase is not complete if any required test layer is missing, deferred without an explicit dependency gate, or only promised for Phase 128.

| Phase | Unit tests | Integration tests | E2E MCP tests | Directed scenarios | Integration scenarios |
|-------|------------|-------------------|---------------|--------------------|-----------------------|
| 121 | Metadata registry, selector primitives, JSON helpers, error envelopes, identification builders | Representative migrated handler response-format smoke test | Protocol JSON parse/error round-trip for representative tool | Foundation rows for JSON envelopes, canonical errors, and metadata | Foundation workflow proving response helper + handler + MCP envelope alignment |
| 122 | Host selector grammar, additive doc-write/doc-read, exclusions, legacy-name suggestions, warning combinations | Server registration/listTools under filtered configs; delegated assembly starts from host-enabled set | Host-filtered `listTools` run and expected hidden tools absent | Host/delegated filtering behavior rows | Config-to-host-to-delegated workflow rows |
| 123 | `get_document`, `archive_document`, `copy_document`, `move_document`, `list_vault` output/error helpers | Handler + filesystem/DB happy and expected-error paths for touched document read/list/archive/move/copy tools | MCP round-trip for at least one touched document read/list/archive tool | Document read/list/archive/copy/move rows updated or added | Cross-tool document read/list/archive/search workflows updated |
| 124 | `write_document`, `insert_in_doc`, `replace_doc_section`, `apply_tags` schema and error cases | Handler + filesystem/DB happy and expected-error paths for create/update/edit/tag behavior | MCP write/get, edit/get, and tag/read round-trips for touched tool group | Document write/edit/tag rows updated or added | Write -> search/get/call_model reference and tag workflows updated |
| 125 | `search`, `write_memory`, `get_memory`, `archive_memory` parsing, ranking, batch, version, and category-degradation rules | Search/memory handler + DB/vector/filesystem happy and expected-error paths | MCP search and memory write/get/archive round-trips | Search and memory consolidation rows updated or added | Write memory/document -> search -> archive/search workflows updated |
| 126 | Plugin identification, include handling, `write_record`, record batch/archive/search, pending-review actions | Plugin/record handler + DB/schema happy and expected-error paths | MCP plugin info and record write/get/search round-trips | Plugin and record rows updated or added | Plugin register -> write_record -> search/get/archive workflows updated |
| 127 | `remove_document`, `manage_directory`, `maintain_vault` validation, locks, conflicts, trash/git options, job status | Filesystem/git/DB maintenance happy and expected-error paths, including conflict cases | MCP remove/manage_directory/maintain_vault round-trips | Removal, directory, and vault-maintenance rows updated or added | Write -> remove/search, directory lifecycle, maintenance workflow rows updated |
| 128 | Absence assertions for removed tools, transitional legacy gates, `call_model`/`get_llm_usage` regression guards | Final registration/delegated-surface integration checks and stale import/source cleanup checks | Final `listTools` absence/presence round-trip and reference-resolution regression | Coverage ledger rows closed; removed rows ported/retired with evidence | YAML integration suite closed with every v3.3 workflow accounted for |

**Required validation evidence per phase:**
- The phase `PLAN.md` must include a traceability table mapping each touched requirement to concrete test files/scenario rows.
- The phase validation artifact must record exact commands run and their results.
- Directed and integration scenario coverage files must be updated in the same phase as behavior changes.
- Missing Supabase or external-provider prerequisites may skip execution only through the existing test helper skip mechanisms; the test case and coverage row must still be authored.
- Phase 128 may audit, remove stale tests, and prove absence/regression coverage, but it must not be the first phase where behavior-specific tests are created.

---
*Roadmap created: 2026-05-11 for v3.3 MCP Tools Consolidation*
