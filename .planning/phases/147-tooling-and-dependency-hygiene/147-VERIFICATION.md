---
phase: 147-tooling-and-dependency-hygiene
verified: 2026-05-24T17:03:23Z
status: passed
score: 12/12 must-haves verified
overrides_applied: 0
---

# Phase 147: Tooling and Dependency Hygiene Verification Report

**Phase Goal:** Clear dependency/security drift and add a usable `knip` baseline.  
**Verified:** 2026-05-24T17:03:23Z  
**Status:** passed  
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Current `npm audit`, `npm audit --omit=dev`, and `npm outdated` state was recorded before package metadata changes | VERIFIED | `147-dependency-baseline.md` records T-C-001/T-C-002/T-C-003 pre-update command evidence and advisory/outdated tables. |
| 2 | Non-major wanted dependency drift was remediated without folding Chevrotain or MCP SDK into the first lane | VERIFIED | Baseline records `npm update`, direct package updates, and SDK re-pinning; final `npm outdated` now reports only `@modelcontextprotocol/sdk` wanted drift plus `uuid` latest-major drift. |
| 3 | `npm audit` and `npm audit --omit=dev` report no unhandled vulnerabilities | VERIFIED | I ran both commands; both exited 0 with `found 0 vulnerabilities`. |
| 4 | Chevrotain 12 was handled in a separately reviewable update lane | VERIFIED | Root `package.json` declares `chevrotain: ^12.0.0`; root lockfile installs `12.0.0`; baseline records the isolated Chevrotain lane. |
| 5 | Chevrotain parser behavior remains green after the major update | VERIFIED | I ran `npm test -- --run tests/unit/macro-parser.test.ts` (35 passed) and `npm run test:macro-framework` (518 passed). |
| 6 | Nested macro golden-model Chevrotain audit state is handled | VERIFIED | Nested package declares `chevrotain: ^12.0.0`; nested lockfile installs `12.0.0`; baseline documents nested audit closure. |
| 7 | MCP SDK update is safely applied or explicitly deferred to Phase 148 | VERIFIED | SDK remains `1.27.1`; `src/mcp/server.ts` still has broad wrapper/cast paths; roadmap assigns typed wrapper consolidation to Phase 148/REQ-008, matching the documented deferral. |
| 8 | `npm outdated` final status is acceptable for Phase 147 | VERIFIED | I ran `npm outdated`; nonzero output is limited to documented `@modelcontextprotocol/sdk` wanted drift deferred to Phase 148 and `uuid` latest-major-only drift. |
| 9 | A developer can run `npm run knip` from repo root | VERIFIED | `package.json` has a `knip` script; I ran `npm run knip` and it exited 0. |
| 10 | Knip excludes worktree, vendor, and build noise | VERIFIED | `knip.ts` ignores `.claude/worktrees/**`, `src/node_modules/**`, `src/dist/**`, and `dist/**`; the T-U-015 test imports the live config and checks these globs. |
| 11 | Preflight runs Knip directly or through a documented staged script | VERIFIED | `package.json` preflight runs `npm run knip`; I ran `npm run preflight` and it exited 0 with 142 files / 1,971 tests passing. |
| 12 | Typecheck and lint remain green after tooling/dependency changes | VERIFIED | I ran `npm run typecheck` and `npm run lint`; both exited 0. |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | Dependency/script metadata for Chevrotain, Knip, MCP SDK deferral, and preflight | VERIFIED | Contains `chevrotain: ^12.0.0`, `@modelcontextprotocol/sdk: ^1.27.1`, `knip` dev dependency, `knip` script, and preflight chaining `npm run knip`. |
| `package-lock.json` | npm-generated lockfile refresh | VERIFIED | `lockfileVersion: 3`; installed versions include Chevrotain 12.0.0, SDK 1.27.1, UUID 13.0.2, and Knip 6.14.2. |
| `knip.ts` | Typed ESM Knip configuration and reachability policy | VERIFIED | Default export typed as `KnipConfig`; includes policy comment, scoped entry/project, required ignores, and explicit dependency exceptions. |
| `tests/unit/knip-config.test.ts` | T-U-015 static assertion for Knip exclusions | VERIFIED | Imports live `knip.ts` config and fails with missing glob names; focused test passed. |
| `tests/macro-framework/macro-golden-model/package.json` | Nested fixture Chevrotain v12 state | VERIFIED | Declares `chevrotain: ^12.0.0`. |
| `tests/macro-framework/macro-golden-model/package-lock.json` | Nested fixture lockfile update | VERIFIED | Lockfile v3 installs Chevrotain 12.0.0. |
| `.planning/phases/147-tooling-and-dependency-hygiene/147-dependency-baseline.md` | Baseline, staged rollout, Chevrotain, and MCP SDK evidence | VERIFIED | Substantive command evidence and explicit residual rationale present. |
| `.planning/phases/147-tooling-and-dependency-hygiene/147-final-validation.md` | Final T-C-001..006 and T-U-013..014 validation report | VERIFIED | Contains final command evidence and residual closure rationale. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `package.json` | `package-lock.json` | npm-generated lockfile refresh | VERIFIED | Lockfile v3 exists and installed package versions match the package metadata/residual decisions. |
| `147-dependency-baseline.md` | `package-lock.json` | Recorded before/after dependency evidence | VERIFIED | Baseline records lockfile refresh, installed versions, and SDK lockfile version check. |
| `package.json` | `knip.ts` | `npm run knip` | VERIFIED | Script invokes `knip`; Knip automatically loads root `knip.ts`; command exited 0. |
| `tests/unit/knip-config.test.ts` | `knip.ts` | Live config import | VERIFIED | Test imports `knip.ts` via file URL and passed. |
| `package.json` | macro parser/framework tests | Chevrotain dependency exercised by tests | VERIFIED | Root and nested Chevrotain v12 installs are covered by focused parser and macro framework test commands. |
| `147-dependency-baseline.md` | `src/mcp/server.ts` / Phase 148 | MCP SDK deferral evidence | VERIFIED | Baseline cites active broad wrapper/cast code and Phase 148 ownership; grep confirmed both. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| Tooling/config artifacts | N/A | Static package/config/test files | N/A | SKIPPED - no dynamic rendered data or runtime data source in this phase. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full audit has no vulnerabilities | `npm audit` | Exit 0; `found 0 vulnerabilities` | PASS |
| Production audit has no vulnerabilities | `npm audit --omit=dev` | Exit 0; `found 0 vulnerabilities` | PASS |
| Final outdated residuals are documented-only | `npm outdated` | Exit 1; only SDK wanted drift and UUID latest-major drift | PASS |
| Knip runs cleanly | `npm run knip` | Exit 0; no findings | PASS |
| Knip config policy test passes | `npm test -- --run tests/unit/knip-config.test.ts` | 1 test passed | PASS |
| Macro parser regression passes | `npm test -- --run tests/unit/macro-parser.test.ts` | 35 tests passed | PASS |
| Macro framework regression passes | `npm run test:macro-framework` | 518 tests passed | PASS |
| Typecheck passes | `npm run typecheck` | Exit 0 | PASS |
| Lint passes | `npm run lint` | Exit 0 | PASS |
| Preflight passes and includes Knip | `npm run preflight` | Exit 0; 142 files / 1,971 tests passed; package dry-run OK; Docker skipped because unavailable | PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| N/A | `find scripts -path '*/tests/probe-*.sh' -type f` | No phase-declared or conventional probes found | SKIPPED |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| REQ-006 | 147-01, 147-03, 147-04 | Dependency vulnerabilities and wanted-version drift are remediated; audit/outdated recorded; non-major updates applied; Chevrotain v12 tested; MCP SDK drift handled after typed wrapping; remaining advisories zero or documented. | SATISFIED | Audits are clean; baseline records pre/post states; Chevrotain v12 root/nested installed; parser/framework gates pass; SDK drift deferred to Phase 148 with code/roadmap evidence. |
| REQ-007 | 147-02, 147-04 | Knip is configured for actionable local and preflight use with noise exclusions, policy documentation, and preflight inclusion or staging. | SATISFIED | `knip.ts` has required ignores and policy; `npm run knip` and T-U-015 pass; preflight directly runs Knip and passed. |

No orphaned Phase 147 requirements found in `.planning/REQUIREMENTS.md`; REQ-006 and REQ-007 are the only Phase 147 mappings.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `package.json` | 39 | `console.log` in `preflight:pack` inline script | INFO | Expected CLI output for package dry-run gate; not a stub or debt marker. |
| `147-dependency-baseline.md` | 350 | `console.log` inside documented evidence command | INFO | Historical command evidence; not implementation code. |

No unreferenced `TBD`, `FIXME`, or `XXX` debt markers found in the phase-modified files scanned.

### Human Verification Required

None. Phase 147 is command-line/tooling hygiene; the required outcomes are verifiable through static files and command gates.

### Gaps Summary

No blocking gaps found. The residual `@modelcontextprotocol/sdk` wanted drift is explicitly assigned to Phase 148 because typed MCP wrapper consolidation has not landed. The residual `uuid` item is latest-major-only drift with no wanted drift and no audit advisory. Full Knip export reporting is documented as staged API-surface cleanup; the Phase 147 Knip gate covers files, dependencies, unlisted dependencies, binaries, and unresolved imports and passes.

---

_Verified: 2026-05-24T17:03:23Z_  
_Verifier: the agent (gsd-verifier)_
