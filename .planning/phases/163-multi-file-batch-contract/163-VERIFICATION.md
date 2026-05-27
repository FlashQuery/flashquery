---
phase: 163-multi-file-batch-contract
verified: 2026-05-27T20:38:07Z
status: passed
score: 18/18 must-haves verified
overrides_applied: 0
---

# Phase 163: Multi-file Batch Contract Verification Report

**Phase Goal:** Users get predictable best-effort batch behavior with item-level success, conflict, or failure results in input order.
**Verified:** 2026-05-27T20:38:07Z
**Status:** passed
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Batch calls return one ordered result entry for every input item. | VERIFIED | `archive_document`, `remove_document`, `insert_doc_link`, and document `apply_tags` array paths all accumulate one result per normalized item and return `jsonToolResult(results)` for batch arrays. Integration tests assert ordered status arrays for archive/remove and compound tools. |
| 2 | Each batch item reports `succeeded`, `conflicted`, or `failed` with the appropriate token or error envelope. | VERIFIED | `batchSucceeded`, `batchConflicted`, and `batchFailed` define the three top-level item statuses in `src/mcp/utils/response-formats.ts`; handlers call them for success, version mismatch, not-found, lock-timeout, and runtime item failures. |
| 3 | Batch inputs can mix bare identifiers and `{ identifier, version_token }` objects in one call. | VERIFIED | `batchIdentifierItemSchema` is `z.union([z.string(), z.strictObject({ identifier, version_token })])`; `normalizeBatchIdentifiers` preserves `identifier`, optional `version_token`, and input `index`. Unit and integration tests cover mixed arrays. |
| 4 | Existing callers that pass strings or string arrays continue to work unchanged. | VERIFIED | Schemas still accept `z.string()` and arrays of bare strings. Single-string paths preserve legacy single-result behavior; batch bare strings remain untokened and skip item-level version checks. |
| 5 | Batch-capable schemas accept mixed arrays on all scoped surfaces. | VERIFIED | `archive_document` and `remove_document` use `batchIdentifiersSchema`; `insert_doc_link` uses `batchIdentifiersSchema`; `apply_tags.identifiers` accepts `z.array(batchIdentifierItemSchema)` and document `targets` accept optional `version_token`. |
| 6 | Unsupported positional `version_tokens` arrays and identifier-token maps are not accepted. | VERIFIED | `rg "version_tokens" src/mcp/tools src/mcp/utils` returned no matches. T-U-027 rejects top-level `version_tokens`, object entries missing required fields, and object maps. |
| 7 | Batch status wrappers do not collide with legacy payload status fields. | VERIFIED | `batchSucceeded(identifier, data)` stores legacy tool payload under `data`, leaving top-level `status: "succeeded"` reserved for REQ-018. Unit tests cover archive payload `status: "archived"` under `data.status`. |
| 8 | `archive_document` batch results are ordered and expose succeeded/conflicted/failed. | VERIFIED | `archive.ts` normalizes inputs, processes items in order, wraps success/conflict/failure entries, and returns the raw result array for batch input. T-I-035/T-I-036/T-I-037 assert `succeeded, conflicted, failed, succeeded`. |
| 9 | `remove_document` batch results are a raw ordered array with succeeded/conflicted/failed. | VERIFIED | `remove.ts` mirrors archive batch handling and returns `jsonToolResult(results)` for array input. T-I-034/T-I-036/T-I-037 assert a raw array with `succeeded, conflicted, failed`. |
| 10 | Stale tokened archive/remove items do not overwrite or remove current documents. | VERIFIED | Both destructive handlers compute `currentVersionToken` inside the document lock from freshly read bytes and push `batchConflicted` on mismatch before mutation. Integration tests assert `details.reason: version_mismatch` and surviving current content. |
| 11 | Successful archive/remove items persist when another item fails or conflicts. | VERIFIED | Handlers continue through per-item failures; integration tests and `batch_envelope_per_item.yml` assert successful items remain archived after conflict and not-found entries. |
| 12 | `insert_doc_link` source identifiers can mix bare strings and tokened objects. | VERIFIED | `compound.ts` normalizes source identifiers and uses per-item tokens in the locked write path. T-I-038 asserts bare/current/stale source identifiers produce `succeeded, succeeded, conflicted`. |
| 13 | `apply_tags` document targets can mix bare identifiers and tokened objects while memory targets remain unchanged. | VERIFIED | `apply_tags` maps mixed `identifiers` to document targets with co-located tokens, supports explicit document target `version_token`, and leaves memory result shape unwrapped. Tests assert memory result has no top-level batch status. |
| 14 | Compound batch results expose per-item statuses in input order. | VERIFIED | `insert_doc_link` array input returns raw ordered batch entries; `apply_tags` document array paths wrap document entries with batch item status. T-I-038 covers both. |
| 15 | Tool help documents the supported mixed-array form and omits rejected/deferred forms. | VERIFIED | All four help files mention `Array<string | { identifier, version_token }>` and raw ordered batch statuses. Help grep found no `version_tokens`, identifier-token map, atomic batch, or call_macro atomic support text. |
| 16 | INT-WCO-02 proves public archive batch ordered succeeded/conflicted/failed entries. | VERIFIED | `batch_envelope_per_item.yml` coverage `[INT-WCO-02]` invokes `archive_document` with four items and asserts `[succeeded, conflicted, failed, succeeded]` plus persistence. |
| 17 | INT-WCO-03 proves public mixed bare/object inputs produce succeeded/succeeded/conflicted. | VERIFIED | `batch_mixed_input.yml` coverage `[INT-WCO-03]` invokes `archive_document` with `[bare, current-token object, stale-token object]` and asserts `[succeeded, succeeded, conflicted]`. |
| 18 | Scenario coverage records T-Y-002 and T-Y-003 against REQ-018 and REQ-019. | VERIFIED | `INTEGRATION_COVERAGE.md` has `INT-WCO-02 | T-Y-002 / REQ-018` and `INT-WCO-03 | T-Y-003 / REQ-019` rows dated 2026-05-27. |

**Score:** 18/18 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/mcp/utils/batch-input.ts` | Shared mixed identifier schemas and normalization | VERIFIED | Exists; exports strict object branch, union item schema, identifiers schema, and ordered normalization helper. |
| `src/mcp/utils/response-formats.ts` | Batch item result wrappers | VERIFIED | Exists; exports `BatchItemResult`, `batchSucceeded`, `batchConflicted`, and `batchFailed`. |
| `src/mcp/tools/documents/archive.ts` | Archive mixed item handling and per-item envelope | VERIFIED | Uses shared schema, per-item version check inside lock, and batch wrappers. |
| `src/mcp/tools/documents/remove.ts` | Remove mixed item handling and raw per-item envelope | VERIFIED | Uses shared schema, per-item version check inside lock, and batch wrappers. |
| `src/mcp/tools/compound.ts` | Compound mixed input handling and item envelopes | VERIFIED | Uses normalized source/document targets and wraps document batch entries. |
| `tests/unit/batch-input-shape.test.ts` | T-U-026/T-U-027 schema coverage | VERIFIED | Covers mixed schemas, rejected unsupported shapes, memory target preservation, and wrapper status collision. |
| `tests/integration/batch-envelope.integration.test.ts` | T-I-034 through T-I-037 coverage | VERIFIED | Covers destructive batch ordering, conflict, failure, and non-rollback persistence. |
| `tests/integration/batch-input-shape.integration.test.ts` | T-I-038 coverage | VERIFIED | Covers mixed compound inputs and the review-blocker regression for one document plus memory target. |
| `src/mcp/tool-help/archive_document.tool.md` | Public mixed input help | VERIFIED | Documents mixed identifiers and raw ordered batch result statuses. |
| `src/mcp/tool-help/remove_document.tool.md` | Public mixed input help | VERIFIED | Documents mixed identifiers and raw ordered batch result statuses. |
| `src/mcp/tool-help/insert_doc_link.tool.md` | Public mixed input help | VERIFIED | Documents mixed source identifiers and raw ordered batch results for array input. |
| `src/mcp/tool-help/apply_tags.tool.md` | Public mixed input help | VERIFIED | Documents document mixed targets and preserved memory response semantics. |
| `tests/scenarios/integration/tests/batch_envelope_per_item.yml` | T-Y-002 / INT-WCO-02 scenario | VERIFIED | Exists and asserts ordered archive batch statuses, conflict details, not-found failure, and persisted successes. |
| `tests/scenarios/integration/tests/batch_mixed_input.yml` | T-Y-003 / INT-WCO-03 scenario | VERIFIED | Exists and asserts mixed bare/current/stale input statuses plus persistence/current-body checks. |
| `tests/scenarios/integration/INTEGRATION_COVERAGE.md` | Scenario coverage registration | VERIFIED | Contains INT-WCO-02 and INT-WCO-03 rows mapped to REQ-018/REQ-019. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `archive.ts` | `batch-input.ts` | `archive_document` identifiers schema | WIRED | `batchIdentifiersSchema` and `normalizeBatchIdentifiers` imported and used. |
| `remove.ts` | `batch-input.ts` | `remove_document` identifiers schema | WIRED | `batchIdentifiersSchema` and `normalizeBatchIdentifiers` imported and used. |
| `compound.ts` | `batch-input.ts` | `insert_doc_link` and `apply_tags` schemas/normalization | WIRED | `batchIdentifierItemSchema`, `batchIdentifiersSchema`, and `normalizeBatchIdentifiers` imported and used. |
| `archive.ts` | `document-version.ts` | Per-item token comparison after lock acquisition | WIRED | Fresh bytes are read under the document lock, token compared, and conflict envelope built before mutation. |
| `remove.ts` | `response-formats.ts` | Batch wrappers | WIRED | Success, conflict, and failure paths call `batchSucceeded`, `batchConflicted`, and `batchFailed`. |
| `compound.ts` | `document-version.ts` | Per-item conflict envelope | WIRED | `versionMismatchPayload` builds Phase 162 conflict envelopes from locked fresh bytes. |
| `batch_envelope_per_item.yml` | `archive_document` | Managed integration scenario op | WIRED | Scenario invokes `fq.archive_document` through `call_macro` and asserts compact status evidence. |
| `batch_mixed_input.yml` | `archive_document` mixed input | Managed integration scenario op | WIRED | Scenario passes bare and object-form identifiers with `version_token`. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `archive.ts` | `results` | Per-item loop over `normalizeBatchIdentifiers(identifiers)` and real document resolution/read/write paths | Yes | FLOWING |
| `remove.ts` | `results` | Per-item loop over `normalizeBatchIdentifiers(identifiers)` and real document resolution/read/remove paths | Yes | FLOWING |
| `compound.ts` `insert_doc_link` | `results` | Per-source loop over normalized identifiers, real target/source resolution, locked file read/write | Yes | FLOWING |
| `compound.ts` `apply_tags` | `results` | Normalized document/memory targets, real document file updates and memory DB updates | Yes | FLOWING |
| YAML scenarios | `statuses` / conflict detail variables | Real `fq.archive_document` call in managed scenario runner via `call_macro` | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full unit suite remains green | `npm test` | Passed: 175 files, 2135 tests | PASS |
| TypeScript remains valid | `npm run typecheck` | Passed | PASS |
| Focused Phase 163 Vitest integration gates | `npm run test:integration -- tests/integration/batch-envelope.integration.test.ts tests/integration/batch-input-shape.integration.test.ts` | Passed: 2 files, 6 tests | PASS |
| INT-WCO-02 public scenario | `TMPDIR="$PWD/.tmp/scenario-vaults" python3 tests/scenarios/integration/run_integration.py --managed batch_envelope_per_item` | Passed: 9/9 steps | PASS |
| INT-WCO-03 public scenario | `TMPDIR="$PWD/.tmp/scenario-vaults" python3 tests/scenarios/integration/run_integration.py --managed batch_mixed_input` | Passed: 10/10 steps | PASS |
| Schema drift gate | Project schema drift gate | `drift_detected=false` | PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| Conventional phase probes | `find scripts -path '*/tests/probe-*.sh' -type f` plus phase plan/summary probe grep | No phase-declared or conventional probes found for Phase 163 | SKIPPED |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| REQ-018 | 163-01, 163-02, 163-03, 163-04 | Best-effort multi-file batch with ordered per-item `succeeded` / `conflicted` / `failed` result envelope | SATISFIED | Shared wrapper helpers, destructive and compound handler wiring, integration tests T-I-034 through T-I-038, and scenario INT-WCO-02 all verify ordered per-item outcomes and non-atomic persistence. |
| REQ-019 | 163-01, 163-02, 163-03, 163-04 | Batch input shape accepts mixed `Array<string | { identifier, version_token }>` while preserving bare string behavior | SATISFIED | Shared strict schema and normalization helper, widened tool schemas for archive/remove/insert_doc_link/apply_tags document targets, T-U-026/T-U-027, T-I-038, and scenario INT-WCO-03. |

No orphaned Phase 163 requirement IDs were found beyond REQ-018 and REQ-019.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| Phase-owned files | Various | Optional-field checks, initialized arrays, `return null` sentinel inside lock callbacks, and historical coverage-table "placeholder" text | INFO | Reviewed as non-stub implementation details or unrelated historical matrix text; no blocker debt markers (`TBD`, `FIXME`, `XXX`) were found in phase-owned source/test/help/scenario files. |

### Human Verification Required

None.

### Review Blocker Regression

The prior review blocker remains resolved. Commit `fff469e` changed `apply_tags` wrapping from "more than one document target" to "explicit targets array containing any document target", so the one-document plus memory-target shape now returns a wrapped document batch item while preserving memory response semantics. `tests/integration/batch-input-shape.integration.test.ts` includes the exact regression. Commit `f390ded` further removed document-only `expected_version` / `if_match` fields from memory target schema branches and aligned unit guard expectations with the batch contract.

### Gaps Summary

No blocking gaps found. The phase goal is achieved in the codebase: batch-capable document tools accept mixed bare/tokened item input, process each item independently with locked per-item token checks, and return ordered item-level status results. The public scenario coverage and coverage matrix are present and aligned with REQ-018 and REQ-019.

---

_Verified: 2026-05-27T20:38:07Z_
_Verifier: the agent (gsd-verifier)_
