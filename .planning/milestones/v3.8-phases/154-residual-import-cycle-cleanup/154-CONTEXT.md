# Phase 154 Context: Residual Import Cycle Cleanup

## Purpose

Phase 154 closes the residual production import cycles reported by `madge` after the targeted document/plugin and macro cycle clusters from `FQ-AUDIT-0005` were remediated.

This phase is not reopening `FQ-AUDIT-0005`. That finding remains closed for its named clusters. Phase 154 is a new follow-up for the unrelated baseline cycles still present in `src/`.

## Baseline Evidence

Command:

```bash
npx --yes madge src --extensions ts --circular
```

Current output reports 18 circular dependencies across three cycle families:

1. Config and LLM validation/registry cycles.
2. LLM runtime/template/reference/embedding/storage/logging cycles.
3. MCP server and shutdown lifecycle cycle.

## Requirements

### REQ-010: Config and LLM validation/registry imports are acyclic

Current import evidence:

- `src/config/loader.ts` imports `validateAllPurposeMode2Admissions` from `src/llm/capabilities.ts`.
- `src/config/loader.ts` imports `HARD_EXCLUDED_NATIVE_TOOLS` and `TOOL_TIERS` from `src/llm/tool-registry.ts`.
- LLM modules import `FlashQueryConfig` and runtime config helpers from `src/config/loader.ts`.
- `src/llm/tool-registry.ts` imports template-tool types from `src/llm/template-tools.ts`, and `template-tools.ts` imports back from `tool-registry.ts`.

Likely work:

- Extract shared config-facing LLM admission policy and tool-tier constants into dependency-light modules, such as `src/llm/config-policy.ts` or `src/config/llm-policy.ts`.
- Move `FlashQueryConfig` and related public config type declarations into a leaf type module if needed, such as `src/config/types.ts`.
- Ensure `config/loader.ts` depends only on leaf policy/type modules, not concrete LLM runtime/template modules.

Validation:

- T-U-031 final zero-cycle guard passes.
- T-U-032 has no `config/loader.ts` cycle in madge output.
- T-U-035 config/LLM policy regression tests pass.
- T-C-007 through T-C-010 pass.

### REQ-011: LLM runtime/template/reference/embedding/storage/logging imports are acyclic

Current import evidence:

- `src/llm/client.ts` imports `syncLlmConfigToDb`, `validatePersistedPurposeTemplateAdmissions`, and `PurposeResolver`.
- `src/llm/resolver.ts` imports concrete error/classes/types from `src/llm/client.ts`.
- `src/llm/config-sync.ts` imports `createPurposeTemplateSyncAdapter` from `src/llm/purpose-template-bindings.ts`.
- `src/llm/purpose-template-bindings.ts` imports `ConfigSyncAdapter` from `src/llm/config-sync.ts`.
- `src/llm/template-tools.ts` imports from `src/llm/reference-resolver.ts`, `src/llm/tool-registry.ts`, `src/storage/supabase.ts`, and `src/embedding/provider.ts`.
- `src/llm/reference-resolver.ts` imports `resolveAndBuildDocument` from `src/mcp/utils/document-output.ts` and scheduling helpers from `src/embedding/background-embed.ts`.
- `src/llm/types.ts` imports injected-reference metadata from `src/llm/reference-resolver.ts`.
- `src/storage/supabase.ts` imports `getEmbeddingDimensions` from `src/embedding/provider.ts`.
- `src/logging/logger.ts` imports `FlashQueryConfig` from `src/config/loader.ts`.

Likely work:

- Extract LLM error classes and chat/result interfaces into leaf modules, such as `src/llm/errors.ts` and `src/llm/runtime-types.ts`.
- Move `ConfigSyncAdapter` to a leaf module so `config-sync.ts` and `purpose-template-bindings.ts` do not import each other.
- Move injected-reference metadata types out of `reference-resolver.ts` into a type-only leaf module.
- Move embedding dimension defaults/helpers into a leaf constants module so storage does not import concrete embedding provider implementation.
- Keep document reference hydration behavior stable while separating type/policy imports from concrete runtime imports.

Validation:

- T-U-031 final zero-cycle guard passes.
- T-U-033 has no cycle involving `llm/client.ts`, `llm/resolver.ts`, `llm/config-sync.ts`, `llm/purpose-template-bindings.ts`, `llm/template-tools.ts`, `llm/reference-resolver.ts`, `llm/types.ts`, `embedding/provider.ts`, `embedding/background-embed.ts`, `storage/supabase.ts`, or `logging/logger.ts`.
- T-U-036 LLM/template/reference/embedding regression tests pass.
- T-I-010 selected `call_model` / document-reference hydration integration or directed scenario coverage passes, or skips only through existing environment gates.
- T-C-007 through T-C-010 pass.
- T-C-011 passes if shared LLM/native-tool types touched by macro call paths move.

### REQ-012: MCP server and shutdown lifecycle imports are acyclic

Current import evidence:

- `src/mcp/server.ts` imports `registerMcpServerForShutdown` and `unregisterMcpServerForShutdown` from `src/server/shutdown.ts`.
- `src/server/shutdown.ts` dynamically imports `getMcpRequestLifecycleForServer` from `src/mcp/server.ts`.

Likely work:

- Move MCP shutdown registration and lifecycle lookup into a dependency-light registry module, such as `src/mcp/request-lifecycle-registry.ts` or `src/server/mcp-lifecycle-registry.ts`.
- Have both `mcp/server.ts` and `server/shutdown.ts` import the registry module.
- Preserve current in-flight request tracking and 15-second shutdown drain behavior.

Validation:

- T-U-031 final zero-cycle guard passes.
- T-U-034 has no `mcp/server.ts > server/shutdown.ts` cycle, including dynamic-import edges.
- T-U-037 MCP lifecycle registry and server registration/correlation regression tests pass.
- T-I-011 `tests/integration/server/shutdown-mcp-drain.test.ts` passes.
- T-C-007 through T-C-010 pass.

## Required Tests

| Test ID | Requirement(s) | Layer | File / command | Required behavior |
|---|---|---|---|---|
| T-U-031 | REQ-010, REQ-011, REQ-012 | Unit/static | `tests/unit/circular-deps.test.ts` or `tests/unit/residual-import-cycles.test.ts` | Runs `npx --yes madge@8.0.0 src --extensions ts --circular` and asserts the final production `src/` graph has zero circular dependencies. If Matt explicitly approves a residual before phase close, this test must assert only the approved residuals remain and link to that approval. |
| T-U-032 | REQ-010 | Unit/static | same static guard suite | Fails if any madge cycle contains `config/loader.ts`; this should go red against the current baseline before the REQ-010 refactor and green after. |
| T-U-033 | REQ-011 | Unit/static | same static guard suite | Fails if any madge cycle contains the LLM runtime family: `llm/client.ts`, `llm/resolver.ts`, `llm/config-sync.ts`, `llm/purpose-template-bindings.ts`, `llm/template-tools.ts`, `llm/reference-resolver.ts`, `llm/types.ts`, `embedding/provider.ts`, `embedding/background-embed.ts`, `storage/supabase.ts`, or `logging/logger.ts`. |
| T-U-034 | REQ-012 | Unit/static | same static guard suite | Fails if any madge cycle contains both `mcp/server.ts` and `server/shutdown.ts`, including dynamic-import edges. |
| T-U-035 | REQ-010 | Unit/regression | existing config loader tests plus any new pure-policy tests | Config loading, LLM admission validation, hard-excluded native-tool behavior, tool-tier expansion, and runtime config metadata accessors behave the same after config-facing policy/constants move to leaf modules. |
| T-U-036 | REQ-011 | Unit/regression | existing LLM client/resolver/config-sync/purpose-template/template-tool/reference-resolver/embedding tests | Model fallback, LLM error classification, config DB sync, purpose-template binding validation, template tool schema assembly, document reference hydration, injected-reference metadata, embedding provider factory/dimensions, and background embedding scheduling behavior remain unchanged. Add narrow direct tests for newly extracted leaf modules where behavior is not already covered. |
| T-U-037 | REQ-012 | Unit/regression | MCP server registration/correlation tests, plus a narrow lifecycle registry test if introduced | MCP server creation registers lifecycle state; unregister cleanup removes it; request lifecycle lookup returns the same lifecycle object for a server while registered; correlation/catalog wrapping behavior remains unchanged. |
| T-I-010 | REQ-011 | Integration | selected `call_model` / document-reference hydration integration or directed scenario coverage | `call_model` with `{{ref:...}}` / `{{id:...}}` document references still hydrates messages and preserves injected-reference metadata. May skip only through existing environment gates. |
| T-I-011 | REQ-012 | Integration | `tests/integration/server/shutdown-mcp-drain.test.ts` | Shutdown still drains in-flight MCP requests with the 15-second deadline, reports timeout when handlers remain active, and unregisters closed-session lifecycle state. |
| T-C-007 | REQ-010, REQ-011, REQ-012 | Command | `npm run typecheck` | TypeScript project compiles after import-boundary refactors. |
| T-C-008 | REQ-010, REQ-011, REQ-012 | Command | `npm run lint` | ESLint passes with no warnings. |
| T-C-009 | REQ-010, REQ-011, REQ-012 | Command | `npm run knip` | Extracted leaf modules and moved exports are either used or explicitly, narrowly allow-listed with justification. |
| T-C-010 | REQ-010, REQ-011, REQ-012 | Command | `npm run build` | ESM build and declaration generation still pass. |
| T-C-011 | REQ-011 if macro-visible native tool / LLM types move | Command | `npm run test:macro-framework` | Required only if shared LLM/native-tool types touched by macro call paths move; macro framework behavior remains unchanged. |

## Test Implementation Notes

- Prefer extending `tests/unit/circular-deps.test.ts` if the file remains readable; otherwise create `tests/unit/residual-import-cycles.test.ts`.
- Keep the older Phase 149 targeted cycle assertions until the final zero-cycle guard is green and intentionally supersedes them.
- Static cycle tests should parse `madge` output by line and include matching cycle lines in failure messages.
- Add new direct unit tests only for newly extracted pure helpers/constants that are not already covered by existing config/LLM/template/reference tests.
- Integration or scenario tests that depend on external providers must use existing environment gates or deterministic local mocks.

## Phase Exit Criteria

- `npx --yes madge src --extensions ts --circular` exits 0 for production `src/`, unless Matt explicitly approves a documented residual before phase close.
- `npm run typecheck`, `npm run lint`, `npm run knip`, and `npm run build` pass.
- T-U-031 through T-U-037 pass.
- T-I-010 and T-I-011 pass or skip only through existing environment gates.
- T-C-007 through T-C-010 pass.
- T-C-011 passes if triggered by touched macro-visible types.
- Public MCP behavior and response envelopes remain unchanged.
