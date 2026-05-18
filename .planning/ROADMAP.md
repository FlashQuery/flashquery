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
- 🔄 **v3.5 MCP Broker** — Phases 139-143 (planning)

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

## v3.5 MCP Broker (Phases 139-143)

### Phase 139: Broker Foundation, Registry, And Dispatch

**Goal:** Replace the placeholder broker seam with a production stdio broker foundation that can spawn external MCP servers, discover tools, namespace them, and dispatch brokered calls for delegated and macro execution paths.

**Requirements:** REQ-001..037, REQ-050..060, REQ-106..108

**Plans:** 6/6 plans complete

Plans:
- [x] 139-01-PLAN.md — Config schema, broker public types, and TOFU hash helpers
- [x] 139-02-PLAN.md — Registry utilities, error taxonomy, and macro CallToolResult coercion
- [x] 139-03-PLAN.md — Stdio BrokerClient lifecycle and public broker orchestration
- [x] 139-04-PLAN.md — Agent-loop and macro broker dispatch seams
- [x] 139-05-PLAN.md — Phase A E2E and directed scenario coverage
- [x] 139-06-PLAN.md — Phase A YAML scenarios and validation record

**Success criteria:**
1. `flashquery.yml` accepts `mcp_servers` plus per-purpose broker visibility fields and rejects unsupported transports or unknown server IDs.
2. `BrokerClient` lazily spawns stdio servers, handles stderr, timeouts, restart-on-death, shutdown grace, and connection probes.
3. Registry utilities create stable `serverId__toolName` and `serverId.toolName` forms without colliding with FQ-native names.
4. Agent-loop and macro dispatch paths call `Broker.callTool` directly and preserve raw `CallToolResult` semantics, including `isError` and argument passthrough.
5. Foundation unit, integration, directed, and YAML tests from the MCP Broker Test Plan Phase A pass.

### Phase 140: TOFU Schema Pinning And Tool-List Change Handling

**Goal:** Add always-on in-memory TOFU protection, schema-drift blocking, re-approval signaling, and `notifications/tools/list_changed` routing.

**Requirements:** REQ-038..049, REQ-061..064, REQ-068, REQ-070, REQ-105

**Plans:** 6/6 plans complete

Plans:
- [x] 140-01-PLAN.md — TOFU state machine, diff utility, and registry blocking APIs
- [x] 140-02-PLAN.md — `notifications/tools/list_changed` subscription and synchronous broker routing
- [x] 140-03-PLAN.md — Macro `needs_user_input`, approve/reject resolution, autonomous block, and audit events
- [x] 140-04-PLAN.md — Phase B broker integration coverage
- [x] 140-05-PLAN.md — Phase B E2E and directed scenario coverage
- [x] 140-06-PLAN.md — Phase B YAML workflow and validation record

**Success criteria:**
1. First-observed schemas are pinned by canonical JSON hash over `{name, description, inputSchema}`.
2. Changed schemas are removed from callable/indexed surfaces until approval; rejections preserve old pins.
3. New, changed, and removed tool events from `tools/list_changed` update registry and index state synchronously.
4. Schema drift can surface a `needs_user_input` macro exit payload with old/new schema and diff summary.
5. TOFU and list-changed tests from Phase B pass, including approval, rejection, autonomous blocking, and audit logging.

### Phase 141: BM25 Tool Search, Help Pages, And Description Overrides

**Goal:** Ship the searchable tool surface: pure TypeScript BM25 indexer, `fq.search_tools`, `.tool.md` help metadata, help sentinel handling, and description override propagation.

**Requirements:** REQ-074..102, REQ-011, REQ-085..087

**Plans:** 11/11 plans complete

Plans:
- [x] 141-01-PLAN.md — Pure TypeScript BM25 indexer and POC fixture graduation
- [x] 141-02-PLAN.md — `TOOL_META` loader and validator primitives
- [x] 141-03-PLAN.md — Dispatcher `help:true`, native error footer, and brokered pass-through semantics
- [x] 141-04-PLAN.md — Core memory/document/search `.tool.md` help pages
- [x] 141-05-PLAN.md — `fq.search_tools`, per-purpose search index, audit events, and delegated injection
- [x] 141-06-PLAN.md — Host search index lifecycle and host-visible list_changed updates
- [x] 141-07-PLAN.md — Phase C integration, performance, override, TOFU, and E2E coverage
- [x] 141-08-PLAN.md — Directed/YAML scenario closure and validation record
- [x] 141-09-PLAN.md — Records and plugin `.tool.md` help pages
- [x] 141-10-PLAN.md — LLM, macro, vault/editing, and `search_tools` `.tool.md` help pages
- [x] 141-11-PLAN.md — Startup enforcement and native registration descriptions from `TOOL_META`

**Success criteria:**
1. BM25 indexer implements the pinned parameters and invariants from the POC without external dependencies.
2. `fq.search_tools` returns ranked `SearchResult` envelopes and handles empty corpus/query states cleanly.
3. Tool-search-enabled purposes inject only `fq.search_tools`; disabled purposes keep flat tool injection.
4. Every FQ-native tool has validated `.tool.md` metadata, `help: true` returns help content, and FQ-native errors include help hints.
5. `description_override` reaches all downstream consumers while TOFU continues hashing upstream descriptions.

### Phase 142: Host Surface And ConsumerContext

**Goal:** Expose brokered tools to the host MCP surface and unify consumer-aware filtering, tracing, and lazy-spawn behavior across host and delegated callers.

**Requirements:** REQ-005..010, REQ-031, REQ-035, REQ-065..067, REQ-113..118

**Plans:** 3/6 plans executed

Plans:
- [x] 142-01-PLAN.md — Host config defaults and shared registry filtering tests
- [x] 142-02-PLAN.md — Host brokered tool registration, dispatch, and drift bundling
- [x] 142-03-PLAN.md — Brokered trace metadata and nested ConsumerContext inheritance
- [ ] 142-04-PLAN.md — Host search plus shared lazy-spawn and TOFU integration
- [ ] 142-05-PLAN.md — Phase D directed and YAML scenario gates
- [ ] 142-06-PLAN.md — Phase D validation record and requirements checklist closure

**Success criteria:**
1. `host:` config is parsed, validated, and plumbed independently of existing `host_mcp_tools`.
2. Host-visible brokered tools are registered through the host MCP surface using registry-key names and overridden descriptions.
3. `ConsumerContext` filters tool visibility for host and purposes and is inherited across nested macro frames.
4. Host and delegated consumers share server instances and TOFU pins while preserving trace scope.
5. Host dispatch, host search, trace, and context-inheritance scenarios pass.

### Phase 143: Diagnostic CLI And Remaining Macro Extensions

**Goal:** Finish the broker milestone with operator diagnostics, remaining macro-language extensions, concurrent safety verification, and full scenario closure.

**Requirements:** REQ-071..073, REQ-103..104, REQ-109..110

**Success criteria:**
1. `flashquery list-tools <server>` emits paste-ready YAML and surfaces server stderr on failures.
2. `_self` binding works for source-ref macros and remains read-only where required.
3. `continue` and `break` parse and execute correctly inside loops while failing outside loops.
4. `<server>._exists()` uses deep broker probes, including hung-server detection.
5. E2E, directed, YAML, differential, and concurrency tests close the source test plan with no unmapped requirements.

## Progress

| Milestone | Phases | Requirements | Status | Shipped |
|-----------|--------|--------------|--------|---------|
| v3.5 MCP Broker | 139-143 | 0/118 | Planning | — |
| v3.4 macro-support | 130-138 | 63/63 | Complete | 2026-05-17 |
| v3.3 MCP Tools Consolidation | 121-129 | 57/57 | Complete | 2026-05-14 |
| v3.2 Agentic LLM Tools | 112-120 | — | Complete | 2026-05-07 |
| v3.1 Call Model With Reference | 107-111 | — | Complete | 2026-05-05 |
| v3.0 Native LLM Access | 98-106 | — | Complete | 2026-04-30 |
| v2.9 Filesystem Primitive Tools | 90-97 | 20/20 | Complete | 2026-04-25 |

## Next Up

Start Phase 139 with:

```bash
$gsd-discuss-phase 139
```

Or skip discussion and plan directly:

```bash
$gsd-plan-phase 139
```

---
*Last updated: 2026-05-17 after creating v3.5 MCP Broker roadmap*
