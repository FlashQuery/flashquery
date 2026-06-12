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
- ✅ **v2.4 Plugin Discovery & Document Interoperability** — Phases 54-60b + code review (shipped 2026-04-12)
- ✅ **v2.5 New MCP Document Tools** — Phases 61-68 (shipped 2026-04-13)
- ✅ **v2.5.1 Gap Closure & Test Maintenance** — Phases 69-71 (shipped 2026-04-14)
- ✅ **v2.6 Test Infrastructure & Quality** — Phases 72-80 (shipped 2026-04-15)
- ✅ **v2.7 Name Change & Pre-Launch Preparation** — Phase 83 (shipped 2026-04-16)
- ✅ **v2.8 Plugin Callback Overhaul** — Phases 84-89 (shipped 2026-04-21)
- ✅ **v2.9 Filesystem Primitive Tools** — Phases 90-97 (shipped 2026-04-25)
- ✅ **v3.0 Native LLM Access** — Phases 98-106 (shipped 2026-04-30)
- ✅ **v3.1 Call Model With Reference** — Phases 107-111 (shipped 2026-05-05)
- ✅ **v3.2 Agentic LLM Tools** — Phases 112-120 (shipped 2026-05-07)
- ✅ **v3.3 MCP Tools Consolidation** — Phases 121-129 (shipped 2026-05-14)
- ✅ **v3.4 macro-support** — Phases 130-138 (shipped 2026-05-17)
- ✅ **v3.5 MCP Broker** — Phases 139-143 (shipped 2026-05-19)
- ✅ **v3.6 Bug Fixes & Host Parity** — Phase 144 (shipped 2026-05-24)
- ✅ **v3.7 Technical Debt** — Phases 145-150 (shipped 2026-05-25)
- ✅ **v3.8 Codebase Audit Remaining Remediation** — Phases 151-154 (shipped 2026-05-26)
- ✅ **v3.9 Vault Write Coherency Locking** — Phases 155-164 (shipped 2026-06-03)
- ✅ **v4.0 Embedding Management & Multi-Provider Support** — Phases 165-167 (shipped 2026-06-12)

## Current Milestone

Planning next milestone.

## Phases

<details>
<summary>✅ v4.0 Embedding Management & Multi-Provider Support (Phases 165-167) — SHIPPED 2026-06-12</summary>

- [x] **Phase 165: Foundation Infrastructure** — Catalog table + YAML config-sync; per-entry column sets + HNSW indexes + core-table RPCs + drift detection; stamping, length guard, heuristic removal.
- [x] **Phase 166: Embedding Pipeline** — Write path fan-out + pending queue; rate limiting + 429 backoff; search + RRF fusion; plugin-table integration.
- [x] **Phase 167: Lifecycle Operations and Validation** — `maintain_vault` lifecycle actions + concurrency; operator recipes integration validation.

Archive: [milestones/v4.0-ROADMAP.md](milestones/v4.0-ROADMAP.md) · [requirements](milestones/v4.0-REQUIREMENTS.md) · [audit](milestones/v4.0-MILESTONE-AUDIT.md)

</details>

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 165. Foundation Infrastructure | v4.0 | 3/3 | Complete | 2026-06-10 |
| 166. Embedding Pipeline | v4.0 | 4/4 | Complete | 2026-06-11 |
| 167. Lifecycle Operations and Validation | v4.0 | 7/7 | Complete | 2026-06-11 |

## Current Verification Notes

- v4.0 audit status: `tech_debt`; 43/43 requirements satisfied, 0 blockers, 0 broken flows.
- Accepted tech debt: lifecycle abort marks a job aborted immediately and releases the status-based running lock before worker checkpoint return is externally proven.
- Next milestone should start from fresh requirements via `$gsd-new-milestone`.

## Archived Milestone Details

- [v4.0 ROADMAP archive](milestones/v4.0-ROADMAP.md)
- [v4.0 REQUIREMENTS archive](milestones/v4.0-REQUIREMENTS.md)
- [v4.0 milestone audit](milestones/v4.0-MILESTONE-AUDIT.md)
- [v3.9 ROADMAP archive](milestones/v3.9-ROADMAP.md)
- [v3.9 REQUIREMENTS archive](milestones/v3.9-REQUIREMENTS.md)
- [v3.9 milestone audit](milestones/v3.9-MILESTONE-AUDIT.md)
- [v3.9 phase artifacts](milestones/v3.9-phases/)
- [v3.8 ROADMAP archive](milestones/v3.8-ROADMAP.md)
- [v3.8 REQUIREMENTS archive](milestones/v3.8-REQUIREMENTS.md)
- [v3.8 milestone audit](milestones/v3.8-MILESTONE-AUDIT.md)
- [v3.8 phase artifacts](milestones/v3.8-phases/)
- [v3.7 ROADMAP archive](milestones/v3.7-ROADMAP.md)
- [v3.7 REQUIREMENTS archive](milestones/v3.7-REQUIREMENTS.md)
- [v3.7 milestone audit](milestones/v3.7-MILESTONE-AUDIT.md)
