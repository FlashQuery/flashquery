# Phase 151: Quick Localized Cleanup - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning
**Source:** External remediation requirements and test plan supplied for Phase 151

<domain>
## Phase Boundary

Phase 151 removes the five small, independent audit findings from the v3.8 Codebase Audit Remaining Remediation milestone before the broader type-safety and document-tool refactors.

The phase covers only REQ-001 through REQ-005:
- Explicit API-key validation in `createEmbeddingProvider`.
- Public vault absolute-path resolution for plugin reconciliation.
- Removal of the inert projects seeder.
- Visible pg cleanup failure handling in git backup cleanup.
- Package metadata cleanup for the direct `esbuild` type import and bundled `uuid` types.

The phase must not reopen completed priority-remediation work, redesign Supabase access broadly, or change MCP public behavior.
</domain>

<decisions>
## Implementation Decisions

### D-01: External docs are source of truth
- Downstream agents MUST read the canonical requirements spec and test plan listed in `<canonical_refs>` before implementing or verifying this phase.
- If implementation questions arise, agents MUST resolve them from those docs first, then from the local `.planning/REQUIREMENTS.md` and `.planning/ROADMAP.md` summaries, and only escalate when the documents do not answer the question.

### D-02: Scope is REQ-001 through REQ-005 only
- The implementation MUST address REQ-001, REQ-002, REQ-003, REQ-004, and REQ-005.
- The implementation MUST NOT include REQ-006 through REQ-009, which belong to later phases.

### D-03: Behavior preservation
- MCP tool response envelopes, error behavior, ESM TypeScript conventions, and existing integration behavior MUST remain stable.
- Logging added for cleanup failures MUST NOT include database URLs, credentials, API keys, document contents, record payloads, or embedding vectors.

### D-04: Validation is test-plan driven
- The phase is incomplete until T-U-001 through T-U-015, T-I-001, `npm run knip`, and `npm audit` are implemented or run according to the supplied test plan and local environment gates.
- Static guard tests should assert the exact forbidden patterns named by the spec rather than broad unrelated bans.

### the agent's Discretion
- Agents may choose whether the new vault absolute-path method is named `resolveVaultPath`, `resolveAbsolutePath`, or another local-convention name, provided it is part of the public `VaultManager` interface and preserves existing vault-root normalization behavior.
- Agents may choose whether `pgClient.end()` cleanup failures are debug-logged or propagated, provided the primary backup error remains the caller-observed error when both primary and cleanup failures occur.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning, implementing, or verifying Phase 151.**

### Requirements and Validation
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Remaining Remediation Requirements pt2/Codebase Audit Remaining Remediation Requirements.md` - authoritative requirements spec; Phase 151 scope is Spec Section 6.1 / REQ-001 through REQ-005.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Remaining Remediation Requirements pt2/Codebase Audit Remaining Remediation Test Plan.md` - authoritative test plan; Phase 151 coverage is Test Plan Section 4.1 / T-U-001 through T-U-015 and T-I-001.

### Local Planning Summaries
- `.planning/REQUIREMENTS.md` - local milestone summary and traceability table.
- `.planning/ROADMAP.md` - Phase 151 goal, success criteria, and required validation.
</canonical_refs>

<specifics>
## Specific Ideas

- Prefer one plan that covers all five localized remediation items, because the files are independent and small enough for a single executor pass with focused test coverage.
- Include exact source files in executor read lists:
  - `src/embedding/provider.ts`
  - `src/storage/vault.ts`
  - `src/services/plugin-reconciliation.ts`
  - `src/projects/seeder.ts`
  - `src/git/manager.ts`
  - `tsup.config.ts`
  - `package.json`
  - `package-lock.json`
  - relevant unit and integration test files under `tests/unit/` and `tests/integration/`
- Include guard verification for forbidden strings: `config.apiKey!`, private `rootPath` casts, `initProjects|projects/seeder`, `.catch(() => {})`, and `@types/uuid`.
</specifics>

<deferred>
## Deferred Ideas

- REQ-006 through REQ-009 are deferred to Phases 152 and 153.
- Repository-wide module-size policy, general typed Supabase query abstractions, broad package modernization, and repository-wide zero-cycle policy remain out of scope.
</deferred>

---

*Phase: 151-quick-localized-cleanup*
*Context gathered: 2026-05-25 from external remediation docs*
