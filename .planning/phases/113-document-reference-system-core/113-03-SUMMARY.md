---
phase: 113-document-reference-system-core
plan: 03
subsystem: mcp
tags: [call-model, host-only-hydration, mcp, llm]
requires:
  - phase: 113-document-reference-system-core
    provides: 113-02 resolver core and hydration helpers
provides:
  - Host-authored-only reference scan in call_model
  - Typed reference failure envelopes on the MCP surface
  - Returned messages preserve assistant/tool data while hydrating host inputs
affects: [phase-114-templates, phase-117-agent-loop, phase-120-validation]
tech-stack:
  added: []
  patterns: [compact host scan remapped to original message indexes, fail-fast pre-dispatch errors]
key-files:
  created: []
  modified: [src/constants/llm.ts, src/mcp/tools/llm.ts, tests/unit/llm-tool.test.ts]
key-decisions:
  - "call_model scans only system/user string content for references."
  - "Reference parse or resolution errors abort before provider dispatch."
  - "Discovery resolvers ignore return_messages and keep raw discovery shapes."
patterns-established:
  - "Host-authored inputs are compacted for reference parsing, then remapped to original message indexes for hydration."
requirements-completed: [REF-01, REF-02, REF-03, REF-04, REF-05, REF-06, REF-07, REF-08, VAL-113]
duration: unknown
completed: 2026-05-05
---

# Phase 113-03: call_model Integration Summary

**Host-only reference hydration wired into `call_model` with fail-fast typed errors**

## Accomplishments

- Integrated resolver parsing and hydration into `call_model` before model dispatch.
- Preserved assistant/tool messages as ordinary data, including reference-looking strings.
- Returned stable `reference_resolution_failed` envelopes with `failed_references[].reason` and `detail`.
- Kept `return_messages` behavior compatible with Phase 112 defaults.

## Task Commits

1. **call_model host-only integration** - `b485dfd` (feat)

## Verification

- `npm test -- tests/unit/llm-tool.test.ts tests/unit/reference-resolver.test.ts` passed 97/97.

## Deviations from Plan

None - followed the host-only integration boundary.
