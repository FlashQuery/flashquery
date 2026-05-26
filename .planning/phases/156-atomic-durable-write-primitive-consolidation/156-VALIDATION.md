---
phase: 156
slug: atomic-durable-write-primitive-consolidation
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-26
---

# Phase 156 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest unit + Vitest integration |
| **Config file** | `tests/config/vitest.unit.config.ts`; `tests/config/vitest.integration.config.ts` |
| **Quick run command** | `npm test -- tests/unit/vault-write-primitive.test.ts tests/unit/vault-write-durable.test.ts tests/unit/single-write-primitive.test.ts tests/unit/document-batch-lock-contention.test.ts` |
| **Full suite command** | `npm run test:integration -- tests/integration/atomic-write-frontmatter.integration.test.ts tests/integration/vault-write-durable.integration.test.ts` |
| **Estimated runtime** | Unit: ~30-60s; integration depends on `.env.test` Supabase availability |

---

## Sampling Rate

- **After every task commit:** Run the task's targeted file-based Vitest command.
- **After every plan wave:** Run `npm test -- tests/unit/vault-write-primitive.test.ts tests/unit/vault-write-durable.test.ts tests/unit/single-write-primitive.test.ts tests/unit/document-batch-lock-contention.test.ts`.
- **Before `$gsd-verify-work`:** Run both required ROADMAP evidence commands:
  - `npm test -- tests/unit/vault-write-primitive.test.ts tests/unit/vault-write-durable.test.ts tests/unit/single-write-primitive.test.ts tests/unit/document-batch-lock-contention.test.ts`
  - `npm run test:integration -- tests/integration/atomic-write-frontmatter.integration.test.ts tests/integration/vault-write-durable.integration.test.ts`
- **Max feedback latency:** Keep deterministic unit/static checks under 60 seconds; integration may skip gracefully when `.env.test` is incomplete.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 156-01-01 | 01 | 1 | REQ-021 | T-156-02 | macOS durable-sync strategy is selected before T-U-033 is authored | checkpoint + unit | `test -f .planning/phases/156-atomic-durable-write-primitive-consolidation/156-01-PLAN.md` + human checkpoint | Plan exists | pending |
| 156-01-02 | 01 | 1 | REQ-020/REQ-021 | T-156-01 / T-156-02 | Write failures surface; hash equals committed bytes; durable sequence is encoded in tests after macOS decision | unit | `npm test -- tests/unit/vault-write-primitive.test.ts tests/unit/vault-write-durable.test.ts` | No - W0 | pending |
| 156-01-03 | 01 | 1 | REQ-020/REQ-021 | T-156-03 | `writeVaultFile` performs durable sequence and cleans temp files on failure without swallowing the original error | unit | `npm test -- tests/unit/vault-write-primitive.test.ts tests/unit/vault-write-durable.test.ts` | No - W0 | pending |
| 156-02-01 | 02 | 2 | REQ-020 | T-156-04 | `VaultManager.writeMarkdown` delegates to `writeVaultFile` and returns/propagates content hash behavior | unit | `npm test -- tests/unit/vault.test.ts tests/unit/vault-write-primitive.test.ts tests/unit/vault-write-durable.test.ts tests/unit/document-batch-lock-contention.test.ts` | Partial | pending |
| 156-02-02 | 02 | 2 | REQ-020 | T-156-05 | `atomicWriteFrontmatter` delegates to `writeVaultFile` and propagates write errors | unit/integration | `npm test -- tests/unit/scanner.test.ts tests/unit/vault-write-primitive.test.ts`; `npm run test:integration -- tests/integration/atomic-write-frontmatter.integration.test.ts` | Partial | pending |
| 156-02-03 | 02 | 2 | REQ-020 | T-156-06 | targeted scan/document resolver repair writes route through `writeVaultFile` without changing unchanged-file scanner behavior | unit | `npm test -- tests/unit/plugin-reconciliation.test.ts tests/unit/vault-write-primitive.test.ts tests/unit/document-batch-lock-contention.test.ts` | Partial | pending |
| 156-03-01 | 03 | 3 | REQ-020 | T-156-07 | representative MCP/tool writes originate from `writeVaultFile`; plugin reconciliation does not catch and swallow surfaced failures | integration | `npm run test:integration -- tests/integration/atomic-write-frontmatter.integration.test.ts tests/integration/vault-write-durable.integration.test.ts` | No - W0 | pending |
| 156-03-02 | 03 | 3 | REQ-020/REQ-021 | T-156-08 | static write-path inventory proves vault writes do not bypass primitive | unit/static | `npm test -- tests/unit/single-write-primitive.test.ts` | No - W0 | pending |
| 156-03-03 | 03 | 3 | REQ-021 | T-156-09 | stale temp cleanup recognizes unique `.fqc-tmp-*` names | integration | `npm run test:integration -- tests/integration/vault-write-durable.integration.test.ts` | No - W0 | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/vault-write-primitive.test.ts` - T-U-028 and T-U-029.
- [ ] `tests/unit/vault-write-durable.test.ts` - T-U-031, T-U-032, and T-U-033.
- [ ] `tests/unit/single-write-primitive.test.ts` - T-U-030 static write-path guard.
- [ ] `tests/integration/atomic-write-frontmatter.integration.test.ts` - T-I-039 and T-I-040.
- [ ] `tests/integration/vault-write-durable.integration.test.ts` - T-I-041.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| macOS `F_FULLFSYNC` implementation decision | REQ-021 / T-U-033 | Node.js built-ins do not clearly expose `F_FULLFSYNC`; adding a native adapter requires an explicit implementation decision. | Execution agent must document whether Phase 156 uses an injectable `durableFileSync` adapter with `FileHandle.sync()` fallback or introduces a platform/native adapter. Do not add a native dependency without explicit approval. |
| EXDEV fallback boundary | REQ-020 boundary / REQ-022 deferred | Phase 161 owns EXDEV fallback completeness. | Confirm plan and summary do not claim REQ-022 complete. If code touch is unavoidable, document it as delegation-only without destination-lock or EXDEV acceptance claims. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency target documented.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending
