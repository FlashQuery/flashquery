---
type: research_summary
milestone: v3.9
feature: Vault Write Coherency Locking
created: 2026-05-26
source_folder: /Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research
---

# Vault Write Coherency Locking — Research Summary

## Source Documents

- `.planning/research/VAULT-WRITE-COHERENCY-LOCKING.md`
- `.planning/research/VAULT-WRITE-COHERENCY-TEST-PLAN.md`
- Active milestone requirements: `.planning/REQUIREMENTS.md`

## Key Findings

- FlashQuery's current `fqc_write_locks` table is both too coarse and not a correct cross-instance exclusion mechanism because the primary key includes `instance_id`.
- The replacement design is decided: per-file vault locks, Tier 1 in-process `async-mutex` striping, and Tier 2 session-scoped Postgres advisory locks keyed on canonical absolute paths.
- `insert_doc_link` and `apply_tags` currently bypass document write locking and can lose updates; the milestone closes this live defect first.
- All vault writes should route through one durable atomic primitive using unique temp files, fsync, rename, and directory fsync; write failures must surface.
- Optimistic concurrency uses whole-file SHA-256 `version_token` values returned by reads and successful writes, with optional `expected_version` / `if_match` preconditions on file-affecting tools.
- Batch semantics are best-effort rather than atomic: ordered per-item results distinguish succeeded, conflicted, and failed items.

## Watch Outs

- Advisory locks require a session-capable Postgres connection; transaction-mode poolers must fail startup via self-test.
- Multi-lock operations must acquire locks in sorted canonical-path order to avoid deadlock.
- Reads must remain lock-free; atomic rename and version tokens provide the safety model.
- Macro execution must not grow a macro-spanning lock. Each macro step should rely on the called tool's normal per-file lock.

