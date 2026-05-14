---
phase: 134-shell-verbs-vault-jail-introspection
security_reviewed: 2026-05-14
asvs_level: 1
threats_total: 17
threats_closed: 17
threats_open: 0
block_on: open
status: verified
---

# Phase 134 Security Verification

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-134-01 | Tampering | mitigate | CLOSED | `src/macro/path-wrapper.ts:14-35` normalizes/resolves macro paths and enforces root-or-descendant containment before returning a host path. |
| T-134-02 | Information Disclosure | mitigate | CLOSED | `src/macro/path-wrapper.ts:19-24` throws `MacroExpectedError("forbidden_path")` with `details.reason: "resolves_outside_vault"` for paths outside the vault; `tests/unit/macro-path-wrapper.test.ts:47-67` covers `..`, symlink, and sibling-prefix escapes. |
| T-134-03 | Spoofing | mitigate | CLOSED | `src/macro/path-wrapper.ts:46-54` runs host paths through the same containment assertion before formatting a vault-rooted macro path. |
| T-134-04 | Tampering | mitigate | CLOSED | `src/macro/forbidden-flag-scan.ts:99-109` rejects `sed` in-place flags, including bundled short flags; `tests/unit/macro-forbidden-flags.test.ts:22-56` covers `-i`, `--in-place`, and `-ie`. |
| T-134-05 | Elevation of Privilege | mitigate | CLOSED | `src/macro/forbidden-flag-scan.ts:113-126` rejects `find -exec` and `find --exec`; `tests/unit/macro-forbidden-flags.test.ts:58-68` and `82-100` cover direct and nested use. |
| T-134-06 | Tampering | mitigate | CLOSED | `src/macro/forbidden-flag-scan.ts:119-129` rejects `find -delete` and `find --delete`; `tests/unit/macro-forbidden-flags.test.ts:70-80` and `102-119` cover rejection and no prior side effects. |
| T-134-07 | Repudiation | mitigate | CLOSED | `src/macro/evaluator.ts:254-259` runs `preScanForbiddenShellFlags(program)` before preflight/input validation and before `execBlock`; `tests/unit/macro-forbidden-flags.test.ts:102-119` asserts no earlier `echo` trace/log. |
| T-134-08 | Elevation of Privilege | mitigate | CLOSED | `src/macro/shell-verbs.ts:18-27` exports only `grep`, `find`, `sed`, `cat`, `wc`, `head`, `tail`, and `ls`; `tests/unit/macro-shell-verbs.test.ts:136-149` asserts mutation verbs are absent. |
| T-134-09 | Information Disclosure | mitigate | CLOSED | `src/macro/shell-verbs.ts:60-62`, `152-154`, and `226-245` resolve file/path arguments through `resolveMacroPath`, require existence, and realpath-check containment before shell file access. |
| T-134-10 | Tampering | mitigate | CLOSED | `src/macro/shell-verbs.ts:86-94` implements `sed` as in-memory substitution over input text and returns the rewritten text; `tests/unit/macro-shell-verbs.test.ts:73-84` asserts the source file is unchanged. |
| T-134-11 | Denial of Service | mitigate | CLOSED | `src/macro/shell-verbs.ts:251-260` uses `fast-glob` with `cwd` and `followSymbolicLinks: false`, with no cwd mutation; `tests/unit/macro-shell-verbs.test.ts:225-234` and `rg -n "sh\\.cd\\(|shelljs\\.cd\\(|process\\.chdir\\(" src/macro` verify no production cwd mutation calls. |
| T-134-12 | Spoofing | mitigate | CLOSED | `src/macro/introspection.ts:18-22` returns `true` for `server === "fq"` before broker lookup; `tests/unit/macro-introspection.test.ts:15-22` asserts no dispatcher call. |
| T-134-13 | Spoofing | mitigate | CLOSED | `src/macro/introspection.ts:22` calls `broker.isConnected(server)` for brokered `_exists()`; `tests/unit/macro-introspection.test.ts:55-76` asserts exactly one broker call per evaluation and no caching across two evaluations. |
| T-134-14 | Elevation of Privilege | mitigate | CLOSED | `src/macro/parser.ts:410-418` parses leading-underscore zero-arg namespace calls as `ToolExistsCall`; `src/macro/evaluator.ts:783-789` routes that AST to `resolveNamespaceIntrospection`, while `evalToolCall` dispatch is separate at `src/macro/evaluator.ts:711-760`; `src/macro/introspection.ts:10-15` rejects unsupported methods with `unsupported_introspection_method`. |
| T-134-15 | Repudiation | mitigate | CLOSED | `.planning/phases/134-shell-verbs-vault-jail-introspection/134-VALIDATION.md:94-160` records focused command output, T-U-126 through T-U-155 ID checks, and static cwd gate results; `:300-324` records post-review focused gate and build results. |
| T-134-16 | Elevation of Privilege | mitigate | CLOSED | `.planning/phases/134-shell-verbs-vault-jail-introspection/134-VALIDATION.md:88` and `:326-328` explicitly state Phase 134 does not claim Phase 135 dispatch permissions, dispatch pre-scan, backstops, or hard exclusions. |
| T-134-17 | Tampering | mitigate | CLOSED | `.planning/phases/134-shell-verbs-vault-jail-introspection/134-VALIDATION.md:152-160` records the post-implementation static no-cwd gate as passing with no production matches. |

## Security-Relevant Review Findings

The Phase 134 review identified two shell path boundary blockers before this security audit. Both are verified as closed in implementation:

- Symlink escape prevention: `src/macro/path-wrapper.ts:38-44` realpath-checks targets and vault roots; `src/macro/shell-verbs.ts:226-245` applies that check to expanded shell paths; `src/macro/shell-verbs.ts:251-260` disables symlink following for traversal; `tests/unit/macro-shell-verbs.test.ts:190-223` covers file and directory symlink escapes.
- Missing shell path behavior: `src/macro/shell-verbs.ts:242-245` and `:349-356` require existence before reads/listings and return stable `path_not_found`; `tests/unit/macro-shell-verbs.test.ts:176-188` covers `cat`, `grep`, and `ls -d` missing paths.

## Accepted Risks Log

No accepted risks.

## Transferred Risks

None.

## Unregistered Flags

None. `134-05-SUMMARY.md` reports no threat flags, and the earlier summary files contain no `## Threat Flags` entries.

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By | Verification |
|------------|---------------|--------|------|--------|--------------|
| 2026-05-14 | 17 | 17 | 0 | Codex security audit | Focused command passed: `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-path-wrapper.test.ts tests/unit/macro-shell-verbs.test.ts tests/unit/macro-forbidden-flags.test.ts tests/unit/macro-introspection.test.ts` (4 files / 37 tests). |

## Sign-Off

- [x] All threats have a disposition.
- [x] All mitigated threats are verified against implementation code or focused tests.
- [x] Accepted risks log reviewed.
- [x] `threats_open: 0` confirmed.
- [x] `status: verified` set in frontmatter.

**Approval:** verified 2026-05-14
