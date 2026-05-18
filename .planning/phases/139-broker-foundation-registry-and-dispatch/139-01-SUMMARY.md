---
phase: 139-broker-foundation-registry-and-dispatch
plan: 1
subsystem: config
tags: [mcp-broker, zod, tofu, typescript, vitest]
requires: []
provides:
  - Broker config parsing for top-level mcp_servers, host visibility, and purpose visibility
  - Shared broker public TypeScript contracts for downstream client, registry, dispatch, and macro plans
  - Canonical JSON and SHA-256 tool schema hash helpers for TOFU foundation
affects: [mcp-broker, config-loader, broker-client, registry, dispatch, macro]
tech-stack:
  added: []
  patterns:
    - Strict Zod schemas for YAML-facing broker config
    - Post-parse cross-reference validation for configured broker visibility
    - Canonical sorted JSON hashing over upstream tool metadata
key-files:
  created:
    - src/services/mcp-broker/types.ts
    - src/services/mcp-broker/tofu.ts
    - tests/unit/mcp-broker-tofu.test.ts
  modified:
    - src/config/loader.ts
    - tests/unit/config.test.ts
key-decisions:
  - "Kept broker config support scoped to parsing and validation only; runtime host registration, BM25 indexing, and hot reload remain later plans."
  - "TOFU hashes use upstream name, description, and inputSchema only; downstream description overrides are intentionally excluded from hash input."
patterns-established:
  - "Broker YAML fields are accepted in snake_case and exposed through FlashQueryConfig in camelCase."
  - "Broker visibility references are validated after schema parsing so errors can name the consumer and missing server ID."
requirements-completed: [REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-011, REQ-012]
duration: 5m05s
completed: 2026-05-18
---

# Phase 139 Plan 1: Broker Foundation Config And Types Summary

**Broker YAML parsing, shared public broker contracts, and deterministic TOFU schema hashing for downstream MCP broker plans**

## Performance

- **Duration:** 5m05s
- **Started:** 2026-05-18T01:13:03Z
- **Completed:** 2026-05-18T01:18:08Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added strict `mcp_servers`, `host`, and purpose-level broker config parsing with camelCase output.
- Added post-parse validation that rejects unknown server IDs in `host.mcp_servers` and `llm.purposes[].mcp_servers`.
- Added shared broker contracts and TOFU helpers using SDK `CallToolResult` plus SHA-256 over canonical JSON.

## Task Commits

1. **Task 1: Add broker config parsing and cross-reference validation** - `b4d1de0` (test), `a48daf5` (feat)
2. **Task 2: Create broker public types and TOFU hash helpers** - `5a3d6d0` (test), `f2881f9` (feat)

_Note: Both tasks were TDD tasks, so each has a RED test commit and a GREEN implementation commit._

## Files Created/Modified

- `src/config/loader.ts` - Adds broker config schemas, `FlashQueryConfig` fields, and server-reference validation.
- `src/services/mcp-broker/types.ts` - Defines `Broker`, `BrokerClientConfig`, `BrokeredTool`, `ConsumerContext`, `RegistryKey`, and normalized error types.
- `src/services/mcp-broker/tofu.ts` - Adds `canonicalJson` and `hashToolSchema`.
- `tests/unit/config.test.ts` - Covers broker config parsing, defaults, stdio-only transport, and fail-loud unknown references.
- `tests/unit/mcp-broker-tofu.test.ts` - Covers stable canonical JSON and TOFU hash drift behavior.

## Verification

- `npm test -- --run tests/unit/config.test.ts` - passed, 39 tests.
- `npm test -- --run tests/unit/mcp-broker-tofu.test.ts && npm run build` - passed, 5 TOFU tests and build.
- `npm test -- --run tests/unit/config.test.ts tests/unit/mcp-broker-tofu.test.ts && npm run build` - passed, 44 focused tests and build.

## Decisions Made

- Kept this plan at the loader/type/helper layer. No host MCP registration, broker process lifecycle, registry utilities, BM25 indexing, or hot-reload behavior was added.
- Exposed default `host` config as `{ mcpServers: [], toolSearch: 'disabled' }` so empty and absent host config share one resolved shape.
- Hashing accepts only upstream tool metadata fields for the canonical hash payload; `descriptionOverride` is ignored when present on caller input.

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope changes.

## Issues Encountered

None.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 02 can build registry utilities and error/coercion behavior against the committed `Broker`, `BrokeredTool`, `ConsumerContext`, `RegistryKey`, `NormalizedToolError`, and TOFU helper contracts.

## Self-Check: PASSED

Verified all created/modified files exist on disk and commits `b4d1de0`, `a48daf5`, `5a3d6d0`, and `f2881f9` exist in git history.

---
*Phase: 139-broker-foundation-registry-and-dispatch*
*Completed: 2026-05-18*
