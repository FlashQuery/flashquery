# Requirements: v3.8 Codebase Audit Remaining Remediation

## Sources

- Requirements spec: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Remaining Remediation Requirements pt2/Codebase Audit Remaining Remediation Requirements.md`
- Test plan: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Remaining Remediation Requirements pt2/Codebase Audit Remaining Remediation Test Plan.md`
- Research: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Remaining Remediation Requirements pt2/Codebase Audit Remaining Remediation Research.md`
- Prior remediation spec: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Priority Remediation Requirements/Codebase Audit Priority Remediation Requirements.md`

## Invariants

- Public MCP tool contracts, response envelopes, and `isError: true` behavior must remain stable.
- ESM TypeScript strict-mode conventions remain mandatory; do not introduce CommonJS.
- Phase 153 document-tool decomposition must preserve schemas, logging intent, write-lock behavior, embedding scheduling, identity resolution, and plugin propagation.
- Package metadata changes must update `package-lock.json`.
- Logging additions must avoid credentials, API keys, document contents, record payloads, embedding vectors, and caller query text beyond existing safe identifiers.
- Phases 151-153 did not pursue repository-wide zero-cycle policy; Phase 154 targets the currently known residual `madge` cycle families left after the document/plugin and macro clusters were closed.
- This milestone still does not pursue package modernization beyond named metadata drift or broad Supabase access redesign.

## Phase 151: Quick Localized Cleanup

- [x] **REQ-001**: Embedding provider config errors are explicit.
  - OpenAI and OpenRouter providers must synchronously reject missing or empty `apiKey` values with messages naming the provider and `apiKey`.
  - Ollama must continue to construct without an API key.
  - `src/embedding/provider.ts` must not contain `config.apiKey!`.
  - Source: `FQ-AUDIT-0019`.

- [x] **REQ-002**: Vault absolute path access is interface-owned.
  - Plugin reconciliation must read vault files through a public `VaultManager` absolute-path resolver instead of casting to private `rootPath`.
  - The resolver must preserve existing vault-root and normalization behavior for relative vault paths.
  - `src/services/plugin-reconciliation.ts` must not contain the private-field cast.
  - Source: `FQ-AUDIT-0017`.

- [x] **REQ-003**: Inert projects seeder is removed.
  - Confirm no production import or call path depends on `src/projects/seeder.ts` or `initProjects`.
  - Delete the file and stale tests, or replace tests with an intentional absence guard.
  - `rg "initProjects|projects/seeder" src tests` must show no live production dependency.
  - Source: `FQ-AUDIT-0021`.

- [x] **REQ-004**: Cleanup-time pg close failures are not silently swallowed.
  - If `pgClient.end()` rejects in backup cleanup, log at debug level or intentionally propagate while preserving the primary backup error when both occur.
  - Production cleanup must not contain `.catch(() => {})`.
  - Cleanup logs must not include database credentials.
  - Source: `FQ-AUDIT-0020`.

- [x] **REQ-005**: Package metadata matches direct imports and bundled types.
  - Either list `esbuild` as a direct development dependency for the `tsup.config.ts` type import or remove the import.
  - Remove `@types/uuid` because `uuid` ships types.
  - Refresh `package-lock.json`.
  - `npm run knip` must not report resulting metadata drift.
  - Source: `FQ-AUDIT-IR-0001`.

## Phase 152: Type-Safety Cleanup Pass

- [x] **REQ-006**: Remaining selected double assertions are removed.
  - `src/mcp/utils/document-output.ts` must not contain `as unknown as Record<string, unknown>` for consolidated responses.
  - `src/services/scanner.ts` must not contain `as unknown as Promise` for active/missing or archived document selects.
  - Replacement types must preserve selected fields, including `template_meta` where currently requested.
  - Existing scanner and document-output behavior must remain externally unchanged.
  - Source: residual `FQ-AUDIT-0008`, `FQ-AUDIT-0016`.

- [x] **REQ-007**: LLM usage query typing and grouping avoid broad escapes.
  - Remove broad block-level disables for `no-explicit-any`, `no-unsafe-assignment`, `no-unsafe-call`, and `no-unsafe-member-access` around `applyEntityFilters` and `fetchRows`.
  - Type the chainable query methods used by the implementation.
  - Remove `Map.get(...)!.push(...)` or equivalent grouping non-null assertions.
  - Preserve `get_llm_usage` arithmetic, grouping, trace, recent, by-model, and by-purpose response shapes.
  - Source: `FQ-AUDIT-0006`, `FQ-AUDIT-0013`.

- [x] **REQ-008**: Records timing TODOs become instrumentation.
  - Filters-only `search_records` queries must log path, table name, row count if available, and elapsed milliseconds on success or failure.
  - Semantic/vector `search_records` queries must log the same safe timing metadata.
  - `src/mcp/tools/records.ts` must not contain `TODO LOG-01`.
  - Logs must not include raw payloads, vectors, or caller query text beyond existing safe identifiers.
  - Source: `FQ-AUDIT-0011`.

## Phase 153: Documents Tool Decomposition

- [x] **REQ-009**: Documents tool module is decomposed without behavior drift.
  - `registerDocumentTools(server, config)` remains the public import surface unless all production and test imports are updated consistently.
  - `write_document`, `get_document`, `archive_document`, `remove_document`, `copy_document`, and `move_document` registrations remain present.
  - Moved handlers preserve input schema, output shape, error handling, logging intent, write locks, embedding scheduling, identity resolution, and plugin propagation.
  - Shared helpers live under `src/mcp/tools/documents/` or `src/mcp/utils/` and must not recreate the document/plugin cycle cluster.
  - The entrypoint must become thin, and implementation files should stay below 500 lines unless justified in the implementation summary and accepted by the static guard.
  - Source: `FQ-AUDIT-0010`.

## Phase 154: Residual Import Cycle Cleanup

- [x] **REQ-010**: Config and LLM validation/registry imports are acyclic.
  - `src/config/loader.ts` must not import concrete LLM runtime, template-tool, or registry modules that import back into `config/loader.ts`.
  - Shared config-facing LLM validation constants and admission checks should move into dependency-light modules that do not import config runtime helpers.
  - LLM modules may import shared config types from a leaf module, but they must not create a runtime path back into `config/loader.ts`.
  - Current madge family: `config/loader.ts > llm/capabilities.ts`, `config/loader.ts > llm/tool-registry.ts`, and longer paths through `llm/template-tools.ts`, `embedding/provider.ts`, `llm/client.ts`, `llm/config-sync.ts`, `llm/purpose-template-bindings.ts`, `logging/logger.ts`, and `storage/supabase.ts`.
  - Source: post-implementation audit gap, Phase 154.

- [x] **REQ-011**: LLM runtime, template, reference, embedding, storage, and logging imports are acyclic.
  - Shared LLM error classes, chat/result types, template binding adapter types, injected-reference metadata, embedding dimension helpers, and config-sync adapter types must live in leaf modules that do not import concrete runtime modules.
  - `llm/client.ts`, `llm/resolver.ts`, `llm/config-sync.ts`, `llm/purpose-template-bindings.ts`, `llm/template-tools.ts`, `llm/reference-resolver.ts`, `llm/types.ts`, `embedding/provider.ts`, `embedding/background-embed.ts`, `storage/supabase.ts`, and `logging/logger.ts` must not form any madge cycle.
  - Behavior for model fallback, cost recording, config DB sync, template tools, document reference hydration, and background embedding must remain unchanged.
  - Current madge family: `llm/config-sync.ts > llm/purpose-template-bindings.ts`, `llm/client.ts > llm/resolver.ts`, and longer paths through `llm/reference-resolver.ts`, `mcp/utils/document-output.ts`, `embedding/background-embed.ts`, `storage/supabase.ts`, and `logging/logger.ts`.
  - Source: post-implementation audit gap, Phase 154.

- [x] **REQ-012**: MCP server and shutdown lifecycle imports are acyclic.
  - `src/mcp/server.ts` and `src/server/shutdown.ts` must not import each other directly or dynamically.
  - Shared MCP request lifecycle registration/drain state should live in a dependency-light module that both server startup and shutdown coordination can import.
  - Shutdown must continue to drain in-flight MCP requests with the 15-second deadline and preserve current register/unregister behavior.
  - Current madge family: `mcp/server.ts > server/shutdown.ts`.
  - Source: post-implementation audit gap, Phase 154.

## Future Requirements

- Repository-wide module-size policy.
- General typed Supabase query abstraction across the codebase.
- Package modernization beyond named metadata drift, including `uuid` latest-major-only drift.
- Any future import-cycle policy beyond the Phase 154 known residual cycle families.

## Phase 154 Required Tests

| Test ID | Requirement(s) | Layer | File / command | Required behavior |
|---|---|---|---|---|
| T-U-031 | REQ-010, REQ-011, REQ-012 | Unit/static | `tests/unit/circular-deps.test.ts` or `tests/unit/residual-import-cycles.test.ts` | Runs `npx --yes madge@8.0.0 src --extensions ts --circular` and asserts the final production `src/` graph has zero circular dependencies. If Matt explicitly approves a residual before phase close, this test must assert only the approved residuals remain and link to that approval. |
| T-U-032 | REQ-010 | Unit/static | same static guard suite | Fails if any madge cycle contains `config/loader.ts`. |
| T-U-033 | REQ-011 | Unit/static | same static guard suite | Fails if any madge cycle contains `llm/client.ts`, `llm/resolver.ts`, `llm/config-sync.ts`, `llm/purpose-template-bindings.ts`, `llm/template-tools.ts`, `llm/reference-resolver.ts`, `llm/types.ts`, `embedding/provider.ts`, `embedding/background-embed.ts`, `storage/supabase.ts`, or `logging/logger.ts`. |
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

## Out of Scope

- Reopening audit findings fully remediated by the first priority batch.
- Reintroducing `.planning/` into the source repository.
- Broad Supabase access-pattern redesign.
- Document tool semantic redesign, response text changes, embedding scheduling changes, identity behavior changes, or plugin propagation changes.

## Traceability

| Requirement | Phase | Test Plan Coverage |
|-------------|-------|--------------------|
| REQ-001 | 151 | T-U-001..T-U-004 |
| REQ-002 | 151 | T-U-005..T-U-007, T-I-001 |
| REQ-003 | 151 | T-U-008..T-U-009 |
| REQ-004 | 151 | T-U-010..T-U-011 |
| REQ-005 | 151 | T-U-012..T-U-015 |
| REQ-006 | 152 | T-U-016..T-U-018, T-I-002..T-I-003 |
| REQ-007 | 152 | T-U-019..T-U-022, T-S-001..T-S-002, T-Y-001..T-Y-002 |
| REQ-008 | 152 | T-U-023..T-U-025, T-I-004, T-Y-003 |
| REQ-009 | 153 | T-U-026..T-U-030, T-I-005..T-I-009, T-S-003..T-S-006, T-Y-004..T-Y-006 |
| REQ-010 | 154 | T-U-031, T-U-032, T-U-035, T-C-007, T-C-008, T-C-009, T-C-010 |
| REQ-011 | 154 | T-U-031, T-U-033, T-U-036, T-I-010, T-C-007, T-C-008, T-C-009, T-C-010, T-C-011 if triggered |
| REQ-012 | 154 | T-U-031, T-U-034, T-U-037, T-I-011, T-C-007, T-C-008, T-C-009, T-C-010 |
