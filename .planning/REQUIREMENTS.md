# Requirements: FlashQuery Core - v4.2 JSON Validation

**Defined:** 2026-06-22
**Core Value:** Any MCP-compatible AI can save and retrieve organized, persistent, searchable data the user owns - across tools, across sessions, with zero vendor lock-in.

## Source Documents

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Graph Document Intelligence (Jun 2026)/JSON Validation Requirements.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Graph Document Intelligence (Jun 2026)/JSON Validation Test Plan.md`

## v4.2 Requirements

### Shared Utility

- [x] **REQ-001**: FlashQuery adds `jsonrepair` as a runtime dependency in `dependencies`, with lockfile updates and ESM-compatible production build behavior.
- [x] **REQ-002**: User can call a stateless `src/llm/` `parseLlmJson<T>()` utility that repairs common LLM JSON defects, parses JSON, validates with a supplied Zod schema, and returns non-throwing typed success or failure metadata.
- [x] **REQ-003**: Retry-capable callers can distinguish syntax failures from schema failures and access machine-readable Zod issues plus concise human-readable summaries without the parser making LLM calls.
- [x] **REQ-011**: Repair metadata is internally testable through parser results while public success envelopes avoid broad new required top-level fields solely because repair occurred.

### High-Priority Parse Site Retrofits

- [x] **REQ-004**: Macro evaluator tool result payload parsing repairs JSON before fallback so repairable structured tool results and expected-error envelopes are available to downstream macro value/error handling.
- [x] **REQ-005**: Host template tool payload parsing repairs structured JSON, populates `structuredContent` for repairable `{ ok: ... }` payloads, marks repairable error payloads as `isError: true`, and treats irreparable JSON-like structured payloads as errors instead of silent success.
- [x] **REQ-006**: Macro task result parsing and task transition handling treat unreadable result envelopes as task failure, while valid or repairable success, cancellation, and expected-failure envelopes keep existing transitions.
- [x] **REQ-010**: User-visible parse failures introduced by this work use existing JSON response helpers and stable error envelopes with bounded debugging details.

### Compatibility Retrofits

- [x] **REQ-007**: Provider tool-call argument normalization repairs string arguments before parsing while preserving existing fail-loud behavior for irreparable JSON, non-object values, object arguments, and missing arguments.
- [x] **REQ-008**: Brokered external tool text coercion preserves `structuredContent` precedence and plain-prose fallback, repairs JSON-like text where possible, warns once on JSON-like fallback, and keeps `isError: true` fail-fast behavior.
- [x] **REQ-009**: Native FlashQuery tool response parsing remains behaviorally unchanged unless a separate failing test proves a real issue.

## Deferred Requirements

### Graph Intelligence

- **GRAPH-JSON-001**: Graph edge classification, key-claims extraction, node analysis, and contradiction-assessment schemas will use this shared parser when graph intelligence is implemented.
- **GRAPH-JSON-002**: Higher-order LLM retry helpers with formatted schema feedback are deferred unless a current parse site can use them without broad call-flow changes.
- **GRAPH-JSON-003**: Dead-letter persistence for future async LLM queues is deferred because v4.2 has no queue table.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Graph intelligence parse sites | Explicitly deferred to graph implementation; this milestone only prepares reusable infrastructure and current parse-site retrofits. |
| Web UI, review surface, or operator dashboard | FlashQuery remains CLI + MCP only for this milestone. |
| Database schema, migration, or Supabase table changes | JSON validation is a code/test reliability layer only. |
| Global replacement of every `JSON.parse()` | Scope is limited to named LLM-originated or LLM-adjacent parse sites. |
| `src/macro/registry.ts` strictness changes | Native FlashQuery tool responses are app-controlled and valid by construction; behavior must remain unchanged. |
| Automatic LLM retry for all existing parse sites | Retry policy remains caller-controlled and is future work unless a current caller already has safe retry context. |

## Execution Constraint

This milestone must execute in one GSD phase. Inside that phase, implementation must proceed inline and test-first: write the focused test for a behavior, run it and confirm the expected failure, implement the minimal code, rerun the focused test to confirm it passes, then move to the next behavior slice.

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| REQ-001 | Phase 170 | Complete |
| REQ-002 | Phase 170 | Complete |
| REQ-003 | Phase 170 | Complete |
| REQ-004 | Phase 170 | Complete |
| REQ-005 | Phase 170 | Complete |
| REQ-006 | Phase 170 | Complete |
| REQ-007 | Phase 170 | Complete |
| REQ-008 | Phase 170 | Complete |
| REQ-009 | Phase 170 | Complete |
| REQ-010 | Phase 170 | Complete |
| REQ-011 | Phase 170 | Complete |

**Coverage:**
- v4.2 requirements: 11 total
- Mapped to phases: 11
- Unmapped: 0

---
*Requirements defined: 2026-06-22*
*Last updated: 2026-06-22 after initial definition*
