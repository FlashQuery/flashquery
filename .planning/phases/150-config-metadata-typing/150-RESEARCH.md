# Phase 150: Config Metadata Typing - Research

**Researched:** 2026-05-24 [VERIFIED: init.phase-op]
**Domain:** TypeScript config runtime metadata, config accessor compatibility, and focused Vitest unit/static coverage [VERIFIED: .planning/phases/150-config-metadata-typing/150-CONTEXT.md]
**Confidence:** HIGH [VERIFIED: codebase grep + canonical remediation docs]

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Replace the `_deprecationWarnings`, `_startupWarnings`, `_resolvedHostToolExposure`, and `_rawLlmApiKeyRefs` side-channel reads/writes that currently use repeated `as unknown as Record<string, unknown>` casts.
- Preserve the external `FlashQueryConfig` shape unless the implementation deliberately documents internal fields.
- Preserve behavior for `getDeprecationWarnings`, `getStartupWarnings`, `getResolvedHostToolExposure`, and `getLlmApiKeyRefs`.
- Keep LLM API key references as raw environment references and do not persist or expose resolved secret values.
- Add focused unit coverage for T-U-026, T-U-027, T-U-028, and T-U-029.

### the agent's Discretion
- Choose between a `WeakMap<FlashQueryConfig, ConfigRuntimeMetadata>`, symbol-keyed metadata, or a narrow internal config type.
- Choose whether to place all new tests in `tests/unit/config-runtime-metadata.test.ts` or split one static assertion into an existing static/config test, as long as the required test IDs are covered clearly.

### Deferred Ideas (OUT OF SCOPE)
- Broader config loader restructuring is out of scope.
- Removing unrelated `as unknown as Record<string, unknown>` uses outside the selected metadata side-channel sites is out of scope unless a touched test helper must be updated.
- Integration, E2E, directed scenario, and YAML scenario coverage are not required for REQ-012.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-012 | Runtime-only config metadata is modeled without broad side-channel casts; deprecation warnings, startup warnings, host tool exposure, and raw LLM API key refs move to explicit internal typing, symbol metadata, or `WeakMap`, preserving accessors without leaking secrets. [CITED: Codebase Audit Priority Remediation Requirements.md §6.5.1] | Use a narrow typed metadata store in `src/config/loader.ts`, keep the four exported accessors as the only route for runtime metadata, and cover T-U-026..029 with unit/static tests. [VERIFIED: codebase grep + Codebase Audit Priority Remediation Test Plan.md §4.6.1] |
</phase_requirements>

## Summary

Phase 150 is a narrow type-safety remediation in `src/config/loader.ts`, not a config schema redesign. [VERIFIED: 150-CONTEXT.md] The current implementation builds a `FlashQueryConfig`, then attaches `_deprecationWarnings`, `_startupWarnings`, `_resolvedHostToolExposure`, and `_rawLlmApiKeyRefs` with repeated `(config as unknown as Record<string, unknown>)` writes; the four exported accessors read the same hidden fields. [VERIFIED: src/config/loader.ts:964-1017]

**Primary recommendation:** Use a module-local `WeakMap<FlashQueryConfig, ConfigRuntimeMetadata>` plus tiny helper functions such as `setConfigRuntimeMetadata` and `getConfigRuntimeMetadata`; keep public `FlashQueryConfig` unchanged and update tests that currently write `_rawLlmApiKeyRefs` directly to go through a typed helper path or load config from YAML. [ASSUMED]

The reason to prefer `WeakMap` is that it removes hidden string keys from config objects, avoids exporting internal fields, and fits metadata whose lifetime should follow the config object. [CITED: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakMap] It does introduce one important planning constraint: metadata will not survive object cloning, so tests and downstream code must pass the actual loaded config object to accessors. [CITED: Codebase Audit Priority Remediation Requirements.md §6.5.1]

Downstream planner and executor agents MUST read both canonical external docs before any implementation: [VERIFIED: 150-CONTEXT.md]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Priority Remediation Requirements/Codebase Audit Priority Remediation Requirements.md` [VERIFIED: filesystem read]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Priority Remediation Requirements/Codebase Audit Priority Remediation Test Plan.md` [VERIFIED: filesystem read]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Config metadata capture during YAML load | CLI / Backend process config layer | TypeScript type system | `loadConfig` parses YAML, expands env vars, resolves host exposure, and returns the runtime config object. [VERIFIED: src/config/loader.ts] |
| Config metadata accessors | CLI / Backend process config layer | MCP tool registration and LLM config sync consumers | `getResolvedHostToolExposure` is used by MCP server/compound code and `getLlmApiKeyRefs` is used by LLM config sync. [VERIFIED: rg getResolvedHostToolExposure/getLlmApiKeyRefs src] |
| Secret non-leakage for LLM API key refs | Backend config + LLM sync boundary | Supabase persistence | `syncLlmConfigToDb` persists `api_key_ref` from `getLlmApiKeyRefs`, so the accessor must return raw refs, not resolved provider secrets. [VERIFIED: src/llm/config-sync.ts:112] |
| Static selected-cast removal | Test/static validation | TypeScript compiler | T-U-029 explicitly targets selected side-channel casts in `loader.ts`, not unrelated casts elsewhere. [VERIFIED: 150-CONTEXT.md] |

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20 LTS; current local Node is `v24.7.0`. [VERIFIED: AGENTS.md + `node --version`]
- Use TypeScript strict mode and ESM; `tsconfig.json` has `"strict": true` and package conventions forbid CommonJS. [VERIFIED: AGENTS.md + tsconfig.json]
- Use Zod for external input validation; this phase must not replace the existing Zod config schema. [VERIFIED: AGENTS.md + src/config/loader.ts]
- Unit tests live under `tests/unit/*.test.ts` and run with `npm test`. [VERIFIED: AGENTS.md + package.json]
- Run `npm run typecheck` and `npm run lint` for final verification. [VERIFIED: AGENTS.md + package.json]
- Do not build a web UI; FlashQuery is CLI + MCP only. [VERIFIED: AGENTS.md]
- Do not use `npm link` for local development. [VERIFIED: AGENTS.md]
- MCP remains stateless; this phase must not introduce server-side session state. [VERIFIED: AGENTS.md]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 6.0.3 installed | Strict type modeling in `src/config/loader.ts`. [VERIFIED: npm ls] | Existing project language and strict compiler target. [VERIFIED: AGENTS.md + tsconfig.json] |
| Vitest | 4.1.7 installed | Unit/static tests for T-U-026..029. [VERIFIED: npm ls] | Existing unit framework; Vitest supports `describe`/`it`/`expect` and focused file execution. [VERIFIED: /vitest-dev/vitest Context7] |
| Zod | 4.4.3 installed | Existing config schema validation remains in place. [VERIFIED: npm ls] | Project convention requires Zod for external config validation. [VERIFIED: AGENTS.md] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:fs` | Node 24.7.0 runtime | Static T-U-029 can read `src/config/loader.ts` and assert selected broad metadata casts are absent. [VERIFIED: node --version + existing tests use node:fs] | Use in a unit/static test; no new package needed. [VERIFIED: tests/unit/config.test.ts] |
| `js-yaml` | 4.1.1 installed | Existing YAML parsing in `loadConfig`. [VERIFIED: npm ls + src/config/loader.ts] | Leave as-is; not part of the remediation. [VERIFIED: 150-CONTEXT.md] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `WeakMap<FlashQueryConfig, ConfigRuntimeMetadata>` | Symbol-keyed metadata | Symbol keys are typed by TypeScript and avoid string-name collisions, but still mutate the config object. [CITED: TypeScript Symbols docs via Context7] |
| `WeakMap<FlashQueryConfig, ConfigRuntimeMetadata>` | Internal intersection type such as `FlashQueryConfig & ConfigRuntimeFields` | This keeps metadata directly on the object and may be easiest for current tests, but it preserves runtime object fields unless carefully documented. [ASSUMED] |

**Installation:** No new runtime or dev dependencies are recommended for Phase 150. [VERIFIED: 150-CONTEXT.md + package.json]

## Package Legitimacy Audit

No external package installation is required for this phase, so the package legitimacy gate does not apply. [VERIFIED: 150-CONTEXT.md] `slopcheck` is locally available as `0.6.1`, but there are no new package candidates to audit. [VERIFIED: slopcheck --version]

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: no new packages planned]
**Packages flagged as suspicious [SUS]:** none. [VERIFIED: no new packages planned]

## Architecture Patterns

### System Architecture Diagram

```text
flashquery.yml
  |
  v
loadConfig()
  |
  +--> parse YAML / reject legacy fields / validate with Zod
  |
  +--> capture raw llm.providers[].api_key refs before env expansion
  |
  +--> expand env vars + camelCase config
  |
  +--> resolve host tool exposure
  |
  +--> create FlashQueryConfig object
  |
  +--> setConfigRuntimeMetadata(config, metadata)
  |
  v
FlashQueryConfig returned to callers
  |
  +--> getDeprecationWarnings(config) --------> CLI/doctor warning output
  +--> getStartupWarnings(config) ------------> CLI/doctor warning output
  +--> getResolvedHostToolExposure(config) ---> MCP server/compound host tool gating
  +--> getLlmApiKeyRefs(config) --------------> syncLlmConfigToDb api_key_ref
```

### Recommended Project Structure

```text
src/
└── config/
    └── loader.ts        # Keep metadata type, WeakMap/helpers, loadConfig writes, and accessors together. [ASSUMED]

tests/
└── unit/
    ├── config-runtime-metadata.test.ts  # Preferred focused T-U-026..029 home. [VERIFIED: Test Plan §4.6.1]
    └── llm-config-sync.test.ts          # Update direct _rawLlmApiKeyRefs helper if implementation removes hidden fields. [VERIFIED: tests/unit/llm-config-sync.test.ts]
```

### Pattern 1: Module-Local Runtime Metadata Store

**What:** Define `type ConfigRuntimeMetadata = { deprecationWarnings: string[]; startupWarnings: string[]; resolvedHostToolExposure: ResolvedHostToolExposure; rawLlmApiKeyRefs: Map<string, string>; }`, store it in a module-local `WeakMap<FlashQueryConfig, ConfigRuntimeMetadata>`, and make accessors read from the map. [CITED: Codebase Audit Priority Remediation Requirements.md §7.5]

**When to use:** Use when runtime-only metadata should not be part of serialized/public config shape. [ASSUMED]

**Example:**

```ts
// Source: REQ-012 canonical docs + MDN WeakMap docs.
type ConfigRuntimeMetadata = {
  deprecationWarnings: string[];
  startupWarnings: string[];
  resolvedHostToolExposure: ResolvedHostToolExposure;
  rawLlmApiKeyRefs: Map<string, string>;
};

const runtimeMetadata = new WeakMap<FlashQueryConfig, ConfigRuntimeMetadata>();

function setConfigRuntimeMetadata(config: FlashQueryConfig, metadata: ConfigRuntimeMetadata): void {
  runtimeMetadata.set(config, metadata);
}

function getConfigRuntimeMetadata(config: FlashQueryConfig): ConfigRuntimeMetadata | undefined {
  return runtimeMetadata.get(config);
}
```

### Pattern 2: Preserve Fallback Behavior in Accessors

**What:** `getResolvedHostToolExposure(config)` must return stored metadata when available and recompute `resolveHostToolExposure(config.hostMcpTools)` when metadata is absent. [VERIFIED: current src/config/loader.ts:995-1001 + Test Plan T-U-027]

**When to use:** Required for manually constructed test configs or callers that did not come from `loadConfig`. [VERIFIED: current accessor behavior]

### Anti-Patterns to Avoid

- **Object-shape side channels:** Do not write `_deprecationWarnings`, `_startupWarnings`, `_resolvedHostToolExposure`, or `_rawLlmApiKeyRefs` through `as unknown as Record<string, unknown>` in `loader.ts`. [CITED: Codebase Audit Priority Remediation Requirements.md §6.5.1]
- **Full config rewrite:** Do not reorganize schemas, normalization, env expansion, host exposure, LLM capability validation, or config file path behavior. [VERIFIED: 150-CONTEXT.md]
- **Resolved-secret persistence:** Do not derive `api_key_ref` from `config.llm.providers[].apiKey`; that value may be env-expanded. [VERIFIED: src/llm/config-sync.ts + tests/unit/llm-config-sync.test.ts]
- **Global removal of unrelated casts:** T-U-029 should only target selected metadata side-channel casts in `src/config/loader.ts`; unrelated casts in source/tests are outside scope. [VERIFIED: 150-CONTEXT.md + rg output]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Runtime metadata attachment | Custom string-key convention on config objects | `WeakMap<FlashQueryConfig, ConfigRuntimeMetadata>` or symbol-keyed typed metadata | Canonical requirements explicitly allow these typed options and reject broad side-channel casts. [CITED: Requirements §6.5.1] |
| Static cast detection | New parser or AST walker | Focused `node:fs` content assertion or existing lint infrastructure | T-U-029 only needs selected string/cast absence in one file. [VERIFIED: Test Plan §4.6.1] |
| Config validation | New validation system | Existing Zod schemas in `loader.ts` | Project convention and current loader already use Zod. [VERIFIED: AGENTS.md + src/config/loader.ts] |

**Key insight:** The behavior contract is the accessor surface, not the underscore fields. [VERIFIED: Requirements §6.5.1] Planning should protect accessor outputs and secret handling while deleting the hidden-field implementation detail. [ASSUMED]

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `fqc_llm_providers.api_key_ref` may store raw `${ENV_VAR}` references through `syncLlmConfigToDb`; Phase 150 must preserve this value source. [VERIFIED: src/llm/config-sync.ts] | Code/test edit only; no data migration. [VERIFIED: REQ-012 scope] |
| Live service config | None for underscore metadata; it is in-memory on loaded config objects. [VERIFIED: src/config/loader.ts grep] | None. [VERIFIED: REQ-012 scope] |
| OS-registered state | None; phase does not rename commands, services, process names, launchd/systemd units, or task registrations. [VERIFIED: 150-CONTEXT.md] | None. [VERIFIED: REQ-012 scope] |
| Secrets/env vars | Existing raw env refs such as `${OPENAI_API_KEY}` must remain raw in metadata and must not be replaced by resolved secret values. [VERIFIED: tests/unit/llm-config-sync.test.ts] | Preserve capture before env expansion; update tests around typed helper or real `loadConfig`. [VERIFIED: src/config/loader.ts:840-865] |
| Build artifacts | None; phase touches TypeScript source/tests only and no generated package output is required. [VERIFIED: 150-CONTEXT.md] | None. [VERIFIED: REQ-012 scope] |

## Common Pitfalls

### Pitfall 1: Losing Metadata on Cloned Configs
**What goes wrong:** With `WeakMap`, cloned/spread config objects do not carry metadata. [CITED: MDN WeakMap docs]
**Why it happens:** WeakMap keys are object identities, not structural values. [CITED: MDN WeakMap docs]
**How to avoid:** Keep accessors tolerant: warnings and raw refs return empty collections when metadata is missing; host exposure recomputes fallback. [VERIFIED: current src/config/loader.ts accessor behavior]
**Warning signs:** Tests construct configs manually and expect raw API refs without calling a helper or `loadConfig`. [VERIFIED: tests/unit/llm-config-sync.test.ts]

### Pitfall 2: Leaking Resolved API Keys
**What goes wrong:** `api_key_ref` stores `sk-*` or other resolved secret text instead of `${ENV_VAR}`. [VERIFIED: tests/unit/llm-config-sync.test.ts]
**Why it happens:** Raw refs are captured before env expansion, while `config.llm.providers[].apiKey` may be the expanded runtime secret. [VERIFIED: src/config/loader.ts:840-865]
**How to avoid:** T-U-028 should set `process.env`, load YAML with `${OPENAI_API_KEY}`, and assert `getLlmApiKeyRefs` returns the literal placeholder while the resolved secret is absent from refs. [ASSUMED]
**Warning signs:** Tests build a config with `apiKey: 'sk-resolved-secret'` and no typed metadata helper. [VERIFIED: tests/unit/llm-config-sync.test.ts]

### Pitfall 3: Over-Broad Static Assertion
**What goes wrong:** T-U-029 fails because unrelated casts remain in `loader.ts` or elsewhere. [VERIFIED: rg output]
**Why it happens:** The repo intentionally contains other casts for schema normalization and test doubles. [VERIFIED: rg output]
**How to avoid:** Assert absence of the four underscore metadata keys near broad casts, or assert no `as unknown as Record<string, unknown>` lines in `loader.ts` mention the four selected metadata keys. [ASSUMED]
**Warning signs:** A static test scans all `src` or all `tests` for the broad-cast string. [VERIFIED: 150-CONTEXT.md]

## Code Examples

### Accessor Preservation Pattern

```ts
// Source: current loader behavior + REQ-012 accepted WeakMap shape.
export function getResolvedHostToolExposure(config: FlashQueryConfig): ResolvedHostToolExposure {
  const metadata = getConfigRuntimeMetadata(config);
  if (metadata) return metadata.resolvedHostToolExposure;
  return resolveHostToolExposure(config.hostMcpTools);
}

export function getLlmApiKeyRefs(config: FlashQueryConfig): Map<string, string> {
  return getConfigRuntimeMetadata(config)?.rawLlmApiKeyRefs ?? new Map<string, string>();
}
```

### Focused Static Assertion Pattern

```ts
// Source: Test Plan T-U-029 + Vitest docs.
it('T-U-029 removes selected config metadata side-channel casts', () => {
  const source = readFileSync(new URL('../../src/config/loader.ts', import.meta.url), 'utf8');
  for (const key of [
    '_deprecationWarnings',
    '_startupWarnings',
    '_resolvedHostToolExposure',
    '_rawLlmApiKeyRefs',
  ]) {
    expect(source).not.toContain(`['_${key.slice(1)}']`);
  }
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hidden underscore fields written via broad casts | Typed internal metadata store or documented internal type | Phase 150 / REQ-012 [VERIFIED: ROADMAP.md] | Removes selected type-safety escape hatch while preserving public accessors. [CITED: Requirements §6.5.1] |
| Tests directly write `_rawLlmApiKeyRefs` onto config objects | Tests load config or use a typed internal/test helper | Phase 150 planning recommendation [ASSUMED] | Prevents test code from depending on the removed side-channel. [VERIFIED: tests/unit/llm-config-sync.test.ts] |

**Deprecated/outdated:**
- `_deprecationWarnings`, `_startupWarnings`, `_resolvedHostToolExposure`, and `_rawLlmApiKeyRefs` as string-keyed runtime fields in `FlashQueryConfig` are the selected remediation target. [CITED: Requirements §6.5.1]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `WeakMap<FlashQueryConfig, ConfigRuntimeMetadata>` is the best fit among the allowed implementation choices. | Summary / Architecture Patterns | Planner might choose symbol-keyed or internal intersection type instead; still acceptable under REQ-012 if behavior/tests pass. |
| A2 | New tests should prefer `tests/unit/config-runtime-metadata.test.ts`. | Recommended Project Structure | Planner may split static assertion into an existing config/static test; allowed by context. |
| A3 | T-U-028 should use real `loadConfig` YAML to prove raw refs survive env expansion. | Common Pitfalls | A typed helper test could still be acceptable if it proves the same non-leak contract. |

## Open Questions

1. **Should a metadata setter be exported for tests or kept module-private?** [ASSUMED]
   - What we know: Existing `llm-config-sync.test.ts` manually writes `_rawLlmApiKeyRefs` to simulate `loadConfig`. [VERIFIED: tests/unit/llm-config-sync.test.ts]
   - What's unclear: Whether planner prefers real YAML fixture coverage or a deliberately exported internal helper. [ASSUMED]
   - Recommendation: Prefer real `loadConfig` tests for REQ-012 and only export a helper if existing sync tests become awkward or slow. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | TypeScript/Vitest execution | yes | v24.7.0 | None needed; AGENTS requires >=20. [VERIFIED: node --version + AGENTS.md] |
| npm | Scripts and package metadata | yes | 11.5.1 | None needed. [VERIFIED: npm --version] |
| ripgrep | Static audit and grep verification | yes | 15.1.0 | `grep` if missing. [VERIFIED: rg --version] |
| TypeScript | `npm run typecheck` | yes | 6.0.3 | None needed. [VERIFIED: npm ls] |
| Vitest | Unit tests | yes | 4.1.7 | None needed. [VERIFIED: npm ls] |

**Missing dependencies with no fallback:** none. [VERIFIED: environment audit]

**Missing dependencies with fallback:** none. [VERIFIED: environment audit]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.7 [VERIFIED: npm ls] |
| Config file | `tests/config/vitest.unit.config.ts` [VERIFIED: filesystem read] |
| Quick run command | `npm test -- tests/unit/config-runtime-metadata.test.ts tests/unit/llm-config-sync.test.ts` [ASSUMED] |
| Full suite command | `npm test` [VERIFIED: package.json] |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-012 / T-U-026 | Deprecation/startup warning accessors preserve loaded metadata. [VERIFIED: Test Plan §4.6.1] | unit | `npm test -- tests/unit/config-runtime-metadata.test.ts` | No; Wave 0 create. [VERIFIED: find tests/unit] |
| REQ-012 / T-U-027 | `getResolvedHostToolExposure` returns stored value or recomputes fallback. [VERIFIED: Test Plan §4.6.1] | unit | `npm test -- tests/unit/config-runtime-metadata.test.ts` | No; Wave 0 create. [VERIFIED: find tests/unit] |
| REQ-012 / T-U-028 | `getLlmApiKeyRefs` returns raw env refs and does not leak resolved secrets. [VERIFIED: Test Plan §4.6.1] | unit negative | `npm test -- tests/unit/config-runtime-metadata.test.ts tests/unit/llm-config-sync.test.ts` | No; Wave 0 create/update. [VERIFIED: find tests/unit + llm-config-sync helper] |
| REQ-012 / T-U-029 | Selected metadata side-channel casts are removed from `loader.ts`. [VERIFIED: Test Plan §4.6.1] | static unit | `npm test -- tests/unit/config-runtime-metadata.test.ts` | No; Wave 0 create. [VERIFIED: find tests/unit] |

### Sampling Rate

- **Per task commit:** `npm test -- tests/unit/config-runtime-metadata.test.ts tests/unit/llm-config-sync.test.ts` [ASSUMED]
- **Per wave merge:** `npm test` plus `npm run typecheck` [VERIFIED: package.json]
- **Phase gate:** `npm run lint`, `npm run typecheck`, focused config tests, and `rg -n "as unknown as Record<string, unknown>.*_(deprecationWarnings|startupWarnings|resolvedHostToolExposure|rawLlmApiKeyRefs)|_(deprecationWarnings|startupWarnings|resolvedHostToolExposure|rawLlmApiKeyRefs).*as unknown as Record<string, unknown)" src/config/loader.ts` or equivalent selected-site check. [ASSUMED]

### Wave 0 Gaps

- [ ] `tests/unit/config-runtime-metadata.test.ts` — covers T-U-026..029. [VERIFIED: Test Plan §4.6.1]
- [ ] Update `tests/unit/llm-config-sync.test.ts` helper if production no longer supports `_rawLlmApiKeyRefs` side-channel. [VERIFIED: tests/unit/llm-config-sync.test.ts]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth behavior changes in this phase. [VERIFIED: REQ-012 scope] |
| V3 Session Management | no | MCP remains stateless and this phase changes config metadata only. [VERIFIED: AGENTS.md + REQ-012 scope] |
| V4 Access Control | no | Host tool exposure behavior must be preserved, not redesigned. [VERIFIED: REQ-012 + current accessor consumers] |
| V5 Input Validation | yes | Existing Zod config schemas remain the external validation layer. [VERIFIED: AGENTS.md + src/config/loader.ts] |
| V6 Cryptography | yes | Do not hand-roll crypto; relevant control is secret non-disclosure, not encryption changes. [VERIFIED: REQ-012] |

### Known Threat Patterns for Config Metadata Typing

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Resolved API key persisted as `api_key_ref` | Information Disclosure | Capture raw refs before env expansion and test `getLlmApiKeyRefs` does not expose resolved secrets. [VERIFIED: src/config/loader.ts + tests/unit/llm-config-sync.test.ts] |
| Host tool exposure metadata lost and replaced with wrong default | Elevation of Privilege | Preserve `getResolvedHostToolExposure` stored-value and fallback semantics. [VERIFIED: current accessor behavior + T-U-027] |
| Runtime metadata exposed as enumerable/public config fields | Information Disclosure | Prefer `WeakMap` or symbol-keyed metadata and keep accessors as public route. [CITED: Requirements §7.5] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/150-config-metadata-typing/150-CONTEXT.md` — locked scope, discretion, deferred ideas, and canonical references. [VERIFIED: filesystem read]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Priority Remediation Requirements/Codebase Audit Priority Remediation Requirements.md` — REQ-012 and Phase 6 boundaries. [VERIFIED: filesystem read]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Priority Remediation Requirements/Codebase Audit Priority Remediation Test Plan.md` — T-U-026..029. [VERIFIED: filesystem read]
- `src/config/loader.ts` — current metadata write/read implementation. [VERIFIED: filesystem read]
- `tests/unit/config.test.ts` and `tests/unit/llm-config-sync.test.ts` — existing accessor and raw-ref tests. [VERIFIED: filesystem read]
- `/vitest-dev/vitest` via Context7 — Vitest `describe`/`it`/`expect` and focused file execution docs. [VERIFIED: Context7]
- `/microsoft/typescript-website` via Context7 — symbol and unique-symbol typing docs. [VERIFIED: Context7]
- MDN WeakMap docs: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakMap — WeakMap object-key metadata behavior. [CITED: MDN]

### Secondary (MEDIUM confidence)

- `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md` — local milestone state and traceability. [VERIFIED: filesystem read]
- `AGENTS.md` — project coding/testing/security constraints. [VERIFIED: filesystem read]

### Tertiary (LOW confidence)

- None. [VERIFIED: source review]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — existing project dependencies and versions verified locally; no new package install recommended. [VERIFIED: npm ls]
- Architecture: HIGH — phase is localized to `src/config/loader.ts` accessors and one existing sync test helper. [VERIFIED: codebase grep]
- Pitfalls: HIGH — pitfalls are explicitly named by canonical requirements or observed in existing tests. [VERIFIED: Requirements §6.5.1 + tests/unit/llm-config-sync.test.ts]

**Research date:** 2026-05-24 [VERIFIED: current_date]
**Valid until:** 2026-06-23 for this narrow TypeScript refactor unless config loader shape changes first. [ASSUMED]
