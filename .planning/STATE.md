---
gsd_state_version: 1.0
milestone: v2.6
milestone_name: — Test Infrastructure & Quality
status: planning
last_updated: "2026-04-20T21:10:17.761Z"
last_activity: 2026-04-20
progress:
  total_phases: 17
  completed_phases: 12
  total_plans: 33
  completed_plans: 36
  percent: 100
---

# FlashQuery Core — State

## Current Position

Phase: 999
Plan: Not started
Status: Ready to plan
Last activity: 2026-04-20

```
[                                        ] 0% — 0/6 phases
```

## Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260415-cleanup-consolidate | Consolidate CLEANUP.md info into README.md and add verification to cleanup script | 2026-04-15 | d142f1a | [260415-cleanup-consolidate](./quick/260415-cleanup-consolidate/) |

## Accumulated Context

### Milestone v2.8 Initialization (2026-04-20)

**Milestone:** Plugin Callback Overhaul — replace push-based plugin callbacks with reconcile-on-read pattern.

**Phase structure:**

| Phase | Name | Requirements |
|-------|------|-------------|
| 84 | Schema Parsing & Policy Infrastructure | SCHEMA-01 through SCHEMA-06 (6 reqs) |
| 85 | Reconciliation Engine | RECON-01 through RECON-08 (8 reqs) |
| 86 | Record Tool Integration & Pending Review | RECTOOLS-01 through RECTOOLS-09 (9 reqs) |
| 87 | Scanner Modifications & Frontmatter Sync | SCANNER-01 through SCANNER-04 (4 reqs) |
| 88 | Legacy Infrastructure Removal | LEGACY-01 through LEGACY-07 (7 reqs) |
| 89 | Test Helper & Existing Test Updates | TEST-01 through TEST-17 (17 reqs) |

**Dependencies:**

- Phase 84: no dependencies (foundation)
- Phase 85: depends on Phase 84
- Phase 86: depends on Phases 84 + 85
- Phase 87: depends on Phases 84 + 85 (parallel with Phase 86)
- Phase 88: depends on Phases 85, 86, 87
- Phase 89: depends on all previous phases

**Key architectural decisions for this milestone:**

- `ParsedPluginSchema` interface → `DocumentTypePolicy` (updated name)
- `atomicWriteFrontmatter()` extracted to `src/utils/frontmatter.ts` before legacy deletion
- `fqc_change_queue` table dropped via `ALTER TABLE IF EXISTS` migration
- Staleness cache threshold: 30 seconds (hardcoded, configurable in future)
- `access: read-only` is a warning guardrail only — hard enforcement deferred post-v2.8
- `flashquery discover` CLI command removed without replacement

**Test suite baseline going into v2.8 (2026-04-15 post-v2.7):**

- Phase 83 (FQC Name Change) completed 2026-04-16
- Last known passing baseline: ~1117 unit / 323 integration / 40 E2E

### Phase Numbering

v2.7 ended at Phase 83. v2.8 runs Phases 84-89.

### Known Issues Going Into v2.8

None recorded. Baseline from v2.7 is production-ready.
