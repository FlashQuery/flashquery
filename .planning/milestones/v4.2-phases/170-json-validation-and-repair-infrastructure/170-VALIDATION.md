---
phase: 170
slug: json-validation-and-repair-infrastructure
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-22
---

# Phase 170 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest for unit, integration, and E2E; Python scenario runners only if scenario coverage is added |
| **Config file** | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts` |
| **Quick run command** | `npm run test:unit -- tests/unit/llm-json-repair.test.ts` |
| **Full suite command** | Roadmap-required focused commands plus `npm run typecheck` and `npm run build` |
| **Estimated runtime** | Unknown until new tests land; use focused commands per task to keep feedback short |

---

## Sampling Rate

- **After every task commit:** Run the focused command for the behavior slice just changed.
- **After every plan wave:** Run that wave's roadmap-required command group.
- **Before `$gsd-verify-work`:** All roadmap-required commands must be green.
- **Max feedback latency:** One focused test command per behavior slice before broad commands.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 170-01-01 | 01 | 1 | REQ-001 | V5-INPUT | `jsonrepair` is a runtime dependency and ESM import builds | unit/build | `npm run test:unit -- tests/unit/llm-json-repair.test.ts && npm run build` | No | pending |
| 170-01-02 | 01 | 1 | REQ-002 | V5-INPUT | Parser returns typed non-throwing valid/repairable/syntax/schema results | unit | `npm run test:unit -- tests/unit/llm-json-repair.test.ts` | No | pending |
| 170-01-03 | 01 | 1 | REQ-003 | V5-INPUT | Syntax/schema failures are distinguishable with bounded summaries and Zod issues | unit | `npm run test:unit -- tests/unit/llm-json-repair.test.ts` | No | pending |
| 170-01-04 | 01 | 1 | REQ-011 | V5-INPUT | Repair metadata is internally testable without public envelope churn | unit | `npm run test:unit -- tests/unit/llm-json-repair.test.ts` | No | pending |
| 170-02-01 | 02 | 2 | REQ-004 | STRUCTURED-SILENCE | Macro evaluator repairs tool-result payloads and preserves token/trace behavior | unit/integration | `npm run test:unit -- tests/unit/macro-evaluator.test.ts` | Yes | pending |
| 170-02-02 | 02 | 2 | REQ-005 | STRUCTURED-SILENCE | Host-template JSON-like failures become `isError: true`; prose remains text-only | unit/E2E | `npm run test:unit -- tests/unit/host-template-tools.test.ts` | No | pending |
| 170-02-03 | 02 | 2 | REQ-006 | STRUCTURED-SILENCE | Unreadable macro task result envelopes fail tasks instead of completing them | unit/integration | `npm run test:unit -- tests/unit/macro-task-result.test.ts` | No | pending |
| 170-02-04 | 02 | 2 | REQ-010 | INFO-DISCLOSURE | Structured parse failures use existing JSON error helpers with bounded details | unit/integration/E2E | `npm run test:unit -- tests/unit/host-template-tools.test.ts tests/unit/macro-task-result.test.ts` | Partial | pending |
| 170-03-01 | 03 | 2 | REQ-007 | PROVIDER-ARGS | Repairable provider arguments parse to objects; irreparable/non-object args still reject | unit | `npm run test:unit -- tests/unit/llm-client.test.ts` | Yes | pending |
| 170-03-02 | 03 | 2 | REQ-008 | PROSE-FALLBACK | Brokered coercion preserves precedence/prose/isError and warns once on JSON-like fallback | unit | `npm run test:unit -- tests/unit/macro-coerce.test.ts` | Yes | pending |
| 170-03-03 | 03 | 2 | REQ-009 | SCOPE-CREEP | Native tool response parsing remains behaviorally unchanged | unit | `npm run test:unit -- tests/unit/macro-registry.test.ts` | Yes | pending |
| 170-04-01 | 04 | 3 | REQ-004, REQ-006, REQ-010 | STRUCTURED-SILENCE | Public or near-public macro flow proves repair and irreparable failure behavior | integration/scenario | `npm run test:integration -- tests/integration/macro-json-repair.test.ts` | No | pending |
| 170-04-02 | 04 | 3 | REQ-005, REQ-010 | STRUCTURED-SILENCE | Host-template public flow proves structured repair and irreparable error signaling | integration/E2E | `npm run test:integration -- tests/integration/host-template-json-repair.test.ts && npm run test:e2e -- tests/e2e/call-model-template-tools.e2e.test.ts` | Partial | pending |

---

## Wave 0 Requirements

- [ ] `tests/unit/llm-json-repair.test.ts` - stubs and RED tests for REQ-001, REQ-002, REQ-003, REQ-011.
- [ ] `tests/unit/host-template-tools.test.ts` - stubs and RED tests for REQ-005 and REQ-010.
- [ ] `tests/unit/macro-task-result.test.ts` - stubs and RED tests for REQ-006 and REQ-010.
- [ ] `tests/integration/macro-json-repair.test.ts` - integration coverage for T-I-001 and T-I-002.
- [ ] `tests/integration/host-template-json-repair.test.ts` - roadmap-required host-template integration coverage, or a documented scope reconciliation if implementation proves E2E fully covers the requirement.
- [ ] Scenario coverage matrix updates for `ML-33`, `ML-34`, and `IL-45` if directed or YAML scenario tests are added.

---

## Manual-Only Verifications

All Phase 170 behaviors have planned automated verification. Manual review is limited to checking that downstream agents consulted the canonical Requirements and Test Plan before implementation and that any scenario-layer choice is documented.

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all missing references
- [x] No watch-mode flags
- [x] Feedback latency bounded by focused commands before broad commands
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending execution
