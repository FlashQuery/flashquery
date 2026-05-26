# Phase 153: Documents Tool Decomposition - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning
**Source:** External remediation requirements and test plan supplied for Phase 153

<domain>
## Phase Boundary

Phase 153 implements only the documents-tool decomposition lane from the v3.8 Codebase Audit Remaining Remediation milestone.

The phase covers REQ-009:
- Split `src/mcp/tools/documents.ts` into cohesive document tool modules.
- Preserve `registerDocumentTools(server, config)` as the public registration entrypoint unless every import is updated consistently.
- Keep all six document tools registered with unchanged schemas, response behavior, write-lock behavior, embedding scheduling, identity resolution, logging intent, error handling, and plugin propagation behavior.
- Avoid recreating the document/plugin import cycle cluster fixed in prior remediation.
- Add static size/cycle/entrypoint guards and run the document unit, integration, directed, YAML, typecheck, lint, knip, and preflight gates required by the test plan.

This phase must not reopen Phase 151 or Phase 152 production changes unless a discovered regression directly blocks REQ-009 validation.
</domain>

<decisions>
## Implementation Decisions

### D-01: External docs are source of truth
- Downstream agents MUST read the canonical requirements spec and test plan listed in `<canonical_refs>` before implementing or verifying this phase.
- If implementation questions arise, agents MUST resolve them from those docs first, then from `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, this context, and prior phase summaries, and only escalate when those documents do not answer the question.

### D-02: Scope is REQ-009 only
- The implementation MUST address REQ-009 and the Phase 153 success criteria from `.planning/ROADMAP.md`.
- The implementation MUST NOT redo REQ-001 through REQ-008 except where imports or static guards need compatibility after moving document tool code.

### D-03: Registration contract is locked
- `registerDocumentTools(server, config)` MUST remain importable from `src/mcp/tools/documents.ts`.
- The six registered tools MUST remain `write_document`, `get_document`, `archive_document`, `remove_document`, `copy_document`, and `move_document`.
- Tool schemas, descriptions, response text/envelopes, `isError: true` error behavior, identifier semantics, and log intent must remain behaviorally unchanged.

### D-04: Move behavior, do not redesign behavior
- This phase is a behavior-preserving module move, not a semantic rewrite.
- Moved handlers must preserve current calls to write locks, targeted scans, embedding scheduling, `resolveDocumentIdentifier`, plugin ownership/propagation checks, rollback behavior, and file-system operations.
- Shared helper movement should prefer `src/mcp/tools/documents/` for document-tool-specific glue and existing `src/mcp/utils/` only for dependency-light reusable utilities.

### D-05: Cycle and size controls are required
- New document tool implementation files SHOULD stay below 500 lines each; any exception requires a clear implementation-summary justification and must still pass the selected static guard.
- The entrypoint must become thin enough that it only assembles dependencies and registers/imports moved tool registrations.
- Static guards MUST prevent forbidden document/plugin cycle fragments from reappearing.

### D-06: Validation is test-plan driven
- The phase is incomplete until T-U-026 through T-U-030, T-I-005 through T-I-009, T-S-003 through T-S-006, and T-Y-004 through T-Y-006 are implemented or run according to the supplied test plan and local environment gates.
- Required commands include `npm test`, `npm run test:integration`, `npm run test:e2e`, directed scenarios, YAML integration scenarios, `npm run typecheck`, `npm run lint`, `npm run knip`, and `npm run preflight`.
- Integration and scenario tests may skip only through existing environment gates such as missing `.env.test` or provider rate limits recorded in summaries.

### D-07: Preserve Phase 151 and Phase 152 guard state
- `tests/unit/codebase-audit-remaining-remediation.test.ts` already contains static guards for prior requirements.
- Phase 153 implementation MUST append or extend REQ-009 guards without deleting, weakening, renaming, or broadening away the existing Phase 151 and Phase 152 assertions.

### the agent's Discretion
- Agents may choose whether each moved module exposes `registerWriteDocumentTool`, `registerGetDocumentTool`, one registration per file, or a small grouped structure, provided the public entrypoint remains stable and thin.
- Agents may choose whether common dependency wiring uses a local `DocumentToolDeps` interface or direct parameters, provided it does not introduce server-side session state or new public API surface.
- Agents may choose the exact static guard thresholds, provided the guard verifies entrypoint thinness, implementation file size/justification, and forbidden cycle fragments for REQ-009.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning, implementing, or verifying Phase 153.**

### Requirements and Validation
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Remaining Remediation Requirements pt2/Codebase Audit Remaining Remediation Requirements.md` - authoritative requirements spec; Phase 153 scope is Spec Section 6.3 / REQ-009 and architecture contract Section 7.4.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Remaining Remediation Requirements pt2/Codebase Audit Remaining Remediation Test Plan.md` - authoritative test plan; Phase 153 coverage is Test Plan Section 4.3 / T-U-026 through T-U-030, T-I-005 through T-I-009, T-S-003 through T-S-006, and T-Y-004 through T-Y-006.

### Local Planning and Prior Phase State
- `.planning/REQUIREMENTS.md` - local milestone summary and traceability table.
- `.planning/ROADMAP.md` - Phase 153 goal, success criteria, and required validation.
- `.planning/phases/151-quick-localized-cleanup/151-VERIFICATION.md` - confirms Phase 151 is complete and should not be reopened.
- `.planning/phases/152-type-safety-cleanup-pass/152-CONTEXT.md` - records the prior-phase source-order rule and static guard preservation requirement.
- `.planning/phases/152-type-safety-cleanup-pass/152-01-SUMMARY.md` - summarizes REQ-006/REQ-007 changes that must not regress.
- `.planning/phases/152-type-safety-cleanup-pass/152-02-SUMMARY.md` - summarizes REQ-008 final validation and provider-gated scenario caveats.
</canonical_refs>

<specifics>
## Specific Ideas

Use two implementation plans:

1. Decompose lower-risk document reads and writes:
   - Create `src/mcp/tools/documents/` module structure and shared dependency/types helpers.
   - Move `write_document` and `get_document` registrations or handlers first.
   - Preserve existing tests and imports from `src/mcp/tools/documents.ts`.
   - Add early REQ-009 guard scaffolding without forcing the final thin-entrypoint assertion before all handlers move.

2. Decompose lifecycle and movement tools, then finalize guards and validation:
   - Move `archive_document`, `remove_document`, `copy_document`, and `move_document`.
   - Add final thin-entrypoint, file-size/justification, and forbidden cycle-fragment guards.
   - Update directed and YAML coverage matrices for D-73 through D-76 and IS-19 through IS-21 if not already present.
   - Run the required document and full validation gates.

Important source anchors in current `src/mcp/tools/documents.ts`:
- `registerDocumentTools` starts at the public entrypoint and currently registers all six tools inline.
- Tool registration starts around the current `write_document`, `get_document`, `archive_document`, `remove_document`, `copy_document`, and `move_document` sections.
- The file currently imports plugin lifecycle helpers, embedding scheduling, document resolution, output helpers, vault primitives, and response formatting in one place; split modules must avoid forming new cycles.

Exact guard targets:
- Entry point remains importable from `src/mcp/tools/documents.ts`.
- The six tool names remain registered in source.
- Document implementation files under `src/mcp/tools/documents/` stay under the selected threshold or include explicit justification.
- Forbidden document/plugin cycle fragments do not reappear.
- Existing prior-phase forbidden-pattern guards still pass.
</specifics>

<deferred>
## Deferred Ideas

- Repository-wide module-size policy is deferred; this phase applies only to document tool implementation files.
- Repository-wide zero-cycle policy is deferred; this phase prevents the known document/plugin cycle cluster from returning.
- Document tool response redesigns, semantic changes, new tools, restore APIs, or plugin lifecycle redesigns are out of scope.
</deferred>

---

*Phase: 153-documents-tool-decomposition*
*Context gathered: 2026-05-25 from external remediation docs*
