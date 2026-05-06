---
phase: 114
slug: template-parameterization
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-05
---

# Phase 114 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest `^4.1.1` plus Python directed scenario runner |
| **Config file** | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts` |
| **Quick run command** | `npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool.test.ts` |
| **Full suite command** | `npm run build && npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool.test.ts && npm run test:integration -- tests/integration/reference-resolver.integration.test.ts && python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_call_model_template_parameterization` |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool.test.ts`
- **After every plan wave:** Run the focused integration or directed scenario command for the surface changed in that wave
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds for focused feedback; full suite before final verification

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 114-01-01 | 01 | 1 | TMPL-01 | T-114-01 | Plain documents ignore `template_params`; templates require declared params | unit | `npm test -- tests/unit/reference-resolver.test.ts` | yes | passed |
| 114-01-02 | 01 | 1 | TMPL-03 | T-114-02 | Required/default/type validation returns stable typed failures | unit | `npm test -- tests/unit/reference-resolver.test.ts` | yes | passed |
| 114-01-03 | 01 | 1 | TMPL-04 | T-114-03 | Substituted content is not recursively re-scanned | unit | `npm test -- tests/unit/reference-resolver.test.ts` | yes | passed |
| 114-02-01 | 02 | 2 | TMPL-02 | T-114-02 | Alias params do not resolve `@alias` through vault identifiers | unit | `npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool.test.ts` | yes | passed |
| 114-02-02 | 02 | 2 | TMPL-05 | T-114-04 | `_items` failures preserve alias and item index | unit | `npm test -- tests/unit/reference-resolver.test.ts` | yes | passed |
| 114-03-01 | 03 | 3 | TMPL-03 | T-114-01 | Document params use existing vault/Supabase resolution and containment | integration | `npm run test:integration -- tests/integration/reference-resolver.integration.test.ts` | yes | passed |
| 114-03-02 | 03 | 3 | VAL-114 | T-114-03 | Public `call_model` behavior fails before provider dispatch on template errors | directed | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_call_model_template_parameterization` | yes | passed |

---

## Wave 0 Requirements

- [ ] `tests/unit/reference-resolver.test.ts` — add template validation, substitution, alias, and `_items` regression cases.
- [ ] `tests/unit/llm-tool.test.ts` — add `template_params` schema/wiring and fail-fast tests.
- [ ] `tests/integration/reference-resolver.integration.test.ts` or `tests/integration/template-resolver.integration.test.ts` — add real-vault document param, alias, `_items`, and plain-document ignored-param cases.
- [ ] `tests/scenarios/directed/testcases/test_call_model_template_parameterization.py` — add managed public `call_model` scenario.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Documentation review for user-facing template examples | VAL-114 | Formal docs are likely owned by later Phase 119, but behavior changes need a review checkpoint | Confirm whether docs updates are deferred or add/update the relevant docs in the implementation plan |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all missing references
- [x] No watch-mode flags
- [x] Feedback latency < 120s for focused checks
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved after full phase gate on 2026-05-06.

## Executed Commands

- `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_call_model_template_parameterization` — passed 1/1 suite, 4/4 steps, strict cleanup clean.
- `npm run build && npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool.test.ts && npm run test:integration -- tests/integration/reference-resolver.integration.test.ts && python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_call_model_template_parameterization` — passed on 2026-05-06 after code-review fix: build succeeded; unit tests passed 124/124; integration tests passed 8/8; directed scenario passed 1/1 suite with 4/4 steps and strict cleanup clean.
