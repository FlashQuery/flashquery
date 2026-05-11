---
phase: 122-host-tool-exposure-config
reviewed: 2026-05-11T22:40:27Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - src/mcp/tool-exposure.ts
  - src/config/loader.ts
  - src/mcp/tool-catalog.ts
  - src/mcp/server.ts
  - tests/helpers/mcp-server-fixture.ts
  - tests/e2e/protocol.test.ts
  - tests/scenarios/integration/run_integration.py
  - tests/fixtures/flashquery.e2e.host-filtered.yaml
  - tests/scenarios/directed/testcases/test_foundation_host_tool_exposure.py
  - tests/scenarios/integration/tests/foundation_host_tool_exposure.yml
  - tests/unit/tool-exposure.test.ts
  - tests/unit/config.test.ts
  - tests/unit/llm-config.test.ts
  - tests/unit/llm-tool-registry.test.ts
  - tests/unit/mcp-server-tools.test.ts
  - tests/scenarios/directed/DIRECTED_COVERAGE.md
  - tests/scenarios/integration/INTEGRATION_COVERAGE.md
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
---

# Phase 122: Code Review Report

**Reviewed:** 2026-05-11T22:40:27Z
**Depth:** standard
**Files Reviewed:** 17
**Status:** clean after fixes

## Summary

Reviewed the host MCP exposure implementation, config loading path, server registration filter, E2E fixture changes, unit tests, and the new directed/integration scenario coverage. The initial review found one blocker and two coverage warnings; all were fixed and revalidated.

## Resolution

- CR-01 fixed: `src/mcp/tool-exposure.ts` now expands host `tier:*` selectors from host-eligible metadata directly, and `tests/unit/tool-exposure.test.ts` asserts `tier:read-only` includes `list_vault`/`get_llm_usage` while excluding write tools.
- WR-01 fixed: `tests/scenarios/directed/testcases/test_foundation_host_tool_exposure.py` now uses `tier:read-only` in its selector scenario.
- WR-02 fixed: `tests/scenarios/integration/tests/foundation_host_tool_exposure.yml` now includes runnable startup-success and startup-failure steps for warning-only config and legacy purpose-name validation.

## Current Findings

No open findings.

## Critical Issues

Resolved. See CR-01 history below.

### CR-01: BLOCKER - Host Tier Selectors Use Delegated Tier Expansion

**File:** `src/mcp/tool-exposure.ts:104`

**Issue:** `expandHostSelectors()` delegates all selector expansion to `expandToolSelectors(..., { hostEligible: true })`. For `tier:read-only` and `tier:read-write`, `expandToolSelectors()` calls `getToolNamesByTier()`, which is the delegated-native tier list and only contains `delegatedEligible` tools. That omits host-eligible tools that are not delegated model tools. For example, `resolveHostToolExposure({ tools: ['tier:read-only'] })` currently returns `search_documents,get_document,search_memory,get_memory,list_memories,search_records,get_record,search_all,get_briefing` and drops `list_vault` even though `list_vault` is host-eligible and read-only. The same path also drops other host-visible read-only/admin-adjacent tools such as `get_llm_usage` and `get_plugin_info` from tier-based host configuration. This violates the Phase 122 host selector contract and makes valid `host_mcp_tools.tools: [tier:read-only]` configs expose an incomplete MCP surface.

**Fix:**
```ts
function expandHostSelectors(selectors: readonly string[]): string[] {
  const expanded: string[] = [];
  const seen = new Set<string>();

  for (const selector of selectors) {
    const names = selector === 'tier:read-only' || selector === 'tier:read-write'
      ? expandHostTierSelector(selector)
      : expandToolSelectors([selector as ToolSelector], { hostEligible: true })
          .filter((name) => {
            const metadata = getToolMetadata(name);
            return metadata !== undefined && isCurrentHostSelectable(metadata);
          });

    for (const name of names) {
      if (!seen.has(name)) {
        seen.add(name);
        expanded.push(name);
      }
    }
  }

  return expanded;
}

function expandHostTierSelector(selector: 'tier:read-only' | 'tier:read-write'): string[] {
  return listToolMetadata({ hostEligible: true })
    .filter(isCurrentHostSelectable)
    .filter((entry) =>
      selector === 'tier:read-only'
        ? entry.tier === 'read-only'
        : entry.tier === 'read-only' || entry.tier === 'read-write'
    )
    .map((entry) => entry.name);
}
```

Add a regression test asserting `tier:read-only` includes `list_vault` and excludes write tools, and `tier:read-write` includes both read and write host tools.

## Warnings

Resolved. See WR-01 and WR-02 history below.

### WR-01: WARNING - Tier Selector Coverage Is Claimed But Not Tested

**File:** `tests/scenarios/directed/testcases/test_foundation_host_tool_exposure.py:128`

**Issue:** The directed coverage row `D-foundation-tools-3` says host selector expansion accepts category, tier, and explicit tool names, but this test only configures `category:doc-read`, `category:llm`, and explicit `save_memory`. No scenario or unit test in `tests/unit/tool-exposure.test.ts` configures `host_mcp_tools.tools` with `tier:read-only` or `tier:read-write`, which is why CR-01 survives the test suite.

**Fix:** Add explicit host tier cases to `tests/unit/tool-exposure.test.ts` and this directed scenario, for example `extra_config={"host_mcp_tools": {"tools": ["tier:read-only"]}}` with assertions that `list_vault` is present and `create_document` is absent.

### WR-02: WARNING - Integration Scenario Marks Unexercised Behaviors As Passing

**File:** `tests/scenarios/integration/tests/foundation_host_tool_exposure.yml:5`

**Issue:** The YAML scenario declares coverage for `INT-foundation-tools-3`, `INT-foundation-tools-4`, and `INT-foundation-tools-5`, but every step only calls `mcp.list_tools` against one host-filtered config. It never exercises delegated native tool availability through `call_model`, never asserts warning-only startup diagnostics for suspicious category combinations, and never starts a config with removed legacy purpose tool names to assert startup failure. The coverage matrix records those behaviors as passing at `tests/scenarios/integration/INTEGRATION_COVERAGE.md:21-23`, creating false confidence.

**Fix:** Either remove those coverage IDs from this YAML file and mark the rows uncovered, or add executable coverage: a delegated `call_model` diagnostics workflow for INT-3, a managed startup/log assertion for INT-4, and a negative startup test for INT-5.

---

_Reviewed: 2026-05-11T22:40:27Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
