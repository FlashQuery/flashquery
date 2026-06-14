# Phase 168: Chunking Foundation and Write Pipeline - Research

**Researched:** 2026-06-14 [VERIFIED: local date]
**Domain:** TypeScript/Node.js markdown chunking, Supabase pgvector DDL, embedding write pipeline [VERIFIED: AGENTS.md; requirements docs]
**Confidence:** HIGH for phase scope and local code touchpoints; MEDIUM for exact markdown parser implementation details until fixtures are measured [VERIFIED: codebase grep; CITED: external requirements docs]

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- The requirements document at `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Embedding Chunks Migration (14-Jun-2026)/Embedding Chunks Migration Requirements.md` is authoritative for behavior and scope.
- The test plan at `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Embedding Chunks Migration (14-Jun-2026)/Embedding Chunks Migration Test Plan.md` is authoritative for required coverage and test IDs.
- Downstream implementation, review, and verification agents MUST read those two documents before asking questions, editing code, or declaring ambiguity.
- Implement deterministic parser behavior for REQ-CHUNK-001 through REQ-CHUNK-005.
- Implement `fqc_chunks`, chunk per-entry columns, chunk RPCs, and fresh-schema document semantic target changes for REQ-CHUNK-006 through REQ-CHUNK-008 and the Phase 168 slice of REQ-CHUNK-014.
- Implement document create/update/copy/scanner/compound chunk diffing and `document_chunk` embedding scheduling/pending retry for REQ-CHUNK-009 and REQ-CHUNK-010.
- Preserve memory and plugin embedding behavior while touching shared embedding infrastructure.
- Do not implement lifecycle action chunk behavior from REQ-CHUNK-011 in Phase 168.
- Do not implement unified search routing/result shape from REQ-CHUNK-012 or REQ-CHUNK-013 in Phase 168.
- Do not add operator migration or cleanup workflows for legacy document vectors.
- Do not chunk memories or plugin records.
- Do not introduce document-level summary vectors.

### the agent's Discretion

- The parser may add a CommonMark/GFM-aware markdown parsing dependency if needed to satisfy atomic block requirements, following existing ESM/TypeScript conventions and package legitimacy checks.
- Parser parameters may start as internal defaults unless the existing config-loader pattern makes YAML exposure low-risk.
- Implementation may introduce helper modules under `src/embedding/chunks/` when they reduce coupling between parsing, storage diffing, and embedding scheduling.

### Deferred Ideas (OUT OF SCOPE)

- Lifecycle `maintain_vault` chunk backfill/rebuild behavior is deferred to Phase 169.
- Chunk-based unified search routing, `matched_chunks`, and `limit_chunks_per_result` are deferred to Phase 169.
- Memory/plugin preservation should be guarded by Phase 168 tests where shared DDL/scheduler code is touched, with broader public preservation scenarios deferred to Phase 169.
- Graph edges, graph similarity rollups, Docling ingestion, semantic chunking for heading-less docs, table-to-prose serialization, and language-aware code splitting remain out of scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-CHUNK-001 | Normalize chunk text deterministically and hash stored body only. | Use `src/embedding/chunks/normalize.ts`; SHA-256 from `node:crypto`; embed text is `breadcrumb + "\n\n" + content`. [CITED: requirements §6.1.1] |
| REQ-CHUNK-002 | Parse markdown into heading-aware sections. | Use CommonMark/GFM AST parsing; current `extractHeadings` is helpful but insufficient for atomic blocks. [VERIFIED: src/mcp/utils/markdown-utils.ts:84; CITED: requirements §6.1.2] |
| REQ-CHUNK-003 | Apply size guards, merge-forward, sub-split, and overlap. | Keep parser pure and deterministic; test with artificial low token budgets before provider integration. [CITED: requirements §6.1.3] |
| REQ-CHUNK-004 | Preserve fenced code, GFM tables, and top-level lists as atomic blocks. | Use `mdast-util-from-markdown` + GFM extensions; avoid regex-only detection. [VERIFIED: Context7 /syntax-tree/mdast-util-from-markdown; CITED: requirements §6.1.4] |
| REQ-CHUNK-005 | Derive stable UUID5 chunk IDs and sub-split parent links. | Existing `uuid` accepts v5 UUIDs; derive IDs from `<instance_id>:<document_id>:<heading_path>:<chunk_index>`. [VERIFIED: package.json; src/utils/uuid.ts:7; CITED: requirements §6.1.5] |
| REQ-CHUNK-006 | Create `fqc_chunks` table with constraints and indexes. | Add DDL near `fqc_documents` and before embedding column-set sync. [VERIFIED: src/storage/supabase.ts:355; CITED: requirements §7.1] |
| REQ-CHUNK-007 | Move document per-entry columns from documents to chunks. | Replace `CORE_EMBEDDING_TABLES = ['fqc_documents', 'fqc_memory']` with distinct document-chunk and memory paths; add chunk `_indexed_at`. [VERIFIED: src/storage/supabase.ts:1021; src/storage/supabase.ts:1144] |
| REQ-CHUNK-008 | Generate `match_chunks_<name>` RPCs instead of document-content RPCs. | Replace document RPC generator with chunk RPC returning chunk plus parent document metadata. [VERIFIED: src/storage/supabase.ts:1093; CITED: requirements §6.2.3] |
| REQ-CHUNK-009 | Diff chunks transactionally on document writes/scans/copy. | Add shared chunk store helper called by write, copy, scanner, compound/document-output paths. [VERIFIED: src/mcp/tools/documents/write.ts:246; src/services/scanner.ts:496] |
| REQ-CHUNK-010 | Schedule/retry chunk embeddings per active catalog entry. | Add `document_chunk` target kind and route stamped writes to `fqc_chunks` with entry-specific `_indexed_at`. [VERIFIED: src/embedding/background-embed.ts:17; src/embedding/pending-worker.ts:231] |
</phase_requirements>

## Summary

Phase 168 should be planned as three tightly ordered implementation waves: pure parser/identity, schema/catalog DDL, then write/scan chunk diff plus embedding scheduling. [CITED: requirements §8.2] The planner should not schedule lifecycle or search-result work here; those are Phase 169 responsibilities even though Phase 168 must create the chunk table/RPCs that Phase 169 will consume. [VERIFIED: 168-CONTEXT.md; CITED: requirements §8.2]

The critical architectural change is that document semantic storage moves from row-per-document vectors on `fqc_documents` to row-per-chunk vectors on `fqc_chunks`, while memory and plugin records keep their current row-per-vector behavior. [CITED: requirements §3.1; VERIFIED: src/storage/supabase.ts:1021] Existing write paths currently embed whole documents as `title + "\n\n" + body`, so the planner must include explicit tasks to replace every document embedding call site with a shared chunk diff/schedule helper. [VERIFIED: src/mcp/tools/documents/write.ts:246; src/mcp/tools/documents/copy.ts:220; src/services/scanner.ts:496]

**Primary recommendation:** build `src/embedding/chunks/` first, then wire DDL/catalog, then replace whole-document scheduling with a transactional `diffAndPersistDocumentChunks` helper plus `documentChunkEmbeddingTarget`. [VERIFIED: codebase inspection; CITED: requirements §8.3-§8.5]

## Canonical References and Downstream-Agent Instruction

Downstream implementation, review, and verification agents MUST read these two files before asking questions or editing code: [VERIFIED: user request; 168-CONTEXT.md]

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Embedding Chunks Migration (14-Jun-2026)/Embedding Chunks Migration Requirements.md` [CITED: external requirements doc]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Embedding Chunks Migration (14-Jun-2026)/Embedding Chunks Migration Test Plan.md` [CITED: external test plan]

Treat those docs as authoritative over this research if a detail appears to conflict. [VERIFIED: user request]

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20 LTS, TypeScript strict mode, ESM imports, and the existing CLI/MCP architecture. [VERIFIED: AGENTS.md]
- Do not use CommonJS `require`. [VERIFIED: AGENTS.md]
- Use `@modelcontextprotocol/sdk`, not `@modelcontextprotocol/server`. [VERIFIED: AGENTS.md]
- Do not build a web UI; FlashQuery is CLI + MCP only. [VERIFIED: AGENTS.md]
- Do not implement server-side session state; MCP is stateless and project context is per call. [VERIFIED: AGENTS.md]
- Use async/await throughout. [VERIFIED: AGENTS.md]
- External inputs must be validated with Zod. [VERIFIED: AGENTS.md]
- MCP tool handlers catch internally and return `{ content: [{ type: "text", text: "..." }] }`, with `isError: true` on failure. [VERIFIED: AGENTS.md]
- Tests should follow Vitest unit/integration conventions and scenario frameworks under `tests/scenarios/`. [VERIFIED: AGENTS.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Markdown chunk parsing and ID derivation | API / Backend | — | Runs inside server write/scanner/lifecycle code and must be deterministic independent of clients. [CITED: requirements §7.2] |
| Chunk table and vector columns | Database / Storage | API / Backend | PostgreSQL owns constraints, cascades, vector columns, HNSW indexes, and RPCs. [CITED: requirements §7.1-§7.3] |
| Document write chunk diff | API / Backend | Database / Storage | Server parses body and plans changes; storage applies inserts/updates/deletes transactionally. [CITED: requirements §6.3.1] |
| Chunk embedding scheduling and retry | API / Backend | Database / Storage | Background scheduler constructs target metadata and pending rows; DB persists retry state. [VERIFIED: src/embedding/background-embed.ts:350; src/storage/supabase.ts:450] |
| Memory/plugin embedding preservation | API / Backend | Database / Storage | Shared embedding code changes must not alter existing non-document target contracts. [CITED: requirements §6.3.2] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `mdast-util-from-markdown` | 2.0.3 | Parse CommonMark markdown to mdast AST. | Official syntax-tree package; Context7 shows ESM `fromMarkdown(value)` usage and extension hooks. [VERIFIED: Context7 /syntax-tree/mdast-util-from-markdown; VERIFIED: npm registry] |
| `micromark-extension-gfm` | 3.0.0 | Enable GFM tokenizer extensions. | Official example for mdast GFM parsing uses `extensions: [gfm()]`. [VERIFIED: Context7 /syntax-tree/mdast-util-gfm; VERIFIED: npm registry] |
| `mdast-util-gfm` | 3.1.0 | Convert GFM tokens into mdast nodes including tables/tasklists. | Official docs state `gfmFromMarkdown()` enables GFM parsing for `mdast-util-from-markdown`. [VERIFIED: Context7 /syntax-tree/mdast-util-gfm; VERIFIED: npm registry] |
| `uuid` | 13.0.0 currently installed | UUID5 deterministic chunk IDs. | Existing dependency; local UUID validator already accepts v5 IDs. [VERIFIED: package.json; src/utils/uuid.ts:7] |
| `pg` | 8.21.0 currently installed | Transactional DDL/DML and vector updates where Supabase JS is insufficient. | Existing code already uses pooled pg for stamped vector writes. [VERIFIED: package.json; src/embedding/background-embed.ts:289] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `mdast-util-to-markdown` | 2.1.2 | Serialize mdast/GFM fragments back to markdown. | Use only if source slicing is not enough for oversized table/list/code reconstruction. [VERIFIED: Context7 /syntax-tree/mdast-util-gfm; VERIFIED: npm registry] |
| `gray-matter` | 4.0.3 currently installed | Strip frontmatter before chunking. | Existing scanner/write paths already parse markdown frontmatter with `matter(raw)`. [VERIFIED: package.json; src/services/scanner.ts:1162] |
| Node `crypto` | built-in | SHA-256 `content_hash`. | Existing code already uses SHA-256 for version tokens/content hashes. [VERIFIED: src/mcp/utils/document-version.ts:1] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `mdast-util-from-markdown` stack | Regex heading/code/table detection | Regex-only detection is explicitly disallowed unless it passes CommonMark/GFM edge cases, and the existing helper only handles ATX headings/fences. [CITED: requirements §6.1.4; VERIFIED: src/mcp/utils/markdown-utils.ts:84] |
| `mdast-util-from-markdown` stack | `chevrotain` custom markdown grammar | `chevrotain` is installed, but implementing CommonMark/GFM grammar would be hand-rolling a parser. [VERIFIED: package.json; ASSUMED] |
| Internal parser defaults | YAML-configured parser params | Requirements allow internal defaults for v1; YAML exposure adds config/testing surface that Phase 168 does not need unless low-risk. [VERIFIED: 168-CONTEXT.md; CITED: requirements §7.2] |

**Installation, if parser dependency is accepted:**

```bash
npm install mdast-util-from-markdown mdast-util-gfm micromark-extension-gfm
```

Add `mdast-util-to-markdown` only if implementation needs AST serialization for reconstructed atomic blocks. [VERIFIED: Context7 /syntax-tree/mdast-util-gfm]

## Package Legitimacy Audit

`slopcheck install ... --json` was unavailable because the installed CLI rejected `--json`; plain `slopcheck install` reported all checked packages `[OK]`. [VERIFIED: slopcheck CLI output] The command attempted installation after reporting OK; dependency file changes were reverted after the audit. [VERIFIED: git status]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `mdast-util-from-markdown` | npm | created 2020-08-31, modified 2026-02-21 | not checked | github.com/syntax-tree/mdast-util-from-markdown | OK | Approved [VERIFIED: Context7; VERIFIED: npm registry; VERIFIED: slopcheck] |
| `mdast-util-gfm` | npm | created 2020-09-18, modified 2025-02-10 | not checked | github.com/syntax-tree/mdast-util-gfm | OK | Approved [VERIFIED: Context7; VERIFIED: npm registry; VERIFIED: slopcheck] |
| `micromark-extension-gfm` | npm | created 2020-09-17, modified 2023-06-26 | not checked | github.com/micromark/micromark-extension-gfm | OK | Approved [VERIFIED: Context7 via GFM docs; VERIFIED: npm registry; VERIFIED: slopcheck] |
| `mdast-util-to-markdown` | npm | created 2020-09-09, modified 2024-11-04 | not checked | github.com/syntax-tree/mdast-util-to-markdown | OK | Supporting only [VERIFIED: Context7 /syntax-tree/mdast-util-gfm; VERIFIED: npm registry; VERIFIED: slopcheck] |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: slopcheck output]
**Packages flagged as suspicious [SUS]:** none. [VERIFIED: slopcheck output]
**Postinstall scripts:** none were returned by `npm view <pkg> scripts.postinstall`. [VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```text
Markdown document write/scan/copy
  -> gray-matter strips frontmatter
  -> src/embedding/chunks/parser.ts builds deterministic chunks
  -> src/embedding/chunks/store.ts diffs DB chunks by id/content_hash
      -> insert/update changed chunks in fqc_chunks
      -> delete orphan chunks in same transaction
      -> return changed chunk embedding work
  -> scheduleBackgroundEmbeddingsForActiveEntries(document_chunk target)
      -> provider embed(breadcrumb + "\n\n" + content)
      -> fqc_chunks.embedding_<name> + stamp + _indexed_at
      -> on failure upsert fqc_pending_embeds(document_chunk, fqc_chunks, chunk_id, embedding_name)
```

### Recommended Project Structure

```text
src/embedding/chunks/
├── normalize.ts      # whitespace normalization, SHA-256 hash, embed text construction
├── identity.ts       # UUID5 namespace and chunk id derivation
├── parser.ts         # parser orchestration, section tree, merge/split/overlap
├── atomic-blocks.ts  # CommonMark/GFM atomic block detection and split helpers
├── store.ts          # transactional per-document chunk diff and scheduling plan
└── types.ts          # ChunkParserInput/Output and store diff types
```

### Pattern 1: Pure Parser First

**What:** Parser accepts body text, document id, instance id, title, and params; returns ordered chunk rows without database/provider access. [CITED: requirements §7.2]

**When to use:** All write paths, scanner paths, and later Phase 169 lifecycle dry-run/backfill must reuse the same parser. [CITED: requirements §8.5-§8.6]

**Example:**

```ts
// Source: Context7 /syntax-tree/mdast-util-gfm
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

const tree = fromMarkdown(markdownBody, {
  extensions: [gfm()],
  mdastExtensions: [gfmFromMarkdown()],
});
```

### Pattern 2: Transactional Chunk Store

**What:** `diffAndPersistDocumentChunks` should use `pg` and one explicit transaction for selecting existing chunks, applying inserts/updates, deleting orphans, and returning changed chunk work. [CITED: requirements §6.3.1]

**When to use:** Use after the parent `fqc_documents` row is inserted/updated and before embedding scheduling is considered complete. [VERIFIED: write paths currently update documents before embedding at src/mcp/tools/documents/write.ts:417]

### Pattern 3: Target-Kind Specific Stamping

**What:** Add `document_chunk` target kind and make stamped writes update `embedding_<name>_indexed_at` for chunks instead of generic `updated_at`. [CITED: requirements §6.3.2]

**When to use:** Only for chunk targets; memory and record stamping must preserve their current timestamp behavior. [VERIFIED: src/embedding/background-embed.ts:296]

### Anti-Patterns to Avoid

- **Regex-only markdown chunking:** Existing heading regex ignores some required atomic block semantics; requirements explicitly require CommonMark/GFM-aware behavior. [VERIFIED: src/mcp/utils/markdown-utils.ts:84; CITED: requirements §6.1.4]
- **Embedding unchanged chunks:** Diff by stable ID and `content_hash`; unchanged chunks must not schedule provider calls. [CITED: requirements §6.3.1]
- **Deleting orphans after embeddings:** Orphans must be deleted synchronously in the same transaction as chunk writes to avoid stale semantic rows. [CITED: requirements INV-06]
- **Reusing target kind `document` for chunks:** Pending retry would reconstruct the wrong table/target. [CITED: requirements §6.3.2]
- **Adding `embedding_<name>_indexed_at` to memory/plugin tables:** The timestamp is a chunk column-set requirement only. [CITED: requirements §6.2.2]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CommonMark/GFM parsing | Custom markdown grammar or regex parser | `mdast-util-from-markdown` + GFM extensions | Atomic code/table/list behavior has too many edge cases. [VERIFIED: Context7; CITED: requirements §6.1.4] |
| UUID5 generation | Custom UUID hashing/formatting | Existing `uuid` package | Project already accepts v5 UUIDs and dependency is installed. [VERIFIED: package.json; src/utils/uuid.ts:7] |
| SHA-256 hashing | Custom hash implementation | Node `crypto.createHash('sha256')` | Existing project code uses Node crypto for content hashes. [VERIFIED: src/mcp/utils/document-version.ts:1] |
| Vector SQL escaping | String interpolation of table/column names | Existing `pg.escapeIdentifier` pattern plus validated embedding names | Current code already guards SQL identifiers. [VERIFIED: src/storage/supabase.ts:1028; src/embedding/background-embed.ts:295] |

**Key insight:** the chunk parser should be custom orchestration over a standard markdown AST, not a custom markdown parser. [VERIFIED: Context7; CITED: requirements §6.1.4]

## Existing Code Touchpoints

| Area | Files / Lines | Required Change |
|------|---------------|-----------------|
| Base schema | `src/storage/supabase.ts:355`, `src/storage/supabase.ts:449` | Add `fqc_chunks`; remove fresh document legacy `embedding vector(...)` for chunking deployment; preserve pending queue uniqueness. [VERIFIED: codebase] |
| Core column sets | `src/storage/supabase.ts:1021`, `src/storage/supabase.ts:1144` | Split chunk document columns from memory columns; chunk set has `_indexed_at`; memory set remains five columns. [VERIFIED: codebase; CITED: requirements §7.3] |
| RPC generation | `src/storage/supabase.ts:1093`, `src/storage/supabase.ts:1207` | Stop generating document-content `match_documents_<name>`; generate `match_chunks_<name>`. [VERIFIED: codebase; CITED: requirements §6.2.3] |
| Catalog sync messaging | `src/embedding/embedding-config-sync.ts:102`, `src/embedding/embedding-config-sync.ts:197` | Report affected tables as `fqc_chunks, fqc_memory`; call updated DDL. [VERIFIED: codebase] |
| Foreground embedding | `src/embedding/background-embed.ts:17`, `src/embedding/background-embed.ts:130`, `src/embedding/background-embed.ts:289` | Add `document_chunk` target helper; update stamped writes to use chunk `_indexed_at`. [VERIFIED: codebase] |
| Pending retry | `src/embedding/pending-worker.ts:231`, `src/embedding/pending-worker.ts:287` | Reconstruct `document_chunk` targets and use pending `embed_text`; do not fall back to document title/path for chunks. [VERIFIED: codebase] |
| Scanner | `src/services/scanner.ts:496`, `src/services/scanner.ts:1158` | Replace whole-document enqueue and drain query logic with chunk diff/schedule. [VERIFIED: codebase] |
| Public document writes | `src/mcp/tools/documents/write.ts:246`, `src/mcp/tools/documents/write.ts:429` | After DB row write/update, diff chunks from frontmatter-stripped body and schedule changed chunks. [VERIFIED: codebase] |
| Copy path | `src/mcp/tools/documents/copy.ts:220` | Use same helper after copy insert. [VERIFIED: codebase] |
| Document output stale re-embed | `src/mcp/utils/document-output.ts:476` | Replace whole-document stale re-embed with chunk diff/schedule or defer if path belongs outside Phase 168 plan. [VERIFIED: codebase] |
| Compound paths | `src/mcp/tools/compound.ts` | Requirements list compound write call sites; planner should grep exact post-plan call sites before editing. [CITED: requirements §5.1; VERIFIED: codebase grep] |

## Recommended Plan Decomposition

1. **Parser Wave:** add `src/embedding/chunks/{types,normalize,identity,atomic-blocks,parser}.ts`; install parser packages if accepted; implement T-U-001 through T-U-025. [CITED: test plan §4.1]
2. **Schema/Catalog Wave:** add `fqc_chunks` DDL; rewrite core column-set DDL; add `match_chunks_<name>`; update catalog sync/retire cleanup; implement T-I-001 through T-I-011 and Phase 168 slice of T-I-012/T-I-013. [CITED: test plan §4.2]
3. **Chunk Store Wave:** add `src/embedding/chunks/store.ts` with transactional diff; unit-test classification and transaction planning with T-U-026/T-U-027. [CITED: test plan §4.3.1]
4. **Embedding Target Wave:** add `document_chunk` target, stamped `_indexed_at`, pending retry reconstruction; implement T-U-028 through T-U-030 and T-I-018/T-I-019. [CITED: test plan §4.3.2]
5. **Write Path Wave:** wire create/update/copy/scanner/compound/document-output call sites through store helper; implement T-I-014 through T-I-017 and directed scenarios T-A-001/T-A-002. [CITED: test plan §4.3.1]
6. **Boundary Guard Wave:** add tests/assertions that lifecycle/search APIs still do not claim Phase 169 behavior, while document vectors/RPCs are absent in fresh schema. [VERIFIED: 168-CONTEXT.md; CITED: requirements §6.5.1]

## Common Pitfalls

### Pitfall 1: Parser IDs Change on Body Edits

**What goes wrong:** Body-only edits generate new chunk IDs and orphan old rows unnecessarily. [CITED: requirements §6.1.5]
**How to avoid:** ID input excludes content hash and includes only instance, document, heading path, and chunk index. [CITED: requirements §6.1.5]
**Warning signs:** Unit test T-U-023 fails or body edit creates delete+insert instead of update. [CITED: test plan §4.1.5]

### Pitfall 2: Supabase JS Cannot Express the Needed Transaction Cleanly

**What goes wrong:** Orphan delete and insert/update occur in separate API calls and stale rows are visible on partial failure. [CITED: requirements INV-06]
**How to avoid:** Use `pg` transaction in `store.ts`, matching existing direct-pg patterns for vector writes. [VERIFIED: src/embedding/background-embed.ts:289]
**Warning signs:** T-U-027/T-I-016 can observe stale chunks after a simulated failure. [CITED: test plan §4.3.1]

### Pitfall 3: Column-Set Orphan Detection Misses `_indexed_at`

**What goes wrong:** Startup allows partial chunk column sets or memory table accidentally requires `_indexed_at`. [CITED: requirements §6.2.2]
**How to avoid:** Build separate required column lists for `fqc_chunks` and `fqc_memory`. [VERIFIED: src/storage/supabase.ts:1147]
**Warning signs:** T-I-007 fails or memory/plugin tests see new timestamp columns. [CITED: test plan §4.2.2]

### Pitfall 4: Pending Retry Rebuilds Wrong Text

**What goes wrong:** Worker treats chunk retry as document retry and embeds title/path instead of stored chunk text. [VERIFIED: src/embedding/pending-worker.ts:287]
**How to avoid:** For `document_chunk`, require/use pending `embed_text` or fetch chunk `breadcrumb, content` and rebuild exact embed text. [CITED: requirements §6.3.2]
**Warning signs:** T-U-030 or T-I-018 fails. [CITED: test plan §4.3.2]

### Pitfall 5: Phase Creep Into Search/Lifecycle

**What goes wrong:** Planner schedules `matched_chunks`, RRF aggregation, or lifecycle backfill work in Phase 168. [VERIFIED: 168-CONTEXT.md]
**How to avoid:** Only create chunk RPCs and write pipeline here; leave user-facing search routing and lifecycle response deltas to Phase 169. [VERIFIED: user request; CITED: requirements §8.2]

## Code Examples

### Chunk Hash and Embed Text

```ts
// Source: requirements §6.1.1; Node crypto pattern from src/mcp/utils/document-version.ts
import { createHash } from 'node:crypto';

export function chunkContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function chunkEmbedText(breadcrumb: string, content: string): string {
  return `${breadcrumb}\n\n${content}`;
}
```

### UUID5 Chunk ID

```ts
// Source: requirements §6.1.5; existing uuid dependency
import { v5 as uuidv5 } from 'uuid';

const FLASHQUERY_CHUNKS_NAMESPACE = 'IMPLEMENTATION_MUST_CHOOSE_STABLE_UUID_V5_NAMESPACE';

export function deriveChunkId(input: {
  instanceId: string;
  documentId: string;
  headingPath: string;
  chunkIndex: number;
}): string {
  return uuidv5(
    `${input.instanceId}:${input.documentId}:${input.headingPath}:${input.chunkIndex}`,
    FLASHQUERY_CHUNKS_NAMESPACE
  );
}
```

### Chunk Target Shape

```ts
// Source: requirements §6.3.2; src/embedding/background-embed.ts target pattern
export function documentChunkEmbeddingTarget(input: {
  instanceId: string;
  id: string;
  label?: string;
}): BackgroundEmbeddingTarget {
  return {
    kind: 'document_chunk',
    instanceId: input.instanceId,
    targetTable: 'fqc_chunks',
    targetId: input.id,
    targetLabel: input.label,
  };
}
```

## State of the Art

| Old Approach | Current Phase Approach | When Changed | Impact |
|--------------|------------------------|--------------|--------|
| Whole-document vectors on `fqc_documents` | Chunk rows with vectors on `fqc_chunks` | Phase 168/169 migration, 2026-06-14 docs | Improves retrieval granularity and avoids full-document re-embedding for localized edits. [CITED: requirements §1; ASSUMED for retrieval benefit] |
| `match_documents_<name>` for document semantic search | `match_chunks_<name>` RPC returning chunk and parent metadata | Phase 168 creates RPC, Phase 169 routes search | Phase 168 must not wire final `matched_chunks` response yet. [CITED: requirements §6.2.3; §8.2] |
| Legacy `embedding` column on `fqc_documents` | No document content vector columns on fresh schema | Chunking fresh deployment | Existing document vector cleanup/migration is intentionally not built. [CITED: requirements §6.5.1] |

**Deprecated/outdated:**
- `fqc_documents.embedding_<name>` for document content: must not be created in fresh chunking deployment. [CITED: requirements INV-01]
- `match_documents_<name>` for document content: must not be created for chunked document retrieval. [CITED: requirements §6.2.3]
- Whole-document embed scheduling from write/scanner paths: replace with chunk diff/scheduling. [CITED: requirements §6.3.1]

## Implementation Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Package install churn changes lockfile during planning/execution. | MEDIUM | Install only after package audit checkpoint; include lockfile in implementation commit, not research-only changes. [VERIFIED: local slopcheck behavior] |
| DDL rollback breaks because chunk and memory column sets have different required columns. | HIGH | Create separate DDL builders and preserve transaction wrapping. [VERIFIED: src/storage/supabase.ts:1157] |
| Scanner drain still queries `fqc_documents.embedding IS NULL`. | HIGH | Replace drain query with chunk pending/changed work semantics; add regression around scanner-discovered docs. [VERIFIED: src/services/scanner.ts:1148] |
| Legacy no-catalog provider fallback conflicts with chunk target columns. | MEDIUM | Decide whether legacy unsuffixed document embedding is removed for documents in chunking fresh schema; requirements say per-entry chunks, no document vectors. [CITED: requirements INV-01; REQ-CHUNK-007] |
| `updated_at` gets changed by embedding writes and masks document freshness. | MEDIUM | For chunks, stamp `_indexed_at`; do not use parent document `updated_at` as vector freshness. [CITED: requirements §6.2.2] |
| Atomic block splitting changes markdown syntax. | MEDIUM | Prefer source-position slicing for fitting atomic blocks; only reconstruct oversized blocks with focused tests. [CITED: test plan §4.1.4; ASSUMED] |

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | Existing dev/test DBs may contain legacy document vector columns/RPCs, but requirements define fresh deployment/database wipe rather than migration. [CITED: requirements §3.2; §6.5.1] | No operator migration task in Phase 168; tests may need schema cleanup helpers. [CITED: requirements §6.5.1] |
| Live service config | No external service config is required for chunking itself; embeddings use existing provider config. [VERIFIED: AGENTS.md; package/config inspection] | None beyond existing `.env.test` for integration/scenario tests. [VERIFIED: AGENTS.md] |
| OS-registered state | None found; FlashQuery runs as CLI/MCP subprocess. [VERIFIED: AGENTS.md] | None. |
| Secrets/env vars | `.env.test` is needed for Supabase/integration embeddings; no new secret names required by Phase 168. [VERIFIED: AGENTS.md; tests/scenarios docs] | Do not add new secrets. |
| Build artifacts | `dist/` exists and may be stale after TypeScript changes. [VERIFIED: repo listing] | Run `npm run build` or `npm run typecheck`; do not edit `dist/` manually. [VERIFIED: AGENTS.md] |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | TypeScript runtime/tests | yes | v26.0.0 | Project minimum is >=20. [VERIFIED: command output; AGENTS.md] |
| npm | Package install/test scripts | yes | 11.12.1 | none needed. [VERIFIED: command output] |
| Supabase/Postgres | Integration tests and DDL | not fully probed | env-gated | Tests skip when `.env.test` incomplete. [VERIFIED: AGENTS.md; tests/config/vitest.integration.config.ts] |
| slopcheck | Package legitimacy | yes | CLI present, no `--json` support | Plain output usable. [VERIFIED: command output] |
| `gsd-sdk` | Optional init/commit docs | no | command not found | Research path derived from user request; no GSD commit performed. [VERIFIED: command output] |

**Missing dependencies with no fallback:** none for research. [VERIFIED: environment audit]

**Missing dependencies with fallback:** `gsd-sdk`; fallback is manual file creation at requested path. [VERIFIED: command output]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 for unit/integration; Python scenario runners for directed/integration scenarios. [VERIFIED: package.json; test docs] |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`. [VERIFIED: tests/config/vitest.unit.config.ts:4; tests/config/vitest.integration.config.ts:4] |
| Quick run command | `npm run test:unit -- --run tests/unit/chunk-parser.test.ts tests/unit/chunk-store.test.ts tests/unit/background-embed-helper.test.ts` [CITED: test plan §4.1-§4.3] |
| Full suite command | `npm test && npm run test:integration` [VERIFIED: package.json] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REQ-CHUNK-001 | normalization/hash/embed text | unit | `npm run test:unit -- --run tests/unit/chunk-normalize.test.ts` | no, Wave 0 [CITED: test plan §4.1.1] |
| REQ-CHUNK-002 | heading-aware sections | unit | `npm run test:unit -- --run tests/unit/chunk-parser.test.ts` | no, Wave 0 [CITED: test plan §4.1.2] |
| REQ-CHUNK-003 | merge/split/overlap | unit | `npm run test:unit -- --run tests/unit/chunk-parser.test.ts` | no, Wave 0 [CITED: test plan §4.1.3] |
| REQ-CHUNK-004 | atomic blocks | unit | `npm run test:unit -- --run tests/unit/chunk-atomic-blocks.test.ts` | no, Wave 0 [CITED: test plan §4.1.4] |
| REQ-CHUNK-005 | IDs/parent relationships | unit | `npm run test:unit -- --run tests/unit/chunk-identity.test.ts` | no, Wave 0 [CITED: test plan §4.1.5] |
| REQ-CHUNK-006 | `fqc_chunks` schema | integration | `npm run test:integration -- --run tests/integration/embedding/chunk-schema.test.ts` | no, Wave 0 [CITED: test plan §4.2.1] |
| REQ-CHUNK-007 | chunk column sets | integration | `npm run test:integration -- --run tests/integration/embedding/chunk-column-set.test.ts` | no, Wave 0 [CITED: test plan §4.2.2] |
| REQ-CHUNK-008 | chunk RPCs | integration | `npm run test:integration -- --run tests/integration/embedding/chunk-rpcs.test.ts` | no, Wave 0 [CITED: test plan §4.2.3] |
| REQ-CHUNK-009 | write/scan diff | unit + integration + directed | `npm run test:integration -- --run tests/integration/embedding/chunk-write-roundtrip.test.ts` | no, Wave 0 [CITED: test plan §4.3.1] |
| REQ-CHUNK-010 | chunk pending retry | unit + integration | `npm run test:integration -- --run tests/integration/embedding/chunk-pending-queue.test.ts` | no, Wave 0 [CITED: test plan §4.3.2] |

### Sampling Rate

- **Per task commit:** focused unit or integration file for the touched layer. [VERIFIED: repo test conventions]
- **Per wave merge:** `npm run typecheck` plus all chunk test files for that wave. [VERIFIED: package.json]
- **Phase gate:** `npm test && npm run test:integration`, plus directed scenarios `D-chunk-1` and `D-chunk-2` once authored. [CITED: test plan §4.3.1]

### Wave 0 Gaps

- [ ] `tests/unit/chunk-normalize.test.ts` for T-U-001..T-U-003. [CITED: test plan §4.1.1]
- [ ] `tests/unit/chunk-parser.test.ts` for T-U-004..T-U-014. [CITED: test plan §4.1.2-§4.1.3]
- [ ] `tests/unit/chunk-atomic-blocks.test.ts` for T-U-015..T-U-020. [CITED: test plan §4.1.4]
- [ ] `tests/unit/chunk-identity.test.ts` for T-U-021..T-U-025. [CITED: test plan §4.1.5]
- [ ] `tests/unit/chunk-store.test.ts` for T-U-026..T-U-027. [CITED: test plan §4.3.1]
- [ ] Existing `tests/unit/background-embed-helper.test.ts` must be extended for T-U-028; add or extend `tests/unit/embedding-stamping.test.ts` and `tests/unit/pending-embed-worker.test.ts` for T-U-029..T-U-030. [CITED: test plan §4.3.2; VERIFIED: tests/unit/background-embed-helper.test.ts]
- [ ] `tests/integration/embedding/chunk-schema.test.ts`, `chunk-column-set.test.ts`, `chunk-rpcs.test.ts`, `chunk-write-roundtrip.test.ts`, `chunk-pending-queue.test.ts`. [CITED: test plan §4.2-§4.3]
- [ ] `tests/scenarios/directed/testcases/test_chunk_write_roundtrip.py` and `test_chunk_heading_rename.py`; both need embedding-enabled managed server behavior. [CITED: test plan §4.3.1; VERIFIED: tests/scenarios/directed/WRITING_SCENARIOS.md:141]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no direct change | Existing MCP auth unchanged. [VERIFIED: phase scope] |
| V3 Session Management | no | MCP remains stateless; no server-side session state. [VERIFIED: AGENTS.md] |
| V4 Access Control | yes indirectly | Preserve instance scoping on `fqc_chunks` and RPC filters. [CITED: requirements INV-07; REQ-CHUNK-008] |
| V5 Input Validation | yes | Validate embedding SQL names with existing pattern; use Zod only if parser config is exposed. [VERIFIED: src/storage/supabase.ts:1028; AGENTS.md] |
| V6 Cryptography | yes | Use Node crypto for SHA-256; do not hand-roll hashes. [VERIFIED: src/mcp/utils/document-version.ts:1] |
| V8 Data Protection | yes | Do not leak chunks across instances; document chunks must remain instance-scoped. [CITED: requirements INV-07] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via embedding entry names | Tampering | Keep `validateEmbeddingSqlName` and `pg.escapeIdentifier` for dynamic SQL identifiers. [VERIFIED: src/storage/supabase.ts:1028; src/embedding/background-embed.ts:295] |
| Cross-instance chunk leakage | Information Disclosure | Include `instance_id` in table rows, uniqueness, chunk RPC filters, and DML predicates. [CITED: requirements REQ-CHUNK-006; REQ-CHUNK-008] |
| Stale orphan chunks appearing in search | Information Disclosure / Integrity | Delete orphans synchronously in the chunk diff transaction. [CITED: requirements INV-06] |
| Provider retry text mismatch | Integrity | Persist exact `embed_text` for pending `document_chunk` retries. [CITED: requirements REQ-CHUNK-010] |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `chevrotain` would require too much custom CommonMark/GFM grammar work for this phase. | Alternatives Considered | Planner might prefer reusing an installed parser framework and underestimate grammar complexity. |
| A2 | Source-position slicing will be preferable to AST serialization for many fitting atomic blocks. | Implementation Risks | If mdast positions are insufficient, planner needs a task for `mdast-util-to-markdown`. |
| A3 | Chunking improves retrieval granularity and reduces localized edit re-embedding. | State of the Art | Benefit framing could be overstated, but requirements still mandate the implementation. |

## Open Questions

1. **Exact token estimator**
   - What we know: Requirements specify `min_chunk_tokens`, `max_chunk_tokens`, and breadcrumb budget subtraction. [CITED: requirements §7.2]
   - What's unclear: The repo does not appear to have a tokenizer utility dedicated to embedding-token estimation. [VERIFIED: codebase grep]
   - Recommendation: Plan a simple deterministic approximation first, then fixture-measure and adjust defaults only if tests prove it necessary. [ASSUMED]

2. **Legacy unsuffixed document embedding fallback**
   - What we know: Current code supports legacy no-catalog provider fallback for documents. [VERIFIED: src/embedding/background-embed.ts:219]
   - What's unclear: Chunking requirements focus on catalog entries and fresh schema; they do not define unsuffixed chunk vectors. [CITED: requirements §6.2.2]
   - Recommendation: Treat legacy unsuffixed document embeddings as removed for document content in chunking deployment; preserve memory fallback only if existing tests require it. [ASSUMED]

## Sources

### Primary (HIGH confidence)

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Embedding Chunks Migration (14-Jun-2026)/Embedding Chunks Migration Requirements.md` - authoritative requirements, invariants, architecture, phasing. [CITED]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Embedding Chunks Migration (14-Jun-2026)/Embedding Chunks Migration Test Plan.md` - authoritative tests and coverage IDs. [CITED]
- `AGENTS.md` - project conventions and constraints. [VERIFIED]
- Context7 `/syntax-tree/mdast-util-from-markdown` - parser API and ESM usage. [VERIFIED]
- Context7 `/syntax-tree/mdast-util-gfm` - GFM extension API. [VERIFIED]
- Local code inspection of `src/storage/supabase.ts`, `src/embedding/background-embed.ts`, `src/embedding/pending-worker.ts`, write/scanner files. [VERIFIED]

### Secondary (MEDIUM confidence)

- npm registry metadata for parser packages, `uuid`, `zod`, and `gray-matter`. [VERIFIED]
- slopcheck plain output for parser package legitimacy. [VERIFIED]

### Tertiary (LOW confidence)

- Assumptions in the Assumptions Log. [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH for parser package family and existing repo packages; packages verified with Context7, npm registry, and slopcheck. [VERIFIED]
- Architecture: HIGH for phase scope and data flow; requirements and local code agree. [VERIFIED]
- Pitfalls: HIGH for DDL/write/pending retry risks; MEDIUM for token estimator and AST serialization details. [VERIFIED; ASSUMED where marked]

**Research date:** 2026-06-14 [VERIFIED: local date]
**Valid until:** 2026-07-14 for local architecture; 2026-06-21 for npm package versions. [ASSUMED]

## RESEARCH COMPLETE
