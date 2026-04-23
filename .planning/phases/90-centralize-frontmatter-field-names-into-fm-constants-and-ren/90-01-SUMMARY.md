---
phase: 90-centralize-frontmatter-field-names-into-fm-constants-and-ren
plan: "01"
subsystem: constants
tags: [constants, frontmatter, tdd, fm-fields]
dependency_graph:
  requires: []
  provides:
    - src/constants/frontmatter-fields.ts
    - tests/unit/frontmatter-fields.test.ts
    - tests/integration/frontmatter-ordering.integration.test.ts
  affects:
    - All Wave 2 plans (90-02 through 90-05) import FM from this module
tech_stack:
  added: []
  patterns:
    - "as const for compile-time narrow string literal inference"
    - "TDD RED/GREEN cycle for constants canary"
key_files:
  created:
    - src/constants/frontmatter-fields.ts
    - tests/unit/frontmatter-fields.test.ts
    - tests/integration/frontmatter-ordering.integration.test.ts
  modified: []
decisions:
  - "Use `as const` (not Object.freeze) so TypeScript infers FrontmatterFieldName as a union of narrow string literals — required by resolve-document.ts type narrowing"
  - "FM object key order is semantically significant — matches preferred vault write order (TITLE first, ID last)"
  - "Integration ordering tests are intentionally RED in Wave 1; Wave 2 source rewrites (Plans 02-04) turn them GREEN"
metrics:
  duration: "~3 minutes"
  completed: "2026-04-23"
  tasks_completed: 2
  files_created: 3
  files_modified: 0
---

# Phase 90 Plan 01: FM Constants File and Ordering Test Stubs Summary

FM constants module created as single source of truth for all 9 FlashQuery-managed frontmatter field names (`fq_title` through `fq_id`) using `as const` for TypeScript narrow literal inference; canary unit tests GREEN, integration ordering test stubs RED as expected for Wave 1.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | FM constants file (TDD RED then GREEN) | 25d0a4e | src/constants/frontmatter-fields.ts, tests/unit/frontmatter-fields.test.ts |
| 2 | Integration ordering test stubs (RED) | 0c33e1e | tests/integration/frontmatter-ordering.integration.test.ts |

## Verification Results

- `src/constants/frontmatter-fields.ts` — exports `FM` object (`as const`) and `FrontmatterFieldName` type
- `grep "as const" src/constants/frontmatter-fields.ts` — shows `} as const;` (no Object.freeze)
- `grep "fq_id" src/constants/frontmatter-fields.ts` — shows `ID: 'fq_id'`
- `npm test -- tests/unit/frontmatter-fields.test.ts` — 2/2 passing (GREEN)
- `tests/integration/frontmatter-ordering.integration.test.ts` — 4 describe blocks present (ORD-01 through ORD-04), 4/4 failing as expected (RED — Wave 2 source rewrites will turn them GREEN)

## TDD Gate Compliance

RED gate: test commit `0c33e1e` (Task 2 stub) — integration tests confirmed failing before source rewrites.
GREEN gate: feat commit `25d0a4e` — FM constants created, unit canary tests passing (2/2).

Note: The TDD cycle here was:
1. Task 1 — full RED/GREEN for unit canary (module not found → 2/2 passing)
2. Task 2 — integration stubs written in RED state by design; GREEN will land in Wave 2

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

The integration tests in `tests/integration/frontmatter-ordering.integration.test.ts` are intentional stubs. They will remain RED until Wave 2 (Plans 02-04) renames field strings from `title`/`fqc_id`/etc. to `fq_title`/`fq_id`/etc. and inverts ordering in `frontmatter-sanitizer.ts`. This RED state is documented in the plan and is not a defect.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The constants file is a read-only import — no runtime mutation possible with `as const`. Threat T-90-01 (Tampering) accepted per plan threat model.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/constants/frontmatter-fields.ts | FOUND |
| tests/unit/frontmatter-fields.test.ts | FOUND |
| tests/integration/frontmatter-ordering.integration.test.ts | FOUND |
| Commit 25d0a4e (feat) | FOUND |
| Commit 0c33e1e (test) | FOUND |
