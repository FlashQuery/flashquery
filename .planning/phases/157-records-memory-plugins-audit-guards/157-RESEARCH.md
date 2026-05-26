# Phase 157: Records / Memory / Plugins Audit + Guards - Research

**Researched:** 2026-05-26
**Domain:** FlashQuery MCP tool concurrency, Supabase/Postgres coordination
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### Canonical Inputs
- Downstream planning, implementation, and verification agents MUST read the
  supplied product requirements and test plan before asking scope questions.
- Requirements source:
  `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Requirements.md`
- Test plan source:
  `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Test Plan.md`

### Locked Scope
- Implement REQ-023 and no other requirement.
- Remove `acquireLock('records', ...)`, `acquireLock('memory', ...)`, and
  `acquireLock('plugins', ...)` usage from `src/mcp/tools/records.ts`,
  `src/mcp/tools/memory.ts`, and `src/mcp/tools/plugins.ts`.
- Remove matching `releaseLock(..., 'records'|'memory'|'plugins')` calls from
  those same paths.
- Preserve user-facing expected conflict behavior for memory update races:
  `write_memory` should still map RPC `23505` and non-latest conflicts to the
  existing structured `conflict` / `non_latest_memory_version` response.
- Produce a concurrency review artifact for records reconciliation before
  relying on lock removal. It must explicitly decide whether
  `reconcilePluginDocuments` + `executeReconciliationActions` are idempotent
  under concurrent runs or require a per-plugin/instance advisory guard.
- If the records reconciliation preamble needs serialization, add a narrowly
  scoped guard keyed by plugin id, plugin instance, and FlashQuery instance id.
  Do not recreate a global `'records'` lock.
- Wrap `unregister_plugin`'s registry/review/memory/document ownership cleanup
  sequence in a safe coordination mechanism that leaves either one complete
  unregister and one clear not-found/not-registered response, or a clear
  conflict/error. It must not leave half-deleted plugin state.
- Add or update exactly the required Test Plan §4.5.1 cases:
  `T-U-036`, `T-I-043`, `T-I-044`, and `T-I-045`.

### Guardrail Decisions
- New coordination for records/plugins may use Postgres advisory locks if that
  is the least invasive way to preserve behavior before the global advisory
  lock phase. Any such guard must use session-stable `withPgClient` behavior
  from `src/utils/pg-client.ts` and must not use transaction-scoped advisory
  locks.
- Prefer a small local database coordination helper if both records
  reconciliation and plugin unregister need the same per-plugin advisory lock
  pattern. Do not broaden it into the future full document lock subsystem.
- Keep memory lock removal simple. Do not add a replacement mutex, advisory
  lock, or table lock for memory.
- Any implementation agent that finds the product assumptions wrong must stop
  and flag the discrepancy rather than silently changing scope.

### the agent's Discretion
- The records reconciliation audit can live as a new phase artifact in this
  directory or as a summary section in the final plan summary, provided
  execution evidence can point to it directly.
- The exact structured response text for concurrent `unregister_plugin` can
  reuse existing `not_found`, `conflict`, or runtime-error helpers as long as
  the response is deterministic enough for T-I-045 to assert.

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

- Do not drop the `fqc_write_locks` table or remove `flashquery unlock`.
- Do not remove the document/macro use of `src/services/write-lock.ts`.
- Do not implement the full native Postgres advisory document lock tier.
- Do not add folder locks, destination-path locks, EXDEV fallback fixes, or
  version-token schemas/conflict envelopes.
- Do not change the memory schema or RPC unless direct evidence shows the
  existing `fqc_memory_create_version` invariant is false.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-023 | Remove coarse records/memory/plugins `fqc_write_locks` usage while preserving non-file subsystem concurrency safety. | Memory is already guarded by `fqc_memory_create_version`; records reconciliation needs scoped serialization because the `added` branch is not idempotent; plugin unregister needs per-plugin coordination or raw-`pg` transaction because Supabase client chains are separate API calls. [CITED: product requirements §6.5.1] [VERIFIED: codebase grep] |
</phase_requirements>

## Summary

Phase 157 is a narrow coordination cleanup before retiring `fqc_write_locks`: remove the coarse `'records'`, `'memory'`, and `'plugins'` lock calls, but only add narrower guards where the code still has real multi-step race exposure. [CITED: .planning/phases/157-records-memory-plugins-audit-guards/157-CONTEXT.md] [CITED: product requirements §6.5.1]

Memory should get no replacement lock because `write_memory` updates call the `fqc_memory_create_version` RPC, which locks the previous row with `FOR UPDATE`, flips the prior row to `is_latest=false`, inserts the next row as latest, and maps conflict codes `23505` / `P0002` into structured expected responses. [VERIFIED: codebase grep] [CITED: product requirements §6.5.1]

Records reconciliation should be treated as not idempotent under concurrent first runs: `executeReconciliationActions()` handles `result.added` with plain frontmatter writes, `fqc_documents` updates, plugin-table `INSERT`, and optional pending-review `INSERT`, while `reconcilePluginDocuments()` marks the in-memory staleness cache only after classification. [VERIFIED: codebase grep] The planner should add a narrowly scoped per-plugin/instance/FQC-instance session advisory guard around the reconciliation preamble instead of relying on no-op removal. [CITED: PostgreSQL advisory lock docs] [CITED: product requirements §6.5.1]

**Primary recommendation:** implement a tiny `withPluginCoordinationLock()` helper using `withPgClient()` + `pg_advisory_lock` / `pg_advisory_unlock`, use it around records reconciliation and `unregister_plugin`, remove all coarse lock imports/calls, and add the four required tests. [VERIFIED: codebase grep] [CITED: PostgreSQL advisory lock docs]

## Project Constraints (from AGENTS.md)

- Runtime is Node.js >= 20 LTS, TypeScript strict mode, ESM only; do not introduce CommonJS. [CITED: AGENTS.md]
- Use `@modelcontextprotocol/sdk`, not `@modelcontextprotocol/server`. [CITED: AGENTS.md]
- FlashQuery is CLI + MCP only; do not build a web UI. [CITED: AGENTS.md]
- MCP handlers catch failures internally and return MCP text responses with `isError: true` for runtime failures. [CITED: AGENTS.md]
- External input validation uses Zod. [CITED: AGENTS.md]
- Tests are Vitest; unit tests live under `tests/unit/*.test.ts`, integration tests under `tests/integration/*.test.ts`, and integration/E2E rely on `.env.test` via `tests/helpers/test-env.ts`. [CITED: AGENTS.md] [VERIFIED: codebase grep]
- Do not use `npm link` for local development. [CITED: AGENTS.md]
- Supabase tables use `snake_case` and internal tables use the `fqc_` prefix. [CITED: AGENTS.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Memory version race handling | Database / Storage | MCP tool handler | The RPC owns row locking and latest-version mutation; the tool maps known DB conflicts to expected MCP responses. [VERIFIED: codebase grep] |
| Records reconciliation serialization | API / Backend | Database / Storage | MCP record tools trigger reconciliation; Postgres advisory locks provide cross-process serialization for the non-idempotent preamble. [VERIFIED: codebase grep] [CITED: PostgreSQL advisory lock docs] |
| Plugin unregister cleanup coordination | API / Backend | Database / Storage | `unregister_plugin` orchestrates registry, review, memory, document ownership, PluginManager, and manifest reload side effects. [VERIFIED: codebase grep] |
| Test gates | Test harness | Database / Storage | Required tests are Vitest unit/integration files, and DB-backed cases should skip when `HAS_SUPABASE` is false. [CITED: test plan §4.5.1] [VERIFIED: codebase grep] |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | local `v24.7.0`; project requires `>=20` | Runtime | Existing project runtime and engines field. [VERIFIED: local command] [CITED: AGENTS.md] |
| TypeScript / ESM | project `"type": "module"` | Source module system | Existing project convention forbids CommonJS. [VERIFIED: local command] [CITED: AGENTS.md] |
| `@supabase/supabase-js` | lockfile `2.106.2`; npm latest `2.106.2` published/modified 2026-05-26 | Existing PostgREST data client | Keep for ordinary table operations; do not use it for explicit multi-call transactions. [VERIFIED: npm registry] [CITED: Context7 /supabase/supabase] |
| `pg` | lockfile `8.21.0`; npm latest `8.21.0` published/modified 2026-05-18 | Session-capable Postgres access | Required for advisory locks and explicit `BEGIN`/`COMMIT` work on one connection. [VERIFIED: npm registry] [VERIFIED: codebase grep] |
| Vitest | lockfile `4.1.7`; npm latest `4.1.7` published/modified 2026-05-20 | Unit/integration tests | Existing `npm test` and `npm run test:integration` runner. [VERIFIED: npm registry] [VERIFIED: codebase grep] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@modelcontextprotocol/sdk` | lockfile `1.29.0`; npm latest `1.29.0` published/modified 2026-03-30 | MCP server tool registration | Existing tool surfaces in `memory.ts`, `records.ts`, and `plugins.ts`. [VERIFIED: npm registry] [VERIFIED: codebase grep] |
| `zod` | lockfile `4.4.3`; npm latest `4.4.3` published/modified 2026-05-04 | MCP input schemas | Existing handler schema definitions. [VERIFIED: npm registry] [VERIFIED: codebase grep] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Per-plugin session advisory guard | No-op records lock removal | Unsafe for current `added` path because concurrent classifiers can both produce insert actions. [VERIFIED: codebase grep] |
| Per-plugin advisory guard for unregister | Single raw `pg` transaction | A raw transaction is more atomic for DB rows but requires rewriting Supabase update/delete chains into SQL and still does not atomically cover PluginManager/manifest reload side effects. [VERIFIED: codebase grep] [CITED: Context7 /supabase/supabase] |
| Raw SQL helper | Future full document advisory lock subsystem | Out of scope; this phase must not broaden into Phase 158+ document lock work. [CITED: 157-CONTEXT.md] |

**Installation:** no new packages recommended. [VERIFIED: codebase grep]

## Package Legitimacy Audit

No external package installation is recommended for Phase 157; existing dependencies already include `pg`, `@supabase/supabase-js`, `@modelcontextprotocol/sdk`, `zod`, and `vitest`. [VERIFIED: npm registry] [VERIFIED: codebase grep]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| none | — | — | — | — | not run | No new package install. [VERIFIED: codebase grep] |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: codebase grep]
**Packages flagged as suspicious [SUS]:** none. [VERIFIED: codebase grep]

## Architecture Patterns

### System Architecture Diagram

```text
MCP request
  |
  +--> write_memory(update)
  |      -> Supabase RPC fqc_memory_create_version
  |      -> Postgres row lock + latest-row mutation
  |      -> structured conflict/not_found mapping
  |
  +--> write_record / archive_record / search_records
  |      -> withPluginCoordinationLock(plugin_id, plugin_instance, fqc_instance)
  |      -> reconcilePluginDocuments()
  |      -> executeReconciliationActions()
  |      -> core record read/write/search
  |
  +--> unregister_plugin
         -> withPluginCoordinationLock(plugin_id, plugin_instance, fqc_instance)
         -> registry inventory + live-record conflict check
         -> cleanup documents/memory/pending-review/registry with checked errors
         -> PluginManager remove + type registry rebuild + manifest reload
```

### Recommended Project Structure

```text
src/
├── services/
│   ├── plugin-coordination-lock.ts   # small session-level advisory lock helper for this phase
│   └── plugin-reconciliation.ts      # existing classifier/executor, optionally helper wrapper only
├── mcp/tools/
│   ├── memory.ts                     # remove coarse memory lock, keep RPC conflict mapping
│   ├── records.ts                    # remove coarse records lock, guard reconciliation preamble
│   └── plugins.ts                    # remove coarse plugins lock, guard unregister sequence
└── utils/
    └── pg-client.ts                  # existing withPgClient session checkout
```

### Pattern 1: Session Advisory Guard

**What:** Borrow one `pg` pool client with `withPgClient()`, acquire a session-level advisory lock, run the critical section, and release in `finally`. [VERIFIED: codebase grep] [CITED: PostgreSQL advisory lock docs]

**When to use:** Use for records reconciliation and plugin unregister coordination where the phase requires a scoped lock but forbids recreating a global resource lock. [CITED: 157-CONTEXT.md]

**Example:**
```ts
// Source: PostgreSQL advisory lock docs + src/utils/pg-client.ts
await withPgClient(databaseUrl, async (client) => {
  await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0)::bigint)', [lockKey]);
  try {
    return await fn();
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0)::bigint)', [lockKey]);
  }
});
```

### Pattern 2: Checked Cleanup Sequence

**What:** For `unregister_plugin`, keep the existing structured inventory response but stop swallowing delete/update failures; any DB cleanup failure must return a runtime error before claiming `status: "unregistered"`. [VERIFIED: codebase grep]

**When to use:** Use if choosing the less invasive per-plugin advisory guard instead of a raw `pg` transaction. [CITED: product requirements §6.5.1]

**Example:**
```ts
// Source: current plugins.ts Supabase cleanup chains
const { error } = await supabase
  .from('fqc_plugin_registry')
  .delete()
  .eq('plugin_id', pluginId)
  .eq('plugin_instance', instanceName)
  .eq('instance_id', config.instance.id);
if (error) return jsonRuntimeError(`Failed to delete registry entry: ${error.message}`);
```

### Anti-Patterns to Avoid

- **Global replacement lock:** Do not replace `'records'` / `'plugins'` with another global key; key any guard by plugin id, plugin instance, and FlashQuery instance id. [CITED: 157-CONTEXT.md]
- **Transaction-scoped advisory locks:** Do not use `pg_advisory_xact_lock`; the context explicitly requires session-stable `withPgClient` behavior and forbids transaction-scoped advisory locks. [CITED: 157-CONTEXT.md] [CITED: PostgreSQL advisory lock docs]
- **Supabase chained transaction assumption:** Do not assume several Supabase JS `.from(...).update/delete()` calls are one transaction; use raw `pg` for explicit transaction semantics or add a coordination guard and checked failure handling. [CITED: Context7 /supabase/supabase] [VERIFIED: codebase grep]
- **Swallowed unregister cleanup errors:** Current `unregister_plugin` catches and logs cleanup failures, then can still return success; Phase 157 must not preserve that shape. [VERIFIED: codebase grep] [CITED: product requirements §6.5.1]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Database concurrency primitive | New table-backed lock or JS mutex | Postgres advisory locks through `withPgClient()` | Advisory locks are server-managed, cross-process, and released on session end. [CITED: PostgreSQL advisory lock docs] |
| Memory update race prevention | Custom mutex around `write_memory` | Existing `fqc_memory_create_version` RPC | The RPC uses `FOR UPDATE` and latest-chain mutation in the database. [VERIFIED: codebase grep] |
| Multi-call Supabase transaction | Try/catch compensation after partial writes | Raw `pg` `BEGIN`/`COMMIT` or guarded checked sequence | Supabase JS exposes RPC/table APIs; explicit multi-statement app transactions belong in Postgres functions or direct connection code. [CITED: Context7 /supabase/supabase] |
| Static source gate | Runtime smoke check | Vitest source scan in `tests/unit/no-coarse-resource-locks.test.ts` | T-U-036 is a build-time negative check. [CITED: test plan §4.5.1] |

**Key insight:** records and plugins are database-backed, but their current hazards are orchestration hazards, not file write hazards; solve them at the plugin-instance boundary, not with document locks. [CITED: product requirements §6.5.1] [VERIFIED: codebase grep]

## Common Pitfalls

### Pitfall 1: Mistaking Reconciliation for Idempotent
**What goes wrong:** Two concurrent first reconciliations classify the same document as `added` and both execute plugin-table `INSERT` / pending-review `INSERT`. [VERIFIED: codebase grep]
**Why it happens:** The staleness cache is an in-memory timestamp set after classification and is not a cross-process or pre-action guard. [VERIFIED: codebase grep]
**How to avoid:** Wrap `reconcilePluginDocuments()` + `executeReconciliationActions()` in a per-plugin/instance/FQC-instance advisory guard. [CITED: product requirements §6.5.1] [CITED: PostgreSQL advisory lock docs]
**Warning signs:** T-I-044 observes duplicate plugin table rows, duplicate pending review rows, or conflicting insert errors. [CITED: test plan §4.5.1]

### Pitfall 2: Returning Success After Partial Unregister Cleanup
**What goes wrong:** A cleanup `update` or `delete` fails, the handler logs the error, removes the PluginManager entry, rebuilds type registry, reloads manifests, and returns `status: "unregistered"`. [VERIFIED: codebase grep]
**Why it happens:** Existing cleanup blocks catch and log errors individually. [VERIFIED: codebase grep]
**How to avoid:** Either convert DB cleanup to raw `pg` transaction, or keep Supabase calls under an advisory guard and return runtime error on the first cleanup error before claiming success. [CITED: product requirements §6.5.1]
**Warning signs:** T-I-045 leaves registry/review/memory/document ownership state inconsistent after racing two unregister calls. [CITED: test plan §4.5.1]

### Pitfall 3: Advisory Lock Release on the Wrong Connection
**What goes wrong:** A lock is acquired on one connection and released on another, leaving the lock held until session end. [CITED: PostgreSQL advisory lock docs]
**Why it happens:** Session-level advisory locks are connection-scoped. [CITED: PostgreSQL advisory lock docs]
**How to avoid:** Use `withPgClient()` and acquire/release through the same borrowed client in one callback. [VERIFIED: codebase grep]
**Warning signs:** Integration tests hang or subsequent same-key operations block. [CITED: PostgreSQL advisory lock docs]

### Pitfall 4: Forgetting Vitest Integration Include List
**What goes wrong:** New integration files are not run by `npm run test:integration`. [VERIFIED: codebase grep]
**Why it happens:** `tests/config/vitest.integration.config.ts` has an explicit `include` array. [VERIFIED: codebase grep]
**How to avoid:** Add `memory-no-coarse-lock.integration.test.ts`, `records-reconciliation.integration.test.ts`, and `unregister-plugin-races.integration.test.ts` to that include list if they are new files. [VERIFIED: codebase grep] [CITED: test plan §4.5.1]
**Warning signs:** The grep-based command finds no matching tests despite files existing. [VERIFIED: codebase grep]

## Code Examples

### Records Reconciliation Guard Call Site
```ts
// Source: src/mcp/tools/records.ts current reconciliation preamble
const reconciliation = await withPluginCoordinationLock(
  config.supabase.databaseUrl,
  {
    fqcInstanceId: config.instance.id,
    pluginId: plugin_id,
    pluginInstance: instanceName,
    purpose: 'records-reconciliation',
  },
  async () => {
    const result = await reconcilePluginDocuments(plugin_id, instanceName, config.supabase.databaseUrl);
    const actionSummary = await executeReconciliationActions(
      result,
      plugin_id,
      instanceName,
      config.instance.id,
      config.supabase.databaseUrl
    );
    return buildReconciliationPayload(actionSummary);
  }
);
```

### Memory Race Test Shape
```ts
// Source: tests/integration/write-memory.integration.test.ts pattern + Test Plan T-I-043
const [a, b] = await Promise.all([
  getHandler('write_memory')({ mode: 'update', memory_id: rootId, content: 'A' }),
  getHandler('write_memory')({ mode: 'update', memory_id: rootId, content: 'B' }),
]);
expect([a, b].filter((r) => !r.isError).length).toBeGreaterThanOrEqual(1);
const { data: latestRows } = await supabaseManager.getClient()
  .from('fqc_memory')
  .select('id, is_latest, chain_root_id')
  .eq('instance_id', TEST_INSTANCE_ID)
  .eq('chain_root_id', rootId)
  .eq('is_latest', true);
expect(latestRows).toHaveLength(1);
```

### Static Lock Test Shape
```ts
// Source: Test Plan T-U-036
const source = await readFile(path.join(projectRoot, 'src/mcp/tools/records.ts'), 'utf8');
expect(source).not.toMatch(/acquireLock\s*\([^)]*['"`](records|memory|plugins)['"`]/);
expect(source).not.toMatch(/releaseLock\s*\([^)]*['"`](records|memory|plugins)['"`]/);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Table-backed `fqc_write_locks` coarse resources for records/memory/plugins | Remove coarse locks; use DB-native guard only where needed | Phase 157 / REQ-023 | Reduces false serialization before table retirement while preserving real critical sections. [CITED: product requirements §6.5.1] |
| Memory coarse lock | `fqc_memory_create_version` RPC with row lock and unique latest-chain index | Already in current schema | No replacement guard needed for memory. [VERIFIED: codebase grep] |
| Unchecked unregister cleanup logs | Checked coordinated unregister | Phase 157 target | Prevents success responses after partial DB cleanup. [VERIFIED: codebase grep] [CITED: product requirements §6.5.1] |

**Deprecated/outdated:**
- `acquireLock(..., 'records'|'memory'|'plugins')`: remove from `src/mcp/tools/records.ts`, `src/mcp/tools/memory.ts`, and `src/mcp/tools/plugins.ts`. [CITED: 157-CONTEXT.md] [VERIFIED: codebase grep]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `hashtextextended(text, 0)::bigint` is acceptable as the advisory key derivation for this phase. [ASSUMED] | Architecture Patterns | Planner may prefer a two-int key or SHA-derived bigint to avoid depending on `hashtextextended` stability. |
| A2 | A per-plugin advisory guard plus checked Supabase cleanup is sufficient for unregister if raw transaction rewrite is too invasive. [ASSUMED] | Summary / Patterns | If strict all-or-nothing DB rollback is required, planner must choose the raw `pg` transaction path. |

## Open Questions

1. **Should unregister use raw `pg` transaction or advisory guard plus checked Supabase calls?**
   - What we know: Supabase JS supports RPC and table APIs; explicit multi-step app transactions are not represented in the current code, while direct `pg` can run `BEGIN`/`COMMIT`. [CITED: Context7 /supabase/supabase] [VERIFIED: codebase grep]
   - What's unclear: Whether the implementation budget should rewrite all unregister DB cleanup into SQL in this phase. [ASSUMED]
   - Recommendation: Plan the advisory guard + checked-error path as the least invasive default; add a planner checkpoint if strict rollback semantics are required. [ASSUMED]

2. **Where should the records concurrency review artifact live?**
   - What we know: CONTEXT allows a new phase artifact or final plan summary if execution can point to it. [CITED: 157-CONTEXT.md]
   - What's unclear: No existing naming convention for this exact review artifact was found in the phase directory. [VERIFIED: codebase grep]
   - Recommendation: Create `.planning/phases/157-records-memory-plugins-audit-guards/157-RECONCILIATION-AUDIT.md` before code edits. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build/test/runtime | yes | v24.7.0 | Project allows any Node >=20. [VERIFIED: local command] |
| npm | Scripts and registry verification | yes | 11.5.1 | none needed. [VERIFIED: local command] |
| Vitest | Unit/integration tests | yes | 4.1.7 | none needed. [VERIFIED: local command] |
| Supabase test env | Integration tests | yes | `.env.test` present; `HAS_SUPABASE` is runtime-derived | Integration tests skip when incomplete. [VERIFIED: codebase grep] |
| `psql` / `pg_isready` CLI | Optional DB probing | not found in PATH during probe | — | Use Node `pg` client in tests. [VERIFIED: local command] |
| slopcheck | Package legitimacy | yes | 0.6.1 | Not needed because no new package install. [VERIFIED: local command] |

**Missing dependencies with no fallback:** none for implementation. [VERIFIED: local command]

**Missing dependencies with fallback:** `psql` / `pg_isready`; use existing Node `pg` and Supabase test helpers. [VERIFIED: local command] [VERIFIED: codebase grep]

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.7. [VERIFIED: npm registry] |
| Config file | `tests/config/vitest.unit.config.ts`; `tests/config/vitest.integration.config.ts`. [VERIFIED: codebase grep] |
| Quick run command | `npm test -- --grep "no-coarse-resource-locks"`. [CITED: 157-CONTEXT.md] |
| Full phase command | `npm run test:integration -- --grep "memory-no-coarse-lock|records-reconciliation|unregister-plugin"`. [CITED: 157-CONTEXT.md] |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-023 / T-U-036 | No `acquireLock` / `releaseLock` calls for coarse `records`, `memory`, or `plugins` remain under `src/`. | unit/static | `npm test -- --grep "no-coarse-resource-locks"` | no; Wave 0 create `tests/unit/no-coarse-resource-locks.test.ts`. [CITED: test plan §4.5.1] [VERIFIED: codebase grep] |
| REQ-023 / T-I-043 | Concurrent `write_memory` updates converge through `fqc_memory_create_version`; only one latest row remains. | integration | `npm run test:integration -- --grep "memory-no-coarse-lock"` | no; Wave 0 create `tests/integration/memory-no-coarse-lock.integration.test.ts`. [CITED: test plan §4.5.1] [VERIFIED: codebase grep] |
| REQ-023 / T-I-044 | Concurrent record writes that trigger reconciliation do not double-apply actions. | integration | `npm run test:integration -- --grep "records-reconciliation"` | no target file; existing `plugin-reconciliation.integration.test.ts` patterns should be reused. [CITED: test plan §4.5.1] [VERIFIED: codebase grep] |
| REQ-023 / T-I-045 | Concurrent `unregister_plugin` calls produce one success plus structured not-found/conflict/error and no partial state. | integration | `npm run test:integration -- --grep "unregister-plugin"` | no; Wave 0 create `tests/integration/unregister-plugin-races.integration.test.ts`. [CITED: test plan §4.5.1] [VERIFIED: codebase grep] |

### Sampling Rate
- **Per task commit:** `npm test -- --grep "no-coarse-resource-locks"` after lock removal. [CITED: 157-CONTEXT.md]
- **Per wave merge:** `npm run test:integration -- --grep "memory-no-coarse-lock|records-reconciliation|unregister-plugin"`. [CITED: 157-CONTEXT.md]
- **Phase gate:** `npm run typecheck`, `npm test -- --grep "no-coarse-resource-locks"`, and required integration grep command. [VERIFIED: codebase grep] [CITED: 157-CONTEXT.md]

### Wave 0 Gaps
- [ ] `tests/unit/no-coarse-resource-locks.test.ts` - covers T-U-036 / REQ-023. [CITED: test plan §4.5.1]
- [ ] `tests/integration/memory-no-coarse-lock.integration.test.ts` - covers T-I-043 / REQ-023. [CITED: test plan §4.5.1]
- [ ] `tests/integration/records-reconciliation.integration.test.ts` - covers T-I-044 / REQ-023; can reuse code from existing `plugin-reconciliation.integration.test.ts`. [CITED: test plan §4.5.1] [VERIFIED: codebase grep]
- [ ] `tests/integration/unregister-plugin-races.integration.test.ts` - covers T-I-045 / REQ-023. [CITED: test plan §4.5.1]
- [ ] `tests/config/vitest.integration.config.ts` include list updates for new integration files. [VERIFIED: codebase grep]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Phase does not alter auth. [VERIFIED: codebase grep] |
| V3 Session Management | no | MCP remains stateless per AGENTS.md. [CITED: AGENTS.md] |
| V4 Access Control | yes | Preserve `instance_id` filters on memory, records, registry, review, and documents cleanup. [VERIFIED: codebase grep] |
| V5 Input Validation | yes | Preserve existing Zod schemas and plugin id/instance validation. [VERIFIED: codebase grep] |
| V6 Cryptography | no | Phase does not introduce crypto. [VERIFIED: codebase grep] |

### Known Threat Patterns for FlashQuery MCP + Postgres

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-instance data mutation during unregister | Tampering | Keep `.eq('instance_id', config.instance.id)` or SQL `WHERE instance_id = $1` on every cleanup query. [VERIFIED: codebase grep] |
| SQL injection in plugin table names | Tampering | Continue using `pg.escapeIdentifier()` for dynamic table names and parameterized values for data. [VERIFIED: codebase grep] |
| Lock denial/hang from leaked session advisory locks | Denial of Service | Acquire/release on the same `withPgClient()` connection in `finally`; prefer short critical sections. [CITED: PostgreSQL advisory lock docs] [VERIFIED: codebase grep] |
| False success after cleanup failure | Repudiation / Tampering | Return runtime error on cleanup failures and test no partial state after T-I-045. [VERIFIED: codebase grep] [CITED: test plan §4.5.1] |

## Sources

### Primary (HIGH confidence)
- `.planning/phases/157-records-memory-plugins-audit-guards/157-CONTEXT.md` - locked scope, guardrails, deferred work. [VERIFIED: codebase grep]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Requirements.md` - REQ-023, Phase 3. [VERIFIED: codebase grep]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Test Plan.md` - T-U-036, T-I-043, T-I-044, T-I-045. [VERIFIED: codebase grep]
- `src/mcp/tools/memory.ts`, `src/mcp/tools/records.ts`, `src/mcp/tools/plugins.ts`, `src/services/plugin-reconciliation.ts`, `src/utils/pg-client.ts`, `src/storage/supabase.ts` - current implementation. [VERIFIED: codebase grep]
- PostgreSQL 18 docs, Explicit Locking / Advisory Locks: https://www.postgresql.org/docs/current/explicit-locking.html [CITED: PostgreSQL docs]
- PostgreSQL 18 docs, Advisory Lock Functions: https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS [CITED: PostgreSQL docs]
- Context7 `/supabase/supabase` docs - Supabase RPC/database function pattern. [CITED: Context7 /supabase/supabase]

### Secondary (MEDIUM confidence)
- Supabase JS GitHub package/release metadata from npm registry lookups for current package versions. [VERIFIED: npm registry]

### Tertiary (LOW confidence)
- None used for implementation recommendations. [VERIFIED: codebase grep]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - versions verified from lockfile, local commands, and npm registry. [VERIFIED: npm registry] [VERIFIED: local command]
- Architecture: HIGH - recommendations are grounded in current code paths and canonical product docs. [VERIFIED: codebase grep] [CITED: product requirements §6.5.1]
- Pitfalls: HIGH - pitfalls are directly visible in source control flow and required tests. [VERIFIED: codebase grep] [CITED: test plan §4.5.1]

**Research date:** 2026-05-26
**Valid until:** 2026-06-02 for fast-moving package/tool versions; code-path findings remain valid until affected files change. [ASSUMED]
