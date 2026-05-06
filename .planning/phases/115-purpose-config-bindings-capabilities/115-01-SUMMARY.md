---
phase: 115-purpose-config-bindings-capabilities
plan: 01
subsystem: config
tags: [llm, config, atl, capabilities, yaml]

requires:
  - phase: 114-template-parameterization
    provides: Template parameterization and reference hydration foundations
provides:
  - Strict purpose orchestration config fields for tools, excluded_tools, and templates
  - Numeric validation for loop guardrail purpose defaults
  - Structured model capability parsing with legacy string capability migration to tags
affects: [phase-116, phase-117, phase-118, llm-config, call-model]

tech-stack:
  added: []
  patterns:
    - Zod preprocess migration for legacy YAML fields
    - Verbatim preservation for provider/default and capability contract keys

key-files:
  created:
    - .planning/phases/115-purpose-config-bindings-capabilities/115-01-SUMMARY.md
  modified:
    - src/config/loader.ts
    - tests/unit/llm-config.test.ts
    - flashquery.example.yml

key-decisions:
  - "Legacy model capabilities string arrays are accepted as migration input and normalized to tags."
  - "Structured behavioral capability keys remain snake_case in the runtime config to avoid creating a second capability surface."
  - "Purpose defaults remain provider-pass-through, with targeted numeric validation only for known loop guardrails."

patterns-established:
  - "Model schema preprocessing can migrate old YAML shapes before Zod validation while preserving the final runtime contract."
  - "Config loader restores selected nested objects after snakeToCamel when the YAML key shape is itself part of the public API."

requirements-completed: [BIND-01, BIND-02, CAP-01, CAP-02]

duration: 7 min
completed: 2026-05-06
---

# Phase 115 Plan 01: Purpose Config Schema Summary

**Strict ATL purpose YAML and structured model capability config with legacy capability tags migration**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-06T03:18:00Z
- **Completed:** 2026-05-06T03:24:53Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Added ATL-U-08 config parser coverage for purpose `tools`, `excluded_tools`, `templates`, unknown purpose key rejection, loop guardrail type validation, and structured model capabilities.
- Updated `src/config/loader.ts` so purpose orchestration keys are first-class and unknown top-level purpose keys now fail startup config validation.
- Migrated legacy model `capabilities: string[]` metadata into `tags`, while preserving structured capability booleans as the only behavioral capability surface.
- Updated `flashquery.example.yml` to demonstrate `tags`, structured `capabilities`, and loop guardrail defaults under purpose `defaults`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Lock config parser contracts for purpose fields and structured capabilities** - `ca641f4` (test)
2. **Task 2: Implement strict purpose schema and model capability migration** - `5cb9811` (feat)
3. **Task 3: Update example config to the final capability surface** - `5b57850` (docs)

**Plan metadata:** this SUMMARY/tracking commit (docs)

## Files Created/Modified

- `src/config/loader.ts` - Adds strict purpose schema, loop guardrail validation, structured capability schema, and legacy capability-to-tags migration.
- `tests/unit/llm-config.test.ts` - Adds ATL-U-08 coverage and updates discovery metadata tests to assert the final model capability surface.
- `flashquery.example.yml` - Shows tags, structured capabilities, and purpose orchestration/default examples.
- `.planning/phases/115-purpose-config-bindings-capabilities/115-01-SUMMARY.md` - Records plan completion.

## Decisions Made

- Legacy free-form `capabilities` arrays remain accepted as migration input, but they normalize to `tags` and are no longer exposed as behavioral capabilities.
- Structured capability keys are preserved as `tool_calling`, `usage_on_tool_calls`, `strict_tools`, `parallel_tool_calls`, and `structured_outputs_with_tools` in loaded config.
- `response_format` remains demonstrated only under purpose `defaults`, matching provider parameter pass-through semantics.

## Deviations from Plan

None - plan executed exactly as written.

---

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope changes.

## Issues Encountered

- Parallel executor subagents were unavailable in worktree mode in this runtime; execution continued via the documented sequential inline fallback before any implementation files were touched by those subagents.

## User Setup Required

None - no external service configuration required.

## Verification

- `npm test -- tests/unit/llm-config.test.ts` - passed
- `npm test -- tests/unit/llm-config.test.ts && npm run build` - passed
- Acceptance greps for ATL-U-08 config keys, final capability surface, and example YAML all passed.

## Self-Check: PASSED

- Key files exist on disk.
- Task commits exist for `115-01`.
- Plan-level verification passed.
- Requirements completed: BIND-01, BIND-02, CAP-01, CAP-02.

## Next Phase Readiness

Purpose config parsing and structured capability declarations are ready for Wave 2 capability admission gates and later config sync work.

---
*Phase: 115-purpose-config-bindings-capabilities*
*Completed: 2026-05-06*
