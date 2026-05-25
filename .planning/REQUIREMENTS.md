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
- This milestone does not pursue repository-wide zero-cycle policy, package modernization beyond named metadata drift, or broad Supabase access redesign.

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

- [ ] **REQ-003**: Inert projects seeder is removed.
  - Confirm no production import or call path depends on `src/projects/seeder.ts` or `initProjects`.
  - Delete the file and stale tests, or replace tests with an intentional absence guard.
  - `rg "initProjects|projects/seeder" src tests` must show no live production dependency.
  - Source: `FQ-AUDIT-0021`.

- [ ] **REQ-004**: Cleanup-time pg close failures are not silently swallowed.
  - If `pgClient.end()` rejects in backup cleanup, log at debug level or intentionally propagate while preserving the primary backup error when both occur.
  - Production cleanup must not contain `.catch(() => {})`.
  - Cleanup logs must not include database credentials.
  - Source: `FQ-AUDIT-0020`.

- [ ] **REQ-005**: Package metadata matches direct imports and bundled types.
  - Either list `esbuild` as a direct development dependency for the `tsup.config.ts` type import or remove the import.
  - Remove `@types/uuid` because `uuid` ships types.
  - Refresh `package-lock.json`.
  - `npm run knip` must not report resulting metadata drift.
  - Source: `FQ-AUDIT-IR-0001`.

## Phase 152: Type-Safety Cleanup Pass

- [ ] **REQ-006**: Remaining selected double assertions are removed.
  - `src/mcp/utils/document-output.ts` must not contain `as unknown as Record<string, unknown>` for consolidated responses.
  - `src/services/scanner.ts` must not contain `as unknown as Promise` for active/missing or archived document selects.
  - Replacement types must preserve selected fields, including `template_meta` where currently requested.
  - Existing scanner and document-output behavior must remain externally unchanged.
  - Source: residual `FQ-AUDIT-0008`, `FQ-AUDIT-0016`.

- [ ] **REQ-007**: LLM usage query typing and grouping avoid broad escapes.
  - Remove broad block-level disables for `no-explicit-any`, `no-unsafe-assignment`, `no-unsafe-call`, and `no-unsafe-member-access` around `applyEntityFilters` and `fetchRows`.
  - Type the chainable query methods used by the implementation.
  - Remove `Map.get(...)!.push(...)` or equivalent grouping non-null assertions.
  - Preserve `get_llm_usage` arithmetic, grouping, trace, recent, by-model, and by-purpose response shapes.
  - Source: `FQ-AUDIT-0006`, `FQ-AUDIT-0013`.

- [ ] **REQ-008**: Records timing TODOs become instrumentation.
  - Filters-only `search_records` queries must log path, table name, row count if available, and elapsed milliseconds on success or failure.
  - Semantic/vector `search_records` queries must log the same safe timing metadata.
  - `src/mcp/tools/records.ts` must not contain `TODO LOG-01`.
  - Logs must not include raw payloads, vectors, or caller query text beyond existing safe identifiers.
  - Source: `FQ-AUDIT-0011`.

## Phase 153: Documents Tool Decomposition

- [ ] **REQ-009**: Documents tool module is decomposed without behavior drift.
  - `registerDocumentTools(server, config)` remains the public import surface unless all production and test imports are updated consistently.
  - `write_document`, `get_document`, `archive_document`, `remove_document`, `copy_document`, and `move_document` registrations remain present.
  - Moved handlers preserve input schema, output shape, error handling, logging intent, write locks, embedding scheduling, identity resolution, and plugin propagation.
  - Shared helpers live under `src/mcp/tools/documents/` or `src/mcp/utils/` and must not recreate the document/plugin cycle cluster.
  - The entrypoint must become thin, and implementation files should stay below 500 lines unless justified in the implementation summary and accepted by the static guard.
  - Source: `FQ-AUDIT-0010`.

## Future Requirements

- Repository-wide module-size policy.
- General typed Supabase query abstraction across the codebase.
- Package modernization beyond named metadata drift, including `uuid` latest-major-only drift.
- Repository-wide zero-cycle policy outside the targeted document/plugin regression boundary.

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
