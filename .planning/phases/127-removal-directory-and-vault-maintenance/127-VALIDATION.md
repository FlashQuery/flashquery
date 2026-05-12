---
phase: 127
slug: removal-directory-and-vault-maintenance
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-12
---

# Phase 127 — Validation Strategy

> Pre-execution Nyquist validation contract for Phase 127. Final execution evidence may be appended here by `127-06-PLAN.md`, but this artifact exists before implementation so the planning gate can verify test intent.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest for unit/integration/E2E, Python scenario runners for directed/YAML workflows |
| **Config file** | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts` |
| **Quick run command** | `npm test -- tests/unit/remove-document.test.ts tests/unit/manage-directory.test.ts tests/unit/maintain-vault.test.ts` |
| **Full suite command** | `npm test && npm run test:e2e -- tests/e2e/protocol.test.ts && npm run build` |
| **Estimated runtime** | ~180 seconds focused, full suite varies with integration prerequisites |

## Sampling Rate

- **After every task commit:** Run the focused unit command for the touched surface.
- **After every plan wave:** Run the focused integration/E2E/scenario command named by that plan.
- **Before `$gsd-verify-work`:** Focused unit, integration, E2E, directed scenario, YAML integration, local audits, and build must be green or explicitly skipped by existing environment guards.
- **Max feedback latency:** 5 minutes for focused gates.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 127-01-01 | 01 | 1 | DOC-09/SYS-01/SYS-02/SYS-03 | T-127-01-* | Traceability, config, metadata, and helpers exist before behavior work | unit | `npm test -- tests/unit/config.test.ts tests/unit/tool-metadata.test.ts` | ✅ | ✅ green |
| 127-02-01 | 02 | 2 | SYS-01/SYS-02 | T-127-02-* | Directory actions validate paths, preserve order, and use locks | unit | `npm test -- tests/unit/manage-directory.test.ts tests/unit/files-tools.test.ts tests/unit/write-lock.test.ts` | ✅ | ✅ green |
| 127-02-02 | 02 | 2 | SYS-01/SYS-02 | T-127-02-* | Directory create/remove work through real filesystem integration | integration | `npm run test:integration -- tests/integration/manage-directory.integration.test.ts` | ✅ | ✅ green |
| 127-03-01 | 03 | 3 | SYS-03 | T-127-03-* | Maintenance action normalization, conflict, status boundary, and shutdown policy are testable | unit | `npm test -- tests/unit/maintain-vault.test.ts tests/unit/scanner.test.ts tests/unit/shutdown.test.ts` | ✅ | ✅ green |
| 127-03-02 | 03 | 3 | SYS-03 | T-127-03-* | Sync, repair, combined ordering, background, conflict, and shutdown behavior work through integration | integration | `npm run test:integration -- tests/integration/maintain-vault.integration.test.ts tests/integration/shutdown.integration.test.ts` | ✅ | ✅ green |
| 127-04-01 | 04 | 4 | DOC-09 | T-127-04-* | Removal archives before move/delete, rejects unsafe trash paths, and honors git policy | unit | `npm test -- tests/unit/remove-document.test.ts tests/unit/vault.test.ts tests/unit/git-manager.test.ts` | ✅ | ✅ green |
| 127-04-02 | 04 | 4 | DOC-09 | T-127-04-* | Removal followed by maintenance does not reclassify intentionally archived documents as missing/stale | integration | `npm run test:integration -- tests/integration/remove-document.integration.test.ts tests/integration/maintain-vault.integration.test.ts` | ✅ | ✅ green |
| 127-05-01 | 05 | 5 | DOC-09/SYS-01/SYS-02/SYS-03 | T-127-05-* | MCP and scenarios use final tool names and JSON envelopes | e2e/scenario | `npm run test:e2e -- tests/e2e/protocol.test.ts && python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup removal_directory_maintenance && python3 tests/scenarios/integration/run_integration.py --managed removal_directory_maintenance` | ✅ | ✅ green |
| 127-06-01 | 06 | 6 | DOC-09/SYS-01/SYS-02/SYS-03 | T-127-06-* | Final validation records all commands and local audits | audit | `npm run build` plus grep audits in `127-06-PLAN.md` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. Phase 127 plans create or update the focused test files as part of implementation:

- `tests/unit/remove-document.test.ts`
- `tests/unit/manage-directory.test.ts`
- `tests/unit/maintain-vault.test.ts`
- `tests/integration/remove-document.integration.test.ts`
- `tests/integration/manage-directory.integration.test.ts`
- `tests/integration/maintain-vault.integration.test.ts`
- `tests/scenarios/directed/testcases/test_removal_directory_maintenance.py`
- `tests/scenarios/integration/tests/removal_directory_maintenance.yml`

## Manual-Only Verifications

All phase behaviors have automated verification. Git auto-push behavior may use mocked GitManager coverage unless an integration remote fixture already exists.

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or existing infrastructure dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5 minutes for focused gates
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-12 for pre-execution planning gate

## Final Phase 127 Validation Evidence

**Started:** 2026-05-12T21:01:17Z
**Task 1 completed:** 2026-05-12T21:08:33Z
**Scope:** Phase 127 final verification only. Phase 128 global legacy cleanup remains excluded.
**Requirements covered:** DOC-09, SYS-01, SYS-02, SYS-03.

### Focused Unit Gate

**Command:**

```bash
npm test -- tests/unit/remove-document.test.ts tests/unit/manage-directory.test.ts tests/unit/maintain-vault.test.ts tests/unit/config.test.ts tests/unit/tool-metadata.test.ts
```

**Result:** PASS.

**Observed output:**

```text
Test Files  5 passed (5)
Tests  70 passed (70)
Duration  817ms
```

**Requirement evidence:** DOC-09 (`remove_document`), SYS-01/SYS-02 (`manage_directory`), SYS-03 (`maintain_vault`), and shared config/metadata contracts.

### Focused Integration Gate

**Command:**

```bash
npm run test:integration -- tests/integration/remove-document.integration.test.ts tests/integration/manage-directory.integration.test.ts tests/integration/maintain-vault.integration.test.ts
```

**Result:** PASS.

**Observed output:**

```text
Test Files  3 passed (3)
Tests  17 passed (17)
Duration  71.33s
```

**Notes:** The run emitted the known Supabase DDL warning `column "description" of relation "fqc_documents" does not exist`; focused integration tests still passed.

**Requirement evidence:** DOC-09 destructive document removal, SYS-01/SYS-02 real directory lifecycle, SYS-03 real maintenance sync/repair/status behavior.

### Focused E2E MCP Gate

**Command:**

```bash
npm run test:e2e -- tests/e2e/protocol.test.ts
```

**Result:** PASS.

**Observed output:**

```text
Test Files  1 passed (1)
Tests  25 passed (25)
Duration  84.46s
```

**Requirement evidence:** DOC-09/SYS-01/SYS-02/SYS-03 public MCP protocol JSON round trips and local legacy-name absence checks from Phase 127 protocol coverage.

### Directed Scenario Gate

**Command:**

```bash
python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup removal_directory_maintenance
```

**Result:** PASS.

**Observed output:**

```text
[PASS] test_removal_directory_maintenance - 37/37 steps (18.6s)
PASS: 1
FAIL: 0
RESIDUE: 0 test(s) left rows behind
REPORT: tests/scenarios/directed/reports/scenario-report-2026-05-12-180644.md
```

**Requirement evidence:** Directed workflow coverage for DOC-09, SYS-01, SYS-02, and SYS-03 with strict cleanup.

### YAML Integration Scenario Gate

**Command:**

```bash
python3 tests/scenarios/integration/run_integration.py --managed removal_directory_maintenance
```

**Result:** PASS.

**Observed output:**

```text
[PASS] removal_directory_maintenance - 17/17 steps (21930ms)
Results: 1/1 passed
Report: tests/scenarios/integration/reports/integration-report-2026-05-12-180812.md
```

**Requirement evidence:** Cross-tool workflow coverage for directory create/remove, document removal, vault maintenance repair/sync/status, and absence after intentional removal.

### Build Gate

**Command:**

```bash
npm run build
```

**Result:** PASS.

**Observed output:**

```text
ESM Build success in 273ms
DTS Build success in 5510ms
DTS dist/index.d.ts 3.45 KB
```

**Requirement evidence:** Phase 127 code compiles after final focused verification.

## Task 2 Local Audits

**Task 2 completed:** 2026-05-12T21:09:00Z

### legacy-name audit

**Command:**

```bash
rg -n "create_directory|remove_directory|force_file_scan|reconcile_documents" src tests | rg -v "tool-metadata|legacy|suggest|Phase 128|127-VALIDATION|DIRECTED_COVERAGE|INTEGRATION_COVERAGE"
```

**Result:** PASS with classified remaining matches.

**Output/classification summary:**

| Match family | Classification | Reason |
|--------------|----------------|--------|
| `tests/e2e/protocol.test.ts` `not.toContain(...)` checks for `create_directory`, `remove_directory`, `force_file_scan`, `reconcile_documents` | ported Phase 127 absence assertions | These prove local host MCP exposure hides the replaced names. |
| `src/mcp/tool-exposure.ts` replaced-name deny list for `create_directory`, `remove_directory`, `force_file_scan`, `reconcile_documents` | ported Phase 127 exposure guard | This is the implementation that supports the E2E absence assertions. |
| `tests/unit/maintain-vault.test.ts` checks that `force_file_scan` is not registered by `registerScanTools` | ported Phase 127 unit assertion | Confirms the active scan registration path exposes `maintain_vault`. |
| `src/services/scanner.ts` comments using `force_file_scan` to describe old scan-drain semantics | allowed transitional context | Scanner internals predate Phase 127; wording remains historical implementation context, not an active public surface. |
| `src/mcp/utils/path-validation.ts` comments naming `create_directory`/`remove_directory` | allowed transitional context | Utility comment describes historical call sites and does not expose tools. |
| `src/mcp/tools/files.ts` active `create_directory`/`remove_directory` handler source and comments | Phase 128 global cleanup context | Phase 127 hides these locally from host exposure; broad source deletion is Phase 128 scope. |
| `src/mcp/tools/documents.ts` active `reconcile_documents` handler source and comments | Phase 128 global cleanup context | Phase 127 added `maintain_vault` and local scan registration; broader document-tool legacy cleanup is Phase 128 scope. |
| Older unit/scenario files such as `tests/unit/document-tools.test.ts`, `tests/unit/files-tools.test.ts`, `tests/unit/staleness-invalidation.test.ts`, and pre-127 directed scenarios | Phase 128 global cleanup context or historical coverage | These are pre-existing global legacy-test surfaces and are not migrated by this final Phase 127 validation plan. |
| `tests/unit/llm-config.test.ts`, `tests/unit/llm-tool-registry.test.ts`, `tests/unit/tool-exposure.test.ts` | allowed migration/selector context | These validate legacy-name preservation or exclusion behavior in configuration/tool selection layers. |

**Blockers:** None for Phase 127. Remaining broad source/test cleanup is explicitly scoped to Phase 128.

### prose-response audit

**Command:**

```bash
rg -n "Directory created:|Directory removed:|Scan complete|Reconciliation complete" tests/unit tests/integration tests/e2e tests/scenarios | rg -v "historical|legacy|Phase 128"
```

**Result:** PASS.

**Observed output:**

```text
No matches. Pipeline exit code 1 from rg means no migrated Phase 127 test asserts the old prose/key-value responses.
```

**Classification:** No blockers. Migrated Phase 127 tests parse JSON and no longer assert the old directory/scan/reconciliation prose strings.

### frontmatter audit

**Command:**

```bash
rg -n "fq_original_path|fq_archived_at|fq_status" src tests | rg -v "frontmatter-fields|FM\.|expected fixture|fixture"
```

**Result:** PASS with classified remaining matches.

**Output/classification summary:**

| Match family | Classification | Reason |
|--------------|----------------|--------|
| `src/mcp/tools/documents.ts` schema descriptions mentioning reserved `fq_*` fields | allowed user-facing description text | These are validation/help strings, not frontmatter access. |
| `src/storage/vault.ts`, `src/mcp/utils/frontmatter-sanitizer.ts`, `src/mcp/utils/document-output.ts`, `src/mcp/tools/compound.ts` comments | allowed historical/internal explanatory context | Comments do not read/write managed frontmatter fields. |
| Unit/integration/scenario fixtures and expected literal frontmatter payloads | allowed test fixture/expected output context | Tests intentionally assert serialized YAML field names or generate raw markdown fixtures. |
| `tests/scenarios/framework/frontmatter_fields.py` | allowed cross-language constant registry | Python scenarios use their own field-name helper to build fixture markdown. |
| `src/mcp/tools/documents.ts` raw `fq_original_path` search | no matches | Production `remove_document` access uses `FM.ORIGINAL_PATH`. |

**Direct production check:**

```bash
grep -n "fq_original_path" src/mcp/tools/documents.ts
```

**Observed output:**

```text
No matches.
```

**Blockers:** None. Phase 127 production code uses `FM.*` constants for managed frontmatter access; raw `fq_*` occurrences are descriptions, comments, fixtures, or expected serialized field names.

## Source Coverage Audit

**Task 3 completed:** 2026-05-12T21:10:00Z

### GOAL

| Item | Decision | Evidence |
|------|----------|----------|
| `remove_document` | COVERED | Unit, integration, E2E, directed, YAML integration, build, and local audit evidence are recorded above and linked from `TRACEABILITY.md`. |
| `manage_directory` | COVERED | Create/remove unit, integration, E2E, directed, YAML integration, build, and local audit evidence are recorded above and linked from `TRACEABILITY.md`. |
| `maintain_vault` | COVERED | Sync/repair/status unit, integration, E2E, directed, YAML integration, build, and local audit evidence are recorded above and linked from `TRACEABILITY.md`. |
| final verification | COVERED | Focused unit, integration, E2E, directed scenario, YAML integration, local audits, and build all passed in Task 1/Task 2 evidence. |
| Phase 128-only broad global cleanup | EXCLUDED | Scoped to Phase 128. Phase 127 only validates local absence/ported coverage and classifies remaining broad legacy source/test surfaces. |

### REQ

| Item | Decision | Evidence |
|------|----------|----------|
| `DOC-09` / `remove_document` | COVERED | `tests/unit/remove-document.test.ts`, `tests/integration/remove-document.integration.test.ts`, `tests/e2e/protocol.test.ts`, directed `D-rdoc-*`, YAML `INT-rdoc-*`, and `127-VALIDATION.md`. |
| `SYS-01` / `manage_directory(action:"create")` | COVERED | `tests/unit/manage-directory.test.ts`, `tests/integration/manage-directory.integration.test.ts`, `tests/e2e/protocol.test.ts`, directed `D-mdir-*`, YAML `INT-mdir-*`, and `127-VALIDATION.md`. |
| `SYS-02` / `manage_directory(action:"remove")` | COVERED | `tests/unit/manage-directory.test.ts`, `tests/integration/manage-directory.integration.test.ts`, `tests/e2e/protocol.test.ts`, directed `D-mdir-*`, YAML `INT-mdir-*`, and `127-VALIDATION.md`. |
| `SYS-03` / `maintain_vault` | COVERED | `tests/unit/maintain-vault.test.ts`, `tests/integration/maintain-vault.integration.test.ts`, `tests/e2e/protocol.test.ts`, directed `D-mvault-*`, YAML `INT-mvault-*`, and `127-VALIDATION.md`. |
| traceability | COVERED | `TRACEABILITY.md` now links all four requirements to `127-VALIDATION.md` final evidence. |
| config/trash | COVERED | `tests/unit/config.test.ts` ran in the focused unit gate; prior Plan 127-01 and Plan 127-04 evidence remain linked. |
| metadata/legacy tool migration | COVERED | `tests/unit/tool-metadata.test.ts`, `tests/e2e/protocol.test.ts`, and the Task 2 legacy-name audit validate local Phase 127 metadata/exposure behavior. |
| E2E/protocol | COVERED | `npm run test:e2e -- tests/e2e/protocol.test.ts` passed with 25 tests. |
| directed scenario | COVERED | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup removal_directory_maintenance` passed 37/37 steps with zero residue. |
| integration scenario | COVERED | `python3 tests/scenarios/integration/run_integration.py --managed removal_directory_maintenance` passed 17/17 steps. |
| final verification | COVERED | Task 1 and Task 2 sections record exact commands, results, and audit classifications. |
| Phase 128-only broad global cleanup | EXCLUDED | Scoped to Phase 128. Phase 127 does not delete global legacy handlers/tests/docs outside local final-tool validation. |

### RESEARCH

| Item | Decision | Evidence |
|------|----------|----------|
| `remove_document` archive-before-trash/delete and git-aware behavior | COVERED | Plan 127-04 implementation evidence, focused integration gate, E2E protocol gate, and scenario gates. |
| `manage_directory` ordered create/remove and directory-scoped locking | COVERED | Plan 127-02 implementation evidence, focused unit/integration gates, E2E protocol gate, and scenario gates. |
| `maintain_vault` sync/repair/status/background/conflict behavior | COVERED | Plan 127-03 implementation evidence, focused unit/integration gates, E2E protocol gate, and scenario gates. |
| traceability | COVERED | Phase-local `TRACEABILITY.md` is closed with final `127-VALIDATION.md` links. |
| config/trash | COVERED | Config tests and remove_document integration cover `trash_folder` behavior and invalid traversal rejection. |
| metadata/legacy tool migration | COVERED | Tool metadata/unit tests, host exposure E2E, and local audit classifications cover Phase 127 migration boundaries. |
| E2E/protocol | COVERED | `tests/e2e/protocol.test.ts` passed and covers final Phase 127 MCP surface. |
| directed scenario | COVERED | `tests/scenarios/directed/testcases/test_removal_directory_maintenance.py` passed under managed strict cleanup. |
| integration scenario | COVERED | `tests/scenarios/integration/tests/removal_directory_maintenance.yml` passed under managed execution. |
| final verification | COVERED | This `127-VALIDATION.md` section records the final validation evidence. |
| Phase 128-only broad global cleanup | EXCLUDED | Scoped to Phase 128 per `127-CONTEXT.md` deferred boundary. |

### CONTEXT

| Item | Decision | Evidence |
|------|----------|----------|
| `remove_document` | COVERED | Phase 127 implementation summaries plus Task 1 final verification prove the destructive document flow. |
| `manage_directory` | COVERED | Phase 127 implementation summaries plus Task 1 final verification prove directory lifecycle behavior. |
| `maintain_vault` | COVERED | Phase 127 implementation summaries plus Task 1 final verification prove administrative maintenance behavior. |
| traceability | COVERED | `TRACEABILITY.md` rows are complete and reference `127-VALIDATION.md`. |
| config/trash | COVERED | `trash_folder` config and `FM.ORIGINAL_PATH` are covered by unit and integration evidence. |
| metadata/legacy tool migration | COVERED | Local host exposure excludes Phase 127 replaced names; remaining global cleanup is classified for Phase 128. |
| E2E/protocol | COVERED | MCP protocol gate passed and records final tool round trips. |
| directed scenario | COVERED | Directed scenario gate passed with strict cleanup. |
| integration scenario | COVERED | YAML integration scenario gate passed. |
| final verification | COVERED | Focused verification and audits are recorded in this file. |
| Phase 128-only broad global cleanup | EXCLUDED | Scoped to Phase 128. |
