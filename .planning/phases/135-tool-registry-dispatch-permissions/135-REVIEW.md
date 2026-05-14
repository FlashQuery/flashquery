---
phase: 135-tool-registry-dispatch-permissions
reviewed: 2026-05-14T19:23:05Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/macro/dispatcher.ts
  - src/macro/evaluator.ts
  - src/macro/permission-prescan.ts
  - src/macro/registry.ts
  - src/macro/types.ts
  - src/mcp/tools/macro.ts
  - tests/config/vitest.integration.config.ts
  - tests/integration/macro-tool-dispatch.test.ts
  - tests/unit/macro-caller-identity.test.ts
  - tests/unit/macro-dispatcher.test.ts
  - tests/unit/macro-hard-exclusions.test.ts
  - tests/unit/macro-permission-prescan.test.ts
  - tests/unit/macro-registry.test.ts
  - tests/unit/mcp-server-tools.test.ts
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
---

# Phase 135: Code Review Report

**Reviewed:** 2026-05-14T19:23:05Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** clean

## Summary

Re-reviewed the macro dispatch, evaluator permission pre-scan, registry construction, public `call_macro` wiring, and the listed unit/integration tests after the code-review fixes. The prior findings were addressed:

- Delegated `fq.call_model` hard exclusions are now checked before unknown-tool classification, preserving the `forbidden_tools` response and `recursive_model_excluded_from_delegated_macros` reason.
- Template masquerade detection now accepts both unqualified generated template names and fully qualified tool references.
- `brokerTools` is threaded through `runMacroSource` and `registerMacroTools` into `buildToolRegistry`.
- `call_macro` validates `source` and `source_ref` as mutually exclusive before the unsupported `source_ref` branch.

All reviewed files meet quality standards. No issues found.

## Verification

Focused unit tests passed:

```text
npx vitest run tests/unit/macro-caller-identity.test.ts tests/unit/macro-dispatcher.test.ts tests/unit/macro-hard-exclusions.test.ts tests/unit/macro-permission-prescan.test.ts tests/unit/macro-registry.test.ts tests/unit/mcp-server-tools.test.ts --config tests/config/vitest.unit.config.ts

Test Files  6 passed (6)
Tests       33 passed (33)
```

---

_Reviewed: 2026-05-14T19:23:05Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
