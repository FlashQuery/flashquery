---
phase: 135-tool-registry-dispatch-permissions
plan: 01
subsystem: testing
tags: [macro, tool-registry, dispatch, permissions, vitest]

requires:
  - phase: 134-shell-verbs-vault-jail-introspection
    provides: macro evaluator, shell verbs, vault jail, and namespace introspection baseline
provides:
  - Wave 0 red unit coverage for macro registry, dispatcher, permission pre-scan, hard exclusions, and caller identity
  - Wave 0 red integration coverage for real call_macro dispatch to fq.write_document and fq.search
  - Explicit Vitest integration include for macro-tool-dispatch.test.ts
affects: [135-tool-registry-dispatch-permissions, macro-support, native-tool-dispatch]

tech-stack:
  added: []
  patterns:
    - Vitest red-test coverage against planned Phase 135 module exports
    - Integration tests use existing .env.test/HAS_SUPABASE helper behavior

key-files:
  created:
    - tests/unit/macro-registry.test.ts
    - tests/unit/macro-dispatcher.test.ts
    - tests/unit/macro-permission-prescan.test.ts
    - tests/unit/macro-hard-exclusions.test.ts
    - tests/unit/macro-caller-identity.test.ts
    - tests/integration/macro-tool-dispatch.test.ts
  modified:
    - tests/config/vitest.integration.config.ts

key-decisions:
  - "Wave 0 tests intentionally remain RED until Phase 135 production modules and call_macro dispatch wiring land."
  - "Integration dispatch coverage uses createMcpServer with InMemoryTransport and existing .env.test/Supabase helpers rather than a mock dispatcher."

patterns-established:
  - "Macro dispatch tests assert planned registry/dispatcher/pre-scan module exports before implementation."
  - "Macro integration tests exercise public call_macro with fq.write_document and fq.search through real native handlers."

requirements-completed:
  - MACRO-DISP-01
  - MACRO-DISP-02
  - MACRO-DISP-03
  - MACRO-DISP-04
  - MACRO-DISP-05
  - MACRO-DISP-06
  - MACRO-DISP-07

duration: 7m19s
completed: 2026-05-14
---

# Phase 135 Plan 01: Wave 0 Dispatch Permission Tests Summary

**Executable red test contract for macro tool registry, dispatch, permission pre-scan, hard exclusions, caller identity, and real native handler integration.**

## Performance

- **Duration:** 7m19s
- **Started:** 2026-05-14T18:14:22Z
- **Completed:** 2026-05-14T18:21:41Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- Added unit coverage for Test Plan §4.6 IDs T-U-156 through T-U-171.
- Added integration coverage for T-I-003 and T-I-004 using public `call_macro`.
- Registered `tests/integration/macro-tool-dispatch.test.ts` in the explicit Vitest integration include list.

## Task Commits

1. **Task 1: Registry and dispatcher unit coverage** - `e9220dc` (test)
2. **Task 2: Permission, hard-exclusion, and caller-identity unit coverage** - `fa9bc5a` (test)
3. **Task 3: Integration dispatch coverage and registration** - `4c45610` (test)

## Files Created/Modified

- `tests/unit/macro-registry.test.ts` - Red contract tests for `buildToolRegistry`, host/delegated allowlist sources, `call_macro` omission, broker entries, and native input validation.
- `tests/unit/macro-dispatcher.test.ts` - Red tests for `dispatchMacroTool`, lookup errors, broker dispatch, and allowlist backstop.
- `tests/unit/macro-permission-prescan.test.ts` - Red tests for full-AST permission pre-scan, aggregation, and zero side effects.
- `tests/unit/macro-hard-exclusions.test.ts` - Red tests for `fq.call_macro`, template masquerade, host `fq.call_model`, and delegated `fq.call_model`.
- `tests/unit/macro-caller-identity.test.ts` - Red tests for internal host/delegated caller context and public schema absence of `callerKind`.
- `tests/integration/macro-tool-dispatch.test.ts` - Red integration tests for real `fq.write_document` and `fq.search` macro dispatch.
- `tests/config/vitest.integration.config.ts` - Added the macro dispatch integration suite to the explicit include list.

## Decisions Made

- Wave 0 tests intentionally remain RED until Phase 135 implementation plans add `src/macro/registry.ts`, `src/macro/dispatcher.ts`, `src/macro/permission-prescan.ts`, and public `call_macro` dispatch wiring.
- Integration tests use `.env.test` through existing helper setup and only skip through the shared `HAS_SUPABASE` guard.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended integration setup timeout and guarded cleanup**
- **Found during:** Task 3 (Add integration dispatch coverage and register it)
- **Issue:** The integration suite timed out in `beforeAll` before reaching the intended red assertion, and cleanup tried to use `supabaseManager` when setup had not finished.
- **Fix:** Added a 30s `beforeAll` timeout and best-effort cleanup guard.
- **Files modified:** `tests/integration/macro-tool-dispatch.test.ts`
- **Verification:** `npm run test:integration -- --reporter=verbose macro-tool-dispatch` now reaches the intended red assertions for unimplemented macro native dispatch.
- **Committed in:** `4c45610`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The fix keeps Wave 0 integration coverage runnable and preserves the planned red failure mode.

## Issues Encountered

- Unit verification is red as expected because `src/macro/registry.ts`, `src/macro/dispatcher.ts`, and `src/macro/permission-prescan.ts` do not exist yet.
- Caller-identity tests are red as expected because `callMacroInputSchema` and `runMacroSource` are not exported yet.
- Integration verification is red as expected because `call_macro` does not yet dispatch namespaced tool calls to real native handlers.

## Verification

- `npm test -- --reporter=verbose macro-registry macro-dispatcher` - failed as expected: missing `../../src/macro/registry.js` and `../../src/macro/dispatcher.js`.
- `npm test -- --reporter=verbose macro-permission-prescan macro-hard-exclusions macro-caller-identity` - failed as expected: missing `../../src/macro/permission-prescan.js` plus missing `callMacroInputSchema`/`runMacroSource` exports.
- `npm run test:integration -- --reporter=verbose macro-tool-dispatch` - failed as expected: tests reached public `call_macro`, which returned `isError: true` before native dispatch exists.
- `npm test -- --reporter=verbose macro-registry macro-permission-prescan macro-dispatcher` - failed as expected on missing planned Phase 135 modules.
- `rg -n "T-U-15[6-9]|T-U-16[0-9]|T-U-17[0-1]|T-I-003|T-I-004" ...` - passed; all required IDs are present.
- `rg -n "tests/integration/macro-tool-dispatch\\.test\\.ts" tests/config/vitest.integration.config.ts` - passed with exactly one include entry.

## Known Stubs

None.

## User Setup Required

None.

## Next Phase Readiness

Phase 135 Plan 02 can implement the registry and dispatcher foundation directly against the red tests in `macro-registry.test.ts` and `macro-dispatcher.test.ts`.

## Self-Check: PASSED

- All created files exist.
- Task commits exist: `e9220dc`, `fa9bc5a`, `4c45610`.
- Required Test Plan IDs T-U-156 through T-U-171 and T-I-003/T-I-004 are present.
- Integration include entry exists exactly once.

---
*Phase: 135-tool-registry-dispatch-permissions*
*Completed: 2026-05-14*
