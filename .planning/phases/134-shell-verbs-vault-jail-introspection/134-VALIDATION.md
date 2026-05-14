---
phase: 134
slug: shell-verbs-vault-jail-introspection
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-14
---

# Phase 134 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `tests/config/vitest.unit.config.ts` |
| **Quick run command** | `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-path-wrapper.test.ts tests/unit/macro-shell-verbs.test.ts tests/unit/macro-forbidden-flags.test.ts tests/unit/macro-introspection.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15-30 seconds for per-file task feedback; combined focused macro files may take ~45 seconds; full suite varies by machine |

---

## Sampling Rate

- **After every task commit:** Run only the focused Vitest file for the changed module, e.g. `tests/unit/macro-path-wrapper.test.ts`, `tests/unit/macro-forbidden-flags.test.ts`, `tests/unit/macro-shell-verbs.test.ts`, or `tests/unit/macro-introspection.test.ts`.
- **After every plan wave:** Run `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-path-wrapper.test.ts tests/unit/macro-shell-verbs.test.ts tests/unit/macro-forbidden-flags.test.ts tests/unit/macro-introspection.test.ts`.
- **Before `$gsd-verify-work`:** `npm test` must be green, and static cwd-mutation checks must pass.
- **Max feedback latency:** 30 seconds target for per-file task feedback; combined focused suite and `npm test` are wave/phase gates, not per-task feedback.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 134-01-01 | 01 | 1 | MACRO-SHELL-02 | T-134-01 | Shell paths resolve under vault root; escaping paths fail with `forbidden_path`; `find` output returns vault-rooted paths | unit | `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-path-wrapper.test.ts` | ❌ W0 | ⬜ pending |
| 134-02-01 | 02 | 1 | MACRO-SHELL-03 | T-134-02 / T-134-03 | Forbidden mutation flags are rejected before any statement executes | unit | `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-forbidden-flags.test.ts` | ❌ W0 | ⬜ pending |
| 134-03-01 | 03 | 2 | MACRO-SHELL-01, MACRO-SHELL-04 | T-134-04 / T-134-05 | Only the eight read-only shell verbs execute; mutation verbs are absent; code never mutates process-global cwd | unit/static | `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-shell-verbs.test.ts` | ❌ W0 | ⬜ pending |
| 134-04-01 | 04 | 3 | MACRO-SHELL-05 | T-134-06 | `_exists()` resolves through native/broker layers and unknown underscore methods fail at runtime | unit | `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-introspection.test.ts` | ❌ W0 | ⬜ pending |
| 134-05-01 | 05 | 4 | MACRO-SHELL-01 through MACRO-SHELL-05 | T-134-01 through T-134-06 | Complete shell/vault/pre-scan/introspection contract passes as a phase gate | unit/static | `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-path-wrapper.test.ts tests/unit/macro-shell-verbs.test.ts tests/unit/macro-forbidden-flags.test.ts tests/unit/macro-introspection.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/macro-path-wrapper.test.ts` — stubs and assertions for T-U-137 through T-U-142.
- [ ] `tests/unit/macro-shell-verbs.test.ts` — stubs and assertions for T-U-126 through T-U-136, T-U-143, and T-U-151.
- [ ] `tests/unit/macro-forbidden-flags.test.ts` — stubs and assertions for T-U-144 through T-U-150.
- [ ] `tests/unit/macro-introspection.test.ts` — stubs and assertions for T-U-152 through T-U-155.
- [ ] `src/macro/path-wrapper.ts` — vault-root path resolver and host-to-macro path helper.
- [ ] `src/macro/shell-verbs.ts` — exact eight read-only shell builtin registrations.
- [ ] `src/macro/forbidden-flag-scan.ts` — AST pre-scan for forbidden `sed` and `find` mutation flags.
- [ ] `src/macro/introspection.ts` — `_exists()` native/broker resolver.
- [ ] Dependencies available: `shelljs`, `fast-glob`, and `@types/shelljs` or a documented local typed adapter.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s for focused macro unit files
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
