---
phase: 126
slug: plugin-record-consolidation
status: draft
nyquist_compliant: true
pre_task_requirements_complete: false
created: 2026-05-12
---

# Phase 126 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `vitest.config.ts`, `tests/config/*` |
| **Quick run command** | `npm test -- tests/unit/plugin-tools.test.ts tests/unit/write-record.test.ts tests/unit/record-tools.test.ts tests/unit/pending-plugin-review.test.ts` |
| **Full suite command** | `npm test && npm run build` plus focused integration/E2E/scenario commands listed below |
| **Estimated runtime** | unit quick loop ~60-120 seconds; full targeted suite depends on `.env.test` |

---

## Sampling Rate

- **After every task commit:** Run the task's focused unit command or the quick run command above.
- **After every plan wave:** Run all focused unit tests touched by the wave plus any available integration test for that wave.
- **Before `$gsd-verify-work`:** `npm run build`, relevant unit tests, integration tests, E2E protocol tests, directed scenario checks, and integration scenario checks must be green or documented as skipped by missing `.env.test`.
- **Max feedback latency:** 180 seconds for unit feedback; integration/E2E may exceed this only when `.env.test` starts external Supabase-backed tests.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 126-01-01 | 01 | 1 | REC-01..REC-07 | T-126-05 | Traceability covers every requirement and test layer before implementation. | docs/check | `test -f .planning/phases/126-plugin-record-consolidation/TRACEABILITY.md` | pre-task for 126-01 | pending |
| 126-01-02 | 01 | 1 | REC-04 | T-126-01..T-126-03 | Record create/update validation rejects generated/unknown fields and never mutates before validation. | unit | `npm test -- tests/unit/write-record.test.ts` | yes | pending |
| 126-01-03 | 01 | 1 | REC-04, REC-05 | T-126-04 | Record output helpers include identification by default and gate data/schema metadata. | unit | `npm test -- tests/unit/write-record.test.ts tests/unit/response-formats.test.ts` | yes | pending |
| 126-02-01 | 02 | 2 | REC-01, REC-02 | T-126-06..T-126-10 | Plugin registration/unregistration returns structured metadata and protects destructive cleanup with explicit force. | unit/integration | `npm test -- tests/unit/plugin-tools.test.ts && npm run test:integration -- tests/integration/plugin-records.integration.test.ts` | yes | pending |
| 126-02-02 | 02 | 2 | REC-03 | T-126-11..T-126-14 | Plugin info include gates prevent unrequested schema/status payload disclosure. | unit/integration | `npm test -- tests/unit/plugin-tools.test.ts && npm run test:integration -- tests/integration/plugin-records.integration.test.ts` | yes | pending |
| 126-03-01 | 03 | 3 | REC-04, REC-05 | T-126-11..T-126-14 | `write_record` create/update validates schema before mutation and returns final envelopes. | unit/integration/E2E | `npm test -- tests/unit/write-record.test.ts tests/unit/record-tools.test.ts && npm run test:integration -- tests/integration/write-record.integration.test.ts && npm run test:e2e -- tests/e2e/protocol.test.ts` | yes | pending |
| 126-03-02 | 03 | 3 | REC-04, REC-05 | T-126-11..T-126-14 | `write_record` metadata and legacy coverage porting are complete. | unit/integration | `npm test -- tests/unit/write-record.test.ts && npm run test:integration -- tests/integration/write-record.integration.test.ts` | yes | pending |
| 126-04-01 | 04 | 4 | REC-06 | T-126-15..T-126-19 | Record read/archive payloads are include-gated, array-targeted, ordered, and warning-aware. | unit/integration | `npm test -- tests/unit/record-tools.test.ts && npm run test:integration -- tests/integration/plugin-records.integration.test.ts` | yes | pending |
| 126-04-02 | 04 | 4 | REC-06 | T-126-15..T-126-19 | Record search returns final JSON envelopes with taggable-table support and archived visibility rules. | unit/integration/E2E | `npm test -- tests/unit/record-tools.test.ts && npm run test:integration -- tests/integration/plugin-records.integration.test.ts && npm run test:e2e -- tests/e2e/protocol.test.ts` | yes | pending |
| 126-05-01 | 05 | 5 | REC-07 | T-126-20..T-126-23 | Pending reviews clear by pending-review row ID, not document `fq_id`. | unit/integration/E2E | `npm test -- tests/unit/pending-plugin-review.test.ts && npm run test:integration -- tests/integration/plugin-reconciliation.integration.test.ts && npm run test:e2e -- tests/e2e/protocol.test.ts` | yes | pending |
| 126-05-02 | 05 | 5 | REC-01..REC-07 | T-126-24 | Public directed and integration scenario surfaces use final tool contracts. | scenario | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup plugin_record_consolidation && python3 tests/scenarios/integration/run_integration.py --managed plugin_record_consolidation` | yes | pending |
| 126-05-03 | 05 | 5 | REC-01..REC-07 | T-126-24 | Final validation records unit, integration, E2E, scenario, and build evidence. | build/full gate | `npm run build` plus targeted commands listed in 126-05 Task 3 | yes | pending |

*Status: pending · green · red · flaky*

---

## Pre-Task Requirements

- [ ] `126-01` Task 1 creates `.planning/phases/126-plugin-record-consolidation/TRACEABILITY.md`, mapping `REC-01` through `REC-07` to unit, integration, E2E, directed scenario, and integration scenario evidence before production edits.
- [ ] `126-01` Tasks 2 and 3 create `tests/unit/write-record.test.ts` coverage for high-risk `write_record` validation, include, generated-field, unknown-field, and create/update mode behavior.
- [ ] `126-03` creates `tests/integration/write-record.integration.test.ts` for real plugin schema create/update, include handling, and expected validation errors where `.env.test` is available.
- [ ] `126-05` Task 2 updates directed and integration scenario coverage ledger rows for final plugin/record contracts before scenario files change.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Hosted Supabase integration skip handling | REC-04..REC-07 | Integration tests may skip when `.env.test` is absent or incomplete. | Confirm skipped tests print the standard `.env.test` skip reason and unit/E2E mocks still cover contract shape. |

---

## Validation Sign-Off

- [ ] All tasks have automated verify commands or explicit pre-task dependencies attached to concrete plan tasks.
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify.
- [ ] Pre-task requirements are attached to concrete `126-01` through `126-05` plan tasks.
- [ ] No watch-mode flags.
- [ ] Feedback latency under 180 seconds for focused unit loops.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending
