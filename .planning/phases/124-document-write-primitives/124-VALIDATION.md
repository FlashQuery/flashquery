---
phase: 124
slug: document-write-primitives
status: complete
nyquist_compliant: true
wave_0_complete: complete
created: 2026-05-12
---

# Phase 124 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest `^4.1.1` plus Python directed/YAML scenario runners |
| **Config file** | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts` |
| **Quick run command** | `npm test -- tests/unit/write-document.test.ts tests/unit/insert-in-doc.test.ts tests/unit/replace-doc-section.test.ts tests/unit/apply-tags.test.ts tests/unit/tool-metadata.test.ts` |
| **Full suite command** | `npm run build && npm test && npm run test:integration && npm run test:e2e` plus focused directed/YAML scenario commands |
| **Estimated runtime** | ~300 seconds for full suite, focused commands vary by Supabase/scenario availability |

---

## Sampling Rate

- **After every task commit:** Run the focused unit file for the primitive being changed plus `tests/unit/tool-metadata.test.ts` when metadata changes.
- **After every plan wave:** Run focused unit + integration + E2E command for touched tools.
- **Before `$gsd-verify-work`:** Full suite must be green, or skips must be explicitly dependency-gated.
- **Max feedback latency:** 300 seconds for full suite; focused unit feedback should stay under 60 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 124-00-01 | 00 | 0 | DOC-03/DOC-04/DOC-06/DOC-07/DOC-08 | — | Traceability exists before implementation and maps every requirement to five-layer evidence. | docs | `test -f .planning/phases/124-document-write-primitives/TRACEABILITY.md` | ✅ | ✅ green |
| 124-01-01 | 01 | 1 | DOC-03/DOC-04 | T-124-01/T-124-02/T-124-03 | `write_document` rejects invalid mode/path/frontmatter combinations and returns expected errors with `isError:false`. | unit | `npm test -- tests/unit/write-document.test.ts tests/unit/tool-metadata.test.ts` | ✅ | ✅ green |
| 124-01-02 | 01 | 1 | DOC-03/DOC-04 | T-124-01/T-124-02/T-124-03 | Create/update persistence preserves omitted fields and emits document identification JSON. | integration/e2e | `npm run test:integration -- tests/integration/documents.integration.test.ts && npm run test:e2e -- tests/e2e/protocol.test.ts` | ✅ | ✅ green |
| 124-02-01 | 02 | 2 | DOC-06 | T-124-03 | `insert_in_doc` validates heading arguments, honors `include_nested`, and returns `inserted_at`. | unit/integration | `npm test -- tests/unit/insert-in-doc.test.ts && npm run test:integration -- tests/integration/documents.integration.test.ts` | ✅ | ✅ green |
| 124-03-01 | 03 | 2 | DOC-07 | T-124-03 | `replace_doc_section` honors nested boundaries, deletes heading on `content:""`, and omits old content/hash output. | unit/integration | `npm test -- tests/unit/replace-doc-section.test.ts && npm run test:integration -- tests/integration/documents.integration.test.ts` | ✅ | ✅ green |
| 124-04-01 | 04 | 3 | DOC-08 | T-124-04/T-124-05 | `apply_tags` preserves ordered target results and does not leak disabled memory targets. | unit/integration/e2e | `npm test -- tests/unit/apply-tags.test.ts && npm run test:integration -- tests/integration/apply-tags.test.ts && npm run test:e2e -- tests/e2e/protocol.test.ts` | ✅ | ✅ green |
| 124-05-01 | 05 | 5 | DOC-03/DOC-04/DOC-06/DOC-07/DOC-08 | — | Directed and integration scenario ledgers are updated before Python/YAML scenario files. | scenario-ledger | `grep -n "write_document(mode" tests/scenarios/directed/DIRECTED_COVERAGE.md && grep -n "write_document" tests/scenarios/integration/INTEGRATION_COVERAGE.md` | ✅ | ✅ green |
| 124-06-01 | 06 | 6 | DOC-03/DOC-04/DOC-06/DOC-07 | — | Directed Python scenarios use final Phase 124 primitives and JSON envelope assertions. | directed-scenario | `python3 tests/scenarios/directed/run_suite.py --managed content_append_and_insert content_replace_section content_frontmatter_ops frontmatter_preservation` | ✅ | ✅ green |
| 124-07-01 | 07 | 7 | DOC-03/DOC-04/DOC-06/DOC-07/DOC-08 | — | YAML integration scenarios use final Phase 124 primitives and final validation records every focused phase gate. | integration-scenario/build | `npm test -- tests/unit/write-document.test.ts tests/unit/insert-in-doc.test.ts tests/unit/replace-doc-section.test.ts tests/unit/apply-tags.test.ts tests/unit/tool-metadata.test.ts && npm run test:integration -- tests/integration/documents.integration.test.ts tests/integration/apply-tags.test.ts && npm run test:e2e -- tests/e2e/protocol.test.ts && python3 tests/scenarios/directed/run_suite.py --managed content_append_and_insert content_replace_section content_frontmatter_ops frontmatter_preservation && python3 tests/scenarios/integration/run_integration.py --managed append_then_search append_and_search update_document_then_search replace_section llm_ref_reflects_current_write_state llm_ref_section_after_replace pointer_mutation_propagates llm_template_reference_freshness llm_template_document_param_freshness llm_template_metadata_freshness && npm run build` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `.planning/phases/124-document-write-primitives/TRACEABILITY.md` — maps DOC-03/DOC-04/DOC-06/DOC-07/DOC-08 to unit, integration, E2E, directed scenario, and integration scenario evidence.
- [x] `tests/unit/write-document.test.ts` — final create/update validation and JSON output.
- [x] `tests/unit/insert-in-doc.test.ts` — final insertion validation/output contract.
- [x] `tests/unit/replace-doc-section.test.ts` — final replacement/deletion validation/output contract.
- [x] `tests/unit/apply-tags.test.ts` — final target schema/order/disabled-domain behavior.
- [x] Scenario coverage ledger updates in `tests/scenarios/directed/DIRECTED_COVERAGE.md` and `tests/scenarios/integration/INTEGRATION_COVERAGE.md` before scenario file edits.
- [x] Directed Python scenario ports in Plan 124-06 after ledger updates.
- [x] YAML integration scenario ports and final validation evidence in Plan 124-07 after directed scenario ports.

---

## Manual-Only Verifications

All phase behaviors have automated verification. Integration, E2E, and scenario commands may skip gracefully when external Supabase or embedding dependencies are unavailable; any skip must be recorded in the plan summary with the exact missing dependency.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 300s
- [x] `nyquist_compliant: true` set in frontmatter

**Execution evidence (2026-05-12):** Focused unit (5 files, 27 tests), integration (2 files, 18 tests), E2E protocol (1 file, 18 tests), directed scenarios (4/4), YAML integration scenarios (10/10), and `npm run build` all passed using `.env.test` where external credentials were required.
