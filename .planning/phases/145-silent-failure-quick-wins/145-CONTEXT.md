# Phase 145: Silent Failure Quick Wins - Context

**Gathered:** 2026-05-24
**Status:** Ready for planning
**Source:** User-provided requirements and test plan

<domain>
## Phase Boundary

Phase 145 implements the first two remediation requirements from the Codebase Audit Priority Remediation project:

- REQ-001: `write_memory` create-mode must stop converting failed plugin-scope lookups into global-scoped writes.
- REQ-002: scanner embed-drain unembedded-document query failures must surface an explicit partial-success status instead of reporting complete.

This phase is intentionally narrow. It does not introduce the durable background embedding helper, pending embedding retry table, pg pooling, dependency hygiene, MCP lifecycle changes, cycle breaks, or config metadata typing assigned to later v3.7 phases.

</domain>

<decisions>
## Implementation Decisions

### Mandatory Source Documents

- Downstream planning, implementation, review, and verification agents MUST read the requirements spec first:
  `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Priority Remediation Requirements/Codebase Audit Priority Remediation Requirements.md`
- Downstream planning, implementation, review, and verification agents MUST read the test plan second:
  `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Priority Remediation Requirements/Codebase Audit Priority Remediation Test Plan.md`
- If those docs and this context conflict, the requirements spec and test plan win unless the phase plan explicitly documents a narrower Phase 145 interpretation.

### REQ-001 Locked Decisions

- `plugin_scope` omitted or exactly `global` continues to create a global-scoped memory.
- A successful `find_plugin_scope` RPC match continues to write the matched plugin scope.
- RPC errors and thrown lookup failures must return an MCP error envelope with reason `lookup_failed`.
- Lookup failure must not insert a global-scoped memory.
- The lookup result must use an explicit typed shape or runtime narrowing and remove the `as unknown as Promise<...>` double assertion at the lookup site.
- Tool help or metadata must describe visible lookup-failure behavior if plugin-scope behavior is documented there.

### REQ-002 Locked Decisions

- Scanner unembedded-document query failures continue the scan.
- Query failures must return `embeddingStatus: "drain_query_failed"` or an equivalent explicit union variant approved by the requirements.
- Both thrown query failures and Supabase error-object query failures map to the same explicit status.
- Query failure logging must use `logger.error` and a stable grep-friendly event string.
- Every formatter or consumer that branches on `ScanResult.embeddingStatus` must handle the new variant explicitly.

### Testing Decisions

- Unit coverage must include T-U-001 through T-U-005 from Test Plan Section 4.1.
- Integration coverage must include T-I-001 and T-I-002, or the phase summary must document why a test skipped due to missing `.env.test`.
- Directed scenario T-S-001 / D-68 is required if existing unit and integration coverage do not prove public MCP behavior end to end.
- Final verification must run `npm run typecheck` and `npm run lint`.

### the agent's Discretion

- Exact names for local TypeScript helper types are discretionary.
- Exact unit-test file split is discretionary, but prefer existing nearby files when that keeps tests focused.
- The exact public error message text is discretionary, but the parseable reason must be `lookup_failed`.
- The exact stable scanner event string is discretionary, but it must be unique enough for grep and should include `EMBED-DRAIN`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product Requirements

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Priority Remediation Requirements/Codebase Audit Priority Remediation Requirements.md` - defines REQ-001 and REQ-002 acceptance criteria and invariants.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Priority Remediation Requirements/Codebase Audit Priority Remediation Test Plan.md` - defines T-U-001 through T-U-005, T-I-001 through T-I-002, and T-S-001 / D-68.

### Roadmap

- `.planning/ROADMAP.md` - Phase 145 scope, success criteria, and phase-to-requirement traceability.
- `.planning/REQUIREMENTS.md` - project-level planning requirements, if present.

### Implementation Files

- `src/mcp/tools/memory.ts` - `resolvePluginScope` and `write_memory` create-mode behavior.
- `src/mcp/tool-help/write_memory.tool.md` - public help text for `write_memory`.
- `src/mcp/tool-metadata.ts` - tool metadata if plugin-scope behavior appears there.
- `src/services/scanner.ts` - `ScanResult.embeddingStatus` and `EMBED-DRAIN` status handling.
- `src/services/maintenance.ts` - scanner result consumer.

### Test Files

- `tests/unit/write-memory.test.ts` and `tests/unit/memory-tools.test.ts` - existing memory tool unit patterns.
- `tests/unit/scanner.test.ts` or new focused scanner drain-status unit file - scanner unit coverage.
- `tests/unit/maintain-vault.test.ts` - consumer expectations for scanner results.
- `tests/integration/write-memory.integration.test.ts` or new `tests/integration/mcp/tools/memory-plugin-scope.test.ts` - Supabase-backed public handler behavior.
- `tests/integration/scan-command.integration.test.ts` or new `tests/integration/services/scanner-embed-drain.test.ts` - Supabase-backed scanner drain failure behavior.
- `tests/scenarios/directed/WRITING_SCENARIOS.md` and `tests/scenarios/directed/DIRECTED_COVERAGE.md` - only if directed coverage is added.

</canonical_refs>

<specifics>
## Specific Ideas

- Replace `resolvePluginScope(...): Promise<string>` with a discriminated result such as `{ ok: true; scope: string } | { ok: false; reason: "lookup_failed"; message: string }`.
- Return a JSON expected error from create-mode before building the insert row when scope lookup fails.
- Use local runtime narrowing for the RPC payload, because the existing Supabase client shape is not strongly typed at this call site.
- Add `drain_query_failed` to the `ScanResult.embeddingStatus` union.
- Track a boolean like `drainQueryFailed` around the Phase 2 unembedded-doc query and let it override the final complete/no-work status unless timeout has already taken precedence.
- Prefer `logger.error("[EMBED-DRAIN] drain_query_failed: ...")` or similar stable text for query failure logs.
- Check existing consumers before finalizing the union so `maintenance.ts` and tests do not silently assume the old closed set.

</specifics>

<deferred>
## Deferred Ideas

- Durable embedding retry state is deferred to Phase 146.
- Background embedding helper consolidation is deferred to Phase 146.
- Record vector SQL pooling is deferred to Phase 146.
- MCP lifecycle and shutdown work is deferred to Phase 148.
- Cycle breaking and config metadata typing are deferred to Phases 149 and 150.

</deferred>

---

*Phase: 145-silent-failure-quick-wins*
*Context gathered: 2026-05-24 via user-provided remediation docs*
