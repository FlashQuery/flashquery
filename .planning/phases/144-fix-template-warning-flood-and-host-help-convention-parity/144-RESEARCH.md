# Phase 144: Fix template warning flood and host help convention parity - Research

**Researched:** 2026-05-21
**Domain:** FlashQuery TypeScript MCP server, template discovery, Supabase document index, native tool dispatch
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### Template Warning Flood
- [D-01] Ordinary documents without `fq_template: true` are silent discovery skips, never public or internal `code: "not_template"` diagnostics.
- [D-02] Genuine template diagnostics remain visible: `not_exposed`, `invalid_namespace`, `missing_description`, `invalid_tool_name`, `unsupported_template_param_schema`, conflicts, and dangling template paths.
- [D-03] Template discovery must be index-backed via a template-scoped `template_meta` JSONB column on `fqc_documents`; it must not use recursive vault filesystem walks on `call_model` or `call_macro` request paths.
- [D-04] `template_meta` stores only `fq_template`, `fq_expose_as_tool`, `fq_namespace`, `fq_desc`, and `fq_params`; it must not duplicate `status`, `title`, `tags`, `path`, or `content_hash`.
- [D-05] `template_meta` is populated on `write_document`, refreshed/cleared by `maintain_vault` sync, and backfilled before index-backed discovery is relied on.
- [D-06] In permissive mode, `list_purposes` emits exposed `template_tools` once at top level; in restrictive mode, each purpose keeps its own `template_tools`.
- [D-07] `template_tool_warnings`, `template_tool_conflicts`, and `dangling_template_paths` remain per-purpose in both permissive and restrictive modes.
- [D-08] `call_macro` gains no public output shape change, but inherits the silent-skip and index-backed discovery behavior.

### Help Convention Host-Model Parity
- [D-09] Native-tool dispatch uses a single shared core for catalog lookup, `help: true`, validation, handler invocation, and native footer wrapping.
- [D-10] `help: true` is recognized only when the value is boolean `true`, and it runs before schema validation.
- [D-11] Host MCP `tools/call` installs a FlashQuery handler that routes native, host-exposed tools through the shared core and delegates brokered or unknown calls to the captured SDK handler.
- [D-12] Host exposure is an allow-list gate; `help: true` for a non-exposed native tool must not reveal that the tool exists.
- [D-13] Every native tool's advertised input schema gets an optional boolean `help` property via the central tool-catalog wrapper, not by editing individual tool files.
- [D-14] Brokered tool behavior is unchanged: `help: true` passes upstream intact and brokered errors are not wrapped with the native footer.

### Test Obligations
- [D-15] The plan must create/extend the Template Warning Flood tests from the supplied test plan: T-U-001..007, T-I-001..009, and T-S-001..006.
- [D-16] The plan must create/extend the Help Convention tests from the supplied test plan: T-U-001..008 and T-E-001..010.
- [D-17] Test implementation is not optional or deferred; requirements are only complete when their mapped tests pass at the specified layer.

### the agent's Discretion
- The planner may choose the final names and exact number of PLAN.md files, provided the plans are executable, dependencies are clear, and every requirement/test ID maps to a plan.
- The implementing agent may choose final helper/module names where the specs mark names as proposals, provided the public contracts and tests are updated consistently.

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

- Template Warning Flood: aggregated discovery diagnostic counts and static `call_macro` source analysis are deferred by the requirements spec.
- Help Convention Host-Model Parity: unified brokered route refactor is deferred by the requirements spec.
</user_constraints>

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20 LTS, TypeScript strict mode, and ESM imports only; do not introduce CommonJS. [VERIFIED: AGENTS.md]
- FlashQuery is CLI + MCP only; do not build a web UI or server-side session state. [VERIFIED: AGENTS.md]
- MCP tool handlers return `{ content: [{ type: "text", text: "..." }] }`; error responses add `isError: true`. [VERIFIED: AGENTS.md]
- Use `@modelcontextprotocol/sdk`, not `@modelcontextprotocol/server`. [VERIFIED: AGENTS.md]
- Use Zod for external input validation and preserve the current async/await style. [VERIFIED: AGENTS.md]
- Keep files kebab-case, types/interfaces PascalCase, functions/variables camelCase, constants SCREAMING_SNAKE_CASE, and Supabase internal tables with `fqc_` prefix. [VERIFIED: AGENTS.md]
- Unit tests run with `npm test`; integration tests with `npm run test:integration`; E2E tests with `npm run test:e2e`; directed scenarios live under `tests/scenarios/directed/`. [VERIFIED: AGENTS.md]
- `.env.test` is required for integration/E2E credentials, and Supabase-dependent tests skip when credentials are incomplete. [VERIFIED: AGENTS.md]

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| Template REQ-001 | Non-template documents are silent discovery skips. [CITED: product requirements] | Implement typed skip in `src/llm/template-tools.ts` validation loop. [VERIFIED: codebase grep] |
| Template REQ-002 | Genuine template diagnostics remain visible. [CITED: product requirements] | Existing diagnostic codes originate in `validateTemplateCandidate`; tests must preserve them. [VERIFIED: codebase grep] |
| Template REQ-003 | Provider tool surface and template dispatch stay unchanged. [CITED: product requirements] | Keep `providerTools`, `templateReverseMap`, `dispatchTemplateToolCall` contracts. [VERIFIED: codebase grep] |
| Template REQ-004 | Add `template_meta JSONB` to `fqc_documents`. [CITED: product requirements] | Add DDL and schema verification coverage near `buildSchemaDDL` / `schema-verify`. [VERIFIED: codebase grep] |
| Template REQ-005 | Populate/refresh/clear/backfill `template_meta`. [CITED: product requirements] | Write path and scanner already parse frontmatter via `matter()`. [VERIFIED: codebase grep] |
| Template REQ-006 | Source template discovery from the index, not recursive vault walks. [CITED: product requirements] | Replace `discoverAllTemplateCandidates` request-path use with Supabase row queries. [VERIFIED: codebase grep] |
| Template REQ-007 | Discovery resolvers return bounded responses. [CITED: product requirements] | `buildListPurposesContent` and `buildSearchContent` share purpose payloads. [VERIFIED: codebase grep] |
| Template REQ-008 | Purpose-call response metadata is bounded. [CITED: product requirements] | `toPublicToolDiagnostics` copies template warnings into `metadata.tools.diagnostics`. [VERIFIED: codebase grep] |
| Template REQ-009 | Search relevance is not polluted by skipped documents. [CITED: product requirements] | `purposeSearchText` indexes template warnings today. [VERIFIED: codebase grep] |
| Template REQ-010 | `call_macro` gains no output change and inherits index discovery. [CITED: product requirements] | `assembleMacroTemplateMetadata` returns only reverse map and names. [VERIFIED: codebase grep] |
| Template REQ-011 | Permissive `list_purposes` lists exposed templates once at top level. [CITED: product requirements] | Modify `src/llm/discovery-content.ts` and `src/llm/help-content.ts`; update directed ATL-DS-07. [VERIFIED: codebase grep] |
| Help REQ-001 | Extract shared native-tool dispatch core. [CITED: product requirements] | Lift logic from `dispatchNativeToolCall` into a shared module. [VERIFIED: codebase grep] |
| Help REQ-002 | Shared core handles boolean `help: true` before validation. [CITED: product requirements] | Existing delegated path already checks `args.help === true` before Zod parsing. [VERIFIED: codebase grep] |
| Help REQ-003 | Host `tools/call` takeover routes exposed native tools and delegates the rest. [CITED: product requirements] | MCP SDK supports `setRequestHandler`; installed SDK replaces handlers by method. [CITED: Context7 /modelcontextprotocol/typescript-sdk; VERIFIED: installed SDK] |
| Help REQ-004 | Advertise optional `help` on every native schema. [CITED: product requirements] | Inject centrally in `wrapServerWithToolCatalog`; brokered tools use `registerUncatalogedTool`. [VERIFIED: codebase grep] |
| Help REQ-005 | Native misuse footer trigger set is shared. [CITED: product requirements] | Existing footer logic lives in `tool-dispatcher.ts`; move/export it once. [VERIFIED: codebase grep] |
| Help REQ-006 | Host exposure gates help. [CITED: product requirements] | `getResolvedHostToolExposure` produces `hostEnabledToolNames`; non-exposed names should delegate to SDK. [VERIFIED: codebase grep] |
| Help REQ-007 | Brokered tools unchanged. [CITED: product requirements] | Host brokered tools are registered uncataloged and call `broker.callTool`; preserve this route. [VERIFIED: codebase grep] |
</phase_requirements>

## Summary

Phase 144 should be planned as two independent bug tracks with one shared final validation gate. The template track should land first as four ordered plans: silent skip semantics, `template_meta` schema/population, index-backed discovery, then the permissive `list_purposes` shape change. This order lets the urgent warning-flood fix land before the schema migration and prevents index-backed discovery from depending on unpopulated rows. [CITED: product requirements; VERIFIED: codebase grep]

The help-parity track should land as two plans: first extract a behavior-preserving native dispatch core from `dispatchNativeToolCall`, then install the host `tools/call` takeover and central schema advertisement. This isolates the delegated-path regression risk before changing host-visible behavior. [CITED: product requirements; VERIFIED: codebase grep]

No new npm package is required. The standard stack is the existing repo stack: TypeScript ESM, `@modelcontextprotocol/sdk`, Zod, Supabase, Vitest, and the existing directed Python harness. [VERIFIED: package.json; VERIFIED: AGENTS.md]

**Primary recommendation:** Plan six implementation plans: `01-template-silent-skip`, `02-template-meta-schema-population`, `03-index-backed-template-discovery`, `04-list-purposes-template-shape`, `05-shared-native-dispatch-core`, and `06-host-help-parity`, with the exact test IDs from both product test plans assigned to those plans. [CITED: product test plans]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Silent non-template filtering | API / Backend | Database / Storage | Registry assembly is backend logic in `src/llm/template-tools.ts`; storage only supplies candidate metadata. [VERIFIED: codebase grep] |
| `template_meta` persistence | Database / Storage | API / Backend | `fqc_documents` owns indexed document metadata; write/scanner paths populate it. [VERIFIED: codebase grep] |
| Index-backed template discovery | API / Backend | Database / Storage | Backend registry assembly queries Supabase rows and builds provider tools. [VERIFIED: codebase grep] |
| `list_purposes` response shape | API / Backend | — | MCP `call_model` discovery payload construction lives in `src/llm/discovery-content.ts`. [VERIFIED: codebase grep] |
| Native `help: true` dispatch | API / Backend | Frontend Server (MCP host boundary) | Shared core owns native tool lookup, help, validation, handler invocation, and footer wrapping. [VERIFIED: codebase grep] |
| Host MCP `tools/call` routing | Frontend Server (MCP host boundary) | API / Backend | `createMcpServer` owns the SDK-facing request handler; the shared core owns native dispatch. [VERIFIED: codebase grep] |
| Brokered pass-through | API / Backend | External MCP server | Existing broker path delegates upstream calls and should not be absorbed into native dispatch. [VERIFIED: codebase grep] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | local `v24.7.0`; project requires >=20 | Runtime | Existing project runtime and engine requirement. [VERIFIED: environment; VERIFIED: package.json] |
| TypeScript | `^6.0.2` | Strict ESM implementation | Existing repo language and build toolchain. [VERIFIED: package.json] |
| `@modelcontextprotocol/sdk` | installed `1.27.1`, npm latest `1.29.0` published 2026-03-30 | MCP server/client, tool registration, `tools/call` handling | Existing MCP SDK dependency; docs expose `setRequestHandler` and `registerTool`. [VERIFIED: package.json and installed package; VERIFIED: npm registry; CITED: Context7 /modelcontextprotocol/typescript-sdk] |
| Zod | `^4.3.6` | Native tool schema validation and schema injection | Existing validation layer used by native tool dispatch and registration. [VERIFIED: package.json; VERIFIED: codebase grep] |
| Supabase JS + `pg` | `@supabase/supabase-js ^2.100.0`, `pg ^8.20.0` | `fqc_documents` data operations and schema verification | Existing document index and DDL path. [VERIFIED: package.json; VERIFIED: codebase grep] |

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| `gray-matter` | `^4.0.3` | Markdown frontmatter parsing | Reuse existing write/scanner parsed frontmatter to derive `template_meta`. [VERIFIED: package.json; VERIFIED: codebase grep] |
| Vitest | `^4.1.1`; npm latest `4.1.7` modified 2026-05-20 | Unit, integration, E2E test runner | Extend existing test files and commands. [VERIFIED: package.json; VERIFIED: npm registry] |
| Python 3 | local `3.12.3` | Directed scenario runner | Extend `test_call_model_template_discovery.py`. [VERIFIED: environment; VERIFIED: codebase grep] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `template_meta` JSONB | Five typed DB columns | Rejected by locked decision D-04 and the existing DDL warning about add/drop churn. [CITED: CONTEXT.md; VERIFIED: codebase grep] |
| Index-backed discovery | Per-request filesystem cache | Rejected by locked decision D-03; cache invalidation would duplicate scanner/write-path freshness. [CITED: CONTEXT.md; CITED: product requirements] |
| Shared native core only | Unified native + brokered dispatcher | Brokered route unification is deferred; preserving brokered behavior lowers risk. [CITED: CONTEXT.md] |
| Individual tool schema edits | Central catalog schema injection | Central injection prevents drift across native tool files. [CITED: CONTEXT.md; VERIFIED: codebase grep] |

**Installation:**
```bash
# No new packages should be installed for Phase 144. [VERIFIED: research]
```

## Package Legitimacy Audit

Phase 144 installs no external packages, so the Package Legitimacy Gate is not applicable. Existing packages remain in `package.json`; no planner task should add dependency installation. [VERIFIED: package.json; CITED: package_legitimacy_protocol]

## Architecture Patterns

### System Architecture Diagram

```text
Template discovery path

write_document / maintain_vault sync
  -> parse markdown frontmatter with gray-matter
  -> extract {fq_template, fq_expose_as_tool, fq_namespace, fq_desc, fq_params}
  -> fqc_documents.template_meta
  -> assembleTemplateToolRegistry
      -> permissive: query active rows with template_meta.fq_template=true
      -> restrictive: resolve bound paths against active rows
      -> validate candidate as skip | warning | tool
      -> providerTools + templateReverseMap + diagnostics
  -> call_model discovery / purpose metadata / call_macro template metadata
```

```text
Host help parity path

MCP client tools/list
  -> wrapServerWithToolCatalog injects optional help on native schemas
  -> SDK list handler advertises native + brokered registered tools

MCP client tools/call
  -> FlashQuery CallTool handler
      -> native name AND host-exposed -> shared native dispatch core
          -> allowed check -> help:true -> Zod validation -> handler -> footer wrapping
      -> brokered or unknown -> captured SDK CallTool handler
```

### Recommended Project Structure

```text
src/
├── llm/
│   ├── template-tools.ts        # skip/warning/tool validation and index-backed discovery
│   ├── discovery-content.ts     # list_purposes/search payload shape
│   ├── native-tool-core.ts      # proposed shared native dispatch core
│   └── tool-dispatcher.ts       # delegated model dispatch wrapper
├── mcp/
│   ├── server.ts                # host CallTool takeover and SDK handler delegation
│   └── tool-catalog.ts          # native catalog capture and help schema injection
├── storage/
│   ├── supabase.ts              # DDL for template_meta
│   └── schema-verify.ts         # migrated/fresh schema recognition
└── services/
    └── scanner.ts               # maintain_vault sync template_meta refresh/backfill
```

### Pattern 1: Typed Filter Result

**What:** Change template candidate validation from optional fields to a discriminated union: `skip`, `warning`, or `tool`. [CITED: product requirements]

**When to use:** Use for `frontmatter.fq_template !== true` so ordinary non-template documents cannot be pushed to `template_tool_warnings`. [CITED: product requirements; VERIFIED: codebase grep]

**Example:**
```ts
type TemplateCandidateValidation =
  | { kind: 'skip' }
  | { kind: 'warning'; warning: { code: string; message: string } }
  | { kind: 'tool'; toolName: string; schema: Record<string, unknown> };
```

### Pattern 2: Index Row as Discovery Candidate

**What:** Candidate discovery should read `path` and `template_meta` from active `fqc_documents` rows, then build `TemplateDocumentCandidate` without reading file bodies. [CITED: product requirements]

**When to use:** Use in `assembleTemplateToolRegistry` for both permissive and restrictive modes; keep body reads in `dispatchTemplateToolCall`. [CITED: product requirements; VERIFIED: codebase grep]

**Example:**
```ts
// Query shape from the product spec; final Supabase client code may differ.
select('path, template_meta')
  .eq('instance_id', config.instance.id)
  .eq('status', 'active')
  .eq('template_meta->>fq_template', 'true');
```

### Pattern 3: Shared Native Dispatch Core

**What:** Extract native lookup, help sentinel, validation, handler invocation, abort handling, and footer wrapping into one module consumed by delegated and host paths. [CITED: product requirements]

**When to use:** Use for native FQ tools only; brokered calls stay on existing broker/SDK paths. [CITED: product requirements]

**Example:**
```ts
await dispatchNativeToolCore({
  toolName,
  args,
  catalog,
  allowedToolNames,
  context,
});
```

### Anti-Patterns to Avoid

- **Caller-side suppression only:** Filtering `not_template` only in `discovery-content.ts` would leave `resolver:"purpose"` and macro cost paths untouched. [CITED: product bug report; VERIFIED: codebase grep]
- **Full frontmatter duplication:** Storing all frontmatter in `template_meta` risks divergence with existing `status`, `title`, and `tags` columns. [CITED: product requirements]
- **Host-only help implementation:** Duplicating sentinel/footer logic in `server.ts` would violate the shared-core requirement and drift from delegated behavior. [CITED: product requirements]
- **Intercepting brokered tools in native core:** Brokered `help: true` must pass upstream unchanged and brokered errors must remain unwrapped. [CITED: product requirements]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP request parsing / result envelope | Custom JSON-RPC parser | `@modelcontextprotocol/sdk` `setRequestHandler` / SDK handler delegation | SDK owns protocol parsing and `CallToolResult` shape. [CITED: Context7 /modelcontextprotocol/typescript-sdk] |
| Tool argument validation | Ad hoc validation | Existing Zod schema path via `toZodObjectSchema` / native catalog | Existing dispatcher behavior and tests rely on Zod errors. [VERIFIED: codebase grep] |
| Frontmatter parsing | Regex YAML parsing for normal docs | `gray-matter` on write/scanner paths | Existing code already parses frontmatter there. [VERIFIED: codebase grep] |
| Template discovery cache | Process cache with invalidation | `fqc_documents.template_meta` index | The document index is already the freshness boundary. [CITED: product requirements] |
| Brokered dispatch | Reimplemented host broker routing | Captured SDK handler + existing `registerHostBrokeredTools` | Prevents behavior drift for brokered tools. [VERIFIED: codebase grep; CITED: product requirements] |

**Key insight:** The template bug is not a rendering bug; it is a discovery classification and request-path data-source bug. The help bug is not a missing help-page content bug; it is a dispatch-route parity bug. [CITED: product bug reports]

## Common Pitfalls

### Pitfall 1: Switching to the Index Before Backfill

**What goes wrong:** Existing templates with null `template_meta` disappear from permissive discovery. [CITED: product requirements]
**Why it happens:** The new query only sees indexed metadata. [CITED: product requirements]
**How to avoid:** Plan schema/population/backfill before index-backed discovery. [CITED: product requirements]
**Warning signs:** Freshly written templates appear, old vault templates do not. [ASSUMED]

### Pitfall 2: Querying Archived or Missing Rows

**What goes wrong:** Archived/missing documents can surface as templates. [CITED: product requirements]
**Why it happens:** The query omits `status = 'active'`. [CITED: product requirements]
**How to avoid:** Include active-status filtering in permissive and restrictive row resolution. [CITED: product requirements]
**Warning signs:** Removed or archived template paths appear in `template_tools`. [ASSUMED]

### Pitfall 3: Breaking `list_purposes` Search Semantics

**What goes wrong:** `search` stops finding purposes by template metadata or still matches suppressed warnings. [VERIFIED: codebase grep]
**Why it happens:** `buildSearchContent` filters the `list_purposes` payload and `purposeSearchText` indexes selected fields. [VERIFIED: codebase grep]
**How to avoid:** Update search tests alongside the response shape change. [CITED: product test plan]
**Warning signs:** Query `not_template` or ordinary doc paths returns purposes. [CITED: product test plan]

### Pitfall 4: Host Takeover Creates an Existence Oracle

**What goes wrong:** `help: true` for hidden native tools returns a distinct hidden-tool response. [CITED: product requirements]
**Why it happens:** The handler checks native catalog before host exposure. [ASSUMED]
**How to avoid:** On host path, dispatch only if name is in `hostEnabledToolNames`; otherwise delegate unchanged to SDK. [CITED: product requirements]
**Warning signs:** Hidden native and unknown names produce different host errors. [CITED: product test plan]

### Pitfall 5: Optional `help` Injection Alters Required Schemas

**What goes wrong:** Normal host calls fail because `help` becomes required or mutates existing schema shape. [CITED: product test plan]
**Why it happens:** Schema injection is applied incorrectly to Zod raw shapes. [ASSUMED]
**How to avoid:** Add `help: z.boolean().optional()` centrally and assert `required` does not include `help` in `tools/list`. [CITED: product test plan]
**Warning signs:** E2E `tools/list` has `help` in required fields. [CITED: product test plan]

## Code Examples

### Existing Warning Flood Source

```ts
// Source: src/llm/template-tools.ts [VERIFIED: codebase grep]
if (frontmatter.fq_template !== true) {
  return { warning: { code: 'not_template', message: 'Document is not an fq_template template' } };
}
```

### Existing Delegated Help Ordering

```ts
// Source: src/llm/tool-dispatcher.ts [VERIFIED: codebase grep]
if (isNativeHelpRequest(args)) {
  const toolMeta = await getLoadedToolMeta();
  const meta = toolMeta.get(toolName);
  if (meta) {
    const result = { content: [{ type: 'text', text: meta.helpPageBody }] };
    // returned before Zod parsing
  }
}
```

### MCP SDK Request Handler Contract

```ts
// Source: Context7 /modelcontextprotocol/typescript-sdk [CITED: Context7]
server.setRequestHandler('tools/call', async (request, ctx) => {
  return { content: [{ type: 'text', text: 'Tool call successful.' }] };
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-call recursive vault walk for template discovery | `fqc_documents.template_meta` index query | Phase 144 planned | Removes `O(vault)` request cost and warning flood. [CITED: product requirements] |
| `not_template` as warning | Non-warning skip result | Phase 144 planned | Ordinary documents are silent. [CITED: product requirements] |
| Per-purpose `template_tools` in permissive `list_purposes` | Top-level `template_tools` once | Phase 144 planned | Bounded discovery payload and contract update. [CITED: product requirements] |
| Delegated-only native help convention | Shared core used by delegated and host paths | Phase 144 planned | Host MCP tools/call reaches help pages and footer behavior. [CITED: product requirements] |

**Deprecated/outdated:**
- `code: "not_template"` diagnostics are deprecated by locked decision D-01 and should be removed from public and internal registry diagnostics. [CITED: CONTEXT.md]
- Recursive `discoverAllTemplateCandidates` must not remain on `call_model` or `call_macro` request paths after index discovery lands. [CITED: CONTEXT.md]

## Implementation Touch Points

| Track | File | Function / Area | Planning Notes |
|-------|------|-----------------|----------------|
| Template | `src/llm/template-tools.ts` | `TemplateDocumentCandidate`, `readTemplateCandidate`, `discoverAllTemplateCandidates`, `validateTemplateCandidate`, `assembleTemplateToolRegistry` | Central file for skip semantics and index-backed discovery. [VERIFIED: codebase grep] |
| Template | `src/llm/discovery-content.ts` | `purposeToResponse`, `buildListPurposesContent`, `purposeSearchText`, `buildSearchContent` | Owns top-level/per-purpose response shape and search pollution risk. [VERIFIED: codebase grep] |
| Template | `src/mcp/tools/llm.ts` | `toPublicToolDiagnostics`, resolver `purpose` assembly | Purpose metadata path copies warnings to public diagnostics. [VERIFIED: codebase grep] |
| Template | `src/mcp/tools/macro.ts` | `assembleMacroTemplateMetadata` | Must keep output unchanged while using new discovery. [VERIFIED: codebase grep] |
| Template | `src/storage/supabase.ts` | `buildSchemaDDL` | Add idempotent `template_meta JSONB` and likely useful index. [VERIFIED: codebase grep] |
| Template | `src/storage/schema-verify.ts` | `verifySchema` | Currently table-only; plan may need column check if schema verification is expected to recognize `template_meta`. [VERIFIED: codebase grep] |
| Template | `src/mcp/tools/documents.ts` | `write_document` create/update DB payloads | Populate `template_meta` from the final frontmatter object. [VERIFIED: codebase grep] |
| Template | `src/services/scanner.ts` | `runScanOnce`, changed/new/restored row updates | Refresh/clear/backfill metadata during sync. [VERIFIED: codebase grep] |
| Help | `src/llm/tool-dispatcher.ts` | `dispatchNativeToolCall`, `dispatchError`, footer helpers | Extract native core without delegated behavior drift. [VERIFIED: codebase grep] |
| Help | `src/llm/tool-registry.ts` | `NativeToolResponse`, `NativeToolDispatchContext`, `NativeToolDefinition` | Shared core should reuse these types. [VERIFIED: codebase grep] |
| Help | `src/mcp/server.ts` | `createMcpServer`, existing wrappers, host initializers | Install handler capture/takeover near wrapper setup and after SDK registration semantics are understood. [VERIFIED: codebase grep] |
| Help | `src/mcp/tool-catalog.ts` | `wrapServerWithToolCatalog`, `registerUncatalogedTool` | Inject `help` into native catalog/SDK registration only; brokered stays uncataloged. [VERIFIED: codebase grep] |
| Help | `src/mcp/host-brokered-tools.ts` | `registerHostBrokeredTools` | Delegate brokered calls to captured SDK handler; do not reimplement. [VERIFIED: codebase grep] |
| Help | `src/mcp/tool-exposure.ts` | `resolveHostToolExposure` | Host allow-list is the dispatch gate. [VERIFIED: codebase grep] |

## Recommended Plan Decomposition

| Plan | Name | Depends On | Owns Requirements | Required Tests |
|------|------|------------|-------------------|----------------|
| 144-01 | Template silent skip and consumer regression | — | Template REQ-001, 002, 003, 007, 008, 009, 010 | T-U-001..005, T-I-008/009, T-S-001..004. [CITED: product test plan] |
| 144-02 | `template_meta` schema and population | 144-01 | Template REQ-004, 005 | T-U-006, T-I-001..003. [CITED: product test plan] |
| 144-03 | Index-backed template discovery | 144-02 | Template REQ-006 | T-I-004..007 plus registry regressions. [CITED: product test plan] |
| 144-04 | `list_purposes` template shape and docs contract | 144-03 | Template REQ-011 | T-U-007, T-S-005/006, update help contract. [CITED: product test plan] |
| 144-05 | Shared native dispatch core | — | Help REQ-001, 002, 005 | T-U-001..005, T-U-007/008. [CITED: product test plan] |
| 144-06 | Host help parity and broker pass-through | 144-05 | Help REQ-003, 004, 006, 007 | T-U-006, T-E-001..010. [CITED: product test plan] |

Plans 144-01..04 and 144-05..06 can be developed as mostly independent tracks, but the final phase gate should run both focused suites because both touch `call_model`/MCP surfaces. [ASSUMED]

## Runtime State Inventory

Phase 144 is a schema/data migration and request-path refactor; runtime state matters. [CITED: execution_flow]

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Existing `fqc_documents` rows lack `template_meta`. [VERIFIED: codebase grep] | Add migration column, populate future writes/scans, and run/trigger a full `maintain_vault` sync backfill before relying on index discovery. [CITED: product requirements] |
| Live service config | Host exposure config comes from `host_mcp_tools` / `host` parsing and `getResolvedHostToolExposure`; no external UI config was found in repo scope. [VERIFIED: codebase grep] | No external migration; tests should use existing host-filtered fixture. [VERIFIED: codebase grep] |
| OS-registered state | None identified; FlashQuery runs as a spawned CLI/MCP process. [VERIFIED: AGENTS.md] | None. |
| Secrets/env vars | `.env.test` exists locally and integration/E2E tests depend on Supabase and embedding credentials. [VERIFIED: environment; VERIFIED: AGENTS.md] | Planner should keep integration/E2E tasks tolerant of skipped tests when credentials are incomplete. [VERIFIED: AGENTS.md] |
| Build artifacts | `dist/` may be stale after TypeScript changes. [ASSUMED] | Run `npm run build` in final validation. [VERIFIED: package.json] |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build, Vitest, FlashQuery runtime | Yes | `v24.7.0` | Project requires >=20. [VERIFIED: environment; VERIFIED: package.json] |
| npm | Scripts and registry checks | Yes | `11.5.1` | — [VERIFIED: environment] |
| Python 3 | Directed scenario runner | Yes | `3.12.3` | — [VERIFIED: environment] |
| `.env.test` | Integration/E2E Supabase credentials | Yes | present | Tests may skip if values incomplete. [VERIFIED: environment; VERIFIED: AGENTS.md] |
| `psql` CLI | Manual DB inspection | No | — | Use app Supabase client/integration helpers; not required for planned tests. [VERIFIED: environment; ASSUMED] |
| Docker | Preflight compose validation | No | — | `npm run preflight` skips Docker validation automatically per pre-push skill. [VERIFIED: pre-push skill] |
| `gsd-sdk` | GSD commit/document workflow | Yes | command available | — [VERIFIED: environment] |

**Missing dependencies with no fallback:** none for planning. [VERIFIED: environment]

**Missing dependencies with fallback:** `psql` and Docker are absent; planner should not depend on manual `psql`, and Docker is not needed for Phase 144 focused tests. [VERIFIED: environment; ASSUMED]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.1` and directed Python scenario harness. [VERIFIED: package.json; VERIFIED: codebase grep] |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts`. [VERIFIED: codebase grep] |
| Quick run command | `npm test -- tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-dispatcher.test.ts tests/unit/native-tool-catalog.test.ts` [VERIFIED: package.json; VERIFIED: codebase grep] |
| Full suite command | `npm run lint && npm test && npm run test:integration -- tests/integration/template-tools.integration.test.ts tests/integration/supabase-schema-verify.test.ts && npm run test:e2e -- protocol http-transport mcp-broker && python3 tests/scenarios/directed/testcases/test_call_model_template_discovery.py --managed && npm run build` [VERIFIED: package.json; CITED: product test plans] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| Template REQ-001..003 | Skip ordinary docs, preserve real diagnostics, provider surface unchanged | unit | `npm test -- tests/unit/llm-template-tools.test.ts` | Yes, extend. [VERIFIED: codebase grep] |
| Template REQ-004 | DDL/schema verifies `template_meta` | unit/integration | `npm test -- tests/unit/supabase.test.ts && npm run test:integration -- tests/integration/supabase-schema-verify.test.ts` | Yes, extend. [VERIFIED: codebase grep] |
| Template REQ-005..006 | Populate metadata and query index | integration | `npm run test:integration -- tests/integration/template-tools.integration.test.ts` | Yes, extend. [VERIFIED: codebase grep] |
| Template REQ-007..009, 011 | Public discovery/search bounded and shape updated | directed/unit | `python3 tests/scenarios/directed/testcases/test_call_model_template_discovery.py --managed` and `npm test -- tests/unit/llm-discovery-content.test.ts` | Directed exists; unit file new. [VERIFIED: codebase grep] |
| Template REQ-010 | Macro output unchanged, no vault walk | integration | `npm run test:integration -- tests/integration/macro-call-macro-session.test.ts` | Yes, extend or add focused test. [VERIFIED: codebase grep] |
| Help REQ-001..002,005 | Shared core, help sentinel, footer trigger set | unit | `npm test -- tests/unit/llm-tool-dispatcher.test.ts tests/unit/native-tool-core.test.ts` | Dispatcher exists; core test new. [VERIFIED: codebase grep] |
| Help REQ-003,006 | Host call takeover and exposure gate | e2e | `npm run test:e2e -- tests/e2e/protocol.test.ts tests/e2e/http-transport.test.ts` | Yes, extend. [VERIFIED: codebase grep] |
| Help REQ-004 | Advertise optional help schema | unit/e2e | `npm test -- tests/unit/native-tool-catalog.test.ts && npm run test:e2e -- tests/e2e/protocol.test.ts` | Yes, extend. [VERIFIED: codebase grep] |
| Help REQ-007 | Brokered pass-through unchanged | e2e | `npm run test:e2e -- tests/e2e/mcp-broker.e2e.test.ts` | Yes, extend. [VERIFIED: codebase grep] |

### Sampling Rate

- **Per task commit:** Run the focused unit/integration/e2e command tied to the changed plan. [CITED: product test plans]
- **Per wave merge:** Run all tests for the relevant bug track. [ASSUMED]
- **Phase gate:** Run lint, focused unit, focused integration, focused E2E, directed scenario, and build. [CITED: product test plans; VERIFIED: package.json]

### Wave 0 Gaps

- [ ] `tests/unit/llm-discovery-content.test.ts` — covers Template REQ-011. [CITED: product test plan]
- [ ] `tests/unit/native-tool-core.test.ts` — covers Help REQ-001/002/005. [CITED: product test plan]
- [ ] Extend `tests/unit/llm-template-tools.test.ts`, `tests/integration/template-tools.integration.test.ts`, `tests/scenarios/directed/testcases/test_call_model_template_discovery.py`, `tests/unit/native-tool-catalog.test.ts`, `tests/e2e/protocol.test.ts`, `tests/e2e/http-transport.test.ts`, and `tests/e2e/mcp-broker.e2e.test.ts`. [CITED: product test plans; VERIFIED: codebase grep]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | No | Phase does not modify auth. [VERIFIED: phase scope] |
| V3 Session Management | No | MCP remains stateless; no server-side session state. [VERIFIED: AGENTS.md] |
| V4 Access Control | Yes | Host exposure allow-list via `hostEnabledToolNames`; hidden native tools delegate as unknown. [CITED: product requirements; VERIFIED: codebase grep] |
| V5 Input Validation | Yes | Zod schemas for native tool arguments; `help === true` sentinel only. [VERIFIED: codebase grep; CITED: product requirements] |
| V6 Cryptography | No | Phase does not add crypto. [VERIFIED: phase scope] |

### Known Threat Patterns for FlashQuery MCP

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Hidden tool enumeration through `help: true` | Information Disclosure | Gate host native dispatch on `hostEnabledToolNames`; delegate hidden/unknown names identically. [CITED: product requirements] |
| Brokered tool behavior drift | Tampering / Reliability | Delegate brokered calls to captured SDK handler and keep brokered errors unwrapped. [CITED: product requirements] |
| Invalid tool arguments bypass | Tampering | Keep Zod validation for non-help native calls. [VERIFIED: codebase grep] |
| Stale template metadata exposing retired templates | Information Disclosure / Reliability | Clear/refresh `template_meta` on write and scanner sync; filter active rows only. [CITED: product requirements] |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `dist/` may be stale after TypeScript changes. | Runtime State Inventory | Final build could pass locally without testing generated output freshness if skipped. |
| A2 | Plans 144-01..04 and 144-05..06 can be developed mostly independently. | Recommended Plan Decomposition | Hidden coupling may force reordering or combined validation. |
| A3 | Warning signs listed under pitfalls are expected symptoms. | Common Pitfalls | Planner may overweight heuristic checks. |
| A4 | Missing `psql` can be replaced by app/integration helpers. | Environment Availability | Manual DB investigation would need another tool if app helpers fail. |

## Open Questions (RESOLVED)

1. **Should schema verification become column-aware for `template_meta`?**
   - What we know: `verifySchema` currently checks required tables only. [VERIFIED: codebase grep]
   - Resolution: Yes. Plan 144-02 must update schema verification/tests so `template_meta` is explicitly recognized, including `tests/integration/supabase-schema-verify.test.ts`. Do not leave verification table-only. [RESOLVED 2026-05-21]

2. **What exact top-level permissive field name should be locked?**
   - What we know: Product docs propose moving `template_tools` to top level in permissive mode. [CITED: product requirements]
   - Resolution: Use top-level `template_tools` in permissive mode to minimize contract churn, and update `src/llm/help-content.ts` plus ATL-DS-07 together. [RESOLVED 2026-05-21]

3. **Can the Supabase JS filter express `template_meta->>fq_template = true` directly in the current client style?**
   - What we know: The requirement gives SQL query semantics. [CITED: product requirements]
   - Resolution: Implementation must verify the exact Supabase client syntax while executing Plan 144-03. If direct JSON-path filtering is awkward, create a small tested query helper rather than spreading query literals. This is an implementation detail, not a planning blocker. [RESOLVED 2026-05-21]

## Sources

### Primary (HIGH confidence)

- `.planning/phases/144-fix-template-warning-flood-and-host-help-convention-parity/144-CONTEXT.md` - locked decisions and deferred scope. [VERIFIED: file read]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Bugs/Template Warning Flood Bug/list-purposes-not-template-warning-flood Requirements.md` - Template REQ-001..011. [VERIFIED: file read]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Bugs/Template Warning Flood Bug/list-purposes-not-template-warning-flood Test Plan.md` - Template T-U/T-I/T-S test obligations. [VERIFIED: file read]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Bugs/Template Warning Flood Bug/list-purposes-not-template-warning-flood.md` - bug root cause and observed blast radius. [VERIFIED: file read]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Bugs/Help Convention Host-Model Parity/help-convention-not-wired-to-host-model-mcp-path Requirements.md` - Help REQ-001..007. [VERIFIED: file read]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Bugs/Help Convention Host-Model Parity/help-convention-not-wired-to-host-model-mcp-path Test Plan.md` - Help T-U/T-E test obligations. [VERIFIED: file read]
- `AGENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/REQUIREMENTS.md` - project constraints and v3.5 help/broker context. [VERIFIED: file read]
- Codebase grep and source reads across `src/llm`, `src/mcp`, `src/storage`, `src/services`, and `tests`. [VERIFIED: codebase grep]
- Context7 `/modelcontextprotocol/typescript-sdk` - `setRequestHandler`, `registerTool`, and `CallToolResult` documentation. [CITED: Context7]
- Installed SDK source under `node_modules/@modelcontextprotocol/sdk/dist/esm` - handler replacement behavior. [VERIFIED: installed SDK]

### Secondary (MEDIUM confidence)

- npm registry checks for `@modelcontextprotocol/sdk`, Vitest, and Zod current published versions. [VERIFIED: npm registry]

### Tertiary (LOW confidence)

- None used as a basis for implementation decisions.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries are existing dependencies and versions were checked in `package.json` / npm registry. [VERIFIED: package.json; VERIFIED: npm registry]
- Architecture: HIGH - product specs and current code agree on the relevant touch points. [CITED: product requirements; VERIFIED: codebase grep]
- Pitfalls: MEDIUM - primary risks are sourced from specs and code; symptom descriptions include limited assumptions. [CITED: product requirements; ASSUMED]

**Research date:** 2026-05-21
**Valid until:** 2026-06-20 for repo architecture; 2026-05-28 for MCP SDK handler-internal assumptions because SDK internals can change quickly. [ASSUMED]
