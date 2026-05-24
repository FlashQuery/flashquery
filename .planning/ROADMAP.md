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
- 🔄 **v3.7 Technical Debt** — Phases 145-150 (planned)

## Current Milestone: v3.7 Technical Debt

**Goal:** Remediate the priority findings from the 23-May-2026 FlashQuery codebase audit before the next feature push.

**Source requirements:** `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Priority Remediation Requirements/Codebase Audit Priority Remediation Requirements.md`

**Source test plan:** `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Priority Remediation Requirements/Codebase Audit Priority Remediation Test Plan.md`

**Testing rule:** Every phase bundles implementation with its matching verification work. A phase is not complete until required unit, integration, E2E, directed scenario, integration scenario, command, and coverage-matrix updates from the test plan are landed or explicitly documented as not applicable.

## Proposed Roadmap

| # | Phase | Goal | Requirements | Test Plan |
|---|-------|------|--------------|-----------|
| 145 | Silent Failure Quick Wins | 1/1 | Complete   | 2026-05-24 |
| 146 | Embedding Reliability Foundation | Centralize background embedding, add durable retry/diagnostic state, and pool record vector SQL. | REQ-003, REQ-004, REQ-005 | §4.2 |
| 147 | Tooling and Dependency Hygiene | Clear dependency/security drift and make static analysis actionable. | REQ-006, REQ-007 | §4.3 |
| 148 | MCP Lifecycle and Shutdown | Consolidate typed server wrapping and drain in-flight MCP requests during shutdown. | REQ-008, REQ-009 | §4.4 |
| 149 | Cycle Breaks | Remove documented document/plugin and macro circular dependency clusters without behavior drift. | REQ-010, REQ-011 | §4.5 |
| 150 | Config Metadata Typing | Replace runtime metadata side-channel casts with explicit type-safe storage. | REQ-012 | §4.6 |

## Phase Details

### Phase 145: Silent Failure Quick Wins

**Goal:** Make the two confirmed silent-degradation paths return explicit failure state.

**Requirements:** REQ-001, REQ-002

**Depends on:** None

**Implementation scope:**
- Modify `src/mcp/tools/memory.ts` around `resolvePluginScope` and create-mode `write_memory`.
- Modify `src/services/scanner.ts` around the `EMBED-DRAIN` query and `ScanResult.embeddingStatus`.
- Update response/tool docs if they describe the old fallback behavior.

**Required tests:**
- Unit: T-U-001..005 for plugin-scope resolution and scanner status handling.
- Integration: T-I-001..002 for `write_memory` lookup failure and scanner drain query failure.
- Directed scenario: T-S-001 / D-68 for public MCP `write_memory` lookup failure behavior if scenario coverage is needed.

**Success criteria:**
1. Failed plugin-scope lookup never inserts a global-scoped memory.
2. Scanner drain query failure reports an explicit partial-success status and error-level log.
3. Focused unit/integration/scenario coverage lands with the implementation.
4. `npm run typecheck` and `npm run lint` pass.

### Phase 146: Embedding Reliability Foundation

**Goal:** Centralize background embedding, add durable retry state, surface deferred warnings, and move record direct SQL usage to a pool.

**Requirements:** REQ-003, REQ-004, REQ-005

**Depends on:** Phase 145

**Implementation scope:**
- Create or extend a background embedding helper under `src/embedding/` or a service module.
- Add pending embedding schema/migration support if a new table is selected.
- Replace embedding call sites in memory, documents, compound tools, record tools, and document-output.
- Extend scanner/worker behavior to drain pending rows across documents, memories, and records.
- Extend `src/utils/pg-client.ts` with a pool abstraction and update record embed/search call sites.

**Required tests:**
- Unit: T-U-006..012 for helper success/failure, warnings, retry behavior, and pool behavior.
- Integration: T-I-003..008 for document/memory/record pending rows, retry, diagnostics, and pooled record vector SQL.
- Directed scenario: T-S-002 / D-69 for deferred embedding warning through public MCP response if needed.
- Integration scenario: T-Y-001 / IS-15 for pooled record vector SQL workflow if needed.

**Plans:** 4 plans

Plans:
- [ ] 146-01-PLAN.md — Durable pending embedding schema and centralized helper foundation.
- [ ] 146-02-PLAN.md — MCP write call-site migration and D-69 warning scenario.
- [ ] 146-03-PLAN.md — Pending retry worker, scanner reachability, and doctor diagnostics.
- [ ] 146-04-PLAN.md — Pooled record vector SQL, shutdown cleanup, and IS-15 scenario.

**Success criteria:**
1. No duplicated direct background embed idioms remain in MCP tools outside approved helper/scanner code.
2. Pending embeddings retry successfully and remain diagnosable after repeated failures.
3. Record direct SQL paths use pooled borrowing/release and preserve IPv4 behavior.
4. Focused unit/integration/scenario coverage lands with the implementation.
5. `npm run typecheck` and `npm run lint` pass.

### Phase 147: Tooling and Dependency Hygiene

**Goal:** Clear dependency/security drift and add a usable `knip` baseline.

**Requirements:** REQ-006, REQ-007

**Depends on:** None. The MCP SDK update should wait for Phase 148 if typed wrapping has not landed.

**Implementation scope:**
- Run and record current `npm audit` and `npm outdated`.
- Apply non-major updates and handle Chevrotain v12 separately.
- Update MCP SDK after typed wrapping risk is addressed.
- Add `knip` config/script and wire it into preflight or document staged rollout.
- Refresh package lock.

**Required tests/checks:**
- Unit/framework: T-U-013..014 for macro parser/framework regression coverage after dependency updates.
- Static/command: T-C-001..006 for audit, outdated, typecheck/lint, knip, and preflight.
- Static config assertion: T-U-015 if useful for knip exclusions.

**Success criteria:**
1. `npm audit` and `npm audit --omit=dev` report no unhandled vulnerabilities, or remaining advisories are explicitly documented.
2. Chevrotain parser behavior remains green after the major update.
3. `npm run knip` produces actionable output without worktree/build/vendor noise.
4. `npm run preflight` passes or documents the staged knip rollout.

### Phase 148: MCP Lifecycle and Shutdown

**Goal:** Make MCP server wrapping type-safe and use it to drain active requests during shutdown.

**Requirements:** REQ-008, REQ-009

**Depends on:** Phase 145

**Implementation scope:**
- Consolidate `registerTool` wrapping in `src/mcp/server.ts` and `src/mcp/tool-catalog.ts`.
- Delete the dead `server.tool` wrapping branch unless a production caller is introduced and tested.
- Add in-flight request tracking and expose it to `src/server/shutdown.ts`.
- Replace the 100ms sleep with a 15-second drain.

**Required tests:**
- Unit: T-U-016..020 for catalog capture, correlation context, no `server.tool` dependency, counter balance, and timeout behavior.
- E2E: T-E-001 for server tools callable after wrapper consolidation.
- Integration: T-I-009..011 for idle, active, and hung shutdown behavior.
- Directed scenario: T-S-003 / D-70 for shutdown during write if needed.

**Success criteria:**
1. Dead `.tool` wrapping is gone.
2. Correlation-ID context and native tool cataloging keep existing behavior.
3. Shutdown returns promptly when idle, waits for active handlers, and warns on timeout.
4. Focused unit/integration/E2E/scenario coverage lands with the implementation.
5. `npm run typecheck` and `npm run lint` pass.

### Phase 149: Cycle Breaks

**Goal:** Remove the documented document/plugin and macro circular dependency clusters.

**Requirements:** REQ-010, REQ-011

**Depends on:** None

**Implementation scope:**
- Extract lower-level document utility modules to remove service-to-MCP-tool imports.
- Extract macro builtin/type definitions to remove evaluator/type cycles.
- Add or update a madge/cycle check command if practical.

**Required tests/checks:**
- Unit: T-U-021..024 for document/plugin regressions, macro regressions, and cycle absence.
- Integration: T-I-012 for plugin propagation/reconciliation regression coverage.
- Framework: T-U-025 / `npm run test:macro-framework`.
- Command: `npx --yes madge src --extensions ts --circular` or project-approved equivalent.

**Success criteria:**
1. `mcp/utils/resolve-document.ts` no longer imports from `mcp/tools/documents.ts`.
2. Plugin services no longer import document helpers from MCP tool modules.
3. Macro cycle cluster no longer appears in cycle output.
4. Existing document, plugin, and macro behavior remains green.

### Phase 150: Config Metadata Typing

**Goal:** Remove runtime-only underscore side-channel casts while preserving config accessor behavior.

**Requirements:** REQ-012

**Depends on:** None

**Implementation scope:**
- Introduce typed metadata storage or internal config typing in `src/config/loader.ts`.
- Update `getDeprecationWarnings`, `getStartupWarnings`, `getResolvedHostToolExposure`, and `getLlmApiKeyRefs`.
- Verify LLM API key references remain raw references and resolved secrets are not persisted.

**Required tests:**
- Unit: T-U-026..029 for metadata accessors, host exposure fallback, raw API key refs, and selected cast removal.

**Success criteria:**
1. Selected `as unknown as Record<string, unknown>` metadata side-channel sites are gone.
2. Config accessors preserve behavior.
3. Raw secret values are not leaked.
4. Focused config tests, `npm run typecheck`, and `npm run lint` pass.

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| REQ-001 | Phase 145 | Pending |
| REQ-002 | Phase 145 | Pending |
| REQ-003 | Phase 146 | Pending |
| REQ-004 | Phase 146 | Pending |
| REQ-005 | Phase 146 | Pending |
| REQ-006 | Phase 147 | Pending |
| REQ-007 | Phase 147 | Pending |
| REQ-008 | Phase 148 | Pending |
| REQ-009 | Phase 148 | Pending |
| REQ-010 | Phase 149 | Pending |
| REQ-011 | Phase 149 | Pending |
| REQ-012 | Phase 150 | Pending |

**Coverage:** 12/12 requirements mapped.

## Progress

| Milestone | Phases | Requirements | Status | Shipped |
|-----------|--------|--------------|--------|---------|
| v3.7 Technical Debt | 145-150 | 0/12 | Planned | — |
| v3.6 Bug Fixes & Host Parity | 144 | 18/18 scoped | Complete | 2026-05-24 |
| v3.5 MCP Broker | 139-143 | 118/118 | Complete | 2026-05-19 |
| v3.4 macro-support | 130-138 | 63/63 | Complete | 2026-05-17 |
| v3.3 MCP Tools Consolidation | 121-129 | 57/57 | Complete | 2026-05-14 |
| v3.2 Agentic LLM Tools | 112-120 | — | Complete | 2026-05-07 |
| v3.1 Call Model With Reference | 107-111 | — | Complete | 2026-05-05 |
| v3.0 Native LLM Access | 98-106 | — | Complete | 2026-04-30 |
| v2.9 Filesystem Primitive Tools | 90-97 | 20/20 | Complete | 2026-04-25 |

## Next Up

Start Phase 145:

```bash
$gsd-plan-phase 145
```

---
*Last updated: 2026-05-24 after starting v3.7 Technical Debt milestone*
