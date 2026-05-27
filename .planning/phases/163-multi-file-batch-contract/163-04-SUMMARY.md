---
phase: 163-multi-file-batch-contract
plan: 04
subsystem: testing
tags: [scenario-tests, yaml, batch-envelope, version-token, vault-write-coherency]
requires:
  - phase: 163-multi-file-batch-contract
    provides: archive/remove batch envelopes and compound mixed input behavior from plans 02 and 03
provides:
  - INT-WCO-02 public archive_document batch envelope scenario for T-Y-002
  - INT-WCO-03 public mixed bare/object batch input scenario for T-Y-003
  - Scenario coverage registration for REQ-018 and REQ-019
affects: [phase-163, integration-scenarios, vault-write-coherency]
tech-stack:
  added: []
  patterns:
    - YAML scenarios bind get_document version_token responses and pass them as co-located batch item tokens
    - call_macro assertions compact destructive batch results into stable status evidence after a single mutating call
key-files:
  created:
    - tests/scenarios/integration/tests/batch_envelope_per_item.yml
    - tests/scenarios/integration/tests/batch_mixed_input.yml
    - .planning/phases/163-multi-file-batch-contract/163-04-SUMMARY.md
  modified:
    - tests/scenarios/integration/INTEGRATION_COVERAGE.md
key-decisions:
  - "Scenario assertions use call_macro to execute each destructive batch once and return compact ordered status evidence for YAML JSON assertions."
  - "Scenario fixture paths are flat under _integration so batch-contract coverage is not coupled to directory-creation behavior."
patterns-established:
  - "Public batch scenario tests can capture stale tokens with named get_document action steps, mutate the fixture, and pass ${name.version_token} in object-form identifiers."
requirements-completed: [REQ-018, REQ-019]
duration: 9min
completed: 2026-05-27
---

# Phase 163 Plan 04: Batch Scenario Contract Summary

**Public YAML scenarios for ordered archive batch envelopes and mixed bare/object version-token inputs**

## Performance

- **Duration:** 9 min
- **Started:** 2026-05-27T20:08:09Z
- **Completed:** 2026-05-27T20:17:03Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added `batch_envelope_per_item.yml` covering `INT-WCO-02` / `T-Y-002` with ordered `succeeded`, `conflicted`, `failed`, `succeeded` archive batch evidence.
- Added `batch_mixed_input.yml` covering `INT-WCO-03` / `T-Y-003` with `[bare-string, current-token object, stale-token object]` producing `succeeded`, `succeeded`, `conflicted`.
- Registered both scenario coverage rows against REQ-018 and REQ-019 in `INTEGRATION_COVERAGE.md`.

## Task Commits

1. **Task 1: Add INT-WCO-02 archive batch envelope scenario** - `a754cca` (test)
2. **Task 2: Add INT-WCO-03 mixed input scenario and final phase evidence** - `1b8d3ed` (test)

## Files Created/Modified

- `tests/scenarios/integration/tests/batch_envelope_per_item.yml` - Public archive batch scenario with stale-token conflict, missing-item failure, ordered statuses, and surviving archive-state checks.
- `tests/scenarios/integration/tests/batch_mixed_input.yml` - Public mixed input scenario proving bare strings and tokened objects compose in one batch.
- `tests/scenarios/integration/INTEGRATION_COVERAGE.md` - Adds and marks passing `INT-WCO-02` and `INT-WCO-03`.
- `.planning/phases/163-multi-file-batch-contract/163-04-SUMMARY.md` - Execution record for this plan.

## Decisions Made

- Used `call_macro` inside the YAML assertions to execute each destructive batch exactly once and return a compact evidence object. Re-running `archive_document` in separate assertions would mutate success items first and then make later token checks stale.
- Kept fixtures at the `_integration/` root so these scenarios isolate the batch contract rather than directory creation or nested directory lock behavior.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Avoided repeated destructive batch calls in YAML assertions**
- **Found during:** Task 1 and Task 2
- **Issue:** The YAML runner supports one `expect_json_equals` block per assertion. Splitting status/detail checks across multiple `archive_document` assertions would re-run the destructive batch and change tokens.
- **Fix:** Wrapped the batch call in `call_macro`, collected statuses and conflict details into one evidence payload, then asserted the ordered list and detail fields from that single mutation.
- **Files modified:** `tests/scenarios/integration/tests/batch_envelope_per_item.yml`, `tests/scenarios/integration/tests/batch_mixed_input.yml`
- **Verification:** Both scenarios passed with a repo-local `TMPDIR`.
- **Committed in:** `a754cca`, `1b8d3ed`

**2. [Rule 3 - Blocking] Used flat scenario fixture paths**
- **Found during:** Task 1
- **Issue:** Initial nested fixture paths added directory setup noise to a test whose purpose is batch result semantics.
- **Fix:** Moved fixtures to flat `_integration/batch-*` paths and kept the missing identifier flat as well.
- **Files modified:** `tests/scenarios/integration/tests/batch_envelope_per_item.yml`, `tests/scenarios/integration/tests/batch_mixed_input.yml`
- **Verification:** YAML parsing passed and both managed scenarios passed with repo-local `TMPDIR`.
- **Committed in:** `a754cca`, `1b8d3ed`

**Total deviations:** 2 auto-fixed (Rule 3).
**Impact on plan:** Both changes preserve the required public contract evidence while avoiding test-runner limitations and unrelated setup behavior.

## Issues Encountered

- Exact managed scenario commands using the default macOS temp root failed before scenario logic with `Directory lock path escapes vault root: /var/...`. The same committed scenarios passed when `TMPDIR` was set to a repo-local directory, avoiding the `/var` versus `/private/var` symlink mismatch in path containment.
- Focused Vitest integration tests logged expected background embedding errors because the test config has no embedding API key; assertions passed.
- Unrelated dirty files were present before and after execution (`.planning/STATE.md`, `package.json`, `package-lock.json`, and earlier planning files). They were not staged or committed.

## Known Stubs

None.

## Threat Flags

None - the changed surface is scenario coverage and coverage registration only.

## Verification

- `python3 -c "import yaml; yaml.safe_load(open('tests/scenarios/integration/tests/batch_envelope_per_item.yml')); yaml.safe_load(open('tests/scenarios/integration/tests/batch_mixed_input.yml'))"` passed.
- `rg -n "INT-WCO-02|T-Y-002" tests/scenarios/integration/INTEGRATION_COVERAGE.md tests/scenarios/integration/tests/batch_envelope_per_item.yml` passed.
- `rg -n "INT-WCO-03|T-Y-003" tests/scenarios/integration/INTEGRATION_COVERAGE.md tests/scenarios/integration/tests/batch_mixed_input.yml` passed.
- `npm test -- tests/unit/batch-input-shape.test.ts` passed: 5 tests.
- `npm run test:integration -- tests/integration/batch-envelope.integration.test.ts tests/integration/batch-input-shape.integration.test.ts` passed: 2 files, 5 tests.
- `python3 tests/scenarios/integration/run_integration.py --managed batch_envelope_per_item` failed in the default macOS temp environment before scenario setup with `/var`/`/private/var` vault-root containment mismatch.
- `python3 tests/scenarios/integration/run_integration.py --managed batch_mixed_input` failed for the same default macOS temp-root containment issue.
- `TMPDIR="$PWD/.tmp/scenario-vaults" python3 tests/scenarios/integration/run_integration.py --managed batch_envelope_per_item` passed: 9/9 steps.
- `TMPDIR="$PWD/.tmp/scenario-vaults" python3 tests/scenarios/integration/run_integration.py --managed batch_mixed_input` passed: 10/10 steps.

## User Setup Required

None - no new external service configuration required beyond the existing `.env.test` scenario/integration setup.

## Next Phase Readiness

Phase 163 has public scenario coverage for REQ-018 and REQ-019. The remaining caveat is the pre-existing managed scenario temp-root issue on macOS default `/var` temp paths; use a non-symlink `TMPDIR` until that runner/config path normalization issue is addressed.

## Self-Check: PASSED

- Found all created/modified plan files on disk.
- Found task commits `a754cca` and `1b8d3ed` in git history.

---
*Phase: 163-multi-file-batch-contract*
*Completed: 2026-05-27*
