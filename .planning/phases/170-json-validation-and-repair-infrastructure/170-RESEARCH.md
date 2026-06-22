# Phase 170: JSON Validation and Repair Infrastructure - Research

**Researched:** 2026-06-22
**Domain:** LLM-originated JSON repair, schema validation, MCP response compatibility, macro runtime parse-site retrofits
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
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

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

- Graph edge classification, key-claims extraction, node analysis, contradiction assessment, and graph-specific schemas are deferred to the Graph Intelligence implementation.
- Higher-order LLM retry helpers and dead-letter persistence are deferred unless a current Phase 170 call site can use them without broad flow changes.
- Web UI, review surfaces, dashboards, database schema changes, and global replacement of every `JSON.parse()` are out of scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-001 | Add `jsonrepair` as runtime dependency with ESM-compatible build behavior. | Use `jsonrepair@3.14.0`; ESM import and package exports verified via Context7 and npm. [CITED: github.com/josdejong/jsonrepair README] [VERIFIED: npm registry] |
| REQ-002 | Add stateless `parseLlmJson<T>()` utility under `src/llm/`. | Contract, pipeline, and required fixtures come from canonical Requirements/Test Plan. [CITED: JSON Validation Requirements.md §6.1.2, §7.1-§7.2] [CITED: JSON Validation Test Plan.md §4.1] |
| REQ-003 | Distinguish syntax/schema failures and expose issues/summary without retry policy. | Use discriminated result with `failure: 'syntax' | 'schema'`; Zod `safeParse()` produces machine-readable issues. [CITED: JSON Validation Requirements.md §6.1.3, §7.1] |
| REQ-004 | Repair macro evaluator tool-result payloads before fallback. | Retrofit `src/macro/evaluator.ts:962` and preserve token extraction at `src/macro/evaluator.ts:979`. [VERIFIED: codebase grep] |
| REQ-005 | Repair host-template payloads and surface JSON-like structured failures. | Retrofit `src/mcp/host-template-tools.ts:74` and `callResultFromTemplateText()` at line 84. [VERIFIED: codebase grep] |
| REQ-006 | Treat unreadable macro task result envelopes as task failure. | Retrofit `transitionTaskFromResult()` and `parseResultPayload()` at `src/mcp/tools/macro.ts:740` and `:759`. [VERIFIED: codebase grep] |
| REQ-007 | Repair provider tool-call argument strings before existing fail-loud path. | Retrofit `normalizeToolCallArguments()` at `src/llm/client.ts:159` while keeping current error message. [VERIFIED: codebase grep] |
| REQ-008 | Repair brokered tool text coercion while preserving structuredContent/prose/isError behavior. | Retrofit `coerceCallToolResult()` at `src/macro/coerce.ts:8`; log through `logger.warn()` at `src/logging/logger.ts:74`. [VERIFIED: codebase grep] |
| REQ-009 | Keep native FlashQuery tool response parsing unchanged. | Regression-test `parseNativeToolResponse()` at `src/macro/registry.ts:70`; do not retrofit unless a new failing test proves need. [VERIFIED: codebase grep] [CITED: JSON Validation Requirements.md §6.2.6] |
| REQ-010 | Use stable existing JSON error envelopes for new user-visible parse failures. | Existing helpers are `jsonExpectedError()` and `jsonRuntimeError()` at `src/mcp/utils/response-formats.ts:255` and `:268`. [VERIFIED: codebase grep] |
| REQ-011 | Make repair metadata internally testable without broad public success-envelope churn. | Utility result must expose `repaired`; public retrofit tests must assert no new required top-level success fields. [CITED: JSON Validation Requirements.md §6.3.2] |
</phase_requirements>

## Summary

Phase 170 should be planned as four implementation lanes: utility foundation, high-priority silent-failure retrofits, compatibility retrofits, and public workflow verification. [CITED: JSON Validation Requirements.md §8.2] The canonical Requirements and Test Plan are the source of truth for behavior and test IDs, and downstream agents must read both before making implementation choices. [CITED: .planning/phases/170-json-validation-and-repair-infrastructure/170-CONTEXT.md]

The central technical decision is locked: add `jsonrepair` and implement a pure `src/llm/parseLlmJson<T>()`-style utility that repairs, parses, validates with Zod, and returns non-throwing discriminated results. [CITED: JSON Validation Requirements.md §6.1, §7.1-§7.2] `jsonrepair` supports ESM import via `import { jsonrepair } from 'jsonrepair'`, repairs common LLM defects including missing quotes, single quotes, trailing commas, missing brackets, fenced code blocks, and truncated input, and throws `JSONRepairError` when unrecoverable. [CITED: github.com/josdejong/jsonrepair README via Context7]

The riskiest planning area is preserving different failure contracts at each retrofit site. [CITED: JSON Validation Requirements.md §7.3] Macro evaluator non-error values retain raw-string fallback, host-template JSON-like failures become `isError: true`, macro task unreadable envelopes fail the task, provider arguments keep the existing fail-loud invalid-argument error, brokered tool prose remains raw string without warning, and native tool response parsing remains unchanged. [CITED: JSON Validation Requirements.md §6.2]

**Primary recommendation:** Plan four focused waves with inline TDD per behavior slice, using the Test Plan IDs as acceptance criteria and preserving each call site's existing public response envelope unless a requirement explicitly changes failure behavior. [CITED: .planning/ROADMAP.md Phase 170]

## Project Constraints (from AGENTS.md)

- Runtime is Node.js >= 20 LTS, enforced by `package.json` engines. [CITED: AGENTS.md]
- TypeScript is strict-mode ESM; do not introduce CommonJS `require`. [CITED: AGENTS.md]
- Use `@modelcontextprotocol/sdk`, not nonexistent `@modelcontextprotocol/server`. [CITED: AGENTS.md]
- FlashQuery is CLI + MCP only; do not build a web UI. [CITED: AGENTS.md]
- MCP is stateless; do not implement server-side session state. [CITED: AGENTS.md]
- MCP tool handlers return `{ content: [{ type: "text", text: "..." }] }`; errors add `isError: true`. [CITED: AGENTS.md]
- Use Zod for external input validation and MCP params. [CITED: AGENTS.md]
- Use `async/await`; module-boundary failures should be typed/non-throwing where applicable. [CITED: AGENTS.md]
- Unit tests live under `tests/unit/`; integration tests under `tests/integration/`; E2E tests under `tests/e2e/`; scenario tests under `tests/scenarios/`. [CITED: AGENTS.md]
- Do not use `npm link` for local development. [CITED: AGENTS.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Shared LLM JSON repair utility | API / Backend | — | FlashQuery's TypeScript server owns LLM response normalization before macro/MCP layers consume parsed values. [VERIFIED: codebase grep] |
| Zod schema validation and parse diagnostics | API / Backend | — | Known schemas and failure metadata are server-side contracts, not browser or database responsibilities. [CITED: JSON Validation Requirements.md §7.1-§7.2] |
| MCP response envelope preservation | API / Backend | MCP transport boundary | Tool handlers produce MCP `CallToolResult` objects with text-first content and `isError` flags. [CITED: AGENTS.md] [VERIFIED: codebase grep] |
| Macro evaluator payload parsing | API / Backend | Macro runtime | `evaluateProgram()` receives tool results and converts them into macro values/errors. [VERIFIED: codebase grep] |
| Host template tool structuredContent mapping | API / Backend | MCP host surface | `registerHostTemplateTool()` dispatches template calls and maps model/tool text to MCP `CallToolResult`. [VERIFIED: codebase grep] |
| Provider tool-call argument normalization | API / Backend | LLM provider adapter | `OpenAICompatibleLlmClient` normalizes provider tool-call arguments before exposing typed tool calls. [VERIFIED: codebase grep] |
| Scenario/public verification | Test harness | MCP transport | Directed/YAML/E2E tests verify observable MCP behavior rather than internal parser details. [CITED: JSON Validation Test Plan.md §2.4-§2.5] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `jsonrepair` | 3.14.0 | Repair malformed JSON strings before `JSON.parse()`. | Official docs expose ESM import and the package repairs LLM-relevant syntax defects; npm registry confirms latest version and exports. [CITED: github.com/josdejong/jsonrepair README] [VERIFIED: npm registry] |
| `zod` | ^4.4.3 currently installed | Validate parsed JSON with `safeParse()`. | Existing project dependency and canonical requirement mandates Zod for known-schema validation. [VERIFIED: package.json] [CITED: JSON Validation Requirements.md §4 INV-04] |
| Vitest | ^4.1.1 currently installed | Unit, integration, and E2E tests. | Existing repo scripts and configs use Vitest for all TypeScript test layers. [VERIFIED: package.json] [VERIFIED: tests/config/vitest.*.config.ts] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@modelcontextprotocol/sdk` | ^1.29.0 currently installed | MCP client/server types and transports. | Use existing MCP types for `CallToolResult` and in-memory/E2E client tests. [VERIFIED: package.json] [VERIFIED: tests/integration/macro-parse-error.test.ts] |
| `tsx` | ^4.21.0 currently installed | Run TypeScript entrypoint in E2E subprocesses. | Existing E2E tests spawn `npx tsx src/index.ts start --config ...`. [VERIFIED: tests/e2e/call-model-template-tools.e2e.test.ts] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `jsonrepair` | Custom parser/repair logic | Do not hand-roll; canonical requirements explicitly require `jsonrepair` when it satisfies use cases. [CITED: JSON Validation Requirements.md §6.1.1] |
| Zod schemas | Ad hoc object checks | Zod `safeParse()` is required for known-schema parse paths and gives machine-readable issue metadata. [CITED: JSON Validation Requirements.md §4 INV-04, §6.1.3] |
| Scenario-only tests | Unit/integration first | Pure parser behavior belongs in unit tests; scenario tests are only for public MCP behavior. [CITED: JSON Validation Test Plan.md §2.4, §3] |

**Installation:**
```bash
npm install jsonrepair
```

**Version verification:**
```bash
npm view jsonrepair version time.version time.created time.modified license repository.url homepage description dist.unpackedSize scripts.postinstall --json
npm view jsonrepair exports type types main module --json
```

Verified result: `jsonrepair@3.14.0`, created 2012-11-25, modified 2026-04-16, ISC license, repository `github.com/josdejong/jsonrepair`, no postinstall script returned, ESM export path `./lib/esm/index.js`, type declarations `./lib/types/index.d.ts`. [VERIFIED: npm registry]

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `jsonrepair` | npm | Created 2012-11-25; modified 2026-04-16 | 2,457,565 downloads last week for 2026-06-15 through 2026-06-21 | `github.com/josdejong/jsonrepair` | OK | Approved. [VERIFIED: npm registry] [VERIFIED: slopcheck] |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: slopcheck]
**Packages flagged as suspicious [SUS]:** none. [VERIFIED: slopcheck]

Note: `slopcheck install jsonrepair --json` is not supported by local `slopcheck 0.6.1`; rerunning without `--json` returned `[OK]`. [VERIFIED: slopcheck]

## Architecture Patterns

### System Architecture Diagram

```text
LLM/provider/tool text
  |
  v
parseLlmJson<T>(raw, schema)
  |-- jsonrepair(raw) throws --------------------+
  |                                             |
  |-- JSON.parse(repaired/raw) fails -----------+--> { ok:false, failure:"syntax", raw, repaired, summary }
  |
  |-- schema.safeParse(parsed) fails --------------> { ok:false, failure:"schema", issues, summary }
  |
  v
{ ok:true, data, raw, repaired }
  |
  +--> macro evaluator: parsed value or allowed raw fallback
  +--> host template tools: structuredContent / isError
  +--> macro task result: complete/cancel/fail transition
  +--> provider tool calls: object args or existing invalid-JSON throw
  +--> brokered tool coercion: structuredContent > repaired JSON > raw prose
```

### Recommended Project Structure

```text
src/
├── llm/
│   └── json-repair.ts          # parseLlmJson<T>(), result types, issue summaries, JSON-like helper if shared
├── macro/
│   ├── evaluator.ts            # repair parseToolResultPayload()
│   ├── coerce.ts               # repair brokered text coercion and warn on JSON-like fallback
│   └── registry.ts             # unchanged parseNativeToolResponse() regression-only
└── mcp/
    ├── host-template-tools.ts   # repair parseTemplateToolPayload()
    └── tools/macro.ts          # fail unreadable task result envelopes
```

### Component Responsibilities

| Component | Current Behavior | Planned Responsibility |
|-----------|------------------|------------------------|
| `src/llm/json-repair.ts` | Does not exist. [VERIFIED: codebase grep] | Pure repair/parse/validate utility with no macro/MCP imports. [CITED: JSON Validation Requirements.md §6.1.2] |
| `src/macro/evaluator.ts:962` | Parses first text content with `JSON.parse()` and returns raw text on failure. [VERIFIED: codebase grep] | Repair before fallback and preserve token/warning/trace extraction behavior. [CITED: JSON Validation Requirements.md §6.2.1] |
| `src/mcp/host-template-tools.ts:74` | Returns `{ payload: undefined, isError: false }` on parse failure. [VERIFIED: codebase grep] | Repair structured payloads; mark JSON-like irreparable payloads as `isError: true`. [CITED: JSON Validation Requirements.md §6.2.2] |
| `src/mcp/tools/macro.ts:740` | Completes task when result is not `isError` and parsed payload is `undefined`. [VERIFIED: codebase grep] | Treat unreadable result envelope as task failure. [CITED: JSON Validation Requirements.md §6.2.3] |
| `src/llm/client.ts:159` | String arguments use raw `JSON.parse()`; invalid JSON throws existing provider error. [VERIFIED: codebase grep] | Attempt repair first; preserve throw path for irreparable/non-object arguments. [CITED: JSON Validation Requirements.md §6.2.4] |
| `src/macro/coerce.ts:8` | `structuredContent`, then raw `JSON.parse()`, then raw text fallback. [VERIFIED: codebase grep] | Preserve precedence/prose fallback; repair JSON-like text; warn once on JSON-like fallback. [CITED: JSON Validation Requirements.md §6.2.5] |
| `src/macro/registry.ts:70` | Parses native tool response text or returns raw text. [VERIFIED: codebase grep] | Remain unchanged with regression tests only. [CITED: JSON Validation Requirements.md §6.2.6] |

### Pattern 1: Pure Parser Boundary

**What:** Keep `parseLlmJson<T>()` in `src/llm/` and import only `jsonrepair`, Zod types, and local helpers. [CITED: JSON Validation Requirements.md §6.1.2]

**When to use:** Any LLM-originated or LLM-adjacent text parse named by Phase 170. [CITED: JSON Validation Requirements.md §3.1]

**Example:**
```typescript
import { jsonrepair } from 'jsonrepair';
import { z } from 'zod';

const schema = z.object({ ok: z.boolean().optional() }).catchall(z.unknown());
const repaired = jsonrepair('{ok: true,}');
const parsed = schema.safeParse(JSON.parse(repaired));
```

Source: `jsonrepair` ESM import and repair behavior from official README via Context7; Zod usage mandated by Requirements. [CITED: github.com/josdejong/jsonrepair README] [CITED: JSON Validation Requirements.md §4 INV-04]

### Pattern 2: Site-Specific Failure Policy

**What:** Each caller maps parser failures according to its existing compatibility contract rather than sharing a single "throw on failure" policy. [CITED: JSON Validation Requirements.md §7.3]

**When to use:** All retrofits; especially host-template and macro-task paths where silent success must become an error. [CITED: JSON Validation Requirements.md §6.2.2-§6.2.3]

**Example:**
```typescript
const parsed = parseLlmJson(text, schema);
if (parsed.ok) return { payload: parsed.data, isError: parsed.data.ok === false };
if (isJsonLike(text)) return { payload: invalidJsonEnvelope(parsed), isError: true };
return { payload: undefined, isError: false };
```

Source: host-template acceptance criteria and JSON-like heuristic from canonical requirements. [CITED: JSON Validation Requirements.md §6.2.2, §7.4]

### Pattern 3: Text-First MCP Envelope Preservation

**What:** Continue returning `content: [{ type: 'text', text: ... }]`, only adding `structuredContent`/`isError` where the existing MCP surface expects it. [CITED: AGENTS.md] [CITED: JSON Validation Requirements.md §3.4 ASSUMPTION-02]

**When to use:** Host-template tool calls and user-visible parse failures. [CITED: JSON Validation Requirements.md §6.2.2, §6.3.1]

**Example:**
```typescript
return {
  content: [{ type: 'text', text }],
  ...(payload === undefined ? {} : { structuredContent: payload }),
  ...(isError ? { isError: true } : {}),
};
```

Source: current `callResultFromTemplateText()` shape. [VERIFIED: codebase grep]

### Anti-Patterns to Avoid

- **Global `JSON.parse()` replacement:** Scope is limited to named LLM-originated or LLM-adjacent parse sites. [CITED: JSON Validation Requirements.md §3.2]
- **Parser-owned retry loops:** Retry policy remains caller-controlled; the parser must not call an LLM. [CITED: JSON Validation Requirements.md §6.1.3]
- **Public success envelope churn:** Repair metadata is internally testable but should not add broad public top-level fields. [CITED: JSON Validation Requirements.md §6.3.2]
- **Strict native response parsing:** `parseNativeToolResponse()` is app-controlled and must stay unchanged unless a separate test proves a real issue. [CITED: JSON Validation Requirements.md §6.2.6]
- **Warning on ordinary prose:** Brokered external tools may legitimately return plain text; warn only for JSON-like fallback. [CITED: JSON Validation Requirements.md §6.2.5]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON repair | Custom tolerant parser, regex fixer, or fence stripper | `jsonrepair` | Official package repairs the required malformed cases and throws structured repair errors. [CITED: github.com/josdejong/jsonrepair README] |
| Schema validation | Manual `typeof` ladders for known envelopes | Zod `safeParse()` | Canonical invariant requires Zod `safeParse()` for known schemas. [CITED: JSON Validation Requirements.md §4 INV-04] |
| MCP result envelopes | Hand-built divergent error shapes | `jsonExpectedError()` / `jsonRuntimeError()` | Existing helpers preserve FlashQuery response conventions. [VERIFIED: codebase grep] [CITED: JSON Validation Requirements.md §6.3.1] |
| Public workflow harness | New ad hoc MCP runner | Existing Vitest/E2E/scenario harnesses | Test Plan names the existing harnesses and file analogs. [CITED: JSON Validation Test Plan.md §2] |

**Key insight:** The complexity is not parsing alone; it is preserving five different compatibility contracts while stopping silent structured-channel success. [CITED: JSON Validation Requirements.md §7.3]

## Common Pitfalls

### Pitfall 1: Treating Every Parse Failure The Same
**What goes wrong:** Host-template malformed structured payloads keep succeeding, or macro evaluator non-error prose becomes an error. [CITED: JSON Validation Requirements.md §6.2.1-§6.2.2]
**Why it happens:** A shared parser result is mapped without site-specific policy. [CITED: JSON Validation Requirements.md §7.3]
**How to avoid:** Plan one test and policy table per retrofit site. [CITED: JSON Validation Test Plan.md §4.2-§4.3]
**Warning signs:** A helper throws directly or returns only `undefined` on all failures. [VERIFIED: codebase grep]

### Pitfall 2: Losing Macro Trace, Warning, Budget, Or Token Behavior
**What goes wrong:** Repairing parsed payloads changes macro trace or token accounting. [CITED: JSON Validation Requirements.md §6.2.1]
**Why it happens:** `parseToolResultPayload()` feeds downstream macro value/error handling, while token extraction reads metadata separately at `extractTokenUsage()`. [VERIFIED: codebase grep]
**How to avoid:** Include T-U-014 regression coverage for `metadata.tokens` and `metadata.trace_cumulative.total_tokens`. [CITED: JSON Validation Test Plan.md §4.2.1]
**Warning signs:** Tests only assert repaired field access and skip metadata extraction. [CITED: JSON Validation Test Plan.md §4.2.1]

### Pitfall 3: Over-Broad JSON-Like Detection
**What goes wrong:** Plain external tool prose is logged as suspicious or converted into an error. [CITED: JSON Validation Requirements.md §6.2.5]
**Why it happens:** A heuristic treats any text containing braces as structured intent. [ASSUMED]
**How to avoid:** Use conservative starts-with object/array/fenced-json detection as specified. [CITED: JSON Validation Requirements.md §7.4]
**Warning signs:** `coerceCallToolResult()` warns on `"plain answer"` or host-template prose sets `isError`. [CITED: JSON Validation Test Plan.md T-U-018, T-U-030]

### Pitfall 4: Accepting Non-Object Provider Arguments
**What goes wrong:** Repaired provider arguments like `["x"]` or `"x"` become valid tool arguments. [CITED: JSON Validation Requirements.md §6.2.4]
**Why it happens:** Repair/parse succeeds but the object contract is not rechecked. [VERIFIED: codebase grep]
**How to avoid:** Validate with an object-record schema and preserve the existing invalid-argument throw. [CITED: JSON Validation Requirements.md §6.2.4]
**Warning signs:** Existing invalid JSON tests are changed to accept `{}` or arrays. [CITED: JSON Validation Test Plan.md T-U-025, T-U-026]

### Pitfall 5: Scenario Coverage Drift
**What goes wrong:** New directed/YAML scenarios are added without coverage matrix rows. [CITED: JSON Validation Test Plan.md §3]
**Why it happens:** Public workflow verification is treated as optional evidence rather than part of the traceability gate. [CITED: .planning/ROADMAP.md Phase 170]
**How to avoid:** If adding directed or YAML scenarios, update `DIRECTED_COVERAGE.md` or `INTEGRATION_COVERAGE.md` with ML-33, ML-34, or IL-45-style rows. [CITED: JSON Validation Test Plan.md §7]
**Warning signs:** Scenario files exist but matrices have no Phase 170 coverage rows. [VERIFIED: codebase grep]

## Code Examples

### `jsonrepair` ESM Import
```typescript
import { jsonrepair } from 'jsonrepair';

const repaired = jsonrepair("{name: 'John'}");
const parsed = JSON.parse(repaired);
```
Source: official `jsonrepair` README via Context7. [CITED: github.com/josdejong/jsonrepair README]

### Parser Result Shape
```typescript
type LlmJsonParseResult<T> =
  | { ok: true; data: T; raw: string; repaired: boolean }
  | {
      ok: false;
      raw: string;
      repaired: boolean;
      failure: 'syntax' | 'schema';
      issues?: Array<{ path: Array<string | number>; message: string }>;
      summary: string;
    };
```
Source: canonical parse contract; exact type names may differ but semantics must remain. [CITED: JSON Validation Requirements.md §7.1]

### Existing Response Helpers
```typescript
jsonExpectedError({ error: 'invalid_json_payload', message: 'Structured JSON payload could not be parsed.' });
jsonRuntimeError({ error: 'invalid_json_payload', message: 'Structured JSON payload could not be parsed.' });
```
Source: helper names and behavior verified in `src/mcp/utils/response-formats.ts`. [VERIFIED: codebase grep]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Raw `JSON.parse()` with silent fallback at LLM-adjacent sites | `jsonrepair` + `JSON.parse()` + Zod `safeParse()` with site-specific error mapping | Phase 170 planned for 2026-06-22 | Planner must include tests for repairable and irreparable payloads per site. [CITED: .planning/ROADMAP.md] |
| Public path tests only after implementation | Inline TDD per behavior slice | Phase 170 execution constraint | Planner must require RED/GREEN evidence for each behavior slice. [CITED: .planning/ROADMAP.md] |
| Native tool response parsing included in broad parse cleanup | Native response parsing remains unchanged | Locked by Phase 170 context | Planner must add regression tests, not implementation changes. [CITED: .planning/phases/170-json-validation-and-repair-infrastructure/170-CONTEXT.md] |

**Deprecated/outdated:**
- Raw silent structured-channel parse failure for host templates and macro task results is no longer acceptable. [CITED: JSON Validation Requirements.md §6.2.2-§6.2.3]
- Custom JSON repair logic is out of scope when `jsonrepair` satisfies the use cases. [CITED: JSON Validation Requirements.md §6.1.1]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Over-broad JSON-like detection can warn on ordinary prose if implemented naively. | Common Pitfalls | Planner may not include enough negative prose tests. |

## Open Questions

1. **Should public workflow verification include directed scenarios, YAML scenarios, or both?**
   - What we know: The context allows either or both, but matrices must be updated for any added scenario coverage. [CITED: .planning/phases/170-json-validation-and-repair-infrastructure/170-CONTEXT.md]
   - What's unclear: Which scenario layer gives the best time/value tradeoff after unit, integration, and E2E coverage land. [ASSUMED]
   - Recommendation: Require at least the Vitest integration/E2E commands from the roadmap; add directed/YAML only where behavior is publicly observable and update matrices. [CITED: JSON Validation Test Plan.md §2.4-§2.5]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build, tests, runtime | yes | v26.0.0 | Meets `>=20`; no fallback needed. [VERIFIED: command output] |
| npm | Dependency install and scripts | yes | 11.12.1 | No fallback needed. [VERIFIED: command output] |
| Python 3 | Scenario runners | yes | 3.12.3 | No fallback needed. [VERIFIED: command output] |
| `slopcheck` | Package legitimacy gate | yes | 0.6.1 | Use non-JSON output because local CLI rejects `--json`. [VERIFIED: command output] |
| `.env.test` | Integration/E2E tests needing Supabase/env | yes | present | Tests may still skip if values are incomplete; helper reads env centrally. [VERIFIED: command output] [VERIFIED: tests/helpers/test-env.ts] |
| Docker | Preflight/docker validation if run | yes | Command exists; exact version string not returned by probe because `docker --version` emitted no output. [VERIFIED: command output] | Not needed for Phase 170 focused commands. [CITED: .planning/ROADMAP.md] |

**Missing dependencies with no fallback:** none found for research/planning. [VERIFIED: command output]

**Missing dependencies with fallback:** none found for research/planning. [VERIFIED: command output]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.1` for unit/integration/E2E; Python scenario runners for directed/YAML scenarios. [VERIFIED: package.json] [CITED: JSON Validation Test Plan.md §2] |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts`. [VERIFIED: codebase grep] |
| Quick run command | `npm run test:unit -- tests/unit/llm-json-repair.test.ts` [CITED: .planning/ROADMAP.md] |
| Full suite command | Use roadmap-required focused set plus `npm run typecheck` and `npm run build`; full `npm test` is optional broader regression. [CITED: .planning/ROADMAP.md] [VERIFIED: package.json] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-001 | Dependency and ESM import | unit/build | `npm run test:unit -- tests/unit/llm-json-repair.test.ts && npm run build` | no; Wave 0 create. [CITED: JSON Validation Test Plan.md §4.1.1] |
| REQ-002 | Parser valid/repairable/schema/syntax behavior | unit | `npm run test:unit -- tests/unit/llm-json-repair.test.ts` | no; Wave 0 create. [CITED: JSON Validation Test Plan.md §4.1.2] |
| REQ-003 | Syntax/schema discriminator and issue summaries | unit | `npm run test:unit -- tests/unit/llm-json-repair.test.ts` | no; Wave 0 create. [CITED: JSON Validation Test Plan.md §4.1.3] |
| REQ-004 | Macro evaluator repair and token regression | unit/integration/scenario optional | `npm run test:unit -- tests/unit/macro-evaluator.test.ts`; `npm run test:integration -- tests/integration/macro-json-repair.test.ts` | unit analog exists; integration file no. [VERIFIED: codebase grep] [CITED: JSON Validation Test Plan.md §4.2.1] |
| REQ-005 | Host-template structuredContent/error mapping | unit/E2E | `npm run test:unit -- tests/unit/host-template-tools.test.ts`; `npm run test:e2e -- tests/e2e/call-model-template-tools.e2e.test.ts` | unit file no; E2E file yes. [VERIFIED: codebase grep] [CITED: JSON Validation Test Plan.md §4.2.2] |
| REQ-006 | Macro task unreadable envelope fails | unit/integration | `npm run test:unit -- tests/unit/macro-task-result.test.ts`; `npm run test:integration -- tests/integration/macro-json-repair.test.ts` | no; Wave 0 create. [CITED: JSON Validation Test Plan.md §4.2.3] |
| REQ-007 | Provider argument repair with fail-loud preservation | unit | `npm run test:unit -- tests/unit/llm-client.test.ts` | yes. [VERIFIED: codebase grep] |
| REQ-008 | Brokered coercion repair/prose/warning/isError | unit | `npm run test:unit -- tests/unit/macro-coerce.test.ts` | yes. [VERIFIED: codebase grep] |
| REQ-009 | Native response unchanged | unit | `npm run test:unit -- tests/unit/macro-registry.test.ts` | yes. [VERIFIED: codebase grep] |
| REQ-010 | Structured parse errors use bounded stable envelopes | unit/integration/E2E | `npm run test:unit -- tests/unit/host-template-tools.test.ts tests/unit/macro-task-result.test.ts`; integration/E2E negative commands | target files partly missing. [CITED: JSON Validation Test Plan.md §4.2.4] |
| REQ-011 | Repair metadata internal only | unit/scenario optional | `npm run test:unit -- tests/unit/llm-json-repair.test.ts` | no; Wave 0 create. [CITED: JSON Validation Test Plan.md §4.1.4] |

### Sampling Rate

- **Per task commit:** Run the focused test file for the behavior slice just changed. [CITED: .planning/ROADMAP.md]
- **Per wave merge:** Run the roadmap command group for that lane. [CITED: .planning/ROADMAP.md]
- **Phase gate:** Run all roadmap-required commands: parser unit, retrofit unit groups, macro/host-template integration, host-template E2E, scenario commands for added scenarios, `npm run typecheck`, and `npm run build`. [CITED: .planning/ROADMAP.md]

### Wave 0 Gaps

- [ ] `tests/unit/llm-json-repair.test.ts` covers REQ-001, REQ-002, REQ-003, REQ-011. [CITED: JSON Validation Test Plan.md §4.1]
- [ ] `tests/unit/host-template-tools.test.ts` covers REQ-005 and REQ-010. [CITED: JSON Validation Test Plan.md §4.2.2, §4.2.4]
- [ ] `tests/unit/macro-task-result.test.ts` covers REQ-006 and REQ-010. [CITED: JSON Validation Test Plan.md §4.2.3, §4.2.4]
- [ ] `tests/integration/macro-json-repair.test.ts` covers T-I-001 and T-I-002. [CITED: JSON Validation Test Plan.md §4.2.3]
- [ ] `tests/integration/host-template-json-repair.test.ts` is required by roadmap final commands but not explicitly detailed in Test Plan tables; planner should either add it or surface the mismatch against canonical docs. [CITED: .planning/ROADMAP.md] [CITED: JSON Validation Test Plan.md §4.2.2]
- [ ] Scenario matrix rows ML-33, ML-34, and IL-45 only if directed/YAML scenarios are added. [CITED: JSON Validation Test Plan.md §7]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 170 does not change auth boundaries. [CITED: JSON Validation Requirements.md §3.1-§3.2] |
| V3 Session Management | no | MCP remains stateless and this phase must not add server-side session state. [CITED: AGENTS.md] |
| V4 Access Control | limited | Preserve existing macro host/delegated tool permissions; do not widen parser behavior into tool dispatch policy. [VERIFIED: codebase grep] |
| V5 Input Validation | yes | Use `jsonrepair`, `JSON.parse()`, and Zod `safeParse()` for structured LLM/provider inputs. [CITED: JSON Validation Requirements.md §7.2] |
| V6 Cryptography | no | Phase 170 does not add cryptography. [CITED: JSON Validation Requirements.md §3.1-§3.2] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed structured output silently treated as success | Tampering / Repudiation | Fail irreparable structured-channel payloads at host-template and macro-task sites. [CITED: JSON Validation Requirements.md §6.2.2-§6.2.3] |
| Excessive raw LLM output echoed in errors | Information Disclosure | Bound error details and avoid echoing large raw payloads by default. [CITED: JSON Validation Requirements.md §6.3.1] |
| Provider tool-call arguments degraded to `{}` | Tampering / Elevation of Privilege | Preserve fail-loud invalid-argument handling for irreparable and non-object values. [CITED: JSON Validation Requirements.md §6.2.4] |
| Warning/log flood from ordinary prose | Denial of Service | Warn only once on JSON-like fallback; do not warn on plain prose. [CITED: JSON Validation Requirements.md §6.2.5] |

## Sources

### Primary (HIGH confidence)
- `/josdejong/jsonrepair` Context7 docs - ESM import, repaired defect classes, `JSONRepairError`, stream API. [CITED: github.com/josdejong/jsonrepair README]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Graph Document Intelligence (Jun 2026)/JSON Validation Requirements.md` - canonical requirements and contracts. [CITED: local canonical doc]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Graph Document Intelligence (Jun 2026)/JSON Validation Test Plan.md` - canonical test cases and coverage matrix. [CITED: local canonical doc]
- `.planning/phases/170-json-validation-and-repair-infrastructure/170-CONTEXT.md` - locked decisions and scope. [CITED: local planning doc]
- `AGENTS.md` - project conventions and constraints. [CITED: AGENTS.md]
- Codebase grep/source reads for named files and tests. [VERIFIED: codebase grep]
- npm registry for `jsonrepair` package metadata. [VERIFIED: npm registry]

### Secondary (MEDIUM confidence)
- None. [VERIFIED: research source list]

### Tertiary (LOW confidence)
- A1 JSON-like heuristic warning risk based on implementation judgment. [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - `jsonrepair` verified through Context7, npm registry, and slopcheck; Zod/Vitest already in `package.json`. [VERIFIED: npm registry] [VERIFIED: slopcheck] [VERIFIED: package.json]
- Architecture: HIGH - Named parse sites and response helpers verified in source. [VERIFIED: codebase grep]
- Pitfalls: HIGH for canonical risks, LOW for the single heuristic implementation-risk assumption. [CITED: JSON Validation Requirements.md §6-§7] [ASSUMED]

**Research date:** 2026-06-22
**Valid until:** 2026-07-22 for codebase/planning findings; re-check npm metadata before implementation if delayed. [ASSUMED]
