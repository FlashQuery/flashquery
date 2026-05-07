# Phase 120: Cross-Phase ATL Validation & Coverage Closure - Research

**Researched:** 2026-05-07  
**Domain:** FlashQuery ATL validation, scenario coverage, and milestone closure  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

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

### Deferred Ideas (OUT OF SCOPE)

## Deferred Ideas

- Mode 3 cooperative loop remains deferred.
- MCP Broker external tool routing remains deferred.
- Audit document writes remain deferred.
- Performance/load benchmarking remains out of scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VAL-120 | Phase 120 ships runnable cross-phase E2E, directed, and YAML integration suites proving the full ATL workflows and updating coverage matrices with final scenario IDs. | Existing E2E and directed coverage is mostly present; YAML ATL rows need closure and final audit evidence must be produced. [VERIFIED: .planning/REQUIREMENTS.md; tests/e2e; tests/scenarios/directed/DIRECTED_COVERAGE.md; tests/scenarios/integration/INTEGRATION_COVERAGE.md] |
| TEST-04 | Scenario tests are added in the same phase as public behavior; Phase 120 only fills cross-phase gaps and finalizes coverage matrices. | Phase 112-119 verification artifacts show phase-local gates; Phase 120 should audit and only add missing public cross-phase coverage. [VERIFIED: .planning/REQUIREMENTS.md; .planning/phases/*-VERIFICATION.md] |
</phase_requirements>

## Phase Understanding

Phase 120 is a validation and coverage-closure phase, not an ATL implementation phase. Its planning center should be evidence: prove that Phase 112-119 behavior composes across Mode 1 references/templates, Mode 2 native loops, template masquerade loops, discovery/help, guardrails, fallback, usage, and coverage ledgers. [VERIFIED: .planning/phases/120-cross-phase-atl-validation-coverage-closure/120-CONTEXT.md; .planning/ROADMAP.md]

The current milestone state has 60/62 v3.2 requirements complete, with only `VAL-120` and `TEST-04` pending. [VERIFIED: .planning/REQUIREMENTS.md] The roadmap success criteria require cross-phase E2E, YAML integration scenarios, directed scenario proof, coverage matrix traceability, phase-local evidence review, and full milestone preflight documentation. [VERIFIED: .planning/ROADMAP.md]

Primary recommendation: split the plan into four slices: cross-phase E2E consolidation, YAML ATL integration closure, directed coverage closure, and final audit/preflight artifact production. [VERIFIED: codebase coverage audit]

## Canonical Docs Read-First Rule

Every implementation agent for Phase 120 must read these three files before editing tests, ledgers, or validation artifacts: [VERIFIED: 120-CONTEXT.md; user objective]

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/Agentic-LLM-Tool-Loop.md` [VERIFIED: file read]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/Document Reference System.md` [VERIFIED: file read]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/ATL Test Plan.md` [VERIFIED: file read]

The ATL Test Plan maps the accepted coverage taxonomy to `ATL-U-*`, `ATL-I-*`, `ATL-E2E-*`, `ATL-DS-*`, and `ATL-INT-*` provisional IDs, and says final directed/integration rows should be copied into local coverage matrices with native IDs. [VERIFIED: ATL Test Plan]

## Existing Evidence Map

| ATL Test Plan Area | Existing Evidence | Status |
|---|---|---|
| ATL-DS-01 Mode 1 envelope / `return_messages` | Directed row L-73/L-74/L-75 and `test_call_model_return_messages`; Phase 112 verification passed build, unit, directed scenario. [VERIFIED: DIRECTED_COVERAGE.md; 112-VERIFICATION.md] | Covered |
| ATL-DS-02 / ATL-DS-03 reference grammar and escapes | Directed rows L-76/L-77/L-78/L-79 and `test_call_model_reference_system_core`; Phase 113 summary records unit, integration, directed, build gates. [VERIFIED: DIRECTED_COVERAGE.md; 113-04-SUMMARY.md] | Covered |
| ATL-DS-04 / 05 / 06 template params, aliases, failures | Directed rows L-71/L-72/L-80/L-81/L-82/L-83 and `test_call_model_template_parameterization`; integration rows IL-28/IL-29/IL-30. [VERIFIED: DIRECTED_COVERAGE.md; INTEGRATION_COVERAGE.md; 114-VERIFICATION.md] | Covered |
| ATL-DS-07 / 08 discovery and template conflicts | Directed rows L-91/L-92 and Phase 118 verification. [VERIFIED: DIRECTED_COVERAGE.md; 118-VERIFICATION.md] | Covered |
| ATL-DS-09 / 10 / 11 native/template/mixed loops | Directed rows L-86/L-93/L-94 plus E2E files for native and template tools. [VERIFIED: DIRECTED_COVERAGE.md; tests/e2e/call-model-agent-loop.e2e.test.ts; tests/e2e/call-model-template-tools.e2e.test.ts] | Covered |
| ATL-DS-12 budget and stop reasons | Directed row L-87 covers max iterations/tokens/cost/timeout/provider error; L-90 explicitly tracks missing cooperative shutdown directed coverage. [VERIFIED: DIRECTED_COVERAGE.md] | Partial |
| ATL-DS-13 usage aggregation | Directed row L-88 and Phase 117 verification. [VERIFIED: DIRECTED_COVERAGE.md; 117-VERIFICATION.md] | Covered |
| ATL-DS-14 capability admission errors | Directed row L-84 and Phase 115 verification. [VERIFIED: DIRECTED_COVERAGE.md; 115-VERIFICATION.md] | Covered |
| ATL-DS-15 help resolver | Directed row L-99 and Phase 119 verification. [VERIFIED: DIRECTED_COVERAGE.md; 119-VERIFICATION.md] | Covered |
| ATL-E2E-02 / 03 / 06 / 07 native loops, parallel, stops, fallback | `tests/e2e/call-model-agent-loop.e2e.test.ts` contains explicit `ATL-E2E-02`, `ATL-E2E-03`, `ATL-E2E-06`, and `ATL-E2E-07` test names. [VERIFIED: rg over e2e file] | Covered |
| ATL-E2E-04 / 05 template and mixed tools | `tests/e2e/call-model-template-tools.e2e.test.ts` contains explicit `ATL-E2E-04` and `ATL-E2E-05` test names. [VERIFIED: rg over e2e file] | Covered |
| ATL-E2E-01 Mode 1 compatibility | Phase 112 has unit and directed coverage, but no explicit `ATL-E2E-01` E2E test name was found. [VERIFIED: 112-VERIFICATION.md; rg over tests/e2e] | Gap or ledger-only |
| ATL-E2E-08 provider compatibility failures | Capability failures are covered by directed row L-84 and unit/provider normalization tests; no explicit `ATL-E2E-08` E2E test name was found. [VERIFIED: DIRECTED_COVERAGE.md; rg over tests/e2e] | Gap or ledger-only |
| ATL-INT-01 / 02 / 03 / 05 YAML integration | Current YAML ledger has IL-10 through IL-36 for references, discovery, config sync, and phase gates, but no dedicated ATL-INT-01/02/03/05 rows or obvious YAML tests for template freshness/document-param freshness/discovery-to-template invocation/mixed reference modes. [VERIFIED: INTEGRATION_COVERAGE.md; tests/scenarios/integration/tests listing] | Gap |
| ATL-INT-04 runtime binding reappears from YAML | Integration rows IL-33/IL-35 cover this at TypeScript integration level because no public runtime binding YAML tool exists. [VERIFIED: INTEGRATION_COVERAGE.md; tests/integration/llm-config-sync.test.ts] | Covered with justified layer exception |

## Gaps To Plan

1. Add or explicitly justify `ATL-E2E-01` and `ATL-E2E-08` in E2E evidence. Existing behavior is covered elsewhere, but the Phase 120 roadmap specifically asks for cross-phase E2E workflows proving Mode 1 and provider compatibility failures together. [VERIFIED: .planning/ROADMAP.md; rg over tests/e2e]

2. Close YAML integration rows for `ATL-INT-01`, `ATL-INT-02`, `ATL-INT-03`, and `ATL-INT-05` with final local IDs. Existing YAML files cover reference basics and discovery basics, but the ATL Test Plan rows for reference freshness, document-parameter freshness, discovery-to-invocation closure, and mixed reference modes are not represented as final ATL rows. [VERIFIED: ATL Test Plan; INTEGRATION_COVERAGE.md; tests/scenarios/integration/tests listing]

3. Decide whether to implement L-90 now or explicitly mark it as deferred/future. L-90 is the only current directed ATL row with `PENDING`, and it requires a non-blocking `FQCServer.signal_graceful_shutdown()` helper or equivalent subprocess signaling. [VERIFIED: DIRECTED_COVERAGE.md]

4. Produce phase-local validation evidence review for Phases 112-119. Verification artifacts exist for 112 and 114-119; Phase 113 has summaries and validation but no `113-VERIFICATION.md` file found. The planner should include an audit task that records this asymmetry and cites the phase 113 validation summaries instead of inventing missing verifier output. [VERIFIED: find .planning/phases; 113-04-SUMMARY.md]

5. Add final traceability rows or notes tying provisional ATL Test Plan IDs to final local IDs. Directed rows L-71 through L-100 already include many provisional ATL IDs, but YAML rows IL-26 through IL-36 are mixed with phase requirement IDs and need a final Phase 120 closure pass. [VERIFIED: DIRECTED_COVERAGE.md; INTEGRATION_COVERAGE.md]

## Recommended Plan Slices

### Slice 1: Cross-Phase E2E Closure

Modify or add focused tests under `tests/e2e/`: [VERIFIED: existing e2e layout]

- Add `ATL-E2E-01` coverage to a new or existing E2E file for Mode 1 envelope compatibility, `return_messages`, and raw discovery shape with the same stdio MCP harness pattern used by existing E2E tests. [VERIFIED: tests/e2e/call-model-agent-loop.e2e.test.ts]
- Add `ATL-E2E-08` coverage for provider compatibility failures: unknown/false tool capability admission, missing usage on tool-call response, and `response_format` plus tools rejection where deterministic mock providers can prove the public failure. [VERIFIED: ATL Test Plan; tests/e2e/call-model-agent-loop.e2e.test.ts]
- Run: `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts tests/e2e/call-model-template-tools.e2e.test.ts` and any new E2E file. [VERIFIED: package.json scripts]

### Slice 2: YAML ATL Integration Closure

Add final local rows to `tests/scenarios/integration/INTEGRATION_COVERAGE.md` and YAML tests under `tests/scenarios/integration/tests/`: [VERIFIED: integration skill docs; INTEGRATION_COVERAGE.md]

- `ATL-INT-01`: reference/template freshness after file or frontmatter update. Candidate YAML: `llm_template_reference_freshness.yml`. [VERIFIED: ATL Test Plan]
- `ATL-INT-02`: document-parameter freshness after updating the referenced document. Candidate YAML: `llm_template_document_param_freshness.yml`. [VERIFIED: ATL Test Plan]
- `ATL-INT-03`: discovery-to-invocation closure from `list_purposes`/`search` to a subsequent `call_model` using discovered purpose/template/tool metadata. Existing `llm_discovery_then_call.yml` may be extended if it proves the exact ATL path. [VERIFIED: ATL Test Plan; tests/scenarios/integration/tests/llm_discovery_then_call.yml exists]
- `ATL-INT-05`: mixed early-bound path/section/pointer and late-bound alias/list mode in one `call_model`. Candidate YAML: `llm_mixed_reference_modes.yml`; existing `llm_mixed_ref_and_id_placeholders.yml` is superseded for ATL v1 because `{{id:...}}` is literal. [VERIFIED: ATL Test Plan; INTEGRATION_COVERAGE.md]
- Keep `ATL-INT-04` mapped to IL-35/TypeScript integration unless a public runtime binding tool exists; do not invent a test-only MCP API. [VERIFIED: INTEGRATION_COVERAGE.md]
- Run individually while authoring: `python3 tests/scenarios/integration/run_integration.py --managed <test_name>`. Final run should include the ATL YAML subset, not necessarily every historical YAML test unless time permits. [VERIFIED: tests/scenarios/integration/README.md]

### Slice 3: Directed Matrix Closure

Update `tests/scenarios/directed/DIRECTED_COVERAGE.md` only after tests pass. [VERIFIED: flashquery-directed-testgen and covgen skills]

- Either implement `test_call_model_agent_loop_shutdown.py` and add the framework helper `FQCServer.signal_graceful_shutdown()` to close L-90, or mark L-90 as an accepted future gap with explicit rationale in Phase 120 validation. Implementing it is preferable if the helper can be added without destabilizing the scenario framework. [VERIFIED: DIRECTED_COVERAGE.md]
- Re-run existing ATL directed scenarios as a focused suite: `test_call_model_return_messages`, `test_call_model_reference_system_core`, `test_call_model_template_parameterization`, `test_call_model_agent_loop_capabilities`, `test_call_model_native_tool_registry`, `test_call_model_agent_loop_native`, `test_call_model_agent_loop_budgets`, `test_call_model_agent_loop_usage`, `test_call_model_template_discovery`, `test_call_model_template_tool_conflicts`, `test_call_model_agent_loop_template_tool`, `test_call_model_agent_loop_mixed_tools`, `test_discovery_resolvers`, and `test_call_model_help_resolver`. [VERIFIED: DIRECTED_COVERAGE.md; tests/scenarios/directed/testcases listing]
- Run: `python3 tests/scenarios/directed/run_suite.py --managed <scenario names...>`. [VERIFIED: tests/scenarios/directed/WRITING_SCENARIOS.md]

### Slice 4: Final Audit, VALIDATION.md, and Preflight

Create `.planning/phases/120-cross-phase-atl-validation-coverage-closure/120-VALIDATION.md` and record: [VERIFIED: GSD phase conventions; prior phase validation artifacts]

- Phase-local evidence table for 112-119, including exact commands from verification/summary artifacts and any environmental skips. [VERIFIED: .planning/phases/*-VERIFICATION.md; 113-04-SUMMARY.md]
- Final ATL Test Plan row-to-local-row map covering ATL-DS, ATL-INT, ATL-E2E, and major ATL-U/ATL-I evidence. [VERIFIED: ATL Test Plan; coverage ledgers]
- Full milestone preflight command set: `npm run lint`, focused unit tests for ATL files, `npm run test:integration` focused files, focused E2E, focused directed scenarios, focused YAML integration, `npm run build`, and optionally `npm run preflight` if packaging/docker time and environment allow. [VERIFIED: package.json scripts]

## Validation Architecture

| Property | Value |
|---|---|
| Validation enabled | `workflow.nyquist_validation` is `true`. [VERIFIED: .planning/config.json] |
| Test framework | Vitest 4.1.1 for unit/integration/E2E; Python 3.12.3 scenario runners with PyYAML available. [VERIFIED: package.json; local command probes] |
| Config files | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts`. [VERIFIED: package.json scripts] |
| Directed runner | `python3 tests/scenarios/directed/run_suite.py --managed ...`. [VERIFIED: tests/scenarios/directed/WRITING_SCENARIOS.md] |
| YAML runner | `python3 tests/scenarios/integration/run_integration.py --managed ...`. [VERIFIED: tests/scenarios/integration/README.md] |
| Environment | Node v24.7.0 satisfies project `>=20`; npm 11.5.1; `.env.test` exists; PyYAML import succeeds. [VERIFIED: local command probes; AGENTS.md] |

### Requirement to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| VAL-120 | Cross-phase E2E workflows | E2E | `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts tests/e2e/call-model-template-tools.e2e.test.ts` plus any new E2E file | Existing partial |
| VAL-120 | YAML integration closure | YAML integration | `python3 tests/scenarios/integration/run_integration.py --managed <atl-yaml-tests>` | Gap |
| VAL-120 | Directed public behavior closure | Directed scenario | `python3 tests/scenarios/directed/run_suite.py --managed <atl-directed-tests>` | Existing partial; L-90 pending |
| TEST-04 | Verify phase-local scenario/evidence discipline | Documentation audit | Manual audit recorded in `120-VALIDATION.md` with commands copied from 112-119 artifacts | Gap |

### Sampling Rate

- Per task commit: run the smallest relevant focused command (`npm run test:e2e -- <file>`, one YAML test, or one directed scenario). [VERIFIED: package scripts and scenario docs]
- Per wave merge: run the full focused ATL subset for that surface. [VERIFIED: prior phase validation pattern]
- Phase gate: run lint, build, focused unit/integration/E2E, focused directed scenarios, focused YAML integration, then document skips. [VERIFIED: .planning/ROADMAP.md; package.json]

## Risks And Constraints

- FlashQuery is TypeScript strict-mode ESM, CLI + MCP only; do not build a web UI and do not use CommonJS. [VERIFIED: AGENTS.md]
- Do not use `npm link`; local development uses `npm run dev` or built `dist/index.js`. [VERIFIED: AGENTS.md]
- MCP tool handlers return text content arrays and `isError: true` on failure; directed tests should assert public MCP JSON/text, not private internals. [VERIFIED: AGENTS.md; directed scenario guide]
- Scenario tests should use public MCP tools and vault-visible state, not direct DB assertions, except TypeScript integration tests where DB behavior is the subject. [VERIFIED: tests/scenarios/directed/WRITING_SCENARIOS.md; 120-CONTEXT.md]
- YAML integration runner deletes `fqc_*` rows before/after tests; only use a throwaway Supabase/PostgreSQL test database. [VERIFIED: tests/scenarios/integration/README.md]
- Real provider correctness is out of scope; deterministic OpenAI-compatible mock providers are the accepted validation approach. [VERIFIED: ATL Test Plan; phase verification artifacts]
- `ATL-INT-04` has no public runtime binding YAML surface; keep it at TypeScript integration unless a real public API exists. [VERIFIED: INTEGRATION_COVERAGE.md]
- If L-90 is implemented, the helper must signal graceful shutdown without waiting for process exit; the existing `FQCServer.stop()` waits and can block an in-flight `call_tool`. [VERIFIED: DIRECTED_COVERAGE.md]

## Sources

- `.planning/phases/120-cross-phase-atl-validation-coverage-closure/120-CONTEXT.md` - locked scope and read-first docs. [VERIFIED]
- `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md` - Phase 120 success criteria, pending requirements, milestone state. [VERIFIED]
- `Agentic-LLM-Tool-Loop.md`, `Document Reference System.md`, `ATL Test Plan.md` - authoritative ATL/DRS requirements and coverage taxonomy. [VERIFIED]
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` - final directed rows L-71 through L-100 and pending L-90. [VERIFIED]
- `tests/scenarios/integration/INTEGRATION_COVERAGE.md` - final integration rows IL-10 through IL-36 and YAML gaps. [VERIFIED]
- `tests/e2e/call-model-agent-loop.e2e.test.ts`, `tests/e2e/call-model-template-tools.e2e.test.ts` - current E2E coverage. [VERIFIED]
- `.planning/phases/112-*` through `.planning/phases/119-*` verification/summary artifacts - phase-local evidence. [VERIFIED]
