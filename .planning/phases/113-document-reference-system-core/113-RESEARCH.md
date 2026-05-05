# Phase 113: Document Reference System Core - Research

**Researched:** 2026-05-05 [VERIFIED: gsd-sdk init.phase-op 113]
**Domain:** `call_model` host-authored document reference parsing, resolution, hydration, and metadata [VERIFIED: .planning/phases/113-document-reference-system-core/113-CONTEXT.md]
**Confidence:** HIGH [VERIFIED: canonical product docs + codebase inspection + npm registry]

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### D-01 Canonical source docs
- Downstream planning, implementation, review, and verification agents MUST read the three canonical product docs listed in `<canonical_refs>` before making architecture, requirement, or test-coverage decisions for this phase.
- If `.planning/REQUIREMENTS.md` or `.planning/ROADMAP.md` appears less detailed than those product docs, the product docs are the deeper source of truth; the planning artifacts should map them into executable phase scope rather than re-litigating the requirements.

### D-02 Reference grammar
- `{{ref:...}}` is the only active placeholder prefix for ATL. Active and escaped `{{id:...}}` legacy support is removed during ATL and must be treated as literal text after removal.
- The v1 operators are section extraction (`#`), pointer dereference (`->`), and alias (`@` only as the first character after `{{ref:`). These operators are mutually exclusive where specified by the Document Reference System.
- Parser diagnostics must be stable and typed for invalid combinations, empty identifiers, empty alias keys, empty sections, empty pointers, and invalid whitespace around operators.

### D-03 Span scanner and escaping
- Implement placeholder detection with an explicit span-table scanner that classifies active and escaped placeholders before parsing or hydration.
- Escape parity is required: odd backslashes immediately before `{{ref:` escape the placeholder; even backslashes keep it active and preserve half the backslashes as literal text.
- Escaped placeholders are excluded from `injected_references` and `failed_references`, including escaped invalid placeholders such as `\{{ref:}}`.

### D-04 Identifier resolution and ambiguity
- Path, filename, and `fq_id` resolution must use the standard FlashQuery document identifier ladder.
- Bare filename/shorthand resolution must fail with `ambiguous_document_identifier` when multiple active documents match, and the detail must tell the caller to use a vault-relative path or `fq_id`.
- Ambiguity behavior must also inform follow-on implementation surfaces that reuse the same ladder, but this phase only needs to implement the Phase 113 host-authored reference scope.

### D-05 Typed failure taxonomy and metadata
- Failed references must expose stable `ReferenceFailureReason` codes and human-readable detail under `failed_references`.
- Existing document request/follow-ref errors should be mapped at the resolver boundary instead of leaking free-form internal messages as reason codes.
- Injected reference metadata must include resolved identity, content character counts, and enough detail for public directed scenarios to assert behavior through `call_model`.

### D-06 Hydration safety boundary
- Reference hydration is non-recursive. The resolver scans only host-authored input message content.
- Injected document/template content, assistant messages, model tool-call arguments, and tool-result messages containing literal `{{ref:...}}` must remain ordinary data and must not be hydrated by this phase.

### D-07 Tests are phase-local
- Phase 113 plans must include runnable unit, integration, and directed scenario coverage for parser edge cases, escape parity, ambiguous identifiers, typed failure reasons, metadata shape, public `call_model` behavior, and non-recursive hydration.
- The ATL Test Plan is mandatory planning input. Plans should name the relevant provisional ATL test IDs where useful and should update project coverage matrices when adding accepted scenario rows.

### the agent's Discretion
- Exact internal module/file names are at the implementation agent's discretion, but they should follow existing Phase 112 LLM/reference patterns and keep parser/scanner logic isolated enough for low-cost unit testing.
- The planner may split implementation across multiple plans/waves as needed, but every Phase 113 requirement ID must appear in at least one plan's requirements field.

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

- Full template parameter substitution is Phase 114 unless minimal scaffolding is needed for Phase 113 alias or failure metadata boundaries.
- Purpose bindings, model-visible tool registry, agent loop execution, template masquerade dispatch, discovery diagnostics, and cross-phase ATL validation are later phases.
- Mode 3 cooperative loop, MCP Broker support, audit document writes, response references, and path-scoped delegated writes remain out of scope for v3.2 unless the roadmap changes.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REF-01 | Host-authored `{{ref:...}}` placeholders support path, filename, and `fq_id` identifier resolution using the standard document identifier ladder. [VERIFIED: .planning/REQUIREMENTS.md] | Reuse `resolveDocumentIdentifier()` / `resolveAndBuildDocument()` but add ambiguity classification at the reference boundary. [VERIFIED: src/mcp/utils/resolve-document.ts; src/mcp/utils/document-output.ts] |
| REF-02 | Reference parser supports mutually exclusive section (`#`), pointer (`->`), and alias (`@`) operators with typed invalid-syntax diagnostics. [VERIFIED: .planning/REQUIREMENTS.md] | Replace the Phase 109 regex parser with a span scanner plus grammar parser that emits `invalid_reference_syntax` details before resolution. [VERIFIED: src/llm/reference-resolver.ts; CITED: Document Reference System §4.2-§4.3] |
| REF-03 | Reference scanner implements escape parity for `\{{ref:...}}` without resolving escaped placeholders or corrupting hydration spans. [VERIFIED: .planning/REQUIREMENTS.md] | Implement explicit active/escaped span tables; current implementation does not handle escape parity. [VERIFIED: src/llm/reference-resolver.ts; CITED: Document Reference System §4.5] |
| REF-04 | Bare filename/shorthand references fail with `ambiguous_document_identifier` when more than one active document matches. [VERIFIED: .planning/REQUIREMENTS.md] | Current resolver throws a human string for ambiguous filename; Phase 113 must map it to the typed reason and detail. [VERIFIED: src/mcp/utils/resolve-document.ts; tests/unit/resolve-document.test.ts] |
| REF-05 | `{{id:...}}` active and escaped legacy support is removed during the ATL release and treated as literal text. [VERIFIED: .planning/REQUIREMENTS.md] | Remove `id` from active parser recognition and keep `\{{id:...}}` literal without escape stripping. [VERIFIED: src/llm/reference-resolver.ts; CITED: ATL OQ-22/OQ-23] |
| REF-06 | Failed references return stable `ReferenceFailureReason` codes and human-readable detail under `failed_references`. [VERIFIED: .planning/REQUIREMENTS.md] | Add constants/runtime array and return `{ kind, ref, reason, detail }`; current failure shape uses free-form `reason`. [VERIFIED: src/llm/reference-resolver.ts; CITED: DRS §8.2] |
| REF-07 | Injected reference metadata includes resolved identity, content character counts, template usage details, and warnings where applicable. [VERIFIED: .planning/REQUIREMENTS.md] | For Phase 113, include resolved path/fq_id/identity and char counts for plain/section/pointer/alias scaffolding; full template usage details are Phase 114 unless metadata scaffolding is needed. [VERIFIED: 113-CONTEXT.md; CITED: DRS §9] |
| REF-08 | Reference hydration is non-recursive and applies only to host-authored input messages, not model tool-call arguments, assistant messages, or tool result messages. [VERIFIED: .planning/REQUIREMENTS.md] | Restrict scan targets to original `system`/`user` host input content; current handler maps every message content to string and can scan assistant/tool-origin content. [VERIFIED: src/mcp/tools/llm.ts; CITED: DRS §4.5 and §8.1] |
| VAL-113 | Phase 113 ships runnable unit, directed, and integration tests validating parsing, escaping, ambiguity, typed failures, metadata, and non-recursive hydration. [VERIFIED: .planning/REQUIREMENTS.md] | Use `tests/unit/reference-resolver.test.ts`, `tests/unit/llm-tool.test.ts`, one TS integration test for real vault ambiguity/resolution, and directed public `call_model` scenarios. [VERIFIED: tests tree; CITED: ATL Test Plan §4.5 and §5] |
</phase_requirements>

## Summary

Phase 113 should be planned as a focused replacement of the existing Phase 109 reference subsystem, not a new product surface. [VERIFIED: src/llm/reference-resolver.ts; .planning/STATE.md] The current implementation already wires reference hydration into `call_model`, uses `resolveAndBuildDocument()` for path/section/pointer behavior, and exposes `metadata.injected_references` / `prompt_chars`; however, it still uses a regex parser, recognizes legacy `{{id:...}}`, emits free-form failed `reason` strings, lacks escape parity, and scans coerced content from all message roles. [VERIFIED: src/llm/reference-resolver.ts; src/mcp/tools/llm.ts]

The safest plan is to keep the public `call_model` envelope and document resolution pipeline stable while introducing a small reference subsystem with three isolated layers: scanner, parser, and resolver/error mapper. [VERIFIED: 113-CONTEXT.md; CITED: DRS §8.1] This keeps parser and escape coverage cheap in unit tests, keeps real vault behavior in integration/directed tests, and avoids mixing Phase 114 template substitution into Phase 113. [VERIFIED: 113-CONTEXT.md; CITED: ATL Test Plan §3]

**Primary recommendation:** Implement `src/llm/reference-resolver.ts` as a typed scanner/parser/resolver boundary that only scans host-authored `system`/`user` message content, maps document errors to `ReferenceFailureReason`, treats `{{id:...}}` literally, and leaves Phase 114 template parameterization as deferred scaffolding only. [VERIFIED: src/llm/reference-resolver.ts; src/mcp/tools/llm.ts; 113-CONTEXT.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Placeholder scanning and escape parity | API / Backend | — | `call_model` runs server-side and must transform trusted host input before provider dispatch. [VERIFIED: src/mcp/tools/llm.ts; CITED: DRS §8.1] |
| Reference grammar parsing | API / Backend | — | Parser errors are deterministic and should be testable without vault, DB, or provider access. [VERIFIED: tests/unit/reference-resolver.test.ts; CITED: ATL Test Plan ATL-U-02] |
| Identifier resolution | API / Backend | Database / Storage | Resolution uses Supabase rows plus vault filesystem paths through existing document utilities. [VERIFIED: src/mcp/utils/resolve-document.ts; src/mcp/utils/document-output.ts] |
| Hydration replacement | API / Backend | — | Hydration replaces spans in the message payload before `llmClient.complete()` / `completeByPurpose()`. [VERIFIED: src/mcp/tools/llm.ts] |
| Metadata and typed failures | API / Backend | — | `call_model` owns the response envelope and error response shape. [VERIFIED: src/mcp/tools/llm.ts; src/llm/types.ts] |
| Validation scenarios | Test harness | API / Backend | Unit tests cover pure helpers; directed and integration tests prove public MCP behavior through managed server fixtures. [VERIFIED: tests/config/vitest.unit.config.ts; tests/scenarios/directed/run_suite.py] |

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20 LTS; the current machine has Node v24.7.0. [VERIFIED: AGENTS.md; `node --version`]
- Keep TypeScript strict ESM style; do not introduce CommonJS `require`. [VERIFIED: AGENTS.md; package.json `"type": "module"`]
- MCP tool handlers must return human-readable `{ content: [{ type: "text", text }] }`; errors add `isError: true`. [VERIFIED: AGENTS.md; src/mcp/tools/llm.ts]
- Use Zod for external input validation. [VERIFIED: AGENTS.md; src/mcp/tools/llm.ts]
- Do not build a web UI; FlashQuery is CLI + MCP only. [VERIFIED: AGENTS.md]
- Do not implement server-side session state; MCP is stateless and project context is per call. [VERIFIED: AGENTS.md]
- Run unit tests with `npm test`; integration and E2E depend on `.env.test` and Supabase credentials. [VERIFIED: AGENTS.md; tests/helpers/test-env.ts]
- Never use `npm link` for local development. [VERIFIED: AGENTS.md]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | package `^6.0.2`; registry current `6.0.3`, modified 2026-04-16 | Strict typed implementation for scanner/parser/resolver contracts. | Existing repo language and build target. [VERIFIED: package.json; npm view typescript version time.modified] |
| Zod | package `^4.3.6`; registry current `4.4.3`, modified 2026-05-04 | `call_model` schema validation; possible runtime enum validation for failure reasons. | Existing external input validation stack. [VERIFIED: package.json; npm view zod version time.modified] |
| `@modelcontextprotocol/sdk` | package `^1.27.1`; registry current `1.29.0`, modified 2026-03-30 | MCP tool registration and response transport. | Existing MCP server SDK. [VERIFIED: package.json; npm view @modelcontextprotocol/sdk version time.modified] |
| `gray-matter` | package `^4.0.3` | Frontmatter/body parsing through existing document pipeline. | Existing `resolveAndBuildDocument()` dependency. [VERIFIED: package.json; src/mcp/utils/document-output.ts] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | package `^4.1.1`; registry current `4.1.5`, modified 2026-05-05 | Unit and TS integration tests. | Parser, resolver mapper, handler boundary, and real-vault integration tests. [VERIFIED: package.json; npm view vitest version time.modified] |
| tsx | package/current `4.21.0`, modified 2025-11-30 | Development server runner. | Existing `npm run dev` / `dev:test` flow. [VERIFIED: package.json; npm view tsx version time.modified] |
| tsup | package/current `8.5.1`, modified 2025-11-12 | Production ESM bundle. | Integration setup rebuilds `dist/` before tests. [VERIFIED: package.json; tests/helpers/setup-build.ts; npm view tsup version time.modified] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Explicit span-table scanner | Negative-lookbehind regex | Regex cannot cleanly model escape parity, duplicate spans, escaped invalid placeholders, and non-recursive replacement. [CITED: DRS §4.5; VERIFIED: current regex in src/llm/reference-resolver.ts] |
| Existing document resolver pipeline | New filesystem reader | Hand-rolled reads would bypass identifier reconciliation, section extraction, pointer traversal, and existing tests. [VERIFIED: src/mcp/utils/resolve-document.ts; src/mcp/utils/document-output.ts] |
| Runtime constants array for reasons | String literals in tests | Constants let tests prove every reason has a trigger and prevent drift. [CITED: ATL OQ-24; ATL Test Plan ATL-U-07] |

**Installation:** No new package install is expected for Phase 113. [VERIFIED: package.json; 113-CONTEXT.md]

```bash
npm install
```

## Architecture Patterns

### System Architecture Diagram

```text
MCP call_model request
  |
  v
Validate resolver/name/messages with Zod
  |
  v
Discovery resolver? ---- yes ---> return raw discovery shape, no reference scan
  |
 no
  |
  v
Select host-authored input message content only
  |
  v
Span scanner: active refs + escaped refs + literal ranges
  |
  v
Parser: {{ref:identifier}}, #section, ->pointer, @alias scaffolding
  |
  +-- invalid syntax --> failed_references[{ reason, detail }] --> isError, no LLM call
  |
  v
Resolver boundary: resolveAndBuildDocument / standard identifier ladder
  |
  +-- document/section/pointer error --> map to ReferenceFailureReason --> isError, no LLM call
  |
  v
Hydrate active spans and unescape escaped spans, non-recursive
  |
  v
Dispatch hydrated messages to llmClient.complete()/completeByPurpose()
  |
  v
Return CallModelEnvelope with messages[], metadata.injected_references, prompt_chars
```

All arrows above describe existing or required backend flow; no browser/client tier participates in this phase. [VERIFIED: src/mcp/tools/llm.ts; CITED: DRS §8.1]

### Recommended Project Structure

```text
src/
├── constants/
│   └── reference-failures.ts      # ReferenceFailureReason union + runtime array
├── llm/
│   ├── reference-resolver.ts      # scanner, parser, resolver orchestration, metadata builders
│   └── types.ts                   # CallModelMetadata shape update for failed/detail metadata if needed
└── mcp/
    └── tools/
        └── llm.ts                 # host-message filtering and call_model integration

tests/
├── unit/
│   ├── reference-resolver.test.ts # scanner/parser/failure mapper table
│   ├── resolve-document.test.ts   # ambiguity behavior guard if helper changes
│   └── llm-tool.test.ts           # handler no-dispatch, host-only scan, envelope shape
├── integration/
│   └── reference-resolver.integration.test.ts # real vault ambiguity + metadata
└── scenarios/directed/testcases/
    └── test_call_model_reference_system_core.py # public call_model coverage
```

The file names are recommendations; existing repo conventions use kebab-case TypeScript modules and directed Python scenario files under `tests/scenarios/directed/testcases`. [VERIFIED: AGENTS.md; `rg --files src tests`]

### Pattern 1: Span-First Parsing

**What:** Build a span table over the original string before parsing or replacing any placeholder. [CITED: DRS §4.5 and §8.1]

**When to use:** Use for every message content selected for host-authored hydration. [CITED: DRS §8.1]

**Example:**

```typescript
type ReferenceSpan =
  | { kind: 'active'; start: number; end: number; raw: string; inner: string; literalPrefix: string }
  | { kind: 'escaped'; start: number; end: number; raw: string; literalPrefix: string };

// Source: Document Reference System §4.5 / §8.1
// Planner note: implement with index walking, not regex replacement.
```

### Pattern 2: Parse Before Resolution

**What:** The parser should return a descriptor or a typed syntax failure without touching the vault, Supabase, or the provider. [CITED: DRS §4.3; ATL Test Plan ATL-U-02]

**When to use:** Empty identifiers, empty sections, empty pointers, alias/operator conflicts, and whitespace around operators should fail in parser unit tests. [CITED: DRS §4.3; 113-CONTEXT.md]

### Pattern 3: Error Mapping At Resolver Boundary

**What:** Convert `DocumentRequestError.envelope.error` and generic document-resolution errors into stable `ReferenceFailureReason` codes and human `detail`. [CITED: ATL OQ-24; DRS §8.2]

**When to use:** Every caught resolver error should produce `{ kind: 'failed', ref, reason, detail }`; `unknown_reference_error` is the fallback and should log a WARN marker. [CITED: ATL OQ-24]

### Pattern 4: Host-Only Hydration Boundary

**What:** Scan only original host-authored `system`/`user` content for active references in this phase. [CITED: DRS §4.5]

**When to use:** Assistant messages, tool messages, assistant tool-call arguments, tool results, and injected content containing `{{ref:...}}` must remain literal data. [CITED: DRS §4.5; REF-08]

### Anti-Patterns to Avoid

- **Regex-only parser:** The current `/\{\{(ref|id):([^}]*?)\}\}/g` pattern cannot satisfy escape parity or `{{id:...}}` removal. [VERIFIED: src/llm/reference-resolver.ts; CITED: DRS §4.5]
- **String `replaceAll` hydration:** Hydration must replace active spans only; escaped placeholders and duplicate identical placeholders need position-specific replacement. [CITED: DRS §4.5; VERIFIED: tests/unit/reference-resolver.test.ts]
- **Leaking document messages as reason codes:** `DocumentRequestError.envelope.message` belongs in `detail`, not `reason`. [CITED: ATL OQ-24]
- **Scanning returned or delegated-model content:** Model-authored references are deferred response-reference behavior and are out of scope. [CITED: DRS §7.4; 113-CONTEXT.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Document identifier resolution | New UUID/path/filename lookup | `resolveDocumentIdentifier()` / `resolveAndBuildDocument()` | Existing logic handles UUID, path, filename scan, reconciliation, and vault bounds. [VERIFIED: src/mcp/utils/resolve-document.ts; src/mcp/utils/document-output.ts] |
| Section extraction | New markdown heading parser | Existing `extractSection` / `extractMultipleSections` via `resolveAndBuildDocument()` | Existing behavior includes occurrence errors and available headings. [VERIFIED: src/mcp/utils/document-output.ts; src/mcp/utils/markdown-sections.ts] |
| Pointer traversal | New frontmatter dot-path walker | Existing `followRef` branch in `resolveAndBuildDocument()` | Existing branch maps path-not-found, invalid type, and target-not-found envelopes. [VERIFIED: src/mcp/utils/document-output.ts] |
| MCP response envelope | New transport shape | Existing `CallModelEnvelope` and tool response pattern | Phase 112 verified additive `messages[]` envelope compatibility. [VERIFIED: src/llm/types.ts; 112-VERIFICATION.md] |
| Failure reason registry | Test-local strings | Central constants module with union + runtime array | Tests need enum coverage and drift detection. [CITED: ATL Test Plan ATL-U-07] |

**Key insight:** The hard part is not reading markdown; it is preserving a machine-readable API contract across grammar errors, resolver errors, escape handling, metadata ordering, and no-dispatch semantics. [CITED: DRS §8-§9; ATL Test Plan ATL-U-02/U-03/U-07]

## Common Pitfalls

### Pitfall 1: Legacy `{{id:...}}` Survives
**What goes wrong:** Existing parser still treats `{{id:...}}` as active and will resolve it. [VERIFIED: src/llm/reference-resolver.ts; tests/unit/reference-resolver.test.ts]
**Why it happens:** Phase 109 supported `id` as a synonym and Phase 113 explicitly removes it. [VERIFIED: .planning/STATE.md; 113-CONTEXT.md]
**How to avoid:** Only recognize `{{ref:` as an opener; add tests that active and escaped `{{id:...}}` remain literal and emit no metadata. [CITED: ATL Test Plan ATL-U-02/ATL-U-03]
**Warning signs:** Any `identifierType: 'id'` type or regex alternation `(ref|id)` remains in the implementation. [VERIFIED: src/llm/reference-resolver.ts]

### Pitfall 2: Free-Form Failure Reasons
**What goes wrong:** Callers receive human messages in `reason`, which prevents stable assertions. [VERIFIED: src/llm/reference-resolver.ts; tests/scenarios/directed/testcases/test_call_model_ref_error_taxonomy.py]
**Why it happens:** Current resolver maps `DocumentRequestError.envelope.message` directly to `FailedRef.reason`. [VERIFIED: src/llm/reference-resolver.ts]
**How to avoid:** Return stable `ReferenceFailureReason` codes and move human text to `detail`. [CITED: ATL OQ-24; DRS §8.2]
**Warning signs:** Tests assert reason substrings like `"not found in frontmatter"` instead of enum values. [VERIFIED: tests/scenarios/directed/testcases/test_call_model_ref_error_taxonomy.py]

### Pitfall 3: Assistant/Tool Content Hydrated
**What goes wrong:** A returned assistant message or tool result containing `{{ref:...}}` can be reinterpreted as host authorization. [CITED: DRS §4.5]
**Why it happens:** Current handler converts every message content to a string before parsing, regardless of role. [VERIFIED: src/mcp/tools/llm.ts]
**How to avoid:** Keep a host-authored scan target list with original message index and skip assistant/tool messages and tool-call argument objects. [CITED: DRS §4.5; REF-08]
**Warning signs:** Parser tests include assistant messages as scannable input or handler passes the whole message array into parser without role filtering. [VERIFIED: tests/unit/reference-resolver.test.ts; src/mcp/tools/llm.ts]

### Pitfall 4: Ambiguity Hidden As Document Not Found
**What goes wrong:** Multiple active filename matches get collapsed into generic `document_not_found` or a human ambiguity string. [VERIFIED: src/mcp/utils/resolve-document.ts]
**Why it happens:** `resolveDocumentIdentifier()` currently throws an `Error` string for ambiguous filename matches. [VERIFIED: src/mcp/utils/resolve-document.ts]
**How to avoid:** Either introduce a typed document-resolution error or classify the exact ambiguity condition before returning reference failure metadata. [VERIFIED: tests/unit/resolve-document.test.ts; CITED: DRS §4.4]
**Warning signs:** `ambiguous_document_identifier` does not appear in a runtime constants array or tests. [VERIFIED: rg ambiguous_document_identifier]

### Pitfall 5: Escaped Invalid Placeholder Fails The Call
**What goes wrong:** `\{{ref:}}` becomes an `invalid_reference_syntax` failure even though it should be literal text. [CITED: DRS §4.5]
**Why it happens:** Parser runs before escape classification. [CITED: DRS §4.5]
**How to avoid:** Classify escaped spans before parsing and exclude them from parse/resolve metadata. [CITED: DRS §8.1]
**Warning signs:** Tests for `\{{ref:}}` expect an error. [CITED: ATL Test Plan ATL-U-03]

## Code Examples

### Failure Reason Constants

```typescript
// Source: ATL OQ-24 / DRS §8.2
export const REFERENCE_FAILURE_REASONS = [
  'invalid_reference_syntax',
  'document_not_found',
  'ambiguous_document_identifier',
  'read_error',
  'section_not_found',
  'occurrence_out_of_range',
  'reference_path_not_found',
  'reference_path_not_string',
  'pointer_target_not_found',
  'unknown_reference_error',
] as const;

export type ReferenceFailureReason = typeof REFERENCE_FAILURE_REASONS[number];
```

Phase 113 may include template/alias reason constants as scaffolding if the parser accepts `@alias`, but full template parameter failures are Phase 114. [VERIFIED: 113-CONTEXT.md; CITED: ATL OQ-24]

### Resolver Boundary Mapping

```typescript
// Source: src/mcp/utils/document-output.ts + ATL OQ-24
function mapDocumentEnvelopeError(error: string): ReferenceFailureReason {
  switch (error) {
    case 'follow_ref_path_not_found':
      return 'reference_path_not_found';
    case 'follow_ref_invalid_type':
      return 'reference_path_not_string';
    case 'follow_ref_target_not_found':
      return 'pointer_target_not_found';
    case 'section_not_found':
      return 'section_not_found';
    case 'occurrence_out_of_range':
      return 'occurrence_out_of_range';
    default:
      return 'unknown_reference_error';
  }
}
```

### Handler Boundary

```typescript
// Source: DRS §4.5 / src/mcp/tools/llm.ts
const hostReferenceMessages = messages
  .map((message, index) => ({ message, index }))
  .filter(({ message }) => message.role === 'system' || message.role === 'user')
  .filter(({ message }) => typeof message.content === 'string');
```

The planner should make sure hydration writes back to the original message indexes without scanning assistant/tool content. [VERIFIED: src/mcp/tools/llm.ts; CITED: DRS §4.5]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `{{ref:...}}` and `{{id:...}}` both active | Only `{{ref:...}}` active; `{{id:...}}` literal | ATL spec-complete 2026-05-05 | Parser and directed tests must change from Phase 109 behavior. [VERIFIED: 113-CONTEXT.md; CITED: ATL OQ-22/OQ-23] |
| Regex scan before hydration | Span-table scan with active/escaped classifications | DRS spec-complete 2026-05-05 | Required for escape parity and escaped invalid placeholders. [CITED: DRS §4.5] |
| Human string failure reasons | Stable `ReferenceFailureReason` + `detail` | ATL OQ-24 resolved 2026-05-05 | Public scenarios should assert enum reasons. [CITED: ATL OQ-24; DRS §8.2] |
| Scan all message content | Scan host-authored input only | DRS readiness pass 2026-05-05 | Assistant/tool content remains ordinary data. [CITED: DRS §4.5] |

**Deprecated/outdated:**
- Phase 109 `identifierType: 'ref' | 'id'` is outdated for ATL and should be removed or replaced with a literal `ref` grammar. [VERIFIED: src/llm/reference-resolver.ts; 113-CONTEXT.md]
- Directed scenario rows that assert `{{id:...}}` resolution are now legacy and should be replaced or reclassified during Phase 113. [VERIFIED: tests/scenarios/directed/testcases/test_call_model_references.py; 113-CONTEXT.md]

## Assumptions Log

All claims in this research were verified from local code, local planning/product docs, command output, or npm registry checks; no `[ASSUMED]` claims are present. [VERIFIED: this research session]

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | — | — | — |

## Open Questions

1. **Should `resolveDocumentIdentifier()` itself gain a typed ambiguity error, or should Phase 113 classify ambiguity only in the reference resolver?** [VERIFIED: src/mcp/utils/resolve-document.ts]
   - What we know: The existing helper throws a specific ambiguity message that includes matching paths and guidance. [VERIFIED: src/mcp/utils/resolve-document.ts]
   - What's unclear: Changing helper error types can affect other tools that catch generic errors. [VERIFIED: src/mcp/tools/documents.ts; src/mcp/utils/document-output.ts]
   - Recommendation: Prefer a narrow typed error class that preserves current `.message`, or add a wrapper classifier in `reference-resolver.ts` if planner wants minimal blast radius. [VERIFIED: codebase inspection]

2. **How much alias scaffolding belongs in Phase 113?** [VERIFIED: 113-CONTEXT.md]
   - What we know: `@` is a v1 grammar operator and parser diagnostics for empty alias/operator conflicts are in Phase 113. [VERIFIED: 113-CONTEXT.md; CITED: DRS §4.2-§4.3]
   - What's unclear: Full alias hydration depends on `template_params`, which is mostly Phase 114. [VERIFIED: 113-CONTEXT.md]
   - Recommendation: Parse alias syntax and return typed `alias_key_not_found` or minimal scaffold failures only if `template_params` is accepted in this phase; do not implement template substitution. [VERIFIED: 113-CONTEXT.md]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build/test/runtime | yes | v24.7.0 | None needed; AGENTS requires >=20. [VERIFIED: `node --version`; AGENTS.md] |
| npm | Package/test scripts | yes | 11.5.1 | None. [VERIFIED: `npm --version`] |
| Python 3 | Directed scenario runner | yes | 3.12.3 | None. [VERIFIED: `python3 --version`] |
| `.env.test` | Integration/E2E Supabase-backed tests | yes | present | Tests skip gracefully when incomplete. [VERIFIED: file check; tests/helpers/test-env.ts] |
| Supabase CLI | Optional local Supabase management | not found in PATH | — | Use existing `.env.test` hosted/local instance; CLI not required by Phase 113 tests. [VERIFIED: command -v supabase] |
| gsd-sdk | Phase docs init/commit | yes | 1.40.0 | Manual git commit if needed. [VERIFIED: `gsd-sdk --version`] |

**Missing dependencies with no fallback:** None identified for planning. [VERIFIED: environment audit]

**Missing dependencies with fallback:** Supabase CLI is absent, but Phase 113 can use existing `.env.test` credentials and scenario managed server fixtures. [VERIFIED: environment audit; tests/helpers/test-env.ts]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest package `^4.1.1`; registry current `4.1.5`. [VERIFIED: package.json; npm view vitest] |
| Config file | `tests/config/vitest.unit.config.ts` for unit, `tests/config/vitest.integration.config.ts` for integration. [VERIFIED: tests/config/*.ts] |
| Quick run command | `npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool.test.ts tests/unit/resolve-document.test.ts` [VERIFIED: package.json; tests tree] |
| Full suite command | `npm test && npm run test:integration` plus directed scenario command below. [VERIFIED: package.json; tests/helpers/setup-build.ts] |
| Directed command | `python3 tests/scenarios/directed/run_suite.py --managed test_call_model_reference_system_core` after scenario is added. [VERIFIED: tests/scenarios/directed/run_suite.py; ATL Test Plan §3] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REF-01 | `{{ref:...}}` path/filename/fq_id ladder and metadata | unit + integration + directed | `npm test -- tests/unit/reference-resolver.test.ts tests/unit/resolve-document.test.ts`; scenario command | partial; Wave 0 needs new/updated tests. [VERIFIED: tests/unit/reference-resolver.test.ts] |
| REF-02 | Grammar for `#`, `->`, positional `@`, invalid combinations, empty fields, whitespace | unit | `npm test -- tests/unit/reference-resolver.test.ts` | partial; current tests lack alias/whitespace/empty section-pointer. [VERIFIED: tests/unit/reference-resolver.test.ts] |
| REF-03 | Escape parity and escaped metadata exclusion | unit + directed | `npm test -- tests/unit/reference-resolver.test.ts`; scenario command | missing; Wave 0. [VERIFIED: rg escape tests] |
| REF-04 | Ambiguous shorthand returns `ambiguous_document_identifier` detail | unit + integration + directed | `npm test -- tests/unit/resolve-document.test.ts tests/unit/reference-resolver.test.ts`; `npm run test:integration -- tests/integration/reference-resolver.integration.test.ts` | partial helper coverage only; Wave 0 for typed reference reason. [VERIFIED: tests/unit/resolve-document.test.ts] |
| REF-05 | Active/escaped `{{id:...}}` treated literal | unit + directed | `npm test -- tests/unit/reference-resolver.test.ts`; scenario command | current tests assert opposite; update required. [VERIFIED: tests/unit/reference-resolver.test.ts; tests/scenarios/directed/testcases/test_call_model_references.py] |
| REF-06 | Stable failed reason + detail shape | unit + directed | `npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool.test.ts`; scenario command | missing for typed enum; current tests use free-form reason. [VERIFIED: tests/unit/llm-tool.test.ts] |
| REF-07 | Injected metadata includes identity and char counts | unit + directed | `npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool.test.ts`; scenario command | partial; current metadata lacks general resolved identity beyond pointer `resolved_to`. [VERIFIED: src/llm/reference-resolver.ts] |
| REF-08 | Non-recursive and host-only hydration | unit + directed | `npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool.test.ts`; scenario command | partial non-recursive unit exists; host-only role boundary missing. [VERIFIED: tests/unit/reference-resolver.test.ts; src/mcp/tools/llm.ts] |
| VAL-113 | Runnable unit, directed, integration coverage | all | Commands above plus coverage matrix updates | missing as Phase 113 accepted rows. [VERIFIED: ATL Test Plan; coverage matrices] |

### Sampling Rate

- **Per task commit:** `npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool.test.ts` [VERIFIED: package.json]
- **Per wave merge:** Add `tests/unit/resolve-document.test.ts` and any new integration test. [VERIFIED: tests tree]
- **Phase gate:** `npm run build`, focused unit command, integration reference test, and directed managed scenario. [VERIFIED: 112-VERIFICATION.md pattern; package.json]

### Wave 0 Gaps

- [ ] `src/constants/reference-failures.ts` and unit meta-test for every `ReferenceFailureReason`. [CITED: ATL Test Plan ATL-U-07]
- [ ] Rewrite `tests/unit/reference-resolver.test.ts` parser expectations for no `{{id:...}}`, alias grammar, escape parity, whitespace, empty section/pointer, malformed opener literal, and long-message scanning. [CITED: ATL Test Plan ATL-U-02/U-03]
- [ ] Add handler tests in `tests/unit/llm-tool.test.ts` for host-only scan, no LLM call on typed failures, and `failed_references[].detail`. [VERIFIED: src/mcp/tools/llm.ts]
- [ ] Add `tests/integration/reference-resolver.integration.test.ts` or equivalent for real vault ambiguity and identity metadata. [CITED: ATL Test Plan ATL-I-04]
- [ ] Add or replace directed scenario rows for ATL-DS-02 and ATL-DS-03; update `DIRECTED_COVERAGE.md`. [CITED: ATL Test Plan ATL-DS-02/ATL-DS-03]
- [ ] Update integration coverage rows currently marked Phase 109-style pending where `{{id:...}}` behavior is no longer valid. [VERIFIED: tests/scenarios/integration/INTEGRATION_COVERAGE.md]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no new auth | Existing MCP auth remains outside this phase. [VERIFIED: AGENTS.md; src/mcp/auth.ts exists] |
| V3 Session Management | no | MCP is stateless; no server-side session state should be introduced. [VERIFIED: AGENTS.md] |
| V4 Access Control | yes | Host-authored-only hydration boundary prevents delegated model or tool data from authorizing vault reads. [CITED: DRS §4.5] |
| V5 Input Validation | yes | Zod for external `call_model` schema; parser for reference grammar. [VERIFIED: src/mcp/tools/llm.ts; AGENTS.md] |
| V6 Cryptography | no new crypto | No encryption/signing/hashing change is required for Phase 113. [VERIFIED: phase scope in 113-CONTEXT.md] |

### Known Threat Patterns for Reference Hydration

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt/tool data causes unintended vault read | Elevation of Privilege / Information Disclosure | Scan host-authored input only; never scan assistant/tool messages or tool-call arguments. [CITED: DRS §4.5] |
| Escaped placeholder still resolved | Information Disclosure | Span-table escape parity before parsing. [CITED: DRS §4.5] |
| Path traversal through reference identifier | Tampering / Information Disclosure | Reuse `resolveDocumentIdentifier()` vault-bound path checks. [VERIFIED: src/mcp/utils/resolve-document.ts] |
| Ambiguous filename resolved nondeterministically | Tampering / Repudiation | Fail with `ambiguous_document_identifier` and require path or `fq_id`. [CITED: DRS §4.4] |
| Free-form failure strings become unstable API | Repudiation | Central `ReferenceFailureReason` constants and tests. [CITED: ATL OQ-24] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/113-document-reference-system-core/113-CONTEXT.md` - Phase boundaries, locked decisions, deferred scope. [VERIFIED: sed]
- `.planning/REQUIREMENTS.md` - REF-01..REF-08 and VAL-113 requirement text. [VERIFIED: sed]
- `.planning/STATE.md` and `.planning/ROADMAP.md` - Phase dependency, success criteria, milestone history. [VERIFIED: sed]
- `Agentic-LLM-Tool-Loop.md` - OQ-22 through OQ-24 reference grammar, escape, and failure resolutions. [CITED: local canonical product doc]
- `Document Reference System.md` - definitive grammar, escape, identifier, pipeline, failure, metadata, and non-recursive boundaries. [CITED: local canonical product doc]
- `ATL Test Plan.md` - required unit/integration/directed coverage IDs and patterns. [CITED: local canonical product doc]
- `src/llm/reference-resolver.ts`, `src/mcp/tools/llm.ts`, `src/mcp/utils/resolve-document.ts`, `src/mcp/utils/document-output.ts`, `src/llm/types.ts` - current implementation seams. [VERIFIED: sed/rg]
- `package.json`, npm registry `npm view ... version time.modified` - dependency versions and current registry versions. [VERIFIED: npm registry]

### Secondary (MEDIUM confidence)

- Existing scenario coverage matrices and directed scenario tests show current public test surfaces and legacy assumptions. [VERIFIED: tests/scenarios/directed/DIRECTED_COVERAGE.md; tests/scenarios/integration/INTEGRATION_COVERAGE.md]

### Tertiary (LOW confidence)

- None. [VERIFIED: no web-search-only claims used]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - verified from `package.json` and npm registry. [VERIFIED: package.json; npm view]
- Architecture: HIGH - verified from existing `call_model`, resolver, and document utility code plus canonical specs. [VERIFIED: src/mcp/tools/llm.ts; src/llm/reference-resolver.ts; CITED: DRS §8]
- Pitfalls: HIGH - verified from mismatches between existing Phase 109 code/tests and Phase 113 locked decisions. [VERIFIED: src/llm/reference-resolver.ts; tests/unit/reference-resolver.test.ts; 113-CONTEXT.md]
- Validation: HIGH - verified from repo test configs, Phase 112 verification pattern, and ATL Test Plan. [VERIFIED: tests/config/*.ts; 112-VERIFICATION.md; CITED: ATL Test Plan]

**Research date:** 2026-05-05 [VERIFIED: current_date]
**Valid until:** 2026-06-04 for local architecture; npm registry version data should be refreshed before implementation if planning occurs after 2026-05-12. [VERIFIED: npm view timestamps]
