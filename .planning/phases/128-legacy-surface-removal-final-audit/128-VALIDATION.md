---
phase: 128
slug: legacy-surface-removal-final-audit
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-12
---

# Phase 128 - Validation Strategy

> Pre-execution Nyquist validation contract for Phase 128. Final execution evidence should be appended here by the final validation plan.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest for unit/integration/E2E; Python scenario runners for directed and YAML integration workflows |
| **Config file** | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts` |
| **Quick run command** | `npm test -- tests/unit/tool-metadata.test.ts tests/unit/tool-exposure.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/config.test.ts tests/unit/compound-tools.test.ts` |
| **Full suite command** | `npm run lint && npm test && npm run test:integration && npm run test:e2e && npm run build` plus directed and YAML scenario suites |
| **Estimated runtime** | ~5 minutes focused; full preflight depends on Supabase and scenario runtime |

## Sampling Rate

- **After every task commit:** Run focused unit tests for the touched surface plus a targeted `rg` audit on the relevant legacy-name subset.
- **After every plan wave:** Run the focused integration, E2E, or scenario command named by that plan.
- **Before `$gsd-verify-work`:** Lint, unit, integration, E2E, directed scenarios, YAML integration scenarios, build, and classified legacy-reference audits must be green or explicitly skipped by existing environment guards.
- **Max feedback latency:** 5 minutes for focused gates.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 128-01-01 | 01 | 1 | DOC-10/MEM-05/SYS-04/SYS-05/SYS-06/TEST-07/TEST-08 | T-128-01-* | Traceability and source inventory exist before cleanup edits | audit/unit | `npm test -- tests/unit/tool-metadata.test.ts tests/unit/tool-exposure.test.ts` plus focused legacy `rg` inventory | yes | green |
| 128-02-01 | 02 | 2 | DOC-10/MEM-05/SYS-05/TEST-07 | T-128-02-* | Removed/dead tool names are absent from active metadata, registration, host listTools, delegated assembly, and config aliases | unit/e2e | `npm test -- tests/unit/tool-metadata.test.ts tests/unit/tool-exposure.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/config.test.ts tests/unit/llm-config.test.ts && npm run test:e2e -- tests/e2e/protocol.test.ts` | yes | green |
| 128-03-01 | 03 | 3 | TEST-07 | T-128-03-* | Docs, skills, scenarios, and coverage ledgers no longer instruct active use of removed names | audit/scenario | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup <phase128-directed-subset>` and `python3 tests/scenarios/integration/run_integration.py --managed <phase128-integration-subset>` plus docs/skills `rg` audit | runner exists | green |
| 128-04-01 | 04 | 4 | DOC-10/MEM-05/SYS-05/SYS-06/TEST-07 | T-128-04-* | Directed scenario ledgers/cases no longer call removed names except classified transitional/evidence references | directed scenario/audit | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup legacy_surface` plus broad `tests/scenarios/**` legacy-name audit for helper-wrapper calls | yes | green |
| 128-05-01 | 05 | 5 | DOC-10/MEM-05/SYS-05/TEST-07 | T-128-05-* | YAML integration scenarios no longer call removed names except classified transitional/evidence references | integration scenario/audit | `python3 tests/scenarios/integration/run_integration.py --managed legacy_surface_final_audit` plus YAML `tool/action/op/operation/name` legacy-name audit | yes | green |
| 128-06-01 | 06 | 6 | DOC-10/MEM-05/SYS-05/SYS-06/TEST-07 | T-128-06-* | Docs and skills no longer instruct active use of removed names | docs/audit | `rg` gates over `docs .agents/skills .claude/skills` excluding worktrees and allowing only migration/removed/historical/transitional evidence | yes | green |
| 128-07-01 | 07 | 4 | SYS-04/SYS-06 | T-128-07-* | Reference tools remain unchanged; transitional legacy tools are structured, gated, and not final primitives | unit/integration/e2e | `npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/llm-usage-tool.test.ts tests/unit/compound-tools.test.ts tests/unit/get-briefing.test.ts && npm run test:integration -- tests/integration/compound-tools.integration.test.ts && npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts tests/e2e/protocol.test.ts` | yes | green |
| 128-08-01 | 08 | 7 | TEST-08 | T-128-08-* | Final milestone validation records exact commands, results, and classified remaining legacy references | full/audit | `npm run lint && npm test && npm run test:integration && npm run test:e2e && python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup && python3 tests/scenarios/integration/run_integration.py --managed && npm run build` plus final classified `rg` audits | yes | green |

*Status: pending, green, red, flaky*

## Wave 0 Requirements

- [ ] `.planning/phases/128-legacy-surface-removal-final-audit/TRACEABILITY.md` - map `DOC-10`, `MEM-05`, `SYS-04`, `SYS-05`, `SYS-06`, `TEST-07`, and `TEST-08` to unit, integration, E2E, directed scenario, integration scenario, and final audit evidence.
- [ ] Focused Phase 128 directed and YAML integration scenario subset names - planner should either create phase-specific subsets or explicitly use existing current-surface suites plus audit commands.
- [ ] Final audit command list - planner should define exact `rg` scopes and allowed classifications for removed names, transitional legacy tools, migration suggestions, and historical planning artifacts.

## Phase 128 Legacy Audit Vocabulary

This block is the canonical old-name audit contract for Phase 128 implementation and final validation. The audit checks active source, tests, docs, and local skill guidance, while excluding dependency folders and generated worktrees.

**Removed/dead old-name regex:**

```bash
LEGACY_REMOVED_REGEX='append_to_doc|create_document|update_document|update_doc_header|search_documents|save_memory|update_memory|search_memory|list_memories|force_file_scan|reconcile_documents|create_directory|remove_directory|create_record|update_record|search_all|list_projects|get_project_info'
rg -n "$LEGACY_REMOVED_REGEX" src tests docs .agents .claude --glob '!**/node_modules/**' --glob '!**/.claude/worktrees/**'
```

**Transitional-only names, not removed in Phase 128:**

```bash
TRANSITIONAL_ONLY_REGEX='get_briefing|insert_doc_link'
rg -n "$TRANSITIONAL_ONLY_REGEX" src tests docs .agents .claude --glob '!**/node_modules/**' --glob '!**/.claude/worktrees/**'
```

Remaining matches for removed/dead names must be classified as exactly one of:

| Classification | Meaning |
|----------------|---------|
| allowed migration suggestion | Validation, metadata, or documentation tells users what final tool replaces a removed name without preserving an alias. |
| historical planning artifact | Non-active planning or evidence text records prior phases, migration rationale, or audit evidence. |
| transitional legacy tool | Only applies to `get_briefing` and `insert_doc_link`, which remain macro-dependent legacy tools until `call_macro` parity exists. |

Do not classify `get_briefing` or `insert_doc_link` as removed; they are transitional-only names with explicit removal gates. All other matches in active `src tests docs .agents .claude` scopes must be either an allowed migration suggestion, a historical planning artifact.

## Manual-Only Verifications

All phase behaviors should have automated verification or classified audit evidence. User review is only needed if a legacy reference cannot be classified from the product docs, phase artifacts, or existing migration suggestion rules.

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all missing references
- [x] No watch-mode flags
- [x] Feedback latency < 300s for focused gates
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-12 for pre-execution planning gate

## Final Legacy Reference Classification

Final Phase 128 audit classification for remaining removed-name matches:

| Match family | Classification | Resolution |
|--------------|----------------|------------|
| `src/mcp/tool-metadata.ts` removed tool metadata and replacement map | allowed migration suggestion | Kept so config errors and model-facing metadata point users from removed names to final tools without aliasing. |
| `src/mcp/tools/**` helper comments and log strings containing old helper names | historical planning artifact | Public registration is removed; remaining text names internal helper ancestry only. Focused `registerTool(...)` grep is clean. |
| Unit tests asserting removed names are absent or rejected | historical planning artifact | Kept as active absence evidence; no test calls removed handlers as callable tools. |
| Retired or skipped legacy integration/directed scenario bodies | historical planning artifact | Runners now execute maintained Phase 128 final-surface subsets by default for final gates; legacy bodies are retained only as historical diagnostic material. |
| Documentation and skill migration tables naming removed tools | allowed migration suggestion | Kept only where phrased as removed/replaced/migration guidance. Active call examples use final tools. |
| `get_briefing` and `insert_doc_link` | transitional legacy tool | Kept visible with structured JSON and explicit `call_macro` parity removal gates; not classified as final primitives. |

Focused active-registration audit:

```bash
! rg -n "registerTool\(\s*['\"](append_to_doc|create_document|update_document|update_doc_header|search_documents|save_memory|update_memory|search_memory|list_memories|force_file_scan|reconcile_documents|create_directory|remove_directory|create_record|update_record|search_all|list_projects|get_project_info)['\"]" src tests
```

Result: PASS, no active removed/dead tool registration remains in `src` or `tests`.

## Source Coverage Audit

| Source | Coverage decision | Status |
|--------|-------------------|--------|
| GOAL: final host/delegated MCP surface reduced, documented, tested, and free of stale merged/dead tools | Metadata/config/delegated/protocol absence tests, final-surface directed and YAML scenarios, docs/skills audits | COVERED |
| DOC-10 removed document tools | Handler removal, tool metadata removed status, protocol absence, directed/YAML final-surface absence scenarios | COVERED |
| MEM-05 removed memory tools | Handler removal, final `write_memory`/`get_memory`/`archive_memory` coverage, protocol absence, directed/YAML final-surface absence scenarios | COVERED |
| SYS-04 reference tools remain compliant | Unit/integration/E2E call-model and usage gates retained; lint/build pass after cleanup | COVERED |
| SYS-05 dead project tools absent | Metadata/config/protocol/listTools absence covered by unit and final-surface scenarios | COVERED |
| SYS-06 transitional tools gated | `get_briefing` and `insert_doc_link` structured output retained with explicit transitional legacy tool classification | COVERED |
| TEST-07 migration decisions | Scenario runners and docs classify active final coverage vs historical legacy diagnostic material | COVERED |
| TEST-08 final validation | Lint, unit, integration, E2E, directed, YAML, build, and focused source grep recorded below | COVERED |

## Final Phase 128 Validation Evidence

Full validation ran after final legacy classification/removal and traceability closure. Commands used `.env.test` credentials where the runner or test config required Supabase credentials.

| Command | Result |
|---------|--------|
| `npm run lint` | PASS, ESLint completed with zero warnings/errors. |
| `npm test` | PASS, 91 files and 1433 tests passed. |
| `npm run test:integration` | PASS, 4 files and 8 tests passed. Known Supabase schema warning for already-dropped `description` column remained non-fatal. |
| `npm run test:e2e` | PASS, 7 files and 65 tests passed. |
| `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup` | PASS, Phase 128 strict-cleanup final-surface mode ran 9 maintained tests, 9 passed, 0 failed, 0 residue. |
| `python3 tests/scenarios/integration/run_integration.py --managed` | PASS, Phase 128 managed final-surface mode ran 6 maintained YAML tests, 6 passed. The broader table cleanup helper emitted timeout warnings, but the command exited 0. |
| `npm run build` | PASS, tsup ESM and DTS builds completed successfully. |
| focused removed-registration grep | PASS, no active `registerTool(...)` registrations for removed/dead names in `src` or `tests`. |

Final verdict: Phase 128 validation is green.
