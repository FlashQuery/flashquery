# Phase 140: TOFU Schema Pinning And Tool-List Change Handling - Research

**Researched:** 2026-05-18  
**Domain:** MCP broker safety, TOFU schema pinning, tool-list notifications, macro re-approval exits  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### Canonical Source Priority
- Downstream agents MUST read the two MCP Broker docs listed in `<canonical_refs>` before making implementation, testing, or ambiguity-resolution decisions.
- If this `CONTEXT.md`, ROADMAP.md, or generated research/plan text appears to conflict with the MCP Broker Requirements or MCP Broker Test Plan, the downstream agent must treat the two MCP Broker docs as the higher-priority source and call out the conflict in the plan or summary.
- The MCP Broker Requirements doc is the source of truth for behavior and acceptance requirements.
- The MCP Broker Test Plan doc is the source of truth for test IDs, layers, and per-phase test coverage.

### Phase Scope
- Implement requirements `REQ-038..049`, `REQ-061..064`, `REQ-068`, `REQ-070`, and `REQ-105`.
- Treat related references needed to make those requirements work as in scope only where they are necessary for this phase's behavior, especially `REQ-101` and `REQ-102` for `description_override` interactions with TOFU hashing.
- Keep persistent TOFU across FlashQuery restarts out of scope.
- Keep HTTP transport, OAuth/DCR, MCP resources/prompts/sampling forwarding, semantic vector routing, and hot-reload out of scope.

### TOFU Schema Pinning
- TOFU is always on, in memory, and FlashQuery-process-scoped.
- The TOFU map is keyed by `<serverId>:<toolName>` and shared across host and delegated consumers.
- First observation is silently trusted and stored.
- Subsequent hash mismatch immediately blocks the changed tool from callable and indexed surfaces until resolved.
- The hash is SHA-256 over canonical JSON of `{name, description, inputSchema}` using the upstream original description, not `description_override`.
- Reconnects within the same FlashQuery process preserve the TOFU map.
- Config changes between starts effectively reset TOFU in v1 because TOFU is in memory only.

### Re-Approval Semantics
- Schema drift must produce a `needs_user_input` payload when invoked from a macro, and an equivalent host-mediated re-approval payload where applicable.
- The payload must include `event: schema_drift_detected`, `server`, `tool`, `old_schema`, `new_schema`, and `diff_summary`.
- Approval replaces the stored hash and restores the tool to the registry and indexer.
- Rejection preserves the old hash and keeps the tool removed until the upstream schema reverts to the trusted hash or a later interactive approval occurs.
- A single `notifications/tools/list_changed` event that changes multiple tools must produce one bundled re-approval payload rather than multiple prompts.
- Autonomous contexts with no live chat must block the tool, record `status: blocked_on_user`, and avoid prompting.

### `notifications/tools/list_changed`
- Subscribe to `notifications/tools/list_changed` at every brokered server connect.
- On notification, invalidate the cached tool list and re-fetch via `tools/list`.
- Use a reusable diff utility that classifies new, changed, and removed tools.
- New tools are hashed, stored, registered, and indexed.
- Changed tools enter the re-approval flow and are removed from the index until resolved.
- Removed tools are removed from registry and indexer, while the retained TOFU hash acts as a tombstone.
- Index updates from list-changed handling must be synchronous in the notification handler.

### Audit And Trace
- Every TOFU approval and rejection is audit-logged.
- Rejected reverse requests are audit-logged when observed.
- Autonomous drift blocks are traceable with `blocked_on_user`.

### Test Contract
- The implementation plan must include the Phase B test set from the MCP Broker Test Plan:
  - Unit: `T-U-035`.
  - Integration: `T-I-004..007`, `T-I-013..020`, `T-I-027`, `T-I-032a`, `T-I-032b`.
  - E2E: `T-E-B1`.
  - Directed scenarios: `T-S-003`, `T-S-004`, `T-S-005`, `T-S-017`.
  - YAML integration scenario: `T-Y-012`.
- Plans should also include any lower-level regression coverage needed to keep `REQ-038`, `REQ-101`, and `REQ-102` correct if the existing Phase A tests do not already cover them.

### the agent's Discretion
- Exact module decomposition is left to the planner and executor, but it should follow existing broker architecture and test conventions.
- Exact diff-summary formatting is discretionary as long as it is deterministic, human-readable, and includes enough old/new schema detail for user approval.
- Exact audit event field names may follow existing trace/audit conventions, but they must preserve the required semantics and be asserted in tests.

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

- Persistent TOFU storage across FlashQuery restarts.
- Streamable HTTP transport and OAuth/DCR.
- MCP resources, prompts, sampling, and elicitation forwarding.
- Semantic vector tool routing.
- Hot-reload of `flashquery.yml`.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-038 | SHA-256 over canonical JSON of `{name, description, inputSchema}`. | Existing `src/services/mcp-broker/tofu.ts` already implements stable recursive key sorting and SHA-256 over name, description, and inputSchema; planner should protect this and add drift-state call sites. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.5] |
| REQ-039 | TOFU storage in-memory and process-scoped. | Implement a process-lifetime map in broker/registry state, not filesystem, vault, or Supabase. [CITED: MCP Broker Requirements §7.5] |
| REQ-040 | First observation silently trusted. | Connect/discovery should store hash and register tool without prompt. [CITED: MCP Broker Requirements §7.5] |
| REQ-041 | Hash mismatch triggers re-approval and immediate block. | Add pending-drift state that removes tool from registry/indexed views before any later dispatch can see it. [CITED: MCP Broker Requirements §7.5] |
| REQ-042 | Re-approval payload includes old schema, new schema, diff summary. | Add deterministic payload builder and JSON diff summary utility. [CITED: MCP Broker Requirements §7.5] |
| REQ-043 | Approval replaces hash and restores tool. | Add approval resolver API that commits pending hash, re-registers current tool, and updates index seam. [CITED: MCP Broker Requirements §7.5] |
| REQ-044 | Rejection preserves old hash and removes tool. | Rejection must keep the trusted hash as tombstone and leave the changed tool unavailable. [CITED: MCP Broker Requirements §7.5] |
| REQ-045 | Single list_changed event supports bulk re-approval. | Diff application should aggregate changed tools per refresh cycle and emit one payload. [CITED: MCP Broker Requirements §7.5] |
| REQ-046 / REQ-070 | TOFU approvals and rejections are audit-logged. | Extend current `BrokerAuditEvent` union beyond reverse-request rejection and assert trace/log payloads. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.5 and §7.10] |
| REQ-047 | Removed tools retain TOFU map entries. | Diff removed path must unregister callable tool without deleting the TOFU hash. [CITED: MCP Broker Requirements §7.5] |
| REQ-048 | No prompt rate limiting in v1. | Planner should not add throttling, debounce, or cooldown logic for re-approval. [CITED: MCP Broker Requirements §7.5] |
| REQ-049 | No live chat means block, trace `blocked_on_user`, no prompt. | Consumer context needs an interactive/autonomous discriminator or equivalent option because current `ConsumerContext` only distinguishes host vs purpose. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.5] |
| REQ-061 | Subscribe to `notifications/tools/list_changed` at connect. | MCP SDK supports list-changed handlers and manual `setNotificationHandler`; planner should choose one path and avoid duplicate handlers. [VERIFIED: Context7] [VERIFIED: node_modules grep] |
| REQ-062 | Diff routing handles new, changed, removed. | Add reusable pure diff utility plus registry/TOFU application layer. [CITED: MCP Broker Requirements §7.9] |
| REQ-063 | Index updates synchronous in handler. | The canonical spec allows synchronous add/remove inside the notification handler based on SDK POC results. [CITED: MCP Broker Requirements §7.9] |
| REQ-064 | Diff utility reusable. | Keep diff classification pure and independent of BrokerClient. [CITED: MCP Broker Requirements §7.9] |
| REQ-068 | Rejected reverse requests are audit-logged. | Current Phase 139 code already audits rejected sampling requests via `fallbackRequestHandler`; Phase 140 should preserve and include in regression coverage. [VERIFIED: codebase grep] |
| REQ-105 | Macro `needs_user_input` exit reason. | Current macro evaluator has falloff, exit, fail, expected/runtime/cancelled paths but no `needs_user_input`; planner must add a first-class propagation error/result path. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.15] |
</phase_requirements>

## Summary

Phase 140 should be planned as a safety-state phase, not as a general broker expansion. The core work is to move TOFU from a helper hash into a state machine: trusted, pending re-approval, rejected/blocked, removed tombstone, and restored. This state must sit in memory for the FlashQuery process and be shared by host and delegated consumers through the existing `McpBroker`/`BrokerClient` stack. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.5]

The highest-risk implementation boundary is the interaction between `notifications/tools/list_changed`, registry visibility, macro `needs_user_input`, and the not-yet-built Phase 141 BM25 indexer. The canonical docs require synchronous registry and index updates in Phase 140, while the concrete BM25 implementation is scheduled for Phase 141; resolve this by creating a synchronous index-update seam/no-op adapter in Phase 140, then letting Phase 141 attach BM25 to the same seam. [CITED: MCP Broker Requirements §7.9] [CITED: .planning/ROADMAP.md Phase 140 and Phase 141]

**Primary recommendation:** implement TOFU as a broker-owned in-memory state machine with a pure diff layer, a synchronous registry/index update interface, and a macro-visible `needs_user_input` propagation path; do not add persistence or new packages. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.5]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| TOFU hash calculation | API / Backend | — | Broker process owns upstream tool discovery and schema comparison. [CITED: MCP Broker Requirements §7.5] |
| TOFU state map | API / Backend | — | In-memory process state belongs beside broker registry/client state, not vault or database. [CITED: MCP Broker Requirements §7.5] |
| Tool-list notification handling | API / Backend | External MCP server | External server emits `notifications/tools/list_changed`; FlashQuery client re-fetches and applies local state. [VERIFIED: Context7] [CITED: MCP spec tools] |
| Callable surface blocking | API / Backend | LLM agent loop / macro dispatcher | Registry-filtered views gate both `tool-dispatcher.ts` and `macro/registry.ts` brokered calls. [VERIFIED: codebase grep] |
| Indexed surface blocking | API / Backend | Future tool-search service | Phase 140 needs a sync update seam because BM25 lands in Phase 141. [CITED: .planning/ROADMAP.md] |
| Re-approval signaling | Macro engine | Host chat surface | Broker raises drift; macro termination path exposes `needs_user_input` for chat mediation. [CITED: MCP Broker Requirements §7.15] |
| Audit and trace | API / Backend | Logging | Existing broker audit/log path can be extended for TOFU decisions and blocked state. [VERIFIED: codebase grep] |

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20 LTS; current local Node is `v24.7.0`. [VERIFIED: command output] [CITED: AGENTS.md]
- Keep TypeScript strict and ESM; do not introduce CommonJS `require`. [CITED: AGENTS.md]
- Use `@modelcontextprotocol/sdk` with `zod`; do not use `@modelcontextprotocol/server`. [CITED: AGENTS.md]
- Use `async/await`; module-boundary failures should return typed errors where applicable. [CITED: AGENTS.md]
- MCP tool handlers must catch internally and return `isError: true` on failure. [CITED: AGENTS.md]
- Use Zod for external input validation. [CITED: AGENTS.md]
- Do not build a web UI. [CITED: AGENTS.md]
- Do not implement server-side session state; MCP remains stateless and context is per call. [CITED: AGENTS.md]
- Run unit tests with `npm test`, integration with `npm run test:integration`, E2E with `npm run test:e2e`. [CITED: AGENTS.md]
- Do not use `npm link` for local development. [CITED: AGENTS.md]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | local `v24.7.0`; project requires `>=20` | Runtime for FlashQuery and fixture MCP servers | Existing project runtime and package engines constraint. [VERIFIED: command output] [CITED: package.json] |
| TypeScript | installed `6.0.2`; npm latest `6.0.3` | Strict ESM implementation | Existing project language and build target. [VERIFIED: npm ls] [VERIFIED: npm registry] |
| `@modelcontextprotocol/sdk` | installed `1.27.1`; npm latest `1.29.0` | MCP Client, StdioClientTransport, notification schemas, CallToolResult | Official SDK supports Client notification handlers and `tools/list`. [VERIFIED: Context7+npm registry] |
| Zod | installed `4.3.6`; npm latest `4.4.3` | Fixture schemas and config/input validation | Existing project validation library. [VERIFIED: npm ls] [VERIFIED: npm registry] |
| Vitest | installed `4.1.1`; npm latest `4.1.6` | Unit, integration, and E2E test runner | Existing project test framework. [VERIFIED: npm ls] [VERIFIED: npm registry] |

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| `tsx` | installed `4.21.0`; npm latest `4.22.1` | Run TypeScript fixture MCP servers directly | Existing integration fixtures start with `node --import tsx`. [VERIFIED: codebase grep] [VERIFIED: npm registry] |
| `node:crypto` | Node built-in | SHA-256 TOFU hashing | Existing `hashToolSchema` uses `createHash('sha256')`. [VERIFIED: codebase grep] |
| Python scenario harness | system `python3` expected | Directed and YAML scenario runners | Existing Phase A broker scenarios use Python harnesses. [VERIFIED: codebase grep] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual `setNotificationHandler` | SDK `listChanged.tools.onChanged` option | `listChanged` auto-refresh support is available, but manual handler gives explicit synchronous routing and payload aggregation control; do not use both for the same notification. [VERIFIED: Context7] |
| Persistent TOFU store | Supabase or vault document | Explicitly out of scope for v1; persistence would change reset semantics. [CITED: MCP Broker Requirements §2.2 and §7.5] |
| External JSON diff package | Handwritten deterministic structural diff | No new package is needed; required summary is small and deterministic. [ASSUMED] |

**Installation:** no new packages are recommended for Phase 140. [VERIFIED: package.json]  
**Version verification:** `npm ls @modelcontextprotocol/sdk vitest typescript tsx zod --depth=0` and `npm view` were run on 2026-05-18. [VERIFIED: command output]

## Package Legitimacy Audit

No external package install is recommended for this phase, so the Package Legitimacy Gate is not required. Existing stack packages were verified with `npm ls`/`npm view`; no `postinstall` script output was returned for checked packages. [VERIFIED: npm registry]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| none | — | — | — | — | not run | No new install |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: research scope]  
**Packages flagged as suspicious [SUS]:** none. [VERIFIED: research scope]

## Architecture Patterns

### System Architecture Diagram

```text
External MCP server
  └─ emits notifications/tools/list_changed
      ↓
BrokerClient notification handler
  └─ re-fetch tools/list
      ↓
Pure diff utility
  ├─ new tool → TOFU first trust → registry add → index seam add
  ├─ changed tool → pending drift → registry remove/block → index seam remove → re-approval bundle
  └─ removed tool → registry remove → index seam remove → keep TOFU tombstone
      ↓
Consumer surfaces
  ├─ macro broker call → needs_user_input or blocked tool error
  └─ agent-loop broker call → registry-filtered availability
```

### Recommended Project Structure

```text
src/services/mcp-broker/
├── tofu.ts              # existing canonical JSON + hash; add TOFU store/state helpers
├── registry.ts          # existing registry; add unregister/block/list-diff application APIs
├── client.ts            # existing SDK client; add list_changed subscription and refresh callback
├── index.ts             # existing broker orchestration; coordinate client refresh + registry + index seam
├── types.ts             # add TOFU drift, decision, audit, and index-update interfaces
└── diff.ts              # new reusable new/changed/removed classifier

src/macro/
├── evaluator.ts         # add needs_user_input termination path
└── registry.ts          # propagate broker TOFU drift as macro needs_user_input
```

### Pattern 1: Manual Notification Handler With Explicit Refresh

**What:** register one handler for `notifications/tools/list_changed`, re-fetch with `client.listTools`, then apply diff synchronously. [VERIFIED: Context7]  
**When to use:** use this path in Phase 140 because TOFU and bundled re-approval require explicit old/new state and one payload per refresh. [CITED: MCP Broker Requirements §7.9]

```typescript
// Source: Context7 /modelcontextprotocol/typescript-sdk and MCP spec
client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
  const result = await client.listTools(undefined, { timeout: perCallTimeoutMs });
  onToolListChanged(serverId, result.tools);
});
```

### Pattern 2: Broker-Owned TOFU State Machine

**What:** separate trusted hash from pending drift data so rejection preserves old hash and approval commits the new hash. [CITED: MCP Broker Requirements §7.5]  
**When to use:** every `tools/list` observation, including initial connect, reconnect, and list-changed refresh. [CITED: MCP Broker Requirements §7.5 and §7.9]

```typescript
// Source: existing src/services/mcp-broker/tofu.ts plus MCP Broker Requirements §7.5
const hash = hashToolSchema({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema,
});
```

### Pattern 3: Registry Visibility Is the Callable Gate

**What:** changed/rejected tools must disappear from `listToolsForConsumer`, because macro and agent-loop dispatch already check this before calling brokered tools. [VERIFIED: codebase grep]  
**When to use:** block schema drift by unregistering or status-filtering at the registry layer, not by sprinkling checks into each caller. [VERIFIED: codebase grep]

### Anti-Patterns to Avoid

- **Hashing `description_override`:** this masks upstream prompt-description drift and violates REQ-101. [CITED: MCP Broker Requirements §7.14]
- **Deleting TOFU pins on removed tools:** this creates a reappearance bypass; keep tombstones. [CITED: MCP Broker Requirements §7.5]
- **Prompting once per changed tool:** bulk changes from one notification require one bundled payload. [CITED: MCP Broker Requirements §7.5]
- **Adding rate limiting:** prompt throttling is explicitly out of scope for v1. [CITED: MCP Broker Requirements §7.5]
- **Letting changed tools remain searchable or callable:** drift must remove both surfaces until resolved. [CITED: MCP Broker Requirements §7.5 and §7.9]
- **Relying only on Phase A `#tools` cache in `BrokerClient`:** the handler must compare old and new snapshots and push state to registry/TOFU. [VERIFIED: codebase grep]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP notification parsing | Raw JSON-RPC string matching | SDK `setNotificationHandler` with `ToolListChangedNotificationSchema` | SDK validates notification method and handler dispatch. [VERIFIED: node_modules grep] |
| MCP tool discovery | Custom protocol request | `client.listTools` | Official client method supports `tools/list`. [VERIFIED: Context7] |
| SHA-256 hashing | Custom hash code | `node:crypto.createHash('sha256')` | Existing implementation already uses Node crypto. [VERIFIED: codebase grep] |
| Macro tool result coercion | New broker result wrapper | Existing `macro/coerce.ts` and `formatToolError` paths | Phase 139 established these seams. [VERIFIED: codebase grep] |
| Scenario harnesses | New test runner | Existing directed/YAML scenario frameworks | Project has established coverage matrices and managed server patterns. [VERIFIED: codebase grep] |

**Key insight:** the hard part is not computing a hash; it is making every consumer surface observe the same state transition atomically enough that a changed tool cannot be called or discovered after drift is known. [CITED: MCP Broker Requirements §7.5 and §7.9]

## Common Pitfalls

### Pitfall 1: Treating First Discovery As The Whole TOFU Implementation
**What goes wrong:** code computes hashes but never compares later observations or blocks drift. [VERIFIED: codebase grep]  
**Why it happens:** Phase 139 already computes `tofuHash` in `BrokerClient.#discoverTools`, which can look complete. [VERIFIED: codebase grep]  
**How to avoid:** add a separate TOFU store that owns compare/store/pending decision semantics. [CITED: MCP Broker Requirements §7.5]  
**Warning signs:** tests only cover `hashToolSchema` and never mutate fixture tools. [VERIFIED: codebase grep]

### Pitfall 2: Losing The Old Schema
**What goes wrong:** re-approval payload cannot include `old_schema`, or rejection cannot restore trusted state. [CITED: MCP Broker Requirements §7.5]  
**Why it happens:** storing only hash loses the old observed schema. [ASSUMED]  
**How to avoid:** store trusted schema snapshot beside trusted hash and pending schema beside pending hash. [ASSUMED]  
**Warning signs:** TOFU map type is only `Map<string, string>` with no way to produce payload old/new schemas. [CITED: MCP Broker Requirements §7.5]

### Pitfall 3: Forgetting Autonomous Mode
**What goes wrong:** scheduled/delegated execution emits a chat prompt where no live chat can answer. [CITED: MCP Broker Requirements §7.5]  
**Why it happens:** current `ConsumerContext` only has `host` and `purpose`, not interactivity. [VERIFIED: codebase grep]  
**How to avoid:** extend context or broker call options with interactive capability, defaulting purpose calls without live chat to block-and-trace. [ASSUMED]  
**Warning signs:** no test asserts `blocked_on_user`. [CITED: MCP Broker Test Plan §2.2]

### Pitfall 4: Overbuilding Indexer Before Phase 141
**What goes wrong:** Phase 140 expands into BM25 implementation and violates phase boundaries. [CITED: .planning/ROADMAP.md]  
**Why it happens:** Phase B acceptance still talks about index updates. [CITED: MCP Broker Requirements §7.9]  
**How to avoid:** define a small synchronous `ToolIndexSink` interface with a no-op default, then Phase 141 provides BM25 implementation. [ASSUMED]  
**Warning signs:** Phase 140 tasks mention ranking, search result envelopes, or `fq.search_tools`. [CITED: .planning/ROADMAP.md]

### Pitfall 5: Using Both SDK `listChanged` Convenience And Manual Handler
**What goes wrong:** handler overwrite or duplicate refresh logic. [VERIFIED: Context7]  
**Why it happens:** SDK offers both convenience `listChanged` config and `setNotificationHandler`. [VERIFIED: Context7]  
**How to avoid:** choose manual handler for Phase 140 and document why. [VERIFIED: Context7]

## Code Examples

### Existing Hash Helper

```typescript
// Source: src/services/mcp-broker/tofu.ts
export function hashToolSchema(tool: ToolSchemaHashInput): string {
  const hashInput = {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };

  return createHash('sha256').update(canonicalJson(hashInput)).digest('hex');
}
```

### Existing Dispatch Callable Gate

```typescript
// Source: src/macro/registry.ts
const visibleTools = await input.broker.listToolsForConsumer(consumerContext);
const visibleTool = visibleTools.find((tool) => tool.serverId === input.server && tool.toolName === input.tool);
if (visibleTool === undefined) {
  throw new MacroExpectedError('unknown_tool', `Brokered tool '${input.server}.${input.tool}' is not available.`, {
    server: input.server,
    tool: input.tool,
  });
}
```

### SDK Notification Shape

```typescript
// Source: @modelcontextprotocol/sdk docs via Context7
client.setNotificationHandler('notifications/resources/list_changed', async () => {
  const { resources } = await client.listResources();
  console.log('Resources changed:', resources.length);
});
```

For tools, use `ToolListChangedNotificationSchema` from SDK types and `client.listTools`. [VERIFIED: node_modules grep] [VERIFIED: Context7]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hash only `inputSchema` in loose POC wording | Hash canonical JSON of `{name, description, inputSchema}` | Matt resolved conflict on 2026-05-17 in canonical requirements | Planner must not follow stale POC registry call-site wording. [CITED: MCP Broker Requirements §7.5] |
| No broker notification handling in Phase 139 | Subscribe to `notifications/tools/list_changed` and re-fetch `tools/list` | Phase 140 | Changed/removed tools become dynamic state, not startup-only discovery. [CITED: MCP Broker Requirements §7.9] |
| Four macro termination paths | Add `needs_user_input` as fifth path | Phase 140 | Macro engine can suspend for chat-mediated TOFU approval. [CITED: MCP Broker Requirements §7.15] |
| Reverse-request audit only | Reverse-request plus TOFU approval/rejection/blocked audit | Phase 140 | Safety decisions become traceable. [CITED: MCP Broker Requirements §7.10] |

**Deprecated/outdated:**
- The requirement source explicitly says any older “no canonical JSON” statement is stale. [CITED: MCP Broker Requirements §7.5]
- The POC call-site that hashes only `inputSchema` is a known production gap. [CITED: MCP Broker Requirements §7.5]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A handwritten deterministic diff utility is sufficient and no external JSON diff package is needed. | Standard Stack / Pitfalls | Planner may under-scope diff formatting if requirements demand rich patch output. |
| A2 | Store trusted schema snapshots beside hashes to build old/new payloads. | Common Pitfalls | If product wants hash-only memory, payload generation needs another source of old schema. |
| A3 | Add a small no-op index sink in Phase 140 and attach BM25 in Phase 141. | Summary / Pitfalls | If Phase 140 must fully assert index behavior now, Phase 141 boundary needs revision. |
| A4 | Extend context/options with an interactivity marker for autonomous mode. | Common Pitfalls | If an existing hidden chat-session signal exists elsewhere, planner should reuse it instead. |

## Open Questions (RESOLVED)

1. **What is the exact approval write-back API?**
   - What we know: payload `answer_shape` points at `frontmatter.user_decisions.<server>__<tool>.tofu_decision`. [CITED: MCP Broker Requirements §7.5]
   - What's unclear: current Phase 139 broker has no public method for applying approval/rejection decisions. [VERIFIED: codebase grep]
   - Recommendation: planner should include a broker method such as `resolveSchemaDrift(decisions, ctx)` or macro re-invocation hook, then test approve/reject. [ASSUMED]
   - **RESOLVED:** Plan `140-03` implements a broker re-approval resolver API and macro re-invocation path. Plan `140-05` proves approval and rejection through directed/E2E tests.

2. **How should autonomous mode be represented?**
   - What we know: autonomous drift must record `blocked_on_user` and not prompt. [CITED: MCP Broker Requirements §7.5]
   - What's unclear: current `ConsumerContext` does not encode live-chat availability. [VERIFIED: codebase grep]
   - Recommendation: add an explicit field or call option; do not infer from `kind: 'purpose'` alone because future host/delegated flows may differ. [ASSUMED]
   - **RESOLVED:** Plan `140-03` adds explicit interactivity/autonomous signaling to the drift emission path instead of inferring from consumer kind. Plan `140-04` includes T-I-032b coverage for no-live-chat `blocked_on_user` behavior.

3. **How strong must Phase 140 index assertions be before BM25 exists?**
   - What we know: canonical Phase B requires synchronous index updates. [CITED: MCP Broker Requirements §7.9]
   - What's unclear: BM25 implementation is planned for Phase 141. [CITED: .planning/ROADMAP.md]
   - Recommendation: assert calls to a synchronous test sink in Phase 140 and reserve ranking/search behavior for Phase 141. [ASSUMED]
   - **RESOLVED:** Plans `140-01` and `140-02` create and assert a synchronous no-op/test index sink seam. Phase 140 verifies `addTools`/`removeTools` calls synchronously; Phase 141 remains responsible for BM25 ranking and `search_tools` behavior.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build, tests, fixture MCP servers | yes | `v24.7.0` | Project minimum is Node >=20. [VERIFIED: command output] |
| npm | Package scripts and version checks | yes | `11.5.1` | none needed. [VERIFIED: command output] |
| `gsd-sdk` | GSD phase metadata | yes | path found | none needed. [VERIFIED: command output] |
| Context7 MCP | SDK documentation lookup | yes | MCP tool available | CLI fallback not needed. [VERIFIED: Context7] |
| `ctx7` CLI | Documentation fallback | no | — | Context7 MCP was available. [VERIFIED: command output] |
| Python scenario runner | Directed/YAML scenarios | assumed available | not probed | Planner should use existing commands; execution will reveal if missing. [ASSUMED] |
| Supabase `.env.test` | Some integration/E2E tests | unknown | — | Broker fixture tests that do not need Supabase can run; full suite follows existing skip behavior. [CITED: AGENTS.md] |

**Missing dependencies with no fallback:** none found for research. [VERIFIED: command output]  
**Missing dependencies with fallback:** `ctx7` CLI missing, but Context7 MCP was available. [VERIFIED: command output]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `4.1.1` installed, plus Python directed/YAML scenario harnesses. [VERIFIED: npm ls] [VERIFIED: codebase grep] |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts`. [VERIFIED: codebase grep] |
| Quick run command | `npm test -- --run tests/unit/mcp-broker*.test.ts tests/unit/macro-termination.test.ts tests/unit/macro-registry.test.ts` |
| Full suite command | `npm run build && npm test && npm run test:integration && npm run test:e2e -- --run tests/e2e/mcp-broker.e2e.test.ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REQ-038, REQ-101, REQ-102 | Hash inputs and override isolation | unit/integration | `npm test -- --run tests/unit/mcp-broker-tofu.test.ts` plus new T-I-027/T-I-032a | partial; Wave 0 add/extend |
| REQ-039..047 | TOFU state transitions | integration | `npm run test:integration -- --run tests/integration/mcp-broker` | partial; Wave 0 add tests |
| REQ-048 | No prompt rate limiting | integration/assertion | covered by absence plus repeated drift test | missing |
| REQ-049 | Autonomous blocked_on_user | integration | new T-I-032b | missing |
| REQ-061..064 | list_changed subscription and diff routing | unit/integration | new T-U-035 and T-I-004..007 | missing |
| REQ-068 | Rejected reverse requests audit | integration/directed | existing Phase A test plus regression command `npm run test:integration -- --run tests/integration/mcp-broker/client-lifecycle.test.ts` | exists |
| REQ-070 | TOFU approval/rejection audit | integration/directed | new T-I-016/T-I-017/T-S-017 | missing |
| REQ-105 | needs_user_input macro exit | unit/e2e/directed | new macro termination unit plus T-E-B1/T-S-003 | missing |

### Sampling Rate

- **Per task commit:** run the focused unit/integration file for touched module. [CITED: Phase 139 validation pattern]
- **Per wave merge:** run `npm run build` plus all new Phase B tests. [CITED: Phase 139 validation pattern]
- **Phase gate:** run the Phase B contract: T-U-035, T-I-004..007, T-I-013..020, T-I-027, T-I-032a, T-I-032b, T-E-B1, T-S-003/004/005/017, T-Y-012. [CITED: MCP Broker Test Plan §3]

### Wave 0 Gaps

- [ ] `src/services/mcp-broker/diff.ts` and `tests/unit/mcp-broker-diff.test.ts` for T-U-035. [CITED: MCP Broker Test Plan §2.1]
- [ ] `tests/fixtures/mcp-servers/server-quirky.ts` needs list-changed mutation knobs such as `QUIRK_EMIT_LIST_CHANGED_MS`, `QUIRK_INITIAL_TOOLS`, and `QUIRK_LATER_TOOLS`; current fixture only has safe echo and reverse request. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §8.1]
- [ ] `tests/integration/mcp-broker/tofu-list-changed.test.ts` or equivalent for T-I-004..007 and T-I-013..020. [CITED: MCP Broker Test Plan §2.2]
- [ ] Macro evaluator needs `needs_user_input` result/exception tests. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.15]
- [ ] Directed coverage rows MCB-03, MCB-04, MCB-05, MCB-17 need test mappings. [CITED: MCP Broker Test Plan §6]
- [ ] YAML scenario `tofu_drift_yaml_workflow.yml` for INT-MCB-12. [CITED: MCP Broker Test Plan §6]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | No auth change in this phase. [CITED: phase scope] |
| V3 Session Management | partial | Do not add server-side session state; use per-call consumer context and process-local TOFU. [CITED: AGENTS.md] |
| V4 Access Control | yes | Registry visibility and blocked tool state must gate host/delegated consumers. [VERIFIED: codebase grep] |
| V5 Input Validation | yes | Use existing Zod and schema validation for external inputs and decision payloads. [CITED: AGENTS.md] |
| V6 Cryptography | yes | Use Node `crypto` SHA-256; do not hand-roll crypto. [VERIFIED: codebase grep] |
| V9 Communications | partial | Stdio-only broker transport remains in scope; HTTP/OAuth are out of scope. [CITED: MCP Broker Requirements §2.2] |
| V10 Malicious Code | yes | TOFU blocks upstream tool rug-pulls and reverse requests remain unsupported/audited. [CITED: MCP Broker Requirements §7.5 and §7.10] |

### Known Threat Patterns for MCP Broker

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Tool schema rug-pull after first trust | Tampering / Elevation of Privilege | Canonical hash mismatch blocks tool and requires approval. [CITED: MCP Broker Requirements §7.5] |
| Reintroduced removed tool bypass | Tampering | Retain TOFU tombstone when removed. [CITED: MCP Broker Requirements §7.5] |
| Prompt injection via changed description | Spoofing / Tampering | Include upstream description in hash. [CITED: MCP Broker Requirements §7.5] |
| Unsupported sampling/elicitation reverse request | Elevation of Privilege / Information Disclosure | Do not advertise capabilities; audit rejected requests without raw payloads. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.10] |
| Stale searchable tool after drift | Tampering | Synchronous index removal in notification handler. [CITED: MCP Broker Requirements §7.9] |
| Secret leakage through error/audit raw payloads | Information Disclosure | Strip raw fields and avoid logging prompt payloads. [VERIFIED: codebase grep] |

## Sources

### Primary (HIGH confidence)

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Requirements.md` - canonical behavior requirements, especially §7.5, §7.9, §7.10, §7.14, §7.15.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Test Plan.md` - canonical Phase B test slice and coverage IDs.
- `.planning/phases/140-tofu-schema-pinning-and-tool-list-change-handling/140-CONTEXT.md` - locked user decisions and source priority.
- `AGENTS.md` - project constraints and test commands.
- Context7 `/modelcontextprotocol/typescript-sdk` - Client notification handler docs.
- Context7 `/modelcontextprotocol/modelcontextprotocol` - MCP tools/list and `notifications/tools/list_changed` spec.
- Codebase grep/read of `src/services/mcp-broker/*`, `src/macro/*`, `src/llm/tool-dispatcher.ts`, and Phase 139 tests.

### Secondary (MEDIUM confidence)

- `npm view` and `npm ls` registry/version checks for existing packages.
- `node_modules/@modelcontextprotocol/sdk/dist/esm/*.d.ts` type inspection for `ToolListChangedNotificationSchema`, `ListToolsResultSchema`, and `setNotificationHandler`.

### Tertiary (LOW confidence)

- Assumptions A1-A4 in the Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - existing package versions, npm registry, and Context7 docs were checked.
- Architecture: HIGH - canonical docs and current source agree on broker ownership; only index seam timing is an explicit planning tension.
- Pitfalls: MEDIUM - most are source/spec verified; approval API and autonomous context shape need design choice.

**Research date:** 2026-05-18  
**Valid until:** 2026-06-01 for project-specific planning; re-check MCP SDK docs if package version changes.

## Downstream Agent Mandatory Read

Implementation, verification, and review agents MUST read both canonical MCP Broker docs before changing code or tests:

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Requirements.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Test Plan.md`

If either doc conflicts with this research, the canonical docs win and the agent must call out the conflict. [CITED: 140-CONTEXT.md]
