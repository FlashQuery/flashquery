# Phase 130: Foundation, Metadata, Broker Shim, Archive Lock - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning
**Source:** Macro Language requirements and test plan supplied by user

<domain>
## Phase Boundary

Phase 130 is the foundation slice for FlashQuery Macro Language v0. It does not implement the parser, evaluator, shell verbs, dispatch engine, task lifecycle, progress modes, source resolution, or scenario matrices. It establishes the additive shared surfaces that later macro phases consume:

- Macro response/type exports in `src/mcp/utils/response-formats.ts`.
- `call_macro` metadata and a safe MCP tool registrar scaffold.
- A broker-ready `McpBroker` interface and `NullMcpBroker` implementation.
- The scoped `archive_document` write-lock bug fix.
- Focused unit and integration tests for those surfaces.

</domain>

<decisions>
## Implementation Decisions

### D-01 Canonical Source Documents
- Downstream agents MUST read the external Macro Language requirements spec before planning or implementing Phase 130: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Requirements.md`.
- Downstream agents MUST read the external Macro Language test plan before planning or implementing Phase 130: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Test Plan.md`.
- If local `.planning/REQUIREMENTS.md` or `.planning/ROADMAP.md` conflicts with those external docs for macro language behavior, treat the external requirements spec and test plan as the higher-fidelity source, then update local planning docs only through normal planning workflow.

### D-02 Response-Format Additions
- Implement only additive exports in `src/mcp/utils/response-formats.ts`.
- Preserve existing exports and helper behavior: `jsonToolResult`, `jsonExpectedError`, `jsonRuntimeError`, `withWarnings`, `ErrorEnvelope`, `ToolResult`, `CANONICAL_ERROR_CODES`, and `WarningCode`.
- Add `MACRO_ERROR_CODES`, `MacroErrorCode`, `TraceStep`, `MacroExecutionResult`, `MacroDryRunResult`, `MacroSuccessPayload`, and `macroResult(payload)`.
- `TraceStep` is a flat record shape with no `children` support in v0: `kind`, optional `name`, `args`, `result`, `message`, required ISO `at`, and optional `elapsed_ms`.

### D-03 `call_macro` Metadata and Registrar Scaffold
- Add `D.callMacro` in `src/mcp/tool-metadata.ts` using the existing four-line description format: Summary, Use when, Do not use when, Example.
- Add a metadata entry equivalent to `current('call_macro', ['llm'], 'admin', D.callMacro, RECURSIVE_MODEL_REASON)` near `call_model`.
- Preserve existing legacy replacement behavior for `get_briefing` and `insert_doc_link`, which already point to `call_macro`.
- Add a new registrar, likely `src/mcp/tools/macro.ts`, with `registerMacroTools(server, config)`.
- Wire `registerMacroTools(server, config)` into `src/mcp/server.ts` after `registerLlmUsageTools(server, config)` and before schema validation.
- The Phase 130 handler is a safe scaffold only: it registers `call_macro` and returns a canonical not-implemented/unsupported response. Later phases replace the stub with full source validation and execution.

### D-04 Broker Shim
- Add `src/services/mcp-broker.ts`.
- Export `McpBroker` with at least `isConnected(serverId: string): Promise<boolean>` and `getToolHandler(serverId: string, toolName: string): ToolFn | null` or an equivalent callable type.
- Export `NullMcpBroker` where `isConnected(_)` always resolves `false` and `getToolHandler(_, _)` always returns `null`.
- Keep this shim independent from the future MCP Broker Support implementation; Phase 130 creates the seam, not the real broker.

### D-05 `archive_document` Lock Fix
- Update `src/mcp/tools/documents.ts` so `archive_document` mirrors the standard document write-lock pattern used by `remove_document`.
- When `config.locking.enabled` is true, acquire `acquireLock(supabaseManager.getClient(), config.instance.id, 'documents', { ttlSeconds: config.locking.ttlSeconds })` before mutation.
- If lock acquisition fails, return `jsonExpectedError({ error: 'conflict', message: 'Write lock timeout: another instance is writing to documents. Retry in a few seconds.', details: { reason: 'lock_contention' } })`.
- Release the lock in `finally` using `releaseLock(supabaseManager.getClient(), config.instance.id, 'documents')`.
- Do not change archive semantics beyond lock acquisition/release.

### D-06 Test Obligations
- Add/extend unit tests for response-format macro exports and unchanged existing helpers.
- Add/extend unit tests for `call_macro` metadata, `RECURSIVE_MODEL_REASON`, delegated exclusion, and legacy replacements.
- Add unit tests for `NullMcpBroker`.
- Add unit tests for `archive_document` lock acquisition, release in `finally`, and lock-timeout conflict.
- Add integration coverage for `archive_document` lock behavior, including serialization with `remove_document` where feasible.
- If adding integration test files, update `tests/config/vitest.integration.config.ts` because integration tests use an explicit include list.

### the agent's Discretion
- Exact `ToolFn` type location for `McpBroker.getToolHandler`, as long as later macro dispatch can consume it without a rewrite.
- Whether the `call_macro` scaffold returns `unsupported` or `not_implemented`, provided it uses canonical expected-error semantics and does not pretend execution exists.
- Whether to create a dedicated `tests/unit/mcp-broker.test.ts` or group the shim tests with macro foundation tests, provided the test names map clearly to the test plan.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Macro Language Source Of Truth
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Requirements.md` — authoritative behavior, in-scope/out-of-scope decisions, Phase 1 goals, code touch points, and REQ mapping.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Test Plan.md` — authoritative test obligations, test IDs, scenario strategy, and coverage expectations.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/macro-prototype/` — frozen executable spec for later macro phases; Phase 130 only needs it for context, not implementation copying.

### Local Planning Traceability
- `.planning/ROADMAP.md` — Phase 130 goal, requirements, and success criteria.
- `.planning/REQUIREMENTS.md` — local macro-support requirement IDs and phase mapping.

### Code Touch Points
- `src/mcp/utils/response-formats.ts` — additive macro response/type exports.
- `src/mcp/tool-metadata.ts` — `call_macro` metadata entry and description.
- `src/mcp/server.ts` — MCP server registrar wiring.
- `src/mcp/tools/documents.ts` — `archive_document` write-lock fix.
- `src/services/write-lock.ts` — canonical acquire/release helpers.
- `src/services/mcp-broker.ts` — new broker interface and null implementation.
- `tests/config/vitest.integration.config.ts` — explicit integration test include list if new integration files are added.

</canonical_refs>

<specifics>
## Specific Ideas

- Keep this phase small and shippable: one foundation plan can cover response/metadata/scaffold/broker surfaces; a second plan can cover `archive_document` lock behavior and integration tests if parallelism helps.
- The plan should include exact acceptance checks that grep for the new exports, metadata entry, registrar call, lock conflict reason, and integration include update.
- The plan should explicitly warn executors not to implement parser/evaluator/source-resolution behavior in this phase.

</specifics>

<deferred>
## Deferred Ideas

- Full request schema validation behavior beyond a safe scaffold lands in Phase 138.
- Parser, lexer, fence extraction, evaluator, builtins, shell verbs, dispatch permissions, task lifecycle, trace/progress modes, dry-run execution, budgets, source resolution, and scenario matrices land in Phases 131-138.
- Real MCP broker process/transport implementation is out of scope for v0 macro-support and remains a separate broker feature.

</deferred>

---

*Phase: 130-foundation-metadata-broker-shim-archive-lock*
*Context gathered: 2026-05-14 via Macro Language source docs*
