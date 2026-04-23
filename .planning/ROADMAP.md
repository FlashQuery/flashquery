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

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|---------------|--------|-----------|
| 84. Schema Parsing & Policy Infrastructure | v2.8 | 3/3 | Complete | 2026-04-20 |
| 85. Reconciliation Engine | v2.8 | 5/5 | Complete | 2026-04-20 |
| 86. Record Tool Integration & Pending Review | v2.8 | 5/5 | Complete | 2026-04-21 |
| 87. Scanner Modifications & Frontmatter Sync | v2.8 | 3/3 | Complete | 2026-04-21 |
| 88. Legacy Infrastructure Removal | v2.8 | 6/6 | Complete | 2026-04-21 |
| 89. Test Helper & Existing Test Updates | v2.8 | 4/4 | Complete | 2026-04-21 |

## Archive: Completed Milestones v1-v2.7

**For detailed information about completed milestones:**
- v2.8: [milestones/v2.8-ROADMAP.md](milestones/v2.8-ROADMAP.md) — Phases 84-89 detail
- v2.5 + v2.5.1: [milestones/v2.5-ROADMAP.md](milestones/v2.5-ROADMAP.md) — Phases 61-68 + 69-71 detail
- v2.4: [milestones/v2.4-ROADMAP.md](milestones/v2.4-ROADMAP.md) — Phases 54-60b detail
- v2.2: [milestones/v2.2-ROADMAP.md](milestones/v2.2-ROADMAP.md) — Phases 45-48 detail
- v1-v2.1: See milestones/ directory for complete historical records

**Roadmap structure:** Completed milestones are archived to keep the main ROADMAP lean and current.

### Phase 90: Centralize frontmatter field names into FM constants and rename fqc_ prefix fields to fq_

**Goal:** Create a single TypeScript constants file (FM object) as the source of truth for all 9 FlashQuery frontmatter field names, rename all fqc_* and bare-name fields to fq_* equivalents across 8 TS source files, 4 TS test files, and 14 Python test files, and invert frontmatter field ordering so user-defined fields appear before FQ-managed fields.
**Requirements**: NEW-01, NEW-02, ORD-01, ORD-02, ORD-03, ORD-04, REF-01, REF-02, REF-03, REF-04
**Depends on:** Phase 89
**Plans:** 7 plans (5 original + 2 gap-closure)

Plans:
- [ ] 90-01-PLAN.md — FM constants file + test stubs (Wave 1: RED/GREEN canary; RED ordering stubs)
- [ ] 90-02-PLAN.md — frontmatter-sanitizer, frontmatter.ts, vault.ts, plugin-reconciliation, resolve-document (Wave 2)
- [ ] 90-03-PLAN.md — scanner.ts — 10+ frontmatter key locations (Wave 2, parallel with 02 and 04)
- [ ] 90-04-PLAN.md — documents.ts + compound.ts — 25+ total locations (Wave 2, parallel with 02 and 03)
- [ ] 90-05-PLAN.md — TypeScript test updates + Python test framework + 14 Python files (Wave 3)
- [x] 90-06-PLAN.md — Gap closure: resolve-document.ts targetedScan + path-reconciliation raw strings (Wave 1, gap)
- [x] 90-07-PLAN.md — Gap closure: test mock YAML strings + data.title + error message strings (Wave 2, gap)

---

*Last updated: 2026-04-23 — Phase 90 gap-closure plans 06-07 added*
