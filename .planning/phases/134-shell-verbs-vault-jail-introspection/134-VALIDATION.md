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

**Approval:** approved by Phase 134 Plan 05 validation gate

---

## Final Phase 134 Validation Evidence

**Started:** 2026-05-14T16:47:15Z
**Validator:** 134-05
**Scope:** MACRO-SHELL-01 through MACRO-SHELL-05 only. This validation does not claim Phase 135 dispatch permissions, namespaced tool dispatch permission pre-scan, or dispatch hard exclusions are implemented.

### Task 1: Focused Phase Validation And Source Gates

#### Focused Vitest Gate

```bash
npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-path-wrapper.test.ts tests/unit/macro-shell-verbs.test.ts tests/unit/macro-forbidden-flags.test.ts tests/unit/macro-introspection.test.ts
```

**Exit status:** 0
**Result:** PASS

```text
RUN  v4.1.1 /Users/matt/Documents/Claude/Projects/FlashQuery/flashquery

Test Files  4 passed (4)
     Tests  33 passed (33)
  Start at  13:47:53
  Duration  1.06s (transform 1.24s, setup 0ms, import 2.15s, tests 159ms, environment 0ms)
```

#### Test Plan ID Presence Gate

```bash
for id in T-U-126 T-U-127 T-U-128 T-U-129 T-U-130 T-U-131 T-U-132 T-U-133 T-U-134 T-U-135 T-U-136 T-U-137 T-U-138 T-U-139 T-U-140 T-U-141 T-U-142 T-U-143 T-U-144 T-U-145 T-U-146 T-U-147 T-U-148 T-U-149 T-U-150 T-U-151 T-U-152 T-U-153 T-U-154 T-U-155; do rg -q "$id" tests/unit/macro-path-wrapper.test.ts tests/unit/macro-shell-verbs.test.ts tests/unit/macro-forbidden-flags.test.ts tests/unit/macro-introspection.test.ts || exit 1; echo "PASS $id"; done
```

**Exit status:** 0
**Result:** PASS

| Test Plan ID | Status |
|--------------|--------|
| T-U-126 | PASS |
| T-U-127 | PASS |
| T-U-128 | PASS |
| T-U-129 | PASS |
| T-U-130 | PASS |
| T-U-131 | PASS |
| T-U-132 | PASS |
| T-U-133 | PASS |
| T-U-134 | PASS |
| T-U-135 | PASS |
| T-U-136 | PASS |
| T-U-137 | PASS |
| T-U-138 | PASS |
| T-U-139 | PASS |
| T-U-140 | PASS |
| T-U-141 | PASS |
| T-U-142 | PASS |
| T-U-143 | PASS |
| T-U-144 | PASS |
| T-U-145 | PASS |
| T-U-146 | PASS |
| T-U-147 | PASS |
| T-U-148 | PASS |
| T-U-149 | PASS |
| T-U-150 | PASS |
| T-U-151 | PASS |
| T-U-152 | PASS |
| T-U-153 | PASS |
| T-U-154 | PASS |
| T-U-155 | PASS |

#### Static Cwd-Retirement Gate

```bash
! (rg -n "sh\.cd\(|shelljs\.cd\(|process\.chdir\(" src/macro | grep -v '^#')
```

**Exit status:** 0
**Result:** PASS
**Output:** No production matches in `src/macro` for `sh.cd(`, `shelljs.cd(`, or `process.chdir(`.

### Task 2: Macro Regression And Build Gates

#### Macro Regression Suite

```bash
npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-*.test.ts
```

**Exit status:** 1
**Result:** FAIL

```text
Test Files  1 failed | 15 passed (16)
     Tests  2 failed | 194 passed (196)
  Duration  4.90s
```

Failing tests:

| Test | Related to Phase 134? | Classification |
|------|------------------------|----------------|
| `tests/unit/macro-parser.test.ts > macro parser > T-U-061 parses _exists namespace introspection in conditions` | Yes | Existing parser test expects the pre-134-04 AST shape without `method`; Plan 04 intentionally added `method: "_exists"` so unsupported underscore methods can fail at runtime. |
| `tests/unit/macro-parser.test.ts > macro parser > T-U-062 rejects dotted server names and unsupported namespace methods` | Yes | Existing parser test still expects unsupported underscore methods to fail at parse time; Plan 04 intentionally changed unsupported leading-underscore methods to parse and fail at runtime, as covered by T-U-154. |

Exact failure excerpts:

```text
FAIL  tests/unit/macro-parser.test.ts > macro parser > T-U-061 parses _exists namespace introspection in conditions
AssertionError: expected { kind: 'ToolExistsCall', ...(3) } to deeply equal { kind: 'ToolExistsCall', ...(2) }

- Expected
+ Received

  {
    "kind": "ToolExistsCall",
    "line": 1,
+   "method": "_exists",
    "server": "fq",
  }

FAIL  tests/unit/macro-parser.test.ts > macro parser > T-U-062 rejects dotted server names and unsupported namespace methods
AssertionError: expected true to be false
```

**Resolution:** Updated `tests/unit/macro-parser.test.ts` so T-U-061 expects `method: "_exists"` on `ToolExistsCall`, and T-U-062 keeps dotted-server parse rejection while asserting unsupported leading-underscore namespace methods parse for runtime rejection.

Re-run:

```bash
npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-*.test.ts
```

**Exit status after fix:** 0
**Final result:** PASS

```text
Test Files  16 passed (16)
     Tests  196 passed (196)
  Duration  7.31s
```

#### Production Build

```bash
npm run build
```

**Exit status:** 0
**Result:** PASS

```text
> flashquery@3.0.0 build
> tsup src/index.ts --format esm --dts

ESM Build success in 268ms
DTS Build success in 5737ms
DTS dist/index.d.ts 3.45 KB
```

#### Full Unit Suite

```bash
npm test
```

**Exit status:** 1
**Result:** FAIL

```text
Test Files  1 failed | 108 passed (109)
     Tests  2 failed | 1659 passed (1661)
  Duration  16.03s
```

Failing tests:

| Test | Related to Phase 134? | Classification |
|------|------------------------|----------------|
| `tests/unit/macro-parser.test.ts > macro parser > T-U-061 parses _exists namespace introspection in conditions` | Yes | Same parser expectation drift as the macro regression suite. |
| `tests/unit/macro-parser.test.ts > macro parser > T-U-062 rejects dotted server names and unsupported namespace methods` | Yes | Same parser expectation drift as the macro regression suite. |

**Resolution:** Same parser expectation alignment described above.

Re-run:

```bash
npm test
```

**Exit status after fix:** 0
**Final result:** PASS

```text
Test Files  109 passed (109)
     Tests  1661 passed (1661)
  Duration  23.51s
```

#### Phase 135 Scope Claim Check

This validation records that Phase 134 covers shell verbs, vault jail, forbidden shell flags, cwd retirement, and `_exists()` only. It does not claim MACRO-DISP-01 through MACRO-DISP-07, namespaced tool dispatch permission pre-scan, dispatch backstops, or hard exclusions are implemented.
