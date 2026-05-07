---
phase: 119
slug: discovery-diagnostics-help-resolver
status: green
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-06
completed: 2026-05-07
---

# Phase 119 - Validation Strategy

> Per-phase validation contract for discovery diagnostics and help resolver feedback sampling.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + directed Python scenario runner |
| **Config file** | `tests/config/vitest.unit.config.ts`; directed scenarios use managed FlashQuery server fixtures |
| **Quick run command** | `npm test -- tests/unit/llm-tool.test.ts` |
| **Full suite command** | `npm run lint && npm test -- tests/unit/llm-tool.test.ts tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-registry.test.ts && python3 tests/scenarios/directed/testcases/test_discovery_resolvers.py --managed && python3 tests/scenarios/directed/testcases/test_call_model_help_resolver.py --managed && npm run build` |
| **Estimated runtime** | quick loop ~15-30 seconds; final full gate ~90-180 seconds depending on managed server startup |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- tests/unit/llm-tool.test.ts` before any slower checks
- **After every plan wave:** Run the affected focused command first (`npm test -- tests/unit/llm-tool.test.ts tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-registry.test.ts` for Wave 1; the two directed scenario commands for Wave 2), then run lint/build only at the final gate
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max focused feedback latency:** 30 seconds for task-level loops; final gate may take up to 180 seconds and is intentionally reserved for phase closure

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 119-01-01 | 01 | 0 | DISC-04, VAL-119 | T-119-01 | `help` is raw JSON, available without LLM config, and does not invoke model execution | unit RED | `npm test -- tests/unit/llm-tool.test.ts` | existing | green |
| 119-01-02 | 01 | 0 | DISC-01, DISC-02, DISC-03, VAL-119 | T-119-02 | Discovery response helpers expose stable diagnostics and search metadata without model calls | unit RED | `npm test -- tests/unit/llm-tool.test.ts tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-registry.test.ts` | existing | green |
| 119-02-01 | 02 | 1 | DISC-04 | T-119-01 | Runtime accepts `resolver: "help"` before `name`/`messages`/LLM client checks | unit | `npm test -- tests/unit/llm-tool.test.ts` | existing | green |
| 119-02-02 | 02 | 1 | DISC-01, DISC-02, DISC-03 | T-119-02 | `list_models`, `list_purposes`, and `search` expose diagnostics additively | unit | `npm test -- tests/unit/llm-tool.test.ts tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-registry.test.ts` | existing | green |
| 119-03-01 | 03 | 2 | DISC-03, DISC-04, VAL-119 | T-119-01 / T-119-02 | Public directed scenarios prove help, search, and discovery diagnostics through MCP only | directed | `python3 tests/scenarios/directed/testcases/test_discovery_resolvers.py --managed && python3 tests/scenarios/directed/testcases/test_call_model_help_resolver.py --managed` | mixed | green |
| 119-03-02 | 03 | 2 | VAL-119 | T-119-03 | Phase gate passes with lint, focused tests, directed scenarios, and build | full | `npm run lint && npm test -- tests/unit/llm-tool.test.ts tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-registry.test.ts && python3 tests/scenarios/directed/testcases/test_discovery_resolvers.py --managed && python3 tests/scenarios/directed/testcases/test_call_model_help_resolver.py --managed && npm run build` | mixed | green |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [x] Extend `tests/unit/llm-tool.test.ts` with RED contracts for `resolver: "help"`, help key order, no-envelope behavior, resolver-list drift, discovery ignoring `return_messages`, and enriched search terms.
- [x] Extend existing focused unit tests as needed to pin `list_purposes` empty/populated diagnostics and `list_models` unknown-vs-false diagnostics.
- [x] Create `tests/scenarios/directed/testcases/test_call_model_help_resolver.py` for ATL-DS-15 public help coverage.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None | DISC-01 through DISC-04, VAL-119 | All required behavior is public JSON contract behavior | All phase acceptance is covered by unit or directed scenario commands |

---

## Threat References

| Threat ID | Area | Mitigation |
|-----------|------|------------|
| T-119-01 | Accidental model invocation or usage writes from discovery/help | Keep discovery/help branch before model execution, trace snapshots, and usage writes; unit-test raw JSON/no-envelope behavior and directed-test no public usage side effects where practical |
| T-119-02 | Diagnostic drift or misleading capability admission guidance | Reuse capability, native registry, and template registry helpers; unit-test unknown-vs-false and empty diagnostic arrays |
| T-119-03 | Search leaking document/template contents | Search over metadata only; do not index template bodies, document bodies, or hydrated prompt content |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all missing references
- [x] No watch-mode flags
- [x] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** green - full Phase 119 gate passed on 2026-05-07.

## Phase 119 Final Gate Evidence

**Completed:** 2026-05-07T00:16:51Z

**Command:**

```bash
npm run lint && npm test -- tests/unit/llm-tool.test.ts tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-registry.test.ts && python3 tests/scenarios/directed/testcases/test_discovery_resolvers.py --managed && python3 tests/scenarios/directed/testcases/test_call_model_help_resolver.py --managed && npm run build
```

**Result:** PASS

- `npm run lint` passed with zero warnings.
- Focused unit gate passed: 3 files, 117 tests.
- `test_discovery_resolvers.py --managed` passed: 7/7 steps.
- `test_call_model_help_resolver.py --managed` passed: 1/1 step.
- `npm run build` passed with ESM and DTS output generated.
