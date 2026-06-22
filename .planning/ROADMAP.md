# Roadmap: FlashQuery Core

## Milestones

- [x] **v4.2 JSON Validation** - Phase 170 (shipped 2026-06-22)
- [x] **v4.1 Embedding Chunks Migration** - Phases 168-169 (shipped 2026-06-15)

## Current Milestone

No active milestone. Start the next milestone with `$gsd-new-milestone`.

## Archived Milestone Details

- [v4.2 ROADMAP archive](milestones/v4.2-ROADMAP.md)
- [v4.2 REQUIREMENTS archive](milestones/v4.2-REQUIREMENTS.md)
- [v4.2 milestone audit](milestones/v4.2-MILESTONE-AUDIT.md)
- [v4.2 phase artifacts](milestones/v4.2-phases/)
- [v4.1 ROADMAP archive](milestones/v4.1-ROADMAP.md)
- [v4.1 REQUIREMENTS archive](milestones/v4.1-REQUIREMENTS.md)
- [v4.1 milestone audit](milestones/v4.1-MILESTONE-AUDIT.md)
- [v4.0 ROADMAP archive](milestones/v4.0-ROADMAP.md)
- [v4.0 REQUIREMENTS archive](milestones/v4.0-REQUIREMENTS.md)
- [v4.0 milestone audit](milestones/v4.0-MILESTONE-AUDIT.md)

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 170. JSON Validation and Repair Infrastructure | v4.2 | 4/4 | Complete | 2026-06-22 |
| 169. Lifecycle, Search, and Deployment Verification | v4.1 | 3/3 | Complete | 2026-06-15 |
| 168. Chunking Foundation and Write Pipeline | v4.1 | 4/4 | Complete | 2026-06-14 |

## Carried Tech Debt

- v4.0 accepted tech debt remains tracked: lifecycle abort marks a job aborted immediately and releases the status-based running lock before worker checkpoint return is externally proven.
- v4.1 documented v1 deferrals: `matched_chunks[].span_start`/`span_end` ship as always-null placeholders; operator-configurable `max_heading_level` deferred.

---
*Last updated: 2026-06-22 after archiving v4.2 JSON Validation*
