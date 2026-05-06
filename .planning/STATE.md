---
gsd_state_version: 1.0
milestone: v3.2
milestone_name: Agentic LLM Tools
status: verifying
stopped_at: Completed 115-05-PLAN.md
last_updated: "2026-05-06T04:01:30.000Z"
last_activity: 2026-05-06
progress:
  total_phases: 23
  completed_phases: 3
  total_plans: 19
  completed_plans: 19
  percent: 100
---

# FlashQuery Core — State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-05)

**Core value:** Any MCP-compatible AI can save and retrieve organized, persistent, searchable data the user owns — across tools, across sessions, with zero vendor lock-in.
**Current focus:** Phase 115 — purpose-config-bindings-capabilities

## Current Position

Phase: 115 (purpose-config-bindings-capabilities) — EXECUTING
Plan: 5 of 5
Status: Focused validation gate passed; ready for review/verification
Last activity: 2026-05-06

## Performance Metrics

**Velocity:**

- Total plans completed: 31 (this milestone)
- Average duration: — min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 112 | 5 | - | - |
| 113 | 4 | - | - |
| 114 | 5 | - | - |
| 115 | TBD | - | - |
| 116 | TBD | - | - |
| 117 | TBD | - | - |
| 118 | TBD | - | - |
| 119 | TBD | - | - |
| 120 | TBD | - | - |

*Updated after each plan completion*
| Phase 107 P04 | 15m | 2 tasks | 9 files |
| Phase 114 P01 | 4m16s | 2 tasks | 3 files |
| Phase 114 P02 | 6m26s | 2 tasks | 3 files |
| Phase 114 P03 | 3m21s | 2 tasks | 4 files |
| Phase 114 P04 | 4m36s | 2 tasks | 2 files |
| Phase 114 P05 | 10m | 3 tasks | 7 files |
| Phase 115 P01 | 7 min | 3 tasks | 3 files |
| Phase 115 P02 | 4 min | 2 tasks | 4 files |
| Phase 115 P04 | 6 min | 3 tasks | 5 files |
| Phase 115 P03 | 7 min | 3 tasks | 4 files |
| Phase 115 P05 | 9 min | 3 tasks | 7 files |

## Decisions

- Kept template rendering inside src/llm/reference-resolver.ts and reused resolveAndBuildDocument for document params.
- Requested frontmatter during body reference resolution so only fq_template true documents enter template rendering.
- 114-03: Kept @alias resolution strictly keyed to template_params[alias]; alias names are never sent through vault lookup.
- 114-03: _items string entries reuse non-alias reference grammar for section and pointer resolution.
- [Phase 114]: Used existing reference resolver integration suite and HAS_SUPABASE lifecycle for real-vault template coverage.
- [Phase 114]: Alias integration tests parse real @alias placeholders before resolver hydration.
- [Phase 114]: Directed coverage row IDs L-73 through L-76 were occupied, so TMPL-03/TMPL-04/TMPL-05/VAL-114 were remapped to L-80 through L-83.
- [Phase 114]: Documentation review deferred to Phase 119 because README.md and docs/ARCHITECTURE.md do not yet describe call_model references/templates.
- [Phase 115]: 115-03: Dangling structurally valid template paths warn and persist for later discovery/dispatch filtering.
- [Phase 115]: 115-03: Purpose-template runtime rows use source='api' while existing LLM config tables keep source='webapp' for compatibility.
- [Phase 115]: 115-05: Runtime binding precedence remains validated in `tests/integration/llm-config-sync.test.ts` until a public runtime binding scenario tool exists.
- [Phase 115]: 115-05: User-facing docs remain deferred until later ATL phases expose the final tool registry, loop execution, and discovery/help surfaces.

## Accumulated Context

### Milestone v3.1 Initialization (2026-05-01)

**Milestone:** Call Model With Reference — consolidated get_document, batch + follow_ref, reference syntax in call_model, discovery resolvers.

**Phase structure:**

| Phase | Name | Requirements |
|-------|------|-------------|
| 107 | Consolidated get_document | GDOC-01 through GDOC-10 (10 requirements) |
| 108 | Batch + follow_ref | FREF-01 through FREF-05 (5 requirements) |
| 109 | Reference Syntax in call_model | REFS-01 through REFS-07 (7 requirements) |
| 110 | Discovery Resolvers | DISC-01 through DISC-06 (6 requirements) |

**Dependencies:** 107 → 108 → 109 → 110 (strict linear chain)

- Phase 108 depends on Phase 107: `follow_ref` uses the new `include`/`sections` parameter contract
- Phase 109 depends on Phase 108: reference syntax reuses the consolidated `get_document` resolution logic
- Phase 110 depends on Phase 109: discovery resolvers extend the existing `call_model` dispatcher

**Critical architectural constraints for this milestone:**

- `get_doc_outline` is removed in Phase 107 — must be a hard deletion, not a soft deprecation
- `size.chars` in the envelope reflects full document body length, not the returned subset — envelope and extracted_sections are separate
- Section `occurrence` parameter is only valid when `sections[]` has exactly one element — validate this at the handler level
- `#` (section extraction) and `->` (pointer dereference) are mutually exclusive in a single reference placeholder — detected at parse time, not resolution time
- Reference resolution failure in `call_model` is fail-fast: if any placeholder fails, no LLM call is made
- Discovery resolvers do not require `messages` or `name` — both must be optional at the Zod schema level for these resolvers
- `list_models` / `list_purposes` / `search` are new resolver values — add to the `resolver` enum in the existing `call_model` Zod schema

**Test suite baseline going into v3.1 (2026-04-30 post-v3.0):**

- Unit: 1,306 passing (+ 20 pre-existing deferred failures — do not fix during v3.1)
- Integration: 47 passing
- E2E: not re-run at v3.0 close

### Known Issues Carried Forward

- 20 pre-existing deferred unit test failures (tracked since v2.8; ignore during v3.1 phases)
- 1 deferred Phase 86 multi-table-reconciliation test (ownership reset fix applied but unverified)

### Roadmap Evolution

- Phase 111 added: CMR Verification Fixes — occurrence_out_of_range error code, local flag, test correctness, and coverage gaps (post-verification phase added 2026-05-02)

### Milestone v3.2 Initialization (2026-05-05)

**Milestone:** Agentic LLM Tools — extends `call_model` into a FlashQuery-managed agent loop with safe native tool exposure, document/template references, and masqueraded vault template tools.

**Phase structure:**

| Phase | Name | Requirements |
|-------|------|-------------|
| 112 | Chat Primitive & Envelope Migration | CHAT-01 through CHAT-06, VAL-112, TEST-01 through TEST-03 |
| 113 | Document Reference System Core | REF-01 through REF-08, VAL-113 |
| 114 | Template Parameterization | TMPL-01 through TMPL-05, VAL-114 |
| 115 | Purpose Config, Bindings & Capabilities | BIND-01 through BIND-05, CAP-01 through CAP-05, VAL-115 |
| 116 | Model-Visible Tool Registry | TOOL-01 through TOOL-04, VAL-116 |
| 117 | Agent Loop Executor | LOOP-01 through LOOP-07, TOOL-05, TOOL-06, VAL-117 |
| 118 | Template Discovery & Masquerade Dispatch | TMPL-06 through TMPL-08, VAL-118 |
| 119 | Discovery Diagnostics & Help Resolver | DISC-01 through DISC-04, VAL-119 |
| 120 | Cross-Phase ATL Validation & Coverage Closure | VAL-120, TEST-04 |

**Dependencies:** 112 → 113 → 114 → 115 → 116 → 117 → 118 → 119 → 120.

**Critical architectural constraints for this milestone:**

- More research is intentionally skipped; the supplied ATL, DRS, and test-plan docs are spec-complete and implementation-ready.
- Every implementation phase must ship runnable tests for the behavior it adds; public behavior gets scenario coverage in the same phase, and Phase 120 is cross-phase validation plus coverage closure, not a deferred test dump.
- `chat()` is the lower-level provider primitive; existing text wrappers stay compatible and reject accidental tool-call responses.
- Reference hydration scans host-authored input only and is non-recursive.
- `{{id:...}}` support is removed as part of ATL; `{{ref:...}}` is the single reference prefix.
- Mode 2 eligibility is config-time gated by structured model capabilities across the full fallback chain.
- `call_model`, admin tools, and plugin-management tools are hard-excluded from delegated tool exposure.
- Mode 2 writes one aggregate `fqc_llm_usage` row; detailed per-iteration loop data remains in `metadata.tools.calls_log`.
- Audit document writes, MCP Broker support, cooperative Mode 3, response references, and path-scoped delegated writes are deferred.

## Session Continuity

Last session: 2026-05-06T03:49:40.223Z
Stopped at: Completed 115-03-PLAN.md
Resume: None

## Deferred Items

Items acknowledged and deferred at v3.1 milestone close on 2026-05-05:

| Category | Item | Status |
|----------|------|--------|
| debug_sessions | crm-plugin-multi-bug | verifying |
| debug_sessions | fqc-background-scan-blocks-archives | unknown |
| debug_sessions | knowledge-base | unknown |
| debug_sessions | linux-supabase-hang-2026-04-10 | unknown |
| debug_sessions | plugin-registration-yaml-validation | verified |
| debug_sessions | postgres-meta-ddl-failure | root_cause_found |
| debug_sessions | release-not-function-FINAL | unknown |
| debug_sessions | remaining-mcp-tool-tests | pending |
| debug_sessions | scanner-duplicate-race-analysis | unknown |
| debug_sessions | supabase-mock-self-ref | unknown |
| quick_tasks | 260324-mad-configure-internal-supabase-for-testing- | missing |
| quick_tasks | 260324-r95-add-ollama-integration-test-for-embeddin | missing |
| quick_tasks | 260330-gia-investigate-setup-sh-and-document-implem | missing |
| quick_tasks | 260330-x8l-add-test-case-code-samples-to-backlog-it | missing |
| quick_tasks | 260331-1os-setup-sh-bearer-token-generation-and-gui | missing |
| quick_tasks | 260331-lko-all-e2e-tests-should-remove-test-entries | missing |
| quick_tasks | 260331-o5x-fix-integration-test-configs-add-missing | missing |
| quick_tasks | 260408-h1j-rename-inner-flashquery-core-folder-to-s | missing |
| quick_tasks | 260408-hdk-flatten-flashquery-core-project-structur | missing |
| quick_tasks | 260409-r63-audit-docker-support-in-fqc-check-testin | missing |
| quick_tasks | 260409-sny-add-docker-compose-syntax-validation-to- | missing |
| quick_tasks | 260412-e2e-check-e2e-tests | missing |
| quick_tasks | 260414-ey9-understand-the-state-of-unit-integration | unknown |
| quick_tasks | 260415-cleanup-consolidate | missing |
| uat_gaps | phase 101 (101-HUMAN-UAT.md) | approved |
| uat_gaps | phase 102 (102-HUMAN-UAT.md) | passed |
| uat_gaps | phase 108 (108-HUMAN-UAT.md) | passed |
| uat_gaps | phase 110 (110-HUMAN-UAT.md) | passed |

Total deferred: 28 items. These predate the v3.1 milestone work and represent cross-milestone debt (debug-session backlog, dangling quick-task index entries, and audit label/status mismatches on completed UAT files). Not blocking v3.1; carried into the next milestone for incremental cleanup.
