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

## Phases

<details>
<summary>✅ v3.4 macro-support (Phases 130-138) — SHIPPED 2026-05-17</summary>

- [x] Phase 130: Foundation, Metadata, Broker Shim, Archive Lock (2/2 plans)
- [x] Phase 131: Lexer, Parser, Fence Extraction (5/5 plans)
- [x] Phase 132: Evaluator Core (4/4 plans)
- [x] Phase 133: Standard Library Builtins (3/3 plans)
- [x] Phase 134: Shell Verbs, Vault Jail, Introspection (5/5 plans)
- [x] Phase 135: Tool Registry, Dispatch, Permissions (4/4 plans)
- [x] Phase 136: Task Lifecycle And Cancellation (4/4 plans)
- [x] Phase 137: Trace, Progress, Dry-Run, Budgets (5/5 plans)
- [x] Phase 138: Handler, Source Resolution, Scenario Closure (4/4 plans)

Archive: [milestones/v3.4-ROADMAP.md](milestones/v3.4-ROADMAP.md)

</details>

<details>
<summary>✅ v3.5 MCP Broker (Phases 139-143) — SHIPPED 2026-05-19</summary>

- [x] Phase 139: Broker Foundation, Registry, And Dispatch (completed 2026-05-19)
- [x] Phase 140: TOFU Schema Pinning And Tool-List Change Handling (completed 2026-05-19)
- [x] Phase 141: BM25 Tool Search, Help Pages, And Description Overrides (completed 2026-05-19)
- [x] Phase 142: Host Surface And ConsumerContext (completed 2026-05-19)
- [x] Phase 143: Diagnostic CLI And Remaining Macro Extensions (completed 2026-05-19)

Archive: [milestones/v3.5-ROADMAP.md](milestones/v3.5-ROADMAP.md)
Requirements: [milestones/v3.5-REQUIREMENTS.md](milestones/v3.5-REQUIREMENTS.md)
Audit: [milestones/v3.5-MILESTONE-AUDIT.md](milestones/v3.5-MILESTONE-AUDIT.md)

</details>

## Progress

| Milestone | Phases | Requirements | Status | Shipped |
|-----------|--------|--------------|--------|---------|
| v3.6 Bug Fixes & Host Parity | 144 | 18/18 scoped | Complete | 2026-05-24 |
| v3.5 MCP Broker | 139-143 | 118/118 | Complete | 2026-05-19 |
| v3.4 macro-support | 130-138 | 63/63 | Complete | 2026-05-17 |
| v3.3 MCP Tools Consolidation | 121-129 | 57/57 | Complete | 2026-05-14 |
| v3.2 Agentic LLM Tools | 112-120 | — | Complete | 2026-05-07 |
| v3.1 Call Model With Reference | 107-111 | — | Complete | 2026-05-05 |
| v3.0 Native LLM Access | 98-106 | — | Complete | 2026-04-30 |
| v2.9 Filesystem Primitive Tools | 90-97 | 20/20 | Complete | 2026-04-25 |

<details>
<summary>✅ v3.6 Bug Fixes & Host Parity (Phase 144) — SHIPPED 2026-05-24</summary>

- [x] Phase 144: Fix template warning flood and host help convention parity (completed 2026-05-24)

### Phase 144: Fix template warning flood and host help convention parity (SHIPPED 2026-05-24)

**Goal:** Close two FlashQuery behavior gaps from the bug backlog: make template-tool discovery bounded by suppressing ordinary non-template documents and moving discovery to indexed template metadata, and bring the native-tool help convention to parity between delegated model calls and host MCP `tools/call` calls.

**Requirements:** Template Warning Flood Requirements REQ-001..011; Help Convention Host-Model Parity Requirements REQ-001..007

**Source scope:**

- Template Warning Flood:
  - Requirements: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Bugs/Template Warning Flood Bug/list-purposes-not-template-warning-flood Requirements.md`
  - Test plan: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Bugs/Template Warning Flood Bug/list-purposes-not-template-warning-flood Test Plan.md`
  - Bug report: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Bugs/Template Warning Flood Bug/list-purposes-not-template-warning-flood.md`
- Help Convention Host-Model Parity:
  - Requirements: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Bugs/Help Convention Host-Model Parity/help-convention-not-wired-to-host-model-mcp-path Requirements.md`
  - Test plan: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Bugs/Help Convention Host-Model Parity/help-convention-not-wired-to-host-model-mcp-path Test Plan.md`

**Depends on:** Phase 143
**Plans:** 6/6 plans complete

Plans:
**Wave 1**

- [x] 144-01-PLAN.md — Template silent skip and consumer regression
- [x] 144-05-PLAN.md — Shared native dispatch core

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 144-02-PLAN.md — `template_meta` schema and population
- [x] 144-06-PLAN.md — Host help parity and broker pass-through

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 144-03-PLAN.md — Index-backed template discovery

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 144-04-PLAN.md — `list_purposes` template shape and docs contract

**Success criteria:**

1. Template discovery treats ordinary non-template documents as silent skips, preserves genuine template diagnostics, keeps provider tool/dispatch behavior unchanged, and returns bounded `list_purposes`, `search`, `resolver:"purpose"`, and `call_macro` behavior.
2. `fqc_documents` carries template-scoped `template_meta`, populated by write and scan/backfill paths, and registry discovery uses indexed active document rows instead of recursive vault walks.
3. `list_purposes` emits exposed templates once at top level in permissive mode while retaining per-purpose template tools in restrictive mode and keeping warnings/conflicts/dangling paths scoped per purpose.
4. Native-tool dispatch uses one shared help-aware core for delegated and host paths; host `tools/call` supports `help: true`, advertises optional `help` on native schemas, gates hidden native tools by host exposure, and preserves brokered-tool pass-through semantics.
5. The implementation creates and passes the tests mapped in both supplied test plans so every requirement is validated: Template Warning Flood T-U-001..007, T-I-001..009, T-S-001..006; Help Convention T-U-001..008 and T-E-001..010.

Archive: [milestones/v3.6-ROADMAP.md](milestones/v3.6-ROADMAP.md)

</details>

## Next Up

Start the next milestone:

```bash
$gsd-new-milestone
```

---
*Last updated: 2026-05-24 after archiving v3.5 and shipping v3.6 Bug Fixes & Host Parity*
