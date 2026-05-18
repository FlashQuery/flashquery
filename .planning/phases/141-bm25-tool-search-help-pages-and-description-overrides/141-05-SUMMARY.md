---
phase: 141-bm25-tool-search-help-pages-and-description-overrides
plan: 5
subsystem: llm-tool-search
tags: [mcp-broker, bm25, tool-search, call_model, audit-trace]
requires:
  - phase: 141-01
    provides: PureBM25Indexer and ToolSearchDocument contracts
  - phase: 141-02
    provides: TOOL_META metadata contracts
  - phase: 141-03
    provides: native help:true dispatch convention
  - phase: 141-04/09/10
    provides: .tool.md help pages including search_tools
  - phase: 141-11
    provides: startup/native catalog description metadata
provides:
  - fq.search_tools handler returning ranked SearchResult JSON text
  - per-invocation purpose BM25 indexes for tool_search enabled calls
  - sanitized timestamped search audit trace events
  - enabled/disabled delegated provider-tool shaping
affects: [call_model, agent-loop, mcp-broker-trace, tool-search]
tech-stack:
  added: []
  patterns:
    - dynamic native handler appended to delegated dispatch catalog
    - timestamped audit event input union without required ts
key-files:
  created:
    - src/services/tool-search/tool-search-service.ts
    - src/services/tool-search/search-tools-handler.ts
    - tests/unit/tool-search/search-tools-handler.test.ts
  modified:
    - src/services/mcp-broker/types.ts
    - src/services/mcp-broker/trace.ts
    - src/mcp/tools/llm.ts
    - src/llm/agent-loop.ts
    - tests/unit/llm-agent-loop.test.ts
key-decisions:
  - "Registered the FQ-native tool as search_tools while the handler/search surface is documented as fq.search_tools, matching existing native tool naming and .tool.md metadata."
  - "Built enabled-purpose search indexes inside executeAgentLoop before the first provider request so broker TOFU/list visibility uses the same ConsumerContext and interactive flag as dispatch."
patterns-established:
  - "Enabled tool_search purposes send only search_tools to the provider while dispatch retains native and brokered callable visibility."
  - "Search audit records only consumer identity, query, result_count, latency_us, and trace_id."
requirements-completed: [REQ-011, REQ-082, REQ-083, REQ-084, REQ-085, REQ-086, REQ-100]
duration: 7m06s
completed: 2026-05-18T17:07:49Z
---

# Phase 141 Plan 5: BM25 Tool Search Handler Summary

**Per-purpose BM25 tool discovery with native help hints, brokered override descriptions, sanitized audit events, and search-only initial delegated tool injection.**

## Performance

- **Duration:** 7m06s
- **Started:** 2026-05-18T17:00:43Z
- **Completed:** 2026-05-18T17:07:49Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Added `ToolSearchService` and `createSearchToolsHandler` for ranked `SearchResult` JSON text responses.
- Added native result enrichment with `server: "flashquery"`, `has_help: true`, and `help_hint`; brokered results use downstream override descriptions without native help hints.
- Added `mcp_broker_search_tools` audit events through the existing timestamped broker audit recorder.
- Changed enabled delegated purposes to build a per-invocation index and send only `search_tools` up front while preserving direct dispatch visibility for discovered native and brokered tools.
- Preserved disabled-purpose flat native + brokered provider tool behavior.

## Task Commits

1. **Task 1 RED: Search handler coverage** - `a59c506` (test)
2. **Task 1 GREEN: Search service, handler, audit event** - `5695fa5` (feat)
3. **Task 2 RED: Tool-search injection coverage** - `0a76f27` (test)
4. **Task 2 GREEN: Delegated injection shaping** - `508ce1d` (feat)

## Files Created/Modified

- `src/services/tool-search/tool-search-service.ts` - Builds per-consumer native/brokered BM25 documents and formats search results.
- `src/services/tool-search/search-tools-handler.ts` - Validates `query`/`limit`, returns JSON text, and records sanitized audit events.
- `src/services/mcp-broker/types.ts` - Adds timestamped search audit event shape and input union.
- `src/services/mcp-broker/trace.ts` - Keeps the timestamping boundary compatible with the expanded audit union.
- `src/mcp/tools/llm.ts` - Registers `search_tools` through the LLM/native catalog path and passes purpose `toolSearch` into the agent loop.
- `src/llm/agent-loop.ts` - Builds enabled-purpose indexes, injects only `search_tools`, and keeps dispatch catalog visibility broad.
- `tests/unit/tool-search/search-tools-handler.test.ts` - Covers native/brokered result envelopes and sanitized audit.
- `tests/unit/llm-agent-loop.test.ts` - Covers enabled/disabled provider shaping, direct dispatch visibility, and non-interactive context preservation.

## Decisions Made

- Registered the tool name as `search_tools` in the native catalog because existing FlashQuery-native tools are bare names and `.tool.md` metadata is keyed by `search_tools`; the public plan language still refers to the conceptual `fq.search_tools` handler.
- Built the search handler dynamically per `executeAgentLoop` invocation so each enabled purpose gets its own immutable index and search audit context.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None. Placeholder-pattern scan found only normal initializers, test fixture override defaults, and existing nullable trace/model fields; no UI/data-flow stubs were introduced.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: audit_trace | src/services/mcp-broker/types.ts | Added sanitized search audit event surface for model query traces; matches plan threat model T-141-10. |

## Verification

- `npm test -- --run tests/unit/tool-search/search-tools-handler.test.ts` - PASS during Task 1.
- `npm test -- --run tests/unit/llm-agent-loop.test.ts tests/unit/tool-search/search-tools-handler.test.ts` - PASS during Task 2.
- `npm test -- --run tests/unit/tool-search/search-tools-handler.test.ts tests/unit/llm-agent-loop.test.ts` - PASS final, 2 files / 34 tests.
- `npm run build` - PASS.

## Acceptance Criteria

- Search docs use registered downstream `description`, falling back to upstream only if no downstream description exists - PASS.
- Search audit input contains query/result count/latency/trace and no raw arguments or result payload - PASS.
- Native search result includes `has_help: true` and canonical help hint - PASS.
- Brokered result with override returns overridden `description` and no native help hint - PASS.
- Enabled-purpose provider request contains only `search_tools`, not ordinary eligible native or brokered tools - PASS.
- Disabled-purpose provider request still contains ordinary eligible native and brokered tools - PASS.
- Direct native/brokered calls remain dispatch-visible after search-only injection - PASS.
- Autonomous purpose context preserves `interactive: false` during index build - PASS.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 141-06 can extend the same service/handler pattern to host index lifecycle. Plan 141-07/08 can add integration, E2E, and scenario coverage for override substitution and full search-dispatch workflows.

## Self-Check: PASSED

- Created files exist: `src/services/tool-search/tool-search-service.ts`, `src/services/tool-search/search-tools-handler.ts`, `tests/unit/tool-search/search-tools-handler.test.ts`, this summary.
- Commits exist: `a59c506`, `5695fa5`, `0a76f27`, `508ce1d`.
- Required final verification command passed.

---
*Phase: 141-bm25-tool-search-help-pages-and-description-overrides*
*Completed: 2026-05-18*
