# Phase 162: Version-fingerprint Check - Research

**Researched:** 2026-05-27
**Domain:** FlashQuery MCP document coherency, optimistic version tokens, scanner stability
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
All bullets in this section are copied from `.planning/phases/162-version-fingerprint-check/162-CONTEXT.md`. [VERIFIED: 162-CONTEXT.md]

### Canonical Source Docs
- Downstream research, implementation, verification, and review agents MUST read the full requirements document first:
  `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Requirements.md`
- Downstream research, implementation, verification, and review agents MUST read the full test plan second:
  `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Test Plan.md`
- If this context conflicts with those docs, the external docs win unless the current ROADMAP phase narrows the scope.

### REQ-011 Response Token
- `get_document` returns `version_token` as a lowercase hex SHA-256 string for current on-disk bytes.
- Successful file-affecting writes return the post-write `version_token`; `remove_document` success omits it because the file no longer exists.
- Response naming is `version_token`, never `content_hash`; help output must describe it.
- Reads must not acquire write locks.

### REQ-012 Optional Preconditions
- Every file-affecting tool accepts optional `expected_version` and alias `if_match`.
- Missing precondition preserves current last-writer-wins behavior.
- Matching token allows the write; stale token refuses without modifying disk.
- For `remove_document`, `move_document`, and `archive_document`, the token refers to the source/removed file; for `copy_document`, it refers to the source file.

### REQ-013 Inside-lock Check
- Version comparison order is: acquire lock, fresh `readFile`, hash current disk bytes, compare, write or refuse, release.
- The comparison must not trust `fqc_documents.content_hash`.
- External editor or Obsidian edits between read and write must be caught because the check hashes disk bytes at write time.

### REQ-014 Token Equals Disk
- `writeVaultFile` / the durable write primitive is the source of post-write `contentHash`.
- `targetedScan` repair paths must propagate the post-repair hash.
- `document-output.ts` must upsert `fqc_documents.content_hash` with the same hash returned as `version_token`.
- A `get_document` that triggers repair must return a token accepted by a follow-up no-op write.

### REQ-015 Conflict Envelope
- Version mismatch responses use `error: "conflict"` with `details.reason: "version_mismatch"`, `version_token`, and `targeted_region`.
- Targeted-region payloads are per tool: whole document for `write_document` and destructive/structural tools; frontmatter for `apply_tags` / `insert_doc_link`; section for `replace_doc_section`; anchor section or document end for `insert_in_doc`.
- If the target region disappeared, return `targeted_region.not_found: true`.
- Refusal payloads should reuse the current file already read under the lock; no extra read should be needed.

### REQ-016 Whole-file Token
- `version_token` is SHA-256 over raw file bytes, including frontmatter and body, without normalization.
- Section-only reads still return the whole-file token.
- Do not expose section-scoped token fields in this phase.

### REQ-017 Scanner Stability
- Two consecutive scans of an untouched vault must perform zero file writes on the second scan.
- Repair paths must clear `needs_frontmatter_repair` after writing so later scans are stable.
- Do not introduce scanner normalization or retimestamp behavior that changes bytes on every scan.

### the agent's Discretion
- Exact helper names and placement are discretionary when they preserve the contracts above and existing code patterns.
- Plans may split by API surface and test layer as needed, but every phase requirement ID must appear in at least one plan frontmatter `requirements` field.

### Deferred Ideas (OUT OF SCOPE)
- Section-level version tokens.
- Default-on server-side version checking for first-party callers.
- Macro-engine auto-threading of `version_token`.
- Three-way or section-aware server merge on write conflict.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-011 | Add `version_token` to `get_document` and successful file-affecting write responses, except `remove_document` success. | Use `DocumentEnvelope`, `documentIdentification`, `documentArchiveResult`, `documentRemovalResult`, and tool success payloads as extension points. [VERIFIED: product Requirements §6.2.1] [VERIFIED: `src/mcp/utils/document-output.ts`] [VERIFIED: `src/mcp/utils/response-formats.ts`] |
| REQ-012 | Add optional `expected_version` and alias `if_match` to every file-affecting tool. | Tool schemas live in `documents/write.ts`, `archive.ts`, `remove.ts`, `copy.ts`, `move.ts`, and `compound.ts`; `apply_tags` also handles memory targets, so version preconditions apply only document targets. [VERIFIED: product Requirements §6.2.2] [VERIFIED: codebase grep] |
| REQ-013 | Compare the caller token after lock acquisition against fresh disk bytes, not DB hash. | Current update paths already re-read inside `withDocumentLock`; planner should add a shared helper that consumes that in-lock raw content. [VERIFIED: product Requirements §6.2.3] [VERIFIED: `src/mcp/tools/documents/write.ts`] [VERIFIED: `src/mcp/tools/compound.ts`] |
| REQ-014 | Keep returned token, disk bytes, and `fqc_documents.content_hash` equal, including read-triggered repair. | `writeVaultFile` already returns `contentHash`, but `document-resolver-primitives.ts` currently discards the return value and `document-output.ts` currently updates DB with the pre-repair hash. [VERIFIED: product Requirements §6.2.4] [VERIFIED: `src/storage/vault-write.ts`] [VERIFIED: `src/mcp/utils/document-resolver-primitives.ts`] [VERIFIED: `src/mcp/utils/document-output.ts`] |
| REQ-015 | Return structured conflict envelope with current token and caller-relevant current targeted region. | `jsonExpectedError` is the correct response helper; `markdown-sections.ts`, `gray-matter`, and existing heading/frontmatter helpers are the region extraction primitives. [VERIFIED: product Requirements §6.2.5] [VERIFIED: `src/mcp/utils/response-formats.ts`] [VERIFIED: `src/mcp/utils/markdown-sections.ts`] |
| REQ-016 | Treat `version_token` as whole-file raw-byte SHA-256; no section tokens. | Existing hash helpers use `createHash('sha256').update(...).digest('hex')`; Node docs confirm `digest('hex')` returns the hash of data passed through `update`. [VERIFIED: codebase grep] [CITED: Node.js v24 crypto docs via Context7 `/websites/nodejs_latest-v24_x_api`] |
| REQ-017 | Preserve scanner zero-write stability for unchanged vaults and repair-only flagged files once. | Scanner skip and repair paths are explicit; test must count write calls or verify unchanged `fq_updated` on second scan. [VERIFIED: product Requirements §6.2.7] [VERIFIED: product Test Plan §4.2.7] [VERIFIED: `src/services/scanner.ts`] |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20, TypeScript strict mode, ESM imports, `@modelcontextprotocol/sdk`, Supabase client/`pg`, `tsup`, `tsx`, and Vitest. [VERIFIED: AGENTS.md]
- MCP handlers must catch internally and return MCP text responses; expected conflicts should use structured JSON and should not set runtime `isError: true`. [VERIFIED: AGENTS.md] [VERIFIED: `src/mcp/utils/response-formats.ts`]
- Use Zod for external MCP parameter validation. [VERIFIED: AGENTS.md]
- Do not use CommonJS, do not use nonexistent `@modelcontextprotocol/server`, do not build a web UI, and do not add server-side session state. [VERIFIED: AGENTS.md]
- Tests are organized as unit, integration, E2E, and scenario layers; Phase 162 should use unit, Vitest integration, and directed scenarios per the product test plan. [VERIFIED: AGENTS.md] [VERIFIED: product Test Plan §4.2]

## Summary

Phase 162 is an API and invariants phase, not a lock-subsystem rewrite. Prior phases already delivered per-file locks, durable writes with returned hashes, advisory lock retirement/session checks, lock timeouts, directory locks, destination locks, and EXDEV fallback. [VERIFIED: Phase 155-161 summaries] The planner should preserve those boundaries and focus on threading the existing disk hash through `version_token`, optional precondition checks, DB `content_hash`, and conflict payloads. [VERIFIED: product Requirements §8 Phase 8]

The highest-risk implementation point is the `get_document` repair path. `writeVaultFile` returns `{ contentHash }`, but `targetedScan` currently calls a local `writeMarkdownFile` that returns `void`, then records `newContentHash` supplied by the caller rather than the post-repair hash. [VERIFIED: `src/storage/vault-write.ts`] [VERIFIED: `src/mcp/utils/document-resolver-primitives.ts`] `document-output.ts` then uses the initial `contentHash` for DB update and response construction, so Phase 162 must make repair return the hash actually committed and use that same value for `version_token` and `fqc_documents.content_hash`. [VERIFIED: `src/mcp/utils/document-output.ts`] [VERIFIED: product Requirements §6.2.4]

**Primary recommendation:** Add a small shared version helper layer, then plan implementation in four waves: read/repair token plumbing, write precondition + success token plumbing, conflict targeted-region envelopes, and scanner/scenario validation. [VERIFIED: codebase grep] [VERIFIED: product Test Plan §4.2]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| `version_token` computation | API / Backend | Filesystem | MCP tools own response shape; token must hash current vault file bytes. [VERIFIED: product Requirements §6.2.1, §6.2.6] |
| Expected-version precondition | API / Backend | Filesystem | Tool handlers must validate caller tokens after acquiring file locks and reading disk. [VERIFIED: product Requirements §6.2.2, §6.2.3] |
| Token/DB/disk invariant | API / Backend | Database / Storage | Write primitive owns post-write hash; tool/read paths must upsert `fqc_documents.content_hash` with the same value. [VERIFIED: product Requirements §6.2.4] |
| Conflict envelope | API / Backend | Filesystem | Tool handlers know caller target semantics and already hold current file content at refusal time. [VERIFIED: product Requirements §6.2.5] |
| Scanner zero-write stability | API / Backend | Filesystem / Database | Scanner decides whether to flag repair and whether to call `vaultManager.writeMarkdown`; DB flag clearing prevents repeat writes. [VERIFIED: `src/services/scanner.ts`] |
| Help/discoverability | API / Backend | Tool catalog | Native tool help markdown and MCP schemas expose `version_token`, `expected_version`, and `if_match`. [VERIFIED: `src/mcp/tool-help/*.tool.md`] [VERIFIED: product Requirements §6.2.1] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js runtime | local `v24.7.0`, project requires `>=20` | Runtime, `node:crypto`, `node:fs/promises` | Existing project runtime; `createHash('sha256').update(data).digest('hex')` is the current hash idiom. [VERIFIED: local `node --version`] [VERIFIED: package.json] [CITED: Node.js v24 crypto docs via Context7] |
| TypeScript / ESM | project standard | Strict TS modules | Existing source is ESM TypeScript; new helpers should follow existing imports. [VERIFIED: AGENTS.md] [VERIFIED: package.json] |
| Zod | `4.4.3` | MCP input schemas | Current tool schemas use Zod; add `expected_version` / `if_match` there. [VERIFIED: `npm list zod`] [VERIFIED: codebase grep] |
| Vitest | `4.1.7` | Unit and integration test runner | Existing `npm test` and `npm run test:integration` scripts use Vitest configs. [VERIFIED: `npm list vitest`] [VERIFIED: package.json] |
| `@modelcontextprotocol/sdk` | `1.29.0` | MCP server/tool registration | Existing document tools register via SDK `McpServer.registerTool`. [VERIFIED: `npm list @modelcontextprotocol/sdk`] [VERIFIED: codebase grep] |
| Supabase client | existing dependency | `fqc_documents.content_hash` reads/writes | Current document tools and scanner update document rows through Supabase client. [VERIFIED: codebase grep] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `gray-matter` | existing dependency | Parse frontmatter and body for targeted regions | Use for frontmatter conflict region and current write patterns. [VERIFIED: codebase grep] |
| `src/mcp/utils/markdown-sections.ts` | internal | Heading/section matching | Use for `replace_doc_section` and `insert_in_doc` targeted regions so refusal formatting matches `get_document`. [VERIFIED: codebase grep] |
| `src/storage/vault-write.ts` | internal | Durable writes and content hash source | Use returned `contentHash` as source of truth after actual writes. [VERIFIED: `src/storage/vault-write.ts`] |
| `src/services/document-lock.ts` | internal | Per-file and multi-file locks | Use existing locks; do not redesign locking in Phase 162. [VERIFIED: Phase 155/158/159 summaries] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `version_token` SHA-256 over raw bytes | `modified` timestamp | Rejected by product docs because timestamp resolution can miss same-second writes. [VERIFIED: product Requirements §6.2.1] |
| Current disk hash | `fqc_documents.content_hash` | Rejected because DB hash can lag scanner/repair state; version comparison must hash disk inside lock. [VERIFIED: product Requirements §6.2.3] |
| Whole-file token | Section token | Rejected for this phase; section-level tokens are deferred. [VERIFIED: 162-CONTEXT.md] |
| `isError: true` conflict | `jsonExpectedError` conflict | Rejected because version mismatch is an expected conflict envelope, not a runtime tool failure. [VERIFIED: product Requirements §7.4] [VERIFIED: `src/mcp/utils/response-formats.ts`] |

**Installation:** No external packages should be installed for Phase 162. [VERIFIED: package.json] [VERIFIED: codebase grep]

## Package Legitimacy Audit

No new external packages are recommended or required. [VERIFIED: package.json] Existing packages used by this phase are already present in the project dependency graph. [VERIFIED: `npm list vitest zod @modelcontextprotocol/sdk --depth=0`]

## Architecture Patterns

### System Architecture Diagram

```text
Caller reads document
  -> get_document
  -> resolveAndBuildDocument
  -> read current file bytes
  -> targetedScan if DB hash stale or row missing
      -> repair may call writeVaultFile
      -> returns post-repair contentHash
  -> update fqc_documents.content_hash with same token
  -> return document envelope + version_token

Caller writes with optional expected_version / if_match
  -> file-affecting MCP tool
  -> resolve target path(s)
  -> acquire existing directory/file lock(s)
  -> fresh readFile/current vault read inside lock
  -> compute current raw-byte SHA-256
  -> if token absent: continue last-writer-wins
  -> if token matches: write through existing primitive/path
      -> get post-write hash from writeVaultFile or post-write raw bytes
      -> update fqc_documents.content_hash
      -> return success payload + version_token
  -> if token mismatches: no write
      -> build jsonExpectedError conflict
      -> include new version_token + targeted_region from in-memory current file
```

### Recommended Project Structure

```text
src/
├── mcp/
│   ├── tools/
│   │   ├── documents/          # write/get/archive/remove/copy/move schema + response edits
│   │   └── compound.ts         # insert/apply/section preconditions and targeted regions
│   └── utils/
│       ├── document-output.ts  # get_document token propagation
│       ├── document-write.ts   # write response input shape can grow version_token
│       ├── document-version.ts # recommended new helper for token/precondition/conflict
│       └── markdown-sections.ts
├── services/
│   └── scanner.ts              # zero-write stability tests, avoid new normalization
└── storage/
    └── vault-write.ts          # existing contentHash source; do not replace
```

### Pattern 1: Single Source of Post-write Hash

**What:** Prefer the `contentHash` returned by `writeVaultFile` over a second response-layer hash when the code path has just written bytes. [VERIFIED: `src/storage/vault-write.ts`]  
**When to use:** `targetedScan` repair, direct calls to `writeVaultFile`, and any wrapper that can return the primitive result. [VERIFIED: product Requirements §6.2.4]

```typescript
// Source: src/storage/vault-write.ts
const bytes = toBuffer(content);
const contentHash = createHash('sha256').update(bytes).digest('hex');
// ... temp write, sync, rename, dir sync ...
return { contentHash };
```

### Pattern 2: Precondition Check Inside Existing Lock

**What:** Resolve and lock first, then read current bytes and compare `expected_version`. [VERIFIED: product Requirements §6.2.3]  
**When to use:** Every document-targeted mutation path; reuse existing in-lock reads at `write.ts`, `compound.ts`, `archive.ts`, and `remove.ts`. [VERIFIED: codebase grep]

```typescript
// Source: product Requirements §6.2.3 plus existing write.ts lock shape
await withDocumentLock(config, resolved.absPath, async () => {
  const rawContent = await readFile(resolved.absPath, 'utf-8');
  const currentToken = computeVersionToken(rawContent);
  const expected = expected_version ?? if_match;
  if (expected && expected !== currentToken) {
    return jsonExpectedError(buildVersionConflict(...));
  }
  // proceed with current write logic
});
```

### Pattern 3: Expected Conflict, Not Runtime Error

**What:** Version mismatch returns JSON `error: "conflict"` with `details.reason: "version_mismatch"`, `version_token`, and `targeted_region`, using `jsonExpectedError`. [VERIFIED: product Requirements §7.4] [VERIFIED: `src/mcp/utils/response-formats.ts`]  
**When to use:** Stale token refusal for single-file tools and per-item batch entries. [VERIFIED: product Requirements §6.2.5]

```typescript
// Source: product Requirements §7.4
jsonExpectedError({
  error: 'conflict',
  message: 'Document changed since the supplied expected_version.',
  details: { reason: 'version_mismatch' },
  version_token: currentToken,
  targeted_region: region,
});
```

### Anti-Patterns to Avoid

- **Checking `fqc_documents.content_hash` for preconditions:** DB hash can lag disk and repair writes. Hash the file bytes read under the file lock. [VERIFIED: product Requirements §6.2.3]
- **Adding locks to `get_document`:** Reads must not acquire write locks; add static T-U-037. [VERIFIED: product Test Plan §4.2.1]
- **Rehashing response tokens after repair in the response builder:** Product docs require the primitive-returned post-write hash to be propagated by construction. [VERIFIED: product Requirements §6.2.4]
- **Adding section-scoped tokens:** Explicitly out of scope for Phase 162. [VERIFIED: 162-CONTEXT.md]
- **Redoing Phase 155-161 work:** Locking primitives, durable write primitive, timeout envelopes, folder locks, destination locks, and EXDEV fallback already landed. [VERIFIED: Phase 155-161 summaries]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hashing raw content | Custom SHA implementation | `node:crypto` `createHash('sha256').update(bytes).digest('hex')` | Existing code already uses it and Node documents the digest behavior. [VERIFIED: codebase grep] [CITED: Node.js v24 crypto docs via Context7] |
| Durable writes | New temp/rename/fsync code | Existing `writeVaultFile` | Phase 156 already owns durability and hash return. [VERIFIED: Phase 156 summaries] |
| Locking | New lock registry or DB lock path | Existing `withDocumentLock` / `withDocumentLocks` | Phase 155/158/159 already own file locks, advisory tier, and timeouts. [VERIFIED: Phase 155/158/159 summaries] |
| Conflict response formatting | Hand-written MCP result object everywhere | Shared `jsonExpectedError` plus a version-conflict helper | Keeps `isError: false` and envelope shape consistent. [VERIFIED: `src/mcp/utils/response-formats.ts`] |
| Section extraction | New markdown parser | Existing `markdown-sections.ts` helpers | Keeps conflict region representation aligned with `get_document` section output. [VERIFIED: codebase grep] |

**Key insight:** Phase 162 should add a thin version/precondition layer over already-completed lock/write primitives; duplicating those primitives increases drift and test burden. [VERIFIED: Phase 155-161 summaries]

## Implementation Hotspots

| File | Current State | Phase 162 Planning Implication |
|------|---------------|--------------------------------|
| `src/storage/vault-write.ts` | `writeVaultFile` computes SHA-256 of the normalized bytes and returns `{ contentHash }`. [VERIFIED: `src/storage/vault-write.ts`] | Keep as source of post-write truth; no rewrite needed. |
| `src/mcp/utils/document-resolver-primitives.ts` | `writeMarkdownFile` delegates to `writeVaultFile` but returns `void`; `FrontmatterSnapshot.contentHash` is set from caller-provided `newContentHash`. [VERIFIED: `src/mcp/utils/document-resolver-primitives.ts`] | Change wrapper/return types so repair paths surface post-write `contentHash`. |
| `src/mcp/utils/document-output.ts` | `resolveAndBuildDocument` computes `contentHash` from initial read and updates DB with that value after `targetedScan`. [VERIFIED: `src/mcp/utils/document-output.ts`] | Use post-repair hash from `preScan.capturedFrontmatter.contentHash`; include `version_token` in `DocumentEnvelope`. |
| `src/mcp/utils/response-formats.ts` | `jsonExpectedError` returns `isError: false`; document identity helpers do not accept `version_token`. [VERIFIED: `src/mcp/utils/response-formats.ts`] | Extend helper input types or wrap payloads at call sites. |
| `src/mcp/tools/documents/write.ts` | Create/update paths write and compute post-write DB hash, but response omits token and schemas omit precondition fields. [VERIFIED: `src/mcp/tools/documents/write.ts`] | Add schema fields, in-lock check for update, source/destination semantics for create/update, and success `version_token`. |
| `src/mcp/tools/documents/archive.ts` / `remove.ts` | Source file is read inside lock; DB update does not currently store archive/removal write `content_hash` consistently in all paths. [VERIFIED: codebase grep] | Add precondition on source bytes; archive success returns token, remove success omits token. |
| `src/mcp/tools/documents/copy.ts` | Reads source before destination lock and only locks destination. [VERIFIED: `src/mcp/tools/documents/copy.ts`] | REQ-012 says token refers to source; planner must decide whether to add a source lock/read for precondition or minimally re-read/hash source after destination lock. The product requires matching current source bytes, not destination bytes. [VERIFIED: product Requirements §6.2.2] |
| `src/mcp/tools/documents/move.ts` | Locks source and destination; success reads destination after move. [VERIFIED: `src/mcp/tools/documents/move.ts`] | Check source `expected_version` inside multi-lock before rename; return destination token after move. |
| `src/mcp/tools/compound.ts` | `insert_doc_link`, document-target `apply_tags`, `insert_in_doc`, and `replace_doc_section` read/write under locks. [VERIFIED: `src/mcp/tools/compound.ts`] | Add schema fields and targeted-region builders; for `apply_tags`, only document targets participate in version preconditions. |
| `src/services/scanner.ts` | Unchanged files skip writes; four paths flag `needs_frontmatter_repair`; repair clears flag and updates `content_hash`. [VERIFIED: `src/services/scanner.ts`] | Add regression tests and avoid code changes that retimestamp unchanged files. |
| `src/mcp/tool-help/*.tool.md` | Help files exist for all affected tools and currently omit `version_token` / `expected_version`. [VERIFIED: codebase grep] | Update help markdown and schemas for discoverability. |

## Common Pitfalls

### Pitfall 1: False Refusal After Read-triggered Repair

**What goes wrong:** `get_document` repairs frontmatter, returns a token derived from pre-repair bytes, and the next `write_document(expected_version)` is refused. [VERIFIED: product Requirements §6.2.4]  
**Why it happens:** `targetedScan` returns caller-provided `newContentHash` instead of the hash returned by `writeVaultFile`. [VERIFIED: `src/mcp/utils/document-resolver-primitives.ts`]  
**How to avoid:** Make repair write wrappers return post-write hash and use that for response + DB. [VERIFIED: product Requirements §6.2.4]  
**Warning signs:** T-I-026/T-I-027 or D-WCO-06 fails. [VERIFIED: product Test Plan §4.2.4]

### Pitfall 2: Precondition Check Outside the Lock

**What goes wrong:** External editor changes between check and write are missed. [VERIFIED: product Requirements §6.2.3]  
**Why it happens:** Helper is called before `withDocumentLock` or uses stale resolver/DB state. [VERIFIED: product Requirements §6.2.3]  
**How to avoid:** The version helper should accept the raw content already read inside the critical section. [VERIFIED: codebase grep]  
**Warning signs:** T-I-025 cannot force a conflict with an intervening write. [VERIFIED: product Test Plan §4.2.3]

### Pitfall 3: Copy Source Token Semantics

**What goes wrong:** `copy_document` validates `expected_version` against destination or skips source re-read because the operation mainly locks destination. [VERIFIED: product Requirements §6.2.2]  
**Why it happens:** Phase 161 focused on destination race prevention, while Phase 162 preconditions refer to the source file for copy. [VERIFIED: Phase 161 summaries] [VERIFIED: product Requirements §6.2.2]  
**How to avoid:** Plan a source-byte hash check for `copy_document` explicitly. [VERIFIED: product Requirements §6.2.2]  
**Warning signs:** T-I-023 passes for move/archive/remove but not copy. [VERIFIED: product Test Plan §4.2.2]

### Pitfall 4: Region Shape Drift

**What goes wrong:** Conflict `targeted_region` differs from what `get_document` would return, so callers cannot compare their original region to the current region. [VERIFIED: product Requirements §6.2.5]  
**Why it happens:** New extraction logic serializes frontmatter/sections differently than existing `get_document` helpers. [VERIFIED: product Requirements §6.2.5]  
**How to avoid:** Reuse `gray-matter` and `markdown-sections.ts` helpers and add T-I-031. [VERIFIED: product Test Plan §4.2.5]  
**Warning signs:** Whitespace-only or ordering-only failures in targeted-region tests. [VERIFIED: product Test Plan §4.2.5]

### Pitfall 5: Scanner Retimestamps Outstanding Tokens

**What goes wrong:** Background scans invalidate valid caller tokens even when file content is unchanged. [VERIFIED: product Requirements §6.2.7]  
**Why it happens:** A normalization/repair path rewrites frontmatter every scan or fails to clear `needs_frontmatter_repair`. [VERIFIED: `src/services/scanner.ts`]  
**How to avoid:** Preserve current skip-on-hash-match behavior and add zero-write integration/directed tests. [VERIFIED: product Test Plan §4.2.7]

## Code Examples

### Version Helper Shape

```typescript
// Source: recommendation derived from product Requirements §6.2 and existing response helpers.
export function versionTokenForRawBytes(raw: Buffer | string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function pickExpectedVersion(input: {
  expected_version?: string;
  if_match?: string;
}): string | undefined {
  return input.expected_version ?? input.if_match;
}
```

### Conflict Envelope Shape

```typescript
// Source: product Requirements §7.4.
return jsonExpectedError({
  error: 'conflict',
  message: 'Document changed since the supplied expected_version.',
  details: { reason: 'version_mismatch' },
  version_token: currentToken,
  targeted_region: targetedRegion,
});
```

### Read Response Token Plumbing

```typescript
// Source: src/mcp/utils/document-output.ts current pipeline plus product Requirements §6.2.4.
const token = preScan.capturedFrontmatter.contentHash;
const envelope = buildMetadataEnvelope(identifier, preScan, data, content);
return buildConsolidatedResponse(
  { ...envelope, version_token: token },
  effectiveInclude,
  { body, frontmatter, headings }
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Coarse `documents` lock | Per-file `withDocumentLock` and `withDocumentLocks` | Phase 155/158/159 | Phase 162 should reuse existing critical sections. [VERIFIED: Phase 155/158/159 summaries] |
| Fixed temp write path | `writeVaultFile` with unique temp, sync, rename, dir sync, hash return | Phase 156 | Phase 162 can use returned `contentHash`. [VERIFIED: Phase 156 summaries] |
| Destination check before lock | Destination/source locks and inside-lock existence checks | Phase 161 | Phase 162 must not move checks outside locks while adding version logic. [VERIFIED: Phase 161 summaries] |
| Macro-level locking | Per-called-tool locking only | Phase 155 | Macro auto-threading of tokens is deferred; T-I-050 can be unskipped after Phase 162 behavior exists. [VERIFIED: Phase 155 summary] [VERIFIED: 162-CONTEXT.md] |

**Deprecated/outdated:**
- `content_hash` as caller-facing name: use `version_token`. [VERIFIED: product Requirements §6.2.1]
- Server-default version checking: out of scope; callers opt in. [VERIFIED: product Requirements §6.2.2]
- Section tokens: out of scope. [VERIFIED: 162-CONTEXT.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A new helper file such as `src/mcp/utils/document-version.ts` is acceptable if it follows existing utility patterns. [ASSUMED] | Recommended Project Structure | Planner may instead inline helpers; behavior is unaffected. |
| A2 | Integration tests can safely use `.env.test` because it exists locally, but actual credentials/session capability still need runtime validation. [ASSUMED] | Environment Availability | Integration runs may skip or fail if `.env.test` values are incomplete. |

## Open Questions

1. **Should `copy_document` also lock the source when `expected_version` is supplied?**
   - What we know: product docs say copy precondition refers to source, and current copy locks only destination. [VERIFIED: product Requirements §6.2.2] [VERIFIED: `src/mcp/tools/documents/copy.ts`]
   - What's unclear: whether planner should add source+destination locking for all copies or only source re-read/hash under destination lock.
   - Recommendation: add source lock when a source precondition is supplied, and acquire any multi-file locks through existing sorted lock helpers if both source and destination locks are held. [ASSUMED]

2. **Should batch tool version semantics be partially implemented now?**
   - What we know: Phase 162 covers current file-affecting tools and Phase 163 covers multi-file batch contract. [VERIFIED: ROADMAP.md]
   - What's unclear: `archive_document` and `remove_document` already accept arrays today, but Phase 163 owns the ordered `succeeded/conflicted/failed` batch envelope. [VERIFIED: product Requirements §6.3]
   - Recommendation: Phase 162 should add per-item stale-token refusal only where current batch shape naturally supports per-item errors, but leave new batch status-envelope restructuring to Phase 163. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build/test/runtime | yes | `v24.7.0` | Project requires Node >=20. [VERIFIED: local command] |
| npm | Test commands | yes | `11.5.1` | none needed. [VERIFIED: local command] |
| Python 3 | Directed/integration scenario runners | yes | `3.12.3` | none needed. [VERIFIED: local command] |
| Git | Scenario cleanup / evidence | yes | `2.50.1` Apple Git | none needed. [VERIFIED: local command] |
| `.env.test` | Vitest integration and scenario managed runs | present | file present, values not inspected | Tests may skip/fail if credentials are incomplete. [VERIFIED: local command] [ASSUMED] |
| Supabase test DB | Integration evidence | not probed | unknown | Integration tests skip gracefully when env incomplete per AGENTS.md. [VERIFIED: AGENTS.md] |

**Missing dependencies with no fallback:** None detected at research time. [VERIFIED: local command]

**Missing dependencies with fallback:** Supabase connectivity was not probed; planner should treat integration evidence as environment-gated. [ASSUMED]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `4.1.7`; Python directed scenarios. [VERIFIED: `npm list vitest`] [VERIFIED: product Test Plan §2] |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`. [VERIFIED: package.json] |
| Quick run command | `npm test -- --grep "version-token|expected-version|conflict-envelope|get-document-no-lock"` [VERIFIED: ROADMAP.md] |
| Full suite command | `npm run test:integration -- --grep "version-token|version-check|token-equals-disk|refused-write|scanner-zero-writes"` plus directed D-WCO-05/06/07 when implemented. [VERIFIED: ROADMAP.md] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-011 | `get_document` and write successes expose `version_token`; reads do not lock. | unit/integration/static | `npm test -- --grep "version-token|get-document-no-lock"` | No - Wave 0. [VERIFIED: product Test Plan §4.2.1] |
| REQ-012 | `expected_version` / `if_match` schema and write preconditions. | unit/integration/directed | `npm test -- --grep "expected-version"`; `npm run test:integration -- --grep "version-token-precondition"` | No - Wave 0. [VERIFIED: product Test Plan §4.2.2] |
| REQ-013 | Check runs inside lock against fresh disk bytes. | integration | `npm run test:integration -- --grep "version-check-inside-lock"` | No - Wave 0. [VERIFIED: product Test Plan §4.2.3] |
| REQ-014 | Token equals disk/DB across repair and write paths. | integration/directed | `npm run test:integration -- --grep "token-equals-disk"` | No - Wave 0. [VERIFIED: product Test Plan §4.2.4] |
| REQ-015 | Conflict envelope includes new token and targeted region. | unit/integration | `npm test -- --grep "conflict-envelope"`; `npm run test:integration -- --grep "refused-write-envelope"` | No - Wave 0. [VERIFIED: product Test Plan §4.2.5] |
| REQ-016 | Whole-file hash semantics and section read still returns whole-file token. | unit | `npm test -- --grep "version-token-shape"` | No - Wave 0. [VERIFIED: product Test Plan §4.2.6] |
| REQ-017 | Consecutive scans perform zero second-run writes; repair clears flag. | integration/directed | `npm run test:integration -- --grep "scanner-zero-writes"` | No - Wave 0. [VERIFIED: product Test Plan §4.2.7] |

### Sampling Rate

- **Per task commit:** targeted unit grep for touched behavior plus affected existing tests. [ASSUMED]
- **Per wave merge:** ROADMAP quick run and focused integration grep. [VERIFIED: ROADMAP.md]
- **Phase gate:** All Test Plan §4.2.1-§4.2.7 IDs pass or are documented with environment skip rationale. [VERIFIED: product Test Plan §4.2]

### Wave 0 Gaps

- [ ] `tests/unit/document-output-version-token.test.ts` - T-U-020/T-U-021. [VERIFIED: product Test Plan §4.2.1]
- [ ] `tests/unit/get-document-no-lock.test.ts` - T-U-037. [VERIFIED: product Test Plan §4.2.1]
- [ ] `tests/unit/expected-version-schema.test.ts` - T-U-022. [VERIFIED: product Test Plan §4.2.2]
- [ ] `tests/unit/conflict-envelope.test.ts` - T-U-023. [VERIFIED: product Test Plan §4.2.5]
- [ ] `tests/unit/version-token-shape.test.ts` - T-U-024/T-U-025. [VERIFIED: product Test Plan §4.2.6]
- [ ] `tests/integration/version-token-shape.integration.test.ts` - T-I-019. [VERIFIED: product Test Plan §4.2.1]
- [ ] `tests/integration/version-token-precondition.integration.test.ts` - T-I-020 through T-I-024. [VERIFIED: product Test Plan §4.2.2]
- [ ] `tests/integration/version-check-inside-lock.integration.test.ts` - T-I-025. [VERIFIED: product Test Plan §4.2.3]
- [ ] `tests/integration/token-equals-disk.integration.test.ts` - T-I-026 through T-I-028. [VERIFIED: product Test Plan §4.2.4]
- [ ] `tests/integration/refused-write-envelope.integration.test.ts` - T-I-029 through T-I-031. [VERIFIED: product Test Plan §4.2.5]
- [ ] `tests/integration/scanner-zero-writes.integration.test.ts` - T-I-032/T-I-033. [VERIFIED: product Test Plan §4.2.7]
- [ ] `tests/scenarios/directed/testcases/test_version_token_round_trip.py` - D-WCO-05. [VERIFIED: product Test Plan §4.2.2]
- [ ] `tests/scenarios/directed/testcases/test_read_triggered_repair_token.py` - D-WCO-06. [VERIFIED: product Test Plan §4.2.4]
- [ ] `tests/scenarios/directed/testcases/test_scanner_token_stability.py` - D-WCO-07. [VERIFIED: product Test Plan §4.2.7]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | No auth/session surface changes in this phase. [VERIFIED: phase scope] |
| V3 Session Management | no | MCP remains stateless; no server-side session state added. [VERIFIED: AGENTS.md] |
| V4 Access Control | yes | Preserve existing vault path validation and document identifier resolution; do not bypass path guards when adding precondition checks. [VERIFIED: codebase grep] |
| V5 Input Validation | yes | Use Zod schemas for `expected_version` / `if_match`; reject or normalize malformed tokens consistently. [VERIFIED: AGENTS.md] [ASSUMED implementation detail] |
| V6 Cryptography | yes | SHA-256 is used as an integrity/version fingerprint, not as an authentication secret; do not design security around token secrecy. [VERIFIED: product Requirements §6.2.6] [ASSUMED security interpretation] |

### Known Threat Patterns for FlashQuery Document Tools

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal while adding precondition checks | Tampering | Keep `validateVaultPath` and resolver boundaries unchanged. [VERIFIED: codebase grep] |
| Lost update from stale read | Tampering | Optional `expected_version` checked against fresh disk bytes under lock. [VERIFIED: product Requirements §6.2.3] |
| Information leakage through conflict region | Information Disclosure | Return only the caller-relevant current region required by the tool contract; do not include unrelated metadata beyond specified region. [VERIFIED: product Requirements §6.2.5] |
| Runtime-error treatment of expected conflicts | Repudiation / Reliability | Use expected JSON conflict envelopes with explicit `details.reason`. [VERIFIED: product Requirements §7.4] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/162-version-fingerprint-check/162-CONTEXT.md` - locked implementation decisions and deferred scope. [VERIFIED]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Requirements.md` - canonical REQ-011 through REQ-017 and Phase 8 guidance. [VERIFIED]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Test Plan.md` - canonical T-U/T-I/T-S coverage. [VERIFIED]
- `.planning/ROADMAP.md` - Phase 162 goal, success criteria, evidence commands. [VERIFIED]
- `.planning/STATE.md` - prior phase completion state. [VERIFIED]
- `src/storage/vault-write.ts`, `src/mcp/utils/document-output.ts`, `src/mcp/utils/document-resolver-primitives.ts`, `src/mcp/tools/documents/*.ts`, `src/mcp/tools/compound.ts`, `src/services/scanner.ts`, `src/mcp/utils/response-formats.ts` - current implementation hotspots. [VERIFIED]
- Context7 `/websites/nodejs_latest-v24_x_api` - Node `crypto.createHash`, `hash.update`, `hash.digest('hex')`, and `fsPromises.readFile` behavior. [CITED]

### Secondary (MEDIUM confidence)

- Phase 155, 156, 158, 159, 160, and 161 summaries/research - prior phase boundaries and completed work. [VERIFIED]
- Project skill files under `.agents/skills/` and scenario authoring docs - directed/integration scenario conventions. [VERIFIED]

### Tertiary (LOW confidence)

- None. [VERIFIED: research process]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - verified from `package.json`, `npm list`, AGENTS.md, and codebase imports.
- Architecture: HIGH - phase contracts are locked in product docs and current source code hotspots were inspected.
- Pitfalls: HIGH - pitfalls map directly to product acceptance criteria and current code paths.

**Research date:** 2026-05-27
**Valid until:** 2026-06-26
