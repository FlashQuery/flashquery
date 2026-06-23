# Phase 171: Graph Foundation, Schema, and Vocabulary - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning
**Source:** User-provided requirements and test plan

<domain>
## Phase Boundary

Phase 171 implements the foundation slice of v4.3 Graph Document Intelligence: optional graph configuration, graph schema, relation vocabulary, prompt sidecars, namespaced graph template variables, and edge metadata contracts. It covers source requirements phase 1 only.

This phase must establish graph foundations without implementing structural graph writes, public graph read surfaces, Tier 2 similarity candidate persistence, or Tier 3 LLM classification. Phase 172 owns Tier 1 structural graph and read surfaces. Phase 173 owns async classification, pending worker hardening, lifecycle completion, lint/community workflows, scenario hardening, and full end-to-end graph maintenance.

</domain>

<decisions>
## Implementation Decisions

### Source of Truth
- Downstream agents MUST read the product requirements document before making implementation decisions:
  `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Graph Document Intelligence (Jun 2026)/Graph-Enhanced-Document-Intelligence Requirements.md`
- Downstream agents MUST read the product test plan before designing verification:
  `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Graph Document Intelligence (Jun 2026)/Graph-Enhanced-Document-Intelligence Test Plan.md`
- If the roadmap, local `.planning/REQUIREMENTS.md`, and product docs differ, use the two product docs above first, then `.planning/ROADMAP.md` and `.planning/REQUIREMENTS.md` for GSD phase mapping.

### Scope Locks
- Implement requirements mapped to Phase 171: `GR-001`, `GR-002`, `GR-003`, `GR-004`, `GR-005`, `GR-007`, and `GR-008`.
- Treat source Test Plan section `4.1` as the required verification surface for this phase.
- Preserve disabled-by-default behavior: when `graph:` is absent or `graph.enabled:false`, existing write, scan, search, and get-document behavior must not drift.
- Add schema support for chunk-keyed graph nodes using existing `fqc_chunks.id`, but do not implement structural graph writes in this phase.
- Do not persist semantic-similarity topology.
- Do not add graph read surfaces in this phase. FlashQuery remains MCP/CLI-only; do not build a web UI or server-side session state.

### the agent's Discretion
- Choose the exact internal module boundaries, helper names, and plan slicing that best fit the current codebase.
- Decide whether graph tables are always present or only required under enabled graph mode, as long as disabled behavior is unchanged and schema verification follows the product requirements.
- Choose exact internal module boundaries, helper names, and plan slicing that best fit the foundation codebase.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product Requirements and Tests
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Graph Document Intelligence (Jun 2026)/Graph-Enhanced-Document-Intelligence Requirements.md` - authoritative graph feature requirements and acceptance criteria.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Graph Document Intelligence (Jun 2026)/Graph-Enhanced-Document-Intelligence Test Plan.md` - authoritative test IDs, files, and layer strategy.

### GSD Phase Mapping
- `.planning/ROADMAP.md` - Phase 171 goal, requirement IDs, success criteria, and verification commands.
- `.planning/REQUIREMENTS.md` - compressed v4.3 requirement mapping from product requirements to GSD phases.
- `.planning/STATE.md` - project planning state and historical constraints.

### Codebase Anchors Named by the Product Requirements
- `src/config/loader.ts` - YAML config parsing and validation.
- `src/storage/supabase.ts` - idempotent DDL generation and RPC definitions.
- `src/storage/schema-verify.ts` - schema verification.
- `src/llm/reference-resolver.ts` - existing `{{ref:...}}` behavior and namespace expansion point.

</canonical_refs>

<specifics>
## Specific Ideas

- Plans should preserve test traceability by naming product test IDs where practical, especially for `graph-config`, `graph-vocabulary`, `graph-prompts`, `reference-resolver-namespaces`, `graph-relations`, `graph-edge-validation`, and `graph-schema`.
- Integration plans should cover `tests/integration/graph/graph-schema.test.ts` and `tests/integration/graph/namespaced-template-vars.test.ts`.
- Plans touching Supabase DDL must include a blocking schema verification/push step before final verification.

</specifics>

<deferred>
## Deferred Ideas

- Phase 172 owns requirements `GR-006`, `GR-009`, `GR-013A`, `GR-014A`, `GR-016A`, `GR-017`, `GR-018`, `GR-019`, `GR-020A`, and `GR-024A`.
- Phase 173 owns requirements `GR-010`, `GR-011`, `GR-012`, `GR-013B`, `GR-014B`, `GR-015`, `GR-016B`, `GR-020B`, `GR-021`, `GR-022`, `GR-023`, and `GR-024B`.
- Do not implement stable community identity, edge history/supersession chains, direct contradiction review lifecycle, user graph metadata editing, graph visualization UI, non-markdown graph processing, or scheduled autonomous research loops in this phase.

</deferred>

---

*Phase: 171-graph-foundation-schema-and-vocabulary*
*Context gathered: 2026-06-23 from user-provided product docs*
