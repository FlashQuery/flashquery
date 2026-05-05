# Phase 114: Template Parameterization - Research

**Researched:** 2026-05-05  
**Domain:** FlashQuery `call_model` reference hydration, template parameters, alias/list injection, TypeScript/Vitest scenario validation  
**Confidence:** HIGH

## User Constraints

No `114-CONTEXT.md` exists for this phase, so there are no phase-specific locked decisions, discretion notes, or deferred ideas to copy. [VERIFIED: `gsd-sdk query init.phase-op 114`; `.planning/phases/114-template-parameterization` file listing]

## Summary

Phase 114 should extend the existing Phase 113 reference resolver rather than create a parallel template resolver: the product DRS explicitly defines references and templates as one mechanism, where templates are documents with `fq_template: true`, frontmatter-declared params, and body placeholders. [CITED: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/Document Reference System.md` §1, §5.2] The current code already has host-only scanning, alias parsing, escape parity, failure constants, non-recursive hydration, and `call_model` fail-fast handling in place. [VERIFIED: `src/llm/reference-resolver.ts`; `src/mcp/tools/llm.ts`; `src/constants/reference-failures.ts`]

The high-risk planning boundary is metadata and failure semantics, not raw substitution. Phase 114 must add `template_params` to the `call_model` input, pass it into resolution, read resolved document frontmatter to decide template vs plain document behavior, validate `string` and `document` parameters, perform single-pass placeholder substitution with escape parity, and preserve ordered `_items` list metadata. [CITED: DRS §5.2-§5.6, §8.1-§9.2] Plain documents must ignore irrelevant template params, while templates with missing required values must fail before LLM dispatch. [CITED: DRS §5.2, §8.2]

**Primary recommendation:** implement `src/llm/reference-resolver.ts` as the owner of template rendering and alias/list expansion, keep `src/mcp/tools/llm.ts` limited to schema/wiring/fail-fast response aggregation, and put unit coverage around resolver pure logic before adding integration and managed directed public scenarios. [VERIFIED: `src/llm/reference-resolver.ts`; `src/mcp/tools/llm.ts`; `tests/unit/reference-resolver.test.ts`; `tests/scenarios/directed/testcases/test_call_model_reference_system_core.py`]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| `template_params` input admission | API / Backend | — | MCP `call_model` is registered server-side and uses Zod schemas for external input. [VERIFIED: `src/mcp/tools/llm.ts`; CITED: Context7 `/modelcontextprotocol/typescript-sdk`] |
| Host-only reference/template hydration | API / Backend | Database / Storage | `call_model` filters system/user messages, resolver reads vault files and Supabase document rows, then dispatches hydrated messages to the LLM client. [VERIFIED: `src/mcp/tools/llm.ts`; `src/llm/reference-resolver.ts`; `src/mcp/utils/document-output.ts`] |
| Template/frontmatter parsing | API / Backend | Database / Storage | `gray-matter` is already used to parse vault markdown frontmatter in document utilities and integration tests. [VERIFIED: `src/mcp/utils/document-output.ts`; `src/mcp/utils/resolve-document.ts`; `tests/integration/reference-resolver.integration.test.ts`] |
| Document parameter resolution | API / Backend | Database / Storage | `type: "document"` params must use the standard identifier ladder backed by Supabase and vault reads. [CITED: DRS §5.4; VERIFIED: `src/mcp/utils/resolve-document.ts`] |
| `_items` ordered alias injection | API / Backend | — | List expansion is pre-provider prompt assembly and must preserve input order and separator-inclusive metadata. [CITED: DRS §5.3, §9.1] |
| Public behavior validation | API / Backend | External mock provider | Managed directed scenarios already validate `call_model` public behavior through a deterministic OpenAI-compatible mock. [VERIFIED: `tests/scenarios/directed/testcases/test_call_model_reference_system_core.py`; `113-04-SUMMARY.md`] |

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20 LTS; current local Node is v24.7.0. [VERIFIED: AGENTS.md; `node --version`]
- TypeScript strict mode and ESM are the project norms; do not introduce CommonJS `require`. [VERIFIED: AGENTS.md; `package.json`]
- Use `@modelcontextprotocol/sdk`, not `@modelcontextprotocol/server`. [VERIFIED: AGENTS.md; `package.json`; npm registry]
- Use Zod for external input validation, including MCP params. [VERIFIED: AGENTS.md; `src/mcp/tools/llm.ts`; CITED: Context7 `/colinhacks/zod`]
- MCP tool handlers return text content and set `isError: true` on failure. [VERIFIED: AGENTS.md; `src/mcp/tools/llm.ts`; CITED: Context7 `/modelcontextprotocol/typescript-sdk`]
- Do not build a web UI; FlashQuery is CLI + MCP only. [VERIFIED: AGENTS.md]
- Do not implement server-side session state; MCP is stateless and project context is per call. [VERIFIED: AGENTS.md]
- Unit tests live under `tests/unit/*.test.ts`; integration tests under `tests/integration/*.test.ts`; directed scenarios under `tests/scenarios/directed/testcases/`; YAML integration tests under `tests/scenarios/integration/tests/`. [VERIFIED: AGENTS.md; test directory listing]
- Integration/E2E tests read `.env.test`; tests requiring Supabase skip gracefully when test credentials are incomplete. [VERIFIED: AGENTS.md; `tests/helpers/test-env.ts`]
- Local development should use `npm run dev` or built `node dist/index.js`; never use `npm link`. [VERIFIED: AGENTS.md]

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TMPL-01 | Vault documents with `fq_template: true` are parameterizable; plain docs remain plain references. | DRS says only explicit `fq_template: true` marks templates and non-template docs ignore params. [CITED: DRS §5.2, §6.1-§6.3] |
| TMPL-02 | `call_model.template_params` supports path-keyed params and alias-keyed entries with `_template`. | DRS defines path-keyed `template_params` and alias `_template` mode. [CITED: DRS §5.2-§5.3] |
| TMPL-03 | Parameters support `string` and `document`, required/default validation, identifier resolution, and typed failures. | DRS defines param types, validation order, and `template_*` failure reasons. [CITED: DRS §5.4-§5.5, §8.2] |
| TMPL-04 | Placeholder substitution is deterministic, single-pass, non-recursive, and supports escape parity. | DRS §5.6 defines placeholder regex, escapes, no fan-out, and no caching. [CITED: DRS §5.6] |
| TMPL-05 | Alias entries support `_items` lists with optional `_separator`, ordered injection, and metadata. | DRS list-mode rules and metadata contract define `_items`, `_separator`, `resolved_to_count`, and ordered `items[]`. [CITED: DRS §5.3, §9.1] |
| VAL-114 | Phase ships runnable unit, directed, and integration tests for template behavior. | ATL test plan names ATL-U-05, ATL-U-06, ATL-DS-04 through ATL-DS-06, ATL-I-04, ATL-INT-02, and ATL-INT-05 coverage areas. [CITED: ATL Test Plan rows ATL-U/ATL-I/ATL-DS/ATL-INT] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | package `^6.0.2`; npm current `6.0.3`, modified 2026-04-16 | Strict ESM source types and compile-time contracts | Project is strict TypeScript/ESM and already uses `tsup` build. [VERIFIED: `package.json`; npm registry] |
| Zod | package `^4.3.6`; npm current `4.4.3`, modified 2026-05-04 | Validate `call_model.template_params` as external MCP input | Project requires Zod for external params; Zod supports `object`, `record`, `safeParse`, defaults, and discriminated validation patterns. [VERIFIED: `package.json`; AGENTS.md; CITED: Context7 `/colinhacks/zod`] |
| @modelcontextprotocol/sdk | package `^1.27.1`; npm current `1.29.0`, modified 2026-03-30 | MCP server `registerTool` schema and tool result contract | Project uses this package; official SDK docs show `registerTool`, Zod schemas, text content, and `isError: true`. [VERIFIED: `package.json`; npm registry; CITED: Context7 `/modelcontextprotocol/typescript-sdk`] |
| gray-matter | package/current `4.0.3`, modified 2023-07-12 | Parse YAML frontmatter and markdown body from vault templates | Existing document resolution utilities and tests use `matter(raw)` / `matter.stringify`. [VERIFIED: `package.json`; `src/mcp/utils/document-output.ts`; `tests/integration/reference-resolver.integration.test.ts`; npm registry] |
| Vitest | package `^4.1.1`; npm current `4.1.5`, modified 2026-05-05 | Unit/integration test runner | Existing unit and integration configs are Vitest, with dedicated unit/integration configs. [VERIFIED: `package.json`; `tests/config/vitest.unit.config.ts`; `tests/config/vitest.integration.config.ts`; npm registry] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Supabase JS | package `^2.100.0` | Resolve document IDs/paths through `fqc_documents` | Required for real-vault integration tests and production identifier resolution. [VERIFIED: `package.json`; `src/mcp/utils/resolve-document.ts`] |
| Node `fs/promises` + `path` | Node v24.7.0 local; project requires >=20 | Read resolved template/document files | Existing resolver utilities use `readFile`, `mkdir`, `join`, `dirname`. [VERIFIED: `src/mcp/utils/document-output.ts`; `tests/integration/reference-resolver.integration.test.ts`; `node --version`] |
| Python directed framework | Python 3.12.3 local | Managed public MCP scenario tests | Existing Phase 113 scenario starts an FQC subprocess and mock provider. [VERIFIED: `python3 --version`; `tests/scenarios/directed/testcases/test_call_model_reference_system_core.py`] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `gray-matter` frontmatter parsing | Manual YAML/string splitting | Do not hand-roll; existing code already parses frontmatter consistently with `gray-matter`. [VERIFIED: codebase grep] |
| Existing `resolveAndBuildDocument` + `resolveDocumentIdentifier` | New resolver stack | Do not fork document identity logic; standard ladder and error mapping already exist. [VERIFIED: `src/mcp/utils/document-output.ts`; `src/mcp/utils/resolve-document.ts`; CITED: DRS §4.4] |
| Position-aware single-pass replacement | `replaceAll` or repeated regex loops | `replaceAll` breaks duplicate placeholders with different values and recursive-scan guarantees. [VERIFIED: `hydrateMessages` implementation/tests; CITED: DRS §5.6] |

**Installation:**
```bash
npm install
```

No new runtime package is required for Phase 114 if it uses existing Zod, gray-matter, Supabase, and Vitest dependencies. [VERIFIED: `package.json`; source inspection]

**Version verification:** Versions were checked with:
```bash
npm view @modelcontextprotocol/sdk version time.modified
npm view zod version time.modified
npm view gray-matter version time.modified
npm view vitest version time.modified
npm view typescript version time.modified
```
[VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```text
MCP host call_model input
  |
  | resolver=model/purpose, host-authored system/user messages, template_params
  v
src/mcp/tools/llm.ts
  |-- discovery resolvers return before hydration
  |-- schema/body guards validate name/messages/template_params shape
  |-- extracts host-only scan targets
  v
src/llm/reference-resolver.ts
  |-- scan active/escaped {{ref:...}} spans
  |-- parse early refs and @ aliases
  |-- for each active ref:
        |-- early path/fq_id/filename -> resolveAndBuildDocument
        |-- @ alias -> template_params entry -> _template or _items
        |-- read frontmatter/body through existing document pipeline
        |-- fq_template true? validate/default/resolve params -> substitute once
        |-- plain doc? ignore template params -> body/section/pointer content
  |-- aggregate resolved refs or typed FailedRef entries
  v
Fail path? reference_resolution_failed, failed_references[], no LLM call
  |
  v
Success path: hydrateMessages position-aware, compute prompt_chars, build metadata
  |
  v
llmClient.complete / completeByPurpose
  |
  v
CallModelEnvelope with response, optional return_messages, metadata.injected_references
```

### Recommended Project Structure

```text
src/
├── constants/
│   ├── reference-failures.ts        # existing stable failure reasons; add warning constants if implemented
│   └── frontmatter-fields.ts        # existing managed fq_* fields; do not force user-authored fq_template here unless needed
├── llm/
│   ├── reference-resolver.ts        # extend with template/alias/list resolution and metadata
│   └── types.ts                     # extend CallModelMetadata injected_references item shape
├── mcp/
│   └── tools/
│       └── llm.ts                   # add template_params schema/wiring only
└── mcp/utils/
    ├── document-output.ts           # reuse shared document resolution pipeline
    └── resolve-document.ts          # reuse identifier ladder and typed ambiguity/not-found errors
tests/
├── unit/reference-resolver.test.ts  # template validation/substitution/list tests
├── unit/llm-tool.test.ts            # call_model schema/wiring/fail-fast tests
├── integration/reference-resolver.integration.test.ts or template-resolver.integration.test.ts
└── scenarios/directed/testcases/test_call_model_template_parameterization.py
```
[VERIFIED: source/test structure; AGENTS.md]

### Pattern 1: Additive `call_model` Schema Wiring

**What:** Add optional `template_params: z.record(z.string(), z.record(z.string(), z.unknown())).optional()` or an equivalent permissive Zod shape to `call_model` input, then pass it to `resolveReferences`. [VERIFIED: `src/mcp/tools/llm.ts`; CITED: Context7 `/colinhacks/zod`]

**When to use:** Use this for MCP boundary admission; deeper semantic validation belongs after the resolver reads the target template's `fq_params`. [CITED: DRS §5.5]

**Example:**
```typescript
template_params: z
  .record(z.string(), z.record(z.string(), z.unknown()))
  .optional()
  .describe('Template parameters keyed by template path or alias.')
```

### Pattern 2: Resolver-Owned Typed Failures

**What:** Return or throw typed template failures with stable `ReferenceFailureReason`, and let `llm.ts` continue aggregating `FailedRef` objects into `reference_resolution_failed`. [VERIFIED: `src/constants/reference-failures.ts`; `src/mcp/tools/llm.ts`; CITED: DRS §8.2]

**When to use:** Use for missing required params, invalid param types, document param resolution failures, alias lookup failures, and list-item wrapping. [CITED: DRS §8.2]

**Example:**
```typescript
return {
  kind: 'failed',
  ref: parsed.ref,
  reason: 'template_missing_required_param',
  detail: "Required parameter 'target_doc' not found in template_params",
};
```

### Pattern 3: Position-Aware Single-Pass Replacement

**What:** Reuse the existing right-to-left span replacement pattern for both reference hydration and template placeholder substitution. [VERIFIED: `hydrateMessages` in `src/llm/reference-resolver.ts`; `tests/unit/reference-resolver.test.ts`]

**When to use:** Required when duplicate placeholders have different resolved values or substituted values contain `{{ref:...}}` / `{{placeholder}}` strings that must remain literal. [CITED: DRS §5.6]

**Example:**
```typescript
// Source: existing hydrateMessages pattern in src/llm/reference-resolver.ts
replacements.sort((a, b) => b.start - a.start);
let content = original;
for (const rep of replacements) {
  content = content.slice(0, rep.start) + rep.content + content.slice(rep.end);
}
```

### Anti-Patterns to Avoid

- **Separate template resolver pipeline:** Would duplicate identifier resolution and break Phase 113 metadata/failure contracts. Use `reference-resolver.ts`. [VERIFIED: current architecture; CITED: DRS §1]
- **Recursive hydration/substitution:** DRS forbids re-processing placeholders introduced by injected docs or params. [CITED: DRS §5.6]
- **Using alias key as a vault identifier:** `@alias` must skip vault resolution and look up `template_params[alias]`. [CITED: DRS §5.3, §8.1]
- **Passing reserved fields into template params:** `_template`, `_items`, and `_separator` are resolver machinery and must not appear in `template_params_used` or warnings. [CITED: DRS §5.5, §9.1]
- **Global replacement for duplicate placeholders:** Existing tests prove duplicate occurrences must consume distinct resolved entries. [VERIFIED: `tests/unit/reference-resolver.test.ts`]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML frontmatter parsing | Manual `---` split/YAML parsing | `gray-matter` | Existing code and tests already depend on `gray-matter` semantics. [VERIFIED: `package.json`; codebase grep] |
| Document identity resolution | Custom path/UUID/filename search | `resolveDocumentIdentifier` / `resolveAndBuildDocument` | Existing ladder handles UUID, path, filename ambiguity, reconciliation, and read errors. [VERIFIED: `src/mcp/utils/resolve-document.ts`; `src/mcp/utils/document-output.ts`] |
| MCP input validation | Ad hoc `typeof` checks only | Zod at boundary plus semantic resolver validation | Project convention and SDK examples use Zod schemas for tools. [VERIFIED: AGENTS.md; CITED: Context7 `/modelcontextprotocol/typescript-sdk`; `/colinhacks/zod`] |
| Section/pointer extraction for `_items` strings | New parser | Existing `parseActiveSpan` grammar extracted/reused for inner item syntax | DRS says `_items` string items reuse non-alias inner reference grammar. [CITED: DRS §5.3] |
| Failure enum management | Free-form reason strings | `REFERENCE_FAILURE_REASONS` runtime array + union | Existing constants already include Phase 114 reasons. [VERIFIED: `src/constants/reference-failures.ts`] |

**Key insight:** templates are not a new content domain; they are a specialization of document reference hydration with additional frontmatter validation and one-pass body substitution. [CITED: DRS §1]

## Common Pitfalls

### Pitfall 1: Losing Original Message Indexes
**What goes wrong:** Parsed host-only message indexes no longer match original `messages` indexes, causing substitutions in the wrong message. [VERIFIED: `src/mcp/tools/llm.ts`; `tests/unit/llm-tool.test.ts`]  
**Why it happens:** `llm.ts` maps system/user messages into a filtered scan array. [VERIFIED: `src/mcp/tools/llm.ts`]  
**How to avoid:** Keep the existing remap from filtered index to original index before resolving. [VERIFIED: `src/mcp/tools/llm.ts`]  
**Warning signs:** Assistant/tool message content changes or `return_messages` shows substitutions outside host-authored system/user input. [VERIFIED: `test_call_model_reference_system_core.py`]

### Pitfall 2: Treating Missing `template_params` as Plain Injection for Templates
**What goes wrong:** Required template params are silently omitted and sent to the model as unresolved `{{param}}`. [CITED: DRS §5.2, §8.1]  
**Why it happens:** Template detection is skipped after body resolution. [CITED: DRS §8.1]  
**How to avoid:** After reading frontmatter, branch on `fq_template: true`; if params are absent, apply defaults only when all missing values are defaulted or optional. [CITED: DRS §5.2, §5.5]  
**Warning signs:** `fq_template: true` document with required params succeeds without `template_params`. [CITED: ATL Test Plan ATL-U-05]

### Pitfall 3: Misclassifying Alias/List Failures
**What goes wrong:** `_items` item failures are reported as top-level document/template failures instead of `multi_ref_item_failed`. [CITED: DRS §8.2]  
**Why it happens:** Per-item resolution reuses single-reference code without wrapping the item index and underlying reason. [CITED: DRS §8.2 detail contracts]  
**How to avoid:** Resolve list items through a helper that returns item metadata or wraps failures with alias key and zero-based item index. [CITED: DRS §8.2, §9.1]  
**Warning signs:** Multiple failures inside the same `{{ref:@background}}` lack item indexes. [CITED: DRS §8.2]

### Pitfall 4: Letting Reserved Fields Leak
**What goes wrong:** `_template`, `_items`, or `_separator` appear as unknown params or `template_params_used`. [CITED: DRS §5.5, §9.1]  
**Why it happens:** Unknown-param validation runs before reserved field consumption. [CITED: DRS §5.5]  
**How to avoid:** Strip reserved fields before validating or producing warnings. [CITED: DRS §5.5]  
**Warning signs:** Metadata includes `_template` in `template_warnings` or `template_params_used`. [CITED: ATL Test Plan ATL-U-05]

### Pitfall 5: Recursive Substitution
**What goes wrong:** A string param containing `{{output}}` or a document param containing `{{ref:...}}` is reprocessed. [CITED: DRS §5.6]  
**Why it happens:** Implementation loops regex substitution until no placeholders remain or hydrates after substitution. [CITED: DRS §5.6]  
**How to avoid:** Validate/resolve all params first, scan the original template body once, and apply replacements right-to-left. [VERIFIED: existing `hydrateMessages`; CITED: DRS §5.6]  
**Warning signs:** Injected values trigger new failures or extra metadata entries. [CITED: DRS §5.6]

## Code Examples

### `call_model` Fail-Fast Shape
```typescript
// Source: src/mcp/tools/llm.ts
if (failures.length > 0) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({
      error: 'reference_resolution_failed',
      failed_references: failures.map((f) => ({
        ref: f.ref,
        reason: f.reason,
        detail: f.detail,
      })),
    }) }],
    isError: true,
  };
}
```

### Existing Metadata Conditional Pattern
```typescript
// Source: src/mcp/tools/llm.ts
if (injectionMetadata) {
  metadata.injected_references = injectionMetadata.injectedReferences;
  metadata.prompt_chars = injectionMetadata.promptChars;
}
```

### Existing Frontmatter Read Pattern
```typescript
// Source: src/mcp/utils/document-output.ts
const parsed = matter(rawContent);
const { data, content } = parsed;
```

### Zod Safe Parse Pattern
```typescript
// Source: Context7 /colinhacks/zod
const result = schema.safeParse(input);
if (!result.success) {
  result.error.issues;
} else {
  result.data;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `{{id:...}}` active legacy references | Only `{{ref:...}}` active; `{{id:...}}` literal | Phase 113 / ATL v1, completed 2026-05-05 | Template work should not revive `{{id:...}}`; UUIDs are passed as values inside `{{ref:uuid}}` or document params. [VERIFIED: `tests/unit/reference-resolver.test.ts`; `113-04-SUMMARY.md`] |
| Plain document-only hydration | Unified document/template hydration | DRS spec complete 2026-05-05 | Phase 114 extends the same resolver with `fq_template` branch. [CITED: DRS §1, §8.1] |
| Path-keyed single template params only | Path-keyed plus alias `_template` and `_items` | DRS spec complete 2026-05-05 | Multiple uses of same template require alias keys. [CITED: DRS §5.3] |
| Generic metadata `{ref, chars, resolved_to?}` only | Template/list metadata under `injected_references[]` entries | DRS spec complete 2026-05-05 | `CallModelMetadata` injected entry type must widen additively. [VERIFIED: `src/llm/types.ts`; CITED: DRS §9.1] |

**Deprecated/outdated:**
- Do not use Phase 109 `{{id:...}}` examples in new tests; Phase 113 removed active legacy id support. [VERIFIED: `tests/unit/reference-resolver.test.ts`; `test_call_model_reference_system_core.py`]
- Do not create config-driven template declarations in Phase 114; direct template reference uses vault frontmatter and `template_params`, while purpose binding/discovery is later Phases 115/118. [CITED: DRS §6, §10; `.planning/ROADMAP.md` Phase 115/118]

## Assumptions Log

All claims in this research were verified from local code, local planning/product docs, npm registry output, Context7 documentation, or command output; no `[ASSUMED]` claims are present. [VERIFIED: this research session]

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | — | — | — |

## Open Questions

1. **Should `fq_template`, `fq_params`, and warning names be added to `frontmatter-fields.ts`?**
   - What we know: Existing `FM` constants contain FlashQuery-managed fields like `fq_id`, but DRS says `fq_template` is author-authored and not auto-inserted. [VERIFIED: `src/constants/frontmatter-fields.ts`; CITED: DRS §6.3]
   - What's unclear: Whether this project wants constants for user-authored `fq_*` fields that are read but not managed. [VERIFIED: codebase convention scan]
   - Recommendation: Planner should allow either local string constants inside resolver or a separate template constants module; do not add `fq_template` to write/repair flows. [CITED: DRS §6.3]

2. **Should Phase 114 update user-facing docs now or defer to Phase 119 help/docs?**
   - What we know: Phase 114 success criteria only require runnable tests and behavior; Phase 119 owns help resolver; AGENTS document-maintenance skill asks for docs review after user-facing behavior changes. [VERIFIED: `.planning/ROADMAP.md`; `.agents/skills/document-maintenance/SKILL.md`]
   - What's unclear: Whether formal docs update is expected in this phase's implementation plan. [VERIFIED: no 114-CONTEXT.md]
   - Recommendation: Include a documentation review checkpoint, but keep code tasks focused on CLI/MCP behavior. [VERIFIED: AGENTS.md; document-maintenance skill]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Runtime/build/unit tests | yes | v24.7.0 | None needed; project requires >=20. [VERIFIED: `node --version`; AGENTS.md] |
| npm | Package scripts/npm registry checks | yes | 11.5.1 | None. [VERIFIED: `npm --version`] |
| Python 3 | Directed scenario runner | yes | 3.12.3 | None. [VERIFIED: `python3 --version`] |
| Git | Test fixtures and doc commit | yes | 2.50.1 Apple Git | None. [VERIFIED: `git --version`] |
| `.env.test` | Supabase-backed integration tests | yes | present | Tests skip gracefully if values incomplete. [VERIFIED: file check; `tests/helpers/test-env.ts`] |
| Supabase CLI | Optional local Supabase management | no | — | Use `.env.test` configured Supabase; CLI is not required for Vitest integration tests. [VERIFIED: `command -v supabase`; `tests/helpers/test-env.ts`] |
| Docker | Optional preflight compose validation | no | — | Preflight skips Docker validation when Docker is absent per script behavior; not required for Phase 114 planning. [VERIFIED: `command -v docker`; AGENTS preflight skill] |
| gsd-sdk | Research commit | yes | 1.40.0 | Manual git commit if needed. [VERIFIED: `gsd-sdk --version`] |

**Missing dependencies with no fallback:** None identified for planning. [VERIFIED: environment audit]

**Missing dependencies with fallback:** Supabase CLI and Docker are absent; Phase 114 can still plan unit, integration, and managed directed tests using existing project runners and `.env.test`. [VERIFIED: environment audit; test runner docs]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.1` package, current npm `4.1.5`; Python directed scenario runner; YAML integration runner. [VERIFIED: `package.json`; npm registry; scenario skill docs] |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`. [VERIFIED: file reads] |
| Quick run command | `npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool.test.ts` [VERIFIED: existing scripts and Phase 113 summary] |
| Full suite command | `npm run build && npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool.test.ts && npm run test:integration -- tests/integration/reference-resolver.integration.test.ts && python3 tests/scenarios/directed/run_suite.py --managed test_call_model_template_parameterization` [VERIFIED: `package.json`; `113-04-SUMMARY.md`; directed runner skill] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| TMPL-01 | `fq_template: true` applies params; plain doc ignores params | unit + integration | `npm test -- tests/unit/reference-resolver.test.ts` | existing file, add cases |
| TMPL-02 | Path-keyed and alias-keyed `_template` params, duplicate template different values | unit + directed | `python3 tests/scenarios/directed/run_suite.py --managed test_call_model_template_parameterization` | missing, Wave 0 |
| TMPL-03 | `string`/`document`, required/default/invalid/not-found typed failures | unit + integration | `npm run test:integration -- tests/integration/reference-resolver.integration.test.ts` or new `template-resolver.integration.test.ts` | partial existing file, add/new cases |
| TMPL-04 | Single-pass deterministic substitution and escape parity | unit | `npm test -- tests/unit/reference-resolver.test.ts` | existing file, add cases |
| TMPL-05 | `_items` ordered list, separator, per-item metadata | unit + integration + directed | `npm test -- tests/unit/reference-resolver.test.ts` plus directed command | missing cases |
| VAL-114 | Phase-local runnable validation exists and passes | build + unit + integration + directed | full suite command above | missing scenario and likely integration cases |

### Sampling Rate

- **Per task commit:** `npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool.test.ts` [VERIFIED: package scripts]
- **Per wave merge:** add relevant integration or directed command for the wave's surface area. [VERIFIED: Phase 113 validation pattern]
- **Phase gate:** `npm run build`, focused unit tests, focused integration test, and managed directed scenario green before verification. [VERIFIED: `113-04-SUMMARY.md`]

### Wave 0 Gaps

- [ ] `tests/unit/reference-resolver.test.ts` — add ATL-U-05/ATL-U-06 template validation and substitution matrix. [CITED: ATL Test Plan ATL-U-05/06]
- [ ] `tests/unit/llm-tool.test.ts` — add schema/wiring tests proving `template_params` is passed only to model/purpose hydration and discovery bypass remains unchanged. [VERIFIED: current test file]
- [ ] `tests/integration/template-resolver.integration.test.ts` or extend `tests/integration/reference-resolver.integration.test.ts` — real-vault document params, `_items`, alias, and plain-doc ignored params. [VERIFIED: existing integration pattern]
- [ ] `tests/scenarios/directed/testcases/test_call_model_template_parameterization.py` — public ATL-DS-04/05/06 scenario with mock OpenAI-compatible provider. [CITED: ATL Test Plan ATL-DS-04/05/06; VERIFIED: Phase 113 scenario pattern]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Phase 114 does not change auth; existing MCP/auth remains unchanged. [VERIFIED: phase scope; AGENTS.md] |
| V3 Session Management | no | MCP is stateless and phase does not add server-side session state. [VERIFIED: AGENTS.md; phase scope] |
| V4 Access Control | yes | Use existing vault/Supabase document identifier resolution; do not bypass vault-root path containment checks. [VERIFIED: `src/mcp/utils/resolve-document.ts`] |
| V5 Input Validation | yes | Zod for `template_params` shape plus resolver semantic validation for param declarations and alias/list values. [VERIFIED: AGENTS.md; CITED: DRS §5.5] |
| V6 Cryptography | no | Phase does not add cryptography. [VERIFIED: phase scope] |

### Known Threat Patterns for FlashQuery Template Hydration

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal through template/document identifiers | Tampering / Information Disclosure | Reuse `resolveDocumentIdentifier`, which resolves inside vault root and rejects paths outside root. [VERIFIED: `src/mcp/utils/resolve-document.ts`] |
| Prompt/context injection via recursive references | Tampering | Host-only, non-recursive hydration; substituted values are never re-scanned. [VERIFIED: `src/mcp/tools/llm.ts`; CITED: DRS §5.6] |
| Ambiguous filename selecting wrong document | Information Disclosure | Existing ambiguity failure requires path or `fq_id`; document params must map ambiguity to `template_param_doc_not_found`. [VERIFIED: `src/mcp/utils/resolve-document.ts`; CITED: DRS §8.2] |
| Reserved field collision | Tampering | Consume `_template`, `_items`, `_separator` before user param validation and never expose them as template params. [CITED: DRS §5.5] |

## Sources

### Primary (HIGH confidence)
- `AGENTS.md` - project stack, conventions, testing, MCP response contract. [VERIFIED: file read]
- `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md` - Phase 114 scope and requirements. [VERIFIED: file reads]
- `src/llm/reference-resolver.ts`, `src/mcp/tools/llm.ts`, `src/mcp/utils/document-output.ts`, `src/mcp/utils/resolve-document.ts`, `src/constants/reference-failures.ts`, `src/llm/types.ts` - current implementation boundaries. [VERIFIED: file reads]
- `Document Reference System.md` - template/reference specification, parameter semantics, failure taxonomy, metadata. [CITED: local product spec path]
- `ATL Test Plan.md` - coverage requirements for template/unit/integration/directed tests. [CITED: local product spec path]
- Context7 `/colinhacks/zod` - Zod object/record/safeParse patterns. [CITED: Context7]
- Context7 `/modelcontextprotocol/typescript-sdk` - `registerTool`, Zod schema, and `isError` examples. [CITED: Context7]
- npm registry - current package versions and modified timestamps for core packages. [VERIFIED: npm registry]

### Secondary (MEDIUM confidence)
- `.agents/skills/flashquery-directed-testgen/SKILL.md`, `flashquery-directed-run`, `flashquery-integration-testgen`, `flashquery-integration-run`, `document-maintenance` - local test authoring/running conventions and docs checkpoint pattern. [VERIFIED: skill file reads]

### Tertiary (LOW confidence)
- None. [VERIFIED: no unverified web-only sources used]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - verified against `package.json`, npm registry, AGENTS, and Context7 docs.
- Architecture: HIGH - Phase 113 implementation and DRS are aligned on a single resolver pipeline.
- Pitfalls: HIGH - derived from DRS contracts and existing Phase 113 regression tests.

**Research date:** 2026-05-05  
**Valid until:** 2026-06-04 for local architecture; re-check npm/Context7 versions before dependency upgrades.
