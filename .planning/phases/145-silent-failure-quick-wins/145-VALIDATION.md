# Phase 145: Silent Failure Quick Wins - Validation Strategy

**Phase:** 145  
**Created:** 2026-05-24  
**Status:** Ready for execution

## Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest |
| Unit config | `tests/config/vitest.unit.config.ts` |
| Integration config | `tests/config/vitest.integration.config.ts` |
| Directed scenario harness | `tests/scenarios/directed/run_suite.py --managed` |
| Credential behavior | Integration tests use `.env.test` via `tests/helpers/test-env.ts` and skip with `describe.skipIf(!HAS_SUPABASE)` when unavailable. |

## Phase Requirements -> Test Map

| Requirement | Behavior | Automated Command | Expected Output |
|-------------|----------|-------------------|-----------------|
| REQ-001 / T-U-001 | Omitted/global/matched plugin scope preserves intended scope | `npm test -- tests/unit/write-memory.test.ts` | Unit assertions pass and captured insert rows contain expected `plugin_scope`. |
| REQ-001 / T-U-002 | RPC error and thrown lookup return `lookup_failed` and do not insert | `npm test -- tests/unit/write-memory.test.ts` | Parsed JSON has `error: "lookup_failed"` and `details.reason: "lookup_failed"`; insert spy is not called. |
| REQ-001 / T-U-003 | Unexpected RPC shape rejects without broad double assertion | `npm test -- tests/unit/write-memory.test.ts` plus negative grep | Unit assertion passes; `rg -n "as unknown as Promise<" src/mcp/tools/memory.ts` has no matches. |
| REQ-001 / T-I-001 | Public handler refuses controlled lookup failure without global fallback row | `npm run test:integration -- tests/integration/mcp/tools/memory-plugin-scope.test.ts` | Test passes or skips only because `HAS_SUPABASE` is false. |
| REQ-002 / T-U-004 | EMBED-DRAIN query error object and throw map to `drain_query_failed` | `npm test -- tests/unit/scanner-embed-drain-status.test.ts` | Scan resolves, status is `drain_query_failed`, and logger.error contains stable EMBED-DRAIN text. |
| REQ-002 / T-U-005 | Maintenance handles new scanner status explicitly while hiding internals | `npm test -- tests/unit/maintain-vault.test.ts` | Result remains parseable and does not expose raw `embedding_status` or `embeds_awaited`. |
| REQ-002 / T-I-002 | Controlled drain query failure returns partial-success status | `npm run test:integration -- tests/integration/services/scanner-embed-drain.test.ts` | Test passes or skips only because `HAS_SUPABASE` is false. |
| Final gate | TypeScript and lint remain clean | `npm run typecheck && npm run lint` | Both commands exit 0. |

## Automated Verification Commands

### Per-Task Verification

**Task 1: Plugin-scope lookup failure**
```bash
npm test -- tests/unit/write-memory.test.ts
npm run test:integration -- tests/integration/mcp/tools/memory-plugin-scope.test.ts
! rg -n "as unknown as Promise|defaulting to 'global'|jsonRuntimeError\\(\\{[^\\n]*lookup_failed" src/mcp/tools/memory.ts
rg -n "lookup_failed|jsonExpectedError" src/mcp/tools/memory.ts src/mcp/tool-help/write_memory.tool.md tests/unit/write-memory.test.ts tests/integration/mcp/tools/memory-plugin-scope.test.ts
```

**Task 2: Scanner drain query failure**
```bash
npm test -- tests/unit/scanner-embed-drain-status.test.ts tests/unit/maintain-vault.test.ts
npm run test:integration -- tests/integration/services/scanner-embed-drain.test.ts
rg -n "drain_query_failed|\\[EMBED-DRAIN\\].*drain_query_failed|embedding_drain_query_failed" src/services/scanner.ts src/services/maintenance.ts tests/unit/scanner-embed-drain-status.test.ts tests/unit/maintain-vault.test.ts tests/integration/services/scanner-embed-drain.test.ts
```

**Final gate**
```bash
npm test -- tests/unit/write-memory.test.ts tests/unit/scanner-embed-drain-status.test.ts tests/unit/maintain-vault.test.ts
npm run test:integration -- tests/integration/mcp/tools/memory-plugin-scope.test.ts tests/integration/services/scanner-embed-drain.test.ts
npm run typecheck
npm run lint
```

## Sampling Rate

- Per task: run focused unit tests for the touched behavior.
- Per behavior boundary: run matching integration test or record `.env.test` skip.
- Per phase: run typecheck and lint.
- Directed scenario sampling: add and run D-68 only if unit plus integration tests do not prove the public MCP `write_memory` lookup-failure behavior end to end.

## Wave 0 Gaps

- [ ] Add T-U-001 through T-U-003 to `tests/unit/write-memory.test.ts`.
- [ ] Add T-U-004 to `tests/unit/scanner-embed-drain-status.test.ts`.
- [ ] Add T-U-005 to `tests/unit/maintain-vault.test.ts`.
- [ ] Add T-I-001 to `tests/integration/mcp/tools/memory-plugin-scope.test.ts`.
- [ ] Add T-I-002 to `tests/integration/services/scanner-embed-drain.test.ts`.
- [ ] Decide and document whether D-68 is needed after T-I-001 exists.

## Acceptance Criteria (Nyquist Compliance)

| Dimension | Criterion | Verified By |
|-----------|-----------|-------------|
| Requirement coverage | REQ-001 and REQ-002 each have unit and integration coverage | Test map above and final summary |
| Failure observability | No silent fallback to global and no scanner complete status on drain query failure | Focused unit/integration tests and static grep |
| Type safety | Plugin-scope lookup no longer uses `as unknown as Promise<...>` at the RPC site | Negative grep |
| Consumer handling | `src/services/maintenance.ts` handles `drain_query_failed` explicitly | Unit test T-U-005 |
| Public behavior | D-68 is added or explicitly not added with evidence from T-I-001 | `145-SUMMARY.md` |
| Final gates | Focused tests, integration tests/skips, typecheck, and lint are recorded | `145-SUMMARY.md` |

---

*Phase: 145 (silent failure quick wins)*  
*Validation strategy created: 2026-05-24*
