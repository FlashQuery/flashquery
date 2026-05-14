---
phase: 135-tool-registry-dispatch-permissions
plan: 04
subsystem: macro
tags: [macro, tool-registry, dispatch, permissions, call-macro, integration]

requires:
  - phase: 135-tool-registry-dispatch-permissions
    provides: ToolRegistry, dispatchMacroTool, static permission pre-scan, and evaluator hard exclusions from Plans 02-03
provides:
  - Public call_macro wiring through host-derived caller context and native catalog dispatch
  - Internal runMacroSource helper for delegated caller context use by agentic loop code
  - Real fq.write_document and fq.search integration validation through registered native handlers
  - Recorded Phase 135 final unit, integration, and build verification gates
affects: [135-tool-registry-dispatch-permissions, macro-support, native-tool-dispatch, call_macro]

tech-stack:
  added: []
  patterns:
    - Public MCP call_macro derives host identity internally and omits caller-controlled identity fields
    - Macro evaluation can dispatch through the registry path without the legacy injected dispatchTool seam
    - Integration tests assert current fqc_documents status and unified search total envelope

key-files:
  created:
    - .planning/phases/135-tool-registry-dispatch-permissions/135-VALIDATION.md
  modified:
    - src/mcp/tools/macro.ts
    - src/macro/evaluator.ts
    - tests/integration/macro-tool-dispatch.test.ts

key-decisions:
  - "Inbound MCP call_macro always uses MacroCallerContext origin host; delegated callers must use the internal runMacroSource helper with a purposeName."
  - "Native dispatch context for public call_macro includes an AbortSignal, instanceId, and logContext, then passes through buildToolRegistry."
  - "Macro dispatch integration assertions use the current canonical document status column and unified search total field."

patterns-established:
  - "runMacroSource is the internal bridge for source parsing, registry assembly, and evaluator invocation."
  - "callMacroInputSchema is exported for schema absence tests while server registration passes its shape to MCP."

requirements-completed:
  - MACRO-DISP-01
  - MACRO-DISP-02
  - MACRO-DISP-03
  - MACRO-DISP-04
  - MACRO-DISP-05
  - MACRO-DISP-06
  - MACRO-DISP-07

duration: 6m14s
completed: 2026-05-14
---

# Phase 135 Plan 04: Public call_macro Registry Dispatch Summary

**Public `call_macro` now builds a host-derived native tool registry, dispatches real `fq.*` tools through registered handlers, and records final Phase 135 verification.**

## Performance

- **Duration:** 6m14s
- **Started:** 2026-05-14T18:39:34Z
- **Completed:** 2026-05-14T18:45:48Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Exported `callMacroInputSchema` and `runMacroSource`, keeping caller identity internal and absent from the public MCP schema.
- Wired public `call_macro` to `getNativeToolCatalog(server)`, `buildToolRegistry`, `NativeToolDispatchContext`, and `evaluateProgram`.
- Made registry-backed evaluator dispatch independent from the older injected `dispatchTool` test seam.
- Closed real integration coverage for `fq.write_document` persistence and `fq.search` result return through public `call_macro`.
- Recorded the required Phase 135 unit, integration, and build gates in `135-VALIDATION.md`.

## Task Commits

1. **Task 1: Wire caller context and native catalog into call_macro** - `ed2bed3` (feat)
2. **Task 2: Close real native dispatch integration** - `440c5a9` (test)
3. **Task 3: Run required Phase 135 verification gates** - `ea10e55` (docs)

## Files Created/Modified

- `src/mcp/tools/macro.ts` - Exports the public schema and internal runner; builds host caller context, native catalog registry, broker shim, and native dispatch context for `call_macro`.
- `src/macro/evaluator.ts` - Allows registry-backed dispatch to run without requiring the legacy injected `dispatchTool` option.
- `tests/integration/macro-tool-dispatch.test.ts` - Aligns real dispatch assertions with current `fqc_documents.status` and unified `search.total` envelope.
- `.planning/phases/135-tool-registry-dispatch-permissions/135-VALIDATION.md` - Records final Phase 135 verification commands and outcomes.

## Decisions Made

- Public MCP requests never accept caller identity; inbound calls are host-originated by construction.
- Delegated macro execution is represented by the internal `runMacroSource` helper, where caller context and purpose name are supplied by trusted agentic-loop code.
- The integration test treats `status: active` as the document lifecycle state because the current database schema does not have a `lifecycle_state` column.
- The search integration assertion uses `total` because that is the canonical unified `search` result count field in the current handler.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed evaluator dependency on the legacy dispatchTool seam for registry dispatch**
- **Found during:** Task 1 (Wire caller context and native catalog into call_macro)
- **Issue:** `evalToolCall` threw `tool_dispatcher_missing` before reaching the registry-backed `dispatchMacroTool` path.
- **Fix:** Changed the guard to require a dispatcher only when neither `toolRegistry` nor `dispatchTool` is present.
- **Files modified:** `src/macro/evaluator.ts`
- **Verification:** `npm test -- --reporter=verbose macro-caller-identity macro-registry macro-dispatcher` passed.
- **Committed in:** `ed2bed3`

**2. [Rule 1 - Bug] Corrected integration assertions to the current schema and search envelope**
- **Found during:** Task 2 (Close real native dispatch integration)
- **Issue:** The integration test selected nonexistent `fqc_documents.lifecycle_state` and expected a nonexistent `counts` field from unified `search`.
- **Fix:** Asserted `fqc_documents.status = active` and `payload.result.total`.
- **Files modified:** `tests/integration/macro-tool-dispatch.test.ts`
- **Verification:** `npm run test:integration -- --reporter=verbose macro-tool-dispatch` passed.
- **Committed in:** `440c5a9`

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes were required to make the planned registry dispatch and real-handler integration work against the current codebase. No architecture changes were introduced.

## Issues Encountered

- Integration setup logged an idempotent DDL warning while trying to drop the already-absent `fqc_documents.description` column. The command exited 0 and both integration tests passed.
- `.planning/` is ignored by the repository, so `135-VALIDATION.md` had to be force-added as a planned execution artifact.

## Verification

- `npm test -- --reporter=verbose macro-caller-identity macro-registry macro-dispatcher` - passed, 3 files / 13 tests.
- `npm test -- --reporter=verbose macro-registry macro-permission-prescan macro-dispatcher` - passed, 3 files / 15 tests.
- `npm run test:integration -- --reporter=verbose macro-tool-dispatch` - passed, 1 file / 2 tests using `.env.test`.
- `npm run build` - passed.
- Acceptance greps for caller identity absence, native catalog wiring, native dispatch context threading, internal caller contexts, and integration registration passed.

## Known Stubs

None.

## Threat Flags

None.

## User Setup Required

None - `.env.test` credentials were already available for integration verification.

## Next Phase Readiness

Phase 135 is complete. Phase 136 can build task lifecycle and cancellation on top of a public `call_macro` path that now reaches real native tool handlers through the macro registry and dispatcher.

## Self-Check: PASSED

- Key files exist: `src/mcp/tools/macro.ts`, `src/macro/evaluator.ts`, `tests/integration/macro-tool-dispatch.test.ts`, `135-VALIDATION.md`, and `135-04-SUMMARY.md`.
- Task commits exist: `ed2bed3`, `440c5a9`, and `ea10e55`.
- Required verification commands passed and are recorded in `135-VALIDATION.md`.

---
*Phase: 135-tool-registry-dispatch-permissions*
*Completed: 2026-05-14*
