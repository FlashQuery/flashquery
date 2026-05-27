# Phase 163: Multi-file Batch Contract - Research

**Researched:** 2026-05-27
**Domain:** FlashQuery MCP document/compound tool batch contracts
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Source-of-truth documents
- Downstream agents MUST read the requirements document and test plan listed in `<canonical_refs>` before answering questions, planning, implementing, reviewing, or verifying this phase.
- If the repository planning docs and the external feature docs appear to conflict, downstream agents MUST prefer the external Vault Write Coherency requirements and test plan for this phase, then flag the discrepancy.

### REQ-018 - Best-effort per-item result envelope
- Batch-capable tools must return one ordered result entry for every input item, in input order.
- Each result entry must be one of `succeeded`, `conflicted`, or `failed`.
- `succeeded` entries carry the per-tool success data and the new `version_token` when the file still exists.
- `conflicted` entries carry the new `version_token`, the same targeted recovery payload as the corresponding single-file version-conflict response, and `details.reason: "version_mismatch"`.
- `failed` entries carry a non-conflict error envelope such as `not_found`.
- Batch execution is not transactional. Surviving successful writes must persist even when another item fails or conflicts.
- An item briefly waiting on a lock is absorbed as latency and must not appear as a pending response state.

### REQ-019 - Mixed batch input shape
- Every batch-capable identifier parameter that accepted `string | string[]` must also accept `Array<string | { identifier: string, version_token: string }>`.
- Bare string elements must preserve current behavior: no token and no version check.
- Object elements must carry `version_token` into the per-item write path.
- Mixed arrays containing both bare strings and object elements must be valid in one call.
- Parallel positional token arrays such as `version_tokens?: string[]` must be rejected.
- Identifier-to-token maps must not be introduced.

### Batch-capable tools in scope
- `remove_document.identifiers` in `src/mcp/tools/documents/remove.ts`.
- `archive_document.identifiers` in `src/mcp/tools/documents/archive.ts`.
- `insert_doc_link` source identifiers in `src/mcp/tools/compound.ts`.
- `apply_tags` targets in `src/mcp/tools/compound.ts`.
- Any shared helper introduced for batch input normalization or per-item result construction must preserve the existing single-file string and string-array call paths.

### Test obligations
- Unit tests must cover `T-U-026` and `T-U-027` in `tests/unit/batch-input-shape.test.ts`.
- Integration tests must cover `T-I-034` through `T-I-038` in `tests/integration/batch-envelope.integration.test.ts` and `tests/integration/batch-input-shape.integration.test.ts`.
- Integration scenarios must cover `T-Y-002` and `T-Y-003` as `INT-WCO-02` and `INT-WCO-03`.
- Required execution evidence includes `npm test -- tests/unit/batch-input-shape.test.ts` and `npm run test:integration -- tests/integration/batch-envelope.integration.test.ts tests/integration/batch-input-shape.integration.test.ts`.
- When the integration scenarios land, execution evidence must include `INT-WCO-02` and `INT-WCO-03`.

### the agent's Discretion
- Agents may decide whether to implement one shared normalization/result helper or local helper functions per tool, but any abstraction must reduce duplication and match existing document-tool patterns.
- Agents may decide whether scenario coverage lands in the same implementation wave as integration tests or a later wave, provided `T-Y-002` and `T-Y-003` remain explicit plan obligations.

### Deferred Ideas (OUT OF SCOPE)
- Atomic multi-file batch mode remains deferred. This phase must not add an all-or-nothing batch option.
- Macro-engine automatic version-token threading remains deferred.
- `call_macro` atomic execution remains deferred.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-018 | Best-effort multi-file batch with ordered per-item result envelope. | External spec §6.3.1 defines ordered `succeeded` / `conflicted` / `failed` entries, no transaction rollback, no pending state, and per-tool conflict-region expectations. [CITED: Vault Write Coherency Locking Requirements.md §6.3.1] |
| REQ-019 | Mixed batch input shape `Array<string | { identifier, version_token }>` with backwards compatibility. | External spec §6.3.2 defines the widened input shape, bare-string compatibility, per-item token threading, and rejection of positional token arrays and maps. [CITED: Vault Write Coherency Locking Requirements.md §6.3.2] |
</phase_requirements>

## Summary

Phase 163 should be planned as an additive MCP contract change over the existing Phase 162 version-token implementation, not as new locking or atomic-batch work. The source-of-truth requirements say batch tools process each item independently under the established per-file write path and return one ordered entry per input item. [CITED: Vault Write Coherency Locking Requirements.md §6.3.1]

The current implementation already has the right write foundation: Phase 162 added `computeVersionToken`, `pickExpectedVersion`, and `buildVersionMismatchEnvelope`; archive/remove/link/tag handlers already compare fresh in-lock bytes and build version mismatch payloads. [VERIFIED: codebase grep] The main gap is that `archive_document`, `remove_document`, and `insert_doc_link` still accept only `string | string[]`, and their handlers derive one top-level `expectedVersion` for all items. [VERIFIED: src/mcp/tools/documents/archive.ts:35] [VERIFIED: src/mcp/tools/documents/remove.ts:39] [VERIFIED: src/mcp/tools/compound.ts:260]

**Primary recommendation:** create one small shared batch-normalization/result helper, migrate the four scoped tool surfaces to per-item tokens, and keep each tool's existing single-item conflict/success payload as the source for the batch item body. [VERIFIED: codebase grep]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| MCP input schema widening | API / Backend | — | Tool schemas are registered in server-side TypeScript handlers via Zod. [VERIFIED: codebase grep] |
| Per-item version-token threading | API / Backend | Database / Storage | Tokens are validated inside document locks against fresh vault bytes; DB `content_hash` is synchronized after writes. [VERIFIED: .planning/phases/162-version-fingerprint-check/162-VERIFICATION.md] |
| Ordered batch result envelope | API / Backend | — | MCP handlers build JSON response bodies with `jsonToolResult` and existing document response helpers. [VERIFIED: src/mcp/utils/response-formats.ts:221] |
| Vault writes and persistence | Database / Storage | API / Backend | Existing handlers call `vaultManager.writeMarkdown` / remove / trash under locks and then update Supabase rows. [VERIFIED: codebase grep] |
| Scenario evidence | Test Framework | API / Backend | YAML integration scenarios run through managed FlashQuery and map to `INTEGRATION_COVERAGE.md`. [VERIFIED: tests/scenarios/integration/README.md] |

## Project Constraints (from AGENTS.md)

- Runtime is Node.js >= 20 LTS, TypeScript strict mode, ESM only. [VERIFIED: AGENTS.md]
- Use `@modelcontextprotocol/sdk`, not `@modelcontextprotocol/server`. [VERIFIED: AGENTS.md]
- Use Zod for all external input validation. [VERIFIED: AGENTS.md]
- MCP tool handlers must catch failures internally and return `{ content: [{ type: "text", text: "..." }] }`; expected errors should be structured JSON and not runtime `isError`. [VERIFIED: AGENTS.md] [VERIFIED: src/mcp/utils/response-formats.ts:221]
- Unit tests live under `tests/unit/*.test.ts`; integration tests require Supabase and `.env.test`; scenario tests live under `tests/scenarios/`. [VERIFIED: AGENTS.md]
- Do not build a web UI; FlashQuery is CLI + MCP only. [VERIFIED: AGENTS.md]
- Do not implement server-side session state; MCP is stateless and project context is per call. [VERIFIED: AGENTS.md]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript / ESM | `typescript` ^6.0.2 locally | Compile strict TypeScript handlers. | Existing project standard. [VERIFIED: package.json] |
| Zod | 4.4.3 latest on npm; local `^4.4.3` | Tool input schemas for mixed batch item shapes. | Existing validation layer; Zod supports unions, arrays, and strict objects. [VERIFIED: npm registry] [CITED: https://zod.dev/api] |
| `@modelcontextprotocol/sdk` | 1.29.0 latest on npm; local `^1.29.0` | MCP tool registration and handler result type. | Existing MCP SDK standard. [VERIFIED: npm registry] [VERIFIED: package.json] |
| Vitest | local `^4.1.1`; latest npm checked as 4.1.7 | Unit and integration tests. | Existing project test runner. [VERIFIED: package.json] [VERIFIED: npm registry] |

### Supporting

| Library / Helper | Version | Purpose | When to Use |
|------------------|---------|---------|-------------|
| `src/mcp/utils/document-version.ts` | internal | `computeVersionToken`, `pickExpectedVersion`, `buildVersionMismatchEnvelope`. | Reuse for per-item conflict checks and conflict bodies. [VERIFIED: src/mcp/utils/document-version.ts:16] |
| `src/mcp/utils/response-formats.ts` | internal | JSON tool response helpers and document identification payloads. | Reuse or extend for `BatchItemResult`; do not invent text formatting. [VERIFIED: src/mcp/utils/response-formats.ts:235] |
| `tests/integration/vault-write-coherency-phase155-helpers.ts` | internal | Integration harness registering document and compound handlers. | Use for `batch-envelope` / `batch-input-shape` integration tests. [VERIFIED: tests/integration/vault-write-coherency-phase155-helpers.ts] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Shared normalization helper | Four local normalizers | Local helpers avoid abstraction churn but increase schema/token drift risk across four tools. [ASSUMED] |
| Ordered sequential loop | Parallel per-item execution with index restore | Spec permits either, but sequential loop already preserves input order and simplifies best-effort semantics. [CITED: Vault Write Coherency Locking Requirements.md §6.3.1] |
| `z.object` for item objects | `z.strictObject` for item objects | Zod strips unknown keys from `z.object` by default; `z.strictObject` rejects unknown fields such as accidental `version_tokens`. Use strict object when the plan needs explicit rejection at item level. [CITED: https://zod.dev/api] |

**Installation:** No new external packages are needed. [VERIFIED: package.json]

## Package Legitimacy Audit

This phase should not install new packages. [VERIFIED: package.json] Existing stack probes:

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `zod` | npm | existing dependency | not checked | official docs verified via Context7 | OK | Existing dependency approved; no new install. [VERIFIED: npm registry] |
| `@modelcontextprotocol/sdk` | npm | existing dependency | not checked | existing project dependency | OK | Existing dependency approved; no new install. [VERIFIED: npm registry] |
| `vitest` | npm | existing dev dependency | not checked | existing project dependency | SUS by slopcheck typosquat heuristic | Existing dev dependency only; do not add human gate unless package install changes. [VERIFIED: package.json] |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** `vitest` was flagged by slopcheck as close to `vite`; it is already in the project and not newly recommended. [VERIFIED: slopcheck]

## Architecture Patterns

### System Architecture Diagram

```text
MCP caller
  |
  v
Tool schema validation (Zod)
  |
  v
Normalize batch identifiers
  |-- bare string ------------------> { identifier, version_token: undefined }
  |-- object { identifier, token } --> { identifier, version_token }
  |
  v
For each item, keep original index
  |
  v
Resolve document -> acquire ancestor + document lock -> read fresh bytes
  |
  +-- token mismatch --> conflicted item with version_mismatch recovery payload
  |
  +-- non-conflict error --> failed item with existing error envelope
  |
  +-- write succeeds --> succeeded item with existing per-tool payload and token when file remains
  |
  v
Return ordered JSON array / result object in original input order
```

### Recommended Project Structure

```text
src/
├── mcp/
│   ├── tools/
│   │   ├── documents/archive.ts   # archive batch schema + per-item result use
│   │   ├── documents/remove.ts    # remove batch schema + per-item result use
│   │   └── compound.ts            # insert_doc_link and apply_tags batch input updates
│   └── utils/
│       ├── document-version.ts    # existing conflict helper reuse
│       └── response-formats.ts    # likely home for BatchItemResult helper/types
tests/
├── unit/batch-input-shape.test.ts
├── integration/batch-envelope.integration.test.ts
├── integration/batch-input-shape.integration.test.ts
└── scenarios/integration/tests/
    ├── batch_envelope_per_item.yml
    └── batch_mixed_input.yml
```

### Pattern 1: Batch Item Normalization

**What:** Normalize each document batch item to `{ identifier: string, version_token?: string }`, preserving bare string calls. [CITED: Vault Write Coherency Locking Requirements.md §6.3.2]

**When to use:** Use for `archive_document.identifiers`, `remove_document.identifiers`, `insert_doc_link.identifiers`, and document-target inputs in `apply_tags`. [VERIFIED: codebase grep]

**Example:**

```typescript
const batchIdentifierItemSchema = z.union([
  z.string(),
  z.strictObject({
    identifier: z.string(),
    version_token: z.string(),
  }),
]);

const batchIdentifiersSchema = z.union([
  z.string(),
  z.array(batchIdentifierItemSchema),
]);
```

Source: Context7 Zod docs for `z.union`, `z.array`, and `z.strictObject`. [CITED: https://zod.dev/api]

### Pattern 2: Per-Item Token Check Inside Existing Lock

**What:** Compare each item's token after lock acquisition and fresh `readFile`, using existing `buildVersionMismatchEnvelope`. [VERIFIED: src/mcp/tools/documents/archive.ts:81] [VERIFIED: src/mcp/utils/document-version.ts:24]

**When to use:** Every tokened document item before writing. Bare strings skip the check. [CITED: Vault Write Coherency Locking Requirements.md §6.3.2]

**Example:**

```typescript
const raw = await readFile(resolved.absPath, 'utf-8');
if (item.version_token && item.version_token !== computeVersionToken(raw)) {
  results[index] = {
    status: 'conflicted',
    ...buildVersionMismatchEnvelope({
      identifier: item.identifier,
      versionToken: computeVersionToken(raw),
      targetedRegion: frontmatterTargetedRegion(raw),
    }),
  };
  return;
}
```

### Pattern 3: Preserve Current Single-Item Surface

**What:** Existing single-string calls should keep returning a single success or expected error rather than a batch array. [VERIFIED: src/mcp/tools/documents/archive.ts:63] [VERIFIED: src/mcp/tools/documents/remove.ts:60]

**When to use:** Only array input should use the new ordered per-item batch envelope. [ASSUMED]

### Anti-Patterns to Avoid

- **Parallel positional `version_tokens`:** explicitly rejected because it is off-by-one fragile. [CITED: Vault Write Coherency Locking Requirements.md §6.3.2]
- **Identifier-to-token maps:** explicitly rejected because repeated or path-like identifiers break association. [CITED: Vault Write Coherency Locking Requirements.md §6.3.2]
- **Global batch `expected_version` for array items:** current handlers do this, but Phase 163 requires per-item object tokens. [VERIFIED: src/mcp/tools/documents/archive.ts:66]
- **Atomic all-or-nothing batch mode:** out of scope for Phase 163. [CITED: Vault Write Coherency Locking Requirements.md §3.3]
- **Pending response status for lock wait:** brief lock waits are latency, not caller-visible pending states. [CITED: Vault Write Coherency Locking Requirements.md §6.3.1]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Input validation | Custom `typeof` parser as public schema | Zod unions / arrays / strict objects | Project standard requires Zod for external input validation. [VERIFIED: AGENTS.md] |
| Version conflict envelope | New conflict object shape | `buildVersionMismatchEnvelope` plus a `status: "conflicted"` wrapper | Phase 162 established current token + targeted-region contract. [VERIFIED: src/mcp/utils/document-version.ts:24] |
| Success payloads | Separate batch-only success bodies | Existing `documentArchiveResult`, `documentRemovalResult`, `documentIdentification` payloads | Avoid drift in version token, ID, size, and archive fields. [VERIFIED: src/mcp/utils/response-formats.ts:239] |
| Integration harness | New test server bootstrap | `createPhase155Harness` / `createPhase155Handlers` | Existing tests register document and compound handlers against real Supabase/vault. [VERIFIED: tests/integration/vault-write-coherency-phase155-helpers.ts] |

**Key insight:** The hard part is contract preservation, not concurrency. Existing per-file lock and version-token primitives already exist; planning should focus on exact input normalization, result wrapping, and compatibility tests. [VERIFIED: .planning/phases/162-version-fingerprint-check/162-VERIFICATION.md]

## Common Pitfalls

### Pitfall 1: One Top-Level Token Applied To Every Batch Item

**What goes wrong:** A mixed array cannot express one matched token, one stale token, and one bare untokened item. [CITED: Vault Write Coherency Locking Test Plan.md §4.3.2]
**Why it happens:** Current `archive_document`, `remove_document`, and `insert_doc_link` compute one `expectedVersion` before iterating. [VERIFIED: src/mcp/tools/documents/archive.ts:66] [VERIFIED: src/mcp/tools/compound.ts:323]
**How to avoid:** Normalize per item and compute `expectedVersion = item.version_token ?? topLevelExpectedVersionOnlyForLegacySingleForm`. [ASSUMED]
**Warning signs:** Tests pass for single token but fail `T-I-038` mixed bare/object input. [CITED: Vault Write Coherency Locking Test Plan.md §4.3.2]

### Pitfall 2: Forgetting `apply_tags.targets`

**What goes wrong:** Legacy `identifiers` accepts mixed items but explicit `targets` cannot carry per-item object form or document target tokens consistently. [VERIFIED: src/mcp/tools/compound.ts:426]
**Why it happens:** `apply_tags` has two document entry surfaces: `targets[]` and legacy `identifiers`. [VERIFIED: src/mcp/tools/compound.ts:473]
**How to avoid:** Plan a specific task for both legacy `identifiers` and document entries in `targets`; memory targets must remain unchanged. [VERIFIED: src/mcp/tool-help/apply_tags.tool.md]
**Warning signs:** Unit schema test only scans `identifiers` and misses `targets`.

### Pitfall 3: Batch Result Shape Drift Across Tools

**What goes wrong:** Some tools return `{ results: [...] }`, others return raw arrays, and callers cannot reliably parse status. Current `remove_document` batch wraps results with warnings, while `archive_document` returns an array. [VERIFIED: src/mcp/tools/documents/remove.ts:63] [VERIFIED: src/mcp/tools/documents/archive.ts:61]
**Why it happens:** Existing batch responses predate REQ-018's unified item status envelope. [ASSUMED]
**How to avoid:** Define one batch item wrapper and intentionally preserve any outer wrapper only where existing warnings require it. [ASSUMED]
**Warning signs:** `T-I-034` must special-case every tool's result array location.

### Pitfall 4: Conflicted vs Failed Classification

**What goes wrong:** Version mismatches get returned as `failed` or non-conflict errors. [CITED: Vault Write Coherency Locking Requirements.md §6.3.1]
**Why it happens:** Existing `buildVersionMismatchEnvelope` emits `error: "conflict"` but has no `status` field. [VERIFIED: src/mcp/utils/document-version.ts:27]
**How to avoid:** Wrap version mismatch envelopes with `status: "conflicted"` and non-conflict envelopes with `status: "failed"`. [CITED: Vault Write Coherency Locking Requirements.md §7.3]
**Warning signs:** Batch item has `error: "conflict"` but no `status`.

### Pitfall 5: Scenario Test Overreach

**What goes wrong:** YAML integration scenarios assert details the runner cannot parse, or run against a non-throwaway database. [VERIFIED: tests/scenarios/integration/README.md]
**Why it happens:** The scenario runner's assertion vocabulary is substring/count oriented. [VERIFIED: tests/scenarios/integration/README.md]
**How to avoid:** Read `tests/scenarios/integration/README.md` first and use direct tool calls plus `expect_contains` for JSON substrings where necessary. [VERIFIED: .agents/skills/flashquery-integration-testgen/SKILL.md]
**Warning signs:** Scenario fails because the assertion DSL cannot express array-index checks. [ASSUMED]

## Code Examples

### Reuse Phase 162 Conflict Helper

```typescript
buildVersionMismatchEnvelope({
  identifier: item.identifier,
  versionToken: currentVersionToken,
  targetedRegion: frontmatterTargetedRegion(raw),
});
```

Source: `buildVersionMismatchEnvelope` emits `error: "conflict"`, `details.reason: "version_mismatch"`, `version_token`, and `targeted_region`. [VERIFIED: src/mcp/utils/document-version.ts:24]

### Existing Archive Success Payload To Wrap

```typescript
results.push(documentArchiveResult({
  identifier: id,
  title,
  path: relativePath,
  fq_id: fqcId,
  modified: archivedStats.mtime.toISOString(),
  chars: parsed.content.length,
  archived_at: archivedAt,
  version_token: archivedContentHash,
}));
```

Source: current `archive_document` success includes post-archive `version_token`. [VERIFIED: src/mcp/tools/documents/archive.ts:201]

### Existing Removal Success Omits Token

```typescript
const result = {
  ...documentArchiveResult(input),
  moved_to: input.moved_to,
};
delete result.version_token;
```

Source: removal success intentionally omits `version_token` because the file no longer exists. [VERIFIED: src/mcp/utils/response-formats.ts:270]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Global `expected_version` / `if_match` on batch tools | Per-item `{ identifier, version_token }` object mixed with bare strings | Phase 163 target | Enables mixed succeeded / conflicted / failed arrays without positional token bugs. [CITED: Vault Write Coherency Locking Requirements.md §6.3.2] |
| Batch array with raw successes/errors | Per-item `status` set to `succeeded`, `conflicted`, or `failed` | Phase 163 target | Callers can branch consistently per item in input order. [CITED: Vault Write Coherency Locking Requirements.md §7.3] |
| Atomic or ordered batch assumptions | Best-effort independent items, no transaction, no ordering guarantee beyond response order | Source spec | Planner must not add all-or-nothing lock acquisition. [CITED: Vault Write Coherency Locking Requirements.md §6.3.1] |

**Deprecated/outdated:**
- Positional `version_tokens?: string[]` is explicitly rejected. [CITED: Vault Write Coherency Locking Requirements.md §6.3.2]
- Identifier-token maps are explicitly rejected. [CITED: Vault Write Coherency Locking Requirements.md §6.3.2]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A shared helper is preferable if it stays small and reduces duplicate schema/result wrapping. | Summary / Alternatives | Planner may over-abstract or under-test per-tool edge cases. |
| A2 | Single-string calls should keep existing single-result response shape rather than adopting a batch wrapper. | Architecture Patterns | Backward compatibility may be interpreted differently by maintainers. |
| A3 | Existing outer wrappers such as `remove_document` warnings should be preserved where needed. | Common Pitfalls | Callers may see a breaking response envelope if the outer shape changes unexpectedly. |
| A4 | YAML scenario assertions may need substring checks for JSON array details. | Common Pitfalls | Scenario plan may be too shallow or may require runner enhancement. |

## Open Questions (RESOLVED)

1. **Should array input return a raw array or `{ results }` for every tool?**
   - What we know: REQ-018 requires an ordered array of N result entries; existing tools differ in outer shape. [CITED: Vault Write Coherency Locking Requirements.md §6.3.1] [VERIFIED: codebase grep]
   - Resolution: Array input returns a raw ordered per-item array for Phase 163 batch-capable document tools. Single-string input preserves existing single-item behavior. This follows the external requirements and Test Plan `T-I-034`; legacy string-array callers continue to be accepted, but their array-call response shape follows the new REQ-018 batch contract.

2. **How should `apply_tags.targets` support object item shape?**
   - What we know: `apply_tags` already supports explicit `targets[]` with per-target `expected_version` / `if_match` for documents. [VERIFIED: src/mcp/tools/compound.ts:426]
   - Resolution: Widen legacy `identifiers` to accept `Array<string | { identifier, version_token }>` and allow explicit document targets to carry `version_token` as a per-target alias for `expected_version`. Do not introduce nested `{ entity_type, identifier: { identifier, version_token } }`; memory targets remain unchanged.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | build, unit, integration | yes | v24.7.0 | Node >=20 required. [VERIFIED: command output] |
| npm | scripts and package probes | yes | 11.5.1 | none. [VERIFIED: command output] |
| Python 3 | integration scenario runner | yes | 3.12.3 | none. [VERIFIED: command output] |
| Supabase / `.env.test` | integration tests | not probed | — | Tests skip or fail per existing harness if missing. [VERIFIED: AGENTS.md] |
| `gsd-sdk` | research/commit workflow | yes | command available | manual commit if needed. [VERIFIED: command output] |
| `slopcheck` | package audit | yes | command available | mark packages assumed if unavailable. [VERIFIED: command output] |

**Missing dependencies with no fallback:**
- Supabase credentials may be required for integration tests; `.env.test` availability was not validated during research. [VERIFIED: AGENTS.md]

**Missing dependencies with fallback:**
- None identified.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.x for unit/integration; Python YAML scenario runner for `INT-WCO-*`. [VERIFIED: package.json] |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`. [VERIFIED: package.json] |
| Quick run command | `npm test -- tests/unit/batch-input-shape.test.ts` |
| Full suite command | `npm run test:integration -- tests/integration/batch-envelope.integration.test.ts tests/integration/batch-input-shape.integration.test.ts` plus `python3 tests/scenarios/integration/run_integration.py --managed batch_envelope_per_item batch_mixed_input` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REQ-019 | schema accepts string, string[], mixed object arrays and rejects `version_tokens` | unit | `npm test -- tests/unit/batch-input-shape.test.ts` | no, Wave 0 |
| REQ-018 | remove batch returns ordered succeeded/conflicted/failed entries | integration | `npm run test:integration -- tests/integration/batch-envelope.integration.test.ts` | no, Wave 0 |
| REQ-018 | conflict entry carries current token and targeted region; not-found is failed; successes persist | integration | `npm run test:integration -- tests/integration/batch-envelope.integration.test.ts` | no, Wave 0 |
| REQ-019 | mixed bare/object input honors object token and skips bare string token check | integration | `npm run test:integration -- tests/integration/batch-input-shape.integration.test.ts` | no, Wave 0 |
| REQ-018 | `INT-WCO-02` archive batch public scenario | scenario | `python3 tests/scenarios/integration/run_integration.py --managed batch_envelope_per_item` | no, Wave 0 |
| REQ-019 | `INT-WCO-03` mixed input public scenario | scenario | `python3 tests/scenarios/integration/run_integration.py --managed batch_mixed_input` | no, Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- tests/unit/batch-input-shape.test.ts` for schema/helper work; focused integration file after handler changes. [CITED: Vault Write Coherency Locking Test Plan.md §4.3]
- **Per wave merge:** `npm run test:integration -- tests/integration/batch-envelope.integration.test.ts tests/integration/batch-input-shape.integration.test.ts`. [CITED: Vault Write Coherency Locking Test Plan.md §4.3]
- **Phase gate:** unit + integration + integration scenario evidence for `INT-WCO-02` and `INT-WCO-03`. [CITED: Vault Write Coherency Locking Test Plan.md §4.3]

### Wave 0 Gaps

- [ ] `tests/unit/batch-input-shape.test.ts` — covers `T-U-026`, `T-U-027`.
- [ ] `tests/integration/batch-envelope.integration.test.ts` — covers `T-I-034` through `T-I-037`.
- [ ] `tests/integration/batch-input-shape.integration.test.ts` — covers `T-I-038`.
- [ ] `tests/scenarios/integration/tests/batch_envelope_per_item.yml` — covers `T-Y-002` / `INT-WCO-02`.
- [ ] `tests/scenarios/integration/tests/batch_mixed_input.yml` — covers `T-Y-003` / `INT-WCO-03`.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | No auth changes in this phase. [ASSUMED] |
| V3 Session Management | no | MCP remains stateless per AGENTS.md. [VERIFIED: AGENTS.md] |
| V4 Access Control | no | No permission model change. [ASSUMED] |
| V5 Input Validation | yes | Zod schemas must validate mixed batch item shape and reject unsupported `version_tokens`. [VERIFIED: AGENTS.md] [CITED: Vault Write Coherency Locking Requirements.md §6.3.2] |
| V6 Cryptography | yes | Continue SHA-256 version-token helper; do not change token algorithm. [VERIFIED: src/mcp/utils/document-version.ts:16] |

### Known Threat Patterns for FlashQuery MCP Batch Writes

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stale write overwrite | Tampering | Per-item `version_token` check inside document lock against fresh disk bytes. [VERIFIED: .planning/phases/162-version-fingerprint-check/162-VERIFICATION.md] |
| Ambiguous or repeated identifier token mismatch | Tampering | Co-locate token with identifier object; do not use maps or parallel arrays. [CITED: Vault Write Coherency Locking Requirements.md §6.3.2] |
| Malformed batch object | Tampering | Zod union plus strict object for `{ identifier, version_token }`. [CITED: https://zod.dev/api] |
| Partial failure hidden from caller | Repudiation | Per-item `status` envelope in input order. [CITED: Vault Write Coherency Locking Requirements.md §6.3.1] |

## Sources

### Primary (HIGH confidence)

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Requirements.md` — REQ-018, REQ-019, §7.3 envelopes, Phase 9 development work.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Test Plan.md` — §4.3.1, §4.3.2, `T-U-026`, `T-U-027`, `T-I-034` through `T-I-038`, `T-Y-002`, `T-Y-003`.
- `.planning/phases/163-multi-file-batch-contract/163-CONTEXT.md` — locked user decisions and canonical refs.
- `.planning/phases/162-version-fingerprint-check/162-VERIFICATION.md` — Phase 162 version-token behavior verified.
- Context7 `/websites/zod_dev` — Zod unions, arrays, `z.strictObject`, unknown key handling.
- Current code: `src/mcp/tools/documents/remove.ts`, `src/mcp/tools/documents/archive.ts`, `src/mcp/tools/compound.ts`, `src/mcp/utils/document-version.ts`, `src/mcp/utils/response-formats.ts`.

### Secondary (MEDIUM confidence)

- `.agents/skills/flashquery-integration-testgen/SKILL.md` and `tests/scenarios/integration/README.md` — scenario authoring patterns and runner constraints.
- npm registry probes for `zod`, `vitest`, and `@modelcontextprotocol/sdk` versions.

### Tertiary (LOW confidence)

- Assumptions listed in the Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; existing stack verified from `package.json`, npm registry, and Context7.
- Architecture: HIGH — source docs and current handlers agree on API/backend responsibility.
- Pitfalls: HIGH for token/envelope pitfalls from source docs and code; MEDIUM for exact outer response wrapper until planner decides compatibility shape.

**Research date:** 2026-05-27
**Valid until:** 2026-06-26
