---
phase: 153
slug: 153-documents-tool-decomposition
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-26
reconstructed_from: State B - PLAN/SUMMARY/VERIFICATION artifacts
requirements:
  - REQ-009
---

# Phase 153 - Validation Strategy

> Retroactive Nyquist validation contract for Phase 153 Documents Tool Decomposition.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x for unit/integration/E2E; Python scenario runners for directed and YAML integration scenarios |
| **Config file** | `tests/config/vitest.unit.config.ts`; `tests/config/vitest.integration.config.ts`; `tests/config/vitest.e2e.config.ts` |
| **Quick run command** | `npm test -- tests/unit/codebase-audit-remaining-remediation.test.ts --bail=1` |
| **Full suite command** | `npm test && npm run test:integration && npm run test:e2e && python3 tests/scenarios/directed/run_suite.py --managed && python3 tests/scenarios/integration/run_integration.py --managed && npm run typecheck && npm run lint && npm run knip && npm run preflight` |
| **Estimated runtime** | Targeted gates: ~2 minutes; full suite/preflight: environment-dependent |

---

## Sampling Rate

- **After every task commit:** Run the task-level targeted Vitest command from the plan.
- **After every plan wave:** Run the phase targeted unit/integration/scenario subset listed below.
- **Before `$gsd-verify-work`:** Full local gates plus document-specific scenario subsets must be green; broad provider/environment blockers must be recorded.
- **Max feedback latency:** ~2 minutes for targeted local gates.

---

## Requirement-to-Task Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure / Stable Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|--------------------------|-----------|-------------------|-------------|--------|
| 153-01-01 | 01 | 1 | REQ-009 | T-153-SC | Shared document-tool wiring compiles while preserving `registerDocumentTools(server, config)` public entrypoint. | command/static | `npm run typecheck` | yes | green |
| 153-01-02 | 01 | 1 | REQ-009 | T-153-01, T-153-03, T-153-04 | `write_document` keeps create/update behavior, write locks, frontmatter conflict checks, readonly-folder warnings, scans, and embedding scheduling. | unit/integration | `npm test -- tests/unit/advanced-document-tools.test.ts --bail=1`; `npm run test:integration -- tests/integration/write-document.integration.test.ts tests/integration/tools-response-format.test.ts --bail=1` | yes | green |
| 153-01-03 | 01 | 1 | REQ-009 | T-153-02 | `get_document` keeps single/batch identifier resolution and response formatting after extraction. | unit/integration | `npm test -- tests/unit/codebase-audit-remaining-remediation.test.ts tests/unit/advanced-document-tools.test.ts tests/unit/document-output.test.ts --bail=1`; `npm run test:integration -- tests/integration/documents.integration.test.ts tests/integration/tools-response-format.test.ts --bail=1` | yes | green |
| 153-02-01 | 02 | 2 | REQ-009 | T-153-05 | `archive_document` and `remove_document` keep lifecycle behavior, rollback, targeted scans, and error envelopes. | unit/integration | `npm test -- tests/unit/archive-document.test.ts tests/unit/remove-document.test.ts tests/unit/no-hardcoded-extensions.test.ts --bail=1`; `npm run test:integration -- tests/integration/documents.integration.test.ts tests/integration/remove-document.integration.test.ts --bail=1` | yes | green |
| 153-02-02 | 02 | 2 | REQ-009 | T-153-06, T-153-08 | `copy_document` and `move_document` keep identity, destination validation, embedding, plugin warning, history, and association behavior. | unit/integration | `npm test -- tests/unit/advanced-document-tools.test.ts tests/unit/archive-document.test.ts tests/unit/copy-document.test.ts tests/unit/move-document.test.ts tests/unit/no-hardcoded-extensions.test.ts --bail=1`; `npm run test:integration -- tests/integration/documents.integration.test.ts tests/integration/write-document.integration.test.ts --bail=1` | yes | green |
| 153-03-01 | 03 | 3 | REQ-009 | T-153-10 | T-U-026/T-U-027/T-U-028 enforce thin entrypoint, moved module size limit, and no shared document/plugin cycle-prone imports. | unit/static | `npm test -- tests/unit/codebase-audit-remaining-remediation.test.ts --bail=1` | yes | green |
| 153-03-02 | 03 | 3 | REQ-009 | T-153-11, T-153-12 | T-U-029/T-U-030, T-I-005..T-I-009, T-S-003..T-S-006, and T-Y-004..T-Y-006 prove behavior preservation across document unit, integration, directed, and YAML scenario coverage. | unit/integration/scenario | `npm test -- tests/unit/advanced-document-tools.test.ts tests/unit/archive-document.test.ts tests/unit/copy-document.test.ts tests/unit/remove-document.test.ts tests/unit/move-document.test.ts tests/unit/document-output.test.ts tests/unit/no-hardcoded-extensions.test.ts tests/unit/codebase-audit-remaining-remediation.test.ts --bail=1`; `python3 tests/scenarios/directed/run_suite.py --managed test_consolidated_get_document test_document_archive_and_search test_document_copy_and_move test_content_frontmatter_ops`; `python3 tests/scenarios/integration/run_integration.py --managed write_then_search archive_status_field document_retrieval_by_id` | yes | green |

*Status legend: pending, green, red, flaky, blocked.*

---

## Coverage Cross-Reference

| Coverage ID | Requirement | Evidence |
|-------------|-------------|----------|
| T-U-026 | REQ-009 | `tests/unit/codebase-audit-remaining-remediation.test.ts` asserts `src/mcp/tools/documents.ts` remains thin, exports `registerDocumentTools`, imports moved modules, delegates all six registrations, and no longer contains inline `server.registerTool` blocks for moved handlers. |
| T-U-027 | REQ-009 | `tests/unit/codebase-audit-remaining-remediation.test.ts` asserts every file under `src/mcp/tools/documents/` is <= 500 lines unless explicitly justified. Current line counts are below threshold. |
| T-U-028 | REQ-009 | `tests/unit/codebase-audit-remaining-remediation.test.ts` asserts shared document wiring avoids plugin-manager imports and plugin source does not import document tool modules. |
| T-U-029 / T-U-030 | REQ-009 | Document unit regression files cover advanced document tools, archive, copy, remove, move, output formatting, managed frontmatter extensions, and prior guard preservation. |
| T-I-005..T-I-009 | REQ-009 | Document integration tests cover document registration, write behavior, remove behavior, response format, and plugin-related document paths. Broad plugin reconciliation has an outside-scope environment/schema blocker noted below. |
| T-S-003..T-S-006 | REQ-009 | `tests/scenarios/directed/DIRECTED_COVERAGE.md` maps D-73..D-76 to `test_consolidated_get_document`, `test_document_archive_and_search`, `test_document_copy_and_move`, and `test_content_frontmatter_ops`. |
| T-Y-004..T-Y-006 | REQ-009 | `tests/scenarios/integration/INTEGRATION_COVERAGE.md` maps IS-19..IS-21 to `write_then_search`, `archive_status_field`, and `document_retrieval_by_id`. |

---

## Current Audit Runs

Commands executed during this reconstruction on 2026-05-26:

| Command | Result |
|---------|--------|
| `npm test -- tests/unit/codebase-audit-remaining-remediation.test.ts tests/unit/advanced-document-tools.test.ts tests/unit/archive-document.test.ts tests/unit/copy-document.test.ts tests/unit/remove-document.test.ts tests/unit/move-document.test.ts tests/unit/document-output.test.ts tests/unit/no-hardcoded-extensions.test.ts --bail=1` | green: 8 files passed, 101 tests passed |
| `npm run typecheck` | green |
| `npm run lint` | green |
| `npm run knip` | green |
| `npm run test:integration -- tests/integration/documents.integration.test.ts tests/integration/write-document.integration.test.ts tests/integration/remove-document.integration.test.ts tests/integration/tools-response-format.test.ts --bail=1` | green for the document integration slice run by Vitest under the current config |
| `python3 tests/scenarios/directed/run_suite.py --managed test_consolidated_get_document test_document_archive_and_search test_document_copy_and_move test_content_frontmatter_ops` | green: 6/6 directed tests passed |
| `python3 tests/scenarios/integration/run_integration.py --managed write_then_search archive_status_field document_retrieval_by_id` | green: 3/3 YAML integration scenarios passed |
| `npm run test:integration -- tests/integration/documents.integration.test.ts tests/integration/write-document.integration.test.ts tests/integration/remove-document.integration.test.ts tests/integration/tools-response-format.test.ts tests/integration/plugin-reconciliation.integration.test.ts --bail=1` | blocked outside REQ-009: `plugin-reconciliation.integration.test.ts` failed with `result.isError` true after `relation "fqcp_rec_int_test_default_contacts" does not exist` |

Phase 153 summary evidence from 2026-05-25 also records green `npm test`, `npm run preflight`, targeted document unit/integration gates, targeted directed scenarios, targeted YAML scenarios, `npm run typecheck`, `npm run lint`, and `npm run knip`.

---

## Wave 0 Requirements

Existing infrastructure covers all Phase 153 requirements. No Wave 0 test harness installation or stub generation is required.

---

## Manual-Only Verifications

All scoped REQ-009 behaviors have automated verification.

Outside-scope/provider/environment blockers recorded from phase verification:

| Behavior | Requirement | Why Not Blocking REQ-009 | Evidence |
|----------|-------------|--------------------------|----------|
| Full integration plugin reconciliation tenant/table setup | outside REQ-009 | Failure is in plugin reconciliation/record table setup, not the document-tool decomposition. | `153-03-SUMMARY.md`; reproduced on 2026-05-26 with `relation "fqcp_rec_int_test_default_contacts" does not exist`. |
| Full E2E call-model, memory search, and authorize-flow failures | outside REQ-009 | Failures are provider/model, memory search expectation, and server readiness issues outside document handler extraction. | `153-03-SUMMARY.md`; `153-VERIFICATION.md`. |
| Full directed provider-backed `call_model*` failures | outside REQ-009 | Provider-backed call-model scenarios block broad suite completion but targeted document directed scenarios pass. | `153-03-SUMMARY.md`; `153-VERIFICATION.md`. |
| Docker compose validation during preflight | environment | Local Docker is not installed; preflight recorded Docker compose validation as skipped. | `153-03-SUMMARY.md`. |

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or existing test infrastructure.
- [x] Sampling continuity: no three consecutive tasks lack automated verification.
- [x] Wave 0 not required; existing Vitest and scenario infrastructure covers REQ-009.
- [x] No watch-mode commands are used.
- [x] Targeted feedback latency is under 2 minutes for local gates.
- [x] `nyquist_compliant: true` set in frontmatter.
- [x] `wave_0_complete: true` set in frontmatter.

**Approval:** approved 2026-05-26. Scoped REQ-009 is Nyquist-compliant; outside-scope provider/environment blockers are documented and do not block the document-tool decomposition requirement.
