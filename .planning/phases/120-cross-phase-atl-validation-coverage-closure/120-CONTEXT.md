# Phase 120: Cross-Phase ATL Validation & Coverage Closure - Context

**Gathered:** 2026-05-07
**Status:** Ready for planning
**Source:** User-supplied canonical ATL requirements and test documents

<domain>
## Phase Boundary

Phase 120 closes the Agentic Tool Loop milestone by validating the already-built Phase 112-119 surfaces together. It is not a deferred feature-build phase and should not reimplement ATL internals unless validation exposes a blocking coverage or behavior gap.

The phase must prove cross-phase workflows, YAML integration closure, directed scenario coverage, coverage matrix traceability, phase-local validation evidence for Phases 112-119, and the final milestone preflight command set.
</domain>

<decisions>
## Implementation Decisions

### Canonical Source Documents
- Downstream agents MUST read the canonical ATL docs before making planning or implementation decisions.
- Use `Agentic-LLM-Tool-Loop.md` for the authoritative agent-loop requirements.
- Use `Document Reference System.md` for reference, template, alias, discovery, and masquerade details and examples.
- Use `ATL Test Plan.md` for the accepted validation taxonomy and provisional coverage IDs.

### Phase 120 Scope
- Phase 120 should add cross-phase E2E, YAML integration, directed scenario, and coverage-ledger closure only where existing phase-local coverage does not already prove the accepted ATL test-plan behavior.
- Phase 120 must verify Phases 112-119 shipped runnable local tests as applicable. Missing public-behavior scenario coverage blocks milestone closure unless the phase had no public surface.
- Coverage matrices must contain accepted ATL rows with final IDs and traceability back to the ATL Test Plan, including rows added incrementally during Phases 112-119.
- Full milestone preflight commands must be documented and either pass or record explicit environmental skips.

### the agent's Discretion
- Agents may split the plan by validation surface, coverage matrix, and final audit/reporting rather than by implementation layer.
- Agents may add helper scripts or scenario fixtures if they reduce duplication and follow existing scenario framework patterns.
- Agents should prefer public MCP/scenario assertions for user-observable behavior and avoid private DB assertions except where the existing integration layer already treats DB behavior as the subject.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product Requirements And Test Contract
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/Agentic-LLM-Tool-Loop.md` - authoritative ATL requirements, loop behavior, provider capabilities, budgets, usage, and template-tool contract.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/Document Reference System.md` - authoritative document reference grammar, template parameterization, alias/list modes, masquerade, and examples.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/ATL Test Plan.md` - accepted ATL validation taxonomy, provisional IDs, and required directed/YAML/E2E coverage.

### Project Planning State
- `.planning/ROADMAP.md` - Phase 120 goal, dependencies, success criteria, and phase-local completion history.
- `.planning/REQUIREMENTS.md` - `VAL-120` and `TEST-04` requirement status.
- `.planning/STATE.md` - milestone decisions, public-scenario policy, and current focus.

### Prior Phase Evidence
- `.planning/phases/112-chat-primitive-envelope-migration/112-VERIFICATION.md` - Phase 112 validation evidence.
- `.planning/phases/114-template-parameterization/114-VERIFICATION.md` - Phase 114 validation evidence.
- `.planning/phases/115-purpose-config-bindings-capabilities/115-VERIFICATION.md` - Phase 115 validation evidence.
- `.planning/phases/116-model-visible-tool-registry/116-VERIFICATION.md` - Phase 116 validation evidence.
- `.planning/phases/117-agent-loop-executor/117-VERIFICATION.md` - Phase 117 validation evidence.
- `.planning/phases/118-template-discovery-masquerade-dispatch/118-VERIFICATION.md` - Phase 118 validation evidence.
- `.planning/phases/119-discovery-diagnostics-help-resolver/119-VERIFICATION.md` - Phase 119 validation evidence.
- `.planning/phases/112-chat-primitive-envelope-migration` through `.planning/phases/119-discovery-diagnostics-help-resolver` summaries - runnable command and scenario provenance.

### Existing Coverage Surfaces
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` - final directed coverage rows and Phase 112-119 notes.
- `tests/scenarios/integration/INTEGRATION_COVERAGE.md` - final YAML integration coverage rows.
- `tests/e2e/call-model-agent-loop.e2e.test.ts` - existing native loop, parallel calls, stops, fallback, provider compatibility E2E coverage.
- `tests/e2e/call-model-template-tools.e2e.test.ts` - existing template-tool and mixed native/template E2E coverage.
</canonical_refs>

<specifics>
## Specific Ideas

- Audit accepted ATL Test Plan rows against existing tests before adding new scenarios.
- Close YAML integration gaps for reference freshness, document-parameter freshness, discovery-to-invocation closure, runtime binding reappearance, and mixed reference modes.
- Add cross-phase validation that combines Mode 1 hydration, native tool loops, template tool loops, mixed loops, stop reasons, fallback, and provider compatibility in the minimum reliable command set.
- Record any environmental skips explicitly, especially Supabase-backed integration and managed scenario prerequisites.
</specifics>

<deferred>
## Deferred Ideas

- Mode 3 cooperative loop remains deferred.
- MCP Broker external tool routing remains deferred.
- Audit document writes remain deferred.
- Performance/load benchmarking remains out of scope.
</deferred>

---

*Phase: 120-cross-phase-atl-validation-coverage-closure*
*Context gathered: 2026-05-07 via canonical doc review*
