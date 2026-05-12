# Phase 124: Document Write Primitives - Research

**Researched:** 2026-05-12 [VERIFIED: system date]
**Domain:** TypeScript ESM MCP document write handlers, markdown section mutation, tag mutation, Vitest + directed/YAML scenario coverage [VERIFIED: AGENTS.md; .planning/ROADMAP.md]
**Confidence:** HIGH [VERIFIED: product contract + codebase grep + Context7 docs]

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Downstream planning, implementation, review, and verification agents MUST read these two product docs before making requirement or test-scope decisions:
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Requirements.md`
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Test Plan.md`
- If roadmap details and product docs appear to conflict, treat `.planning/ROADMAP.md` as the phase boundary and the two product docs above as the detailed contract inside that boundary.
- Implementation agents should answer their own scope questions from those docs first, then from phase artifacts, before asking the user.
- `write_document` must use required `mode: "create" | "update"` and must not infer mode from parameter presence.
- `write_document(mode: "create")` requires `path` and `title`, permits omitted `content` as an empty body, rejects accidental `identifier`, rejects path conflicts, and rejects FQ-managed/reserved frontmatter fields.
- `write_document(mode: "update")` requires `identifier` and at least one mutable field, rejects `path`, resolves exactly one document, preserves omitted fields, supports frontmatter-only updates, and rejects FQ-managed/reserved frontmatter fields.
- `title` is a convenience for `frontmatter.fq_title`; passing both with different values returns `invalid_input`.
- `write_document(mode: "update", tags)` replaces the tag list. Additive/removal tag edits remain in `apply_tags`.
- `insert_in_doc` is markdown-aware only; it does not support arbitrary line numbers, byte offsets, regex anchors, or string-level edits.
- `insert_in_doc(position: "end_of_section")` must expose `include_nested`; `true` includes child sections and `false` inserts before the first child heading.
- `replace_doc_section` is heading-anchored only; it does not replace arbitrary non-heading ranges.
- `replace_doc_section(content: "")` is the deletion overload and removes the matched heading line; no separate `remove_doc_section` tool is added.
- `apply_tags` uses `targets: [{ entity_type: "document" | "memory", identifier: string }]`, preserves target order, and returns per-element unsupported envelopes for disabled memory targets while document targets still succeed.
- The first implementation task must instantiate a phase-local traceability table mapping DOC-03, DOC-04, DOC-06, DOC-07, and DOC-08 to unit, integration, E2E, directed scenario, and integration scenario evidence.
- Tests must be bundled with implementation and must not be deferred to Phase 128.
- Directed and integration scenario coverage ledgers must be updated before scenario files are changed, following the MCP Tool Consolidation Test Plan ordering rules.
- Legacy behaviors must be ported into final-tool tests before any legacy removal work in later phases.

### the agent's Discretion
- Exact helper/module boundaries may follow existing repo patterns, but shared helpers in `src/mcp/utils/response-formats.ts`, `src/mcp/utils/document-output.ts`, and document-specific helper modules should be preferred over per-tool JSON construction.
- Existing tests may be expanded or split where that reduces fixture complexity.

### Deferred Ideas (OUT OF SCOPE)
- Final host/delegated surface removal of legacy document tools is Phase 128.
- Unified `search` and memory write consolidation are Phase 125.
- `remove_document`, `manage_directory`, and `maintain_vault` are Phase 127.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DOC-03 | `write_document(mode:"create")` replaces `create_document` by creating markdown files from `path`, `title`, optional content, frontmatter, and tags while rejecting conflicts and reserved FQ-managed frontmatter. [VERIFIED: .planning/REQUIREMENTS.md] | Existing `create_document` writes files/DB rows but returns key-value text and allows caller frontmatter before protected overwrite; plan must create final `write_document` schema, conflict handling, reserved-field rejection, JSON identification, and migrated create tests. [VERIFIED: src/mcp/tools/documents.ts; product requirements §4.5] |
| DOC-04 | `write_document(mode:"update")` replaces `update_document` and `update_doc_header` by updating body, title, frontmatter, or tags on one resolved document while preserving omitted fields. [VERIFIED: .planning/REQUIREMENTS.md] | Existing `update_document` already preserves omitted body/title/tags and `update_doc_header` handles frontmatter-only updates, but both return prose/key-value output and expected errors as runtime-style failures; plan must merge semantics under `mode:"update"`. [VERIFIED: src/mcp/tools/documents.ts; src/mcp/tools/compound.ts; product requirements §4.5, §4.15] |
| DOC-06 | `insert_in_doc` supports `include_nested` for `end_of_section`, preserves markdown-aware insertion semantics, and returns document identification plus insertion metadata. [VERIFIED: .planning/REQUIREMENTS.md] | Existing `insert_in_doc` uses `insertAtPosition` and legacy prose output; planner should extend markdown section utilities to accept `include_nested` and return `inserted_at`. [VERIFIED: src/mcp/tools/compound.ts; src/mcp/utils/markdown-sections.ts; product requirements §4.13] |
| DOC-07 | `replace_doc_section` uses explicit `include_nested` semantics, supports empty-string section deletion including the heading line, and returns document identification plus replacement metadata. [VERIFIED: .planning/REQUIREMENTS.md] | Existing `replace_doc_section` uses `include_subheadings`, preserves the heading, returns line range/hash/old content prose, and exposes undo content that the product contract forbids; plan must rename semantics to `include_nested`, implement deletion overload, and remove old-content/hash output. [VERIFIED: src/mcp/tools/compound.ts; product requirements §4.14] |
| DOC-08 | `apply_tags` accepts explicit cross-domain `targets`, returns ordered document/memory identification results, and reports disabled-category failures per target. [VERIFIED: .planning/REQUIREMENTS.md] | Existing `apply_tags` accepts `identifiers` or `memory_id` and returns prose; plan must change input to ordered `targets`, preserve add/remove idempotency, and produce document/memory identification or `unsupported` envelopes in input order. [VERIFIED: src/mcp/tools/compound.ts; product requirements §4.16] |
</phase_requirements>

## Summary

Phase 124 is a consolidation of existing document write behavior into final primitives, not a greenfield tool family. [VERIFIED: .planning/ROADMAP.md; product requirements §4.5, §4.13, §4.14, §4.16] The planner should preserve the current filesystem/DB/git/embedding write paths where they are correct, but replace the public MCP surface, validation, and response envelopes with the Phase 121/123 helper-backed JSON patterns. [VERIFIED: .planning/phases/121-*/121-01-SUMMARY.md; .planning/phases/123-*/123-04-SUMMARY.md; src/mcp/utils/response-formats.ts]

The highest-risk work is not registering tool names; it is semantic parity while removing old response assumptions. [VERIFIED: product test plan §6-§8; rg over tests/scenarios] `write_document` must absorb `create_document`, `update_document`, and `update_doc_header` behavior without keeping parallel legacy tests, while `append_to_doc` behavior ports to `insert_in_doc(position:"bottom")`. [VERIFIED: product test plan §6, §7.2; 124-CONTEXT.md]

**Primary recommendation:** Build a document-write helper layer first, then migrate one primitive at a time with five-layer evidence and scenario coverage-ledger updates before scenario file edits. [VERIFIED: product test plan §7.1; AGENTS.md; prior Phase 123 summary pattern]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| MCP tool schema and handler registration | API / Backend | Frontend Server (MCP stdio process) | FlashQuery registers MCP tools in TypeScript server modules and exposes them through stdio; no browser or web UI is involved. [VERIFIED: AGENTS.md; src/mcp/server.ts; src/mcp/tools/documents.ts] |
| Document creation/update persistence | API / Backend | Database / Storage | Handlers coordinate vault writes, frontmatter, Supabase `fqc_documents`, embeddings, and git policy through existing storage/services. [VERIFIED: src/mcp/tools/documents.ts; src/storage/vault.ts; src/storage/supabase.ts] |
| Markdown-aware section mutation | API / Backend | Database / Storage | Section boundaries are parsed in server utilities and persisted back to vault/DB; callers do not supply line offsets or regex edits. [VERIFIED: src/mcp/utils/markdown-sections.ts; product requirements §4.13-§4.14] |
| Tag mutation across docs/memories | API / Backend | Database / Storage | `apply_tags` updates vault frontmatter for documents and Supabase rows for memories, with ordered per-target results. [VERIFIED: src/mcp/tools/compound.ts; product requirements §4.16] |
| Host/delegated tool exposure metadata | API / Backend | — | `TOOL_METADATA` is the canonical metadata source used by registration and delegated tool selection. [VERIFIED: src/mcp/tool-metadata.ts; Phase 121/122 summaries] |

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20 LTS and TypeScript strict ESM; do not introduce CommonJS. [VERIFIED: AGENTS.md; package.json]
- Use `@modelcontextprotocol/sdk`; do not use nonexistent `@modelcontextprotocol/server`. [VERIFIED: AGENTS.md; package.json]
- Use async/await; MCP tool handlers catch internally and return MCP content with `isError: true` only for runtime failures. [VERIFIED: AGENTS.md; src/mcp/tools/documents.ts]
- Use Zod for external input validation. [VERIFIED: AGENTS.md; current `registerTool` schemas]
- Use `FM.*` constants for managed frontmatter fields and avoid raw `fq_*` literals in implementation code. [VERIFIED: AGENTS.md; src/constants/frontmatter-fields.ts; product requirements checklist]
- Do not build a web UI; this phase is CLI + MCP only. [VERIFIED: AGENTS.md; .planning/ROADMAP.md]
- Unit tests live under `tests/unit`, integration tests under `tests/integration`, E2E tests under `tests/e2e`, directed scenarios under `tests/scenarios/directed`, and YAML integration scenarios under `tests/scenarios/integration`. [VERIFIED: AGENTS.md; repo file listing]
- Integration/E2E tests require `.env.test`; this workspace has `.env.test` present. [VERIFIED: AGENTS.md; shell `test -f .env.test`]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | v24.7.0 installed; project requires >=20 [VERIFIED: `node --version`; package.json] | Runtime for CLI/MCP server [VERIFIED: AGENTS.md] | Existing repo runtime; no alternate runtime should be introduced. [VERIFIED: AGENTS.md] |
| TypeScript | package `^6.0.2`; npm latest 6.0.3 modified 2026-04-16 [VERIFIED: package.json; npm registry] | Strict ESM implementation [VERIFIED: AGENTS.md] | Existing compiler stack; keep source typed and ESM. [VERIFIED: AGENTS.md] |
| `@modelcontextprotocol/sdk` | package `^1.27.1`; npm latest 1.29.0 modified 2026-03-30 [VERIFIED: package.json; npm registry] | MCP server `registerTool` and `CallToolResult` contracts [CITED: Context7 `/modelcontextprotocol/typescript-sdk`] | Official SDK supports Zod input schemas and text-content tool results with `isError`. [CITED: Context7 `/modelcontextprotocol/typescript-sdk`] |
| Zod | package `^4.3.6`; npm latest 4.4.3 modified 2026-05-04 [VERIFIED: package.json; npm registry] | Tool input schema validation [VERIFIED: AGENTS.md; current handlers] | Official docs support object schemas, enums, defaults, strict/loose object behavior, and cross-field validation via refine/superRefine. [CITED: Context7 `/colinhacks/zod`] |
| gray-matter | package `^4.0.3`; npm latest 4.0.3 modified 2023-07-12 [VERIFIED: package.json; npm registry] | Markdown frontmatter parse/stringify [VERIFIED: src/mcp/tools/documents.ts; src/storage/vault.ts] | Existing vault read/write path already depends on it. [VERIFIED: package.json; source grep] |
| `@supabase/supabase-js` | package `^2.100.0` [VERIFIED: package.json] | Document/memory row updates [VERIFIED: src/mcp/tools/documents.ts; src/mcp/tools/compound.ts] | Existing storage manager and tests use Supabase. [VERIFIED: AGENTS.md; tests/integration] |

### Supporting

| Library/Tool | Version | Purpose | When to Use |
|--------------|---------|---------|-------------|
| Vitest | package `^4.1.1`; npm latest 4.1.1 modified 2026-05-11 [VERIFIED: package.json; npm registry] | Unit/integration/E2E test runner [VERIFIED: package.json scripts] | Use for `tests/unit`, `tests/integration`, and `tests/e2e` coverage. [VERIFIED: AGENTS.md] |
| `tsx` | package `^4.21.0` [VERIFIED: package.json] | Development execution [VERIFIED: package.json scripts] | Use via `npm run dev`; do not rely on `npm link`. [VERIFIED: AGENTS.md] |
| `tsup` | package `^8.5.1`; npm latest 8.5.1 modified 2025-11-12 [VERIFIED: package.json; npm registry] | ESM production build [VERIFIED: package.json scripts] | Use `npm run build` as a phase gate. [VERIFIED: AGENTS.md; Phase 123 summaries] |
| Python 3 | 3.12.3 installed [VERIFIED: `python3 --version`] | Directed and YAML scenario runners [VERIFIED: tests/scenarios docs] | Use for `run_suite.py` and `run_integration.py` managed scenario validation. [VERIFIED: project skills; tests/scenarios docs] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Existing MCP SDK + Zod | A custom JSON-RPC server or custom validation | Not allowed by project constraints; would bypass registered tool metadata and current test harness. [VERIFIED: AGENTS.md; Phase 121/122 summaries] |
| Existing markdown utilities | Hand-written ad hoc line slicing inside each tool | Would duplicate existing `extractHeadings`, `getSectionBoundaries`, and `insertAtPosition` logic and risk drift from `get_document.sections`. [VERIFIED: src/mcp/utils/markdown-sections.ts; product requirements §4.13-§4.14] |
| Existing response helpers | Per-tool `JSON.stringify` construction | Product contract requires shared helpers for JSON payloads, error envelopes, and identification blocks. [VERIFIED: product requirements Output Standard Checklist; src/mcp/utils/response-formats.ts] |

**Installation:** No new packages are recommended. [VERIFIED: package.json; product docs]

```bash
npm install
```

## Architecture Patterns

### System Architecture Diagram

```text
MCP client call
  -> tool exposure gate / registered tool catalog
  -> Zod input schema + handler validation
  -> document-write primitive dispatcher
       -> write_document(create)
            -> reject mode/path/frontmatter conflicts
            -> vaultManager.writeMarkdown
            -> fqc_documents insert/update sync
            -> embedding queue
            -> JSON document identification + mode
       -> write_document(update)
            -> resolveDocumentIdentifier
            -> merge body/title/frontmatter/tags while preserving omissions
            -> vaultManager.writeMarkdown
            -> fqc_documents update + embedding when body changes
            -> JSON document identification + mode
       -> insert_in_doc / replace_doc_section
            -> resolve document
            -> markdown heading/boundary calculation
            -> vault/DB update
            -> JSON document identification + mutation metadata
       -> apply_tags
            -> ordered target loop
            -> document path or memory row branch
            -> per-target success/error envelope
  -> MCP text content containing parseable JSON
```

All arrows above reflect existing server-side responsibilities plus product-contract changes; no browser tier participates. [VERIFIED: AGENTS.md; src/mcp/tools/documents.ts; src/mcp/tools/compound.ts; product requirements §4.5, §4.13, §4.14, §4.16]

### Recommended Project Structure

```text
src/
├── mcp/
│   ├── tools/
│   │   ├── documents.ts        # write_document should live with create/update/read document handlers
│   │   └── compound.ts         # existing insert/replace/apply_tags may stay or be split if local patterns permit
│   └── utils/
│       ├── response-formats.ts # JSON, expected-error, identification builders
│       ├── document-output.ts  # read-side envelope helpers reusable for identification/title logic
│       ├── document-write.ts   # recommended helper module for write merge/validation/output assembly
│       └── markdown-sections.ts
tests/
├── unit/
├── integration/
├── e2e/
└── scenarios/
    ├── directed/
    └── integration/
```

This structure extends existing directories and avoids a new framework boundary. [VERIFIED: AGENTS.md; repo file listing; Phase 123 patterns]

### Pattern 1: Helper-Backed JSON Tool Results

**What:** Return MCP text content whose text is JSON, using shared helpers for success and expected errors. [VERIFIED: src/mcp/utils/response-formats.ts]

**When to use:** Every migrated Phase 124 tool response, including expected validation/not-found/conflict/unsupported errors. [VERIFIED: product requirements XC-4/XC-5; test plan §9.5]

**Example:**

```typescript
// Source: src/mcp/utils/response-formats.ts and MCP SDK docs via Context7
return jsonToolResult({
  ...documentIdentification({
    identifier,
    title,
    path,
    fq_id: fqcId,
    modified,
    chars: body.length,
  }),
  mode: 'update',
});

return jsonExpectedError({
  error: 'invalid_input',
  message: 'mode is required; use mode: "create" or mode: "update"',
  identifier,
});
```

### Pattern 2: Resolve Once, Then Preserve Omitted Fields

**What:** For update operations, resolve the existing document, read current frontmatter/body, then apply only supplied mutable fields before writing. [VERIFIED: src/mcp/tools/documents.ts]

**When to use:** `write_document(mode:"update")`, frontmatter-only updates, tag replacement, and body/title updates. [VERIFIED: product requirements §4.5]

**Example:**

```typescript
// Source: existing update_document pattern in src/mcp/tools/documents.ts
const effectiveTitle = title ?? existingTitle;
const effectiveTags = tags ?? existingTags;
const effectiveBody = content ?? existingBody;
const nextFrontmatter = {
  ...existingData,
  ...frontmatter,
  [FM.TITLE]: effectiveTitle,
  [FM.TAGS]: effectiveTags,
  [FM.INSTANCE]: existingData[FM.INSTANCE] ?? config.instance.id,
  [FM.CREATED]: existingData[FM.CREATED],
  [FM.STATUS]: existingData[FM.STATUS] ?? 'active',
};
```

### Pattern 3: Section Boundaries Match `get_document.sections`

**What:** Use heading parsing and section-boundary utilities shared with `get_document`, and expose `heading_match`, `heading_level`, `occurrence`, and `include_nested` validation explicitly. [VERIFIED: src/mcp/utils/markdown-sections.ts; product requirements §4.13-§4.14]

**When to use:** `insert_in_doc(position:"end_of_section")` and all `replace_doc_section` operations. [VERIFIED: product requirements §4.13-§4.14]

**Example:**

```typescript
// Source: src/mcp/utils/markdown-sections.ts, product requirements §4.13-§4.14
const includeNested = include_nested ?? true;
const boundaries = getSectionBoundaries(body, heading, includeNested, occurrence ?? 1);
```

### Pattern 4: Coverage Ledger Before Scenario File Change

**What:** Update `DIRECTED_COVERAGE.md` and `INTEGRATION_COVERAGE.md` rows before modifying Python/YAML scenario files. [VERIFIED: product test plan §7]

**When to use:** Every Phase 124 scenario migration or new scenario row. [VERIFIED: 124-CONTEXT.md]

**Example:**

```text
1. Modify C-01 to state insert_in_doc(position:"bottom") instead of append_to_doc.
2. Modify C-10/C-19/C-20 to state write_document(mode:"update", frontmatter/title/tags).
3. Then update test_content_append_and_insert.py and test_content_frontmatter_ops.py.
```

### Anti-Patterns to Avoid

- **Presence-based create/update inference:** Product contract requires explicit `mode`; do not guess from `path` or `identifier`. [VERIFIED: product requirements XC-15, §4.5]
- **Generic text editor semantics:** Do not add line-number, byte-offset, regex, or arbitrary string replacement to `insert_in_doc` or `replace_doc_section`. [VERIFIED: product requirements §4.13-§4.14]
- **Old prose/key-value output:** Migrated tools must return parseable JSON, not `formatKeyValueEntry` prose. [VERIFIED: product requirements Output Standard Checklist; Phase 123 summaries]
- **Reserved frontmatter writes:** Do not let callers set FQ-managed fields such as `FM.ID`, `FM.INSTANCE`, `FM.CREATED`, `FM.STATUS`, or `FM.ARCHIVED_AT` through `frontmatter`. [VERIFIED: product requirements §4.5; src/constants/frontmatter-fields.ts]
- **Legacy scenario fossils:** Do not keep parallel old-tool tests for merged/removed tools; port active tests to final surfaces. [VERIFIED: product test plan §6-§7]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP response wrapping | Per-handler object-to-text wrappers | `jsonToolResult`, `jsonExpectedError`, `jsonRuntimeError` | Shared helper already encodes Phase 121/123 JSON and expected-error semantics. [VERIFIED: src/mcp/utils/response-formats.ts] |
| Document identification payloads | Repeated `{ identifier, title, path, fq_id }` assembly | `documentIdentification` plus local document-write metadata helper | Required fields and `size.chars` are standardized. [VERIFIED: product requirements per-entity block; src/mcp/utils/response-formats.ts] |
| Frontmatter key names | Raw `fq_*` literals in tool code | `FM.*` constants | Project/product checklists require constants for managed fields. [VERIFIED: AGENTS.md; product requirements checklist] |
| Markdown heading parsing | Regex slices inside handlers | `extractHeadings`, `findHeadingOccurrence`, `getSectionBoundaries`, `insertAtPosition` | Existing utilities align document read and edit section semantics. [VERIFIED: src/mcp/utils/markdown-sections.ts] |
| Tag normalization/dedup | Custom per-tool tag string transforms | Existing tag utilities used by `apply_tags` and document writes | Existing handlers already normalize, validate, deduplicate, and sync tags. [VERIFIED: src/mcp/tools/compound.ts; src/utils/tag-validator.ts via imports] |
| Scenario runner behavior | New bespoke scenario harness | Existing directed and YAML scenario frameworks | Project skills and docs define current runners, cleanup, managed mode, and coverage ledgers. [VERIFIED: .agents/skills/*testgen/SKILL.md; tests/scenarios docs] |

**Key insight:** The hard part is aligning public contracts and tests with existing storage behavior; custom helper rewrites increase drift risk and make Phase 128 removal audits harder. [VERIFIED: product test plan §6-§9; Phase 123 summaries]

## Common Pitfalls

### Pitfall 1: Treating Expected Errors As Runtime Failures
**What goes wrong:** Validation, not-found, conflict, or unsupported results return `isError:true` and prose. [VERIFIED: existing legacy handlers; product requirements XC-5]
**Why it happens:** Legacy handlers predate Phase 121 JSON helpers. [VERIFIED: src/mcp/tools/documents.ts; src/mcp/tools/compound.ts]
**How to avoid:** Use `jsonExpectedError` for canonical expected envelopes and reserve `jsonRuntimeError`/`isError:true` for internal exceptions. [VERIFIED: src/mcp/utils/response-formats.ts; Context7 MCP SDK docs]
**Warning signs:** Tests parse `Error:` strings or expect `isError:true` for user-correctable input. [VERIFIED: tests/unit/create-document.test.ts; tests/unit/update-document.test.ts]

### Pitfall 2: Accidentally Allowing Managed Frontmatter Overrides
**What goes wrong:** `frontmatter` can overwrite identity/status/instance/archive fields or title conflicts are silently resolved. [VERIFIED: existing merge patterns; product requirements §4.5]
**Why it happens:** Existing create/update handlers merge caller frontmatter and then overwrite protected fields rather than rejecting them. [VERIFIED: src/mcp/tools/documents.ts]
**How to avoid:** Add one reserved-field validator used by create and update before writing; also reject conflicting `title` vs `frontmatter[FM.TITLE]`. [VERIFIED: product requirements §4.5]
**Warning signs:** Unit tests only verify protected fields win, not that the call returns `invalid_input`. [VERIFIED: tests/unit/create-document.test.ts; product test plan §4.2]

### Pitfall 3: Breaking Frontmatter-Only Update Behavior
**What goes wrong:** `write_document(mode:"update", frontmatter)` rewrites or clears the body when `content` is omitted. [VERIFIED: product requirements §4.5, §4.15]
**Why it happens:** Create/update merger logic can accidentally treat omitted content as empty content. [VERIFIED: product requirements §4.5]
**How to avoid:** Distinguish `content === undefined` from `content === ""`; omitted preserves body, empty string intentionally sets empty body. [VERIFIED: product test plan §4.2]
**Warning signs:** Tests cover body updates but not body preservation after frontmatter-only update. [VERIFIED: product test plan I4]

### Pitfall 4: Misinterpreting `include_nested:false`
**What goes wrong:** End-of-section insertion or section replacement still includes child sections. [VERIFIED: current `insertAtPosition` lacks include_nested parameter; product requirements §4.13-§4.14]
**Why it happens:** Existing utility parameter is named `includeSubheadings` and existing `insert_in_doc` cannot pass it. [VERIFIED: src/mcp/utils/markdown-sections.ts; src/mcp/tools/compound.ts]
**How to avoid:** Extend helper signatures or add a wrapper that calculates direct-body boundaries before writing; add fixtures with parent, direct body, child heading, and following peer heading. [VERIFIED: product requirements examples]
**Warning signs:** Tests only use bottom/top/before/after positions or only `include_nested:true`. [VERIFIED: product test plan §5.3]

### Pitfall 5: Scenario Coverage Drift
**What goes wrong:** Scenario files still call `create_document`, `update_document`, `append_to_doc`, or `update_doc_header` after final-tool tests are added. [VERIFIED: rg over tests/scenarios]
**Why it happens:** Existing scenario files and coverage rows predate tool consolidation. [VERIFIED: tests/scenarios/directed/DIRECTED_COVERAGE.md; tests/scenarios/integration/INTEGRATION_COVERAGE.md]
**How to avoid:** Update coverage rows first, then port scenario files, and include greps for removed old-tool references scoped to active Phase 124 files. [VERIFIED: product test plan §7]
**Warning signs:** `DIRECTED_COVERAGE.md` rows C-01/C-10/C-19/C-20 still name old tools, or YAML actions still use `update_document`/`append_to_doc`. [VERIFIED: rg output]

## Code Examples

### Final `write_document` Validation Shape

```typescript
// Source: product requirements §4.5 + Zod v4 docs via Context7
const WriteDocumentSchema = z.object({
  mode: z.enum(['create', 'update']),
  path: z.string().optional(),
  identifier: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  frontmatter: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
}).superRefine((value, ctx) => {
  if (value.mode === 'create') {
    // require path/title, reject identifier
  }
  if (value.mode === 'update') {
    // require identifier, reject path, require one mutable field
  }
});
```

### Ordered `apply_tags` Result Loop

```typescript
// Source: product requirements §4.16 + existing apply_tags order-preserving loop
const results = [];
for (const target of targets) {
  if (target.entity_type === 'memory' && memoryCategoryDisabled) {
    results.push({
      error: 'unsupported',
      message: 'Memory category is disabled by config',
      identifier: target.identifier,
      details: { disabled_category: 'memory' },
    });
    continue;
  }
  results.push(await applyTagsToOneTarget(target));
}
return jsonToolResult(results);
```

### Section Mutation Metadata

```typescript
// Source: product requirements §4.13-§4.14
return jsonToolResult({
  ...documentIdentification(doc),
  inserted_at: {
    position,
    heading,
    heading_match,
    heading_level,
    occurrence,
    include_nested: includeNested,
  },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Key-value/prose MCP responses | JSON text content plus structured expected-error envelopes | Phase 121 foundation and Phase 123 document read migration [VERIFIED: Phase 121/123 summaries] | Phase 124 should not introduce new prose output. [VERIFIED: product output checklist] |
| Separate `create_document` / `update_document` / `update_doc_header` | `write_document(mode:"create"|"update")` | Product consolidation contract dated 2026-05-11 [VERIFIED: 124-CONTEXT.md; product requirements §4.5] | Tests must move to final mode-based surface before later legacy removal. [VERIFIED: product test plan §6] |
| `append_to_doc` | `insert_in_doc(position:"bottom")` | Product consolidation contract dated 2026-05-11 [VERIFIED: product requirements §4.4; test plan §6] | Append scenarios should be ported, not duplicated. [VERIFIED: product test plan §7.2] |
| `include_subheadings` on replacement | `include_nested` aligned with `get_document` | Product consolidation contract dated 2026-05-11 [VERIFIED: product requirements §4.14] | Tool schema and tests must use `include_nested`; old name should not be the final public parameter. [VERIFIED: product requirements §4.14] |

**Deprecated/outdated:**
- `formatKeyValueEntry` response assertions for Phase 124 tools are outdated for final output, though the helper remains for unmigrated legacy tools. [VERIFIED: src/mcp/utils/response-formats.ts; product output checklist]
- `apply_tags` `identifiers`/`memory_id` input shape is outdated for final contract; use explicit ordered `targets`. [VERIFIED: src/mcp/tools/compound.ts; product requirements §4.16]
- Scenario shorthand `vault.write` currently maps to `create_document`; Phase 124 scenario plans must either update runner shortcuts or use explicit `write_document` calls. [VERIFIED: tests/scenarios/integration/README.md; product test plan §7]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Codebase-specific findings remain valid until touched by later phases. [ASSUMED] | Metadata | Planner may rely on stale code locations if another phase edits the same files before Phase 124 execution. |

## Open Questions (RESOLVED)

1. **Should legacy Phase 124 tools remain registered after this phase?**
   - What we know: Phase 124 success criterion says legacy behavior is ported before legacy tools are removed later, and Phase 128 owns final absence audit. [VERIFIED: .planning/ROADMAP.md; 124-CONTEXT.md]
   - Resolution: Phase 124 should add final tools and final tests while leaving final legacy removal and absence assertions to Phase 128. This follows the roadmap success criterion that legacy behavior is ported before those tools are removed later. [VERIFIED: .planning/ROADMAP.md; 124-CONTEXT.md]

2. **How should host category-disabled `apply_tags` be tested without final Phase 125 memory surfaces?**
   - What we know: `apply_tags` belongs to `doc-write` and can target memories; when memory is disabled, memory target positions return `unsupported`. [VERIFIED: product requirements §4.16 and §3.10.2 excerpt]
   - Resolution: Use Phase 122 host-filtered config patterns and direct handler/unit tests as the required coverage for disabled-memory behavior. Add managed scenario coverage only if the existing runner can start with a doc-write-enabled, memory-disabled host selector config without introducing new harness infrastructure. [VERIFIED: Phase 122 summaries; tests/scenarios docs]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build, Vitest, MCP server | yes [VERIFIED: shell] | v24.7.0 [VERIFIED: shell] | Project minimum is Node >=20. [VERIFIED: package.json] |
| npm | Package scripts and version checks | yes [VERIFIED: shell] | 11.5.1 [VERIFIED: shell] | — |
| Python 3 | Directed/YAML scenarios | yes [VERIFIED: shell] | 3.12.3 [VERIFIED: shell] | — |
| Git | Scenario git tests and commits | yes [VERIFIED: shell] | 2.50.1 Apple Git-155 [VERIFIED: shell] | — |
| `.env.test` | Integration/E2E/Supabase-backed tests | yes [VERIFIED: shell] | present [VERIFIED: shell] | Tests skip gracefully when incomplete per AGENTS.md. [VERIFIED: AGENTS.md] |
| `psql` CLI | Optional DB debugging | no [VERIFIED: shell] | — | Use Supabase client tests and scenario dbtools where available. [VERIFIED: tests/scenarios/dbtools] |
| Docker CLI | Optional local service/container workflows | no [VERIFIED: shell] | — | Use existing `.env.test` hosted/local Supabase config. [VERIFIED: AGENTS.md] |
| `gsd-sdk` | Phase init/commit workflow | yes [VERIFIED: shell] | v1.41.2 [VERIFIED: shell] | — |

**Missing dependencies with no fallback:**
- None identified for planning or normal Phase 124 implementation. [VERIFIED: environment audit]

**Missing dependencies with fallback:**
- `psql` and Docker are missing, but standard Vitest/scenario commands can use `.env.test` and project Supabase helpers. [VERIFIED: environment audit; AGENTS.md]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.1` plus Python directed/YAML scenario runners. [VERIFIED: package.json; tests/scenarios docs] |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts`. [VERIFIED: repo file listing] |
| Quick run command | `npm test -- tests/unit/write-document.test.ts tests/unit/response-formats.test.ts tests/unit/tool-metadata.test.ts` [VERIFIED: package scripts; planned file may be Wave 0] |
| Full suite command | `npm run build && npm test && npm run test:integration && npm run test:e2e` plus focused directed/YAML scenario commands. [VERIFIED: package scripts; roadmap validation contract] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| DOC-03 | `write_document(create)` create/conflict/identifier/reserved fields/title/frontmatter conflict/JSON output | unit + integration + E2E + scenarios | `npm test -- tests/unit/write-document.test.ts`; `npm run test:integration -- tests/integration/documents.integration.test.ts`; `npm run test:e2e -- tests/e2e/protocol.test.ts` [VERIFIED: package scripts] | No, Wave 0 for `write-document.test.ts`; integration/E2E files exist. [VERIFIED: repo file listing] |
| DOC-04 | `write_document(update)` preserves omitted fields, frontmatter-only update, tag replacement, not-found expected error | unit + integration + E2E + scenarios | same focused Vitest commands plus scenario commands [VERIFIED: roadmap validation contract] | No final tests yet; legacy update tests exist. [VERIFIED: tests/unit/update-document.test.ts; rg] |
| DOC-06 | `insert_in_doc` positions, `include_nested`, append port, `inserted_at` metadata | unit + integration + directed/YAML scenarios | `npm test -- tests/unit/insert-in-doc.test.ts`; `python3 tests/scenarios/directed/run_suite.py --managed content_append_and_insert` [VERIFIED: scenario docs] | No final unit file; legacy scenario exists. [VERIFIED: rg; repo file listing] |
| DOC-07 | `replace_doc_section` include/exclude nested, empty deletion, `extracted_section` metadata, no old content/hash output | unit + integration + directed/YAML scenarios | `npm test -- tests/unit/replace-doc-section.test.ts`; `python3 tests/scenarios/integration/run_integration.py --managed replace_section` [VERIFIED: scenario docs; repo file listing] | No final unit file; legacy YAML exists. [VERIFIED: repo file listing] |
| DOC-08 | `apply_tags` ordered targets, doc/memory identification, disabled memory per-element unsupported | unit + integration + E2E + scenarios | `npm test -- tests/unit/apply-tags.test.ts`; `npm run test:integration -- tests/integration/apply-tags.test.ts` [VERIFIED: package scripts; existing file] | Existing integration file uses legacy shape and must be ported. [VERIFIED: tests/integration/apply-tags.test.ts] |

### Sampling Rate

- **Per task commit:** Run the focused unit file(s) for the primitive being changed plus `tests/unit/tool-metadata.test.ts` when metadata changes. [VERIFIED: Phase 123 execution pattern]
- **Per wave merge:** Run focused unit + integration + E2E command for touched tools. [VERIFIED: roadmap validation contract]
- **Phase gate:** Run `npm run build`, focused scenario commands, and greps for active old-tool scenario calls migrated by this phase. [VERIFIED: product test plan §7; Phase 123 summaries]

### Wave 0 Gaps

- [ ] `.planning/phases/124-document-write-primitives/TRACEABILITY.md` — maps DOC-03/DOC-04/DOC-06/DOC-07/DOC-08 to five-layer evidence. [VERIFIED: 124-CONTEXT.md]
- [ ] `tests/unit/write-document.test.ts` — final create/update validation and JSON output. [VERIFIED: product test plan §4.2]
- [ ] `tests/unit/insert-in-doc.test.ts` — final insertion validation/output contract. [VERIFIED: product test plan §5.3]
- [ ] `tests/unit/replace-doc-section.test.ts` — final replacement/deletion validation/output contract. [VERIFIED: product test plan §5.3]
- [ ] `tests/unit/apply-tags.test.ts` — final target schema/order/disabled-domain behavior. [VERIFIED: product test plan §5.3]
- [ ] Scenario coverage ledger updates in `tests/scenarios/directed/DIRECTED_COVERAGE.md` and `tests/scenarios/integration/INTEGRATION_COVERAGE.md` before scenario file edits. [VERIFIED: product test plan §7]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no for Phase 124 handler internals | MCP auth exists elsewhere; this phase does not change auth. [VERIFIED: AGENTS.md file organization; phase scope] |
| V3 Session Management | no | MCP is stateless and project context is per-call. [VERIFIED: AGENTS.md] |
| V4 Access Control | yes | Host tool exposure gates registration/listTools; `apply_tags` disabled memory behavior must honor category degradation rules. [VERIFIED: Phase 122 summaries; product requirements §4.16] |
| V5 Input Validation | yes | Zod schemas plus explicit mode/target/frontmatter validators; canonical `invalid_input` envelopes. [VERIFIED: AGENTS.md; product requirements XC-4/XC-15] |
| V6 Cryptography | no new crypto | Existing hash/UUID usage remains implementation detail; do not add custom cryptography. [VERIFIED: phase scope; source grep] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal on create/update destinations | Tampering | Reuse resolve+relative vault-root guard patterns from existing document tools. [VERIFIED: src/mcp/tools/documents.ts] |
| Reserved frontmatter override (`fq_id`, instance, status, archive fields) | Tampering / Spoofing | Reject managed fields before write using `FM.*` constants and canonical `invalid_input`. [VERIFIED: product requirements §4.5; src/constants/frontmatter-fields.ts] |
| Ambiguous filename mutation | Tampering | Resolve exactly one document and return canonical `ambiguous_identifier` where applicable. [VERIFIED: src/mcp/utils/resolve-document.ts; product requirements XC-4] |
| Lock contention during writes | Denial of Service / Race | Existing document lock path should return canonical `conflict` with `details.reason:"lock_contention"` for migrated tools. [VERIFIED: product requirements XC-4; src/services/write-lock.ts usage] |
| Disabled category leakage through `apply_tags` | Information Disclosure / Access Control | Keep document targets successful and return per-memory `unsupported` envelopes when memory category is disabled. [VERIFIED: product requirements §4.16] |

## Sources

### Primary (HIGH confidence)
- `.planning/phases/124-document-write-primitives/124-CONTEXT.md` — locked scope and user decisions. [VERIFIED: file read]
- `.planning/REQUIREMENTS.md` — DOC-03, DOC-04, DOC-06, DOC-07, DOC-08. [VERIFIED: file read]
- `.planning/ROADMAP.md` — Phase 124 boundary, dependency, and validation contract. [VERIFIED: file read]
- Product requirements doc §2, §4.5, §4.13, §4.14, §4.16 — final tool contracts and cross-cutting decisions. [VERIFIED: file read]
- Product test plan §4.2, §5.3, §6, §7, §9.5 — five-layer and scenario migration contract. [VERIFIED: file read]
- `src/mcp/tools/documents.ts`, `src/mcp/tools/compound.ts`, `src/mcp/utils/response-formats.ts`, `src/mcp/utils/markdown-sections.ts`, `src/mcp/tool-metadata.ts` — current implementation patterns and gaps. [VERIFIED: code grep/read]
- Context7 `/modelcontextprotocol/typescript-sdk` — `registerTool`, Zod input schemas, text content, `isError`. [CITED: Context7]
- Context7 `/colinhacks/zod` — Zod object/enums/defaults/refine/superRefine. [CITED: Context7]
- npm registry — package latest versions for MCP SDK, Zod, Vitest, TypeScript, tsup, gray-matter, js-yaml. [VERIFIED: npm view]

### Secondary (MEDIUM confidence)
- Prior Phase 121/122/123 summaries — established local migration patterns and validation cadence. [VERIFIED: file read]
- Project-local FlashQuery scenario skills and docs — current scenario authoring/running conventions. [VERIFIED: .agents/skills reads; tests/scenarios docs]

### Tertiary (LOW confidence)
- None. [VERIFIED: all cited claims trace to read files, registry, Context7, or shell probes]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — package versions were checked against `package.json` and npm registry; docs checked via Context7. [VERIFIED: package.json; npm registry; Context7]
- Architecture: HIGH — implementation locations and helper APIs were verified in source. [VERIFIED: code grep/read]
- Pitfalls: HIGH — derived from product contract differences versus current handlers/tests. [VERIFIED: product docs; source/tests grep]

**Research date:** 2026-05-12 [VERIFIED: system date]
**Valid until:** 2026-05-19 for npm/version-specific details; codebase-specific findings remain valid until touched by later phases. [ASSUMED]
