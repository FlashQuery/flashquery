---
phase: 129-correct-delegated-tier-eligibility-derivation
secured: 2026-05-13
asvs_level: standard
threats_total: 12
threats_closed: 12
threats_open: 0
block_on: open_threats
---

# Phase 129 Security Verification

Security audit verified declared mitigations from the Phase 129 threat registers against implemented code, tests, scenarios, coverage ledgers, and documentation. Implementation files were read only; this file is the only audit output.

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-129-01 | Information Disclosure / Elevation of Privilege | mitigate | CLOSED | `src/mcp/tool-metadata.ts:33` defines `DATA_CATEGORIES` as `doc-read`, `doc-write`, `memory`, `plugin`; `src/mcp/tool-metadata.ts:296` derives tier names through `isDelegatedTierEligible`; `src/mcp/tool-metadata.ts:304` applies the common filter; `tests/unit/tool-metadata.test.ts:185` and `tests/unit/tool-metadata.test.ts:271` assert `get_llm_usage` absence. |
| T-129-02 | Elevation of Privilege | mitigate | CLOSED | `src/mcp/tool-metadata.ts:16` and `src/mcp/tool-metadata.ts:17` define hard/delegated exclusion fields; `src/mcp/tool-metadata.ts:310` through `src/mcp/tool-metadata.ts:314` reject both; `tests/unit/tool-metadata.test.ts:219` spot-checks hard exclusions; `tests/unit/tool-metadata.test.ts:287` verifies synthetic `delegatedExclusionReason`. |
| T-129-03 | Tampering | mitigate | CLOSED | `rg CURRENT_DELEGATED_TIER_ORDER/CURRENT_DELEGATED_TIER_TOOLS` over implementation/test/doc files returned no source hits; `src/mcp/tool-metadata.ts:296` uses metadata derivation instead of replacement allow-list tokens. |
| T-129-04 | Information Disclosure | mitigate | CLOSED | `src/mcp/tool-exposure.ts:123` expands host tiers separately via host metadata; `tests/unit/tool-exposure.test.ts:63` asserts host tiers are not delegated policy; `tests/unit/tool-exposure.test.ts:69` and `tests/unit/tool-exposure.test.ts:74` assert host read-only/read-write still include `get_llm_usage`. |
| T-129-05 | Elevation of Privilege | mitigate | CLOSED | `src/llm/tool-registry.ts:85` materializes delegated tiers from `getToolNamesByTier`; `src/llm/tool-registry.ts:245` through `src/llm/tool-registry.ts:282` applies catalog, explicit tools, exclusions, and hard exclusions; `tests/integration/tool-registry.test.ts:145`, `tests/integration/tool-registry.test.ts:160`, and `tests/integration/tool-registry.test.ts:173` verify `excludedTools`, `call_model`, and `maintain_vault`. |
| T-129-06 | Information Disclosure | mitigate | CLOSED | `tests/unit/llm-tool-registry.test.ts:229` and `tests/unit/llm-tool-registry.test.ts:243` assert delegated broad tiers contain corrected tools and exclude `get_llm_usage`, `call_model`, and `maintain_vault`; `tests/e2e/call-model-agent-loop.e2e.test.ts:329` asserts public metadata/provider tools exclude `get_llm_usage` and `call_model`. |
| T-129-07 | Tampering | mitigate | CLOSED | `src/mcp/tool-exposure.ts` remains a separate host exposure implementation; `tests/unit/tool-exposure.test.ts:63` through `tests/unit/tool-exposure.test.ts:75` explicitly protects host tier behavior including `get_llm_usage`. |
| T-129-08 | Repudiation | mitigate | CLOSED | `tests/e2e/call-model-agent-loop.e2e.test.ts:329` through `tests/e2e/call-model-agent-loop.e2e.test.ts:366` provides public metadata/provider-visible proof for corrected delegated tools and blocked tools before scenario/docs closure. |
| T-129-09 | Repudiation | mitigate | CLOSED | `tests/scenarios/directed/DIRECTED_COVERAGE.md:25` through `tests/scenarios/directed/DIRECTED_COVERAGE.md:28` add POST-01 MT rows; `tests/scenarios/integration/INTEGRATION_COVERAGE.md:256` adds IL-43; `TRACEABILITY.md:11` maps POST-01 across all evidence layers. |
| T-129-10 | Information Disclosure | mitigate | CLOSED | `docs/LLM Providers Models and Purposes.md:305` states broad delegated tiers are data-category filtered and `get_llm_usage` is excluded; `docs/LLM Providers Models and Purposes.md:306` lists corrected read-write delegated tools. |
| T-129-11 | Elevation of Privilege | mitigate | CLOSED | `tests/scenarios/directed/testcases/test_delegated_tier_eligibility.py:278` through `tests/scenarios/directed/testcases/test_delegated_tier_eligibility.py:291` assert corrected tools included and blocked tools absent; `tests/scenarios/directed/testcases/test_delegated_tier_eligibility.py:306` verifies deterministic delegated `insert_in_doc` dispatch; `tests/scenarios/integration/tests/delegated_tier_eligibility.yml:48` through `tests/scenarios/integration/tests/delegated_tier_eligibility.yml:72` verifies delegated metadata and final-tool workflow. |
| T-129-12 | Repudiation | mitigate | CLOSED | `129-MIGRATION-CALLOUT.md:9` through `129-MIGRATION-CALLOUT.md:18` lists exactly `list_vault`, `copy_document`, `insert_in_doc`, and `replace_doc_section`, and gives `excludedTools` / `excluded_tools` guidance. |

## Unregistered Flags

None. `129-01-SUMMARY.md`, `129-02-SUMMARY.md`, and `129-03-SUMMARY.md` each declare `## Threat Flags` as `None`.

## Accepted Risks

None.

## Transfer Documentation

None. No Phase 129 threat uses `transfer` disposition.

## Audit Notes

- Required planning, summary, verification, review, implementation, test, scenario, and documentation files were loaded before threat classification.
- Verification was limited to the declared threat registers and supplied threat list.
- Implementation files were not modified.
