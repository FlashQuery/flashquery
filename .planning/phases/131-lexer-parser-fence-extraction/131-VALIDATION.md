---
phase: 131
slug: lexer-parser-fence-extraction
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-14
---

# Phase 131 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.1 |
| **Config file** | `tests/config/vitest.unit.config.ts` |
| **Quick run command** | `npm test -- macro-lexer macro-parser macro-fence-extractor macro-source-ref` |
| **Integration config file** | `tests/config/vitest.integration.config.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30-90 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- macro-lexer macro-parser macro-fence-extractor macro-source-ref`
- **After every plan wave:** Run `npm test`
- **After Plan 05:** Run `npm run test:integration -- --run tests/integration/macro-parse-error.test.ts`
- **Before `$gsd-verify-work`:** Run `npm test` and `npm run build`
- **Max feedback latency:** 90 seconds for focused parser tests

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 131-01-01 | 01 | 1 | MACRO-PARSE-03, MACRO-PARSE-10 | T-131-01, T-131-02, T-131-03 | Parser contracts encode structured parse failures before macro execution | unit/config | `test -f src/macro/types.ts && test -f src/macro/errors.ts && node -e "const p=require('./package.json'); if(!p.dependencies?.chevrotain) process.exit(1)"` | no - W0 | pending |
| 131-01-02 | 01 | 1 | MACRO-PARSE-01, MACRO-PARSE-03, MACRO-PARSE-04, MACRO-PARSE-05, MACRO-PARSE-06 | T-131-01, T-131-02, T-131-03 | Lexer reserves keywords and tokenizes operators/range without ambiguous prefix behavior | unit | `npm test -- --run tests/unit/macro-lexer.test.ts` | no - W0 | pending |
| 131-02-01 | 02 | 2 | MACRO-SRC-05 | T-131-04, T-131-07 | Malformed fence attributes and invalid canonical block names fail before macro execution | unit | `npm test -- --run tests/unit/macro-fence-extractor.test.ts` | no - W0 | pending |
| 131-02-02 | 02 | 2 | MACRO-SRC-06 | T-131-05, T-131-06 | Ambiguous or invalid named-block selectors do not resolve silently | unit | `npm test -- --run tests/unit/macro-source-ref.test.ts` | no - W0 | pending |
| 131-03-01 | 03 | 2 | MACRO-PARSE-02, MACRO-PARSE-03, MACRO-PARSE-10 | T-131-08, T-131-09 | Reserved/builtin assignment and invalid literals cannot confuse later evaluator dispatch | unit | `npm test -- --run tests/unit/macro-parser.test.ts` | no - W0 | pending |
| 131-03-02 | 03 | 2 | MACRO-PARSE-04, MACRO-PARSE-05, MACRO-PARSE-06, MACRO-PARSE-07, MACRO-PARSE-08, MACRO-PARSE-10 | T-131-09, T-131-10, T-131-11 | Operators, `..`, `range` builtin syntax, and control flow produce stable AST shapes; missing `do` in `for` and `while` returns `parse_error/details.reason: "missing_do"` | unit | `npm test -- --run tests/unit/macro-parser.test.ts` | no - W0 | pending |
| 131-03-03 | 03 | 2 | MACRO-PARSE-09 | T-131-10 | Tool-call grammar parses literal `_exists()` namespace introspection as a distinct AST form and rejects ambiguous dotted server syntax without dispatching tools | unit | `npm test -- --run tests/unit/macro-parser.test.ts` | no - W0 | pending |
| 131-04-01 | 04 | 3 | MACRO-PARSE-01 through MACRO-PARSE-10 | T-131-12, T-131-13 | All migrated POC examples parse without enabling deferred runtime behavior | unit | `npm test -- --run tests/unit/macro-parser.test.ts` | no - W0 | pending |
| 131-05-01 | 05 | 3 | MACRO-PARSE-10 | T-131-14, T-131-15, T-131-16 | Inline handler-boundary parse errors are expected envelopes and do not enable execution or source_ref resolution | integration | `npm run test:integration -- --run tests/integration/macro-parse-error.test.ts` | no - W0 | pending |

---

## Wave 0 Requirements

- [ ] `tests/unit/macro-fence-extractor.test.ts` - covers MACRO-SRC-05 and Test Plan T-U-001 through T-U-009.
- [ ] `tests/unit/macro-source-ref.test.ts` - covers MACRO-SRC-06 and Test Plan T-U-010 through T-U-018.
- [ ] `tests/unit/macro-lexer.test.ts` - covers MACRO-PARSE-01 and lexer-side portions of MACRO-PARSE-03 through MACRO-PARSE-06.
- [ ] `tests/unit/macro-parser.test.ts` - covers MACRO-PARSE-02 through MACRO-PARSE-10.
- [ ] `tests/fixtures/macro/examples/` or equivalent fixture loader - includes the 17 POC examples after final v0 `for ... do` migration.
- [ ] `tests/integration/macro-parse-error.test.ts` - covers Test Plan T-I-001 for inline handler-boundary parse_error behavior.
- [ ] `tests/config/vitest.integration.config.ts` - includes `tests/integration/macro-parse-error.test.ts` if the integration suite uses an explicit include list.
- [ ] `chevrotain` dependency installed in `package.json` and lockfile.

---

## Manual-Only Verifications

All Phase 131 behaviors have automated verification. Any disagreement between the Macro Language requirements doc and test plan is manual-escalation only and must stop implementation until resolved.

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing test files.
- [x] No watch-mode flags.
- [x] Feedback latency target under 90 seconds.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending execution
