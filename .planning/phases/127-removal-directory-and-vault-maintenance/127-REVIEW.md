---
phase: 127-removal-directory-and-vault-maintenance
reviewed: 2026-05-12T21:57:43Z
depth: standard
files_reviewed: 34
files_reviewed_list:
  - src/config/loader.ts
  - src/constants/frontmatter-fields.ts
  - src/git/manager.ts
  - src/mcp/tool-exposure.ts
  - src/mcp/tool-metadata.ts
  - src/mcp/tools/documents.ts
  - src/mcp/tools/files.ts
  - src/mcp/tools/scan.ts
  - src/mcp/utils/response-formats.ts
  - src/services/maintenance.ts
  - src/services/scanner.ts
  - src/storage/vault.ts
  - tests/e2e/protocol.test.ts
  - tests/integration/maintain-vault.integration.test.ts
  - tests/integration/manage-directory.integration.test.ts
  - tests/integration/remove-document.integration.test.ts
  - tests/scenarios/directed/DIRECTED_COVERAGE.md
  - tests/scenarios/directed/testcases/test_removal_directory_maintenance.py
  - tests/scenarios/framework/fqc_test_utils.py
  - tests/scenarios/integration/INTEGRATION_COVERAGE.md
  - tests/scenarios/integration/README.md
  - tests/scenarios/integration/run_integration.py
  - tests/scenarios/integration/tests/removal_directory_maintenance.yml
  - tests/unit/config.test.ts
  - tests/unit/files-tools.test.ts
  - tests/unit/frontmatter-fields.test.ts
  - tests/unit/git-manager.test.ts
  - tests/unit/maintain-vault.test.ts
  - tests/unit/manage-directory.test.ts
  - tests/unit/remove-document.test.ts
  - tests/unit/response-formats.test.ts
  - tests/unit/scanner.test.ts
  - tests/unit/tool-metadata.test.ts
  - tests/unit/vault.test.ts
findings:
  critical: 0
  warning: 1
  info: 0
  total: 1
status: issues_found
---

# Phase 127: Code Review Report

**Reviewed:** 2026-05-12T21:57:43Z
**Depth:** standard
**Files Reviewed:** 34
**Status:** issues_found

## Summary

Reviewed the final Phase 127 removal, directory, and vault maintenance implementation and its unit, integration, E2E, directed, and YAML scenario coverage. Commit `26c107d` fixes the prior timestamp trash collision issue by probing timestamp suffixes until an unused destination is found. One remaining quality/correctness issue remains in the tool metadata/config validation path for removed tools.

## Warnings

### WR-01: Removed tools are still admitted into delegated tool allowlists

**Classification:** WARNING

**File:** `src/mcp/tool-metadata.ts:293`

**Issue:** `getToolNamesByTier()` filters by `delegatedEligible` but never filters out `status: "removed"`, and `current()` still marks removed read/write entries as `delegatedEligible` when they appear in `CURRENT_DELEGATED_TIER_ORDER`. As a result, `tier:read-write` still expands to removed names such as `create_directory` and `remove_directory`, while host registration explicitly hides those same local merged surfaces. `loadConfig()` also accepts an explicit purpose tool like `create_directory` because it only turns legacy suggestions into config errors when `metadata.hostEligible === false` (`src/config/loader.ts:576`). A purpose can therefore validate successfully with a removed local tool, but the model-visible runtime catalog will not contain that tool, producing a silent missing-tool/unknown-tool path instead of the documented replacement guidance.

**Fix:**
```ts
function isAvailable(entry: ToolMetadata, options: ExpandToolSelectorsOptions): boolean {
  if (options.includeUnavailable !== true && entry.status !== 'final' && entry.status !== 'transitional') {
    return false;
  }
  if (options.hostEligible !== undefined && entry.hostEligible !== options.hostEligible) return false;
  if (options.delegatedEligible !== undefined && entry.delegatedEligible !== options.delegatedEligible) return false;
  return true;
}

export function getToolNamesByTier(tier: ToolTierSelector): string[] {
  const targetTier = tier === 'tier:read-only' ? 'read-only' : 'read-write';
  return CURRENT_DELEGATED_TIER_ORDER
    .map((name) => getToolMetadata(name))
    .filter((entry): entry is ToolMetadata => entry !== undefined)
    .filter((entry) => entry.status !== 'removed')
    .filter((entry) => entry.delegatedEligible)
    .filter((entry) => entry.tier === 'read-only' || (targetTier === 'read-write' && entry.tier === 'read-write'))
    .map((entry) => entry.name);
}
```

Also update `loadConfig()` to reject any `getLegacyToolSuggestion(tool)` where `metadata.status === "removed"`, regardless of host eligibility, and adjust `tests/unit/tool-metadata.test.ts` so removed Phase 127 tools are absent from delegated tier/category expansion.

---

_Reviewed: 2026-05-12T21:57:43Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
