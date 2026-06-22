# Roadmap: FlashQuery Core

## Milestones

- [x] **v4.1 Embedding Chunks Migration** - Phases 168-169 (shipped 2026-06-15)
- [ ] **v4.2 JSON Validation** - Phase 170 (planning 2026-06-22)

## Current Milestone

**v4.2 JSON Validation**

**Goal:** Add shared LLM JSON repair and schema-validation infrastructure, then retrofit current LLM-adjacent parse sites so repairable malformed JSON is handled deterministically and irreparable structured-channel failures no longer silently succeed.

**Execution constraint:** This milestone executes as one GSD phase. Within the phase, work must proceed inline with TDD for each behavior slice: write the focused test, run it and confirm the expected RED failure, implement the minimal code, rerun the focused test for GREEN, then continue to the next behavior.

## Phases

| Phase | Name | Goal | Requirements | Success Criteria |
|-------|------|------|--------------|------------------|
| 170 | JSON Validation and Repair Infrastructure | Ship `jsonrepair`-backed parsing infrastructure plus all current parse-site retrofits and public workflow verification. | REQ-001 through REQ-011 | 8 |

## Phase Details

### Phase 170: JSON Validation and Repair Infrastructure

**Goal:** Implement the full JSON Validation milestone in one cohesive pass while preserving FlashQuery's public response envelope conventions and existing compatibility fallbacks.

**Requirements:** REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-011

**Plans:** 4 plans

Plans:
- [ ] 170-01-PLAN.md — Utility foundation: `jsonrepair`, pure parser, and parser unit coverage.
- [ ] 170-02-PLAN.md — High-priority silent-failure retrofits for macro evaluator, host templates, and macro task transitions.
- [ ] 170-03-PLAN.md — Compatibility retrofits for provider arguments, brokered coercion, and native unchanged regressions.
- [ ] 170-04-PLAN.md — Public workflow verification through integration, E2E, directed scenario, YAML scenario, and coverage matrices.

**Implementation lanes inside the single phase:**

1. Utility foundation: add `jsonrepair`, create the pure `src/llm/` parser, and cover valid, repairable, syntax-failed, schema-failed, metadata, and dependency-boundary behavior.
2. High-priority silent-failure retrofits: update macro evaluator tool-result parsing, host template payload parsing, and macro task result transitions.
3. Compatibility retrofits: update provider tool-call argument normalization and brokered tool text coercion while proving native response parsing remains unchanged.
4. Public workflow verification: add the integration/E2E/scenario coverage needed to prove repaired structured payloads and irreparable structured failures through public or near-public surfaces.

**Inline TDD cadence required for each behavior slice:**

1. Write or extend the focused test for exactly one behavior from the test plan.
2. Run the focused command and record/observe the expected RED failure.
3. Implement the smallest production change needed for that behavior.
4. Rerun the focused command and confirm GREEN.
5. Only after GREEN, refactor or move to the next behavior slice.

**Success criteria:**

1. `jsonrepair` is installed as a runtime dependency and production build/typecheck accepts ESM imports.
2. `parseLlmJson<T>()` returns typed, non-throwing success/failure results with raw text, repair metadata, syntax/schema discriminator, Zod issues, and concise summaries.
3. Macro evaluator tool-result parsing repairs JSON before fallback and preserves token, warning, trace, and budget behavior.
4. Host template tool parsing repairs structured payloads, populates `structuredContent`, sets `isError` for `{ ok: false }` or irreparable JSON-like payloads, and keeps ordinary prose text-only.
5. Macro task result parsing fails unreadable envelopes instead of marking tasks complete, while valid/repairable success, cancellation, and expected-failure envelopes keep current transitions.
6. Provider tool-call argument normalization repairs before parsing but still rejects irreparable strings and non-object values through the existing invalid-argument path.
7. Brokered tool text coercion keeps `structuredContent` precedence, preserves plain prose fallback without warning, repairs JSON-like text, warns once on JSON-like fallback, and keeps `isError: true` fail-fast behavior.
8. Public or near-public tests prove at least one repaired macro/host-template flow and one irreparable structured-channel failure, and all 11 requirements map to green automated evidence.

**Required verification commands:**

- `npm run test:unit -- tests/unit/llm-json-repair.test.ts`
- `npm run test:unit -- tests/unit/macro-evaluator.test.ts tests/unit/host-template-tools.test.ts tests/unit/macro-task-result.test.ts`
- `npm run test:unit -- tests/unit/llm-client.test.ts tests/unit/macro-coerce.test.ts tests/unit/macro-registry.test.ts`
- `npm run test:integration -- tests/integration/macro-json-repair.test.ts`
- `npm run test:integration -- tests/integration/host-template-json-repair.test.ts`
- `npm run test:e2e -- tests/e2e/call-model-template-tools.e2e.test.ts`
- Scenario commands for any directed or YAML scenario tests added from the source test plan.
- `npm run typecheck`
- `npm run build`

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 170. JSON Validation and Repair Infrastructure | v4.2 | 0/4 | Planning | - |
| 169. Lifecycle, Search, and Deployment Verification | v4.1 | 3/3 | Complete | 2026-06-15 |
| 168. Chunking Foundation and Write Pipeline | v4.1 | 4/4 | Complete | 2026-06-14 |

## Carried Tech Debt

- v4.0 accepted tech debt remains tracked: lifecycle abort marks a job aborted immediately and releases the status-based running lock before worker checkpoint return is externally proven.
- v4.1 documented v1 deferrals: `matched_chunks[].span_start`/`span_end` ship as always-null placeholders; operator-configurable `max_heading_level` deferred.

## Archived Milestone Details

- [v4.1 ROADMAP archive](milestones/v4.1-ROADMAP.md)
- [v4.1 REQUIREMENTS archive](milestones/v4.1-REQUIREMENTS.md)
- [v4.1 milestone audit](milestones/v4.1-MILESTONE-AUDIT.md)
- [v4.0 ROADMAP archive](milestones/v4.0-ROADMAP.md)
- [v4.0 REQUIREMENTS archive](milestones/v4.0-REQUIREMENTS.md)
- [v4.0 milestone audit](milestones/v4.0-MILESTONE-AUDIT.md)

---
*Last updated: 2026-06-22 after starting v4.2 JSON Validation*
