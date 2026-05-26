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
- ✅ **v3.3 MCP Tools Consolidation** — Phases 121-129 (shipped 2026-05-14)
- ✅ **v3.4 macro-support** — Phases 130-138 (shipped 2026-05-17)
- ✅ **v3.5 MCP Broker** — Phases 139-143 (shipped 2026-05-19)
- ✅ **v3.6 Bug Fixes & Host Parity** — Phase 144 (shipped 2026-05-24)
- ✅ **v3.7 Technical Debt** — Phases 145-150 (shipped 2026-05-25)
- 🔄 **v3.8 Codebase Audit Remaining Remediation** — Phases 151-154 (active)

## Current Milestone: v3.8 Codebase Audit Remaining Remediation

**Goal:** Close the remaining actionable May 2026 codebase audit findings with behavior-preserving cleanup, type-safety hardening, document-tool decomposition, and residual import-cycle cleanup.

**Requirements:** 12 active requirements | **Phases:** 4 | **Start phase:** 151

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|------------------|
| 151 | Quick Localized Cleanup | 2/2 | Complete    | 2026-05-25 |
| 152 | Type-Safety Cleanup Pass | 2/2 | Complete | 2026-05-25 |
| 153 | Documents Tool Decomposition | 3/3 | Complete    | 2026-05-25 |
| 154 | Residual Import Cycle Cleanup | 6/6 | Complete    | 2026-05-26 |

## Phase Details

### Phase 151: Quick Localized Cleanup

**Goal:** Remove small, independent audit findings and package metadata drift before broader refactors.

**Requirements:** REQ-001, REQ-002, REQ-003, REQ-004, REQ-005

**Plans:** 2/2 plans complete

**Wave 1**

Plans:
- [x] 151-01-PLAN.md — Implement embedding provider config validation and public VaultManager path access for plugin reconciliation.

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 151-02-PLAN.md — Remove inert seeder code, make backup cleanup failures visible, and clean package metadata/static guards.

**Success criteria:**

1. `createEmbeddingProvider` explicitly validates missing OpenAI/OpenRouter API keys while preserving Ollama behavior.
2. Plugin reconciliation uses a public `VaultManager` absolute-path API and no longer casts to private `rootPath`.
3. The inert projects seeder and stale import/test references are gone.
4. Backup cleanup no longer swallows pg close failures silently or leaks credentials in logs.
5. `package.json`, `package-lock.json`, `knip`, and audit checks reflect the `esbuild` / `@types/uuid` metadata cleanup.

**Required validation:** T-U-001..T-U-015, T-I-001, `npm run knip`, `npm audit`.

### Phase 152: Type-Safety Cleanup Pass

**Goal:** Replace targeted type escapes and records TODOs while preserving public behavior.

**Requirements:** REQ-006, REQ-007, REQ-008

**Plans:** 2/2 plans complete

**Wave 1**

Plans:
- [x] 152-01-PLAN.md — Remove REQ-006 and REQ-007 type escapes in document output, scanner selects, and LLM usage.

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 152-02-PLAN.md — Add safe records timing instrumentation for REQ-008 and run final Phase 152 validation.

**Success criteria:**

1. The residual consolidated document-output double assertion is replaced with tighter return typing.
2. Scanner active/missing and archived document selects no longer rely on `as unknown as Promise` while preserving selected fields.
3. `llm-usage.ts` removes the broad query eslint disables and grouping non-null assertions without changing response shapes.
4. Both `search_records` query paths emit safe timing metadata on success and failure.
5. Existing scanner, document-output, LLM usage, records, directed, and YAML scenario regressions remain green or skip only through existing environment gates.

**Required validation:** T-U-016..T-U-025, T-I-002..T-I-004, T-S-001..T-S-002, T-Y-001..T-Y-003.

### Phase 153: Documents Tool Decomposition

**Goal:** Split the document tools monolith into cohesive modules without contract drift or cycle regression.

**Requirements:** REQ-009

**Success criteria:**

1. `registerDocumentTools(server, config)` remains the public registration entrypoint or all imports are updated consistently.
2. All six document registrations remain available with unchanged schemas and response behavior.
3. Moved handlers preserve write locks, embedding scheduling, identity resolution, logging intent, error handling, and plugin propagation.
4. Document helper movement avoids recreating the document/plugin cycle cluster and keeps the entrypoint thin.
5. Static size/cycle guards plus document unit, integration, directed, YAML, typecheck, lint, knip, and preflight gates pass.

**Required validation:** T-U-026..T-U-030, T-I-005..T-I-009, T-S-003..T-S-006, T-Y-004..T-Y-006, `npm run typecheck`, `npm run lint`, `npm run knip`, `npm run preflight`.

### Phase 154: Residual Import Cycle Cleanup

**Goal:** Eliminate the 18 residual baseline `madge` import cycles that remain after the targeted document/plugin and macro cycle clusters were closed.

**Requirements:** REQ-010, REQ-011, REQ-012
**Depends on:** Phase 153
**Plans:** 6/6 plans complete

**Wave 1**

Plans:
- [x] 154-01-PLAN.md — Extract config-facing LLM policy/type leaves and guard REQ-010 cycles.
- [x] 154-03-PLAN.md — Extract MCP lifecycle registry and preserve 15-second shutdown drain semantics.

**Wave 2** *(blocked on 154-01 where noted; independent of full zero-cycle final gate)*

- [x] 154-02-PLAN.md — Extract LLM runtime error/type leaves and remove client/resolver back-edges. Depends on 154-01.
- [x] 154-04-PLAN.md — Extract config-sync, purpose-template, template-tool, and reference metadata leaves. Depends on 154-01.
- [x] 154-05-PLAN.md — Extract embedding dimension policy and logging/config leaf imports. Depends on 154-01.

**Wave 3** *(blocked on Waves 1-2 completion)*

- [x] 154-06-PLAN.md — Run final static zero-cycle guard, roadmap parity madge, quality gates, and conditional macro gate. Depends on 154-01, 154-02, 154-03, 154-04, and 154-05.

**Success criteria:**

1. Config parsing/validation no longer imports concrete LLM runtime or tool-registry modules that import back into config.
2. LLM client, resolver, config-sync, purpose-template binding, template-tool, reference-resolver, embedding, storage, and logger modules are reorganized so LLM runtime paths are acyclic.
3. MCP server and shutdown coordination share request lifecycle state through a dependency-light registry module instead of importing each other.
4. `npx --yes madge src --extensions ts --circular` exits 0 for the current production `src/` graph, or any remaining cycle is explicitly documented as out of scope with Matt approval before phase close.
5. LLM config/tool registry/template behavior, embedding provider behavior, document reference hydration, MCP server registration, and shutdown drain behavior remain stable.

**Required validation:** T-U-031..T-U-037, T-I-010..T-I-011, T-C-007..T-C-010, T-C-011 if macro-visible native tool / LLM types move, and `npx --yes madge src --extensions ts --circular`.

## Archived Milestone Details

- [v3.7 ROADMAP archive](milestones/v3.7-ROADMAP.md)
- [v3.7 REQUIREMENTS archive](milestones/v3.7-REQUIREMENTS.md)
- [v3.7 milestone audit](milestones/v3.7-MILESTONE-AUDIT.md)

## Notes

This milestone is sourced from the external Codebase Audit Remaining Remediation spec and test plan. Research is intentionally not rerun because the provided documents already contain scope, source findings, phasing, and validation strategy. Phase 154 was added after post-implementation analysis to promote the residual baseline `madge` cycles into planned follow-up work.
