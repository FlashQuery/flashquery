---
phase: 143-diagnostic-cli-and-remaining-macro-extensions
reviewed: 2026-05-19T01:29:34Z
depth: standard
files_reviewed: 24
files_reviewed_list:
  - src/cli/commands/list-tools.ts
  - src/services/mcp-broker/cli.ts
  - src/index.ts
  - src/mcp/tools/macro.ts
  - src/macro/evaluator.ts
  - src/macro/parser.ts
  - src/macro/types.ts
  - src/macro/tokens.ts
  - src/macro/introspection.ts
  - tests/unit/list-tools-command.test.ts
  - tests/unit/macro-self.test.ts
  - tests/unit/macro-parser.test.ts
  - tests/unit/macro-evaluator.test.ts
  - tests/unit/macro-introspection.test.ts
  - tests/integration/macro-concurrency.test.ts
  - tests/scenarios/directed/testcases/test_mcp_broker_phase_e.py
  - tests/scenarios/directed/DIRECTED_COVERAGE.md
  - tests/scenarios/integration/tests/cli_list_tools_paste_back.yml
  - tests/scenarios/integration/tests/macro_extensions_compose_rundoc.yml
  - tests/scenarios/integration/INTEGRATION_COVERAGE.md
  - .planning/phases/143-diagnostic-cli-and-remaining-macro-extensions/143-VALIDATION.md
  - .planning/REQUIREMENTS.md
  - /Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Requirements.md
  - /Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Test Plan.md
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
resolved_findings:
  - CR-01
  - CR-02
  - WR-01
resolution_commit: fac39aa
---

# Phase 143: Code Review Report

**Reviewed:** 2026-05-19T01:29:34Z
**Depth:** standard
**Files Reviewed:** 24
**Status:** clean after fixes

## Summary

Reviewed Phase 143 source, unit/integration/scenario tests, and coverage artifacts for the diagnostic `list-tools` CLI and remaining macro extensions. Initial review found two critical issues and one warning; all three were fixed in `fac39aa` and verified with focused unit tests, build, and the Phase E directed scenario.

## Resolved Issues

### CR-01: `_self` root can be rebound, bypassing the read-only source snapshot

**File:** `src/macro/parser.ts:185`
**Issue:** The parser only rejects assignments that look like `_self.<field> = ...`; `_self = ...` falls through to the normal binding path at `src/macro/parser.ts:204`. That lets a source_ref macro overwrite the protected `_self` binding before reading `_self.path`, `_self.frontmatter`, etc. This violates the read-only snapshot contract and can spoof source metadata used for write-through operations.
**Resolution:** `looksLikeSelfAssignment()` now catches bare `_self = ...`, and `tests/unit/macro-self.test.ts` covers `_self = { path: "evil.md" }` with `readonly_self_assignment`.

### CR-02: `list-tools` emits `null` tool override entries that fail config validation when pasted unchanged

**File:** `src/services/mcp-broker/cli.ts:70`
**Issue:** Each discovered tool is emitted as a mapping key with only commented children. YAML parses that as `tool_overrides.echo: null`, but `BrokerToolOverrideSchema` requires each override value to be an object. The command therefore does not meet the paste-ready contract: copying the successful output under `mcp_servers.<server>` creates an invalid FlashQuery config unless the user manually edits every tool.
**Resolution:** The command now emits real `cost_per_call` and `description_override` keys for each tool, and `tests/unit/list-tools-command.test.ts` validates the pasted YAML with `loadConfig`.

### WR-01: Directed scenario includes an invalid unused macro block, so it does not exercise the advertised source_ref `_exists` path

**File:** `tests/scenarios/directed/testcases/test_mcp_broker_phase_e.py:191`
**Issue:** The created rundoc contains a `name=exists` block using brace-style `if missing_phase_e._exists() { ... }`, which is not valid macro grammar. The test never calls this block, so the invalid macro is hidden and the directed suite does not actually exercise that source_ref block despite claiming composed Phase E coverage.
**Resolution:** The scenario now uses valid `then`/`fi` syntax and calls the `exists` source_ref block during the Phase E directed scenario.

## Verification

- `npm test -- --run tests/unit/list-tools-command.test.ts tests/unit/macro-self.test.ts` — passed, 7 tests
- `npm run build` — passed
- `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_mcp_broker_phase_e` — passed, 8/8 steps, zero residue

---

_Reviewed: 2026-05-19T01:29:34Z; fixes verified after `fac39aa`_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
