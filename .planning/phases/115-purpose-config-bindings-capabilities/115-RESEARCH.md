# Phase 115: Purpose Config, Bindings & Capabilities - Research

**Researched:** 2026-05-06
**Domain:** FlashQuery LLM config schema, Supabase config sync, purpose-template bindings, model capability admission
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

## Implementation Decisions

### Source of Truth

- Downstream agents MUST read the canonical ATL source documents before planning, implementing, reviewing, or verifying this phase.
- Requirements are authoritative from `Agentic-LLM-Tool-Loop.md`, `Document Reference System.md`, `ATL Test Plan.md`, `.planning/REQUIREMENTS.md`, and `.planning/ROADMAP.md`.
- If these documents conflict, prefer the newest locked requirement in `.planning/REQUIREMENTS.md` for phase assignment, then the detailed ATL source document section that defines the behavior.

### Purpose Config

- Purpose config accepts first-class orchestration fields `tools`, `excluded_tools`, and `templates`.
- Unknown top-level purpose fields must become config errors in the same coordinated change that adds those first-class fields.
- Purpose `defaults` remains permissive for provider pass-through parameters, but known FlashQuery loop guardrails must be type-validated when present.
- Known loop guardrails include at least `timeout_ms`, `max_cost_usd`, `max_tokens_budget`, `max_iterations`, and `result_summary_chars`.
- `response_format` remains in `defaults`, not as a first-class purpose field.
- `audit_document` is deferred from v1 and must not be accepted in normal v1 config unless a later phase explicitly changes that posture.

### Purpose-Template Bindings

- Add `fqc_purpose_templates` with canonical `template_path` identity.
- The unique binding identity is `(instance_id, purpose_name, template_path)`.
- Store source tracking for YAML vs runtime/API-created bindings.
- Runtime/API bindings use `source = 'api'` for this new table.
- Runtime/API bindings take precedence over YAML by occupying the unique slot.
- YAML sync skips an API-owned binding and logs a warning naming the specific binding identity.
- If an API binding is later removed, the YAML binding reappears on the next startup sync.
- Dangling template paths are lenient warnings in v1, not fatal startup sync errors.
- Template binding inputs may be ergonomic identifiers, but storage must normalize to vault-relative `template_path`.

### Config Sync

- Build or extend a generic `ConfigSyncAdapter<T>`-style service before or alongside `fqc_purpose_templates`.
- Purpose-template bindings are the first consumer of the generic sync flow.
- Do not add another inline copy of the YAML scrub/insert/skip algorithm.

### Model Capabilities

- Replace the old free-form model `capabilities: string[]` behavior surface with structured behavioral capabilities.
- Do not preserve two conflicting capability surfaces.
- Structured capabilities for this phase are:
  - `tool_calling: boolean`
  - `usage_on_tool_calls: boolean`
  - `strict_tools: boolean`
  - `parallel_tool_calls: boolean`
  - `structured_outputs_with_tools: boolean`
- Official OpenAI provider profile may default all five structured capabilities to true.
- OpenRouter, custom OpenAI-compatible providers, and Ollama default capabilities to unknown unless explicitly declared.
- Unknown and false both make a model ineligible for Mode 2, but diagnostics must distinguish "unknown declaration" from "declared unsupported".
- A purpose that can expose model-visible tools must fail validation unless every fallback model declares `tool_calling: true` and `usage_on_tool_calls: true`.
- Requests combining `response_format` with model-visible tools must fail when the selected model does not support `structured_outputs_with_tools`.
- Runtime/API template binding must run the same capability admission validation as YAML config.

### Validation And Tests

- Phase 115 must include runnable validation for config parse/admission, DDL/schema verification, config sync precedence, binding resolution, runtime capability validation, and public startup/config scenarios for user-visible admission errors.
- The plan must name exact test files and commands, including unit tests, TypeScript integration tests, and scenario commands where applicable.
- The ATL test plan is prescriptive. Use its Phase 115-relevant cases, especially `ATL-U-08`, `ATL-I-01`, `ATL-I-02`, `ATL-I-06`, `ATL-DS-07`, and `ATL-DS-14`, as coverage anchors.

### the agent's Discretion

- File/module boundaries may follow the existing codebase architecture discovered during research.
- The exact generic config sync API shape is at the implementing agent's discretion, provided it removes real duplication and supports purpose-template bindings cleanly.
- Compatibility handling for old `capabilities: string[]` can be migration, rename to `tags`, or removal, as long as the final system has one behavioral capability surface and tests lock the chosen behavior.

### Deferred Ideas (OUT OF SCOPE)

## Deferred Ideas

- Model-visible native tool registry and schema translation: Phase 116.
- Agent loop executor and internal native dispatch: Phase 117.
- Template discovery, generated template tool names, reverse map, and masquerade dispatch: Phase 118.
- Discovery diagnostics/help resolver expansion: Phase 119.
- Cross-phase ATL validation and coverage closure: Phase 120.
- Mode 3 cooperative loop, MCP Broker, model-initiated response references, audit document writes, and path-scoped delegated writes remain future requirements.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BIND-01 | Purpose config accepts first-class orchestration fields and rejects unknown top-level purpose fields. | Current `PurposeSchema` only accepts `name`, `description`, `models`, and `defaults`, then `.strip()` silently drops unknown keys. [VERIFIED: src/config/loader.ts:125] |
| BIND-02 | Purpose defaults pass provider params through while type-validating known loop guardrails. | Current `PurposeDefaultsSchema` is `z.record(z.string(), z.unknown())`, and loader restores defaults verbatim after snake-to-camel conversion. [VERIFIED: src/config/loader.ts:121] [VERIFIED: src/config/loader.ts:667] |
| BIND-03 | Schema verification creates `fqc_purpose_templates` with unique identity and source tracking. | Current DDL creates LLM provider/model/purpose/purpose-model/usage tables but not `fqc_purpose_templates`; `verifySchema` checks 10 tables and omits this table. [VERIFIED: src/storage/supabase.ts:441] [VERIFIED: src/storage/schema-verify.ts:50] |
| BIND-04 | Generic config sync supports YAML-to-DB adapter flows and API/runtime template precedence. | Current `syncLlmConfigToDb` is purpose-built inline logic that deletes YAML rows and preserves `webapp` rows, not a generic adapter. [VERIFIED: src/llm/config-sync.ts:27] |
| BIND-05 | Template binding inputs resolve ergonomic identifiers to normalized vault-relative `template_path` and warn on dangling bindings. | Existing document identifier ladder resolves UUID, path, and filename with ambiguity errors; only a minimal `normalizedReferencePath` helper exists in reference resolver, not a shared binding canonicalizer. [VERIFIED: src/mcp/utils/resolve-document.ts:82] [VERIFIED: src/llm/reference-resolver.ts:926] |
| CAP-01 | Model config supports structured capability booleans. | Current model schema and `FlashQueryConfig` type expose `capabilities?: string[]`. [VERIFIED: src/config/loader.ts:117] [VERIFIED: src/config/loader.ts:208] |
| CAP-02 | Existing free-form `capabilities: string[]` is migrated/replaced without two behavior surfaces. | Existing tests intentionally preserve arbitrary capability strings and `list_models` emits them verbatim, so tests must be updated with the chosen migration behavior. [VERIFIED: tests/unit/llm-config.test.ts:638] [VERIFIED: tests/unit/llm-tool.test.ts:1159] |
| CAP-03 | Mode 2 purposes fail config validation unless every fallback model declares required support. | Current config validation checks names, uniqueness, and cross-references only; no capability admission is present. [VERIFIED: src/config/loader.ts:387] |
| CAP-04 | Runtime/API template binding runs the same capability admission validation as YAML config. | Current MCP tools include `register_plugin` but no `bind_template` or purpose-template registration tool. [VERIFIED: src/mcp/tools/plugins.ts:30] [VERIFIED: rg registerTool/bind_template] |
| CAP-05 | `response_format` plus model-visible tools fails when model lacks structured-output-with-tools support. | Current call path uses text `complete()` wrappers and no Mode 2 tool-list admission; `response_format` remains generic provider params through `parameters`/purpose defaults. [VERIFIED: src/mcp/tools/llm.ts:330] [VERIFIED: src/llm/client.ts:180] |
| VAL-115 | Runnable unit, TypeScript integration, and public startup/config scenario tests cover config, schema, sync, bindings, and admission. | Test infrastructure already has unit, integration, directed, and YAML scenario surfaces, with Supabase integration skip helpers and managed scenario runners. [VERIFIED: package.json scripts] [VERIFIED: tests/helpers/test-env.ts:1] |
</phase_requirements>

## Summary

Phase 115 should be planned as a config and persistence admission phase, not as a tool-loop execution phase. The current codebase already has a three-layer LLM config loader, startup DB sync, discovery resolvers, chat/text wrappers, document identifier resolution, and template parameterization, but it does not yet have purpose orchestration fields, `fqc_purpose_templates`, generic config sync, or structured behavioral capabilities. [VERIFIED: src/config/loader.ts:81] [VERIFIED: src/llm/config-sync.ts:27] [VERIFIED: src/mcp/tools/llm.ts:174] [VERIFIED: src/storage/supabase.ts:441]

The highest-risk planning issue is sequencing. Add schema/types and failing validation tests first, then introduce the generic sync adapter and purpose-template table, then wire capability admission before any runtime path can create Mode 2 exposure. This preserves the ATL requirement that unsafe Mode 2 purposes fail before provider calls can run. [CITED: Agentic-LLM-Tool-Loop.md OQ-27] [CITED: ATL Test Plan ATL-U-08]

**Primary recommendation:** Plan five slices: config contract, schema/verification, generic sync + binding normalization, capability admission service, and public validation/scenario closure. [VERIFIED: .planning/ROADMAP.md Phase 115]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Purpose config parsing | CLI startup / config loader | API / Backend | `loadConfig()` parses YAML and builds `FlashQueryConfig` before server tools run. [VERIFIED: src/config/loader.ts:644] |
| Purpose-template persistence | Database / Storage | API / Backend | Bindings are durable Supabase rows and must be schema-verified at startup. [CITED: Document Reference System §10.3] |
| YAML-to-DB sync | API / Backend | Database / Storage | Existing LLM sync runs in `initLlm()` and writes Supabase config rows after client construction. [VERIFIED: src/llm/client.ts:604] |
| Template identifier normalization | API / Backend | Database / Storage | Existing identifier resolution lives in MCP utilities and uses vault + Supabase state. [VERIFIED: src/mcp/utils/resolve-document.ts:82] |
| Model capability admission | CLI startup / config loader | API / Backend | Admission must run post-parse after models and purposes are joined and before unsafe calls. [CITED: Agentic-LLM-Tool-Loop.md OQ-27] |
| Public diagnostics | MCP API / Backend | CLI startup | `call_model` discovery resolvers currently project model/purpose config without LLM dispatch. [VERIFIED: src/mcp/tools/llm.ts:174] |

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20 LTS, TypeScript strict mode, ESM, `@modelcontextprotocol/sdk`, Supabase clients, `pg`, `tsup`, `tsx`, and Vitest. [VERIFIED: AGENTS.md]
- Use `async/await`; module boundaries that can fail should return typed errors rather than thrown exceptions where established. [VERIFIED: AGENTS.md]
- MCP tool handlers catch internally and return `{ content: [{ type: "text", text: "..." }], isError: true }` on failure. [VERIFIED: AGENTS.md]
- Use Zod for external input validation, including config and MCP params. [VERIFIED: AGENTS.md]
- Keep ESM imports; do not use CommonJS or `@modelcontextprotocol/server`. [VERIFIED: AGENTS.md]
- FlashQuery is CLI + MCP only; do not build a web UI. [VERIFIED: AGENTS.md]
- MCP is stateless; do not implement server-side session state. [VERIFIED: AGENTS.md]
- Unit tests live under `tests/unit/*.test.ts`; TypeScript integration tests under `tests/integration/*.test.ts`; directed scenarios under `tests/scenarios/directed/testcases`; YAML integration scenarios under `tests/scenarios/integration/tests`. [VERIFIED: AGENTS.md]
- Integration and E2E tests require `.env.test` and skip gracefully when Supabase credentials are unavailable. [VERIFIED: AGENTS.md] [VERIFIED: tests/helpers/test-env.ts:1]
- Do not use `npm link` for local development. [VERIFIED: AGENTS.md]

## Standard Stack

### Core

| Library | Current Installed | Latest Verified | Purpose | Why Standard |
|---------|-------------------|-----------------|---------|--------------|
| TypeScript | `^6.0.2` | `6.0.3`, modified 2026-04-16 | Strict config and type contracts | Existing project language and strict-mode stack. [VERIFIED: package.json] [VERIFIED: npm registry] |
| Zod | `^4.3.6` | `4.4.3`, modified 2026-05-04 | YAML/MCP schema validation | Existing loader and MCP tools use Zod; Zod 4 supports strict/loose object patterns and custom validation. [VERIFIED: src/config/loader.ts:1] [VERIFIED: npm registry] [CITED: /websites/zod_dev_v4] |
| `@supabase/supabase-js` | `^2.100.0` | `2.105.3`, modified 2026-05-04 | Runtime table CRUD | Existing sync and tools use `.from().delete()/insert()/select()/maybeSingle()` style. [VERIFIED: src/llm/config-sync.ts:31] [VERIFIED: npm registry] [CITED: /supabase/supabase] |
| `pg` | `^8.20.0` | `8.20.0`, modified 2026-03-04 | DDL/schema verification | Existing `verifySchema()` uses `pg.Client` and `to_regclass`. [VERIFIED: src/storage/schema-verify.ts:1] [VERIFIED: npm registry] |
| Vitest | `^4.1.1` | `4.1.5`, modified 2026-05-05 | Unit/integration test runner | Existing scripts and configs use Vitest for unit/integration/E2E. [VERIFIED: package.json] [VERIFIED: npm registry] [CITED: /vitest-dev/vitest] |

### Supporting

| Library | Current Installed | Latest Verified | Purpose | When to Use |
|---------|-------------------|-----------------|---------|-------------|
| `tsx` | `^4.21.0` | `4.21.0`, modified 2025-11-30 | Dev CLI execution | Use existing `npm run dev` and managed scenario server startup. [VERIFIED: package.json] [VERIFIED: npm registry] |
| `tsup` | `^8.5.1` | `8.5.1`, modified 2025-11-12 | Production ESM build | Use `npm run build` for phase gate. [VERIFIED: package.json] [VERIFIED: npm registry] |
| `js-yaml` | `^4.1.1` | `4.1.1`, modified 2025-11-14 | YAML config parsing | Already used by `loadConfig()`. [VERIFIED: src/config/loader.ts:2] [VERIFIED: npm registry] |
| `gray-matter` | `^4.0.3` | `4.0.3`, modified 2023-07-12 | Vault frontmatter parsing | Template identity/existence checks should reuse existing frontmatter paths. [VERIFIED: src/storage/vault.ts:4] [VERIFIED: npm registry] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zod config validation | Manual validation | Reject: project mandates Zod for config/MCP params and current loader is Zod-based. [VERIFIED: AGENTS.md] [VERIFIED: src/config/loader.ts:1] |
| Supabase JS for sync CRUD | Raw SQL everywhere | Use raw SQL only for DDL/constraint verification; existing config sync uses Supabase JS query builder. [VERIFIED: src/llm/config-sync.ts:31] |
| Hand-coded per-table sync | Generic adapter | Use generic adapter because ATL explicitly forbids another inline YAML scrub/insert/skip algorithm. [CITED: Document Reference System §10.5] |

**Installation:**

```bash
npm install
```

No new runtime dependency is required for Phase 115 if the planner uses existing Zod, Supabase JS, `pg`, and Vitest. [VERIFIED: package.json]

## Architecture Patterns

### System Architecture Diagram

```text
flashquery.yml
  |
  v
loadConfig()
  |-- strict top-level config validation
  |-- LLM name normalization and cross-ref checks
  |-- purpose orchestration fields + loop default validation (Phase 115)
  |-- model structured capability defaults/admission (Phase 115)
  v
initLlm()
  |
  v
Generic Config Sync Service
  |-- delete YAML rows for instance
  |-- parse adapter entries
  |-- skip API/webapp-owned identity slots with warning
  |-- insert YAML rows
  v
Supabase
  |-- fqc_llm_models(capabilities jsonb, tags text[])
  |-- fqc_llm_purposes(tools jsonb, excluded_tools jsonb, defaults jsonb)
  |-- fqc_purpose_templates(instance_id, purpose_name, template_path, source)
  v
MCP call_model discovery / future Mode 2 admission
  |-- list_models structured capability diagnostics
  |-- list_purposes purpose/template diagnostics
  |-- model/purpose calls fail before provider dispatch when ineligible
```

### Recommended Project Structure

```text
src/
├── config/
│   └── loader.ts                  # Add schemas, normalization, admission hook
├── llm/
│   ├── capabilities.ts            # Structured capability defaults/diagnostics/admission
│   ├── config-sync.ts             # Generic adapter + existing LLM sync migration path
│   └── purpose-template-bindings.ts # Binding parse/normalize/sync helpers
├── storage/
│   ├── supabase.ts                # DDL for new/altered tables
│   └── schema-verify.ts           # Required table/column/constraint checks
└── mcp/
    └── tools/
        └── llm.ts                 # Discovery diagnostics and pre-dispatch validation hook
```

This structure follows current ownership: loader config, `src/llm` for LLM sync/client/resolver, `src/storage` for DDL and schema verification, and `src/mcp/tools/llm.ts` for public `call_model` behavior. [VERIFIED: AGENTS.md] [VERIFIED: src/config/loader.ts] [VERIFIED: src/llm/config-sync.ts] [VERIFIED: src/mcp/tools/llm.ts]

### Pattern 1: Strict Purpose Object, Permissive Defaults

**What:** Use a strict/known-key purpose schema for top-level orchestration fields while keeping `defaults` as `Record<string, unknown>` with targeted validation for known loop guardrails. [CITED: Agentic-LLM-Tool-Loop.md OQ-18]

**When to use:** Use this in `loadConfig()` so typos like `tols:` fail while provider-specific request params keep passing through. [CITED: Agentic-LLM-Tool-Loop.md OQ-18]

**Example:**

```ts
// Source: Zod v4 docs and existing loader pattern
const PurposeDefaultsSchema = z.record(z.string(), z.unknown()).superRefine((defaults, ctx) => {
  for (const key of ['timeout_ms', 'max_cost_usd', 'max_tokens_budget', 'max_iterations', 'result_summary_chars']) {
    if (key in defaults && typeof defaults[key] !== 'number') {
      ctx.addIssue({ code: 'custom', path: [key], message: `${key} must be a number` });
    }
  }
});
```

### Pattern 2: Capability Admission As A Pure Service

**What:** Implement capability defaulting and admission as a deterministic pure function over parsed config plus purpose exposure state. [CITED: Agentic-LLM-Tool-Loop.md OQ-27]

**When to use:** Use from config post-parse validation, runtime/API binding writes, and pre-dispatch checks for `response_format` plus tools. [CITED: Agentic-LLM-Tool-Loop.md OQ-27]

**Example:**

```ts
// Source: ATL OQ-27 contract
type ModelCapabilities = {
  tool_calling?: boolean;
  usage_on_tool_calls?: boolean;
  strict_tools?: boolean;
  parallel_tool_calls?: boolean;
  structured_outputs_with_tools?: boolean;
};

function requireMode2Capabilities(purposeName: string, modelNames: string[], modelsByName: Map<string, ModelConfig>) {
  for (const modelName of modelNames) {
    const caps = modelsByName.get(modelName)?.capabilities;
    if (caps?.tool_calling !== true || caps?.usage_on_tool_calls !== true) {
      return { ok: false, purposeName, modelName, reason: caps ? 'declared_unsupported' : 'unknown_declaration' };
    }
  }
  return { ok: true };
}
```

### Pattern 3: Generic Config Sync Adapter

**What:** Create a shared sync function that owns deletion of YAML rows, existing source lookup, skip/warn behavior, and row insertion; table-specific code supplies identity and row conversion. [CITED: Document Reference System §10.5]

**When to use:** Use immediately for `fqc_purpose_templates`; migrate existing provider/model/purpose sync only if doing so stays within phase scope. [CITED: Document Reference System §10.5]

**Example:**

```ts
// Source: DRS §10.5 adapter concept, adapted to current Supabase JS style
interface ConfigSyncAdapter<T> {
  tableName: string;
  parseYaml(config: FlashQueryConfig): T[];
  identityOf(entry: T): Record<string, string>;
  labelOf(entry: T): string;
  toRow(entry: T, instanceId: string): Record<string, unknown>;
}
```

### Anti-Patterns to Avoid

- **Adding `tools`/`templates` under `defaults`:** These are first-class orchestration fields, while `defaults` is provider/loop parameter pass-through. [CITED: Agentic-LLM-Tool-Loop.md OQ-18]
- **Leaving `.strip()` on purpose top-level schema:** This would keep silently discarding unknown purpose fields and violate BIND-01. [VERIFIED: src/config/loader.ts:125]
- **Keeping both string capabilities and structured capabilities:** The phase explicitly requires one behavioral surface. [CITED: Agentic-LLM-Tool-Loop.md OQ-27]
- **Resolving template binding shorthands without ambiguity checks:** Existing document resolution has an ambiguity error; binding normalization must preserve that diagnostic. [VERIFIED: src/mcp/utils/resolve-document.ts:251]
- **Adding another inline config sync implementation:** The DRS requires a generic adapter-style service. [CITED: Document Reference System §10.5]
- **Fatal startup failure for dangling template paths:** DRS says dangling paths are lenient warnings in v1. [CITED: Document Reference System §10.4]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing | Custom YAML parser | Existing `js-yaml` + `loadConfig()` | Loader already handles env expansion, name normalization, legacy field rejection, and defaults preservation. [VERIFIED: src/config/loader.ts:641] |
| Schema validation | Ad hoc string/object checks | Zod schemas plus `superRefine` | Project mandates Zod and current config/MCP inputs use it. [VERIFIED: AGENTS.md] [VERIFIED: src/mcp/tools/llm.ts:43] |
| Table CRUD sync | Raw SQL string builders | Supabase JS query builder in sync service | Existing sync uses `from().delete()/select()/insert()` and should remain consistent. [VERIFIED: src/llm/config-sync.ts:64] |
| Document identifier ladder | New filename/path resolver | `resolveDocumentIdentifier()` or extracted shared helper | Existing resolver handles UUID, path, filename, vault escape checks, reconciliation, and ambiguity. [VERIFIED: src/mcp/utils/resolve-document.ts:82] |
| Test environment detection | Custom env probing in each test | `tests/helpers/test-env.ts` and `describe.skipIf` | Existing integration helpers centralize Supabase availability. [VERIFIED: tests/helpers/test-env.ts:1] [CITED: /vitest-dev/vitest] |

**Key insight:** This phase is mostly about moving latent configuration semantics into typed, testable contracts; hand-rolled side paths would create bypasses around admission and sync precedence. [CITED: ATL Test Plan §13]

## Common Pitfalls

### Pitfall 1: Silent Purpose Field Stripping

**What goes wrong:** A typo such as `tols:` loads successfully and produces no Mode 2 exposure. [VERIFIED: src/config/loader.ts:125]

**Why it happens:** `PurposeSchema` currently uses `.strip()`. [VERIFIED: src/config/loader.ts:125]

**How to avoid:** Switch purpose top-level validation to strict known keys in the same change that adds `tools`, `excluded_tools`, and `templates`. [CITED: Agentic-LLM-Tool-Loop.md OQ-18]

**Warning signs:** Unit tests that expect unknown purpose fields to throw are missing or skipped. [CITED: ATL Test Plan ATL-U-08]

### Pitfall 2: Breaking Provider Param Pass-Through

**What goes wrong:** Validation of loop guardrails accidentally rejects provider-specific defaults. [CITED: Agentic-LLM-Tool-Loop.md OQ-18]

**Why it happens:** Guardrail validation is applied to all defaults keys instead of only known FlashQuery loop keys. [CITED: Agentic-LLM-Tool-Loop.md OQ-18]

**How to avoid:** Keep `defaults` as `Record<string, unknown>` and validate only known guardrails. [VERIFIED: src/config/loader.ts:121] [CITED: Agentic-LLM-Tool-Loop.md OQ-18]

**Warning signs:** Existing tests for arbitrary `defaults.custom_flag` fail. [VERIFIED: tests/unit/llm-config.test.ts:121]

### Pitfall 3: Two Capability Surfaces

**What goes wrong:** Discovery still emits free-form `capabilities: []` while admission reads structured `capabilities`, creating contradictory behavior. [VERIFIED: src/mcp/tools/llm.ts:215]

**Why it happens:** Existing tests lock arbitrary string preservation. [VERIFIED: tests/unit/llm-config.test.ts:638]

**How to avoid:** Choose one compatibility path in planning, preferably `capabilities: string[]` to `tags: string[]`, and update loader, DB schema, discovery, docs, and tests together. [CITED: Agentic-LLM-Tool-Loop.md OQ-27]

**Warning signs:** Both `tags` and old string `capabilities` appear in model responses as behavior-related fields. [CITED: Agentic-LLM-Tool-Loop.md OQ-27]

### Pitfall 4: Runtime Binding Bypasses Admission

**What goes wrong:** YAML config rejects an unsafe purpose, but a runtime/API binding can later expose template tools anyway. [CITED: Agentic-LLM-Tool-Loop.md OQ-27]

**Why it happens:** Runtime registration is planned separately from config validation. [CITED: ATL Test Plan ATL-I-06]

**How to avoid:** Implement admission as a reusable service called by both YAML config validation and runtime binding write paths. [CITED: Agentic-LLM-Tool-Loop.md OQ-27]

**Warning signs:** A runtime binding function inserts `source: api` directly into Supabase without calling capability admission. [CITED: ATL Test Plan ATL-I-06]

### Pitfall 5: Treating Dangling Bindings As Fatal

**What goes wrong:** Startup fails when a YAML binding references a template that has not been scanned or does not exist yet. [CITED: Document Reference System §10.4]

**Why it happens:** Binding sync conflates structural validity with current vault discoverability. [CITED: Document Reference System §10.4]

**How to avoid:** Normalize and store structurally valid paths, log WARN, and leave availability filtering to discovery/dispatch phases. [CITED: Document Reference System §10.4]

**Warning signs:** Integration tests expect dangling YAML binding sync to throw. [CITED: ATL Test Plan ATL-I-02]

## Code Examples

Verified patterns from current code and official docs:

### Current Supabase Sync Query Shape

```ts
// Source: src/llm/config-sync.ts
const { data: existing, error: lookupErr } = await client
  .from('fqc_llm_purposes')
  .select('id')
  .eq('instance_id', instanceId)
  .eq('name', purpose.name)
  .eq('source', 'webapp')
  .maybeSingle();
```

Use this query-builder style inside the generic sync service. [VERIFIED: src/llm/config-sync.ts:139] [CITED: /supabase/supabase]

### Current Loader Post-Parse Hook

```ts
// Source: src/config/loader.ts
if (result.data.llm) {
  normalizeLlmNames(result.data.llm);
  const llmErrors = validateLlmConfig(result.data.llm);
  if (llmErrors.length > 0) throw new Error(message);
}
```

Attach capability admission after name normalization and cross-reference checks. [VERIFIED: src/config/loader.ts:651]

### Current Discovery Projection

```ts
// Source: src/mcp/tools/llm.ts
if (m.capabilities !== undefined) entry['capabilities'] = m.capabilities;
```

Replace this with structured capabilities plus `tags` if the migration path is chosen. [VERIFIED: src/mcp/tools/llm.ts:215] [CITED: Agentic-LLM-Tool-Loop.md OQ-27]

## State of the Art

| Old Approach | Current Approach For Phase 115 | When Changed | Impact |
|--------------|--------------------------------|--------------|--------|
| Free-form model `capabilities: string[]` used as caller metadata | Structured capability booleans, with old metadata migrated/renamed/removed | ATL OQ-27 locked 2026-05-05 | Planner must update config schema, DB columns, discovery tests, and docs together. [CITED: Agentic-LLM-Tool-Loop.md OQ-27] |
| Purpose schema silently strips unknown top-level keys | Purpose schema rejects unknown top-level keys after adding first-class orchestration fields | ATL OQ-18 locked 2026-05-05 | Planner must couple new fields and strictness in one change. [CITED: Agentic-LLM-Tool-Loop.md OQ-18] |
| Per-table inline YAML sync | Generic adapter sync for purpose-template bindings first | DRS §10.5 locked 2026-05-05 | Planner should avoid broad migration unless necessary. [CITED: Document Reference System §10.5] |
| Legacy runtime source sentinel `webapp` for NLA config | New purpose-template runtime rows use `api`, while tests require `webapp` compatibility handling | ATL Test Plan updated 2026-05-05 | Planner must include `webapp` precedence tests even though context says runtime/API uses `api`. [CITED: ATL Test Plan ATL-I-01] |

**Deprecated/outdated:**

- Old model `capabilities: string[]` as behavior metadata is outdated for Phase 115. [CITED: Agentic-LLM-Tool-Loop.md OQ-27]
- `audit_document` in normal v1 config is out of scope and should not silently no-op. [CITED: Agentic-LLM-Tool-Loop.md OQ-18]
- `@modelcontextprotocol/server` must not be used; project uses `@modelcontextprotocol/sdk`. [VERIFIED: AGENTS.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Runtime/API template binding may require adding a new MCP tool or internal helper because no current `bind_template` tool exists. [ASSUMED] | Standard Stack / Validation | Planner may over-scope CAP-04 if the intended runtime API is a non-MCP internal API not yet documented. |

## Open Questions — RESOLVED

All Phase 115 research questions are resolved by the locked plan decisions below. These answers are authoritative for execution unless a later user decision supersedes them.

1. **What is the exact runtime/API template binding surface for CAP-04?**
   - What we know: ATL-I-06 says runtime template binding API depends on final registration tool name/API. [CITED: ATL Test Plan ATL-I-06]
   - What's unclear: Current code has no `bind_template` MCP tool or obvious purpose-template registration surface. [VERIFIED: rg registerTool/bind_template]
   - RESOLVED: Phase 115 implements an internal/shared runtime binding service only, with `bindPurposeTemplateRuntime` and `removePurposeTemplateRuntime` (or equivalent names) in `src/llm/purpose-template-bindings.ts`. No public MCP `bind_template`/runtime registration tool is added or accepted in Phase 115. CAP-04 is verified through unit and TypeScript integration coverage for the internal service and config sync precedence, not through an invented public YAML scenario. [VERIFIED: 115-03-PLAN.md] [VERIFIED: 115-05-PLAN.md]

2. **Should old `capabilities: string[]` become `tags: string[]` or be removed?**
   - What we know: Context allows migration, rename to `tags`, or removal, but requires one behavior surface. [VERIFIED: 115-CONTEXT.md]
   - What's unclear: Existing docs and scenarios expose old `capabilities` as public discovery metadata. [VERIFIED: docs/FlashQuery MCP Tool Guide.md] [VERIFIED: tests/scenarios/directed/DIRECTED_COVERAGE.md]
   - RESOLVED: Legacy free-form model `capabilities: string[]` migrates to `tags: string[]` for non-behavior metadata. Behavioral support is represented only by structured `capabilities` booleans: `tool_calling`, `usage_on_tool_calls`, `strict_tools`, `parallel_tool_calls`, and `structured_outputs_with_tools`. Discovery and tests must not preserve old string-array capabilities as a behavior surface. [VERIFIED: 115-01-PLAN.md] [VERIFIED: 115-04-PLAN.md] [VERIFIED: 115-05-PLAN.md]

3. **Should `fqc_llm_purposes` include `audit_document text` now?**
   - What we know: ATL Test Plan mentions `audit_document text` if finalized, but Phase 115 context says audit is deferred and must not be accepted in normal v1 config. [CITED: ATL Test Plan ATL-I-01] [VERIFIED: 115-CONTEXT.md]
   - What's unclear: Whether the planner wants a nullable reserved DB column despite config rejection.
   - RESOLVED: Phase 115 does not add `audit_document` to config parsing, discovery, runtime APIs, or storage. Purpose config must reject `audit_document` as an unknown top-level key. Audit document writes and related storage remain deferred until a later phase explicitly accepts that surface. [VERIFIED: 115-CONTEXT.md] [VERIFIED: 115-01-PLAN.md]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build/unit/integration/scenario managed server | yes | v24.7.0 | Project minimum is Node >=20. [VERIFIED: command output] [VERIFIED: package.json] |
| npm | Package scripts and version checks | yes | 11.5.1 | none needed. [VERIFIED: command output] |
| Python 3 | Directed/YAML scenario runners | yes | 3.12.3 | none needed. [VERIFIED: command output] |
| Supabase credentials | TypeScript integration and managed scenario DB checks | unknown | `.env.test` driven | Tests skip gracefully when env vars are absent. [VERIFIED: tests/helpers/test-env.ts:1] |
| Docker | Preflight docker compose validation | unknown | not found in probe output | Preflight docker script skips automatically if Docker is not installed. [VERIFIED: .agents/skills/pre-push/SKILL.md] |
| Knowledge graph | Optional graph context | no | disabled | Continue with code/source grep. [VERIFIED: graphify output] |

**Missing dependencies with no fallback:**

- None identified for research and planning. [VERIFIED: command output]

**Missing dependencies with fallback:**

- Supabase may be unavailable locally; integration tests use `.env.test` and skip helpers, but phase acceptance should run them in a configured environment. [VERIFIED: tests/helpers/test-env.ts:1]
- Docker may be unavailable; preflight docker validation skips automatically per project skill. [VERIFIED: .agents/skills/pre-push/SKILL.md]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `4.1.5` latest verified, installed `^4.1.1`; Python directed/YAML scenario runners. [VERIFIED: npm registry] [VERIFIED: package.json] |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts`. [VERIFIED: tests/config/vitest.unit.config.ts] |
| Quick run command | `npm test -- tests/unit/llm-config.test.ts tests/unit/llm-config-sync.test.ts tests/unit/llm-tool.test.ts tests/unit/schema-verify.test.ts` [VERIFIED: package.json] |
| Full suite command | `npm run build && npm test && npm run test:integration` plus targeted directed scenario command. [VERIFIED: package.json] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| BIND-01 | Purpose fields accepted, unknown top-level rejected | unit | `npm test -- tests/unit/llm-config.test.ts` | yes, extend [VERIFIED: tests/unit/llm-config.test.ts] |
| BIND-02 | Loop guardrail defaults validated, provider params pass through | unit | `npm test -- tests/unit/llm-config.test.ts` | yes, extend [VERIFIED: tests/unit/llm-config.test.ts] |
| BIND-03 | `fqc_purpose_templates` DDL/schema verifier | integration + unit | `npm run test:integration -- tests/integration/supabase-schema-verify.test.ts` and `npm test -- tests/unit/schema-verify.test.ts` | yes, extend [VERIFIED: tests/integration/supabase-schema-verify.test.ts] |
| BIND-04 | Generic config sync API/YAML precedence | unit + integration | `npm test -- tests/unit/llm-config-sync.test.ts` and `npm run test:integration -- tests/integration/llm-config-sync.test.ts` | unit yes; integration gap [VERIFIED: tests/unit/llm-config-sync.test.ts] |
| BIND-05 | Binding identifier normalization and dangling warning | unit + integration | `npm test -- tests/unit/llm-config-sync.test.ts tests/unit/reference-resolver.test.ts` | yes, extend [VERIFIED: tests/unit/reference-resolver.test.ts] |
| CAP-01 | Structured capability schema/defaults | unit | `npm test -- tests/unit/llm-config.test.ts` | yes, extend |
| CAP-02 | Old capabilities migration/removal | unit + directed | `npm test -- tests/unit/llm-config.test.ts tests/unit/llm-tool.test.ts` | yes, update |
| CAP-03 | Fallback-chain Mode 2 admission | unit | `npm test -- tests/unit/llm-config.test.ts` | yes, extend |
| CAP-04 | Runtime/API binding uses admission | unit/integration or blocked scenario | `npm run test:integration -- tests/integration/llm-config-sync.test.ts` | file gap |
| CAP-05 | `response_format` plus tools unsupported fails pre-dispatch | unit + directed | `npm test -- tests/unit/llm-tool.test.ts` and `python3 tests/scenarios/directed/run_suite.py --managed test_call_model_agent_loop_capabilities` | unit yes, scenario gap |
| VAL-115 | Public startup/config admission errors | directed scenario | `python3 tests/scenarios/directed/run_suite.py --managed test_call_model_agent_loop_capabilities` | gap |

### Sampling Rate

- **Per task commit:** `npm test -- <focused test files>` plus `npm run build` for type/schema changes. [VERIFIED: package.json]
- **Per wave merge:** `npm run build && npm test && npm run test:integration -- tests/integration/supabase-schema-verify.test.ts tests/integration/llm-config-sync.test.ts`. [VERIFIED: package.json]
- **Phase gate:** Full focused unit/integration gate plus `python3 tests/scenarios/directed/run_suite.py --managed test_call_model_agent_loop_capabilities`; YAML integration only if runtime API is named. [CITED: ATL Test Plan ATL-DS-14] [CITED: ATL Test Plan ATL-INT-04]

### Wave 0 Gaps

- [ ] `tests/integration/llm-config-sync.test.ts` - covers BIND-04/BIND-05/CAP-04 with real Supabase rows. [CITED: ATL Test Plan ATL-I-02]
- [ ] `tests/scenarios/directed/testcases/test_call_model_agent_loop_capabilities.py` - covers CAP-03/CAP-05/VAL-115 public startup/config admission diagnostics. [CITED: ATL Test Plan ATL-DS-14]
- [ ] `tests/scenarios/integration/tests/atl_template_binding_runtime_yaml_precedence.yml` - covers API binding removal then YAML reappearance if runtime API is available. [CITED: ATL Test Plan ATL-INT-04]
- [ ] `src/llm/capabilities.ts` - shared admission/defaulting service. [CITED: Agentic-LLM-Tool-Loop.md OQ-27]
- [ ] `src/llm/purpose-template-bindings.ts` - binding normalization and adapter consumer. [CITED: Document Reference System §10.5]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Phase does not add auth surfaces; existing MCP auth remains unchanged. [VERIFIED: phase context] |
| V3 Session Management | no | MCP remains stateless per AGENTS.md. [VERIFIED: AGENTS.md] |
| V4 Access Control | yes | Purpose-level tool/template exposure is an authorization boundary for delegated models. [CITED: Agentic-LLM-Tool-Loop.md §5.3] |
| V5 Input Validation | yes | Zod config schemas, binding normalization, and capability admission diagnostics. [VERIFIED: src/config/loader.ts:1] |
| V6 Cryptography | no | No new cryptographic operations; API key ref handling must continue never persisting resolved secrets. [VERIFIED: src/llm/config-sync.ts:24] |

### Known Threat Patterns for FlashQuery ATL Config

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unsafe tool exposure through typo or unknown field | Elevation of privilege | Strict purpose top-level schema and tests for unknown fields. [CITED: Agentic-LLM-Tool-Loop.md OQ-18] |
| Runtime binding bypasses YAML validation | Elevation of privilege | Shared capability admission service called from YAML and runtime/API writes. [CITED: Agentic-LLM-Tool-Loop.md OQ-27] |
| Provider capability mismatch after declaration | Tampering / Reliability | Fail with actionable LLM error when declared `usage_on_tool_calls` is violated. [CITED: Agentic-LLM-Tool-Loop.md OQ-27] |
| Secret leakage in config sync | Information disclosure | Preserve existing `api_key_ref` behavior: store raw env ref, not resolved secret. [VERIFIED: src/llm/config-sync.ts:24] |
| Path traversal in template binding normalization | Tampering | Reuse existing vault path escape checks from document identifier resolution. [VERIFIED: src/mcp/utils/resolve-document.ts:134] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/115-purpose-config-bindings-capabilities/115-CONTEXT.md` - locked user decisions and canonical refs. [VERIFIED: file read]
- `.planning/REQUIREMENTS.md` - BIND/CAP/VAL requirements. [VERIFIED: file read]
- `.planning/ROADMAP.md` - Phase 115 success criteria and boundaries. [VERIFIED: file read]
- `.planning/STATE.md` - milestone history and prior phase decisions. [VERIFIED: file read]
- `Agentic-LLM-Tool-Loop.md` - OQ-18, OQ-19, OQ-20, OQ-27 capability/config contracts. [CITED: local canonical source]
- `Document Reference System.md` - §10 purpose-template bindings, §12 YAML config, generic sync. [CITED: local canonical source]
- `ATL Test Plan.md` - ATL-U-08, ATL-I-01, ATL-I-02, ATL-I-06, ATL-DS-14, ATL-INT-04. [CITED: local canonical source]
- `ATL Implementation Gap.md` - prior gaps; Phase 112 gaps resolved, no Phase 115-specific current gap section found. [CITED: local canonical source]
- `AGENTS.md` - project constraints. [VERIFIED: file read]
- Current source files: `src/config/loader.ts`, `src/llm/config-sync.ts`, `src/storage/supabase.ts`, `src/storage/schema-verify.ts`, `src/mcp/tools/llm.ts`, `src/mcp/utils/resolve-document.ts`, `src/llm/reference-resolver.ts`. [VERIFIED: codebase grep/read]

### Secondary (MEDIUM confidence)

- Context7 `/websites/zod_dev_v4` - Zod 4 strict/loose object and custom validation guidance. [CITED: Context7]
- Context7 `/supabase/supabase` - Supabase JS insert/select/type-support examples. [CITED: Context7]
- Context7 `/vitest-dev/vitest` - `describe.skipIf`/`test.skipIf` behavior. [CITED: Context7]
- npm registry version checks for TypeScript, Zod, Supabase JS, Vitest, MCP SDK, `pg`, `tsx`, `tsup`, `js-yaml`, `gray-matter`. [VERIFIED: npm registry]

### Tertiary (LOW confidence)

- A1 runtime API surface recommendation because no `bind_template` tool exists and ATL-I-06 explicitly says API name is unresolved. [ASSUMED]

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - package versions verified via npm registry and project package.json. [VERIFIED: npm registry] [VERIFIED: package.json]
- Architecture: HIGH - code paths verified in loader, LLM sync, storage, schema verification, and MCP tool modules. [VERIFIED: codebase grep/read]
- Pitfalls: HIGH - major pitfalls are directly pinned by ATL/DRS/test-plan sources and current code evidence. [CITED: canonical ATL docs] [VERIFIED: codebase grep/read]

**Research date:** 2026-05-06
**Valid until:** 2026-06-05 for codebase structure; 2026-05-13 for package latest-version claims. [ASSUMED]
