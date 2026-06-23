---
phase: 171
slug: graph-foundation-schema-and-vocabulary
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-23
---

# Phase 171 - Validation Strategy

> Per-phase validation contract for graph foundation, schema, vocabulary, namespace, and edge metadata work.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest for unit/integration tests |
| **Config file** | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts` |
| **Quick run command** | `npm run test:unit -- --run <foundation unit files>` |
| **Full suite command** | `npm test`; Phase 171 integration commands from `.planning/ROADMAP.md` |
| **Estimated runtime** | ~30-120 seconds for focused unit groups; integration runtime depends on `.env.test` Supabase availability |

---

## Sampling Rate

- **After every task commit:** Run the focused unit file(s) for the edited foundation module.
- **After every plan wave:** Run all Phase 171 unit commands listed in `.planning/ROADMAP.md`.
- **Before `$gsd-verify-work`:** Run Phase 171 integration commands from `.planning/ROADMAP.md`.
- **Max feedback latency:** 120 seconds for focused feedback.

---

## Per-Requirement Verification Map

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| GR-001 | Disabled graph no-op and unsupported discoverability foundation | unit | `npm run test:unit -- --run tests/unit/graph-config.test.ts` | yes | covered |
| GR-002 | Graph config cross-validation | unit | `npm run test:unit -- --run tests/unit/graph-config.test.ts` | yes | covered |
| GR-003 | Vocabulary and prompt sidecars | unit | `npm run test:unit -- --run tests/unit/graph-vocabulary.test.ts tests/unit/graph-prompts.test.ts` | yes | covered |
| GR-004 | Namespaced template variables | unit + integration | `npm run test:unit -- --run tests/unit/reference-resolver-namespaces.test.ts`; `npm run test:integration -- --run tests/integration/graph/namespaced-template-vars.test.ts` | yes | covered |
| GR-005 | Graph schema, including full `fqc_graph_nodes` inventory from Spec §6.2.1 AC2 / T-I-044 | integration | `npm run test:integration -- --run tests/integration/graph/graph-schema.test.ts` | yes | covered |
| GR-007 | Relation vocabulary semantics | unit | `npm run test:unit -- --run tests/unit/graph-relations.test.ts` | yes | covered |
| GR-008 | Edge confidence and metadata validation | unit | `npm run test:unit -- --run tests/unit/graph-edge-validation.test.ts` | yes | covered |

---

## Wave 0 Requirements

- [x] `tests/unit/graph-config.test.ts` - covers GR-001 and GR-002.
- [x] `tests/unit/graph-vocabulary.test.ts` - covers GR-003 and GR-007.
- [x] `tests/unit/graph-prompts.test.ts` - covers GR-003.
- [x] `tests/unit/reference-resolver-namespaces.test.ts` - covers GR-004.
- [x] `tests/unit/graph-relations.test.ts` - covers GR-007.
- [x] `tests/unit/graph-edge-validation.test.ts` - covers GR-008.
- [x] `tests/integration/graph/graph-schema.test.ts` - covers graph schema and T-I-044 full initial `fqc_graph_nodes` column inventory.
- [x] `tests/integration/graph/namespaced-template-vars.test.ts` - covers graph namespace expansion through model/template integration.

---

## Manual-Only Verifications

All Phase 171 behaviors have automated verification targets. Structural graph, read-surface, directed scenario, and YAML scenario verification are Phase 172 targets.

---

## Validation Sign-Off

- [x] All Phase 171 requirements have automated verification targets.
- [x] Sampling continuity requires focused tests after every task and phase-specific commands after every wave.
- [x] Wave 0 identifies all currently missing foundation test files.
- [x] No watch-mode flags are used.
- [x] Feedback latency target is less than 120 seconds for focused test groups.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** automated validation passed 2026-06-23.

## Validation Audit 2026-06-23

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

All Phase 171 requirements have automated coverage and the focused/full verification commands passed.
