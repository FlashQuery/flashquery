# Phase 138: Handler, Source Resolution, Scenario Closure - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning
**Source:** User-provided Macro Language requirements and test plan

<domain>
## Phase Boundary

Phase 138 finishes the public `call_macro` surface by replacing the temporary `source_ref` unsupported path with production source resolution, source exclusivity validation, named-block extraction, full handler execution, integration/E2E/scenario coverage, and migrated POC fixture validation.

This phase owns `.planning/REQUIREMENTS.md` rows:
- `MACRO-SRC-01`: `call_macro` accepts the production request schema with `source`, `source_ref`, `input_vars`, `budget`, `dry_run`, `trace`, and `progress`.
- `MACRO-SRC-02`: `call_macro` validates exactly one non-empty macro source and returns canonical `invalid_input` details for invalid combinations.
- `MACRO-SRC-03`: `source_ref` resolves through the same document resolver used by FlashQuery document reads.
- `MACRO-SRC-04`: Archived macro-library documents resolve as `not_found` for `source_ref`.
- `MACRO-INT-02`: Macro-executed writes inherit FlashQuery's existing write-lock table behavior.

</domain>

<decisions>
## Implementation Decisions

### Locked Source Documents
- Downstream research, planning, execution, verification, and review agents MUST read the Macro Language Requirements document and Macro Language Test Plan before making Phase 138 decisions.
- Treat those documents as the canonical source for requirement details, test IDs, handler error envelopes, source_ref behavior, write-lock inheritance, scenario coverage, and POC fixture expectations.
- If local `.planning/REQUIREMENTS.md` or `.planning/ROADMAP.md` is less specific, prefer the Macro Language Requirements and Test Plan unless the user explicitly overrides them.

### Phase 138 Scope
- Keep the existing `callMacroInputSchema` production fields, and add tests proving the schema accepts only the documented fields and applies defaults.
- Replace the current `source_ref_not_implemented` branch in `src/mcp/tools/macro.ts` with real resolution.
- Validate `source`/`source_ref` exclusivity before parse/evaluation: both populated, neither populated, `source: ""`, `source_ref: ""`, `source_ref: "::name"`, invalid reference format, and invalid block name must return the canonical `invalid_input` reason.
- Resolve `source_ref` through `resolveDocumentIdentifier` or the same document-output resolver path used by `fq.get_document`; do not introduce a parallel resolver.
- Treat archived macro-library documents as `not_found`, matching the Macro Language Requirements.
- Reuse `splitMacroSourceRef`, `extractMacroFences`, and `selectMacroSourceBlock`; do not duplicate named-block parsing in the handler.
- Preserve prior phase behavior: dry-run must not register tasks, task registry lifecycle remains per invocation/session, progress token capture remains intact, and all budget/trace/progress options must work identically for inline and `source_ref` requests.
- Prove macro-executed writes inherit tool-layer write locks with integration/scenario coverage rather than adding macro-specific locks.
- Execute or codify the 17 migrated POC examples under the production engine as fixture validation.

### Out of Scope
- No new macro language grammar, builtin, dispatch, trace/progress, budget, or task lifecycle semantics beyond what previous phases already implemented.
- No direct macro-to-macro nesting.
- No external MCP Tasks protocol surface.
- No browser or web UI.

### the agent's Discretion
- The exact source-ref helper boundary is implementation discretion, but it should remain small and testable, likely in `src/mcp/tools/macro.ts` plus `src/macro/source-ref.ts` / `src/macro/fence-extractor.ts`.
- Scenario fixture names and file organization may follow existing scenario conventions, but coverage IDs from the Test Plan must be represented.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Macro Language Contract
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Requirements.md` - Canonical macro specification. Phase 138 corresponds to Spec Phase 9 and REQ-001, REQ-002, REQ-003, REQ-004, and REQ-058.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Test Plan.md` - Canonical test inventory. Phase 138 must account for Test Plan section 4.9, section 4.10, and the POC fixture closure requirement.

### Local Planning State
- `.planning/ROADMAP.md` - Phase 138 goal, requirement mapping, and success criteria.
- `.planning/REQUIREMENTS.md` - Local v3.4 macro-support requirement tracking.
- `.planning/STATE.md` - Current milestone state and prior phase decisions.
- `.planning/phases/137-trace-progress-dry-run-budgets/137-05-SUMMARY.md` - Immediate predecessor handoff for handler/budget/progress completion.

### Code Surfaces
- `src/mcp/tools/macro.ts` - Public `call_macro` schema, handler, source execution path, progress token capture, and current temporary `source_ref_not_implemented` branch.
- `src/macro/source-ref.ts` - Source-ref splitting, block name validation, and named-block selection helpers.
- `src/macro/fence-extractor.ts` - Markdown `fqm` fence extraction.
- `src/mcp/utils/resolve-document.ts` - Standard FlashQuery document identifier resolver.
- `src/mcp/tools/documents.ts` - `get_document`, `archive_document`, and existing write-lock behavior.
- `tests/config/vitest.integration.config.ts` - Explicit integration include list.
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` and `tests/scenarios/integration/INTEGRATION_COVERAGE.md` - Scenario coverage matrices.

</canonical_refs>

<specifics>
## Specific Ideas

- Unit rows: `T-U-216` through `T-U-224`.
- Unit write-lock rows: `T-U-225` through `T-U-227` may already exist from Phase 130; Phase 138 must preserve them and add macro-level inheritance coverage if absent.
- Handler/tool metadata rows: `T-U-228` through `T-U-234` must remain green.
- Integration rows: `T-I-003` through `T-I-011`.
- E2E rows: `T-E-001` through `T-E-004`.
- Directed scenarios: `T-S-003` through `T-S-020`, with special attention to `T-S-004`, `T-S-005`, `T-S-019`, and `T-S-020` for source_ref/archive/write-lock closure. The live directed coverage matrix uses `ML-*` for macro-language rows; Phase 137 gap fixes consumed `ML-18`, `ML-19`, and `ML-20`, so Phase 138 should start at `ML-21` unless the matrix has advanced.
- YAML scenarios: `T-Y-001` through `T-Y-004`.
- The 17 POC examples from the Macro Language product docs are canonical fixture seeds; production validation may use copied/migrated fixtures in this repo rather than running from the product repo directly.

</specifics>

<deferred>
## Deferred Ideas

- POC differential tests remain optional per the Test Plan. Phase 138 must validate migrated examples execute, but it does not have to build AST/dry-run differential comparison unless that is the most efficient route.
- Real broker implementation, durable tasks, external cancellation APIs, macro masquerade, and starter template packaging remain outside macro v0.

</deferred>

---

*Phase: 138-handler-source-resolution-scenario-closure*
*Context gathered: 2026-05-15 via user-provided Macro Language requirements and test plan*
