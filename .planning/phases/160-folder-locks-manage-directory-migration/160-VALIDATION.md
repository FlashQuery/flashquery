---
phase: 160
slug: folder-locks-manage-directory-migration
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-27
---

# Phase 160 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest integration tests; Python YAML integration scenarios |
| **Config file** | `tests/config/vitest.integration.config.ts`; `tests/scenarios/integration/README.md` |
| **Quick run command** | `npm test -- --grep "directory-lock|with-directory-lock|lock-helper-only"` |
| **Full suite command** | `npm run test:integration -- --grep "folder-lock|manage-directory-advisory"` |
| **Estimated runtime** | ~60-180 seconds, Supabase-dependent tests may skip when `.env.test` is missing or transaction-pooler-only |

---

## Sampling Rate

- **After every task commit:** Run the task's targeted unit or integration command.
- **After every plan wave:** Run `npm test -- --grep "directory-lock|with-directory-lock|lock-helper-only"` plus any wave-owned integration file with `--testNamePattern`.
- **Before `$gsd-verify-work`:** Run `npm run typecheck`, `npm run build`, and `npm run test:integration -- --grep "folder-lock|manage-directory-advisory"`.
- **Max feedback latency:** 180 seconds for local non-Supabase gates; integration tests may skip if the configured test DB is not session-capable.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 160-01-01 | 01 | 1 | REQ-007, REQ-024 | T-160-01 / T-160-04 | Directory helper behavior is specified, release-error semantics match Phase 159, and facade exports remain high-level only | unit/static | `npm test -- tests/unit/with-directory-lock.test.ts tests/unit/lock-helper-only.test.ts --testNamePattern "with-directory-lock|directory-lock|T-U-039|T-U-040|T-U-041|T-U-042|T-U-043"` | yes | green |
| 160-01-02 | 01 | 1 | REQ-007, REQ-024 | T-160-01 / T-160-04 | Shared and exclusive directory locks use canonical `dir:` keys, bounded retries, reverse release, Phase 159 callback/release error precedence, and no directory Tier 1 locks | unit | `npm test -- tests/unit/with-directory-lock.test.ts tests/unit/document-lock-tier2.test.ts tests/unit/lock-timeout.test.ts tests/unit/lock-helper-only.test.ts --testNamePattern "with-directory-lock|directory-lock|advisory-lock|lock_timeout|T-U-039|T-U-040|T-U-041|T-U-042|T-U-043"` | yes | green |
| 160-02-01 | 02 | 2 | REQ-007 | T-160-05 / T-160-06 | Source guards and integration tests require shared ancestor locks on document/compound/scanner file writes, including copy/move destination ancestors where those paths are written or structurally affected | unit/integration | `npm test -- tests/unit/document-tool-lock-call-sites.test.ts --testNamePattern "ancestor|directory-lock|write_document|compound|scanner"; npm run test:integration -- tests/integration/folder-lock.integration.test.ts --testNamePattern "T-I-012|T-I-013|folder-lock"` | yes | unit green; integration skipped-with-reason: `.env.test` DATABASE_URL is transaction pooler, not session-capable |
| 160-02-02 | 02 | 2 | REQ-007 | T-160-05 / T-160-06 | File-write call sites hold shared ancestor locks for all written or structurally affected file paths while preserving existing per-file lock and timeout response behavior | unit/integration | `npm test -- tests/unit/document-tool-lock-call-sites.test.ts tests/unit/write-document.test.ts tests/unit/copy-document.test.ts tests/unit/move-document.test.ts tests/unit/archive-document.test.ts tests/unit/document-batch-lock-contention.test.ts tests/unit/replace-doc-section.test.ts --testNamePattern "ancestor|directory-lock|lock timeout|lock_timeout|write_document|archive_document|remove_document|copy_document|move_document|replace_doc_section"; npm run test:integration -- tests/integration/folder-lock.integration.test.ts --testNamePattern "T-I-012|T-I-013|folder-lock"` | yes | unit green; integration skipped-with-reason: `.env.test` DATABASE_URL is transaction pooler, not session-capable |
| 160-03-01 | 03 | 3 | REQ-007, REQ-024 | T-160-03 / T-160-05 | Public `manage_directory` rename/move shape plus advisory-lock and response-shape tests cover T-I-011, T-I-046, and T-I-047 | unit/integration | `npm test -- tests/unit/manage-directory.test.ts --testNamePattern "manage_directory|directory-lock|lock_timeout|create|rename|move"; npm run test:integration -- tests/integration/folder-lock.integration.test.ts tests/integration/manage-directory-advisory-lock.integration.test.ts --testNamePattern "T-I-011|T-I-046|T-I-047|manage-directory-advisory"` | yes | unit green; integration skipped-with-reason: `.env.test` DATABASE_URL is transaction pooler, not session-capable |
| 160-03-02 | 03 | 3 | REQ-007, REQ-024 | T-160-03 / T-160-05 | `manage_directory` rename/move/remove structural operations take exclusive directory locks, create remains lock-free, and conflict envelopes stay ordered with outer `isError: false` | unit/integration | `npm test -- tests/unit/manage-directory.test.ts --testNamePattern "manage_directory|directory-lock|lock_timeout|create|remove|rename|move"; npm run test:integration -- tests/integration/folder-lock.integration.test.ts tests/integration/manage-directory-advisory-lock.integration.test.ts --testNamePattern "T-I-011|T-I-046|T-I-047|manage-directory-advisory"` | yes | unit green; integration skipped-with-reason: `.env.test` DATABASE_URL is transaction pooler, not session-capable |
| 160-04-01 | 04 | 4 | REQ-007 | T-160-07 | `INT-WCO-01` scenario currently covers only the sequential public write plus `manage_directory` rename/move smoke workflow; the in-flight contention workflow is carried forward until scenario-runner concurrency exists | scenario | `python3 tests/scenarios/integration/run_integration.py --managed folder_coordination` | yes | skipped-with-reason: scenario runner lacks concurrency primitives for the required in-flight write/rename workflow; see Phase 161 carry-over |
| 160-04-02 | 04 | 4 | REQ-007, REQ-024 | T-160-01 through T-160-07 | Final validation records unit, integration, scenario, typecheck, build, and required roadmap evidence without treating skips as passes | docs/evidence | `npm test -- --grep "directory-lock|with-directory-lock|lock-helper-only"; npm run test:integration -- --grep "folder-lock|manage-directory-advisory"; npm run typecheck; npm run build` | yes | green with deviation: Vitest v4 rejects `--grep`; equivalent `--testNamePattern` used |

*Status: pending / green / red / skipped-with-reason / flaky*

---

## Wave 0 Requirements

- [x] Add unit coverage for directory helper behavior and public export boundaries.
- [x] Add or update integration fixtures/helpers for advisory directory behavior.
- [x] Register `tests/integration/folder-lock.integration.test.ts` in `tests/config/vitest.integration.config.ts`.
- [x] Register `tests/integration/manage-directory-advisory-lock.integration.test.ts` in `tests/config/vitest.integration.config.ts`.
- [x] Add `tests/scenarios/integration/tests/folder_coordination.yml`.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Session-capable database evidence | REQ-007, REQ-024 | Local `.env.test` may use a transaction-mode pooler and skip advisory-lock integration tests | When a session-capable `DATABASE_URL` is available, rerun `npm run test:integration -- --grep "folder-lock|manage-directory-advisory"` and record pass/skip output in the summary. |

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or explicit Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verification.
- [x] Wave 0 covers all missing test files/registrations.
- [x] No watch-mode flags.
- [x] Feedback latency under 180 seconds for local non-Supabase gates.
- [x] Supabase-dependent skips are recorded with the concrete `.env.test` capability reason.

**Approval:** complete
