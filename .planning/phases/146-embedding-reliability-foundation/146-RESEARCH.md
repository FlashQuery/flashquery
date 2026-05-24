# Phase 146: Embedding Reliability Foundation - Research

**Researched:** 2026-05-24
**Domain:** TypeScript MCP tools, Supabase/Postgres embedding durability, node-postgres pooling
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
### Source-of-Truth Documents
- Downstream planning and implementation agents MUST read the requirements specification and companion test plan listed in `<canonical_refs>` before making implementation choices.
- If this context and the source docs disagree, the source docs win. If the source docs leave an implementation detail open, follow existing FlashQuery code patterns and AGENTS.md.

### REQ-003: Centralized Durable Embedding Helper
- Replace duplicated background embed idioms in MCP tool code with one helper under `src/embedding/` or a service module.
- The helper must record observable deferred/failure state when foreground writes return before embedding finishes.
- Pending records must include target table, target id, attempt count, last error, and last attempt timestamp.
- Foreground success envelopes must include `warnings: ["embedding_deferred"]` when embedding is pending or failed after the foreground write succeeds.
- The helper must emit a structured error log with a stable event such as `background_embed_failed`.
- Direct `void embeddingProvider` style call sites must not remain under `src/mcp` outside the centralized helper or documented scanner drain logic.

### REQ-004: Pending Embedding Retry And Diagnostics
- Pending embedding retry must use the same target abstraction as the foreground helper and must cover documents, memories, and records.
- The retry path must populate target embeddings and clear or mark pending rows complete when the provider later succeeds.
- Repeated failures must leave pending rows inspectable with last error and attempt count.
- `doctor` or an equivalent diagnostic command must report rows with `embedding IS NULL` that lack pending retry state.
- Any pending embedding schema change must use the repo's migration/schema conventions and have integration coverage.

### REQ-005: Pooled Record Direct SQL
- Record background embedding updates and semantic `search_records` vector SQL must borrow pooled connections rather than constructing one `pg.Client` per call.
- The pool abstraction must live in or extend `src/utils/pg-client.ts`.
- The existing IPv4 behavior in `createPgClientIPv4` must be preserved.
- Release/close errors must be logged or owned by the pool abstraction; empty cleanup swallows must not remain in `records.ts`.
- If the selected pool abstraction requires shutdown cleanup, the phase must add that cleanup path.

### Required Tests
- Unit coverage must include T-U-006 through T-U-012.
- Integration coverage must include T-I-003 through T-I-008.
- Directed scenario T-S-002 / D-69 must be added if public MCP response warning behavior is not otherwise proven.
- Integration scenario T-Y-001 / IS-15 must be added if pooled record vector SQL workflow is not otherwise proven.
- `npm run typecheck` and `npm run lint` must pass.

### the agent's Discretion
- The exact pending-state storage shape is open, including whether to introduce `fqc_pending_embeds` or an equivalent table, as long as REQ-003/REQ-004 acceptance criteria are met.
- The retry worker may be scanner-integrated or implemented as another bounded worker path, as long as it is reachable by existing operational workflows and covered by tests.
- The warning envelope implementation may use existing response-helper patterns, provided the MCP response contract remains `{ content: [{ type: "text", text: "..." }] }`.

### Deferred Ideas (OUT OF SCOPE)
- REQ-006 through REQ-012 are out of scope for this phase except where touched files make tiny incidental cleanup unavoidable.
- Broader performance benchmarking is deferred; this phase adds targeted resource-lifecycle coverage for embedding and direct SQL paths.
- Unselected audit findings remain out of scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-003 | Background embedding uses a centralized durable helper. | Current duplicate call sites are in memory, documents, compound, records, and document-output; replace them with one helper that writes target embeddings or durable pending state and adds `embedding_deferred` warnings. [VERIFIED: product requirements] [VERIFIED: codebase grep] |
| REQ-004 | Pending embeddings are retried and surfaced operationally. | Add `fqc_pending_embeds` or equivalent schema via `buildSchemaDDL`, include it in `verifySchema`, drain/retry through scanner or bounded worker, and add doctor diagnostics for rows with `embedding IS NULL` but no pending row. [VERIFIED: product requirements] [VERIFIED: codebase grep] |
| REQ-005 | Direct `pg` usage for records is pooled. | Extend `src/utils/pg-client.ts` with a `pg.Pool` abstraction, keep the existing IPv4 startup behavior, and update record embedding and semantic search paths. [VERIFIED: product requirements] [VERIFIED: codebase grep] [CITED: github.com/brianc/node-postgres/docs/pages/apis/pool.mdx] |
</phase_requirements>

## Summary

Phase 146 should be planned as a small infrastructure slice plus call-site migration, not as a feature rewrite. The durable embedding helper should own target-specific embedding text, target updates, pending row upsert/update, structured failure logging, and warning propagation; MCP tools should only call that helper and merge returned warnings into existing JSON envelopes. [VERIFIED: product requirements] [VERIFIED: codebase grep]

The recommended pending-state table is `fqc_pending_embeds` with `instance_id`, `target_kind`, `target_table`, `target_id`, `target_label`, `embed_text` or recompute metadata, `attempt_count`, `last_error`, `last_attempt_at`, `next_retry_at`, `status`, `created_at`, and `updated_at`. This shape satisfies the required durable fields and supports documents, memories, and dynamic plugin record tables without adding one queue table per target type. [VERIFIED: product requirements] [ASSUMED]

The record SQL fix should use the already-installed `pg` package's `Pool`, not a new dependency. Node-postgres documents `pool.query` for one-shot queries, `pool.connect()` plus `client.release()` for borrowed clients, `pool.end()` for shutdown, and pool options including `max`, `idleTimeoutMillis`, `connectionTimeoutMillis`, and `allowExitOnIdle`. [CITED: github.com/brianc/node-postgres/docs/pages/features/pooling.mdx] [CITED: github.com/brianc/node-postgres/docs/pages/apis/pool.mdx] [VERIFIED: npm registry]

**Primary recommendation:** Build `src/embedding/background-embed.ts` plus `src/embedding/pending-worker.ts`, add `fqc_pending_embeds` in `src/storage/supabase.ts` and `src/storage/schema-verify.ts`, extend `src/utils/pg-client.ts` with a process-scoped pool and shutdown hook, then migrate call sites in one pass with focused unit/integration tests. [VERIFIED: codebase grep] [ASSUMED]

## Project Constraints (from AGENTS.md)

- Runtime is Node.js >= 20 LTS; package engines enforce this and local environment is Node v24.7.0. [VERIFIED: AGENTS.md] [VERIFIED: environment probe]
- TypeScript strict mode and ESM are required; do not introduce CommonJS `require`. [VERIFIED: AGENTS.md]
- FlashQuery is CLI + MCP only; do not build a web UI or server-side session state. [VERIFIED: AGENTS.md]
- MCP tool responses must remain `{ content: [{ type: "text", text: "..." }] }`; errors add `isError: true`. [VERIFIED: AGENTS.md]
- Use Zod for external input validation. [VERIFIED: AGENTS.md]
- Module-boundary failures should return typed errors rather than leaking thrown exceptions. [VERIFIED: AGENTS.md]
- Integration and E2E tests read `.env.test`; tests needing Supabase should skip gracefully when credentials are incomplete. [VERIFIED: AGENTS.md] [VERIFIED: codebase grep]
- Do not use `npm link`; local development runs through `npm run dev` or `node dist/index.js start --config ./flashquery.yml` after build. [VERIFIED: AGENTS.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Foreground write response warning | API / Backend | MCP response layer | Tool handlers own public success envelopes and should merge helper warnings into `jsonToolResult` payloads. [VERIFIED: codebase grep] |
| Embedding generation and target updates | API / Backend | Database / Storage | The server owns provider calls and Supabase/pg updates; targets persist in `fqc_documents`, `fqc_memory`, and plugin tables. [VERIFIED: codebase grep] |
| Pending embedding durability | Database / Storage | API / Backend | Retry state must survive process restarts, so it belongs in Postgres while worker/helper code mutates it. [VERIFIED: product requirements] |
| Retry/drain worker | API / Backend | Database / Storage | Scanner already acts as an operational synchronization point; a bounded worker can reuse the same target abstraction and clear pending rows. [VERIFIED: codebase grep] |
| Record vector SQL pooling | API / Backend | Database / Storage | `records.ts` currently opens direct clients for embedding update and semantic search; pooling belongs in `src/utils/pg-client.ts`. [VERIFIED: codebase grep] |
| Diagnostics | CLI / Backend | Database / Storage | `src/cli/doctor.ts` already runs DB and embedding checks and can add embedding-gap diagnostics. [VERIFIED: codebase grep] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 6.0.2 installed | Strict ESM implementation. | Existing project language and build contract. [VERIFIED: package.json] |
| Vitest | 4.1.1 installed | Unit and integration tests. | Existing test runner for `npm test` and `npm run test:integration`. [VERIFIED: package.json] |
| `pg` | 8.20.0 installed; 8.21.0 latest as of npm `time.modified` 2026-05-18 | Direct Postgres vector SQL and connection pooling. | Existing dependency; official `Pool` API covers the required pooled borrow/release/close behavior. [VERIFIED: package.json] [VERIFIED: npm registry] [CITED: github.com/brianc/node-postgres/docs/pages/apis/pool.mdx] |
| `@supabase/supabase-js` | 2.100.0 installed; 2.106.1 latest as of npm `time.modified` 2026-05-22 | Standard table CRUD and RPC access. | Existing storage client used by tools and scanner. [VERIFIED: package.json] [VERIFIED: npm registry] |
| Zod | 4.3.6 installed; 4.4.3 latest as of npm `time.modified` 2026-05-04 | MCP input schemas. | Existing MCP tool validation convention. [VERIFIED: package.json] [VERIFIED: npm registry] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@types/pg` | 8.20.0 installed and latest as of npm `time.modified` 2026-03-20 | TypeScript types for `pg`. | Needed for `Pool`, `PoolClient`, and query result typing. [VERIFIED: package.json] [VERIFIED: npm registry] |
| `@modelcontextprotocol/sdk` | 1.27.1 installed; 1.29.0 latest as of npm `time.modified` 2026-03-30 | MCP server/tool response surface. | Do not upgrade in this phase; Phase 147/148 own SDK drift. [VERIFIED: package.json] [VERIFIED: npm registry] [VERIFIED: ROADMAP.md] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `pg.Pool` | New PostgreSQL client such as Postgres.js | Not appropriate; the phase is a resource-lifecycle remediation and `pg` is already installed. [VERIFIED: package.json] [ASSUMED] |
| Scanner-integrated retry | Dedicated background interval worker | Dedicated worker can be more autonomous but needs lifecycle/shutdown ownership; scanner integration aligns with existing operational workflows. [VERIFIED: product requirements] [VERIFIED: codebase grep] [ASSUMED] |
| Store embed text in pending row | Store only target id and recompute every retry | Recompute avoids stale text but is harder for dynamic plugin tables; storing text simplifies retries but may duplicate content. [ASSUMED] |

**Installation:** No new external package installation is recommended for this phase. [VERIFIED: package.json] [VERIFIED: codebase grep]

## Package Legitimacy Audit

No new external packages should be installed for Phase 146. Existing package legitimacy was still checked because the plan relies on `pg`. [VERIFIED: codebase grep]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `pg` | npm | Established package; npm latest modified 2026-05-18 | Not recorded by `npm view` command used | github.com/brianc/node-postgres | OK | Approved existing dependency. [VERIFIED: npm registry] [CITED: github.com/brianc/node-postgres/docs/pages/apis/pool.mdx] |
| `@supabase/supabase-js` | npm | Established package; npm latest modified 2026-05-22 | Not recorded by `npm view` command used | github.com/supabase/supabase-js | OK | Approved existing dependency. [VERIFIED: npm registry] |
| `@modelcontextprotocol/sdk` | npm | Established package; npm latest modified 2026-03-30 | Not recorded by `npm view` command used | github.com/modelcontextprotocol/typescript-sdk | OK | Existing dependency only; do not upgrade here. [VERIFIED: npm registry] |
| `zod` | npm | Established package; npm latest modified 2026-05-04 | Not recorded by `npm view` command used | github.com/colinhacks/zod | OK | Approved existing dependency. [VERIFIED: npm registry] |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: slopcheck]
**Packages flagged as suspicious [SUS]:** none. [VERIFIED: slopcheck]
**Caveat:** `slopcheck 0.6.1` did not support the requested `--json` flag and its `install` subcommand ran `npm install`; package metadata changes were restored before writing this research. [VERIFIED: environment probe] [VERIFIED: git status]

## Architecture Patterns

### System Architecture Diagram

```text
MCP write tools
  ├─ write_memory
  ├─ write_document / copy_document
  ├─ insert_in_doc / replace_doc_section
  ├─ write_record
  └─ get_document stale-hash path
        |
        v
central background embedding helper
  ├─ build target embed text
  ├─ provider.embed(text)
  ├─ update target embedding
  ├─ on failure: upsert fqc_pending_embeds
  └─ return warnings[] to caller
        |
        v
jsonToolResult payload with optional warnings:["embedding_deferred"]

scanner / pending worker / doctor
  ├─ select eligible pending rows
  ├─ retry through same target abstraction
  ├─ clear/complete pending row on success
  ├─ retain attempt_count/last_error on repeated failure
  └─ diagnose embedding-null rows missing pending state

record semantic SQL
  ├─ embeddingProvider.embed(query)
  └─ src/utils/pg-client.ts pool
        ├─ pool.query or borrow/release
        ├─ preserves process IPv4 startup behavior
        └─ shutdown cleanup via pool.end()
```

### Recommended Project Structure

```text
src/
├── embedding/
│   ├── background-embed.ts      # helper, target abstraction, warning result
│   └── pending-worker.ts        # pending row selection and retry loop
├── utils/
│   └── pg-client.ts             # existing createPgClientIPv4 plus pool abstraction
├── storage/
│   ├── supabase.ts              # fqc_pending_embeds DDL and grants
│   └── schema-verify.ts         # required table/column verification
├── services/
│   └── scanner.ts               # drain pending embeddings or invoke worker
└── cli/
    └── doctor.ts                # untracked embedding gap diagnostic
```

### Pattern 1: Helper-Owned Deferred Embedding

**What:** Tool handlers call one helper with `{ target, embedText }`, await only the helper's scheduling/result boundary, and merge returned warnings into existing payloads. [VERIFIED: product requirements] [ASSUMED]

**When to use:** Every foreground write that creates or modifies embeddable content but should not fail the write when embedding fails. [VERIFIED: product requirements]

**Example:**

```ts
// Source: derived from existing jsonToolResult/withWarnings patterns in src/mcp/utils/response-formats.ts.
const embedResult = await scheduleBackgroundEmbedding({
  target: documentTarget({ id: fqcId, instanceId: config.instance.id, path: relativePath }),
  embedText: `${effectiveTitle}\n\n${body}`,
});

return jsonToolResult(withWarnings(
  buildDocumentWriteResult({ mode: 'create', path: relativePath, fq_id: fqcId }),
  embedResult.warnings
));
```

### Pattern 2: Pending Row Upsert on Failure

**What:** On provider or target update failure, upsert by `(instance_id, target_kind, target_table, target_id)` and increment attempt metadata instead of only logging. [VERIFIED: product requirements] [ASSUMED]

**When to use:** Helper failure path and worker retry failure path. [VERIFIED: product requirements]

**Example:**

```ts
// Source: Product requirements §7.2 pending embedding target contract.
await supabase.from('fqc_pending_embeds').upsert({
  instance_id: target.instanceId,
  target_kind: target.kind,
  target_table: target.table,
  target_id: target.id,
  target_label: target.label,
  embed_text: embedText,
  attempt_count: nextAttemptCount,
  last_error: errorMessage,
  last_attempt_at: new Date().toISOString(),
  next_retry_at: nextRetryAt,
  status: 'pending',
}, { onConflict: 'instance_id,target_kind,target_table,target_id' });
```

### Pattern 3: Pooled Record SQL

**What:** `src/utils/pg-client.ts` should expose a process-scoped pool keyed by connection string or a small borrow/query abstraction; record code should no longer call `new pg.Client` per semantic query or background embed. [VERIFIED: product requirements] [VERIFIED: codebase grep]

**When to use:** `write_record` embedding updates and `search_records` semantic vector SQL. [VERIFIED: codebase grep]

**Example:**

```ts
// Source: node-postgres Pool docs via Context7.
const rows = await queryPgPool(
  databaseUrl,
  `SELECT *, 1 - (embedding <=> $1::vector) AS similarity
   FROM ${escapedTable}
   WHERE instance_id = $2 AND status = 'active' AND embedding IS NOT NULL
   ORDER BY embedding <=> $1::vector
   LIMIT $3`,
  [JSON.stringify(queryEmbedding), config.instance.id, maxResults]
);
```

### Anti-Patterns to Avoid

- **Fire-and-forget `void embeddingProvider...catch(logger.warn)` in MCP tools:** It loses durable state and violates REQ-003. [VERIFIED: product requirements] [VERIFIED: codebase grep]
- **One `pg.Client` per record vector operation:** It risks connection churn and bypasses REQ-005 pooled lifecycle ownership. [VERIFIED: product requirements] [VERIFIED: codebase grep]
- **Empty cleanup swallows in record paths:** `client.end().catch(() => {})` hides release/close failures that the pool abstraction must own. [VERIFIED: product requirements] [VERIFIED: codebase grep]
- **Doctor diagnostic via PostgREST-only dynamic table queries:** Dynamic plugin record tables and vector SQL already require direct Postgres in current code; use direct SQL where table-name enumeration or anti-join diagnostics need it. [VERIFIED: codebase grep] [ASSUMED]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PostgreSQL connection pooling | Custom queue of `pg.Client` instances | `pg.Pool` from existing `pg` package | Official pool handles checkout, idle eviction, waiting callers, and `pool.end()`. [CITED: github.com/brianc/node-postgres/docs/pages/apis/pool.mdx] |
| MCP JSON response serialization | Manual string concatenation | Existing `jsonToolResult`, `withWarnings`, and response helper patterns | Existing helpers preserve the MCP response contract. [VERIFIED: codebase grep] |
| Pending retry state in memory only | Process-local arrays/timers only | Durable Postgres table | Requirements demand pending state remain inspectable after failures. [VERIFIED: product requirements] |
| Per-target retry implementations | Separate document/memory/record retry code | Shared target abstraction | Requirements demand foreground helper and retry path use the same target abstraction. [VERIFIED: product requirements] |

**Key insight:** The complex part is not vector generation; it is preserving write success while making asynchronous embedding failures observable, retryable, and diagnosable across heterogeneous targets. [VERIFIED: product requirements] [ASSUMED]

## Common Pitfalls

### Pitfall 1: Helper Returns Too Late

**What goes wrong:** Awaiting provider embedding before returning from writes changes foreground latency and failure behavior. [ASSUMED]
**Why it happens:** "Centralized helper" can be misread as "synchronous embedding helper." [ASSUMED]
**How to avoid:** Keep foreground writes successful after data persistence; helper should schedule/attempt embedding and return warning state without making provider success mandatory. [VERIFIED: product requirements]
**Warning signs:** Tests for T-I-004 fail because write responses return errors instead of successful payloads with `warnings`. [VERIFIED: product test plan]

### Pitfall 2: Pending Rows Cannot Rebuild Record Targets

**What goes wrong:** Worker can retry documents/memories but cannot update dynamic plugin tables because table identity or escaped SQL metadata is missing. [ASSUMED]
**Why it happens:** Documents and memories use fixed tables; plugin records use `fqcp_*` dynamic tables and direct vector casts. [VERIFIED: codebase grep]
**How to avoid:** Persist `target_kind`, `target_table`, `target_id`, `instance_id`, and either `embed_text` or enough metadata to recompute. [VERIFIED: product requirements]
**Warning signs:** T-I-003 creates record pending rows but T-I-005 cannot populate record embeddings. [VERIFIED: product test plan]

### Pitfall 3: Pool Lifecycle Not Shut Down

**What goes wrong:** A process-scoped pool can keep sockets open after shutdown or tests. [CITED: github.com/brianc/node-postgres/docs/pages/apis/pool.mdx]
**Why it happens:** Node-postgres pools keep clients connected until idle timeout unless `allowExitOnIdle` or `pool.end()` is used. [CITED: github.com/brianc/node-postgres/docs/pages/apis/pool.mdx]
**How to avoid:** Add an exported `closePgPools()` and call it from `ShutdownCoordinator` after active work drains; tests should close/reset pools. [CITED: github.com/brianc/node-postgres/docs/pages/apis/pool.mdx] [ASSUMED]
**Warning signs:** Vitest hangs or shutdown logs complete while the process does not exit. [ASSUMED]

### Pitfall 4: Curated Integration Config Omits New Tests

**What goes wrong:** New integration specs exist but `npm run test:integration` does not run them. [VERIFIED: Phase 145 summary] [VERIFIED: codebase grep]
**Why it happens:** `tests/config/vitest.integration.config.ts` has a curated `include` list. [VERIFIED: codebase grep]
**How to avoid:** Add all Phase 146 integration files to that include list. [VERIFIED: codebase grep]
**Warning signs:** Focused command passes but full integration command does not discover new files. [VERIFIED: Phase 145 summary]

## Code Examples

### Pool Borrow/Release

```ts
// Source: Context7 / node-postgres pooling docs.
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 10_000 });
const client = await pool.connect();
try {
  await client.query('SELECT 1');
} finally {
  client.release();
}
await pool.end();
```

### One-Shot Pool Query

```ts
// Source: Context7 / node-postgres pool.query docs.
const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
```

### Existing Warning Merge Pattern

```ts
// Source: src/mcp/utils/response-formats.ts.
return jsonToolResult(withWarnings(payload, warnings));
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| One-off `void embeddingProvider` calls in MCP tools | Central helper with durable pending state | Phase 146 target | Required for REQ-003 and REQ-004. [VERIFIED: product requirements] |
| Scanner only drains document rows with `embedding IS NULL` | Worker drains pending rows across documents, memories, and records | Phase 146 target | Required for retry coverage. [VERIFIED: product requirements] |
| `createPgClientIPv4` returns one `pg.Client` per use | Pool abstraction in `src/utils/pg-client.ts` plus shutdown cleanup | Phase 146 target | Required for REQ-005. [VERIFIED: product requirements] |

**Deprecated/outdated:**
- Direct `void embeddingProvider` idioms under `src/mcp`: replace with helper calls. [VERIFIED: product requirements]
- `records.ts` cleanup swallow `client.end().catch(() => {})`: move release/close handling into pool abstraction with logging. [VERIFIED: product requirements] [VERIFIED: codebase grep]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `fqc_pending_embeds` is the best concrete storage shape. | Summary, Architecture Patterns | Planner may need to choose an equivalent table shape if implementation constraints differ. |
| A2 | Storing `embed_text` is acceptable for retry simplicity. | Standard Stack / Alternatives | If content duplication is unacceptable, worker must recompute text by target type. |
| A3 | Scanner integration is preferable to a new interval worker. | Standard Stack / Alternatives | If operational retry must happen without scans, planner should add a lifecycle-owned worker and shutdown handling. |
| A4 | Direct SQL may be appropriate for doctor gap diagnostics involving dynamic record tables. | Anti-Patterns | Planner may choose a narrower diagnostic limited to fixed tables if record-table enumeration proves too invasive. |

## Open Questions (RESOLVED)

1. **Should pending rows store full embed text or recompute metadata only?**
   - What we know: Product docs require enough target metadata to recompute and allow storing embed text. [VERIFIED: product requirements]
   - What's unclear: Whether duplicated user content in `fqc_pending_embeds` is acceptable for local-first storage policy. [ASSUMED]
   - Recommendation: Store `embed_text` initially for deterministic retries, plus `target_label` for diagnostics; document this in the plan as a user-confirmable design choice. [ASSUMED]
   - RESOLVED: Store `embed_text` in `fqc_pending_embeds` for Phase 146 so retry behavior is deterministic across documents, memories, and dynamic record tables. Do not log raw `embed_text`; keep diagnostics to target metadata, attempt counts, and error summaries.

2. **Should successful retries delete pending rows or mark them complete?**
   - What we know: Requirements allow either clear or mark complete. [VERIFIED: product requirements]
   - What's unclear: Whether operators need historical success records. [ASSUMED]
   - Recommendation: Delete on success to keep diagnostics simple; retain only failed/pending rows. [ASSUMED]
   - RESOLVED: Delete pending rows on successful retry. Retain only pending/failed rows so doctor diagnostics answer "what still needs attention" without historical-success noise.

3. **Should the pool be singleton per database URL or one global pool?**
   - What we know: Config has one `config.supabase.databaseUrl` at runtime, but tests may create multiple configs in one process. [VERIFIED: codebase grep]
   - What's unclear: Whether future multi-instance in-process use will require multiple DB URLs. [ASSUMED]
   - Recommendation: Implement a map keyed by connection string and expose `closePgPools()` for test/shutdown cleanup. [ASSUMED]
   - RESOLVED: Implement pools as a map keyed by database URL, with `closePgPools()` closing all pools for shutdown and test cleanup. This preserves current single-config runtime behavior while avoiding cross-test and future multi-config coupling.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build/test/runtime | yes | v24.7.0 | Project minimum is Node >=20. [VERIFIED: environment probe] [VERIFIED: AGENTS.md] |
| npm | Package scripts | yes | 11.5.1 | none needed. [VERIFIED: environment probe] |
| `.env.test` | Integration tests | yes | file present | Tests still must skip if values are incomplete. [VERIFIED: environment probe] [VERIFIED: AGENTS.md] |
| slopcheck | Package legitimacy audit | yes | 0.6.1 | CLI lacks `--json`; text output used. [VERIFIED: environment probe] |
| psql CLI | Manual DB inspection | no | none | Use Node `pg` test helpers and Supabase client. [VERIFIED: environment probe] |
| Supabase CLI | Local Supabase management | no | none | Existing tests use `.env.test` Supabase connection, not Supabase CLI. [VERIFIED: environment probe] [VERIFIED: codebase grep] |

**Missing dependencies with no fallback:** none for planning. [VERIFIED: environment probe]

**Missing dependencies with fallback:** `psql` and Supabase CLI are absent; use existing Node/Supabase helpers. [VERIFIED: environment probe] [VERIFIED: codebase grep]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 for unit/integration; Python/YAML scenario frameworks for directed and integration scenarios. [VERIFIED: package.json] [VERIFIED: codebase grep] |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`. [VERIFIED: codebase grep] |
| Quick run command | `npm test -- tests/unit/background-embed-helper.test.ts tests/unit/pending-embed-worker.test.ts tests/unit/pg-client-pool.test.ts` [VERIFIED: package.json] [ASSUMED] |
| Full suite command | `npm run typecheck && npm run lint && npm run test:integration` [VERIFIED: package.json] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REQ-003 | Helper updates target embedding and writes pending state/warnings on failure. | unit | `npm test -- tests/unit/background-embed-helper.test.ts` | no - Wave 0 |
| REQ-003 | Document/memory/record forced provider failure creates pending rows and success warnings. | integration | `npm run test:integration -- tests/integration/embedding/background-embed-doc-memory-record.test.ts` | no - Wave 0 |
| REQ-003 | Public MCP response surfaces `embedding_deferred`. | directed scenario | `python3 tests/scenarios/directed/testcases/test_background_embed_failure_warning.py --managed` | no - conditional Wave 0 |
| REQ-004 | Pending worker selects eligible rows and retries/retains failures. | unit | `npm test -- tests/unit/pending-embed-worker.test.ts` | no - Wave 0 |
| REQ-004 | Retry succeeds and doctor reports untracked embedding gaps. | integration | `npm run test:integration -- tests/integration/embedding/pending-embed-worker.test.ts tests/integration/doctor/embedding-diagnostics.test.ts` | no - Wave 0 |
| REQ-005 | Pool preserves IPv4 behavior and owns release/close errors. | unit | `npm test -- tests/unit/pg-client-pool.test.ts` | no - Wave 0 |
| REQ-005 | Concurrent record writes and semantic search use pooled SQL. | integration | `npm run test:integration -- tests/integration/mcp/tools/records-pg-pool.test.ts` | no - Wave 0 |
| REQ-005 | Pooled record workflow remains stable through YAML scenario. | integration scenario | `python3 tests/scenarios/integration/run_integration.py record_embed_pool_concurrency --managed` | no - conditional Wave 0 |

### Sampling Rate

- **Per task commit:** Focused unit file for touched module plus `npm run typecheck`. [ASSUMED]
- **Per wave merge:** Focused integration command for Phase 146 files plus `npm run lint`. [ASSUMED]
- **Phase gate:** `npm run typecheck`, `npm run lint`, focused unit/integration/scenario coverage, and grep for forbidden direct embed idioms. [VERIFIED: product requirements]

### Wave 0 Gaps

- [ ] `tests/unit/background-embed-helper.test.ts` - covers T-U-006, T-U-007, T-U-008. [VERIFIED: product test plan]
- [ ] `tests/unit/pending-embed-worker.test.ts` - covers T-U-009, T-U-010. [VERIFIED: product test plan]
- [ ] `tests/unit/pg-client-pool.test.ts` - covers T-U-011, T-U-012. [VERIFIED: product test plan]
- [ ] `tests/integration/embedding/background-embed-doc-memory-record.test.ts` - covers T-I-003, T-I-004. [VERIFIED: product test plan]
- [ ] `tests/integration/embedding/pending-embed-worker.test.ts` - covers T-I-005. [VERIFIED: product test plan]
- [ ] `tests/integration/doctor/embedding-diagnostics.test.ts` - covers T-I-006. [VERIFIED: product test plan]
- [ ] `tests/integration/mcp/tools/records-pg-pool.test.ts` - covers T-I-007, T-I-008. [VERIFIED: product test plan]
- [ ] Update `tests/config/vitest.integration.config.ts` include list for all new integration files. [VERIFIED: codebase grep]
- [ ] Add D-69 directed scenario only if unit/integration public-handler coverage does not prove the warning. [VERIFIED: product test plan]
- [ ] Add IS-15 YAML scenario only if integration coverage does not prove pooled workflow. [VERIFIED: product test plan]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Existing MCP auth/session behavior is not in scope. [VERIFIED: product requirements] |
| V3 Session Management | no | MCP remains stateless; do not add server-side session state. [VERIFIED: AGENTS.md] |
| V4 Access Control | yes | Preserve existing `instance_id`, plugin table resolution, and status filters on all target updates/retries. [VERIFIED: codebase grep] |
| V5 Input Validation | yes | Use Zod/existing validators for MCP params; use parameterized SQL for values and `pg.escapeIdentifier` for dynamic table/column identifiers. [VERIFIED: AGENTS.md] [VERIFIED: codebase grep] |
| V6 Cryptography | no | No new crypto; embeddings and pending state are storage/resource lifecycle work. [VERIFIED: product requirements] |

### Known Threat Patterns for TypeScript + Postgres Dynamic SQL

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Dynamic plugin table SQL injection | Tampering | Keep `resolveTableName` prefix validation and `pg.escapeIdentifier` for table/column identifiers; parameterize values. [VERIFIED: codebase grep] |
| Cross-instance embedding update | Elevation of privilege | Include `instance_id` in pending row selection and target updates where target tables support it. [VERIFIED: codebase grep] [ASSUMED] |
| Silent provider failure | Repudiation | Structured `background_embed_failed` logs plus durable pending rows. [VERIFIED: product requirements] |
| Connection leak | Denial of service | `pg.Pool` release in `finally`, pool-level error handling, and shutdown `pool.end()`. [CITED: github.com/brianc/node-postgres/docs/pages/features/pooling.mdx] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/146-embedding-reliability-foundation/146-CONTEXT.md` - locked decisions, discretion, deferred ideas, canonical refs. [VERIFIED: file read]
- Codebase Audit Priority Remediation Requirements - REQ-003, REQ-004, REQ-005, §5.1 source call sites, §7.2 pending target contract, §8.4 phase scope. [VERIFIED: file read]
- Codebase Audit Priority Remediation Test Plan - T-U-006..012, T-I-003..008, D-69, IS-15. [VERIFIED: file read]
- `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, Phase 145 summary. [VERIFIED: file read]
- `AGENTS.md` - project stack, testing, response contract, and forbidden patterns. [VERIFIED: file read]
- Context7 `/brianc/node-postgres` - pool API, borrow/release, `pool.query`, `pool.end`, config options. [CITED: github.com/brianc/node-postgres/docs/pages/apis/pool.mdx]
- Local code grep/read: `src/mcp/tools/memory.ts`, `src/mcp/tools/documents.ts`, `src/mcp/tools/compound.ts`, `src/mcp/tools/records.ts`, `src/mcp/utils/document-output.ts`, `src/services/scanner.ts`, `src/utils/pg-client.ts`, `src/storage/supabase.ts`, `src/storage/schema-verify.ts`, `src/cli/doctor.ts`, `tests/config/vitest.integration.config.ts`. [VERIFIED: codebase grep]

### Secondary (MEDIUM confidence)

- npm registry via `npm view` for `pg`, `@supabase/supabase-js`, `@modelcontextprotocol/sdk`, `zod`, and `@types/pg` versions/repositories/modified dates. [VERIFIED: npm registry]
- `slopcheck 0.6.1` text output for existing package legitimacy. [VERIFIED: slopcheck]

### Tertiary (LOW confidence)

- Assumed design choices around storing `embed_text`, deleting successful pending rows, and keying pools by connection string. [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - phase uses existing project dependencies and official node-postgres docs. [VERIFIED: package.json] [CITED: github.com/brianc/node-postgres/docs/pages/apis/pool.mdx]
- Architecture: HIGH - target call sites and schema/test patterns were verified in the codebase and canonical requirements. [VERIFIED: codebase grep] [VERIFIED: product requirements]
- Pitfalls: MEDIUM - direct failures are documented by audit requirements; some implementation-risk details are reasoned assumptions. [VERIFIED: product requirements] [ASSUMED]

**Research date:** 2026-05-24
**Valid until:** 2026-06-23 for codebase-specific findings; npm latest-version notes should be refreshed after 7 days. [ASSUMED]
