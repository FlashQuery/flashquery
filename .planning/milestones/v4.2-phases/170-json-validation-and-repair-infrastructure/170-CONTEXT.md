# Phase 170: JSON Validation and Repair Infrastructure - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning
**Source:** User-provided requirements and test plan

<domain>
## Phase Boundary

Phase 170 implements the full JSON Validation milestone in one cohesive pass.
It adds a shared LLM JSON repair and validation utility, then retrofits the
current LLM-adjacent parse sites that silently degrade malformed structured
JSON into raw text or success states.

The phase must preserve FlashQuery's public response envelope conventions,
existing compatibility fallbacks, ESM module style, and MCP text-first response
shape.

Graph Intelligence-specific parse sites are out of scope. They may depend on
the new utility in a later phase, but this phase must not implement graph edge
classification, key-claims extraction, node analysis, or contradiction schemas.

</domain>

<decisions>
## Implementation Decisions

### Canonical Source Order
- D-01: Downstream planning, implementation, and verification agents MUST read the canonical Requirements and Test Plan documents listed in `<canonical_refs>` before asking questions or making implementation choices.
- D-02: If the repository, ROADMAP, or generated plans appear to conflict with the canonical Requirements/Test Plan, agents MUST treat the canonical docs as the source of truth and surface the conflict before changing scope.

### Shared Utility
- D-03: Add `jsonrepair` as a runtime dependency in `dependencies`, with lockfile changes.
- D-04: Implement a stateless `parseLlmJson<T>()` utility under `src/llm/`.
- D-05: The utility must repair with `jsonrepair`, parse with `JSON.parse()`, validate known schemas with Zod `safeParse()`, and return typed non-throwing success or failure results for ordinary syntax/schema failures.
- D-06: Utility success results must include `ok: true`, `data`, `raw`, and `repaired`; failures must include `ok: false`, `raw`, `repaired`, `failure: 'syntax' | 'schema'`, optional machine-readable Zod issues, and concise summary text.
- D-07: The utility must not import from `src/macro/` or `src/mcp/`, make LLM calls, mutate global state, write files, or own retry policy.

### High-Priority Retrofits
- D-08: `src/macro/evaluator.ts` `parseToolResultPayload()` must repair structured tool-result text before fallback while preserving trace, warning, budget, and token extraction behavior.
- D-09: `src/mcp/host-template-tools.ts` `parseTemplateToolPayload()` must repair structured payloads, populate `structuredContent`, set `isError: true` for `{ ok: false }`, and surface irreparable JSON-like structured payloads as errors.
- D-10: `src/mcp/tools/macro.ts` `parseResultPayload()` and task transition handling must fail unreadable result envelopes instead of marking tasks complete.
- D-11: User-visible structured parse failures introduced by this phase must use existing response helpers such as `jsonExpectedError()` or `jsonRuntimeError()` where practical, with bounded details.

### Compatibility Retrofits
- D-12: `src/llm/client.ts` `normalizeToolCallArguments()` must repair string arguments before the existing fail-loud invalid-argument path, while still rejecting irreparable strings and non-object values.
- D-13: `src/macro/coerce.ts` `coerceCallToolResult()` must keep `structuredContent` precedence, preserve plain prose fallback without warning, repair JSON-like text when possible, warn once through `logger.warn()` on JSON-like fallback, and keep `isError: true` fail-fast behavior.
- D-14: `src/macro/registry.ts` `parseNativeToolResponse()` is intentionally out of scope and must remain behaviorally unchanged unless a separate failing test proves a real issue.

### Testing and Cadence
- D-15: Implementation must follow the roadmap's inline TDD cadence for each behavior slice: write/extend one focused test, observe RED, implement the smallest change, rerun to GREEN, then refactor or continue.
- D-16: Unit coverage must include valid JSON, repairable malformed JSON, smart quotes, truncated JSON, missing brackets, schema-free parsing, schema failures, syntax failures, `jsonrepair()` throw handling, and repair metadata.
- D-17: Retrofit coverage must include macro evaluator, host-template tools, macro task results, provider tool-call normalization, brokered tool coercion, and native tool response unchanged regression tests.
- D-18: Public or near-public coverage must prove at least one repaired macro/host-template flow and at least one irreparable structured-channel failure.

### the agent's Discretion
- D-19: Exact exported type names for parse results are flexible if the semantics from D-06 are preserved.
- D-20: Agents may introduce a small conservative JSON-like text helper or local predicate for REQ-005 and REQ-008 if it reduces duplication.
- D-21: Agents may choose whether public workflow verification uses directed scenarios, YAML integration scenarios, or both, but any added scenario coverage must update the corresponding coverage matrices.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing. Ask questions only after these files have been consulted.**

### Requirements and Test Source of Truth
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Graph Document Intelligence (Jun 2026)/JSON Validation Requirements.md` - locked product requirements, codebase context, invariants, contracts, and phasing for REQ-001 through REQ-011.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Graph Document Intelligence (Jun 2026)/JSON Validation Test Plan.md` - locked test cases, coverage matrix, coverage IDs, and expected verification layers.

### Local Project Planning
- `.planning/ROADMAP.md` - Phase 170 goal, requirement mapping, success criteria, required verification commands, and inline TDD cadence.
- `.planning/REQUIREMENTS.md` - milestone requirements registry referenced by GSD gates.
- `.planning/STATE.md` - current project planning state and execution history.
- `AGENTS.md` - FlashQuery project conventions and build/test instructions.

</canonical_refs>

<specifics>
## Specific Ideas

- The planner should prefer multiple focused plans matching the source phasing: utility foundation, high-priority silent-failure retrofits, compatibility retrofits, and public workflow verification.
- Every implementation plan must carry the relevant REQ IDs in frontmatter and include concrete test IDs from the Test Plan in task acceptance criteria.
- Every implementation task must list the canonical Requirements and Test Plan docs in `<read_first>` when behavior scope or test expectations are being interpreted.
- Required final verification includes focused unit commands for parser and retrofit test files, integration commands for macro and host-template repair flows, E2E command for template tools, applicable scenario commands, `npm run typecheck`, and `npm run build`.

</specifics>

<deferred>
## Deferred Ideas

- Graph edge classification, key-claims extraction, node analysis, contradiction assessment, and graph-specific schemas are deferred to the Graph Intelligence implementation.
- Higher-order LLM retry helpers and dead-letter persistence are deferred unless a current Phase 170 call site can use them without broad flow changes.
- Web UI, review surfaces, dashboards, database schema changes, and global replacement of every `JSON.parse()` are out of scope.

</deferred>

---

*Phase: 170-json-validation-and-repair-infrastructure*
*Context gathered: 2026-06-22 from canonical requirements and test plan*
