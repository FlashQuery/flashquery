---
phase: 154
slug: residual-import-cycle-cleanup
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-26
updated: 2026-05-26
---

# Phase 154 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

State B reconstruction from Phase 154 PLAN, SUMMARY, and VERIFICATION artifacts. No prior `154-VALIDATION.md` existed.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.x plus pinned `madge@8.0.0` static graph checks |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.macro-framework.config.ts`, `package.json` scripts |
| Quick run command | `npm test -- tests/unit/circular-deps.test.ts tests/unit/llm-config.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/llm-client.test.ts tests/unit/llm-config-sync.test.ts tests/unit/purpose-template-bindings.test.ts tests/unit/template-tools.test.ts tests/unit/reference-resolver.test.ts tests/unit/embedding-provider.test.ts tests/unit/mcp-request-drain.test.ts tests/unit/mcp-server-correlation.test.ts` |
| Full suite command | `npm run test:integration -- tests/integration/reference-resolver.integration.test.ts tests/integration/server/shutdown-mcp-drain.test.ts` plus `npm run typecheck`, `npm run lint`, `npm run knip`, `npm run build`, and conditional `npm run test:macro-framework` |
| Estimated runtime | ~75 seconds for the reconstructed Phase 154 gate set in this workspace |

---

## Sampling Rate

- After every task commit: run the plan-local `<automated>` command listed in the per-task map.
- After every plan wave: run the relevant focused unit/integration aggregate for the wave.
- Before `$gsd-verify-work`: run the full Phase 154 gate set shown below.
- Max feedback latency: ~75 seconds for the required focused gate set; individual plan-local commands are shorter.

---

## Requirement-To-Task Map

| Requirement | Task / Plan Carriers | Required Behavior | Existing Automated Coverage | Classification |
|-------------|----------------------|-------------------|-----------------------------|----------------|
| REQ-010 | `154-01` tasks 1-2; `154-06` tasks 1-2 | `src/config/loader.ts` and LLM validation/registry imports are acyclic; policy extraction preserves config, admission, hard-exclusion, tier, and metadata behavior. | `tests/unit/circular-deps.test.ts` T-U-031/T-U-032; `tests/unit/llm-config.test.ts`; `tests/unit/llm-tool-registry.test.ts`; pinned madge; typecheck/lint/knip/build. | COVERED |
| REQ-011 | `154-02`, `154-04`, `154-05`, and `154-06` tasks | LLM runtime, template, reference, embedding, storage, and logging imports are acyclic; fallback, cost recording, config sync, template tools, reference hydration, metadata, embedding dimensions, and scheduling remain unchanged. | `tests/unit/circular-deps.test.ts` T-U-031/T-U-033; `tests/unit/llm-client.test.ts`; `tests/unit/llm-config-sync.test.ts`; `tests/unit/purpose-template-bindings.test.ts`; `tests/unit/template-tools.test.ts`; `tests/unit/reference-resolver.test.ts`; `tests/unit/embedding-provider.test.ts`; `tests/integration/reference-resolver.integration.test.ts` T-I-010; conditional macro framework; pinned madge; typecheck/lint/knip/build. | COVERED |
| REQ-012 | `154-03` tasks 1-2; `154-06` tasks 1-2 | `src/mcp/server.ts` and `src/server/shutdown.ts` are acyclic through a dependency-light lifecycle registry; shutdown drains in-flight MCP requests with the deadline and preserves register/unregister behavior. | `tests/unit/circular-deps.test.ts` T-U-031/T-U-034; `tests/unit/mcp-request-drain.test.ts` T-U-037; `tests/unit/mcp-server-correlation.test.ts`; `tests/integration/server/shutdown-mcp-drain.test.ts` T-I-011; pinned madge; typecheck/lint/knip/build. | COVERED |

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 154-01-01 | 01 | 1 | REQ-010 | T-154-010-01 / T-154-010-02 | Config validation and tool-policy behavior remain stable while adding the targeted config-loader cycle guard. | unit/static | `npm test -- tests/unit/circular-deps.test.ts tests/unit/llm-config.test.ts tests/unit/llm-tool-registry.test.ts` | yes | green |
| 154-01-02 | 01 | 1 | REQ-010 | T-154-010-01 / T-154-010-02 | Config loader depends on dependency-light type/policy leaves and no madge cycle contains `config/loader.ts`. | unit/static | `sh -c 'npx --yes madge@8.0.0 src --extensions ts --circular > /tmp/fq-154-config-cycle.txt 2>&1 || true; ! rg "config/loader\\.ts" /tmp/fq-154-config-cycle.txt'` | yes | green |
| 154-02-01 | 02 | 2 | REQ-011 | T-154-011A-01 / T-154-011A-02 | LLM fallback ordering, error classification, retry delay cap, and usage recording remain stable. | unit | `npm test -- tests/unit/llm-client.test.ts` | yes | green |
| 154-02-02 | 02 | 2 | REQ-011 | T-154-011A-01 / T-154-011A-02 | Resolver no longer imports client implementation; shared LLM runtime contracts live in leaf modules. | unit/static | `rg -n "from './client\\.js'|from '../llm/client\\.js'" src/llm/resolver.ts src/llm/types.ts && exit 1 || exit 0` | yes | green |
| 154-03-01 | 03 | 1 | REQ-012 | T-154-012-01 / T-154-012-02 / T-154-012-03 | Lifecycle registry behavior is covered before removing the server/shutdown back-edge. | unit/integration | `npm test -- tests/unit/mcp-request-drain.test.ts tests/unit/mcp-server-correlation.test.ts && npm run test:integration -- tests/integration/server/shutdown-mcp-drain.test.ts` | yes | green |
| 154-03-02 | 03 | 1 | REQ-012 | T-154-012-01 / T-154-012-02 / T-154-012-03 | Shutdown and MCP server lifecycle share state without direct or dynamic back-edge cycles. | unit/static/integration | `sh -c 'npx --yes madge@8.0.0 src --extensions ts --circular > /tmp/fq-154-mcp-cycle.txt 2>&1 || true; ! rg "mcp/server\\.ts.*server/shutdown\\.ts|server/shutdown\\.ts.*mcp/server\\.ts" /tmp/fq-154-mcp-cycle.txt'` | yes | green |
| 154-04-01 | 04 | 2 | REQ-011 | T-154-011B-01 / T-154-011B-02 | Config sync, template binding, reference hydration, and injected metadata behavior remain stable. | unit/integration | `npm test -- tests/unit/llm-config-sync.test.ts tests/unit/purpose-template-bindings.test.ts tests/unit/template-tools.test.ts tests/unit/reference-resolver.test.ts && npm run test:integration -- tests/integration/reference-resolver.integration.test.ts` | yes | green |
| 154-04-02 | 04 | 2 | REQ-011 | T-154-011B-01 / T-154-011B-02 | Config-sync and reference metadata leaves remove import back-edges without response-shape drift. | unit/static/integration | `rg -n "from './config-sync\\.js'|from './reference-resolver\\.js'|from '../llm/reference-resolver\\.js'" src/llm/purpose-template-bindings.ts src/llm/types.ts && exit 1 || exit 0` | yes | green |
| 154-05-01 | 05 | 2 | REQ-011 | T-154-011C-01 / T-154-011C-02 / T-154-011C-03 | Embedding dimension precedence and fallback behavior remain stable. | unit | `npm test -- tests/unit/embedding-provider.test.ts` | yes | green |
| 154-05-02 | 05 | 2 | REQ-011 | T-154-011C-01 / T-154-011C-02 / T-154-011C-03 | Storage/logging import boundaries avoid provider/config-loader back-edges. | unit/static | `rg -n "from '../embedding/provider\\.js'|from '../config/loader\\.js'" src/storage/supabase.ts src/logging/logger.ts && exit 1 || exit 0` | yes | green |
| 154-06-01 | 06 | 3 | REQ-010, REQ-011, REQ-012 | T-154-FINAL-01 / T-154-FINAL-02 | Final pinned static graph has zero production `src/` cycles and targeted family failure messages. | unit/static | `npm test -- tests/unit/circular-deps.test.ts && npx --yes madge@8.0.0 src --extensions ts --circular` | yes | green |
| 154-06-02 | 06 | 3 | REQ-010, REQ-011, REQ-012 | T-154-FINAL-01 / T-154-FINAL-02 | Final unit, integration, static, typecheck, lint, knip, build, and macro gates pass. | unit/integration/static/command | Full Phase 154 gate set in "Observed Audit Run". | yes | green |

---

## Test ID Coverage

| Test ID | Requirement(s) | Carrier | Status |
|---------|----------------|---------|--------|
| T-U-031 | REQ-010, REQ-011, REQ-012 | `tests/unit/circular-deps.test.ts` final pinned madge zero-cycle assertion | green |
| T-U-032 | REQ-010 | `tests/unit/circular-deps.test.ts` config-loader cycle-line assertion | green |
| T-U-033 | REQ-011 | `tests/unit/circular-deps.test.ts` LLM/template/reference/embedding/storage/logging family cycle assertion | green |
| T-U-034 | REQ-012 | `tests/unit/circular-deps.test.ts` MCP server/shutdown cycle assertion | green |
| T-U-035 | REQ-010 | `tests/unit/llm-config.test.ts`, `tests/unit/llm-tool-registry.test.ts` | green |
| T-U-036 | REQ-011 | `tests/unit/llm-client.test.ts`, `tests/unit/llm-config-sync.test.ts`, `tests/unit/purpose-template-bindings.test.ts`, `tests/unit/template-tools.test.ts`, `tests/unit/reference-resolver.test.ts`, `tests/unit/embedding-provider.test.ts` | green |
| T-U-037 | REQ-012 | `tests/unit/mcp-request-drain.test.ts`, `tests/unit/mcp-server-correlation.test.ts` | green |
| T-I-010 | REQ-011 | `tests/integration/reference-resolver.integration.test.ts` | green |
| T-I-011 | REQ-012 | `tests/integration/server/shutdown-mcp-drain.test.ts` | green |
| T-C-007 | REQ-010, REQ-011, REQ-012 | `npm run typecheck` | green |
| T-C-008 | REQ-010, REQ-011, REQ-012 | `npm run lint` | green |
| T-C-009 | REQ-010, REQ-011, REQ-012 | `npm run knip` | green |
| T-C-010 | REQ-010, REQ-011, REQ-012 | `npm run build` | green |
| T-C-011 | REQ-011 | Conditional macro grep triggered; `npm run test:macro-framework` | green |

---

## Observed Audit Run

Commands run during this validation reconstruction on 2026-05-26:

| Command | Observed Result |
|---------|-----------------|
| `npm test -- tests/unit/circular-deps.test.ts tests/unit/llm-config.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/llm-client.test.ts tests/unit/llm-config-sync.test.ts tests/unit/purpose-template-bindings.test.ts tests/unit/template-tools.test.ts tests/unit/reference-resolver.test.ts tests/unit/embedding-provider.test.ts tests/unit/mcp-request-drain.test.ts tests/unit/mcp-server-correlation.test.ts` | passed: 11 files, 226 tests |
| `npm run test:integration -- tests/integration/reference-resolver.integration.test.ts tests/integration/server/shutdown-mcp-drain.test.ts` | passed: 2 files, 12 tests; logged expected background embedding API-key errors while the suite still passed |
| `npx --yes madge@8.0.0 src --extensions ts --circular` | passed: no circular dependency found; processed 142 files |
| `npm run typecheck` | passed |
| `npm run lint` | passed |
| `npm run knip` | passed |
| `npm run build` | passed |
| `if rg -n "from ['\\\"].*(llm/(types|runtime-types|tool-registry|client)|native-tool)" src/macro tests/scenarios tests/unit tests/integration; then npm run test:macro-framework; else echo "T-C-011 not triggered"; fi` | triggered and passed: 1 file, 518 tests |

---

## Wave 0 Requirements

Existing infrastructure covers all Phase 154 requirements. No Wave 0 test stubs or framework installation were required.

---

## Manual-Only Verifications

All Phase 154 behaviors have automated verification.

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| N/A | N/A | N/A | N/A |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands or existing automated carriers.
- [x] Sampling continuity: no 3 consecutive tasks without automated verification.
- [x] Wave 0 covers all missing references; no missing references found.
- [x] No watch-mode flags in validation commands.
- [x] Feedback latency is under the reconstructed ~75 second focused gate budget.
- [x] `nyquist_compliant: true` set in frontmatter.
- [x] `wave_0_complete: true` set in frontmatter.

Approval: approved 2026-05-26
