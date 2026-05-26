# Phase 152: Type-Safety Cleanup Pass - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning
**Source:** External remediation requirements and test plan supplied for Phase 152

<domain>
## Phase Boundary

Phase 152 implements only the type-safety and records instrumentation lane from the v3.8 Codebase Audit Remaining Remediation milestone.

The phase covers REQ-006 through REQ-008:
- Remove the residual consolidated document-output double assertion.
- Remove scanner Supabase select double assertions for active/missing and archived document queries.
- Replace broad `llm-usage.ts` query eslint disables and grouping non-null assertions with narrower typed helpers.
- Replace duplicate `TODO LOG-01` records comments with safe timing metadata for both `search_records` query paths.

The phase must preserve public MCP behavior and response shapes. It must not reopen completed Phase 151 cleanup, implement Phase 153 document-tool decomposition, redesign Supabase access broadly, or change document tool contracts.
</domain>

<decisions>
## Implementation Decisions

### D-01: External docs are source of truth
- Downstream agents MUST read the canonical requirements spec and test plan listed in `<canonical_refs>` before implementing or verifying this phase.
- If implementation questions arise, agents MUST resolve them from those docs first, then from local `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, and this context, and only escalate when the documents do not answer the question.

### D-02: Scope is REQ-006 through REQ-008 only
- The implementation MUST address REQ-006, REQ-007, and REQ-008.
- The implementation MUST NOT include REQ-009 document-tool decomposition, which belongs to Phase 153.
- The implementation MUST NOT redo Phase 151 production changes unless a regression from Phase 151 directly blocks Phase 152 validation.

### D-03: Behavior preservation is mandatory
- Existing scanner, document-output, LLM usage, records, directed scenario, and YAML scenario behavior MUST remain externally unchanged.
- MCP tool responses MUST continue returning `{ content: [{ type: "text", text: "..." }] }`, with existing `isError: true` behavior preserved on errors.
- Replacement typing must preserve selected scanner fields: `id`, `path`, `content_hash`, `title`, `status`, `updated_at`, and `template_meta` where currently requested.

### D-04: Type cleanup is targeted, not a broad abstraction project
- Local structural interfaces and helper functions are acceptable when third-party Supabase builder types are private or impractical.
- Do not build a repository-wide Supabase query abstraction.
- Static guard tests should assert exact forbidden production patterns named by the spec rather than unrelated broad bans.

### D-05: Records timing logs must be safe and low-noise
- Both filters-only and semantic/vector `search_records` DB query paths MUST log path, table name, row count if available, and elapsed milliseconds on success and failure.
- Logs MUST NOT include raw record payloads, embedding vectors, or caller query text beyond existing safe identifiers.

### D-06: Validation is test-plan driven
- The phase is incomplete until T-U-016 through T-U-025, T-I-002 through T-I-004, T-S-001 through T-S-002, and T-Y-001 through T-Y-003 are implemented or run according to the supplied test plan and local environment gates.
- Integration and scenario tests may skip only through existing environment gates such as missing `.env.test`.

### D-07: Preserve Phase 151 gap-fix guards
- Phase 151 gap remediation added static guards to `tests/unit/codebase-audit-remaining-remediation.test.ts` for plugin reconciliation integration enablement and environment-gated skips, alongside the earlier Phase 151 audit guards.
- Phase 152 implementation MUST append or extend Phase 152 guards in that file without deleting, weakening, renaming, or broadening away the existing Phase 151 guard assertions.

### the agent's Discretion
- Agents may choose whether scanner typed select replacement uses local row/result interfaces, a small helper, or improved Supabase generics, provided the named `as unknown as Promise` sites disappear and selected fields remain unchanged.
- Agents may choose how to structure the `llm-usage.ts` query helper surface, provided it types `from`, `select`, `eq`, `gte`, `lt` or `lte`, `order`, `limit`, and awaited row results for the methods actually used.
- Agents may choose the logger level for records timing metadata, provided it follows existing local logging conventions and avoids sensitive payloads.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning, implementing, or verifying Phase 152.**

### Requirements and Validation
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Remaining Remediation Requirements pt2/Codebase Audit Remaining Remediation Requirements.md` - authoritative requirements spec; Phase 152 scope is Spec Section 6.2 / REQ-006 through REQ-008.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Remaining Remediation Requirements pt2/Codebase Audit Remaining Remediation Test Plan.md` - authoritative test plan; Phase 152 coverage is Test Plan Section 4.2 / T-U-016 through T-U-025, T-I-002 through T-I-004, T-S-001 through T-S-002, and T-Y-001 through T-Y-003.

### Local Planning Summaries
- `.planning/REQUIREMENTS.md` - local milestone summary and traceability table.
- `.planning/ROADMAP.md` - Phase 152 goal, success criteria, and required validation.
- `.planning/phases/151-quick-localized-cleanup/151-VERIFICATION.md` - confirms Phase 151 is complete and should not be reopened.
</canonical_refs>

<specifics>
## Specific Ideas

Use two focused implementation plans:

1. Type escape cleanup for REQ-006 and REQ-007:
   - `src/mcp/utils/document-output.ts`
   - `src/services/scanner.ts`
   - `src/mcp/tools/llm-usage.ts`
- `tests/unit/codebase-audit-remaining-remediation.test.ts`
   - `tests/unit/scanner.test.ts`
   - `tests/unit/llm-usage-tool.test.ts`
   - relevant document-output and response-format tests

2. Records timing instrumentation and validation for REQ-008:
   - `src/mcp/tools/records.ts`
   - `tests/unit/record-tools.test.ts` or the closest existing records tool unit suite
   - `tests/unit/codebase-audit-remaining-remediation.test.ts`
   - records integration and YAML scenario coverage from the test plan

Include exact forbidden-pattern checks for:
- `as unknown as Record<string, unknown>` in `src/mcp/utils/document-output.ts`
- `as unknown as Promise` in `src/services/scanner.ts`
- block-level `no-explicit-any`, `no-unsafe-assignment`, `no-unsafe-call`, or `no-unsafe-member-access` disables around `applyEntityFilters` or `fetchRows` in `src/mcp/tools/llm-usage.ts`
- grouping `Map.get(...)!.push(...)` or equivalent non-null assertion push patterns in `src/mcp/tools/llm-usage.ts`
- `TODO LOG-01` in `src/mcp/tools/records.ts`

When editing `tests/unit/codebase-audit-remaining-remediation.test.ts`, preserve the existing Phase 151 guards for T-U-004, T-U-007, T-I-001, T-U-008, T-U-009, T-U-011, T-U-012, and T-U-013.
</specifics>

<deferred>
## Deferred Ideas

- REQ-009 document-tool decomposition is deferred to Phase 153.
- Repository-wide module-size policy, general typed Supabase query abstraction, broad package modernization, and repository-wide zero-cycle policy remain out of scope.
</deferred>

---

*Phase: 152-type-safety-cleanup-pass*
*Context gathered: 2026-05-25 from external remediation docs*
