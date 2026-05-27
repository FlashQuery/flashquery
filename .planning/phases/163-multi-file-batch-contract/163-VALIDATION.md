---
phase: 163
slug: multi-file-batch-contract
status: completed
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-27
validated: 2026-05-27
---

# Phase 163 — Validation Strategy and Audit

> Per-phase validation contract and completed Nyquist audit for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x for unit/integration; Python YAML integration scenario runner for `INT-WCO-*` |
| **Config file** | `tests/config/vitest.unit.config.ts`; `tests/config/vitest.integration.config.ts`; `tests/scenarios/integration/README.md` |
| **Quick run command** | `npm test -- tests/unit/batch-input-shape.test.ts` |
| **Full suite command** | `npm test`; `npm run typecheck`; `npm run test:integration -- tests/integration/batch-envelope.integration.test.ts tests/integration/batch-input-shape.integration.test.ts`; managed YAML scenarios with repo-local `TMPDIR` |
| **Estimated runtime** | Unit: under 30 seconds; focused integration/scenario runs depend on `.env.test` and Supabase availability |

---

## Sampling Rate

- **After every task commit:** Run the task-specific focused test command, with `npm test -- tests/unit/batch-input-shape.test.ts` required after schema/helper changes.
- **After every plan wave:** Run `npm run test:integration -- tests/integration/batch-envelope.integration.test.ts tests/integration/batch-input-shape.integration.test.ts`.
- **Before `$gsd-verify-work`:** Run unit, integration, and scenario evidence for `INT-WCO-02` and `INT-WCO-03` when those scenario files land.
- **Max feedback latency:** One focused automated command per task; no three consecutive implementation tasks may proceed without an automated verification command.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 163-01-01 | 01 | 0 | REQ-019 | T-163-01 | Malformed batch object and unsupported positional token arrays are rejected by Zod. | unit | `npm test -- tests/unit/batch-input-shape.test.ts` | ✅ yes | ✅ green |
| 163-01-02 | 01 | 1 | REQ-019 | T-163-02 | Token remains co-located with its identifier; repeated identifiers do not depend on maps or parallel arrays. | unit/integration | `npm test -- tests/unit/batch-input-shape.test.ts` | ✅ yes | ✅ green |
| 163-02-01 | 02 | 1 | REQ-018 | T-163-03 | Archive/remove batches report ordered per-item `succeeded`, `conflicted`, and `failed` results. | integration | `npm run test:integration -- tests/integration/batch-envelope.integration.test.ts` | ✅ yes | ✅ green |
| 163-02-02 | 02 | 1 | REQ-018 | T-163-04 | Failed or conflicted batch items do not roll back successful item writes. | integration | `npm run test:integration -- tests/integration/batch-envelope.integration.test.ts` | ✅ yes | ✅ green |
| 163-03-01 | 03 | 2 | REQ-018, REQ-019 | T-163-05 | Compound batch tools preserve per-item version checks for document targets and do not change memory-target semantics. | integration | `npm run test:integration -- tests/integration/batch-input-shape.integration.test.ts` | ✅ yes | ✅ green |
| 163-04-01 | 04 | 3 | REQ-018 | T-163-06 | Public scenario `INT-WCO-02` proves archive batch conflict/success/failure shape through the managed runner. | scenario | `TMPDIR="$PWD/.tmp/scenario-vaults" python3 tests/scenarios/integration/run_integration.py --managed batch_envelope_per_item` | ✅ yes | ✅ green |
| 163-04-02 | 04 | 3 | REQ-019 | T-163-07 | Public scenario `INT-WCO-03` proves mixed bare/object input shape through the managed runner. | scenario | `TMPDIR="$PWD/.tmp/scenario-vaults" python3 tests/scenarios/integration/run_integration.py --managed batch_mixed_input` | ✅ yes | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `tests/unit/batch-input-shape.test.ts` — covers `T-U-026` and `T-U-027`.
- [x] `tests/integration/batch-envelope.integration.test.ts` — covers `T-I-034` through `T-I-037`.
- [x] `tests/integration/batch-input-shape.integration.test.ts` — covers `T-I-038`.
- [x] `tests/scenarios/integration/tests/batch_envelope_per_item.yml` — covers `T-Y-002` / `INT-WCO-02`.
- [x] `tests/scenarios/integration/tests/batch_mixed_input.yml` — covers `T-Y-003` / `INT-WCO-03`.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None | REQ-018, REQ-019 | All phase behaviors have automated verification in the unit, integration, or integration-scenario layers. | N/A |

---

## Threat Model

| Threat Ref | Threat | Severity | Mitigation | Verification |
|------------|--------|----------|------------|--------------|
| T-163-01 | Caller sends malformed mixed batch object or unsupported `version_tokens` positional array. | medium | Use Zod unions with strict object parsing for `{ identifier, version_token }`; do not add positional token arrays. | `T-U-026`, `T-U-027` |
| T-163-02 | Token is associated with the wrong repeated/path-like identifier. | high | Co-locate the token with each identifier object; reject identifier-to-token maps and parallel arrays. | `T-U-026`, `T-I-038`, `T-Y-003` |
| T-163-03 | Stale batch item overwrites a newer document. | high | Thread per-item `version_token` into the existing Phase 162 in-lock version check and return `conflicted`. | `T-I-035`, `T-I-038`, `T-Y-002`, `T-Y-003` |
| T-163-04 | Partial failure is hidden from the caller. | medium | Return ordered per-item `succeeded`, `conflicted`, or `failed` statuses. | `T-I-034`, `T-I-036`, `T-Y-002` |
| T-163-05 | A batch failure incorrectly rolls back successful writes or implies atomicity. | medium | Keep best-effort processing and assert surviving writes persist. | `T-I-037` |

---

## Validation Audit

**Audited:** 2026-05-27
**Result:** compliant; no Nyquist gaps found.

### Fresh Evidence

| Command | Result |
|---------|--------|
| `npm test` | Passed: 175 files, 2135 tests |
| `npm run typecheck` | Passed |
| `npm run test:integration -- tests/integration/batch-envelope.integration.test.ts tests/integration/batch-input-shape.integration.test.ts` | Passed: 2 files, 6 tests |
| `TMPDIR="$PWD/.tmp/scenario-vaults" python3 tests/scenarios/integration/run_integration.py --managed batch_envelope_per_item` | Passed: 9/9 steps |
| `TMPDIR="$PWD/.tmp/scenario-vaults" python3 tests/scenarios/integration/run_integration.py --managed batch_mixed_input` | Passed: 10/10 steps |
| GSD verifier | Passed: 18/18 must-haves; no human verification items |

### Coverage Findings

| Requirement | Evidence | Status |
|-------------|----------|--------|
| REQ-018 ordered best-effort batch envelopes | `tests/integration/batch-envelope.integration.test.ts` asserts ordered archive/remove `succeeded`, `conflicted`, and `failed` entries; `tests/scenarios/integration/tests/batch_envelope_per_item.yml` proves the public archive scenario and persistence after partial failure. | FILLED |
| REQ-018 non-colliding item status wrapper | `tests/unit/batch-input-shape.test.ts` asserts legacy payload `status` remains under `data.status` while top-level item status remains `succeeded`. | FILLED |
| REQ-019 mixed bare/object input shape | `tests/unit/batch-input-shape.test.ts` accepts string, string array, and mixed `{ identifier, version_token }` arrays while rejecting `version_tokens` and maps. | FILLED |
| REQ-019 per-item token association and conflict behavior | `tests/integration/batch-input-shape.integration.test.ts` asserts mixed bare/current/stale compound inputs produce ordered `succeeded`, `succeeded`, `conflicted`; `tests/scenarios/integration/tests/batch_mixed_input.yml` proves the public mixed input scenario. | FILLED |
| Memory target compatibility | `tests/integration/batch-input-shape.integration.test.ts` asserts `apply_tags` memory target responses remain unwrapped and a document+memory target array wraps only the document result. | FILLED |

### Audit Notes

- No new tests were added because every Phase 163 validation gap has existing automated behavioral coverage.
- Scenario commands use a repo-local `TMPDIR` to avoid the known macOS `/var` vs `/private/var` path-containment issue documented in `163-04-SUMMARY.md`; this is an environment workaround, not a Phase 163 coverage gap.
- No manual-only verifications remain.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency target documented
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** completed
