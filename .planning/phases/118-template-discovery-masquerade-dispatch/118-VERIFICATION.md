---
phase: 118-template-discovery-masquerade-dispatch
verified: 2026-05-06T20:45:07Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: failed
  previous_score: 5/6
  gaps_closed:
    - "Generated tool-name contract reconciled from the original dotted sketch to canonical provider-safe `flashquery_<fq_namespace>_<slug>` in REQUIREMENTS.md, ROADMAP.md, 118-CONTEXT.md, research/plans, tests, and directed coverage."
  gaps_remaining: []
  regressions: []
evidence:
  contract_reconciliation_commit: "7af7d26 docs(118): record provider-safe template tool names"
  canonical_contract:
    - ".planning/REQUIREMENTS.md:37 marks TMPL-07 complete with provider-safe `flashquery_<fq_namespace>_<slug>` and explicitly supersedes dotted names."
    - ".planning/ROADMAP.md:265 success criterion 2 requires provider-safe `flashquery_<fq_namespace>_<slug>`."
    - ".planning/phases/118-template-discovery-masquerade-dispatch/118-CONTEXT.md:31-32 makes underscore names canonical and records the accepted 2026-05-06 override rationale."
  code_evidence:
    - "src/llm/template-tools.ts:149-155 generates `flashquery_${namespace}_${slug}` and validates provider-safe names with /^[A-Za-z0-9_-]{1,64}$/."
    - "src/llm/template-tools.ts:458-471 builds an explicit Map<generated_name, template_path> reverse map."
    - "src/llm/tool-dispatcher.ts:142-165 routes generated `flashquery_` tool names through `dispatchTemplateToolCall()` before native fallback."
    - "src/llm/agent-loop.ts:452-457 passes `templateReverseMap` into dispatch."
    - "src/mcp/tools/llm.ts:689-699 merges native and template registries before provider invocation."
    - "src/llm/template-tools.ts:508-568 records template calls-log entries with `kind: 'template'`."
  artifact_checks:
    - "gsd-sdk verify.artifacts passed for all 118-01 through 118-05 plan artifacts."
    - "gsd-sdk verify.key-links passed 11/12 plan links; the remaining stale pattern expected `kind: 'template'` in tool-dispatcher, but manual trace verified it in src/llm/template-tools.ts and tests assert it through metadata.tools.calls_log."
  behavioral_spot_checks:
    - command: "npx tsx -e import generateTemplateToolName from src/llm/template-tools.ts"
      result: "Research-Skill.md -> flashquery_skill_research_skill; Document Review.md -> flashquery_review_document_review; Weekly Checklist.md -> flashquery_template_weekly_checklist"
  orchestrator_gates:
    - "npm run build passed"
    - "npm test passed: 78 files, 1655 tests"
    - "npm run test:integration -- tests/integration/template-tools.integration.test.ts passed: 1 file, 3 tests"
    - "npm run test:e2e -- tests/e2e/call-model-template-tools.e2e.test.ts passed: 1 file, 2 tests"
    - "schema drift: drift_detected=false, blocking=false"
    - "code review: clean, 0 findings"
residual_risks:
  - "The 64-character provider-name limit is enforced by returning null for over-limit generated names; this is correct for the reconciled contract but long filenames will surface as discovery warnings instead of tools."
  - "External provider constraints can change; future provider adapters should keep name validation tied to provider capability rules."
follow_up_routing:
  gate: "Revision Gate closed"
  recommendation: "Proceed to Phase 119. No Phase 118 blocking gaps remain."
human_verification: []
---

# Phase 118: Template Discovery & Masquerade Dispatch Verification Report

**Phase Goal:** Vault templates bound to purposes become collision-safe model-visible tools and can be invoked by delegated models inside the agent loop.
**Verified:** 2026-05-06T20:45:07Z
**Status:** passed
**Re-verification:** Yes - after contract reconciliation commit `7af7d26`

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Template discovery reads current vault frontmatter and validates the v1 template tool contract. | VERIFIED | `assembleTemplateToolRegistry()` reads vault markdown/frontmatter during assembly, validates `fq_template`, `fq_expose_as_tool`, `fq_namespace`, `fq_desc`, and `fq_params`; unit/integration artifacts exist and passed. |
| 2 | Generated tool names use provider-safe `flashquery_<fq_namespace>_<slug>` and collisions are diagnosed before invocation. | VERIFIED | ROADMAP/REQUIREMENTS/CONTEXT now define underscore names as canonical. `generateTemplateToolName()` returns provider-safe names and collision diagnostics include generated names plus template/native sources. Spot check returned `flashquery_skill_research_skill`, `flashquery_review_document_review`, and `flashquery_template_weekly_checklist`. |
| 3 | Dispatcher resolves model tool names through an explicit reverse map, never by re-searching slug parts. | VERIFIED | `templateReverseMap` is assembled in `src/llm/template-tools.ts`, preserved by `mergeModelVisibleToolRegistries()`, passed by `executeAgentLoop()`, and consumed by `dispatchTemplateToolCall()`. No slug-part rediscovery path found. |
| 4 | Template-tool calls validate arguments, hydrate output, and return tool results or typed errors to the delegated model. | VERIFIED | `dispatchTemplateToolCall()` validates object args, reverse-map membership, template existence, param schema, and uses `renderTemplateDocument()`; typed recoverable errors include `invalid_tool_arguments`, `tool_not_in_registry`, `template_not_found`, and template resolver error codes. |
| 5 | Mixed native/template tool purposes can expose both kinds of tools in one model-visible registry. | VERIFIED | `src/mcp/tools/llm.ts` assembles native and template registries, merges them, blocks collisions before provider calls, and Phase 118 E2E/directed tests cover mixed native/template loops. |
| 6 | Phase-specific runnable tests exist and pass for fresh discovery, tool-name generation, collision diagnostics, reverse-map dispatch, template-tool invocation, and mixed native/template loops. | VERIFIED | Required unit, integration, E2E, and directed scenario files exist. Orchestrator reports build, unit, focused integration, focused E2E, schema drift, and code review gates all passed after the latest changes. |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/llm/template-tools.ts` | Fresh discovery, validation, provider-safe names, reverse map, dispatch | VERIFIED | Exists, substantive, wired, and produces real registry/dispatch data. |
| `src/llm/reference-resolver.ts` | Template render primitive | VERIFIED | Exported render path is used by template dispatch. |
| `src/llm/purpose-template-bindings.ts` | Purpose/API template binding lookup | VERIFIED | Used by registry assembly for configured/runtime bindings. |
| `src/llm/tool-registry.ts` | Combined native/template registry and collisions | VERIFIED | Merges provider tools, carries `templateReverseMap`, and computes collisions. |
| `src/mcp/tools/llm.ts` | Public `call_model` and `list_purposes` wiring | VERIFIED | Exposes diagnostics, assembles registries, blocks collisions, and executes Mode 2 with template context. |
| `src/llm/tool-dispatcher.ts` | Template-first dispatch routing | VERIFIED | Routes `flashquery_` generated names through the template dispatcher before native fallback. |
| Phase 118 test files and coverage ledgers | Runnable validation | VERIFIED | Unit/integration/E2E/directed artifacts exist and reported gates passed. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `src/llm/template-tools.ts` | `src/llm/reference-resolver.ts` | `renderTemplateDocument()` | WIRED | SDK key-link verification passed. |
| `src/llm/template-tools.ts` | `src/llm/purpose-template-bindings.ts` | purpose binding lookup | WIRED | SDK key-link verification passed. |
| `src/llm/template-tools.ts` | `src/llm/tool-registry.ts` | schema normalization | WIRED | SDK key-link verification passed. |
| `src/mcp/tools/llm.ts` | `src/llm/template-tools.ts` | `assembleTemplateToolRegistry()` | WIRED | SDK key-link verification passed. |
| `src/mcp/tools/llm.ts` | `src/llm/agent-loop.ts` | final registry selects Mode 2 | WIRED | SDK key-link verification passed. |
| `src/llm/agent-loop.ts` | `src/llm/tool-dispatcher.ts` | `templateReverseMap` dispatcher option | WIRED | SDK key-link verification passed. |
| `src/llm/tool-dispatcher.ts` | `src/llm/template-tools.ts` | `dispatchTemplateToolCall()` | WIRED | SDK key-link verification passed. |
| `src/llm/template-tools.ts` | `metadata.tools.calls_log` | `logEntry.kind` | WIRED | Manual trace verified `kind: 'template'` in template dispatch results and assertions in unit/E2E/directed tests. |

### Data-Flow Trace

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `src/llm/template-tools.ts` | `candidates`, `frontmatter`, `templateReverseMap` | Vault markdown reads plus runtime/config template bindings | Yes | FLOWING |
| `src/mcp/tools/llm.ts` | `toolRegistry` | Native registry plus `assembleTemplateToolRegistry()` plus `mergeModelVisibleToolRegistries()` | Yes | FLOWING |
| `src/llm/tool-dispatcher.ts` | `templateReverseMap` | Per-call registry passed from `executeAgentLoop()` | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Provider-safe generated names | `npx tsx -e "...generateTemplateToolName(...)"` | Returned `flashquery_skill_research_skill`, `flashquery_review_document_review`, and `flashquery_template_weekly_checklist` | PASS |
| Phase gates | Orchestrator-reported gate set | Build/unit/integration/E2E/schema/code-review gates passed | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| TMPL-06 | 118-02 | Fresh frontmatter discovery and template contract validation | SATISFIED | Implementation reads current vault files and validates template exposure contract; integration tests passed. |
| TMPL-07 | 118-02/03 | Provider-safe generated names and explicit reverse map | SATISFIED | Reconciled contract requires `flashquery_<fq_namespace>_<slug>`; code, tests, roadmap, requirements, context, and coverage rows agree. |
| TMPL-08 | 118-04/05 | Template dispatch validation/hydration/results/errors | SATISFIED | Dispatch validates args, hydrates through resolver, returns JSON tool messages and typed recoverable errors. |
| VAL-118 | 118-01/05 | Runnable unit, integration, E2E, directed coverage | SATISFIED | Required test artifacts exist and orchestrator reports relevant gates passed. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---:|---|---|---|
| None | - | - | - | No blocker or warning anti-patterns found in Phase 118 implementation/test surface. |

### Human Verification Required

None. Phase 118 behavior is covered by code inspection, artifact/key-link checks, behavioral spot checks, and automated gates.

### Gaps Summary

No blocking gaps remain. The previous failure was a contract mismatch: planning documents expected dotted generated names while implementation/tests used provider-safe underscores. Commit `7af7d26` reconciled the public contract to `flashquery_<fq_namespace>_<slug>`, matching implementation and validation evidence.

Follow-up routing: proceed to Phase 119 discovery diagnostics/help resolver work. Residual risks are non-blocking provider-name constraint drift and long generated names being excluded via warnings under the current 64-character contract.

---

_Verified: 2026-05-06T20:45:07Z_
_Verifier: the agent (gsd-verifier)_
