# Phase 134: Shell Verbs, Vault Jail, Introspection - Research

**Researched:** 2026-05-14 [VERIFIED: gsd init.phase-op]  
**Domain:** FlashQuery macro engine shell builtins, vault path confinement, forbidden shell-flag preflight, namespace introspection [VERIFIED: .planning/phases/134-shell-verbs-vault-jail-introspection/134-CONTEXT.md]  
**Confidence:** HIGH for phase scope, file targets, tests, and local code patterns; MEDIUM for final ShellJS type details until implementation compiles against installed packages [VERIFIED: repo audit + npm registry]

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### Source Of Truth

- Downstream agents MUST read the Macro Language requirements doc before planning, implementing, reviewing, or verifying Phase 134.
- Downstream agents MUST read the Macro Language test plan before planning, implementing, reviewing, or verifying Phase 134.
- Downstream agents MUST inspect the frozen macro POC files cited by shell, path-wrapper, forbidden-flag, and introspection requirements before implementing behavior.
- Where the requirements document and POC disagree, the requirements document is authoritative.
- Where the requirements document and test plan disagree, stop and surface the discrepancy rather than silently choosing one.

### Shell And Path Scope

- Implement shell-verb production code inside `src/macro/`, preserving the evaluator and builtin contracts produced by Phases 132-133.
- Create a dedicated shell module, likely `src/macro/shell-verbs.ts`, for the eight shell-style builtins and their flag surfaces.
- Create a dedicated path wrapper, likely `src/macro/path-wrapper.ts`, exporting `resolveMacroPath(macroPath, vaultRoot)` and a reverse path helper for `find` output if useful.
- Every path handed to ShellJS must be an absolute host path returned by the wrapper.
- Production code must not call `shelljs.cd(...)`, `sh.cd(...)`, or any cwd-mutating equivalent.
- All filesystem mutation remains outside the shell whitelist. Do not expose `cp`, `mv`, `rm`, `mkdir`, `touch`, `chmod`, `exec`, `pushd`, `popd`, `pwd`, or related ShellJS process/global helpers.

### Pre-Scan And Introspection Scope

- Add a focused forbidden-flag pre-scan module, likely `src/macro/forbidden-flag-scan.ts`, and wire it before execution so forbidden shell flags stop all statements, including statements before the offending call.
- The forbidden-flag scan must walk nested AST locations, including loop and conditional bodies.
- Add a focused introspection module, likely `src/macro/introspection.ts`, for `<server>._exists()` and unknown leading-underscore methods.
- `fq._exists()` returns `true` without dispatching a tool handler.
- Brokered `_exists()` calls route through `McpBroker.isConnected(serverId)` and must not be cached across calls.
- With `NullMcpBroker`, brokered `_exists()` calls return `false`.

### Testing Expectations

- Unit tests are the primary proof layer for Phase 134.
- The plan must map MACRO-SHELL-01 through MACRO-SHELL-05 to concrete test files and Test Plan IDs T-U-126 through T-U-155.
- Required unit test files include `tests/unit/macro-shell-verbs.test.ts`, `tests/unit/macro-path-wrapper.test.ts`, `tests/unit/macro-forbidden-flags.test.ts`, and `tests/unit/macro-introspection.test.ts` unless the planner identifies a stronger local naming split.
- Include hermetic test-vault fixtures for every shell verb, path escape/normalization, and `find` output translation.
- Include a static source assertion that production macro code contains no `sh.cd(` or `shelljs.cd(` calls.
- Include acceptance criteria that verify implementation agents read the two user-provided product docs before touching source.

### the agent's Discretion

## Specific Ideas

- Plan this as test-first vertical slices: path wrapper, shell verbs, forbidden-flag pre-scan, introspection, then full phase validation.
- Keep the shell whitelist exact and assert mutation verbs are absent from the registry.
- Make shell tests use temporary directories under the test process rather than the developer's real vault.
- Normalize `find` results back to vault-rooted macro paths so outputs can feed later shell verbs naturally.
- Use `jsonExpectedError`-compatible expected-error semantics for `forbidden_path` and `forbidden_shell_flag` with `isError: false`.
- For glob expansion, preserve the Test Plan contract: matching globs expand, empty matches produce an explicit error.
- For `_exists()`, route native `fq` directly and brokered names through the broker interface; do not invoke tool handlers and do not cache results.

### Deferred Ideas (OUT OF SCOPE)

## Deferred Ideas

- Full namespaced tool dispatch, permission pre-scan, dispatch backstop, and hard exclusions belong to Phase 135.
- Full task lifecycle, cancellation, trace/progress transport, dry-run, budgets, `source_ref`, and final `call_macro` MCP wiring remain later macro phases unless the roadmap changes.
- External MCP broker implementation is outside this phase; Phase 134 consumes the broker interface and `NullMcpBroker` only.
</user_constraints>

## Summary

Phase 134 should be planned as five tight vertical slices: path wrapper, shell verb registry, forbidden-flag pre-scan, introspection, and phase validation. The canonical requirements name the exact shell verbs, forbidden flags, expected errors, POC reference files, and test IDs, so the planner should not explore alternate shell surfaces or broader dispatch work. [CITED: /Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Requirements.md] [CITED: /Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Test Plan.md]

The current repo already has `src/macro/types.ts`, `parser.ts`, `evaluator.ts`, `builtins.ts`, `preflight.ts`, and macro unit-test helpers from Phases 130-133. It does not yet have `src/macro/shell-verbs.ts`, `path-wrapper.ts`, `forbidden-flag-scan.ts`, or `introspection.ts`; those are the primary files to create. [VERIFIED: rg --files src/macro tests/unit]

**Primary recommendation:** implement `path-wrapper.ts` and `forbidden-flag-scan.ts` first because they define the security boundary, then add shell builtins and `_exists()` wiring through the existing evaluator/context contract. [VERIFIED: src/macro/evaluator.ts] [CITED: Macro Language Requirements §6.6]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Read-only shell verbs | API / Backend | Database / Storage | Macro execution runs in FlashQuery server process; shell verbs read vault files through server-side filesystem access. [VERIFIED: AGENTS.md] |
| Vault jail path resolution | API / Backend | Database / Storage | Path confinement must occur before ShellJS sees host paths; macro `/` maps to configured vault root. [CITED: Macro Language Requirements §6.6.2] |
| Forbidden shell flag pre-scan | API / Backend | — | The evaluator must reject forbidden AST references before any statement executes. [CITED: Macro Language Requirements §6.6.3] |
| Cwd-retirement guarantee | API / Backend | OS runtime | Production macro code must avoid process-global cwd mutation and pass absolute host paths. [CITED: Macro Language Requirements §6.6.4] |
| `_exists()` introspection | API / Backend | External MCP broker | Native `fq` is resolved locally; brokered server availability is probed through `McpBroker.isConnected`. [CITED: Macro Language Requirements §6.6.5] [VERIFIED: src/services/mcp-broker.ts] |

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MACRO-SHELL-01 | The v0 read-only shell whitelist includes `grep`, `find`, `sed`, `cat`, `wc`, `head`, `tail`, and `ls`. [VERIFIED: .planning/REQUIREMENTS.md] | Use `src/macro/shell-verbs.ts`; map to T-U-126..T-U-136. [CITED: Test Plan §4.5.1] |
| MACRO-SHELL-02 | Shell path arguments are vault-jailed and escaping paths fail with `forbidden_path`. [VERIFIED: .planning/REQUIREMENTS.md] | Use `src/macro/path-wrapper.ts`; map to T-U-137..T-U-142. [CITED: Test Plan §4.5.2] |
| MACRO-SHELL-03 | `sed -i`, `find -exec`, and `find -delete` are rejected before execution. [VERIFIED: .planning/REQUIREMENTS.md] | Use `src/macro/forbidden-flag-scan.ts`; map to T-U-144..T-U-150. [CITED: Test Plan §4.5.3] |
| MACRO-SHELL-04 | Production shell execution does not mutate process-global cwd. [VERIFIED: .planning/REQUIREMENTS.md] | Static source assertion T-U-143 and concurrency regression T-U-151. [CITED: Test Plan §4.5.2-4.5.4] |
| MACRO-SHELL-05 | `_exists()` returns native `fq` availability and brokered-server connectivity through the broker interface. [VERIFIED: .planning/REQUIREMENTS.md] | Use `src/macro/introspection.ts` plus `src/services/mcp-broker.ts`; map to T-U-152..T-U-155. [CITED: Test Plan §4.5.5] |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- Node.js must be >= 20 LTS; current environment is Node v24.7.0. [VERIFIED: AGENTS.md] [VERIFIED: node --version]
- Project code is TypeScript strict mode, ESM, and uses `.js` import specifiers in source/test imports. [VERIFIED: AGENTS.md] [VERIFIED: tsconfig.json] [VERIFIED: tests/unit/macro-test-helpers.ts]
- Use async/await; module-boundary failures should surface as typed errors or expected-error envelopes, not uncaught exceptions. [VERIFIED: AGENTS.md]
- MCP/macro responses should reuse the shared response helpers and preserve human-readable text in `content`. [VERIFIED: AGENTS.md] [VERIFIED: src/macro/evaluator.ts]
- Unit tests live in `tests/unit/*.test.ts` and run with `npm test`; integration/E2E need `.env.test` and are not primary for this phase. [VERIFIED: AGENTS.md] [VERIFIED: tests/config/vitest.unit.config.ts]
- Do not use CommonJS `require`; do not build a web UI; do not implement server-side session state. [VERIFIED: AGENTS.md]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | >=20 required; v24.7.0 installed | Runtime for macro engine and tests | Project engine enforces Node >=20. [VERIFIED: package.json] [VERIFIED: node --version] |
| TypeScript | 6.0.2 in package.json | Strict ESM source implementation | Existing source is strict TS with Node16 module resolution. [VERIFIED: package.json] [VERIFIED: tsconfig.json] |
| Vitest | 4.1.1 in package.json | Phase unit tests | Existing unit config includes `tests/unit/**/*.test.ts`. [VERIFIED: package.json] [VERIFIED: tests/config/vitest.unit.config.ts] |
| ShellJS | 0.10.0 current npm version; modified 2026-04-24 | Shell-like read-only command API for `grep`, `find`, `sed`, `cat`, `head`, `tail`, `ls` | Requirements and POC specify ShellJS-backed shell verbs; Context7 docs confirm relevant command APIs. [VERIFIED: npm view shelljs] [CITED: /shelljs/shelljs] |
| fast-glob | 3.3.3 current npm version; modified 2025-01-05 | Glob expansion before shell verb file reads | POC uses `fast-glob`; Context7 docs confirm sync globbing and absolute path options. [VERIFIED: npm view fast-glob] [CITED: /mrmlnc/fast-glob] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@types/shelljs` | 0.10.0 current npm version; modified 2025-12-12 | Type declarations for ShellJS | Add with ShellJS unless implementation uses a fully local typed adapter. [VERIFIED: npm view @types/shelljs] |
| `node:path` | Built-in | Normalize, resolve, join, and compare vault paths | Use in `path-wrapper.ts`; POC uses `pathResolve`, `pathNormalize`, `pathJoin`, and `sep`. [VERIFIED: POC pathwrapper.ts] |
| `node:fs` / `node:fs/promises` | Built-in | Hermetic test vault setup and static source assertions | Existing tests use Node built-ins directly. [VERIFIED: tests/unit/macro-builtins.test.ts] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ShellJS | Native `fs` reimplementation of each verb | Do not hand-roll: requirements require ShellJS-backed semantics and POC uses ShellJS. [CITED: Macro Language Requirements §6.6.1] |
| fast-glob | ShellJS glob passthrough | Do not rely on literal passthrough: Test Plan requires explicit empty-glob errors and POC uses `fast-glob`. [CITED: Test Plan T-U-136] [VERIFIED: POC shellbuiltins.ts] |
| Dedicated `introspection.ts` | Keep logic inside `evaluator.ts` | Dedicated module matches phase context and keeps Phase 135 dispatch separate. [VERIFIED: 134-CONTEXT.md] |

**Installation:**

```bash
npm install shelljs fast-glob
npm install -D @types/shelljs
```

**Version verification:** `npm view shelljs version time.modified`, `npm view fast-glob version time.modified`, and `npm view @types/shelljs version time.modified` were run on 2026-05-14. [VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```text
Macro source
  -> parser produces Program AST
  -> evaluator preflight
       -> forbidden shell flag scan
       -> input_var contract scan
  -> evaluator execution
       -> builtins registry
            -> shell verbs
                 -> resolveMacroPath(macroPath, vaultRoot)
                 -> ShellJS command with absolute host paths
                 -> find output translated back to vault-rooted macro paths
       -> ToolExistsCall
            -> introspection resolver
                 -> fq => true
                 -> brokered server => McpBroker.isConnected(serverId)
  -> macroResult / jsonExpectedError / jsonRuntimeError
```

### Recommended Project Structure

```text
src/macro/
├── path-wrapper.ts             # vault-root path resolver + ForbiddenPathError helper usage
├── shell-verbs.ts              # exact 8 read-only shell builtins
├── forbidden-flag-scan.ts      # AST pre-scan for sed/find forbidden flags
├── introspection.ts            # _exists resolver and unknown underscore method behavior
├── evaluator.ts                # wire scan, shell builtins, vaultRoot, introspection
├── parser.ts                   # likely adjust unknown leading-underscore parsing for runtime error test
└── types.ts                    # likely extend ToolExistsCall to carry method/tool name

tests/unit/
├── macro-path-wrapper.test.ts
├── macro-shell-verbs.test.ts
├── macro-forbidden-flags.test.ts
└── macro-introspection.test.ts
```

### Pattern 1: Expected Errors for Preflight Failures

**What:** `MacroExpectedError` and `MacroPreflightError` are caught in `evaluateProgram` and returned through `jsonExpectedError` with `isError: false`. [VERIFIED: src/macro/evaluator.ts]  
**When to use:** `forbidden_path` and `forbidden_shell_flag` should be expected macro errors, not runtime `isError: true` failures. [CITED: Macro Language Requirements §6.6.2-6.6.3]  
**Example:**

```typescript
// Source: src/macro/evaluator.ts pattern
throw new MacroExpectedError('forbidden_shell_flag', 'Macro shell flag is forbidden.', {
  verb: 'sed',
  flag: '-i',
  reason: 'sed_in_place_mutates_files',
});
```

### Pattern 2: Builtin Registry Composition

**What:** `createInvocationContext` currently composes `standardBuiltins` with caller-provided builtins. [VERIFIED: src/macro/evaluator.ts]  
**When to use:** Add `shellBuiltins` as a separate import and compose `{ ...standardBuiltins, ...shellBuiltins, ...(options.builtins ?? {}) }` so unit tests can still override builtins. [VERIFIED: src/macro/evaluator.ts]  
**Example:**

```typescript
// Source: src/macro/evaluator.ts local pattern, adapted for Phase 134
builtins: { ...standardBuiltins, ...shellBuiltins, ...(options.builtins ?? {}) }
```

### Pattern 3: AST Walkers Mirror Preflight

**What:** `src/macro/preflight.ts` already recursively visits statements, expressions, pipelines, loops, conditionals, and tool calls. [VERIFIED: src/macro/preflight.ts]  
**When to use:** `forbidden-flag-scan.ts` should follow that visitor shape and include `WhileLoop`, which the POC does not have. [VERIFIED: src/macro/types.ts] [VERIFIED: POC evaluator.ts]  
**Example:**

```typescript
// Source: src/macro/preflight.ts visitor structure
case 'WhileLoop':
  visitExpr(statement.condition);
  statement.body.forEach(visitStatement);
  return;
```

### Anti-Patterns to Avoid

- **Calling `sh.cd(root)`:** The POC does this, but production must not mutate process-global cwd. [VERIFIED: POC shellbuiltins.ts] [CITED: Macro Language Requirements §5.4, §6.6.4]
- **Putting Phase 135 permission logic here:** Tool dispatch permission pre-scan and hard exclusions are explicitly deferred. [VERIFIED: 134-CONTEXT.md]
- **Rejecting unknown underscore methods only at parse time:** Current parser rejects non-`_exists` methods, but Test Plan T-U-154 requires `fq._unknown_method()` to raise a runtime error. [VERIFIED: src/macro/parser.ts] [CITED: Test Plan T-U-154]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Unix-like file commands | Custom grep/find/sed/cat implementations | ShellJS wrappers | Requirements specify ShellJS-backed builtins and Context7 confirms ShellJS command APIs. [CITED: Macro Language Requirements §6.6.1] [CITED: /shelljs/shelljs] |
| Glob expansion | Ad hoc wildcard matching | fast-glob | POC uses fast-glob and Test Plan requires explicit empty-match handling. [VERIFIED: POC shellbuiltins.ts] [CITED: Test Plan T-U-136] |
| Vault escape checks | String prefix checks on raw user input | `path.resolve`/`path.normalize` then root-boundary comparison | POC wrapper normalizes resolved host paths and checks root containment with separator boundary. [VERIFIED: POC pathwrapper.ts] |
| Broker connectivity | Cached registry presence | `McpBroker.isConnected(serverId)` per call | Requirements require fresh live probe and no caching. [CITED: Macro Language Requirements §6.6.5] |

**Key insight:** the hard parts are not the eight verbs themselves; they are preserving the read-only security boundary, doing all path conversion before host filesystem access, and rejecting dangerous flags before any prior statement can execute. [CITED: Macro Language Requirements §6.6]

## Component Responsibilities

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `src/macro/path-wrapper.ts` | Create | Export `resolveMacroPath(macroPath, vaultRoot)` and likely `toMacroPath(hostPath, vaultRoot)` for `find` output. [CITED: Macro Language Requirements §8.7] |
| `src/macro/shell-verbs.ts` | Create | Export exact eight shell builtins; do not expose mutation verbs; use wrapper for every file/path argument. [CITED: Macro Language Requirements §8.7] |
| `src/macro/forbidden-flag-scan.ts` | Create | Walk AST and throw expected error for `sed -i`, `sed --in-place`, `sed --i`, `find -exec`, `find --exec`, `find -delete`, `find --delete`. [CITED: Macro Language Requirements §6.6.3] |
| `src/macro/introspection.ts` | Create | Resolve `_exists` through native/broker distinction and runtime-error unknown underscore methods. [CITED: Macro Language Requirements §6.6.5] |
| `src/macro/evaluator.ts` | Modify | Add `vaultRoot` and broker/introspection context options, compose shell builtins, invoke forbidden-flag scan before input execution, and route `ToolExistsCall`. [VERIFIED: src/macro/evaluator.ts] |
| `src/macro/types.ts` | Modify likely | Current `ToolExistsCall` stores only `server`; runtime unknown-method support likely needs method/tool name. [VERIFIED: src/macro/types.ts] |
| `src/macro/parser.ts` | Modify likely | Current parser rejects unknown leading-underscore methods at parse time; T-U-154 requires runtime error. [VERIFIED: src/macro/parser.ts] [CITED: Test Plan T-U-154] |
| `src/services/mcp-broker.ts` | Existing | Reuse `McpBroker` and `NullMcpBroker`; no real broker implementation in this phase. [VERIFIED: src/services/mcp-broker.ts] |
| `package.json` | Modify | Add `shelljs`, `fast-glob`, and likely `@types/shelljs`. [VERIFIED: package.json] [VERIFIED: npm ls shelljs fast-glob @types/shelljs] |

## Common Pitfalls

### Pitfall 1: Pre-scan Runs Too Late

**What goes wrong:** `echo "before"` or another side-effecting builtin executes before `sed -i` is rejected. [CITED: Test Plan T-U-150]  
**Why it happens:** Forbidden flags are checked inside shell dispatch instead of as an AST preflight. [VERIFIED: POC shellbuiltins.ts comments]  
**How to avoid:** Run `preScanForbiddenFlags(program)` at the start of `evaluateProgram`, before `collectInputVarContract`, `validateInputVars`, and `execBlock`. [VERIFIED: src/macro/evaluator.ts]  
**Warning signs:** The test observes non-empty trace/log after forbidden-flag rejection. [CITED: Test Plan T-U-150]

### Pitfall 2: Missing AST Locations

**What goes wrong:** Forbidden flags inside `for`, `while`, `if` branches, binding RHS pipelines, or nested expressions are missed. [CITED: Test Plan T-U-149]  
**Why it happens:** Copying the POC visitor without adding production `WhileLoop` and current expression variants. [VERIFIED: src/macro/types.ts] [VERIFIED: POC evaluator.ts]  
**How to avoid:** Base the scanner on `src/macro/preflight.ts`, not only the POC. [VERIFIED: src/macro/preflight.ts]  
**Warning signs:** Scanner tests pass for top-level pipelines but not loop/conditional bodies. [CITED: Test Plan T-U-149]

### Pitfall 3: Cwd Mutation Hidden in Helpers

**What goes wrong:** `sh.cd(root)` or equivalent process cwd mutation introduces cross-session races. [CITED: Macro Language Requirements §6.6.4]  
**Why it happens:** The POC helper `ensureVaultCwd` calls `sh.cd(root)` on every shell dispatch. [VERIFIED: POC shellbuiltins.ts]  
**How to avoid:** Remove the helper concept; all path arguments become absolute host paths via `resolveMacroPath`, and no shell verb depends on cwd. [CITED: Macro Language Requirements §6.6.2-6.6.4]  
**Warning signs:** Static grep finds `sh.cd(`, `shelljs.cd(`, or `process.chdir(` under `src/macro`. [CITED: Test Plan T-U-143]

### Pitfall 4: Pipeline Stdin Is Not Threaded

**What goes wrong:** `cat file | grep PATTERN | wc -l` executes each stage independently. [CITED: Test Plan T-U-135]  
**Why it happens:** Current evaluator calls each stage without passing prior output into context. [VERIFIED: src/macro/evaluator.ts]  
**How to avoid:** Add a scoped `stdin` field or equivalent stage-local context for builtins during `evalPipeline`; do not store it globally across invocations. [VERIFIED: src/macro/evaluator.ts] [VERIFIED: POC shellbuiltins.ts]  
**Warning signs:** Single shell verbs pass but T-U-135 fails. [CITED: Test Plan T-U-135]

### Pitfall 5: `_exists()` Parser/Evaluator Contract Mismatch

**What goes wrong:** `fq._unknown_method()` fails as `parse_error` instead of runtime error. [VERIFIED: src/macro/parser.ts] [CITED: Test Plan T-U-154]  
**Why it happens:** Current `ToolExistsCall` type only represents `_exists`, so unknown underscore calls cannot reach the evaluator. [VERIFIED: src/macro/types.ts]  
**How to avoid:** Extend the AST to represent engine introspection calls with method name, or a specific `ToolIntrospectionCall`, then make `introspection.ts` reject unsupported methods at runtime. [ASSUMED]  
**Warning signs:** T-U-154 observes `parse_error` or `unexpected_token`. [CITED: Test Plan T-U-154]

## Code Examples

### Vault-Jail Resolver

```typescript
// Source: POC pathwrapper.ts, adapted for production error shape
const pathInVault = macroPath.startsWith('/') ? macroPath.slice(1) : macroPath;
const normalized = pathNormalize(pathResolve(pathJoin(vaultRoot, pathInVault)));
const normalizedRoot = pathNormalize(pathResolve(vaultRoot));
const rootWithSep = normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep;
if (normalized !== normalizedRoot && !normalized.startsWith(rootWithSep)) {
  throw new MacroExpectedError('forbidden_path', 'macro shell verbs cannot reach outside the vault root', {
    path: macroPath,
    reason: 'resolves_outside_vault',
  });
}
```

### Forbidden Flag Detection

```typescript
// Source: POC evaluator.ts and current src/macro/preflight.ts visitor pattern
if (call.name === 'sed' && arg.kind === 'NamedArg') {
  if (arg.rawShortFlag?.includes('i') || (!arg.rawShortFlag && (arg.name === 'i' || arg.name === 'in-place'))) {
    throw forbiddenShellFlag('sed', arg.rawShortFlag ?? `--${arg.name}`, 'sed_in_place_mutates_files');
  }
}
```

### Brokered `_exists()`

```typescript
// Source: requirements §6.6.5 + src/services/mcp-broker.ts
if (server === 'fq') return true;
return broker.isConnected(server);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| POC calls `sh.cd(vaultRoot)` per shell dispatch | Production passes absolute host paths and forbids cwd mutation | Requirements frozen 2026-05-13; phase context gathered 2026-05-14 | Planner must include static no-cwd assertion and concurrency test. [VERIFIED: POC shellbuiltins.ts] [CITED: Macro Language Requirements §5.4] |
| POC `_exists()` checks registry presence | Production uses `fq => true`, brokered `broker.isConnected(serverId)`, no cache | Requirements frozen 2026-05-13 | Planner must include mock broker call-count tests. [VERIFIED: POC evaluator.ts] [CITED: Macro Language Requirements §6.6.5] |
| Current parser rejects unknown underscore methods | Test plan expects runtime error for unknown underscore method | Existing repo state as of 2026-05-14 | Planner must include parser/type/evaluator adjustment or explicitly resolve discrepancy before implementation. [VERIFIED: src/macro/parser.ts] [CITED: Test Plan T-U-154] |

**Deprecated/outdated:**
- POC `ensureVaultCwd`: production must not copy it because it calls `sh.cd(root)`. [VERIFIED: POC shellbuiltins.ts] [CITED: Macro Language Requirements §5.4]
- POC registry-presence `_exists`: production must use broker connectivity for brokered servers. [VERIFIED: POC evaluator.ts] [CITED: Macro Language Requirements §6.6.5]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Unknown leading-underscore methods should be represented in the AST and rejected at runtime, not parse time. | Common Pitfalls / Component Responsibilities | If wrong, T-U-154 and REQ-045 wording need clarification before planning. |
| A2 | `@types/shelljs` should be installed for strict TS rather than a fully hand-written local ShellJS type adapter. | Standard Stack | If wrong, planner should replace dependency task with a typed adapter task. |

## Open Questions

1. **Should unknown leading-underscore methods require a parser change in Phase 134?**
   - What we know: Test Plan T-U-154 says `fq._unknown_method()` should raise a runtime error. [CITED: Test Plan T-U-154]
   - What's unclear: Current parser rejects unknown underscore methods before evaluation. [VERIFIED: src/macro/parser.ts]
   - Recommendation: Treat the parser/type change as in-scope for Phase 134 because otherwise REQ-045 cannot be tested as specified. [ASSUMED]

2. **What exact `vaultRoot` option name should evaluator expose?**
   - What we know: Requirements say vault root is configured at engine init from FlashQuery config, and current `EvaluateProgramOptions` has no `vaultRoot`. [CITED: Macro Language Requirements §6.6.2] [VERIFIED: src/macro/evaluator.ts]
   - What's unclear: Final `call_macro` handler wiring is later, so Phase 134 unit tests can supply `vaultRoot` directly. [VERIFIED: 134-CONTEXT.md]
   - Recommendation: Add `vaultRoot?: string` to `EvaluateProgramOptions` and `MacroInvocationContext`. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build/test runtime | yes | v24.7.0 | Must remain >=20. [VERIFIED: node --version] |
| npm | Dependency install and tests | yes | 11.5.1 | None needed. [VERIFIED: npm --version] |
| rg | Static source checks | yes | installed path verified | Use `grep -R` if unavailable. [VERIFIED: command -v rg] |
| gsd-sdk | Phase metadata and optional commit | yes | installed path verified | Manual docs commit if unavailable. [VERIFIED: command -v gsd-sdk] |
| ShellJS package | Shell verbs | no | npm current 0.10.0 | Install package; no hand-rolled fallback. [VERIFIED: npm ls shelljs] [VERIFIED: npm view shelljs] |
| fast-glob package | Glob expansion | no | npm current 3.3.3 | Install package; no ad hoc wildcard fallback. [VERIFIED: npm ls fast-glob] [VERIFIED: npm view fast-glob] |
| `@types/shelljs` | TypeScript compile | no | npm current 0.10.0 | Local adapter possible but not recommended. [VERIFIED: npm ls @types/shelljs] [VERIFIED: npm view @types/shelljs] |

**Missing dependencies with no fallback:**
- `shelljs` and `fast-glob` are required to match the canonical POC/requirements behavior. [CITED: Macro Language Requirements §6.6.1] [VERIFIED: npm ls shelljs fast-glob]

**Missing dependencies with fallback:**
- `@types/shelljs` can be replaced by a small typed adapter, but installing the type package is simpler under strict TypeScript. [ASSUMED]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 [VERIFIED: package.json] |
| Config file | `tests/config/vitest.unit.config.ts` [VERIFIED: tests/config/vitest.unit.config.ts] |
| Quick run command | `npm test -- tests/unit/macro-path-wrapper.test.ts tests/unit/macro-shell-verbs.test.ts tests/unit/macro-forbidden-flags.test.ts tests/unit/macro-introspection.test.ts` [VERIFIED: package.json] |
| Full suite command | `npm test` [VERIFIED: package.json] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| MACRO-SHELL-01 | Eight shell verbs and no mutation verbs | unit | `npm test -- tests/unit/macro-shell-verbs.test.ts` | no, Wave 0 [VERIFIED: rg --files tests/unit] |
| MACRO-SHELL-02 | Vault path jail and find output translation | unit | `npm test -- tests/unit/macro-path-wrapper.test.ts` | no, Wave 0 [VERIFIED: rg --files tests/unit] |
| MACRO-SHELL-03 | Forbidden flag pre-scan before execution | unit | `npm test -- tests/unit/macro-forbidden-flags.test.ts` | no, Wave 0 [VERIFIED: rg --files tests/unit] |
| MACRO-SHELL-04 | No cwd mutation and concurrent no-race behavior | unit/static | `npm test -- tests/unit/macro-shell-verbs.test.ts` | no, Wave 0 [VERIFIED: rg --files tests/unit] |
| MACRO-SHELL-05 | `_exists()` native/brokered/unknown behavior | unit | `npm test -- tests/unit/macro-introspection.test.ts` | no, Wave 0 [VERIFIED: rg --files tests/unit] |

### Sampling Rate

- **Per task commit:** run the focused unit file for the changed module. [ASSUMED]
- **Per wave merge:** `npm test -- tests/unit/macro-path-wrapper.test.ts tests/unit/macro-shell-verbs.test.ts tests/unit/macro-forbidden-flags.test.ts tests/unit/macro-introspection.test.ts`. [ASSUMED]
- **Phase gate:** `npm test` plus static grep assertion for `sh.cd(`, `shelljs.cd(`, and `process.chdir(` under `src/macro`. [CITED: Test Plan T-U-143]

### Wave 0 Gaps

- [ ] `tests/unit/macro-path-wrapper.test.ts` — covers MACRO-SHELL-02 / T-U-137..T-U-142. [CITED: Test Plan §4.5.2]
- [ ] `tests/unit/macro-shell-verbs.test.ts` — covers MACRO-SHELL-01 and MACRO-SHELL-04 / T-U-126..T-U-136, T-U-143, T-U-151. [CITED: Test Plan §4.5.1-4.5.4]
- [ ] `tests/unit/macro-forbidden-flags.test.ts` — covers MACRO-SHELL-03 / T-U-144..T-U-150. [CITED: Test Plan §4.5.3]
- [ ] `tests/unit/macro-introspection.test.ts` — covers MACRO-SHELL-05 / T-U-152..T-U-155. [CITED: Test Plan §4.5.5]
- [ ] Dependency install: `npm install shelljs fast-glob && npm install -D @types/shelljs`. [VERIFIED: npm registry]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Phase 134 does not change auth/session surfaces. [VERIFIED: 134-CONTEXT.md] |
| V3 Session Management | no | MCP remains stateless and this phase does not add server session state. [VERIFIED: AGENTS.md] |
| V4 Access Control | yes | Vault jail prevents shell verbs from reading outside configured vault root. [CITED: Macro Language Requirements §6.6.2] |
| V5 Input Validation | yes | Parser/pre-scan validate shell flags; path wrapper validates every path argument. [CITED: Macro Language Requirements §6.6.2-6.6.3] |
| V6 Cryptography | no | No cryptographic behavior is added. [VERIFIED: 134-CONTEXT.md] |

### Known Threat Patterns for Macro Shell Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via `..` | Information Disclosure | Resolve/normalize against vault root and reject paths outside root with `forbidden_path`. [CITED: Macro Language Requirements §6.6.2] |
| Arbitrary command execution via `find -exec` | Elevation of Privilege | AST pre-scan rejects `find -exec` and `find --exec` before execution. [CITED: Macro Language Requirements §6.6.3] |
| File mutation via `sed -i` or `find -delete` | Tampering | AST pre-scan rejects in-place/delete flags before any statement executes. [CITED: Macro Language Requirements §6.6.3] |
| Cross-session cwd race | Tampering / Information Disclosure | Never call `sh.cd`, `shelljs.cd`, or `process.chdir`; pass absolute paths. [CITED: Macro Language Requirements §6.6.4] |
| Namespace spoofing via leading-underscore method | Spoofing | Engine-resolve only `_exists`; unknown underscore methods runtime-error and never dispatch to tool handlers. [CITED: Macro Language Requirements §6.6.5] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/134-shell-verbs-vault-jail-introspection/134-CONTEXT.md` - locked decisions, source-of-truth rule, scope boundaries. [VERIFIED: local file read]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Requirements.md` - REQ-041 through REQ-045 and phase development work. [CITED: local canonical doc]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Test Plan.md` - T-U-126 through T-U-155 and requirement-test mapping. [CITED: local canonical doc]
- POC files `shellbuiltins.ts`, `pathwrapper.ts`, `evaluator.ts`, `mockbrokers.ts`, examples 04/15/16 - executable reference with documented production divergences. [VERIFIED: local POC read]
- Local source `src/macro/*`, `src/services/mcp-broker.ts`, `tests/unit/*`, `package.json`, `tsconfig.json` - current implementation state. [VERIFIED: repo audit]
- Context7 `/shelljs/shelljs` - ShellJS command and global config behavior. [CITED: Context7]
- Context7 `/mrmlnc/fast-glob` - sync globbing and path output behavior. [CITED: Context7]
- npm registry - current package versions for `shelljs`, `fast-glob`, `@types/shelljs`. [VERIFIED: npm view]

### Secondary (MEDIUM confidence)

- None used beyond primary/local verified sources. [VERIFIED: source log]

### Tertiary (LOW confidence)

- Assumptions A1 and A2 only. [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH for required packages and versions; MEDIUM for exact ShellJS TypeScript ergonomics until compile. [VERIFIED: npm registry] [ASSUMED]
- Architecture: HIGH because requirements, phase context, and existing macro evaluator align. [VERIFIED: 134-CONTEXT.md] [VERIFIED: src/macro/evaluator.ts]
- Pitfalls: HIGH for cwd/pre-scan/path jail; MEDIUM for parser change recommendation until planner confirms runtime-error interpretation. [CITED: Macro Language Requirements §6.6] [ASSUMED]

**Research date:** 2026-05-14 [VERIFIED: environment_context]  
**Valid until:** 2026-06-13 for local architecture; 2026-05-21 for npm package version currency. [ASSUMED]
