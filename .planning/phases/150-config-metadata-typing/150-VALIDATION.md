---
phase: 150
slug: config-metadata-typing
status: verified
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-24
updated: 2026-05-25
---

# Phase 150 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest unit tests |
| **Config file** | `tests/config/vitest.unit.config.ts` |
| **Quick run command** | `npm test -- tests/unit/config-runtime-metadata.test.ts tests/unit/llm-config-sync.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30-90 seconds focused; full suite varies |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- tests/unit/config-runtime-metadata.test.ts tests/unit/llm-config-sync.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `$gsd-verify-work`:** Run focused tests, `npm run typecheck`, and `npm run lint`
- **Max feedback latency:** 90 seconds for focused config loop

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 150-01-01 | 01 | 0 | REQ-012 / T-U-026 | Secret metadata exposure | Deprecation/startup warning metadata remains available only through accessors | unit | `npm test -- tests/unit/config-runtime-metadata.test.ts` | Yes | green |
| 150-01-02 | 01 | 0 | REQ-012 / T-U-027 | Host exposure drift | Stored host exposure metadata is returned; manual configs still recompute fallback | unit | `npm test -- tests/unit/config-runtime-metadata.test.ts` | Yes | green |
| 150-01-03 | 01 | 0 | REQ-012 / T-U-028 | Resolved secret leakage | Raw `${ENV_VAR}` refs are returned; resolved secret strings are absent from refs | unit negative | `npm test -- tests/unit/config-runtime-metadata.test.ts tests/unit/llm-config-sync.test.ts` | Yes | green |
| 150-01-04 | 01 | 0 | REQ-012 / T-U-029 | Hidden string-key side channel | Selected metadata casts are absent from `src/config/loader.ts` | static unit | `npm test -- tests/unit/config-runtime-metadata.test.ts` | Yes | green |
| 150-01-05 | 01 | 1 | REQ-012 | Secret metadata exposure | Runtime metadata storage does not mutate public `FlashQueryConfig` shape with underscore fields | source + unit | `npm test -- tests/unit/config-runtime-metadata.test.ts tests/unit/llm-config-sync.test.ts` | Yes | green |
| 150-01-06 | 01 | 1 | REQ-012 | Type regression | Config loader, LLM config sync, and host exposure consumers remain type-safe | command | `npm run typecheck && npm run lint` | Yes | green |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [x] `tests/unit/config-runtime-metadata.test.ts` - covers T-U-026, T-U-027, T-U-028, and T-U-029.
- [x] Update `tests/unit/llm-config-sync.test.ts` only if the existing direct `_rawLlmApiKeyRefs` helper no longer works after production metadata storage changes.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Phase Gate

- [x] `npm test -- tests/unit/config-runtime-metadata.test.ts tests/unit/llm-config-sync.test.ts` exits 0.
- [x] `rg -n "as unknown as Record<string, unknown>.*_(deprecationWarnings|startupWarnings|resolvedHostToolExposure|rawLlmApiKeyRefs)|_(deprecationWarnings|startupWarnings|resolvedHostToolExposure|rawLlmApiKeyRefs).*as unknown as Record<string, unknown)" src/config/loader.ts` returns no selected metadata side-channel matches.
- [x] `npm run typecheck` exits 0.
- [x] `npm run lint` exits 0.

## Validation Audit 2026-05-25

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 6 |
| Escalated | 0 |

Additional evidence: full unit suite passed (`npm test`, 146 files / 1990 tests), and `npm run build` passed.

---

## Validation Sign-Off

- [x] All tasks have automated verification or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all missing references
- [x] No watch-mode flags
- [x] Feedback latency target < 90s for focused loop
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** verified 2026-05-25
