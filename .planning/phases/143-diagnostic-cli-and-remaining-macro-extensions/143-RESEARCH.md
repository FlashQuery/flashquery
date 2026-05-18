# Phase 143: Diagnostic CLI And Remaining Macro Extensions - Research

**Researched:** 2026-05-18 [VERIFIED: gsd init.phase-op]
**Domain:** FlashQuery MCP Broker diagnostic CLI, macro parser/evaluator extensions, broker health probing, and scenario closure [CITED: MCP Broker Requirements.md]
**Confidence:** HIGH [VERIFIED: codebase grep + product docs + Context7]

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Downstream research, planning, execution, review, and verification agents MUST read the two source MCP Broker docs before making phase decisions: [VERIFIED: 143-CONTEXT.md]
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Requirements.md` [VERIFIED: 143-CONTEXT.md]
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Test Plan.md` [VERIFIED: 143-CONTEXT.md]
- If any implementation detail conflicts between generated GSD artifacts and those source docs, the source MCP Broker docs win unless the user explicitly overrides. [VERIFIED: 143-CONTEXT.md]
- Implement `flashquery list-tools <server>` for REQ-071..073. [VERIFIED: 143-CONTEXT.md]
- The CLI must use the same configured server connection and discovery path as the broker where practical, issue `tools/list`, print YAML that can be pasted under `mcp_servers.<server>.tool_overrides:`, then disconnect and exit. [VERIFIED: 143-CONTEXT.md]
- The YAML output must preserve tool names and descriptions in a form suitable for editing `description_override` and/or per-tool cost overrides. [VERIFIED: 143-CONTEXT.md]
- Failures must surface captured server stderr. Stderr must not contaminate successful YAML output. [VERIFIED: 143-CONTEXT.md]
- `_self` exists only when `call_macro` loads source through `source_ref`. [VERIFIED: 143-CONTEXT.md]
- `_self` exposes a snapshot at macro start: `_self.path`, `_self.frontmatter.*`, `_self.title`, `_self.tags`, and `_self.fq_id`. [VERIFIED: 143-CONTEXT.md]
- `_self.*` is read-only at macro-language level; assignments to `_self.*` are parse-time errors. [VERIFIED: 143-CONTEXT.md]
- Inline macro source has no `_self`; accessing `_self.*` is a runtime error with a message equivalent to "`_self` is only available when the macro was loaded via source_ref." [VERIFIED: 143-CONTEXT.md]
- `_self.frontmatter` does not auto-refresh after write-through. Macros that need current persisted state must call `fq.get_document(_self.path)`. [VERIFIED: 143-CONTEXT.md]
- `continue` and `break` are valid inside `for` and `while` blocks. [VERIFIED: 143-CONTEXT.md]
- `continue` skips the remainder of the current loop iteration and proceeds to the next iteration, or exits if exhausted. [VERIFIED: 143-CONTEXT.md]
- `break` exits the current loop block and continues after `done`; it does not halt the macro. [VERIFIED: 143-CONTEXT.md]
- `continue` or `break` outside a loop is a parse-time error. [VERIFIED: 143-CONTEXT.md]
- Macro-facing `<server>._exists()` must call `Broker.isConnected(serverId, { deepProbe: true, timeoutMs: 250 })`. [VERIFIED: 143-CONTEXT.md]
- Shallow `process.kill(pid, 0)` behavior is insufficient for `_exists()` because hung-but-alive server processes must return false. [VERIFIED: 143-CONTEXT.md]
- Guard-clause macros that use `_exists()` must observe false for unconfigured or hung servers. [VERIFIED: 143-CONTEXT.md]
- Two macros may share one brokered server process concurrently. [VERIFIED: 143-CONTEXT.md]
- The implementation must rely on JSON-RPC id correlation and existing broker concurrency contracts rather than adding a per-server call mutex unless tests prove one is required. [VERIFIED: 143-CONTEXT.md]
- Stress tests must prove concurrent macro calls do not cross-contaminate responses, context, or trace state. [VERIFIED: 143-CONTEXT.md]
- Phase 143 must map and close source test plan Phase E coverage: unit T-U-038..043; integration T-I-050; directed T-S-006..011 and T-S-019..020; YAML T-Y-014..015; E2E T-E-001..004, with T-E-003 and T-E-004 optional differential tests if production coverage already proves the same contracts. [VERIFIED: 143-CONTEXT.md]
- Coverage ledgers must be updated for MCB-06..011, MCB-19..020, INT-MCB-14, and INT-MCB-15. [VERIFIED: 143-CONTEXT.md]
- Full phase verification must include unit, integration, E2E, directed, YAML integration, build/typecheck, and any targeted concurrency/differential commands called out by the plan. [VERIFIED: 143-CONTEXT.md]

### the agent's Discretion
- Exact module boundaries, helper names, and parser implementation details are at the agent's discretion, but must follow existing FlashQuery TypeScript, ESM, Vitest, directed scenario, and YAML scenario patterns. [VERIFIED: 143-CONTEXT.md]
- Agents may split plans by vertical testable capability, but each plan must preserve the source doc traceability back to REQ IDs and test IDs. [VERIFIED: 143-CONTEXT.md]

### Deferred Ideas (OUT OF SCOPE)
- New broker transports, OAuth/DCR, MCP resources/prompts/sampling/elicitation, persistent TOFU, hot reload, semantic vector routing, broker-side tool tiering, and reworking already shipped Phase 139-142 behavior except where Phase 143 tests expose a contract regression are out of scope. [VERIFIED: 143-CONTEXT.md]
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-071 | `flashquery list-tools <server>` connects to the configured server, calls `tools/list`, and exits. [VERIFIED: .planning/REQUIREMENTS.md] | Use existing Commander routing in `src/index.ts`, broker creation in `src/services/mcp-broker/index.ts`, and `BrokerClient.listTools()`. [VERIFIED: codebase grep] |
| REQ-072 | CLI output is paste-ready YAML under `mcp_servers.<server>.tool_overrides:`. [VERIFIED: .planning/REQUIREMENTS.md] | Emit stdout-only YAML scaffold matching the source requirements example. [CITED: MCP Broker Requirements.md] |
| REQ-073 | CLI failures surface stderr. [VERIFIED: .planning/REQUIREMENTS.md] | Reuse `BrokerClient.stderrText` and existing connect-failure stderr behavior from `client.ts`; keep successful YAML stdout clean. [VERIFIED: codebase grep] |
| REQ-103 | `_self` engine binding is available for `source_ref` macros. [VERIFIED: .planning/REQUIREMENTS.md] | Extend source_ref resolution and evaluator environment bootstrap to bind a read-only macro snapshot. [VERIFIED: codebase grep] |
| REQ-104 | `continue` and `break` loop-control statements are supported. [VERIFIED: .planning/REQUIREMENTS.md] | Add lexer tokens, AST statement nodes, parser loop-depth validation, and evaluator control-flow exceptions. [VERIFIED: codebase grep] |
| REQ-109 | `<server>._exists()` uses deep probe. [VERIFIED: .planning/REQUIREMENTS.md] | Change `resolveNamespaceIntrospection` to call `broker.isConnected(server, { deepProbe: true, timeoutMs: 250 })`. [VERIFIED: codebase grep] |
| REQ-110 | Concurrent macro execution against shared brokered servers is safe. [VERIFIED: .planning/REQUIREMENTS.md] | Add macro-level concurrency test over the existing shared `BrokerClient` path; existing client-level concurrency is already covered by T-I-022. [VERIFIED: codebase grep] |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- Runtime is Node.js >= 20 LTS, TypeScript strict mode, ESM modules, MCP SDK `@modelcontextprotocol/sdk`, Supabase client/`pg`, `tsup`, `tsx`, and Vitest. [VERIFIED: AGENTS.md + package.json]
- Local development should use `npm run dev`; built execution should use `node dist/index.js start --config ./flashquery.yml`; do not use `npm link`. [VERIFIED: AGENTS.md]
- Use async/await; module boundaries should return typed errors rather than thrown exceptions where applicable; MCP tool handlers catch internally and return `isError: true` on failure. [VERIFIED: AGENTS.md]
- Use Zod for external input validation. [VERIFIED: AGENTS.md]
- Keep files kebab-case, types/interfaces PascalCase, functions/variables camelCase, constants SCREAMING_SNAKE_CASE, and internal Supabase tables `fqc_` prefixed. [VERIFIED: AGENTS.md]
- Unit tests live in `tests/unit/*.test.ts`, integration tests in `tests/integration/*.test.ts`, E2E tests in `tests/e2e/*.test.ts`, directed scenarios in `tests/scenarios/directed/`, and YAML scenarios in `tests/scenarios/integration/`. [VERIFIED: AGENTS.md]
- MCP tool responses must use `{ content: [{ type: "text", text: "..." }] }`; errors add `isError: true`; response text should include IDs and metadata. [VERIFIED: AGENTS.md]
- Do not use CommonJS, do not use `@modelcontextprotocol/server`, do not build a web UI, and do not implement server-side session state. [VERIFIED: AGENTS.md]

## Summary

Phase 143 is a final broker milestone closure phase, not a new architecture phase. The implementation should add one narrow diagnostic CLI, finish macro-language gaps, tighten `_exists()` to the required deep-probe contract, and close Phase E tests and coverage ledgers. [CITED: MCP Broker Requirements.md] The two product docs listed in User Constraints are authoritative and must be treated as mandatory reads by every downstream agent. [VERIFIED: 143-CONTEXT.md]

The codebase already has most broker infrastructure: `McpBroker`, `BrokerClient`, stderr capture, deep/shallow `BrokerClient.isConnected`, tool-list refresh, macro broker dispatch, source_ref loading, TOFU drift flow, host/delegated consumer context, fixture MCP servers, and Phase A-D scenario harnesses. [VERIFIED: codebase grep] The planner should avoid redesigning these surfaces and instead schedule small contract-focused changes with RED tests first. [VERIFIED: Phase 139-142 validation summaries]

**Primary recommendation:** Plan four vertical slices: diagnostic CLI, `_self` binding, loop-control parser/evaluator, and final deep-probe/concurrency/scenario closure. [VERIFIED: MCP Broker Requirements.md + codebase grep]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| `flashquery list-tools <server>` | CLI / Backend process | External MCP server subprocess | Command routing owns user invocation; broker client owns stdio discovery and stderr capture. [VERIFIED: src/index.ts + src/services/mcp-broker/client.ts] |
| `_self` source snapshot | Macro runtime | Vault/document resolver | `call_macro` resolves `source_ref`; evaluator owns variable binding and field access. [VERIFIED: src/mcp/tools/macro.ts + src/macro/evaluator.ts] |
| `continue` / `break` | Macro parser + runtime | Scenario harness | Parser must reject invalid placement; evaluator must alter loop execution. [VERIFIED: src/macro/parser.ts + src/macro/evaluator.ts] |
| Deep `_exists()` | Macro introspection | Broker client health probe | Macro syntax routes to `resolveNamespaceIntrospection`; broker client owns deep `tools/list` probe. [VERIFIED: src/macro/introspection.ts + src/services/mcp-broker/client.ts] |
| Concurrent macro safety | Broker + macro runtime | Test fixtures | Existing broker uses shared clients; Phase 143 must prove macro frames do not share mutable response/context state. [VERIFIED: tests/integration/mcp-broker/client-lifecycle.test.ts] |
| Phase E scenario closure | Test harnesses | Planning docs | Source test plan maps Phase E IDs to unit, integration, directed, YAML, and E2E evidence. [CITED: MCP Broker Test Plan.md] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | v24.7.0 installed; project requires >=20 [VERIFIED: node --version + package.json] | Runtime for CLI, broker, test fixture servers. [VERIFIED: AGENTS.md] | Existing project runtime and package engine. [VERIFIED: package.json] |
| TypeScript / ESM | TypeScript 6.0.2 in package, ESM package type [VERIFIED: package.json] | Source language and module format. [VERIFIED: AGENTS.md] | Repo-wide convention; CommonJS is forbidden. [VERIFIED: AGENTS.md] |
| `commander` | Installed 14.0.3; registry current 14.0.3 modified 2026-05-12 [VERIFIED: package.json + npm registry] | CLI subcommands and async actions. [VERIFIED: src/index.ts] | Commander supports subcommands with arguments and async actions via `parseAsync`. [CITED: /tj/commander.js] |
| `@modelcontextprotocol/sdk` | Installed 1.27.1; registry current 1.29.0 modified 2026-03-30 [VERIFIED: package.json + npm registry] | MCP stdio client/server, `listTools`, `callTool`, timeouts, fixture servers. [VERIFIED: codebase grep] | Existing broker client uses `Client` and `StdioClientTransport`; SDK docs define `listTools()` and `callTool()` timeout/error behavior. [CITED: /modelcontextprotocol/typescript-sdk] |
| `js-yaml` | Installed/current 4.1.1 [VERIFIED: package.json + npm registry] | Existing YAML parser/emitter option for config/scenario-compatible YAML. [VERIFIED: package.json] | Already present; do not add a new YAML serializer for the diagnostic fragment. [VERIFIED: package.json] |
| Vitest | Installed 4.1.1; registry current 4.1.6 modified 2026-05-11 [VERIFIED: npm ls + npm registry] | Unit/integration/E2E test runner. [VERIFIED: package.json] | Existing test configs explicitly include unit, integration, benchmark, and E2E suites. [VERIFIED: tests/config/*.ts] |

### Supporting

| Library/Tool | Version | Purpose | When to Use |
|--------------|---------|---------|-------------|
| `tsx` | 4.21.0 installed [VERIFIED: npm ls] | Run TypeScript fixture MCP servers in tests. [VERIFIED: tests/fixtures/mcp-servers] | Use in broker fixture config as prior phases do. [VERIFIED: tests/integration/mcp-broker/*.test.ts] |
| Python 3 | 3.12.3 installed [VERIFIED: python3 --version] | Directed and YAML scenario runners. [VERIFIED: tests/scenarios/*/run_*.py] | Required for Phase E scenario closure. [VERIFIED: MCP Broker Test Plan.md] |
| `gsd-sdk` | Installed in PATH [VERIFIED: command -v gsd-sdk] | GSD init/commit operations. [VERIFIED: gsd init.phase-op] | Use only for planning/doc workflow, not production code. [VERIFIED: gsd init.phase-op] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `commander` action handler in `src/index.ts` | Standalone executable subcommand file | Existing CLI commands are registered in `src/index.ts`; standalone files would be a new pattern. [VERIFIED: src/index.ts] |
| Existing `BrokerClient` discovery path | Direct raw SDK client inside CLI | Direct raw SDK would duplicate stderr/env/connect behavior already present in `BrokerClient`. [VERIFIED: src/services/mcp-broker/client.ts] |
| Macro control exceptions | Boolean return flags from `execBlock` | Exceptions match existing `MacroExitError`, `MacroFailError`, cancellation, and needs-user-input control flow. [VERIFIED: src/macro/evaluator.ts] |

**Installation:**

```bash
# No new packages recommended for Phase 143.
```

## Package Legitimacy Audit

No external packages should be installed in this phase; the required stack is already in `package.json` and `package-lock.json`. [VERIFIED: package.json + npm ls]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| none | npm | n/a | n/a | n/a | n/a | No install needed. [VERIFIED: package.json] |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: package.json]
**Packages flagged as suspicious [SUS]:** none. [VERIFIED: package.json]

## Architecture Patterns

### System Architecture Diagram

```text
User CLI / MCP call
  |
  +-- list-tools <server> --------------------+
  |                                           |
  |                         load flashquery.yml + validate server id
  |                                           |
  |                         BrokerClient.ensureConnected()
  |                                           |
  |                         MCP tools/list over stdio
  |                                           |
  |                         YAML scaffold to stdout / stderr on failure
  |
  +-- call_macro source/source_ref -----------+
                                              |
                         resolve source_ref document and selected fqm fence
                                              |
                         build macro invocation context
                                              |
                         bind _self snapshot when source_ref is present
                                              |
                         parse macro, reject invalid _self writes and
                         invalid continue/break placement
                                              |
                         evaluate loops, _exists(), and brokered tools
                                              |
                         broker.callTool / broker.isConnected deep probe
                                              |
                         macro result, needs_user_input, or error envelope
```

All arrows represent existing or required runtime data flow. [VERIFIED: codebase grep + MCP Broker Requirements.md]

### Recommended Project Structure

```text
src/
+-- cli/
|   +-- commands/
|       +-- list-tools.ts              # optional command wrapper if the planner chooses command-object style
+-- services/
|   +-- mcp-broker/
|       +-- cli.ts                     # diagnostic implementation using BrokerClient/createBroker
+-- macro/
|   +-- tokens.ts                      # add Continue/Break tokens
|   +-- types.ts                       # add ContinueStmt/BreakStmt and self metadata types
|   +-- parser.ts                      # parse loop control and _self write restrictions
|   +-- evaluator.ts                   # bind _self and implement loop control exceptions
|   +-- introspection.ts               # deep-probe _exists contract
+-- mcp/
    +-- tools/
        +-- macro.ts                   # pass source_ref snapshot metadata into runMacroSource
```

This structure follows existing FlashQuery file organization and broker/macro module boundaries. [VERIFIED: AGENTS.md + codebase grep]

### Pattern 1: Diagnostic CLI Uses Broker Discovery, Not Duplicate SDK Plumbing

**What:** Implement a narrow `runListToolsCommand(configPath, serverId)` helper that loads config, validates `mcp_servers[serverId]`, uses the existing broker client/discovery path, writes only the YAML fragment to stdout on success, shuts down, and writes errors/stderr to stderr on failure. [CITED: MCP Broker Requirements.md]

**When to use:** Use for `flashquery list-tools <server>` only. [CITED: MCP Broker Requirements.md]

**Example:**

```typescript
// Source: Context7 Commander docs + existing src/index.ts pattern.
program
  .command('list-tools')
  .argument('<server>', 'configured MCP server id')
  .option('--config <path>', 'explicit config file path')
  .action(async (server: string, options: { config?: string }) => {
    const configPath = resolveConfigPath(options.config);
    await runListToolsCommand(configPath, server);
  });

await program.parseAsync(process.argv);
```

Commander supports subcommands with arguments and async actions through `parseAsync`. [CITED: /tj/commander.js]

### Pattern 2: `_self` Is Invocation Metadata, Not Input Vars

**What:** Bind `_self` directly in the evaluator root environment when `source_ref` was used; do not require users to pass `_self` through `input_vars`. [CITED: MCP Broker Requirements.md]

**When to use:** Source document metadata must be immutable per macro invocation and unavailable for inline macros. [CITED: MCP Broker Requirements.md]

**Implementation seam:** `resolveMacroSourceForRequest` currently returns source and identifier only; extend its success result to include source document snapshot metadata when resolving `source_ref`. [VERIFIED: src/mcp/tools/macro.ts]

### Pattern 3: Loop Control Mirrors Existing Macro Control Flow

**What:** Add `MacroContinueError` and `MacroBreakError` or equivalent internal control signals, throw them from `execStatement`, catch them at `ForLoop`/`WhileLoop`, and treat uncaught loop-control at top level as impossible because parser rejects it. [VERIFIED: src/macro/evaluator.ts]

**When to use:** For `continue`/`break` inside nested `if` blocks inside loops, control must escape the nested block to the nearest loop. [CITED: MCP Broker Requirements.md]

### Anti-Patterns to Avoid

- **Do not add a per-server call mutex for REQ-110 unless tests prove the SDK correlation path fails.** The phase context explicitly says to rely on JSON-RPC id correlation first. [VERIFIED: 143-CONTEXT.md]
- **Do not make `_self` an alias for mutable live document state.** `_self.frontmatter` is a macro-start snapshot. [CITED: MCP Broker Requirements.md]
- **Do not write diagnostics to stdout on successful `list-tools` except YAML.** Stderr must not contaminate paste-ready YAML. [VERIFIED: 143-CONTEXT.md]
- **Do not implement a new broker transport or hot reload.** Those are out of scope. [CITED: MCP Broker Requirements.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CLI parsing | Custom `process.argv` parser | Commander `program.command(...).argument(...).action(...)` | Existing CLI already uses Commander and docs support async actions. [VERIFIED: src/index.ts; CITED: /tj/commander.js] |
| MCP stdio discovery | Raw child_process JSON-RPC implementation | Existing `BrokerClient` / MCP SDK `Client.listTools()` | SDK docs define `listTools()` and timeout/error semantics; broker already captures stderr. [CITED: /modelcontextprotocol/typescript-sdk; VERIFIED: src/services/mcp-broker/client.ts] |
| YAML string escaping | Manual quote escaping for arbitrary descriptions | `js-yaml` or a small controlled emitter with comment escaping only | Descriptions can contain punctuation/newlines; paste-ready output must stay valid. [VERIFIED: package.json; CITED: MCP Broker Requirements.md] |
| Macro parser overhaul | New parser framework | Existing token-stream parser and Chevrotain lexer tokens | Existing parser is hand-written over Chevrotain tokens and already handles loop/if nesting. [VERIFIED: src/macro/parser.ts + src/macro/tokens.ts] |
| Concurrency serialization | Global broker lock | Existing SDK request id correlation plus stress tests | Source docs require shared concurrent broker use unless tests prove otherwise. [CITED: MCP Broker Requirements.md] |

**Key insight:** Phase 143 should close contracts at existing seams rather than inventing new abstractions. [VERIFIED: codebase grep + Phase 139-142 validation summaries]

## Common Pitfalls

### Pitfall 1: Mistaking Process Liveness For MCP Health

**What goes wrong:** `_exists()` returns true for a SIGSTOP'd or hung server. [CITED: MCP Broker Requirements.md]
**Why it happens:** `src/macro/introspection.ts` currently calls `broker.isConnected(server)` through a 5-second wrapper, which does not pass the required `{ deepProbe: true, timeoutMs: 250 }` options. [VERIFIED: src/macro/introspection.ts]
**How to avoid:** Change the call to the explicit deep-probe options and update tests that currently expect the old call signature. [VERIFIED: tests/unit/macro-introspection.test.ts]
**Warning signs:** Tests assert `broker.isConnected` was called with only the server id. [VERIFIED: tests/unit/macro-introspection.test.ts]

### Pitfall 2: `_self` Snapshot Accidentally Becomes Mutable Runtime State

**What goes wrong:** A macro updates a document and `_self.frontmatter` changes mid-run, violating snapshot semantics. [CITED: MCP Broker Requirements.md]
**Why it happens:** Passing a shared object reference into the evaluator or resolving `_self` lazily from storage. [ASSUMED]
**How to avoid:** Build a plain `MacroValue` snapshot once during source_ref resolution and clone/freeze at the evaluator boundary. [VERIFIED: src/mcp/tools/macro.ts + src/macro/evaluator.ts]
**Warning signs:** Tests mutate returned frontmatter or call `fq.write_document` and see `_self.frontmatter` change without `fq.get_document`. [CITED: MCP Broker Test Plan.md]

### Pitfall 3: Parser Accepts Loop Control Outside Loops

**What goes wrong:** `continue` or `break` reaches runtime outside a loop and must be handled as a runtime bug. [CITED: MCP Broker Requirements.md]
**Why it happens:** Parser currently has no Continue/Break tokens or loop-depth validation. [VERIFIED: src/macro/tokens.ts + src/macro/parser.ts]
**How to avoid:** Parse statements with a loop-depth context and fail parse-time when depth is zero. [VERIFIED: src/macro/parser.ts]
**Warning signs:** T-U-040/T-U-041 fail or return runtime errors instead of parse errors. [CITED: MCP Broker Test Plan.md]

### Pitfall 4: CLI Output Is Not Paste-Ready

**What goes wrong:** The user cannot paste stdout under `mcp_servers.<server>.tool_overrides:` or stderr/log banners corrupt stdout. [CITED: MCP Broker Requirements.md]
**Why it happens:** Startup logging currently emits a DNS line before Commander import, and existing startup command logs heavily to stderr. [VERIFIED: src/index.ts]
**How to avoid:** Ensure the new CLI path does not initialize full server startup and only writes YAML to stdout; diagnostic/errors go to stderr. [VERIFIED: src/index.ts + src/services/mcp-broker/client.ts]
**Warning signs:** T-Y-014 cannot reparse captured stdout as YAML. [CITED: MCP Broker Test Plan.md]

### Pitfall 5: Integration Config Include List Blocks New Tests

**What goes wrong:** A new integration test file is never run by `npm run test:integration`. [VERIFIED: tests/config/vitest.integration.config.ts]
**Why it happens:** Integration Vitest config uses an explicit include list. [VERIFIED: tests/config/vitest.integration.config.ts]
**How to avoid:** Add new Phase 143 integration files to `tests/config/vitest.integration.config.ts`, or extend an included file. [VERIFIED: tests/config/vitest.integration.config.ts]
**Warning signs:** `npm run test:integration -- --run new-file.test.ts` cannot find the file. [VERIFIED: Phase 139 validation summary]

## Code Examples

### Deep Probe `_exists()`

```typescript
// Source: MCP Broker Requirements REQ-109 + existing introspection seam.
return broker.isConnected(server, { deepProbe: true, timeoutMs: 250 });
```

REQ-109 requires the macro-facing binding to use `Broker.isConnected(serverId, { deepProbe: true, timeoutMs: 250 })`. [CITED: MCP Broker Requirements.md]

### Loop Control Execution Shape

```typescript
// Source: existing evaluator control-flow pattern in src/macro/evaluator.ts.
class MacroContinueError extends Error {}
class MacroBreakError extends Error {}

for (const itemValue of iterable) {
  try {
    await execBlock(stmt.body, child, context);
  } catch (error) {
    if (error instanceof MacroContinueError) continue;
    if (error instanceof MacroBreakError) break;
    throw error;
  }
}
```

Existing macro termination already uses internal errors for `exit`, `fail`, cancellation, and `needs_user_input`. [VERIFIED: src/macro/evaluator.ts]

### CLI YAML Scaffold

```yaml
# Discovered N tools from basic (paste under mcp_servers.basic.tool_overrides:)
tool_overrides:
  echo:
    # Echoes the provided value without mutation.
    # cost_per_call: 0.005
    # description_override: "..."
```

This scaffold shape is specified by REQ-072. [CITED: MCP Broker Requirements.md]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Placeholder broker seam | Production `McpBroker` + `BrokerClient` + registry/TOFU/trace modules | Phase 139-140 [VERIFIED: Phase 139-140 validation summaries] | Phase 143 should reuse broker internals rather than create new clients. [VERIFIED: codebase grep] |
| Host/delegated context reconstructed per call | Outermost `MacroCallerContext.consumerContext` is preserved through nested macros | Phase 142 [VERIFIED: .planning/STATE.md] | Concurrency tests must assert trace/context isolation, not reimplement context threading. [VERIFIED: Phase 142 validation summary] |
| `_exists()` 5-second wrapper without explicit probe opts | Required deep-probe `tools/list` with 250 ms timeout | Phase 143 target [CITED: MCP Broker Requirements.md] | Existing unit tests must be updated. [VERIFIED: tests/unit/macro-introspection.test.ts] |
| No loop-control tokens | Required `continue` and `break` statements | Phase 143 target [CITED: MCP Broker Requirements.md] | Parser/type/evaluator tests are mandatory. [CITED: MCP Broker Test Plan.md] |

**Deprecated/outdated:**
- Shallow `_exists()` health checks are insufficient for macro guard clauses. [CITED: MCP Broker Requirements.md]
- Manual scenario closure by implementation inference is insufficient; Phase 142 established exact command evidence before requirement closure. [VERIFIED: Phase 142 validation summary]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Freezing/cloning `_self` at evaluator entry is the right implementation detail. [ASSUMED] | Common Pitfalls | If the parser/runtime expects mutable binding internals, tests may require a different read-only enforcement mechanism. |
| A2 | A small controlled YAML emitter may be sufficient if it only emits comments and scalar keys. [ASSUMED] | Don't Hand-Roll | If tool names/descriptions include difficult YAML/comment edge cases, using `js-yaml` or stricter escaping is safer. |

## Open Questions (RESOLVED)

1. **Should the CLI command name be `list-tools` under the `fqc` program name or should docs also accept the binary alias `flashquery list-tools`?** [VERIFIED: package.json + src/index.ts]
   - What we know: `package.json` exposes the binary as `flashquery`, while `src/index.ts` sets Commander `.name('fqc')`. [VERIFIED: package.json + src/index.ts]
   - Resolution: Implement the binary-compatible command `flashquery list-tools <server>` without renaming the existing Commander program name from `fqc`. Help text renaming is out of scope unless tests or source docs explicitly require it. [RESOLVED: 143-01-PLAN.md]

2. **Should T-E-003/T-E-004 be implemented or explicitly waived as optional differentials?** [CITED: MCP Broker Test Plan.md]
   - What we know: The test plan marks them optional differential tests if production coverage already proves the same contracts. [VERIFIED: 143-CONTEXT.md]
   - Resolution: Plan 05 requires implementing T-E-003/T-E-004 only if current production tests do not already prove equivalent TOFU hash and `formatToolError` taxonomy contracts. Otherwise execution must record explicit optional waivers in `143-VALIDATION.md` and tick/annotate the authoritative MCP Broker Test Plan rows with cited green evidence. [RESOLVED: 143-05-PLAN.md]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Runtime, CLI, MCP fixtures | yes | v24.7.0 | Project minimum is >=20. [VERIFIED: node --version + package.json] |
| npm | Scripts and package verification | yes | 11.5.1 | none needed. [VERIFIED: npm --version] |
| `tsx` | Fixture MCP servers | yes | 4.21.0 | Use installed local package through npm scripts. [VERIFIED: npm ls] |
| Python 3 | Directed/YAML scenario runners | yes | 3.12.3 | none. [VERIFIED: python3 --version] |
| `.env.test` | Integration/E2E Supabase-backed tests | not probed for secret presence | n/a | Tests skip or warn when incomplete per AGENTS.md. [VERIFIED: AGENTS.md] |
| Supabase test service | Integration/E2E tests | not probed | n/a | Planner must include skip/credential note for integration/E2E gates. [VERIFIED: AGENTS.md] |

**Missing dependencies with no fallback:**
- None found from local CLI/runtime probes. [VERIFIED: command probes]

**Missing dependencies with fallback:**
- Supabase credential availability was not inspected to avoid exposing secrets; existing harness can skip gracefully when `.env.test` is missing or incomplete. [VERIFIED: AGENTS.md]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 plus FlashQuery directed and YAML scenario harnesses. [VERIFIED: npm ls + tests/scenarios] |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts`. [VERIFIED: codebase grep] |
| Quick run command | `npm test -- --run tests/unit/macro-parser.test.ts tests/unit/macro-evaluator.test.ts tests/unit/macro-introspection.test.ts tests/unit/macro-source-ref.test.ts` [VERIFIED: tests/config/vitest.unit.config.ts] |
| Full suite command | `npm run build && npm test && npm run test:integration && npm run test:e2e` plus Phase E directed/YAML commands. [VERIFIED: package.json + MCP Broker Test Plan.md] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REQ-071 | CLI connects, calls `tools/list`, exits. [VERIFIED: .planning/REQUIREMENTS.md] | unit + directed + YAML | `npm test -- --run tests/unit/list-tools-command.test.ts` and `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_mcp_broker_phase_e` [CITED: MCP Broker Test Plan.md] | no; Wave 0 create |
| REQ-072 | CLI emits paste-ready YAML. [VERIFIED: .planning/REQUIREMENTS.md] | unit + YAML | `python3 tests/scenarios/integration/run_integration.py --managed cli_list_tools_paste_back` [CITED: MCP Broker Test Plan.md] | no; Wave 0 create |
| REQ-073 | CLI failures surface stderr. [VERIFIED: .planning/REQUIREMENTS.md] | unit + directed | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_mcp_broker_phase_e` [CITED: MCP Broker Test Plan.md] | no; Wave 0 create |
| REQ-103 | `_self` binding and snapshot semantics. [VERIFIED: .planning/REQUIREMENTS.md] | unit + directed + YAML + E2E | `npm test -- --run tests/unit/macro-self.test.ts` [CITED: MCP Broker Test Plan.md] | no; Wave 0 create |
| REQ-104 | `continue`/`break` parse/runtime behavior. [VERIFIED: .planning/REQUIREMENTS.md] | unit + directed + YAML | `npm test -- --run tests/unit/macro-parser.test.ts tests/unit/macro-evaluator.test.ts` [CITED: MCP Broker Test Plan.md] | existing files to extend |
| REQ-109 | `_exists()` deep probe. [VERIFIED: .planning/REQUIREMENTS.md] | unit + integration + directed + YAML | `npm test -- --run tests/unit/macro-introspection.test.ts && npm run test:integration -- --run tests/integration/mcp-broker/client-lifecycle.test.ts` [CITED: MCP Broker Test Plan.md] | existing files to extend |
| REQ-110 | Shared-server concurrent macro safety. [VERIFIED: .planning/REQUIREMENTS.md] | integration + E2E | `npm run test:integration -- --run tests/integration/mcp-broker/macro-concurrency.test.ts` [CITED: MCP Broker Test Plan.md] | no; Wave 0 create or extend include list |

### Sampling Rate

- **Per task commit:** Run the focused unit/integration test file for the touched parser/runtime/CLI seam. [VERIFIED: Phase 142 validation pattern]
- **Per wave merge:** Run `npm run build` plus all Phase E tests added in that wave. [VERIFIED: Phase 142 validation pattern]
- **Phase gate:** Run build, focused unit suite, focused broker/tool-search integration, E2E broker, directed Phase E, YAML Phase E, and lint if source changed. [VERIFIED: 143-CONTEXT.md + Phase 142 validation summary]

### Wave 0 Gaps

- [ ] `src/services/mcp-broker/cli.ts` or `src/cli/commands/list-tools.ts` - diagnostic CLI implementation surface. [CITED: MCP Broker Requirements.md]
- [ ] `tests/unit/list-tools-command.test.ts` - CLI YAML and stderr behavior. [CITED: MCP Broker Test Plan.md]
- [ ] `tests/unit/macro-self.test.ts` - T-U-038/T-U-039. [CITED: MCP Broker Test Plan.md]
- [ ] `tests/integration/mcp-broker/macro-concurrency.test.ts` - T-I-050; add to explicit Vitest include if created. [VERIFIED: tests/config/vitest.integration.config.ts]
- [ ] `tests/scenarios/directed/testcases/test_mcp_broker_phase_e.py` - MCB-06..011 and MCB-19..020. [CITED: MCP Broker Test Plan.md]
- [ ] `tests/scenarios/integration/tests/cli_list_tools_paste_back.yml` - INT-MCB-14. [CITED: MCP Broker Test Plan.md]
- [ ] `tests/scenarios/integration/tests/macro_extensions_compose_rundoc.yml` - INT-MCB-15. [CITED: MCP Broker Test Plan.md]
- [ ] Coverage ledger rows/updates for `MCB-06..011`, `MCB-19..020`, `INT-MCB-14`, and `INT-MCB-15`. [CITED: MCP Broker Test Plan.md]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Phase does not add auth/session behavior. [CITED: MCP Broker Requirements.md] |
| V3 Session Management | no | MCP remains stateless per AGENTS.md. [VERIFIED: AGENTS.md] |
| V4 Access Control | yes | Preserve host/delegated `ConsumerContext` and broker visibility filtering; do not widen server access. [VERIFIED: Phase 142 validation summary] |
| V5 Input Validation | yes | Commander argument validation plus existing Zod config validation and macro parser errors. [VERIFIED: src/index.ts + src/config/loader.ts + src/macro/parser.ts] |
| V6 Cryptography | no | No cryptographic feature added; TOFU hashing exists from prior phases. [VERIFIED: Phase 140 validation summary] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| CLI command injection through configured MCP command | Elevation of Privilege | Do not interpolate user CLI args into commands; load command/args from validated config. [VERIFIED: src/config/loader.ts + src/services/mcp-broker/client.ts] |
| Stderr secret disclosure | Information Disclosure | Surface stderr only on failure and keep buffer bounded; avoid logging env values. [VERIFIED: src/services/mcp-broker/client.ts] |
| Tool confusion between hidden and visible servers | Spoofing / Elevation of Privilege | Preserve `listToolsForConsumer` and macro allowlist checks. [VERIFIED: src/services/mcp-broker/registry.ts + Phase 142 validation summary] |
| Hung server false-positive health | Denial of Service | Use deep `tools/list` probe with 250 ms timeout for macro `_exists()`. [CITED: MCP Broker Requirements.md] |
| Concurrent response cross-contamination | Tampering | Rely on SDK JSON-RPC id correlation and add stress coverage for shared server macro calls. [CITED: MCP Broker Requirements.md] |

## Sources

### Primary (HIGH confidence)

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Requirements.md` - REQ-071..073, REQ-103..104, REQ-109..110, Phase E scope. [VERIFIED: file read]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Test Plan.md` - T-U-038..043, T-I-050, T-S-006..011, T-S-019..020, T-Y-014..015, T-E-001..004, coverage ledger rows. [VERIFIED: file read]
- `.planning/phases/143-diagnostic-cli-and-remaining-macro-extensions/143-CONTEXT.md` - user decisions and canonical refs. [VERIFIED: file read]
- `AGENTS.md` - project constraints, stack, test commands, forbidden patterns. [VERIFIED: file read]
- Context7 `/tj/commander.js` - Commander subcommands and async action docs. [CITED: /tj/commander.js]
- Context7 `/modelcontextprotocol/typescript-sdk` - MCP SDK `listTools`, `callTool`, timeout, and error behavior. [CITED: /modelcontextprotocol/typescript-sdk]
- Codebase files: `src/index.ts`, `src/services/mcp-broker/client.ts`, `src/services/mcp-broker/index.ts`, `src/mcp/tools/macro.ts`, `src/macro/parser.ts`, `src/macro/evaluator.ts`, `src/macro/introspection.ts`, `tests/config/*.ts`, existing broker/macro tests. [VERIFIED: codebase grep]

### Secondary (MEDIUM confidence)

- `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, and Phase 139-142 validation/summary files - prior phase decisions and evidence. [VERIFIED: file read]
- npm registry metadata for existing packages. [VERIFIED: npm registry]

### Tertiary (LOW confidence)

- None used for recommendations. [VERIFIED: research log]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - package versions, installed versions, and official docs were checked. [VERIFIED: package.json + npm ls + Context7]
- Architecture: HIGH - recommendations are based on existing production seams and source product docs. [VERIFIED: codebase grep + MCP Broker Requirements.md]
- Pitfalls: HIGH - most pitfalls map to observed code/test seams or explicit source requirements. [VERIFIED: codebase grep + MCP Broker Test Plan.md]

**Research date:** 2026-05-18 [VERIFIED: current_date]
**Valid until:** 2026-06-17 for repo-local planning; re-check npm/MCP SDK docs if package versions change before implementation. [ASSUMED]
