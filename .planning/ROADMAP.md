# Roadmap: FlashQuery Core

## Milestones

- ✅ **v1.0 MVP** — Phases 1-9 (shipped 2026-03-25)
- ✅ **v1.5 Full MVP** — Phases 10-16 (shipped 2026-03-27)
- ✅ **v1.6 Prep for Open Source** — Phases 17-21 (shipped 2026-03-30)
- ✅ **v1.7 Issues Resolution & Pre-Release Hardening** — Phases 22-25 (shipped 2026-03-31)
- ✅ **v1.8 Bug Fixes: Plugin Scope & Token Security** — Phases 28-29 (shipped 2026-04-01)
- ✅ **v1.9 MCP Tool Overhaul** — Phases 30-33 (shipped 2026-04-06)
- ✅ **v2.0 Doc Sync Overhaul** — Phases 36-40 (shipped 2026-04-07)
- ✅ **v2.1 Test Suite Recovery** — Phases 41-44 (shipped 2026-04-07)
- ✅ **v2.2 Status Model Refactor & Infrastructure Hardening** — Phases 45-48 (shipped 2026-04-08)
- ✅ **v2.3 HTTP Authentication & Interoperability** — Phases 49-52 (shipped 2026-04-09)
- ✅ **v2.4 Plugin Discovery & Document Interoperability** — Phases 54–60b + code review (shipped 2026-04-12)
- ✅ **v2.5 New MCP Document Tools** — Phases 61-68 (shipped 2026-04-13)
- ✅ **v2.5.1 Gap Closure & Test Maintenance** — Phases 69-71 (shipped 2026-04-14)
- ✅ **v2.6 Test Infrastructure & Quality** — Phases 72-80 (shipped 2026-04-15)
- ✅ **v2.7 Name Change & Pre-Launch Preparation** — Phase 83 (shipped 2026-04-16)
- ✅ **v2.8 Plugin Callback Overhaul** — Phases 84-89 (shipped 2026-04-21)
- [ ] **v2.9 Filesystem Primitive Tools** — Phases 91-97 (in progress)

## Phases

<details>
<summary>✅ v2.8 Plugin Callback Overhaul (Phases 84-89) — SHIPPED 2026-04-21</summary>

- [x] Phase 84: Schema Parsing & Policy Infrastructure (3/3 plans) — completed 2026-04-20
- [x] Phase 85: Reconciliation Engine (5/5 plans) — completed 2026-04-20
- [x] Phase 86: Record Tool Integration & Pending Review (5/5 plans) — completed 2026-04-21
- [x] Phase 87: Scanner Modifications & Frontmatter Sync (3/3 plans) — completed 2026-04-21
- [x] Phase 88: Legacy Infrastructure Removal (6/6 plans) — completed 2026-04-21
- [x] Phase 89: Test Helper & Existing Test Updates (4/4 plans) — completed 2026-04-21

Full phase details: [milestones/v2.8-ROADMAP.md](milestones/v2.8-ROADMAP.md)

</details>

<details>
<summary>✅ Phase 90: Frontmatter Field Name Centralization — SHIPPED 2026-04-23</summary>

- [x] Phase 90: Centralize FM constants, rename fqc_* → fq_*, invert field ordering (7/7 plans) — completed 2026-04-23

</details>

### v2.9 Filesystem Primitive Tools (Phases 91-97)

- [x] **Phase 91: Shared Utilities** - Path-validation, file-size formatting, date-filter extraction, response-format additions (completed 2026-04-24)
- [x] **Phase 92: `create_directory` Handler** - New files.ts module with create_directory, wired into server.ts, directed scenario tests (completed 2026-04-24)
- [ ] **Phase 93: `list_vault` Handler** - Add list_vault to files.ts, unit tests, directed scenario tests
- [ ] **Phase 94: Migration and Cleanup** - remove_directory migrated, list_files removed, test_list_files.py updated
- [ ] **Phase 95: Integration Tests** - IF-01 through IF-16 cross-tool workflow tests
- [ ] **Phase 96: Coverage Matrix Updates** - DIRECTED_COVERAGE.md and INTEGRATION_COVERAGE.md updated
- [ ] **Phase 97: Plugin Updates** - fq-base and fq-skill-creator updated for list_vault and create_directory

## Phase Details

### Phase 90: Centralize frontmatter field names into FM constants and rename fqc_ prefix fields to fq_

**Goal**: Create a single TypeScript constants file (FM object) as the source of truth for all 9 FlashQuery frontmatter field names, rename all fqc_* and bare-name fields to fq_* equivalents across 8 TS source files, 4 TS test files, and 14 Python test files, and invert frontmatter field ordering so user-defined fields appear before FQ-managed fields.
**Requirements**: NEW-01, NEW-02, ORD-01, ORD-02, ORD-03, ORD-04, REF-01, REF-02, REF-03, REF-04
**Depends on:** Phase 89
**Plans:** 7/7 plans complete

Plans:
- [x] 90-01-PLAN.md — FM constants file + test stubs (Wave 1: RED/GREEN canary; RED ordering stubs)
- [x] 90-02-PLAN.md — frontmatter-sanitizer, frontmatter.ts, vault.ts, plugin-reconciliation, resolve-document (Wave 2)
- [x] 90-03-PLAN.md — scanner.ts — 10+ frontmatter key locations (Wave 2, parallel with 02 and 04)
- [x] 90-04-PLAN.md — documents.ts + compound.ts — 25+ total locations (Wave 2, parallel with 02 and 03)
- [x] 90-05-PLAN.md — TypeScript test updates + Python test framework + 14 Python files (Wave 3)
- [x] 90-06-PLAN.md — Gap closure: resolve-document.ts targetedScan + path-reconciliation raw strings (Wave 1, gap)
- [x] 90-07-PLAN.md — Gap closure: test mock YAML strings + data.title + error message strings (Wave 2, gap)

---

### Phase 91: Shared Utilities

**Goal**: All shared utility functions that create_directory and list_vault depend on are built, tested, and ready for import — zero implementation debt carried into later phases.
**Depends on**: Phase 90
**Requirements**: REFAC-03, REFAC-04, TEST-01, TEST-02, TEST-03
**Success Criteria** (what must be TRUE):
  1. All utility files compile cleanly with zero TypeScript errors (path-validation.ts, format-file-size.ts, date-filter.ts, response-formats.ts additions)
  2. All U-01 through U-33 (path validation), U-44 through U-53 (file size), and date-filter unit tests pass
  3. parseDateFilter("garbage") returns null, not NaN — the pre-existing bug is fixed in the extracted version
  4. No regressions in the existing test suite (all previously passing tests still pass)
**Plans:** 2/2 plans complete

Plans:
- [x] 91-01-PLAN.md — path-validation.ts (validateVaultPath, normalizePath, joinWithRoot, sanitizeDirectorySegment, validateSegment) + U-01 through U-33 tests (Wave 1)
- [x] 91-02-PLAN.md — format-file-size.ts + date-filter.ts + response-formats.ts additions + U-44..U-53, date-filter tests, U-59..U-65 (Wave 1, parallel with 01)

---

### Phase 92: `create_directory` Handler

**Goal**: AI agents can create vault directories via the create_directory MCP tool, with path validation, sanitization, batch support, partial-success behavior, and idempotency.
**Depends on**: Phase 91
**Requirements**: DIR-01, DIR-02, DIR-03, DIR-04, DIR-05, DIR-06, DIR-07, DIR-08, DIR-09, DIR-10, TEST-04
**Success Criteria** (what must be TRUE):
  1. create_directory tool is registered and callable via MCP with the correct Zod input schema
  2. All F-19 through F-52 directed scenario tests pass (single, deep hierarchy, batch, root_path, normalization, sanitization, rejection, special cases)
  3. Batch calls return partial success — valid paths are created even when some paths in the same call fail; isError is false when at least one path succeeded
  4. Calling create_directory on an existing directory returns success (idempotent, not an error)
  5. No regressions in the existing test suite (TEST-08)
**Plans**: TBD
**UI hint**: no

---

### Phase 93: `list_vault` Handler

**Goal**: AI agents can browse vault contents via the list_vault MCP tool, with show modes, output formats, recursive listing, extension and date filtering, DB-enriched metadata, real file sizes, and correct sort order.
**Depends on**: Phase 92
**Requirements**: LIST-01, LIST-02, LIST-03, LIST-04, LIST-05, LIST-06, LIST-07, LIST-08, LIST-09, LIST-10, LIST-11, LIST-12, LIST-13, TEST-05
**Success Criteria** (what must be TRUE):
  1. list_vault tool is registered and callable via MCP; calling it with zero parameters returns a markdown table of vault root contents
  2. All F-08 through F-11 and F-53 through F-97 directed scenario tests pass (show modes, format modes, param validation, filesystem resilience)
  3. Calling list_vault on a non-existent path returns isError: true (behavior change from old list_files)
  4. Tracked files return DB-enriched metadata (title, tags, fqc_id, status, DB timestamps); untracked files are marked as such
  5. No regressions in the existing test suite (TEST-08)
**Plans:** 2 plans

Plans:
- [ ] 93-01-PLAN.md — list_vault unit tests (U-34..U-43, U-54..U-58, U-66..U-69) + handler implementation in files.ts (Wave 1, TDD)
- [ ] 93-02-PLAN.md — 7 directed scenario test files (F-08..F-11, F-53..F-97) + F-51 un-skip (Wave 2)

---

### Phase 94: Migration and Cleanup

**Goal**: The codebase is structurally clean — remove_directory lives in files.ts alongside the other filesystem primitives, list_files no longer exists anywhere, and all test references are updated.
**Depends on**: Phase 93
**Requirements**: REFAC-01, REFAC-02
**Success Criteria** (what must be TRUE):
  1. remove_directory is callable via MCP from its new location in files.ts and all existing remove_directory tests (F-12 through F-15) still pass
  2. list_files no longer exists as a registered MCP tool; any test calling list_files by name has been updated or removed
  3. parseDateFilter is removed from compound.ts (extracted in Phase 91); no duplicate definition exists
  4. All test suite tests that were passing before this phase continue to pass after it
**Plans**: TBD

---

### Phase 95: Integration Tests

**Goal**: All cross-tool workflows combining create_directory and list_vault with other FlashQuery tools are validated end-to-end.
**Depends on**: Phase 94
**Requirements**: TEST-06
**Success Criteria** (what must be TRUE):
  1. All IF-01 through IF-16 integration scenario tests pass
  2. Create → list → remove directory lifecycle tests pass (IF-05, IF-06)
  3. Plugin initialization scaffold workflow test passes (IF-13, IF-14)
  4. No regressions in the existing test suite (TEST-08)
**Plans**: TBD

---

### Phase 96: Coverage Matrix Updates

**Goal**: The test coverage documentation accurately reflects all new directed and integration test IDs introduced in this milestone.
**Depends on**: Phase 95
**Requirements**: TEST-07
**Success Criteria** (what must be TRUE):
  1. DIRECTED_COVERAGE.md is updated with F-19 through F-97 entries and F-08 through F-11 references updated from test_list_files to test_list_vault
  2. INTEGRATION_COVERAGE.md is updated with IF-01 through IF-16 entries in a new "IF — Filesystem Composition" section
  3. Coverage summary totals in both documents are accurate and consistent with the actual test files
**Plans**: TBD

---

### Phase 97: Plugin Updates

**Goal**: The fq-base and fq-skill-creator plugins fully reflect the new list_vault tool and create_directory tool — no stale list_files references remain, all parameter names are current, and create_directory is documented.
**Depends on**: Phase 94
**Requirements**: PLUG-01, PLUG-02, PLUG-03, PLUG-04, PLUG-05
**Success Criteria** (what must be TRUE):
  1. grep -r "list_files" in fq-base/ and fq-skill-creator/ returns zero results
  2. grep -r "date_from\|date_to" in the plugin directories returns zero results (old parameter names eliminated)
  3. create_directory is documented in fq-base README.md, vault-maintenance.md, and fq-skill-creator flashquery-tools.md
  4. file-browse.md fully reflects the list_vault parameter surface (show, format, extensions as array, after/before, date_field, limit)
**Plans**: TBD

---

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|---------------|--------|-----------|
| 84. Schema Parsing & Policy Infrastructure | v2.8 | 3/3 | Complete | 2026-04-20 |
| 85. Reconciliation Engine | v2.8 | 5/5 | Complete | 2026-04-20 |
| 86. Record Tool Integration & Pending Review | v2.8 | 5/5 | Complete | 2026-04-21 |
| 87. Scanner Modifications & Frontmatter Sync | v2.8 | 3/3 | Complete | 2026-04-21 |
| 88. Legacy Infrastructure Removal | v2.8 | 6/6 | Complete | 2026-04-21 |
| 89. Test Helper & Existing Test Updates | v2.8 | 4/4 | Complete | 2026-04-21 |
| 90. Frontmatter Field Name Centralization | v2.9 pre | 7/7 | Complete | 2026-04-23 |
| 91. Shared Utilities | v2.9 | 2/2 | Complete    | 2026-04-24 |
| 92. create_directory Handler | v2.9 | 1/1 | Complete    | 2026-04-24 |
| 93. list_vault Handler | v2.9 | 0/2 | Not started | - |
| 94. Migration and Cleanup | v2.9 | 0/? | Not started | - |
| 95. Integration Tests | v2.9 | 0/? | Not started | - |
| 96. Coverage Matrix Updates | v2.9 | 0/? | Not started | - |
| 97. Plugin Updates | v2.9 | 0/? | Not started | - |

## Archive: Completed Milestones v1-v2.7

**For detailed information about completed milestones:**
- v2.8: [milestones/v2.8-ROADMAP.md](milestones/v2.8-ROADMAP.md) — Phases 84-89 detail
- v2.5 + v2.5.1: [milestones/v2.5-ROADMAP.md](milestones/v2.5-ROADMAP.md) — Phases 61-68 + 69-71 detail
- v2.4: [milestones/v2.4-ROADMAP.md](milestones/v2.4-ROADMAP.md) — Phases 54-60b detail
- v2.2: [milestones/v2.2-ROADMAP.md](milestones/v2.2-ROADMAP.md) — Phases 45-48 detail
- v1-v2.1: See milestones/ directory for complete historical records

**Roadmap structure:** Completed milestones are archived to keep the main ROADMAP lean and current.

---

*Last updated: 2026-04-24 — Phase 93 plans finalized (2 plans, Wave 1 + Wave 2 sequential)*
