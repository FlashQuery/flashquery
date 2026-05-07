---
phase: 119-discovery-diagnostics-help-resolver
plan: 02
subsystem: llm
tags: [call-model, discovery, diagnostics, help-resolver, agent-loop]

requires:
  - phase: 119-discovery-diagnostics-help-resolver
    provides: RED contracts for help resolver, discovery diagnostics, and search metadata from Plan 01
provides:
  - Stable raw JSON `resolver: "help"` response for `call_model`
  - Additive `list_models` capability diagnostics with unknown-vs-false states
  - Additive `list_purposes` native/template diagnostics and metadata search
affects: [phase-119, phase-120, call-model, discovery, validation]

tech-stack:
  added: []
  patterns:
    - Raw discovery/help response builders under `src/llm/`
    - Public capability diagnostics built from structured model capability defaults

key-files:
  created:
    - src/llm/help-content.ts
    - src/llm/discovery-content.ts
    - .planning/phases/119-discovery-diagnostics-help-resolver/119-02-SUMMARY.md
  modified:
    - src/llm/capabilities.ts
    - src/mcp/tools/llm.ts
    - .planning/STATE.md
    - .planning/ROADMAP.md

key-decisions:
  - "The help resolver short-circuits before the LLM client guard so unconfigured clients can still retrieve protocol help."
  - "Search indexes names, descriptions, resolver/help keys, and structured diagnostic metadata without indexing document or template bodies."

patterns-established:
  - "Discovery response construction is factored into `src/llm/discovery-content.ts` instead of growing inline controller logic."
  - "Capability diagnostics use `supported`, `unknown_declaration`, and `declared_unsupported` states for every structured capability."

requirements-completed: [DISC-01, DISC-02, DISC-03, DISC-04, VAL-119]

duration: 5min
completed: 2026-05-07
---

# Phase 119 Plan 02: Discovery Diagnostics and Help Resolver Summary

**Raw `call_model` help plus additive model, purpose, and search diagnostics for ATL discovery.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-07T00:01:21Z
- **Completed:** 2026-05-07T00:06:21Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added `buildCallModelHelpContent()` with the required stable top-level key order and machine-readable Mode 1, Mode 2, reference, template, tool, guardrail, error, discovery, and example content.
- Added `resolver: "help"` to the public Zod resolver enum and dispatched it before name/message validation and before the unconfigured LLM client guard.
- Added `buildListModelsContent`, `buildListPurposesContent`, and `buildSearchContent` helpers that expose capability diagnostics, native/template purpose diagnostics, and metadata-only search results.

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement stable help resolver content and dispatch** - `2b2f712` (feat)
2. **Task 2: Implement additive discovery diagnostics and search metadata** - `88b2ba6` (feat)

**Plan metadata:** pending docs commit

## Files Created/Modified

- `src/llm/help-content.ts` - Builds stable raw JSON help content and resolver lists.
- `src/llm/discovery-content.ts` - Builds raw discovery/search payloads for models and purposes.
- `src/llm/capabilities.ts` - Exports structured model capability diagnostics.
- `src/mcp/tools/llm.ts` - Wires `help` and discovery helper dispatch into `call_model`.

## Decisions Made

- `resolver: "help"` bypasses the `NullLlmClient` guard so MCP clients can retrieve help before configuring an LLM provider.
- Discovery search indexes public metadata and diagnostic keys/states only; it does not index document bodies, template bodies, hydrated prompts, or model messages.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Task 1 left four expected Plan 01 RED failures in the focused unit file until Task 2 implemented discovery diagnostics. After Task 2, the focused Plan 02 gate passed.

## Verification

- `rg -n "buildCallModelHelpContent|reference_syntax|template_bindings|max_iterations|max_tokens_budget|max_cost_usd|resolver.*help" src/llm/help-content.ts src/mcp/tools/llm.ts` - passed.
- `node --input-type=module -e "import fs from 'node:fs'; const s=fs.readFileSync('src/llm/help-content.ts','utf8'); for (const k of ['summary','reference_syntax','template_bindings','modes','envelope','errors','discovery','examples']) { if (!s.includes(k)) process.exit(1); }"` - passed.
- `rg -n "buildListModelsContent|buildListPurposesContent|buildSearchContent|capability_diagnostics|unknown_declaration|declared_unsupported|native_tools|native_tool_diagnostics|template_tool_warnings" src/llm/discovery-content.ts src/llm/capabilities.ts src/mcp/tools/llm.ts` - passed.
- `rg -n "assembleNativeToolRegistry|assembleTemplateToolRegistry|mergeModelVisibleToolRegistries" src/llm/discovery-content.ts` - passed.
- `rg -n "document\\.content|body|hydrated|templateBody|messages\\]" src/llm/discovery-content.ts` - no matches.
- `npm test -- tests/unit/llm-tool.test.ts tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-registry.test.ts` - passed, 117 tests.
- `npm run build` - passed.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None. Stub-pattern scan found intentional empty diagnostic arrays and pre-existing guard/default initializers, not unfinished implementation.

## Threat Flags

None. This plan exposed existing discovery/help metadata through the already-planned MCP resolver surface and did not add a new endpoint, auth path, file access pattern, or schema boundary.

## Next Phase Readiness

Plan 03 can validate the public directed scenarios and coverage ledgers against the now-green help and discovery diagnostics implementation.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/119-discovery-diagnostics-help-resolver/119-02-SUMMARY.md`.
- Task commits exist in git log: `2b2f712`, `88b2ba6`.
- Key files exist on disk.
- No tracked file deletions were introduced.
- Focused unit gate and build passed.

---
*Phase: 119-discovery-diagnostics-help-resolver*
*Completed: 2026-05-07*
