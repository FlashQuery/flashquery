---
phase: 152
slug: type-safety-cleanup-pass
status: validated-with-provider-blockers
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-25
---

# Phase 152 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest unit/integration, Python directed scenarios, YAML integration scenarios |
| **Config file** | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, scenario runner configs |
| **Quick run command** | `npm test -- --bail=1` |
| **Full suite command** | `npm test -- --bail=1 && npm run test:integration && python3 tests/scenarios/directed/run_suite.py --managed && python3 tests/scenarios/integration/run_integration.py --managed` |
| **Estimated runtime** | Environment-dependent; integration/scenario suites may skip through existing gates |

---

## Sampling Rate

- **After every task commit:** Run the smallest targeted unit/static command listed for that task.
- **After every plan wave:** Run the targeted unit and integration checks for all requirements touched in that wave.
- **Before `$gsd-verify-work`:** Run the full validation set listed in the Phase 152 roadmap entry, allowing only existing environment-gated skips.
- **Max feedback latency:** one targeted test command per implementation task.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 152-01-01 | 01 | 1 | REQ-006 | - | Response shapes preserve selected document/scanner fields | unit/static | `npm test -- tests/unit/codebase-audit-remaining-remediation.test.ts tests/unit/scanner.test.ts --bail=1` | yes | green |
| 152-01-02 | 01 | 1 | REQ-007 | - | LLM usage grouping avoids unsafe assertions without changing response contents | unit/static | `npm test -- tests/unit/codebase-audit-remaining-remediation.test.ts tests/unit/llm-usage-tool.test.ts --bail=1` | yes | green |
| 152-02-01 | 02 | 2 | REQ-008 | - | Records timing logs expose only safe metadata | unit/static | `npm test -- tests/unit/codebase-audit-remaining-remediation.test.ts tests/unit/record-tools.test.ts --bail=1` | yes | green |
| 152-02-02 | 02 | 2 | REQ-006, REQ-007, REQ-008 | - | Public flows remain stable or skip only through existing environment gates | integration/scenario | `npm run test:integration && python3 tests/scenarios/directed/run_suite.py --managed && python3 tests/scenarios/integration/run_integration.py --managed` | yes | provider-blocked |

*Status: pending, green, red, flaky*

Status note: `provider-blocked` means local deterministic validation passed, but OpenAI-backed scenario reruns could not be completed because the configured provider returned rate-limit errors.

---

## Command Evidence

| Scope | Command | Result | Notes |
|-------|---------|--------|-------|
| Wave 1 focused | `npm test -- tests/unit/codebase-audit-remaining-remediation.test.ts tests/unit/scanner.test.ts tests/unit/document-output.test.ts tests/unit/llm-usage-tool.test.ts --bail=1` | pass | 4 files, 131 tests passed. |
| Wave 1 static | `npm run typecheck` | pass | TypeScript strict-mode check passed. |
| Wave 2 focused | `npm test -- tests/unit/codebase-audit-remaining-remediation.test.ts tests/unit/record-tools.test.ts --bail=1` | pass | 2 files, 19 tests passed. |
| Phase focused | `npm test -- tests/unit/codebase-audit-remaining-remediation.test.ts tests/unit/scanner.test.ts tests/unit/document-output.test.ts tests/unit/llm-usage-tool.test.ts tests/unit/record-tools.test.ts --bail=1` | pass | 5 files, 137 tests passed. |
| Static guard | `! rg -n "TODO LOG-01" src/mcp/tools/records.ts` | pass | No matches. |
| Full unit | `npm test` | pass | 147 files, 2021 tests passed. |
| Full integration | `npm run test:integration` | pass | 29 files passed; 153 tests passed, 1 skipped. |
| Typecheck | `npm run typecheck` | pass | Passed after lint-followup cleanup. |
| Lint | `npm run lint` | pass | Passed after removing unnecessary casts and unused helper fallout. |
| Directed scenarios | `python3 tests/scenarios/directed/run_suite.py --managed` | provider-blocked | Interrupted after multiple `call_model` failures; targeted `test_call_model_by_model.py --managed` reproduced `openai rate limit exceeded`. |
| YAML integration full | `python3 tests/scenarios/integration/run_integration.py --managed` | pre-existing/provider-sensitive failure | Interrupted after `archive_doc_memory_in_searchall` failed because memory semantic search returned no results; outside Phase 152 scope. |
| YAML integration Phase 152 subset | `python3 tests/scenarios/integration/run_integration.py --managed tests/scenarios/integration/tests/llm_by_purpose_mode.yml tests/scenarios/integration/tests/llm_by_model_mode.yml tests/scenarios/integration/tests/plugin_record_consolidation.yml` | partial | `plugin_record_consolidation` passed 9/9; `llm_by_purpose_mode` and `llm_by_model_mode` failed at seed `call_model` with OpenAI rate limit. Report: `tests/scenarios/integration/reports/integration-report-2026-05-25-153509.md`. |

---

## Wave 0 Requirements

Existing infrastructure covers all Phase 152 requirements.

---

## Manual-Only Verifications

All phase behaviors have automated verification. Human review should inspect logs only to confirm they contain path/table/row-count/elapsed metadata and no raw payloads, vectors, or caller query text if logger capture cannot be asserted in unit tests.

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or existing environment-gated runners.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency bounded by targeted test commands.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved 2026-05-25
