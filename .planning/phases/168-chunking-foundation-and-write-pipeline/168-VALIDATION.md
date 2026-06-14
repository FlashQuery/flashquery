---
phase: 168
slug: chunking-foundation-and-write-pipeline
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-14
updated: 2026-06-14
---

# Phase 168 - Validation Strategy

> Per-phase validation contract for chunk parser, schema/catalog DDL, and document write embedding pipeline.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest unit/integration; Python directed scenarios |
| **Config file** | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `.env.test` |
| **Quick run command** | `npm run test:unit -- tests/unit/chunk-normalize.test.ts tests/unit/chunk-parser.test.ts tests/unit/chunk-atomic-blocks.test.ts tests/unit/chunk-identity.test.ts` |
| **Full suite command** | `npm run typecheck && npm run test:unit -- tests/unit/chunk-normalize.test.ts tests/unit/chunk-parser.test.ts tests/unit/chunk-atomic-blocks.test.ts tests/unit/chunk-identity.test.ts tests/unit/chunk-store.test.ts tests/unit/background-embed-helper.test.ts tests/unit/embedding-stamping.test.ts tests/unit/pending-embed-worker.test.ts tests/unit/schema-verify.test.ts && npm run test:integration -- tests/integration/embedding/chunk-schema.test.ts && npm run test:integration -- tests/integration/embedding/chunk-column-set.test.ts && npm run test:integration -- tests/integration/embedding/column-set-creation.test.ts && npm run test:integration -- tests/integration/embedding/drift-detection.test.ts && npm run test:integration -- tests/integration/embedding/chunk-rpcs.test.ts tests/integration/embedding/chunk-fresh-deployment.test.ts && npm run test:integration -- tests/integration/embedding/per-entry-rpcs.test.ts && npm run test:integration -- tests/integration/embedding/maintain-vault-lifecycle.test.ts && npm run test:integration -- tests/integration/embedding/chunk-pending-queue.test.ts && npm run test:integration -- tests/integration/embedding/chunk-write-roundtrip.test.ts && python3 tests/scenarios/directed/run_suite.py --managed chunk_write && python3 tests/scenarios/directed/run_suite.py --managed chunk_heading_rename` |
| **Estimated runtime** | About 10-15 minutes with `.env.test`; Supabase-backed integration tests and directed scenarios dominate |

---

## Sampling Rate

- **After every task commit:** Run the task's targeted unit/integration command from the active PLAN.md.
- **After every plan wave:** Run all tests introduced by that plan plus `npm run typecheck`.
- **Before `$gsd-verify-work`:** Run all Phase 168 unit/integration commands and directed scenarios `D-chunk-1` and `D-chunk-2`.
- **Max feedback latency:** Prefer < 5 minutes for unit tasks; split integration/scenario runs if they exceed that.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 168-01-01 | 01 | 1 | REQ-CHUNK-001, REQ-CHUNK-005 | identity-integrity | Hashes exclude breadcrumbs; UUID5 ids exclude content hash and remain stable for body-only edits | unit | `npm run test:unit -- tests/unit/chunk-normalize.test.ts tests/unit/chunk-identity.test.ts` | yes | green |
| 168-01-02 | 01 | 1 | REQ-CHUNK-002, REQ-CHUNK-003 | parser-dos | Heading parsing, merge-forward, sub-split, and overlap are deterministic and bounded | unit | `npm run test:unit -- tests/unit/chunk-parser.test.ts tests/unit/chunk-normalize.test.ts tests/unit/chunk-identity.test.ts` | yes | green |
| 168-01-03 | 01 | 1 | REQ-CHUNK-004 | parser-integrity | CommonMark/GFM atomic blocks are not torn except documented oversized structure-preserving splits | unit | `npm run test:unit -- tests/unit/chunk-normalize.test.ts tests/unit/chunk-parser.test.ts tests/unit/chunk-atomic-blocks.test.ts tests/unit/chunk-identity.test.ts` | yes | green |
| 168-02-01 | 02 | 2 | REQ-CHUNK-006 | storage-isolation | `fqc_chunks` enforces cascades, uniqueness, and instance/document scoping | integration | `npm run test:integration -- tests/integration/embedding/chunk-schema.test.ts` | yes | green |
| 168-02-02 | 02 | 2 | REQ-CHUNK-007 | ddl-integrity | Document vectors move to chunks; memory/plugin column sets remain AS-BUILT and startup verification checks chunks plus memory | unit/integration | `npm run test:unit -- tests/unit/schema-verify.test.ts && npm run test:integration -- tests/integration/embedding/chunk-column-set.test.ts && npm run test:integration -- tests/integration/embedding/column-set-creation.test.ts && npm run test:integration -- tests/integration/embedding/drift-detection.test.ts` | yes | green |
| 168-02-03 | 02 | 2 | REQ-CHUNK-008, REQ-CHUNK-014 | rpc-isolation | Chunk RPCs preserve instance/document filters, legacy document RPCs are absent for document content, and retire cleanup discovers chunk artifacts | integration | `npm run test:integration -- tests/integration/embedding/chunk-rpcs.test.ts tests/integration/embedding/chunk-fresh-deployment.test.ts && npm run test:integration -- tests/integration/embedding/per-entry-rpcs.test.ts && npm run test:integration -- tests/integration/embedding/maintain-vault-lifecycle.test.ts` | yes | green |
| 168-03-01 | 03 | 3 | REQ-CHUNK-009 | transaction-integrity | Chunk diff insert/update/delete happens in one transaction and unchanged chunks do not schedule embeddings | unit | `npm run test:unit -- tests/unit/chunk-store.test.ts` | yes | green |
| 168-03-02 | 03 | 3 | REQ-CHUNK-010 | retry-integrity | `document_chunk` targets stamp entry-specific `_indexed_at` and retry per embedding entry | unit/integration | `npm run test:unit -- tests/unit/background-embed-helper.test.ts tests/unit/embedding-stamping.test.ts tests/unit/pending-embed-worker.test.ts && npm run test:integration -- tests/integration/embedding/chunk-pending-queue.test.ts` | yes | green |
| 168-04-01 | 04 | 4 | REQ-CHUNK-009, REQ-CHUNK-010 | write-path-integrity | Public writes and copy share chunk diffing and schedule only changed chunks | integration | `npm run test:integration -- tests/integration/embedding/chunk-write-roundtrip.test.ts` | yes | green |
| 168-04-02 | 04 | 4 | REQ-CHUNK-009, REQ-CHUNK-010 | write-path-integrity | Scanner, compound, and document-output paths share chunk diffing and stop whole-document scheduling | integration | `npm run test:integration -- tests/integration/embedding/chunk-write-roundtrip.test.ts` | yes | green |
| 168-04-03 | 04 | 4 | REQ-CHUNK-009, REQ-CHUNK-010 | public-workflow | Directed scenarios prove chunk write roundtrip and heading rename cleanup through public workflows | directed | `python3 tests/scenarios/directed/run_suite.py --managed chunk_write && python3 tests/scenarios/directed/run_suite.py --managed chunk_heading_rename` | yes | green |

---

## Wave 0 Requirements

- [x] Authoritative requirements doc is referenced in every PLAN.md `read_first`.
- [x] Authoritative test plan is referenced in every PLAN.md `read_first`.
- [x] Every PLAN.md includes a mandatory downstream reading block that points implementation/review/verification agents to the two external docs before questions or code edits.
- [x] Phase 168 scope is fenced to REQ-CHUNK-001 through REQ-CHUNK-010, with lifecycle/search deferred to Phase 169.

---

## Manual-Only Verifications

All Phase 168 planned behaviors have automated verification through unit, integration, or directed scenario tests.

---

## Validation Audit 2026-06-14

| Check | Result |
|-------|--------|
| Planned tasks with automated commands | 11/11 |
| Planned tasks with green evidence | 11/11 |
| Manual-only verifications | 0 |
| Gaps found | 0 |
| Gaps escalated | 0 |
| Phase completeness | `complete` |
| Artifact/key-link/plan-structure checks | `valid` for all four plans |
| Schema drift | `drift_detected: false`, `blocking: false` |

Phase 168 satisfies the validation strategy. Evidence is recorded in each plan summary and in `168-VERIFICATION.md`.

---

## Validation Sign-Off

- [x] All tasks have automated verification commands.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers external source-doc references.
- [x] No watch-mode flags.
- [x] Feedback latency strategy documented.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved 2026-06-14
