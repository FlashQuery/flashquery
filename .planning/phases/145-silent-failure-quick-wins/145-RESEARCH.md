# Phase 145: Silent Failure Quick Wins - Research

**Researched:** 2026-05-24  
**Domain:** FlashQuery MCP memory writes and scanner embed-drain failure reporting  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

## Implementation Decisions

### Mandatory Source Documents

- Downstream planning, implementation, review, and verification agents MUST read the requirements spec first:
  `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Priority Remediation Requirements/Codebase Audit Priority Remediation Requirements.md`
- Downstream planning, implementation, review, and verification agents MUST read the test plan second:
  `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Priority Remediation Requirements/Codebase Audit Priority Remediation Test Plan.md`
- If those docs and this context conflict, the requirements spec and test plan win unless the phase plan explicitly documents a narrower Phase 145 interpretation.

### REQ-001 Locked Decisions

- `plugin_scope` omitted or exactly `global` continues to create a global-scoped memory.
- A successful `find_plugin_scope` RPC match continues to write the matched plugin scope.
- RPC errors and thrown lookup failures must return an MCP error envelope with reason `lookup_failed`.
- Lookup failure must not insert a global-scoped memory.
- The lookup result must use an explicit typed shape or runtime narrowing and remove the `as unknown as Promise<...>` double assertion at the lookup site.
- Tool help or metadata must describe visible lookup-failure behavior if plugin-scope behavior is documented there.

### REQ-002 Locked Decisions

- Scanner unembedded-document query failures continue the scan.
- Query failures must return `embeddingStatus: "drain_query_failed"` or an equivalent explicit union variant approved by the requirements.
- Both thrown query failures and Supabase error-object query failures map to the same explicit status.
- Query failure logging must use `logger.error` and a stable grep-friendly event string.
- Every formatter or consumer that branches on `ScanResult.embeddingStatus` must handle the new variant explicitly.

### Testing Decisions

- Unit coverage must include T-U-001 through T-U-005 from Test Plan Section 4.1.
- Integration coverage must include T-I-001 and T-I-002, or the phase summary must document why a test skipped due to missing `.env.test`.
- Directed scenario T-S-001 / D-68 is required if existing unit and integration coverage do not prove public MCP behavior end to end.
- Final verification must run `npm run typecheck` and `npm run lint`.

### the agent's Discretion

- Exact names for local TypeScript helper types are discretionary.
- Exact unit-test file split is discretionary, but prefer existing nearby files when that keeps tests focused.
- The exact public error message text is discretionary, but the parseable reason must be `lookup_failed`.
- The exact stable scanner event string is discretionary, but it must be unique enough for grep and should include `EMBED-DRAIN`.

### Deferred Ideas (OUT OF SCOPE)

## Deferred Ideas

- Durable embedding retry state is deferred to Phase 146.
- Background embedding helper consolidation is deferred to Phase 146.
- Record vector SQL pooling is deferred to Phase 146.
- MCP lifecycle and shutdown work is deferred to Phase 148.
- Cycle breaking and config metadata typing are deferred to Phases 149 and 150.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-001 | `write_memory` create-mode must hard-fail plugin-scope lookup failures and stop falling back to `global`. `[CITED: Codebase Audit Priority Remediation Requirements.md §6.1.1]` | `src/mcp/tools/memory.ts` has the full create-mode lookup and insert flow; tests can extend `tests/unit/write-memory.test.ts` and `tests/integration/write-memory.integration.test.ts`. `[VERIFIED: codebase grep]` |
| REQ-002 | Scanner `EMBED-DRAIN` unembedded-document query failures must continue scanning but report explicit partial-success status. `[CITED: Codebase Audit Priority Remediation Requirements.md §6.1.2]` | `src/services/scanner.ts` owns `ScanResult.embeddingStatus`; `src/services/maintenance.ts` is the direct consumer currently converting scan counts. `[VERIFIED: codebase grep]` |
</phase_requirements>

## Summary

Phase 145 is a codebase-local remediation phase with no new package selection. `[VERIFIED: 145-CONTEXT.md]` The standard stack is the existing Node.js 20+, TypeScript ESM, MCP SDK, Supabase client, and Vitest setup described in `AGENTS.md` and `package.json`. `[VERIFIED: AGENTS.md]` `[VERIFIED: package.json]`

The memory fix should change `resolvePluginScope` from `Promise<string>` to a discriminated result, use local runtime narrowing for the Supabase RPC payload, and return `jsonExpectedError({ error: "lookup_failed", details: { reason: "lookup_failed" } })` before the insert row is built when lookup fails. `[VERIFIED: src/mcp/tools/memory.ts]` The scanner fix should add `drain_query_failed` to `ScanResult.embeddingStatus`, set it for both Supabase error-object and thrown query failures, log with `logger.error` and a stable `[EMBED-DRAIN] drain_query_failed` string, and update every consumer or formatter that assumes the old status set. `[VERIFIED: src/services/scanner.ts]` `[VERIFIED: src/services/maintenance.ts]`

**Primary recommendation:** Implement REQ-001 first, then REQ-002, then documentation/consumer/test updates, with focused unit tests before integration/scenario coverage. `[VERIFIED: Test Plan §4.1]`

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `write_memory` plugin-scope lookup and insert gating | API / Backend | Database / Storage | MCP tool handler owns input handling and response envelopes; Supabase RPC/storage owns lookup and persistence. `[VERIFIED: src/mcp/tools/memory.ts]` |
| Scanner embed-drain query and status selection | API / Backend | Database / Storage | `runScanOnce` owns scan control flow and final `ScanResult`; Supabase provides unembedded-document query data. `[VERIFIED: src/services/scanner.ts]` |
| Maintenance sync response consumption | API / Backend | — | `maintainVault` calls `runScanOnce` and translates scan results into maintenance action output. `[VERIFIED: src/services/maintenance.ts]` |
| Public directed MCP behavior | MCP process / API | Test harness | Directed scenarios exercise public tool calls through the running FlashQuery MCP server. `[VERIFIED: tests/scenarios/directed/WRITING_SCENARIOS.md]` |

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20 LTS; `package.json` enforces this through `engines`. `[VERIFIED: AGENTS.md]`
- Keep TypeScript strict-mode ESM; do not introduce CommonJS `require`. `[VERIFIED: AGENTS.md]`
- Use `@modelcontextprotocol/sdk`, not `@modelcontextprotocol/server`. `[VERIFIED: AGENTS.md]`
- Do not build a web UI. `[VERIFIED: AGENTS.md]`
- MCP is stateless; do not implement server-side session state. `[VERIFIED: AGENTS.md]`
- Use `async/await`; MCP tool handlers catch failures internally and return `{ content: [{ type: "text", text: "..." }] }`, with `isError: true` on tool errors. `[VERIFIED: AGENTS.md]`
- Use Zod for external input validation. `[VERIFIED: AGENTS.md]`
- Unit tests live under `tests/unit/*.test.ts`; integration tests live under `tests/integration/*.test.ts`; E2E tests live under `tests/e2e/*.test.ts`; scenario tests live under `tests/scenarios/`. `[VERIFIED: AGENTS.md]`
- Integration and E2E tests use `.env.test` via `tests/helpers/test-env.ts` and skip gracefully when credentials are missing. `[VERIFIED: AGENTS.md]` `[VERIFIED: tests/helpers/test-env.ts]`
- Never use `npm link` for local development. `[VERIFIED: AGENTS.md]`

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | local `v24.7.0`; project requires >=20 LTS | Runtime | Required by project prerequisites and current environment satisfies it. `[VERIFIED: node --version]` `[VERIFIED: AGENTS.md]` |
| TypeScript | `^6.0.2` | Strict typed source | Project language and typecheck gate. `[VERIFIED: package.json]` |
| Vitest | `^4.1.1` | Unit and integration tests | Existing configured test runner. `[VERIFIED: package.json]` |
| `@modelcontextprotocol/sdk` | `^1.27.1` | MCP server/tool registration | Existing MCP SDK dependency. `[VERIFIED: package.json]` |
| `@supabase/supabase-js` | `^2.100.0` | Supabase data operations | Existing storage client used by memory and scanner. `[VERIFIED: package.json]` `[VERIFIED: src/mcp/tools/memory.ts]` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Zod | `^4.3.6` | Tool input schemas | Continue current MCP input schema pattern. `[VERIFIED: package.json]` `[VERIFIED: src/mcp/tools/memory.ts]` |
| `tsx` | `^4.21.0` | Development TypeScript execution | Existing dev script stack; no phase code should depend on it directly. `[VERIFIED: package.json]` |
| `tsup` | `^8.5.1` | Production build | Existing build command; Phase 145 only needs typecheck/lint/test. `[VERIFIED: package.json]` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Local discriminated result for `resolvePluginScope` | Throw from `resolvePluginScope` | Throwing would route through the generic `catch` and risks losing the parseable `lookup_failed` reason unless carefully wrapped. `[VERIFIED: src/mcp/tools/memory.ts]` |
| Extend `tests/unit/write-memory.test.ts` | New `tests/unit/write-memory-plugin-scope.test.ts` | Existing file already registers the handler and mocks Supabase/embedding/write-lock; a new file is cleaner only if lookup-specific cases make the file too large. `[VERIFIED: tests/unit/write-memory.test.ts]` |
| Extend `tests/unit/scanner.test.ts` | New `tests/unit/scanner-embed-drain-status.test.ts` | Existing scanner test has broad mocks but is large; a focused new file can isolate EMBED-DRAIN chain behavior. `[VERIFIED: tests/unit/scanner.test.ts]` |

**Installation:**
```bash
# No new external packages are recommended for Phase 145.
```

## Architecture Patterns

### System Architecture Diagram

```text
MCP caller
  |
  v
write_memory(mode:create)
  |
  +--> validate params/tags
  |
  +--> acquire optional write lock
  |
  +--> resolvePluginScope
       |
       +--> omitted/global -> { ok:true, scope:"global" }
       +--> find_plugin_scope success -> { ok:true, scope:<matched> }
       +--> RPC error/throw/unexpected shape -> { ok:false, reason:"lookup_failed" }
  |
  +--> if lookup_failed: return expected error before insert
  |
  +--> insert fqc_memory row and return JSON result
```

```text
maintain_vault(action:sync) / runScanOnce
  |
  v
scan filesystem + reconcile rows
  |
  v
EMBED-DRAIN Phase 2 query for active documents with NULL embedding
  |
  +--> query success + docs -> enqueue embed promises
  +--> query success + no docs -> status complete
  +--> query error object or throw -> log error, continue, status drain_query_failed
  |
  v
await embed promises with timeout
  |
  +--> timeout keeps timed_out precedence
  +--> otherwise preserve drain_query_failed when query failed
  +--> return ScanResult
```

### Recommended Project Structure

```text
src/
├── mcp/tools/memory.ts          # REQ-001 helper/result shape and create-mode behavior
├── mcp/tool-help/write_memory.tool.md  # user-visible plugin_scope failure docs
├── services/scanner.ts          # REQ-002 status union, query failure mapping, log event
└── services/maintenance.ts      # explicit consumer handling if status becomes visible

tests/
├── unit/write-memory.test.ts    # T-U-001..003, unless split becomes clearer
├── unit/scanner-embed-drain-status.test.ts  # T-U-004 focused drain tests
├── unit/maintain-vault.test.ts  # T-U-005 consumer handling
├── integration/mcp/tools/memory-plugin-scope.test.ts  # T-I-001, or extend existing write-memory integration
├── integration/services/scanner-embed-drain.test.ts   # T-I-002, or extend scan-command integration
└── scenarios/directed/testcases/test_write_memory_plugin_scope_lookup_failure.py  # D-68 if needed
```

### Pattern 1: Discriminated Result Before Insert

**What:** Return `{ ok: true; scope: string } | { ok: false; reason: "lookup_failed"; message: string }` from `resolvePluginScope`, then branch before constructing `insertRow`. `[CITED: 145-CONTEXT.md]`

**When to use:** Use for REQ-001 create-mode lookup because the failure must be expected and parseable, not a generic runtime exception. `[CITED: Codebase Audit Priority Remediation Requirements.md §6.1.1]`

**Example:**
```typescript
// Pattern only; implementation should match local names.
const scopeResult = await resolvePluginScope(config, params.plugin_scope as string | undefined);
if (!scopeResult.ok) {
  return jsonExpectedError({
    error: 'lookup_failed',
    message: scopeResult.message,
    details: { reason: scopeResult.reason },
  });
}
```

### Pattern 2: Narrow Supabase RPC Payload Locally

**What:** Model the RPC response as unknown and narrow it with a helper such as `isFindPluginScopeRpcResult(value)`, avoiding the current `as unknown as Promise<...>` double assertion. `[VERIFIED: src/mcp/tools/memory.ts]`

**When to use:** Use at the `find_plugin_scope` lookup site only; do not introduce generated Supabase types in this quick-win phase unless they already exist in the repo. `[ASSUMED]`

### Pattern 3: Status Precedence for EMBED-DRAIN

**What:** Track `drainQueryFailed` separately from `embedsAwaited`; set final `embeddingStatus` to `timed_out` if timed out, otherwise `drain_query_failed` if the query failed, otherwise existing complete behavior. `[VERIFIED: src/services/scanner.ts]` `[CITED: 145-CONTEXT.md]`

**When to use:** Use for REQ-002 because query failure must not abort scan but also must not report complete. `[CITED: Codebase Audit Priority Remediation Requirements.md §6.1.2]`

### Anti-Patterns to Avoid

- **Returning `'global'` from lookup errors:** This is the audited silent failure and violates REQ-001. `[CITED: Codebase Audit Priority Remediation Requirements.md §6.1.1]`
- **Letting query failure be only a log:** Current scanner warn logs still return `complete`; REQ-002 requires a result status. `[VERIFIED: src/services/scanner.ts]`
- **Generic runtime error for lookup failure:** A generic `runtime_error` would not expose parseable reason `lookup_failed`. `[CITED: 145-CONTEXT.md]`
- **Only adding a type union member:** Every branch/consumer that treats `embeddingStatus` as closed must handle the new variant explicitly. `[CITED: 145-CONTEXT.md]`

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP error serialization | Ad hoc `{ content: ... }` object literals | Existing `jsonExpectedError` / `jsonRuntimeError` helpers | They preserve the project response contract. `[VERIFIED: src/mcp/utils/response-formats.ts]` |
| Plugin-scope lookup fallback | Custom fallback-to-global behavior | Explicit discriminated lookup result | REQ-001 forbids plausible-success fallback on lookup failure. `[CITED: Codebase Audit Priority Remediation Requirements.md §6.1.1]` |
| Scanner status formatting | Unstructured strings in multiple files | Extend `ScanResult.embeddingStatus` union and central branching | Keeps compile-time pressure on consumers. `[VERIFIED: src/services/scanner.ts]` |
| Integration credential handling | Hardcoded test DB credentials | `tests/helpers/test-env.ts` and `describe.skipIf(!HAS_SUPABASE)` | Existing integration convention skips when `.env.test` is absent. `[VERIFIED: tests/helpers/test-env.ts]` |

**Key insight:** The failures are silent because the current code substitutes plausible successful states; the fix is to carry typed failure state to the MCP response or `ScanResult`, not to add more logging alone. `[CITED: Codebase Audit Priority Remediation Requirements.md §4 INV-02]`

## Common Pitfalls

### Pitfall 1: Returning Error After Acquiring Lock But Before Finally

**What goes wrong:** A new early return can skip lock release if it is placed outside the existing `try/finally`. `[VERIFIED: src/mcp/tools/memory.ts]`  
**Why it happens:** `write_memory` acquires the optional memory write lock before create/update branching and releases it in `finally`. `[VERIFIED: src/mcp/tools/memory.ts]`  
**How to avoid:** Keep lookup-failure return inside the existing `try` so `finally` releases the lock. `[VERIFIED: src/mcp/tools/memory.ts]`  
**Warning signs:** New code returns before line-equivalent lock acquisition or introduces a second lock path. `[VERIFIED: src/mcp/tools/memory.ts]`

### Pitfall 2: Treating No Match as Lookup Failure

**What goes wrong:** A plugin name with no fuzzy match could be converted into a hard failure even though current semantics use `matchedScope || "global"`. `[VERIFIED: src/mcp/tools/memory.ts]`  
**Why it happens:** REQ-001 targets RPC errors and thrown lookup failures, not necessarily null no-match results. `[CITED: Codebase Audit Priority Remediation Requirements.md §6.1.1]`  
**How to avoid:** Preserve accepted no-plugin/global semantics unless the external requirements docs explicitly say no-match must fail. `[CITED: 145-CONTEXT.md]`  
**Warning signs:** Tests assert `plugin_scope: "missing-plugin"` fails without an RPC error. `[ASSUMED]`

### Pitfall 3: Query Failure Status Overwritten By No Embeds

**What goes wrong:** `drainQueryFailed` is set, but the `embedsAwaited === 0` branch still sets `embeddingStatus = "complete"`. `[VERIFIED: src/services/scanner.ts]`  
**Why it happens:** Current final status logic derives status from embed promise count only. `[VERIFIED: src/services/scanner.ts]`  
**How to avoid:** Compute the final status with query-failure state before falling back to `complete`. `[CITED: 145-CONTEXT.md]`  
**Warning signs:** Unit tests pass for thrown query with preexisting embed promises but fail when no embed promises exist. `[ASSUMED]`

### Pitfall 4: Consumer Test Does Not Actually Exercise the New Variant

**What goes wrong:** `T-U-005` only checks that `maintain_vault` hides scanner internals, but not that the new variant is accepted without an unhandled branch. `[VERIFIED: tests/unit/maintain-vault.test.ts]`  
**Why it happens:** `scanCounts` currently ignores `embeddingStatus`; the test needs an explicit `drain_query_failed` mocked result to prevent future exhaustive-switch regressions. `[VERIFIED: src/services/maintenance.ts]`  
**How to avoid:** Add a focused maintain-vault test where `scannerMocks.runScanOnce` returns `embeddingStatus: "drain_query_failed"`. `[VERIFIED: tests/unit/maintain-vault.test.ts]`

## Code Examples

### Current Expected vs Runtime Error Helpers

```typescript
// Source: src/mcp/utils/response-formats.ts
export function jsonExpectedError(error: ErrorEnvelope): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(error) }], isError: false };
}

function jsonRuntimeErrorFromEnvelope(error: ErrorEnvelope): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(error) }], isError: true };
}
```

Use `jsonExpectedError` for `lookup_failed` if it is an expected, parseable operation failure; use `jsonRuntimeError` only if the planner intentionally treats lookup infrastructure failure as a runtime tool error. `[VERIFIED: src/mcp/utils/response-formats.ts]` `[CITED: 145-CONTEXT.md]`

### Current Memory Test Harness Pattern

```typescript
// Source: tests/unit/write-memory.test.ts
const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
const server = {
  registerTool: vi.fn((name, _config, handler) => {
    handlers[name] = handler;
  }),
} as unknown as McpServer;
```

Extend this harness to assert RPC error/throw prevents `.from('fqc_memory').insert(...)` and returns JSON containing `lookup_failed`. `[VERIFIED: tests/unit/write-memory.test.ts]`

### Current Scanner Mock Pattern

```typescript
// Source: tests/unit/scanner.test.ts
vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: {
    getClient: vi.fn(() => ({
      from: vi.fn().mockImplementation(createChainableQuery),
    })),
  },
}));
```

For T-U-004, use a focused query chain where the Phase 2 `.is('embedding', null)` path returns `{ data: null, error: { message: 'boom' } }` and a second case where the chain throws. `[VERIFIED: tests/unit/scanner.test.ts]` `[CITED: Test Plan §4.1.2]`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Silent fallback to global on plugin-scope RPC failure | Explicit `lookup_failed` MCP envelope and no insert | Phase 145 target | Prevents user data from being stored under the wrong scope. `[CITED: Codebase Audit Priority Remediation Requirements.md §6.1.1]` |
| Scanner query failure logged as warning then reported complete | Continue scan but return `drain_query_failed` and log error | Phase 145 target | Makes partial success visible to maintenance callers. `[CITED: Codebase Audit Priority Remediation Requirements.md §6.1.2]` |

**Deprecated/outdated:**
- `as unknown as Promise<{ data: string; error: ... }>` at the `find_plugin_scope` lookup site: must be removed in favor of explicit shape/narrowing. `[CITED: 145-CONTEXT.md]` `[VERIFIED: src/mcp/tools/memory.ts]`
- `[EMBED-DRAIN] failed to query unembedded docs` at warn level without status propagation: must become error-level status-bearing behavior. `[CITED: 145-CONTEXT.md]` `[VERIFIED: src/services/scanner.ts]`

## Exact Files Likely Touched

| File | Required? | Reason |
|------|-----------|--------|
| `src/mcp/tools/memory.ts` | yes | Change `resolvePluginScope`, remove double assertion, branch before insert, preserve lock release. `[VERIFIED: src/mcp/tools/memory.ts]` |
| `src/mcp/tool-help/write_memory.tool.md` | yes | `plugin_scope` docs currently say only "resolved when available"; requirements require lookup-failure behavior if documented. `[VERIFIED: src/mcp/tool-help/write_memory.tool.md]` |
| `src/mcp/tool-metadata.ts` | maybe | Metadata mentions `write_memory` but does not describe plugin-scope behavior in the inspected lines; touch only if implementation finds relevant help text there. `[VERIFIED: src/mcp/tool-metadata.ts]` |
| `src/services/scanner.ts` | yes | Add `drain_query_failed` union variant, status state, and error-level log. `[VERIFIED: src/services/scanner.ts]` |
| `src/services/maintenance.ts` | likely | Direct consumer of `ScanResult`; add explicit handling/test even if public output remains count-only. `[VERIFIED: src/services/maintenance.ts]` |
| `tests/unit/write-memory.test.ts` or `tests/unit/write-memory-plugin-scope.test.ts` | yes | T-U-001..003. `[CITED: Test Plan §4.1.1]` |
| `tests/unit/scanner.test.ts` or `tests/unit/scanner-embed-drain-status.test.ts` | yes | T-U-004. `[CITED: Test Plan §4.1.2]` |
| `tests/unit/maintain-vault.test.ts` | yes | T-U-005 consumer handling. `[CITED: Test Plan §4.1.2]` `[VERIFIED: tests/unit/maintain-vault.test.ts]` |
| `tests/integration/write-memory.integration.test.ts` or `tests/integration/mcp/tools/memory-plugin-scope.test.ts` | yes | T-I-001. `[CITED: Test Plan §4.1.1]` |
| `tests/integration/scan-command.integration.test.ts` or `tests/integration/services/scanner-embed-drain.test.ts` | yes | T-I-002. `[CITED: Test Plan §4.1.2]` |
| `tests/scenarios/directed/testcases/test_write_memory_plugin_scope_lookup_failure.py` | conditional | Required if unit/integration do not prove public MCP behavior end to end. `[CITED: 145-CONTEXT.md]` |
| `tests/scenarios/directed/DIRECTED_COVERAGE.md` | conditional | Add D-68 only if directed scenario is added. `[CITED: Test Plan §7]` |

## Recommended Implementation Order

1. Add or extend unit tests for REQ-001 failure and success cases around the handler; include assertions that insert is not called on RPC error or thrown lookup failure. `[CITED: Test Plan §4.1.1]`
2. Implement the `resolvePluginScope` discriminated result and create-mode early error branch inside the existing `try/finally`. `[VERIFIED: src/mcp/tools/memory.ts]`
3. Update `write_memory` help text for visible lookup failure behavior. `[VERIFIED: src/mcp/tool-help/write_memory.tool.md]`
4. Add scanner drain unit tests for Supabase error object and thrown query cases. `[CITED: Test Plan §4.1.2]`
5. Implement `drain_query_failed`, error-level `[EMBED-DRAIN]` logging, and final status precedence. `[VERIFIED: src/services/scanner.ts]`
6. Add maintain-vault consumer coverage with `embeddingStatus: "drain_query_failed"`. `[VERIFIED: tests/unit/maintain-vault.test.ts]`
7. Add integration tests T-I-001 and T-I-002 using existing `.env.test` skip conventions. `[VERIFIED: tests/helpers/test-env.ts]`
8. Add D-68 only if the integration test does not exercise the public MCP surface sufficiently. `[CITED: 145-CONTEXT.md]`
9. Run focused tests, then `npm run typecheck` and `npm run lint`. `[CITED: 145-CONTEXT.md]`

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Generated Supabase types should not be introduced for this quick-win phase unless already present. | Architecture Patterns | A planner may choose a larger typing task than the phase intends. |
| A2 | A no-match `find_plugin_scope` result should preserve current global behavior unless the external docs say otherwise. | Common Pitfalls | If product intent is stricter, implementation could keep an unwanted fallback. |
| A3 | Scanner query-failure tests should include an `embedsAwaited === 0` case. | Common Pitfalls | Missing this case could allow a fallthrough-to-complete regression. |

## Open Questions (RESOLVED)

1. **Should lookup failure use expected-error `isError:false` or runtime-error `isError:true`?**  
   Resolution: Use `jsonExpectedError`, not `jsonRuntimeError`. The Phase 145 context and planning decision classify `lookup_failed` as an anticipated, parseable operation failure similar to existing conflict/not_found expected envelopes. The returned JSON must include `error: "lookup_failed"` and `details.reason: "lookup_failed"`, and the tool result must not use runtime `isError: true`. `[CITED: 145-CONTEXT.md]` `[CITED: 145-PLAN.md]`

2. **Should `drain_query_failed` be visible in maintain-vault public output?**  
   Resolution: `drain_query_failed` must be explicit in `ScanResult.embeddingStatus` and covered in `src/services/maintenance.ts`, but maintenance output may continue hiding raw scanner internals such as `embedding_status` and `embeds_awaited`. The implementation must add consumer coverage so future changes cannot silently assume the old closed union. `[CITED: 145-CONTEXT.md]` `[CITED: 145-PLAN.md]`

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | TypeScript tooling and tests | yes | `v24.7.0` | Project minimum is >=20. `[VERIFIED: node --version]` |
| npm | Script execution | yes | `11.5.1` | — `[VERIFIED: npm --version]` |
| ripgrep | Codebase research and verification grep | yes | installed at VS Code extension path | Use `grep` if unavailable. `[VERIFIED: command -v rg]` |
| Supabase test credentials in `.env.test` | T-I-001 and T-I-002 | unknown | — | Tests should use `describe.skipIf(!HAS_SUPABASE)`. `[VERIFIED: tests/helpers/test-env.ts]` |
| Embedding API key | Existing `scan-command.integration.test.ts` only | unknown | — | Prefer scanner drain integration that does not require real embeddings, or skip if chosen test needs provider. `[VERIFIED: tests/integration/scan-command.integration.test.ts]` |

**Missing dependencies with no fallback:** none identified for unit work. `[VERIFIED: package.json]`

**Missing dependencies with fallback:**
- Supabase credentials may be missing; integration tests must skip through `HAS_SUPABASE`. `[VERIFIED: tests/helpers/test-env.ts]`

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.1` `[VERIFIED: package.json]` |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts` `[VERIFIED: package.json]` |
| Quick run command | `npm test -- tests/unit/write-memory.test.ts tests/unit/maintain-vault.test.ts` plus scanner focused file once created `[VERIFIED: package.json]` |
| Full suite command | `npm test && npm run test:integration && npm run typecheck && npm run lint` `[VERIFIED: package.json]` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REQ-001 / T-U-001 | omitted/global/matched plugin scope resolves correctly | unit | `npm test -- tests/unit/write-memory.test.ts` | yes `[VERIFIED: tests/unit/write-memory.test.ts]` |
| REQ-001 / T-U-002 | RPC error and thrown lookup produce `lookup_failed`, not global | unit | `npm test -- tests/unit/write-memory.test.ts` | yes, new cases needed `[VERIFIED: tests/unit/write-memory.test.ts]` |
| REQ-001 / T-U-003 | unexpected RPC shape rejected without double assertion | unit/static | `npm test -- tests/unit/write-memory.test.ts` | yes, new case needed `[CITED: Test Plan §4.1.1]` |
| REQ-001 / T-I-001 | public handler refuses failed lookup and no global insert | integration | `npm run test:integration -- tests/integration/mcp/tools/memory-plugin-scope.test.ts` | no, or extend existing integration `[VERIFIED: tests/integration/write-memory.integration.test.ts]` |
| REQ-001 / T-S-001 / D-68 | public MCP scenario returns `lookup_failed` and no fallback | directed scenario | `python3 tests/scenarios/directed/testcases/test_write_memory_plugin_scope_lookup_failure.py --managed` | no `[CITED: Test Plan §4.1.1]` |
| REQ-002 / T-U-004 | drain query error maps to `drain_query_failed` | unit | `npm test -- tests/unit/scanner-embed-drain-status.test.ts` | no `[CITED: Test Plan §4.1.2]` |
| REQ-002 / T-U-005 | status consumer handles new variant | unit | `npm test -- tests/unit/maintain-vault.test.ts` | yes, new case needed `[VERIFIED: tests/unit/maintain-vault.test.ts]` |
| REQ-002 / T-I-002 | forced unembedded-doc query failure returns partial-success status and logs error | integration | `npm run test:integration -- tests/integration/services/scanner-embed-drain.test.ts` | no `[CITED: Test Plan §4.1.2]` |

### Sampling Rate

- **Per task commit:** focused unit command for touched area. `[VERIFIED: package.json]`
- **Per wave merge:** `npm test && npm run typecheck && npm run lint`. `[VERIFIED: package.json]`
- **Phase gate:** `npm run typecheck` and `npm run lint` are mandatory; integration/scenario results or skips must be documented. `[CITED: 145-CONTEXT.md]`

### Wave 0 Gaps

- [ ] `tests/unit/write-memory.test.ts` needs T-U-001..003 lookup cases. `[CITED: Test Plan §4.1.1]`
- [ ] `tests/unit/scanner-embed-drain-status.test.ts` or focused additions to `tests/unit/scanner.test.ts` need T-U-004. `[CITED: Test Plan §4.1.2]`
- [ ] `tests/unit/maintain-vault.test.ts` needs T-U-005 with `embeddingStatus: "drain_query_failed"`. `[CITED: Test Plan §4.1.2]`
- [ ] `tests/integration/mcp/tools/memory-plugin-scope.test.ts` or existing write-memory integration needs T-I-001. `[CITED: Test Plan §4.1.1]`
- [ ] `tests/integration/services/scanner-embed-drain.test.ts` or existing scan integration needs T-I-002. `[CITED: Test Plan §4.1.2]`
- [ ] Directed D-68 files only if needed after unit/integration coverage review. `[CITED: 145-CONTEXT.md]`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Phase does not change auth. `[VERIFIED: 145-CONTEXT.md]` |
| V3 Session Management | no | MCP is stateless and phase does not add sessions. `[VERIFIED: AGENTS.md]` |
| V4 Access Control | yes | Do not let failed plugin scope lookup write data into global scope. `[CITED: Codebase Audit Priority Remediation Requirements.md §6.1.1]` |
| V5 Input Validation | yes | Keep Zod/input validation and runtime narrowing for external/RPC data. `[VERIFIED: src/mcp/tools/memory.ts]` |
| V6 Cryptography | no | Phase does not change cryptography. `[VERIFIED: 145-CONTEXT.md]` |

### Known Threat Patterns for FlashQuery MCP/Supabase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Scope confusion from failed lookup | Elevation of privilege / Information disclosure | Fail closed with `lookup_failed`; do not write global fallback. `[CITED: Codebase Audit Priority Remediation Requirements.md §6.1.1]` |
| Operational false success | Repudiation / Tampering | Return typed status `drain_query_failed` and error-level stable log. `[CITED: Codebase Audit Priority Remediation Requirements.md §6.1.2]` |
| RPC shape drift | Tampering | Runtime narrowing of unknown RPC result before using data. `[CITED: 145-CONTEXT.md]` |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/145-silent-failure-quick-wins/145-CONTEXT.md` - locked phase scope, decisions, test decisions. `[VERIFIED: local file read]`
- `.planning/ROADMAP.md` - Phase 145 goal, implementation scope, tests, success criteria. `[VERIFIED: local file read]`
- `Codebase Audit Priority Remediation Requirements.md` - REQ-001 and REQ-002 acceptance criteria. `[VERIFIED: local file read]`
- `Codebase Audit Priority Remediation Test Plan.md` - Section 4.1 T-U/T-I/T-S requirements. `[VERIFIED: local file read]`
- `AGENTS.md` - project stack, conventions, testing, MCP contract constraints. `[VERIFIED: local file read]`
- `src/mcp/tools/memory.ts` - current plugin-scope lookup, write lock, JSON error helper usage. `[VERIFIED: codebase grep]`
- `src/services/scanner.ts` - current `ScanResult.embeddingStatus` and EMBED-DRAIN flow. `[VERIFIED: codebase grep]`
- `src/services/maintenance.ts` - current scanner result consumer. `[VERIFIED: codebase grep]`
- `tests/unit/write-memory.test.ts`, `tests/unit/scanner.test.ts`, `tests/unit/maintain-vault.test.ts` - unit test patterns. `[VERIFIED: codebase grep]`
- `tests/integration/write-memory.integration.test.ts`, `tests/integration/scan-command.integration.test.ts`, `tests/helpers/test-env.ts` - integration patterns and skip behavior. `[VERIFIED: codebase grep]`

### Secondary (MEDIUM confidence)

- `tests/scenarios/directed/WRITING_SCENARIOS.md`, `tests/scenarios/directed/testcases/test_memory_plugin_scope.py` - directed scenario conventions and existing plugin-scope public scenario pattern. `[VERIFIED: codebase grep]`

### Tertiary (LOW confidence)

- None. No external web research was required because this phase is constrained to existing code patterns. `[VERIFIED: 145-CONTEXT.md]`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - verified from `AGENTS.md`, `package.json`, and local tool versions. `[VERIFIED: AGENTS.md]` `[VERIFIED: package.json]`
- Architecture: HIGH - all affected flows were traced in source. `[VERIFIED: codebase grep]`
- Pitfalls: HIGH for current-code risks, MEDIUM for product-intent open questions. `[VERIFIED: codebase grep]` `[ASSUMED]`

**Research date:** 2026-05-24  
**Valid until:** 2026-06-23 for source-code findings, or until any Phase 145 implementation changes these files.
