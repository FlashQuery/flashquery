# Phase 148: MCP Lifecycle and Shutdown - Research

**Researched:** 2026-05-24
**Domain:** MCP TypeScript SDK registration wrappers, request lifecycle tracking, graceful shutdown
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### Source-of-Truth Documents
- Downstream planning and implementation agents MUST read the requirements specification and companion test plan listed in `<canonical_refs>` before making implementation choices.
- If this context and the source docs disagree, the source docs win. If the source docs leave an implementation detail open, follow existing FlashQuery code patterns and AGENTS.md.
- Implementation agents should answer their own questions from the two source docs first; only escalate unresolved ambiguity after checking those documents.
- Every downstream plan must include the two source docs in its `<context>` or `<read_first>` sections so executor agents have the audit remediation contract in front of them.

### REQ-008: Typed MCP Registration Wrapping
- Remove the dead `server.tool` wrapping branch in `src/mcp/server.ts` unless a production caller is introduced and explicitly tested.
- Consolidate wrapping around `registerTool`, using `McpServer['registerTool']` or an equivalent typed function shape rather than `(server as any).registerTool`.
- Preserve correlation-ID context for every handler registered through `registerTool`.
- Preserve native tool catalog capture and host exposure filtering behavior currently owned by `src/mcp/tool-catalog.ts`.
- The plan must make wrapper ordering explicit enough that correlation IDs and catalog capture cannot silently override each other.
- The implementation must reduce or eliminate broad casts in the touched wrapper path, especially casts that would hide MCP SDK signature drift.

### REQ-009: In-Flight MCP Request Drain
- Add in-flight MCP request tracking on the typed registered-handler path, incrementing and decrementing exactly once for success, `isError` results, and thrown handler failures.
- Expose a drain or wait-for-idle API usable by `src/server/shutdown.ts` without introducing server-side session state.
- Replace the 100ms placeholder sleep in `drainMcpRequests` with a 15-second deadline.
- Shutdown must return promptly when there are zero in-flight MCP requests; do not keep an unconditional idle sleep.
- Shutdown must wait for active handlers to settle until the deadline and log a warning containing the remaining in-flight count if the deadline expires.
- The drain mechanism must avoid counter leaks that can deadlock shutdown, including when handlers throw or return error envelopes.

### Required Tests And Checks
- T-U-016: `tests/unit/native-tool-catalog.test.ts` still captures registered tools and help schemas after wrapper consolidation.
- T-U-017: `tests/unit/mcp-server-correlation.test.ts` proves a `registerTool` handler runs inside a fresh correlation-ID context.
- T-U-018: `tests/unit/mcp-server-correlation.test.ts` or adjacent coverage proves the current registration surface does not depend on a `server.tool` branch.
- T-E-001: an E2E server transport smoke test confirms tools remain callable after wrapper consolidation.
- T-U-019: `tests/unit/mcp-request-drain.test.ts` proves request tracking increments and decrements exactly once for success and error handlers.
- T-U-020: `tests/unit/mcp-request-drain.test.ts` proves wait-for-idle returns timeout metadata with remaining count for a hung handler.
- T-I-009: integration shutdown with zero in-flight requests returns promptly.
- T-I-010: integration SIGTERM mid-handler waits for handler completion before shutdown continues.
- T-I-011: integration hung-handler shutdown times out at 15 seconds and logs remaining count.
- T-S-003 / D-70: add a directed shutdown-during-write scenario only if needed to prove public MCP write safety beyond integration coverage.
- Final verification must include `npm run typecheck` and `npm run lint`; focused test commands should be listed in each plan.

### the agent's Discretion
- The exact shape and module placement for the in-flight tracker is open; prefer a small dependency-light helper that can be unit tested without spinning up the full MCP server.
- Whether request tracking lives in `src/mcp/server.ts`, `src/server/shutdown.ts`, or a new lifecycle helper is open, as long as dependency direction stays simple and shutdown can consume it cleanly.
- The exact E2E test file may be new or existing; prefer extending a stable server transport smoke test if one already exists.
- The directed scenario D-70 is conditional; include it if implementation or integration testing reveals a public-surface risk not covered by the planned unit/integration/E2E tests.

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

- Dependency update execution remains Phase 147 scope unless a tiny local typing adjustment is required by the wrapper consolidation.
- REQ-010 and REQ-011 cycle-breaking work belongs to Phase 149.
- REQ-012 config metadata typing belongs to Phase 150.
- Broad performance benchmarking is out of scope; use targeted lifecycle and shutdown timing assertions.
</user_constraints>

## Summary

Phase 148 should be planned as two tightly coupled implementation slices: first make `registerTool` wrapping typed and single-path, then put request tracking inside that same registered-handler wrapper so shutdown can wait on the actual MCP handler lifecycle. The source requirements explicitly identify `src/mcp/server.ts:140-177`, `src/mcp/tool-catalog.ts:47-83`, and `src/server/shutdown.ts:108-120` as the remediation surface. [CITED: Codebase Audit Priority Remediation Requirements.md §5.1, §6.4.1, §6.4.2] [VERIFIED: codebase grep]

The current production registration flow wraps correlation first, catalog second, and then adds a special `search_tools` override before registering native tools. `server.tool` wrapping exists only in the correlation wrapper and production tool modules register through `server.registerTool`; the only `.tool()` usage found is in tests. [VERIFIED: src/mcp/server.ts:140-177, src/mcp/server.ts:598-622, rg "registerTool|server.tool"] The planner should avoid adding a new production `.tool()` path and should instead make the `registerTool` wrapper order explicit enough that catalog capture, host filtering, correlation IDs, and request tracking all compose deterministically. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.1]

**Primary recommendation:** Create a small typed MCP lifecycle helper that exports a `RegisterToolFunction = McpServer['registerTool']`, composes catalog/correlation/drain behavior around `registerTool`, exposes `waitForIdle(timeoutMs)`, and lets `ShutdownCoordinator.drainMcpRequests()` call it with a 15_000ms deadline. [VERIFIED: Context7 /modelcontextprotocol/typescript-sdk registerTool docs] [VERIFIED: src/server/shutdown.ts:112-124]

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-008 | MCP server registration wrapping is consolidated and typed. Dead `server.tool` wrapping is removed, `registerTool` wrapping uses a typed function shape, and correlation-ID plus native-tool catalog behavior remains covered. | Use `McpServer['registerTool']`, keep registration via `registerTool`, preserve catalog capture in `src/mcp/tool-catalog.ts`, add T-U-016..018 and T-E-001. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.1] [VERIFIED: Context7 /modelcontextprotocol/typescript-sdk] |
| REQ-009 | Shutdown drains in-flight MCP requests with a 15-second deadline. In-flight request tracking waits for active handlers to settle, returns promptly when idle, and warns with remaining count on timeout. | Add tracker on registered-handler path, expose wait/drain API to `src/server/shutdown.ts`, replace current 100ms sleep, add T-U-019..020 and T-I-009..011. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.2] [VERIFIED: src/server/shutdown.ts:112-124] |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- Runtime is Node.js >= 20 LTS and TypeScript strict mode with ESM modules. [CITED: AGENTS.md]
- Use `@modelcontextprotocol/sdk` with `zod`; do not use `@modelcontextprotocol/server`. [CITED: AGENTS.md]
- FlashQuery is CLI + MCP only; do not add a web UI. [CITED: AGENTS.md]
- MCP uses stdio transport for subprocess hosts and streamable HTTP for configured HTTP transport. [CITED: AGENTS.md] [VERIFIED: src/mcp/server.ts:692-858]
- MCP tool handlers return `{ content: [{ type: "text", text: "..." }] }` and use `isError: true` on errors. [CITED: AGENTS.md]
- Use async/await; module boundaries should return typed failures rather than thrown exceptions where applicable. [CITED: AGENTS.md]
- Use Zod for external input validation. [CITED: AGENTS.md]
- Unit tests live under `tests/unit/*.test.ts`, integration tests under `tests/integration/*.test.ts`, E2E tests under `tests/e2e/*.test.ts`, and scenario tests under `tests/scenarios/`. [CITED: AGENTS.md]
- Do not use `npm link` for local development. [CITED: AGENTS.md]
- Final checks for this phase must include `npm run typecheck` and `npm run lint`. [CITED: 148-CONTEXT.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| MCP tool registration wrapping | API / Backend | — | Tool handlers are registered inside the MCP server process before stdio or HTTP transport handles calls. [VERIFIED: src/mcp/server.ts:583-858] |
| Native tool catalog capture | API / Backend | LLM tool registry | Catalog capture records native tool definitions for host exposure and agent/native dispatch. [VERIFIED: src/mcp/tool-catalog.ts:47-83, src/mcp/server.ts:633-635] |
| Correlation ID context | API / Backend | Logging | AsyncLocalStorage context is established around each registered handler and consumed by the logger. [VERIFIED: src/logging/context.ts:1-50, src/logging/logger.ts:62] |
| In-flight MCP request tracking | API / Backend | Shutdown coordinator | The counter must wrap the registered MCP handler lifecycle and shutdown only consumes a wait/drain API. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.2] |
| Graceful shutdown drain | API / Backend | OS process lifecycle | `ShutdownCoordinator` receives SIGINT/SIGTERM/SIGHUP, sets shutdown state, then drains MCP before cost writes, HTTP close, DB cleanup, and process exit. [VERIFIED: src/server/shutdown.ts:46-105, src/server/shutdown.ts:294-322] |
| Directed shutdown-during-write scenario | External test harness | API / Backend | D-70 is only needed if public MCP write safety is not proven by integration/E2E tests. [CITED: Codebase Audit Priority Remediation Test Plan.md §4.4.2] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | Installed range `^1.27.1`; npm latest `1.29.0`, published 2026-03-30. | MCP server, `McpServer`, stdio transport, streamable HTTP transport, MCP client fixtures. | Official MCP TypeScript SDK; docs show `server.registerTool(name, config, callback)` as the current config-object API. [VERIFIED: npm registry] [VERIFIED: Context7 /modelcontextprotocol/typescript-sdk] |
| `zod` | Existing project dependency. | MCP input schemas and schema extension for native help. | Existing MCP tool registrations and catalog helper use Zod schemas. [VERIFIED: src/mcp/tool-catalog.ts:1-32] |
| `vitest` | Installed range `^4.1.1`; npm latest `4.1.7`, published 2026-05-20. | Unit, integration, and E2E test runner. | Existing scripts and configs use Vitest for all TypeScript test layers. [VERIFIED: npm registry] [VERIFIED: package.json scripts] |
| Node.js | Local `v24.7.0`; project requires >=20 LTS. | Runtime, subprocess, HTTP, async hooks, timers. | Project runtime and `AsyncLocalStorage` support. [VERIFIED: local command] [CITED: AGENTS.md] |

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| `@modelcontextprotocol/sdk/client` + `StdioClientTransport` | Same package as SDK. | E2E transport smoke tests. | Extend or reuse `tests/helpers/mcp-server-fixture.ts` and `tests/e2e/protocol.test.ts` for T-E-001. [VERIFIED: tests/helpers/mcp-server-fixture.ts:16-45, tests/e2e/protocol.test.ts:201-212] |
| Node `http` | Built-in. | Shutdown integration tests using real HTTP server/socket lifecycle. | Extend or replace `tests/integration/shutdown.integration.test.ts` for T-I-009..011. [VERIFIED: tests/integration/shutdown.integration.test.ts:11-165] |
| Python 3 | Local `3.12.3`. | Directed scenario runner if D-70 is added. | Only use if integration/E2E does not prove public write safety. [VERIFIED: local command] [CITED: Codebase Audit Priority Remediation Test Plan.md §2.4, §4.4.2] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Shared typed `registerTool` helper | Keep separate wrappers in `server.ts` and `tool-catalog.ts` | Current separate wrappers already caused broad casts and order risk; consolidation is required by REQ-008. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.1] |
| Handler-level in-flight counter | Transport/session tracking | Source requirement is to track active handlers; current shutdown notes say no transport list is available for stdio. [VERIFIED: src/server/shutdown.ts:112-124] [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.2] |
| Unit/integration drain tests | Directed D-70 only | Directed scenarios are public-surface and slower; test plan makes D-70 conditional. [CITED: Codebase Audit Priority Remediation Test Plan.md §4.4.2] |

**Installation:**

No new external packages are recommended for Phase 148. [VERIFIED: codebase inspection] Keep implementation dependency-light and use existing Node, SDK, and Vitest stack. [CITED: 148-CONTEXT.md]

**Version verification:**

```bash
npm view @modelcontextprotocol/sdk version time --json
npm view vitest version time --json
node --version
npm --version
python3 --version
```

## Package Legitimacy Audit

No new external packages should be installed in this phase. [VERIFIED: phase scope] Package legitimacy gate is not applicable because the recommended implementation uses existing project dependencies only. [CITED: 148-CONTEXT.md]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| none | — | — | — | — | — | No install needed |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```text
MCP client tools/call
  -> SDK transport (stdio or streamable HTTP)
  -> McpServer registered tool handler
  -> typed registerTool wrapper chain
       -> native catalog capture and host exposure filtering
       -> in-flight tracker increments
       -> correlation ID AsyncLocalStorage context starts
       -> real tool handler executes
       -> finally: in-flight tracker decrements and notifies waiters
  -> CallToolResult returned to SDK transport

SIGINT / SIGTERM / SIGHUP
  -> ShutdownCoordinator.execute()
  -> setShuttingDown(true) blocks new handler work at tool entry checks
  -> waitForIdle(15_000ms)
       -> if active count == 0: return immediately
       -> if active count reaches 0: continue shutdown
       -> if timeout: return remaining count and log warning
  -> drain cost writes
  -> close HTTP server / sockets
  -> flush Supabase and pg pools
  -> release Git mutex
  -> close stdio / process exit
```

### Recommended Project Structure

```text
src/
├── mcp/
│   ├── server.ts              # createMcpServer/initMCP; apply wrapper helper before registrations
│   ├── tool-catalog.ts        # preserve catalog API; move typed wrapper pieces here or into lifecycle helper
│   └── request-lifecycle.ts   # recommended new small helper for typed handler wrapping + waitForIdle
├── server/
│   ├── shutdown.ts            # call MCP lifecycle waitForIdle(15_000) instead of sleeping 100ms
│   └── shutdown-state.ts      # existing global shutdown flag; do not store per-session state here
└── logging/
    └── context.ts             # existing AsyncLocalStorage correlation primitives
```

### Pattern 1: Typed `registerTool` Wrapper

**What:** Use `type RegisterToolFunction = McpServer['registerTool']` and assign a function compatible with the SDK method shape, avoiding `(server as any).registerTool`. [VERIFIED: src/mcp/tool-catalog.ts:12, node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts:139-148]

**When to use:** Apply once before native tool registrations in `createMcpServer`, and ensure all production MCP tool modules still register through `server.registerTool`. [VERIFIED: src/mcp/server.ts:598-632, rg "server.registerTool("]

**Example:**

```typescript
// Source: Context7 /modelcontextprotocol/typescript-sdk and local SDK d.ts
type RegisterToolFunction = McpServer['registerTool'];

const originalRegisterTool: RegisterToolFunction = server.registerTool.bind(server);
server.registerTool = ((name, config, cb) => {
  const wrapped = wrapToolHandler(cb);
  return originalRegisterTool(name, config, wrapped);
}) as RegisterToolFunction;
```

### Pattern 2: `try/finally` Request Counter Balance

**What:** Increment immediately before invoking the real handler and decrement in `finally`, so success, `isError` results, validation-visible error envelopes, and thrown failures all balance. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.2]

**When to use:** Wrap the callback passed to SDK `registerTool`; do not try to infer request lifecycle from response envelopes after the SDK call has already returned. [VERIFIED: node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts:252-261]

**Example:**

```typescript
// Source: REQ-009 + existing AsyncLocalStorage context pattern
async function trackedHandler(args: unknown, extra: unknown): Promise<CallToolResult> {
  lifecycle.begin();
  try {
    return await initializeContext(generateCorrelationId(), async () => {
      return await realHandler(args, extra);
    });
  } finally {
    lifecycle.end();
  }
}
```

### Pattern 3: Drain Result Metadata

**What:** Return structured drain metadata such as `{ timedOut: boolean; remaining: number; elapsedMs: number }` from `waitForIdle`. [CITED: Codebase Audit Priority Remediation Test Plan.md §4.4.2]

**When to use:** Unit tests can assert timeout metadata without waiting 15 seconds by passing a short timeout. Production shutdown passes 15_000ms. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.2]

**Example:**

```typescript
// Source: REQ-009 timeout acceptance criteria
const result = await mcpRequestLifecycle.waitForIdle(15_000);
if (result.timedOut) {
  logger.warn(`MCP request drain timed out with ${result.remaining} in-flight request(s)`);
}
```

### Anti-Patterns to Avoid

- **Wrapping `server.tool`:** Production code has no current `.tool()` registrations, and REQ-008 requires deleting the branch unless a production caller is introduced and tested. [CITED: 148-CONTEXT.md] [VERIFIED: rg "server.tool|.tool(" src tests]
- **Using `(server as any).registerTool`:** Broad casts hide MCP SDK signature drift, which this phase is explicitly meant to expose to TypeScript. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.1]
- **Unconditional shutdown sleep:** Current 100ms placeholder delays idle shutdown and does not prove active requests drained. [VERIFIED: src/server/shutdown.ts:112-124]
- **Counting only success paths:** A handler that returns `isError: true` or throws must still decrement, or shutdown can deadlock. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.2]
- **Putting request state in client sessions:** AGENTS.md says MCP is stateless and this phase must avoid server-side session state. [CITED: AGENTS.md] [CITED: 148-CONTEXT.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP protocol tool registration | Custom JSON-RPC router | `McpServer.registerTool` from `@modelcontextprotocol/sdk` | SDK owns tool validation, handler dispatch, and transport integration. [VERIFIED: Context7 /modelcontextprotocol/typescript-sdk] |
| Async request correlation | Manual request ID parameters through every tool | Existing `AsyncLocalStorage` helpers in `src/logging/context.ts` | Existing logger reads the active context and tool code already relies on wrapper-level propagation. [VERIFIED: src/logging/context.ts:1-50, src/logging/logger.ts:62] |
| Shutdown coordination | New process signal manager | Existing `ShutdownCoordinator` | It already sequences shutdown and owns SIGINT/SIGTERM/SIGHUP handlers. [VERIFIED: src/server/shutdown.ts:46-105, src/server/shutdown.ts:294-322] |
| Timed drain polling with sleeps in production paths | Fixed sleeps or repeated 500ms loops for MCP requests | Promise waiter/notify pattern in lifecycle helper | Zero in-flight requests must return promptly and active requests should resume shutdown immediately when the counter hits zero. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.2] |

**Key insight:** This phase is not a transport rewrite; the correct join point is the typed registered handler because it is the one surface shared by stdio and streamable HTTP MCP calls. [VERIFIED: src/mcp/server.ts:692-858] [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.2]

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None. This refactor changes MCP handler wrapping and shutdown timing, not persisted row keys or schema. Verified by phase scope and source requirements. [CITED: 148-CONTEXT.md] | No data migration. |
| Live service config | None. No external service names, dashboards, or UI-held config are changed by wrapper/drain implementation. [CITED: 148-CONTEXT.md] | No live config update. |
| OS-registered state | None. Signal handlers remain in-process and no launchd/systemd/pm2 registration names are changed. [VERIFIED: src/server/shutdown.ts:294-322] | No OS re-registration. |
| Secrets/env vars | None. No env var names or secret keys are in scope. [CITED: 148-CONTEXT.md] | No secret rename. |
| Build artifacts | None specific to this phase. TypeScript build output may need regeneration only through normal `npm run build`/test setup. [CITED: AGENTS.md] | No installed-package migration. |

**Nothing found in category:** All five runtime-state categories above were explicitly checked against the phase scope and touched modules. [VERIFIED: codebase inspection]

## Common Pitfalls

### Pitfall 1: Wrapper Order Silently Changes Behavior

**What goes wrong:** Catalog capture records one handler while correlation/drain wraps another, or host exposure filtering bypasses tracking. [VERIFIED: src/mcp/server.ts:598-622, src/mcp/tool-catalog.ts:47-83]
**Why it happens:** `createMcpServer` currently applies correlation, then catalog, then a `search_tools` override; another wrapper can accidentally capture the wrong original function. [VERIFIED: src/mcp/server.ts:598-622]
**How to avoid:** Centralize wrapper composition in one helper or make the wrapper stack explicit in one file, then unit-test catalog capture and handler execution. [CITED: 148-CONTEXT.md]
**Warning signs:** More than one direct assignment to `server.registerTool` remains, or casts to `never`/`any` grow around wrapper code. [VERIFIED: src/mcp/server.ts:609-621, src/mcp/tool-catalog.ts:78-79]

### Pitfall 2: Hidden Tool Filtering Breaks Native Catalog

**What goes wrong:** Host-disabled tools disappear from the native catalog, breaking macro/agent native dispatch metadata. [VERIFIED: src/mcp/tool-catalog.ts:54-78]
**Why it happens:** Host exposure filters SDK registration, but the catalog intentionally records full native membership first. [VERIFIED: src/mcp/tool-catalog.ts:54-78]
**How to avoid:** Preserve the current order: build catalog entry, then return `undefined` only for host-hidden SDK registration. [VERIFIED: src/mcp/tool-catalog.ts:69-78]
**Warning signs:** `getNativeToolCatalog(server)` no longer contains tools hidden from host `tools/list`. [VERIFIED: tests/unit/native-tool-catalog.test.ts]

### Pitfall 3: Counter Leaks on Thrown Handlers

**What goes wrong:** Shutdown waits until timeout or forever because a thrown handler never decremented the counter. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.2]
**Why it happens:** Increment/decrement is coded around returned values instead of `try/finally`. [ASSUMED]
**How to avoid:** T-U-019 should cover success, `isError: true`, and throw paths with exact active-count assertions. [CITED: Codebase Audit Priority Remediation Test Plan.md §4.4.2]
**Warning signs:** Unit tests assert only successful handler completion. [CITED: Codebase Audit Priority Remediation Test Plan.md §4.4.2]

### Pitfall 4: Integration Tests Wait 15 Seconds Needlessly

**What goes wrong:** T-I-011 makes the suite slow or flaky by actually waiting the full production deadline. [ASSUMED]
**Why it happens:** Production timeout is hardcoded and not injectable. [VERIFIED: current shutdown hardcodes other timeout values in src/server/shutdown.ts]
**How to avoid:** Keep production default at 15_000ms, but expose timeout injection or test-only direct helper tests for shorter unit coverage. Integration should prove the 15-second value where required, but focused unit tests should validate mechanics with short deadlines. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.2]
**Warning signs:** New unit tests have 15s waits or Vitest timeouts need large increases. [ASSUMED]

### Pitfall 5: Shutdown Flag Blocks the Test Handler Before It Can Drain

**What goes wrong:** T-I-010 intends to prove an active handler drains, but the handler checks `getIsShuttingDown()` at entry and exits before becoming active. [VERIFIED: rg "getIsShuttingDown()" src/mcp/tools]
**Why it happens:** Many tool handlers reject new work immediately after shutdown flag is set. [VERIFIED: src/server/shutdown.ts:57-61, rg "getIsShuttingDown()" src/mcp/tools]
**How to avoid:** Start the handler before sending SIGTERM, then assert shutdown waits for that already-running handler. [CITED: Codebase Audit Priority Remediation Test Plan.md §4.4.2]
**Warning signs:** Test sends SIGTERM before making the MCP call or only tests idle rejection. [ASSUMED]

## Code Examples

Verified patterns from official and local sources:

### Current SDK Tool Registration

```typescript
// Source: Context7 /modelcontextprotocol/typescript-sdk
server.registerTool(
  'greet',
  {
    description: 'Greet someone by name',
    inputSchema: z.object({ name: z.string() }),
  },
  async ({ name }) => ({
    content: [{ type: 'text', text: `Hello, ${name}` }],
  })
);
```

### Existing Catalog Capture Pattern

```typescript
// Source: src/mcp/tool-catalog.ts
type RegisterToolFunction = McpServer['registerTool'];
const originalRegisterTool = server.registerTool.bind(server);
server.registerTool = ((name, config, cb) => {
  catalog.push({ name, description: config.description ?? '', inputSchema: config.inputSchema ?? {}, handler: cb });
  return originalRegisterTool(name, config as never, cb as never);
}) as RegisterToolFunction;
```

### Existing Correlation Context Primitive

```typescript
// Source: src/logging/context.ts
export function initializeContext<T>(
  correlationId: string,
  callback: () => Promise<T>
): Promise<T> {
  return requestContext.run({ correlationId }, callback);
}
```

### Recommended Drain Helper Shape

```typescript
// Source: REQ-009 acceptance criteria and existing shutdown coordinator pattern
export interface McpDrainResult {
  timedOut: boolean;
  remaining: number;
  elapsedMs: number;
}

export async function waitForIdle(timeoutMs: number): Promise<McpDrainResult> {
  if (activeCount === 0) return { timedOut: false, remaining: 0, elapsedMs: 0 };
  // Use a notify promise that resolves when activeCount reaches zero, raced with timeout.
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `server.tool()` variadic registration | `server.registerTool(name, config, callback)` config-object registration | MCP SDK docs identify `server.tool` as deprecated and `registerTool` as replacement. [VERIFIED: Context7 /modelcontextprotocol/typescript-sdk] | Phase 148 should remove production `.tool` wrapper code and type against `registerTool`. |
| Placeholder shutdown sleep | Real handler-level in-flight tracking with deadline | Required by REQ-009 for v3.7. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.2] | Idle shutdown returns promptly; active handlers get up to 15 seconds. |
| Broad wrapper casts | `McpServer['registerTool']` typed wrapper | Required by REQ-008 for v3.7. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.1] | SDK signature drift becomes TypeScript-visible. |

**Deprecated/outdated:**

- `server.tool` wrapper branch in production code: out of scope unless a production caller is introduced and tested. [CITED: 148-CONTEXT.md]
- Unconditional `await setTimeout(100)`: replace with `waitForIdle(15_000)`. [VERIFIED: src/server/shutdown.ts:112-124] [CITED: 148-CONTEXT.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Counter leaks usually happen when decrement logic is based on returned values instead of `try/finally`. | Common Pitfalls | Planner may underemphasize thrown-handler coverage, causing shutdown timeout bugs. |
| A2 | Production timeout injection will make tests faster and less flaky if implemented carefully. | Common Pitfalls | Planner might add complexity that is not needed if direct helper tests are enough. |
| A3 | New tests that wait the full 15 seconds can become slow/flaky. | Common Pitfalls | Planner may accept unnecessarily slow validation. |
| A4 | T-I-010 must start the handler before SIGTERM to avoid shutdown-entry rejection. | Common Pitfalls | Test could pass without proving drain behavior. |

## Open Questions

1. **Should `search_tools` override be folded into the consolidated wrapper helper or left in `server.ts` after wrapper installation?**
   - What we know: `server.ts` currently wraps `search_tools` specially after catalog wrapping. [VERIFIED: src/mcp/server.ts:603-621]
   - What's unclear: Whether the cleanest implementation is one helper that accepts per-tool handler transforms, or a smaller lifecycle helper plus a retained local special case. [ASSUMED]
   - Recommendation: Keep the first plan slice focused on making current behavior explicit; do not move `search_tools` unless doing so reduces assignments to `server.registerTool`. [VERIFIED: src/mcp/server.ts:603-621]

2. **Is D-70 needed?**
   - What we know: The test plan makes T-S-003 / D-70 conditional. [CITED: Codebase Audit Priority Remediation Test Plan.md §4.4.2]
   - What's unclear: Whether T-I-010 with a real MCP write covers public write safety strongly enough. [ASSUMED]
   - Recommendation: Plan D-70 as a conditional final task only if integration/E2E coverage does not prove public shutdown-during-write behavior. [CITED: 148-CONTEXT.md]

3. **Should shutdown drain use a global tracker or per-server tracker collection?**
   - What we know: stdio has one initialized server, while streamable HTTP creates a server per session. [VERIFIED: src/mcp/server.ts:692-790]
   - What's unclear: Whether tests need per-server reset hooks to prevent cross-test leakage. [ASSUMED]
   - Recommendation: Use a process-level lifecycle helper with explicit `resetForTests()` only if needed, because shutdown is process-level and all per-session servers live in the same process. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.2]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | TypeScript runtime, tests, MCP server | yes | `v24.7.0` | Project minimum is Node >=20. [VERIFIED: local command] [CITED: AGENTS.md] |
| npm | Scripts and dependency metadata checks | yes | `11.5.1` | none needed |
| npx | E2E fixture runs `npx tsx` | yes | `11.5.1` | Use `npm run build` + `node dist/index.js` only if fixture is changed. [VERIFIED: tests/helpers/mcp-server-fixture.ts:36-42] |
| Python 3 | Directed scenario runner if D-70 is added | yes | `3.12.3` | Skip D-70 if not needed. [CITED: Codebase Audit Priority Remediation Test Plan.md §4.4.2] |
| `.env.test` | Supabase-backed integration/E2E tests | yes | file present | Tests should skip gracefully if incomplete. [VERIFIED: local file check] [CITED: AGENTS.md] |
| Supabase service | Integration/E2E behavior | unknown from static research | — | Existing test helpers gate/skip where credentials are absent. [CITED: AGENTS.md] |

**Missing dependencies with no fallback:**

- None detected during research. [VERIFIED: local command checks]

**Missing dependencies with fallback:**

- Supabase liveness was not probed to avoid side effects; `.env.test` exists and existing helpers handle missing/incomplete credentials. [VERIFIED: local file check] [CITED: AGENTS.md]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.1` in project, npm latest `4.1.7`; Python directed scenarios conditional. [VERIFIED: npm registry] |
| Config file | `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts`; unit tests use package default. [VERIFIED: tests/config] |
| Quick run command | `npm test -- tests/unit/native-tool-catalog.test.ts tests/unit/mcp-server-correlation.test.ts tests/unit/mcp-request-drain.test.ts` |
| Integration command | `npm run test:integration -- tests/integration/server/shutdown-mcp-drain.test.ts` |
| E2E command | `npm run test:e2e -- tests/e2e/protocol.test.ts` or new focused `tests/e2e/mcp-server-tools.test.ts` if created |
| Full suite command | `npm run typecheck && npm run lint && npm test && npm run test:integration && npm run test:e2e` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REQ-008 / T-U-016 | Catalog still captures registered tools and help schemas after wrapper consolidation. | unit | `npm test -- tests/unit/native-tool-catalog.test.ts` | yes |
| REQ-008 / T-U-017 | `registerTool` handler runs inside fresh correlation-ID context. | unit | `npm test -- tests/unit/mcp-server-correlation.test.ts` | no, Wave 0 |
| REQ-008 / T-U-018 | Current registration surface does not depend on `server.tool` branch. | unit/static | `npm test -- tests/unit/mcp-server-correlation.test.ts` plus `rg -n "server\\.tool|\\.tool\\(" src/mcp src/services src/llm` | no, Wave 0 |
| REQ-008 / T-E-001 | Server starts and tools are callable through transport after wrapper consolidation. | E2E | `npm run test:e2e -- tests/e2e/protocol.test.ts` or focused new E2E file | existing candidate yes |
| REQ-009 / T-U-019 | Counter increments/decrements exactly once for success and error handlers. | unit | `npm test -- tests/unit/mcp-request-drain.test.ts` | no, Wave 0 |
| REQ-009 / T-U-020 | `waitForIdle` returns timeout metadata with remaining count for hung handler. | unit | `npm test -- tests/unit/mcp-request-drain.test.ts` | no, Wave 0 |
| REQ-009 / T-I-009 | SIGTERM/shutdown with zero in-flight requests returns promptly. | integration | `npm run test:integration -- tests/integration/server/shutdown-mcp-drain.test.ts` | no, Wave 0 |
| REQ-009 / T-I-010 | SIGTERM mid-handler waits for handler completion before shutdown continues. | integration | `npm run test:integration -- tests/integration/server/shutdown-mcp-drain.test.ts` | no, Wave 0 |
| REQ-009 / T-I-011 | Hung handler times out at 15 seconds and logs remaining count. | integration | `npm run test:integration -- tests/integration/server/shutdown-mcp-drain.test.ts` | no, Wave 0 |
| REQ-009 / T-S-003 / D-70 | Managed shutdown during write does not corrupt or lose visible state. | directed scenario, conditional | `python3 tests/scenarios/directed/run_suite.py --managed` | no, conditional |

### Sampling Rate

- **Per task commit:** Run the focused unit command for touched behavior. [CITED: Codebase Audit Priority Remediation Test Plan.md §4.4]
- **Per wave merge:** Run focused unit + focused integration or E2E depending on wave. [CITED: Codebase Audit Priority Remediation Test Plan.md §4.4]
- **Phase gate:** `npm run typecheck`, `npm run lint`, focused unit/integration/E2E commands, and D-70 only if added. [CITED: 148-CONTEXT.md]

### Wave 0 Gaps

- [ ] `tests/unit/mcp-server-correlation.test.ts` - covers T-U-017 and T-U-018.
- [ ] `tests/unit/mcp-request-drain.test.ts` - covers T-U-019 and T-U-020.
- [ ] `tests/integration/server/shutdown-mcp-drain.test.ts` - covers T-I-009 through T-I-011 and must be added to `tests/config/vitest.integration.config.ts`.
- [ ] Focused E2E decision - either extend `tests/e2e/protocol.test.ts` for T-E-001 or add `tests/e2e/mcp-server-tools.test.ts`.
- [ ] Conditional directed scenario D-70 - only if integration/E2E do not prove public write safety.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no direct change | Keep existing HTTP auth middleware unchanged. [VERIFIED: src/mcp/server.ts:745-760] |
| V3 Session Management | yes for HTTP transport lifecycle | Do not add server-side session state; streamable HTTP session map remains transport-owned. [VERIFIED: src/mcp/server.ts:701-790] [CITED: AGENTS.md] |
| V4 Access Control | yes indirectly | Preserve host exposure filtering in `wrapServerWithToolCatalog`. [VERIFIED: src/mcp/tool-catalog.ts:75-78] |
| V5 Input Validation | yes | Keep SDK/Zod `registerTool` validation path; do not bypass SDK dispatch. [VERIFIED: Context7 /modelcontextprotocol/typescript-sdk] |
| V6 Cryptography | no | No cryptographic changes. [CITED: 148-CONTEXT.md] |
| V10 Server-Side Request Forgery | no | No outbound HTTP fetch behavior changes. [CITED: 148-CONTEXT.md] |
| V12 File and Resources | yes indirectly | Shutdown during write must not corrupt visible file/vault state; D-70 is conditional for public proof. [CITED: Codebase Audit Priority Remediation Test Plan.md §4.4.2] |

### Known Threat Patterns for MCP Lifecycle / Shutdown

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Hidden tool exposed after wrapper rewrite | Elevation of Privilege | Preserve hostEnabledToolNames filtering after catalog capture. [VERIFIED: src/mcp/tool-catalog.ts:75-78] |
| Request counter leak blocks shutdown | Denial of Service | `try/finally` decrement and timeout metadata with warning. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.2] |
| Shutdown races in-flight write | Tampering | Set shutdown flag to block new requests, drain existing active handlers before resource cleanup. [VERIFIED: src/server/shutdown.ts:57-78] [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.2] |
| SDK signature drift hidden by casts | Tampering / Reliability | Use `McpServer['registerTool']` typed wrapper and reduce broad casts. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.1] |

## Suggested Plan Slices

1. **Wave 0 tests and lifecycle helper contract:** Add failing unit tests for correlation/no-`.tool` dependency and request drain helper; design the typed helper API. [CITED: Codebase Audit Priority Remediation Test Plan.md §4.4]
2. **Typed wrapper consolidation:** Remove `server.tool` wrapper branch, compose catalog/correlation/request tracking around `registerTool`, preserve host filtering and `search_tools` behavior. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.1]
3. **Shutdown drain integration:** Replace `drainMcpRequests()` placeholder with `waitForIdle(15_000)` and warning logs on timeout; add idle/active/hung integration tests. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.2]
4. **Transport smoke and conditional public scenario:** Run or extend E2E tool-call smoke; add D-70 only if write safety remains unproven. [CITED: Codebase Audit Priority Remediation Test Plan.md §4.4]

## Sources

### Primary (HIGH confidence)

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Priority Remediation Requirements/Codebase Audit Priority Remediation Requirements.md` - REQ-008, REQ-009, source file locations, acceptance criteria.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Priority Remediation Requirements/Codebase Audit Priority Remediation Test Plan.md` - T-U-016..020, T-E-001, T-I-009..011, conditional T-S-003/D-70.
- `.planning/phases/148-mcp-lifecycle-and-shutdown/148-CONTEXT.md` - locked user decisions and downstream source-doc rule.
- `AGENTS.md` - project constraints and conventions.
- Context7 `/modelcontextprotocol/typescript-sdk` - `McpServer.registerTool` API and `server.tool` deprecation/migration guidance.
- Local SDK d.ts: `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` - installed method and callback types.
- `src/mcp/server.ts`, `src/mcp/tool-catalog.ts`, `src/server/shutdown.ts`, `src/logging/context.ts` - production implementation surfaces.

### Secondary (MEDIUM confidence)

- `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md` - v3.7 traceability and phase status.
- `tests/unit/native-tool-catalog.test.ts`, `tests/unit/shutdown.test.ts`, `tests/integration/shutdown.integration.test.ts`, `tests/e2e/protocol.test.ts`, `tests/helpers/mcp-server-fixture.ts` - existing test harness patterns.
- `npm view @modelcontextprotocol/sdk version time --json` and `npm view vitest version time --json` - registry version/publish metadata.

### Tertiary (LOW confidence)

- Assumptions in the Assumptions Log about likely test flakiness and helper injection tradeoffs.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - existing project stack and official SDK docs verified with Context7, npm registry, and local code.
- Architecture: HIGH - wrapper and shutdown paths inspected in production source.
- Pitfalls: MEDIUM - key risks come from source requirements and code shape; some test-flakiness advice is inferred.
- Validation: HIGH - required test IDs are directly from the source test plan and local test configs were inspected.

**Research date:** 2026-05-24
**Valid until:** 2026-06-23 for codebase-specific structure; re-check npm/SDK docs sooner if Phase 147 or dependencies change again.
