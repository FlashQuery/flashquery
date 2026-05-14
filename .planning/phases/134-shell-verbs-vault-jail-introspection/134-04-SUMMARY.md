---
phase: 134-shell-verbs-vault-jail-introspection
plan: 04
subsystem: macro
tags: [macro, introspection, mcp-broker, parser, evaluator, vitest]

requires:
  - phase: 134-shell-verbs-vault-jail-introspection
    provides: Shell verbs, vault jail, forbidden flag scan, and broker shim
provides:
  - Native and broker-backed namespace introspection for `_exists()`
  - Runtime rejection for unsupported leading-underscore namespace methods
  - T-U-152 through T-U-155 introspection coverage
affects: [macro-evaluator, macro-parser, mcp-broker, call_macro]

tech-stack:
  added: []
  patterns:
    - Namespace introspection is resolved by a dedicated resolver rather than tool dispatch
    - Brokered `_exists()` calls probe `McpBroker.isConnected(serverId)` per evaluation with no cache

key-files:
  created:
    - src/macro/introspection.ts
    - tests/unit/macro-introspection.test.ts
    - .planning/phases/134-shell-verbs-vault-jail-introspection/134-04-SUMMARY.md
  modified:
    - src/macro/types.ts
    - src/macro/parser.ts
    - src/macro/evaluator.ts

key-decisions:
  - "Kept `_exists()` engine-resolved and separate from `dispatchTool`, so introspection cannot invoke tool handlers."
  - "Defaulted evaluator introspection to `NullMcpBroker`, preserving v0 disconnected behavior for brokered namespaces."
  - "Parsed all leading-underscore zero-arg namespace methods into the introspection AST so unsupported methods fail at runtime."

patterns-established:
  - "Use `resolveNamespaceIntrospection(server, method, broker, { line })` for namespace-level runtime methods."
  - "Carry the namespace method name on `ToolExistsCall` until the AST is renamed in a broader dispatch phase."

requirements-completed: [MACRO-SHELL-05]

duration: 3min
completed: 2026-05-14
---

# Phase 134 Plan 04: Namespace Introspection Summary

**Broker-backed `_exists()` namespace introspection with runtime rejection for unsupported underscore methods**

## Performance

- **Duration:** 3min
- **Started:** 2026-05-14T16:41:57Z
- **Completed:** 2026-05-14T16:45:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added T-U-152 through T-U-155 unit coverage for native `fq._exists()`, `NullMcpBroker`, unsupported underscore methods, and no-cache broker probing.
- Added `resolveNamespaceIntrospection` to return native `fq` availability directly, call `broker.isConnected(serverId)` once for brokered `_exists()`, and reject unsupported methods with `unsupported_introspection_method`.
- Wired evaluator defaults to `NullMcpBroker` and updated parser/AST support so leading-underscore zero-arg namespace calls parse before runtime resolution.

## Task Commits

1. **Task 1: Add namespace introspection tests** - `2959489` (test)
2. **Task 2: Implement native and brokered introspection** - `2578e0d` (feat)

## Files Created/Modified

- `src/macro/introspection.ts` - Namespace introspection resolver for native `fq`, brokered `_exists()`, and unsupported method errors.
- `src/macro/types.ts` - Adds `method` to `ToolExistsCall`.
- `src/macro/parser.ts` - Parses all leading-underscore zero-arg namespace methods into the introspection AST.
- `src/macro/evaluator.ts` - Threads `McpBroker` through invocation context and delegates `ToolExistsCall` evaluation to the resolver.
- `tests/unit/macro-introspection.test.ts` - T-U-152 through T-U-155 behavior coverage.

## Decisions Made

- Preserved the existing `ToolExistsCall` AST name while adding `method`, keeping this plan narrowly scoped to `_exists()` plus unsupported runtime errors.
- Used `NullMcpBroker` as the evaluator default so brokered namespaces remain unavailable until the real broker ships.
- Left full namespaced tool dispatch, permission rules, and additional introspection methods to Phase 135 or later plans.

## Verification

- `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-introspection.test.ts` - PASS, 4 tests.
- `npm run build` - PASS.
- Acceptance greps for T-U IDs, runtime parse assertion, broker call counts, resolver strings, broker wiring, and AST method support all passed.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None. Stub-pattern scan only found legitimate evaluator/parser local initializers and null handling.

## Next Phase Readiness

MACRO-SHELL-05 is complete. Phase 134 can now run the full shell/vault/pre-scan/introspection validation gate, and Phase 135 can build full namespaced tool dispatch on top of the broker-ready evaluator context.

## Self-Check: PASSED

- Created files exist: `src/macro/introspection.ts`, `tests/unit/macro-introspection.test.ts`, `.planning/phases/134-shell-verbs-vault-jail-introspection/134-04-SUMMARY.md`.
- Task commits found in git history: `2959489`, `2578e0d`.
- Focused unit verification passed after task commits: `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-introspection.test.ts`.

---
*Phase: 134-shell-verbs-vault-jail-introspection*
*Completed: 2026-05-14*
