---
phase: 143-diagnostic-cli-and-remaining-macro-extensions
plan: 1
subsystem: cli
tags: [mcp-broker, diagnostics, commander, tdd, yaml]

requires:
  - phase: 141-142-mcp-broker
    provides: BrokerClient, mcp_servers config schema, brokered tool metadata
provides:
  - flashquery list-tools diagnostic command
  - paste-ready MCP broker tool_overrides YAML output
  - unit coverage for successful YAML, YAML reparse, and stderr failure paths
affects: [mcp-broker, cli, diagnostics]

tech-stack:
  added: []
  patterns:
    - Injectable CLI helper with stream and client factory seams for unit tests
    - Commander subcommand wrapper delegating to a testable service helper

key-files:
  created:
    - src/services/mcp-broker/cli.ts
    - src/cli/commands/list-tools.ts
    - tests/unit/list-tools-command.test.ts
  modified:
    - src/index.ts

key-decisions:
  - "Kept diagnostic implementation in src/services/mcp-broker/cli.ts so subprocess discovery can be unit-tested without invoking Commander."
  - "The command constructs BrokerClient only from validated mcp_servers config entries; CLI server id is used only as a config key."
  - "Successful output is written only to stdout as the tool_overrides YAML fragment; failure detail and captured server stderr are written only to stderr."

patterns-established:
  - "Diagnostic broker CLIs should accept injectable streams and client factories for focused unit coverage."
  - "Paste-ready YAML fragments should keep user-editable override fields commented while preserving valid YAML structure."

requirements-completed: [REQ-071, REQ-072, REQ-073]

duration: 4min
completed: 2026-05-19
---

# Phase 143 Plan 1: Diagnostic CLI List Tools Summary

**MCP broker list-tools diagnostic CLI with paste-ready tool override YAML and stderr-only failure reporting**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-19T00:26:52Z
- **Completed:** 2026-05-19T00:30:07Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added RED unit tests for `runListToolsCommand` covering T-U-143-CLI-071, T-U-143-CLI-072, and T-U-143-CLI-073.
- Implemented `runListToolsCommand` using `loadConfig`, configured `mcp_servers.<server>`, `BrokerClient.listTools()`, and `shutdown()` cleanup.
- Added and registered the Commander `list-tools <server>` subcommand.

## Task Commits

1. **Task 1: Add RED diagnostic CLI tests for YAML stdout and stderr failures** - `fa3471a` (test)
2. **Task 2: Implement list-tools command through broker discovery** - `e01500a` (feat)

## Files Created/Modified

- `tests/unit/list-tools-command.test.ts` - Focused TDD coverage for paste-ready YAML, YAML reparse, stream separation, and captured stderr failures.
- `src/services/mcp-broker/cli.ts` - Testable diagnostic CLI helper and YAML formatter.
- `src/cli/commands/list-tools.ts` - Commander subcommand wrapper.
- `src/index.ts` - CLI registration for the new subcommand.

## Decisions Made

- Used an injectable `clientFactory` instead of spawning fixture subprocesses in unit tests.
- Returned numeric exit codes from the helper and let the Commander wrapper set `process.exitCode`.
- Kept stdout clean on success and withheld partial YAML on failure.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None. Stub-pattern scan found only non-stub nullable type/control-flow code and pre-existing CLI text in `src/index.ts`.

## Threat Flags

None. The CLI subprocess and stderr surfaces were already covered by the plan threat model.

## TDD Gate Compliance

- RED gate: `fa3471a` added failing tests; focused suite failed on missing `src/services/mcp-broker/cli.ts`.
- GREEN gate: `e01500a` implemented the helper and command registration; focused suite passed.

## Verification

- `npm test -- --run tests/unit/list-tools-command.test.ts` - passed, 3 tests.
- `npm run build` - passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 143-02 can build on the existing broker and macro surfaces. Scenario-level CLI closure remains delegated to later directed/YAML validation as planned.

## Self-Check: PASSED

- Created files exist: `src/services/mcp-broker/cli.ts`, `src/cli/commands/list-tools.ts`, `tests/unit/list-tools-command.test.ts`.
- Modified file exists: `src/index.ts`.
- Task commits found: `fa3471a`, `e01500a`.

---
*Phase: 143-diagnostic-cli-and-remaining-macro-extensions*
*Completed: 2026-05-19*
