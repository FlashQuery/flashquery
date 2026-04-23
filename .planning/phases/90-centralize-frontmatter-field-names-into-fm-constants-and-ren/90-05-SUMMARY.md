---
phase: 90-centralize-frontmatter-field-names-into-fm-constants-and-ren
plan: "05"
subsystem: test-suite
tags: [fq-rename, test-update, frontmatter, ordering, python, typescript]
dependency_graph:
  requires:
    - 90-02-SUMMARY.md
    - 90-03-SUMMARY.md
    - 90-04-SUMMARY.md
  provides:
    - All test files updated to fq_* field names
    - Integration ordering tests ORD-01 through ORD-04 GREEN
    - Python framework fqc_vault.py fully migrated to fq_* fields
  affects:
    - tests/unit/frontmatter-sanitizer.test.ts
    - tests/unit/resolve-document.test.ts
    - tests/unit/compound-tools.test.ts
    - tests/integration/compound-tools.integration.test.ts
    - tests/integration/frontmatter-ordering.integration.test.ts
    - tests/integration/update-header-tags.test.ts
    - tests/scenarios/framework/fqc_vault.py
    - tests/scenarios/directed/testcases/ (11 files)
    - tests/scenarios/integration/run_integration.py
    - src/storage/vault.ts (bug fix)
    - src/mcp/tools/compound.ts (bug fix)
tech_stack:
  added: []
  patterns:
    - FM constants used in test assertions (TypeScript)
    - fq_* property names with backward-compat aliases (Python)
key_files:
  created: []
  modified:
    - tests/unit/frontmatter-sanitizer.test.ts
    - tests/unit/resolve-document.test.ts
    - tests/unit/compound-tools.test.ts
    - tests/integration/compound-tools.integration.test.ts
    - tests/integration/frontmatter-ordering.integration.test.ts
    - tests/integration/update-header-tags.test.ts
    - tests/scenarios/framework/fqc_vault.py
    - tests/scenarios/directed/testcases/test_reconciliation_frontmatter_discovery.py
    - tests/scenarios/directed/testcases/test_reconciliation_modification.py
    - tests/scenarios/directed/testcases/test_reconciliation_disassociation.py
    - tests/scenarios/directed/testcases/test_reconciliation_resurrection.py
    - tests/scenarios/directed/testcases/test_reconciliation_movement.py
    - tests/scenarios/directed/testcases/test_reconciliation_resurrection_with_on_moved.py
    - tests/scenarios/directed/testcases/test_reconciliation_untrack_policy.py
    - tests/scenarios/directed/testcases/test_reconciliation_keep_tracking_stability.py
    - tests/scenarios/directed/testcases/test_frontmatter_preservation.py
    - tests/scenarios/directed/testcases/test_document_update_partial.py
    - tests/scenarios/directed/testcases/test_plugin_lifecycle.py
    - tests/scenarios/directed/testcases/test_plugin_mixed_tables.py
    - tests/scenarios/integration/run_integration.py
    - src/storage/vault.ts
    - src/mcp/tools/compound.ts
decisions:
  - "Used backward-compat property aliases in fqc_vault.py (fqc_id, title, tags, status) to avoid updating 7+ test files outside the 14-file scope"
  - "Restored 'Created:'/'Updated:' display label assertions in get_memory test — FM.CREATED/FM.UPDATED are frontmatter key strings, not MCP response display labels"
  - "MCP response text labels ('FQC ID:', 'Title:', 'Status:') left unchanged; only Python internal dict keys updated"
metrics:
  duration: "~5.3 hours"
  completed: "2026-04-23T04:18:33Z"
  tasks_completed: 2
  files_modified: 22
---

# Phase 90 Plan 05: Update Test Files to fq_* Field Names and User-First Ordering Summary

Wave 3 final plan: all TypeScript and Python test files updated to assert fq_* frontmatter field names, FM constants imported in 4 unit/integration test files, integration ordering tests ORD-01 through ORD-04 GREEN, Python fqc_vault.py fully migrated with backward-compat aliases.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Update 4 TS test files and ordering integration tests | 9759ac3 | frontmatter-sanitizer.test.ts, resolve-document.test.ts, compound-tools.test.ts, compound-tools.integration.test.ts, frontmatter-ordering.integration.test.ts |
| 2 | Update Python framework and 11 directed test files | 3317164 | fqc_vault.py, 11 directed testcases, run_integration.py |

## Verification Results

### Unit Tests (npm test)
- **Result:** 11 failed | 1102 passed (1113 total)
- All 11 failures are pre-existing deferred issues (auth-middleware x6, config x2, embedding x1, RECON-05 x1, TSA-05 x1)
- No new failures introduced by Plan 90-05

### Integration Tests (npm run test:integration)
- **Result:** 19 failed | 23 passed (42 files) — improvement from 21 failed before Plan 90-05
- Plan 90-05 target tests: frontmatter-ordering (4/4 ORD tests GREEN), update-header-tags (3/3 GREEN)
- Remaining 19 failures are pre-existing (compound-tools.integration.test.ts x11 failures, uat-phase-67 x2, and others are pre-existing across multiple files)

### Plan 90-05 Specific Verification
- `grep "_ORDERED_FIELDS" fqc_vault.py` — shows fq_title, fq_id in tuple
- `def fq_id|def fq_title|def fq_status|def fq_tags` — 4 property defs present
- `FM.TITLE|FM.ID|FM.CREATED|FM.UPDATED` — present in compound-tools.test.ts, resolve-document.test.ts, frontmatter-sanitizer.test.ts
- ORD-01 through ORD-04 — all GREEN

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vault.ts writeMarkdown still using bare 'updated' key**
- **Found during:** Task 1 integration test run (ORD-01 failing)
- **Issue:** `src/storage/vault.ts` line 138 wrote `updated: new Date().toISOString()` not `[FM.UPDATED]`. This placed the fq_* field BEFORE user fields in key order, breaking the user-first ordering assertion.
- **Fix:** Changed to `[FM.UPDATED]: new Date().toISOString()` using FM constant
- **Files modified:** src/storage/vault.ts
- **Commit:** 5bef9a8

**2. [Rule 1 - Bug] compound.ts update_doc_header bypassed serializeOrderedFrontmatter**
- **Found during:** Task 1 integration test run (ORD-03 failing after param fix)
- **Issue:** `update_doc_header` in compound.ts wrote frontmatter directly without calling `serializeOrderedFrontmatter`, so user fields appeared after fq_* fields
- **Fix:** Added import and call to serializeOrderedFrontmatter before writeMarkdown
- **Files modified:** src/mcp/tools/compound.ts
- **Commit:** 5bef9a8

**3. [Rule 1 - Bug] frontmatter-ordering.integration.test.ts used wrong MCP parameter names**
- **Found during:** Task 1 integration test run (ORD-01, ORD-03 failing)
- **Issue:** Test stubs from Plan 01 used `extra_frontmatter:` (Zod silently ignores) and `add_tags:` (not a real param, so `updates` was undefined)
- **Fix:** `extra_frontmatter:` → `frontmatter:`, `add_tags: [...]` → `updates: { [FM.TAGS]: [...] }`
- **Files modified:** tests/integration/frontmatter-ordering.integration.test.ts
- **Commit:** 5bef9a8

**4. [Rule 1 - Bug] vault.test.ts asserted old key names after vault.ts bug fix**
- **Found during:** Task 1 unit test run after fixing vault.ts
- **Issue:** Two tests in vault.test.ts asserted `data.updated`, `data.title`, `data.created` — now using `data.fq_updated` etc. after vault.ts fix
- **Fix:** Updated both test assertions to use fq_* key names
- **Files modified:** tests/unit/vault.test.ts
- **Commit:** 5bef9a8

**5. [Rule 1 - Bug] update-header-tags.integration.test.ts read from old frontmatter keys**
- **Found during:** Task 1 integration test run
- **Issue:** Test read `parsed.data.tags` but vault now writes `fq_tags` key; also passed `tags:` not `fq_tags:` in updates
- **Fix:** All `tags` → `fq_tags`, `title` → `fq_title` in updates and assertions
- **Files modified:** tests/integration/update-header-tags.test.ts
- **Commit:** e5de993

**6. [Rule 1 - Bug] compound-tools.integration.test.ts T2-07a broken by incorrect FM constant use**
- **Found during:** Final integration run
- **Issue:** Changed `toContain('created')` → `toContain(FM.CREATED)` but get_memory returns display label "Created:" not frontmatter key "fq_created"
- **Fix:** Restored assertions to `'Created:'` and `'Updated:'` which match the actual MCP response labels
- **Files modified:** tests/integration/compound-tools.integration.test.ts
- **Commit:** ffb74c4

## Known Stubs

None — all assertions are concrete and wired to actual data.

## Threat Flags

None — no new trust boundaries introduced. Only test file changes and two source bug fixes in the same trust zone.

## Self-Check: PASSED

- [FOUND] 9759ac3 — feat(90-05): update 4 TS test files
- [FOUND] 3317164 — feat(90-05): update Python test framework
- [FOUND] 5bef9a8 — fix(90-05): fix 3 ordering bugs
- [FOUND] e5de993 — fix(90-05): update-header-tags test fix
- [FOUND] ffb74c4 — fix(90-05): revert get_memory assertion
- [FOUND] tests/unit/frontmatter-sanitizer.test.ts — present
- [FOUND] tests/scenarios/framework/fqc_vault.py — present
- [FOUND] tests/integration/frontmatter-ordering.integration.test.ts — present
