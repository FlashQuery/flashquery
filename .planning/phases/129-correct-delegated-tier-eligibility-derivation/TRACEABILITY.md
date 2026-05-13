---
phase: 129-correct-delegated-tier-eligibility-derivation
requirement: POST-01
updated: 2026-05-13
---

# Phase 129 Traceability

POST-01 / MCP Tool Consolidation Requirements §3.11.1 and §3.11.1.1 are closed only when every evidence layer below agrees that delegated broad tiers derive from metadata, include the corrected data tools, and keep non-data or hard-excluded tools out.

| Requirement | Unit | Integration | E2E / MCP Equivalent | Directed Scenario | Integration Scenario | Coverage Ledger | Docs Evidence |
|-------------|------|-------------|-----------------------|-------------------|----------------------|-----------------|---------------|
| POST-01 / §3.11.1.1 | Plan 01: `tests/unit/tool-metadata.test.ts`; Plan 02: `tests/unit/llm-tool-registry.test.ts`, `tests/unit/tool-exposure.test.ts` | Plan 02: `tests/integration/tool-registry.test.ts` I-tier-1 through I-tier-5 | Plan 02: `tests/e2e/call-model-agent-loop.e2e.test.ts` delegated registry round-trip | `tests/scenarios/directed/testcases/test_delegated_tier_eligibility.py` | `tests/scenarios/integration/tests/delegated_tier_eligibility.yml` | `tests/scenarios/directed/DIRECTED_COVERAGE.md`, `tests/scenarios/integration/INTEGRATION_COVERAGE.md`, `.planning/phases/129-correct-delegated-tier-eligibility-derivation/TRACEABILITY.md`, `.planning/phases/129-correct-delegated-tier-eligibility-derivation/129-VALIDATION.md` | `docs/LLM Providers Models and Purposes.md`, `.planning/phases/129-correct-delegated-tier-eligibility-derivation/129-MIGRATION-CALLOUT.md` |

## Source Requirement Sections

- MCP Tool Consolidation Requirements §3.11.1: delegated tier eligibility must be metadata-derived, not allow-list-derived.
- MCP Tool Consolidation Requirements §3.11.1.1: unit, integration, E2E/MCP-equivalent, directed scenario, integration scenario, coverage ledger, and docs evidence are all required.

## Final Validation Commands

- `npm test -- tests/unit/tool-metadata.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/tool-exposure.test.ts`
- `npm run test:integration -- tests/integration/tool-registry.test.ts`
- `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts`
- `python3 tests/scenarios/directed/run_suite.py --managed delegated_tier_eligibility`
- `python3 tests/scenarios/directed/run_suite.py --managed foundation`
- `python3 tests/scenarios/integration/run_integration.py --managed delegated_tier_eligibility`
- `python3 tests/scenarios/integration/run_integration.py --managed foundation`
- `npm run build`
