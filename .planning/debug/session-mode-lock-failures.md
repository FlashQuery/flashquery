---
status: resolved
trigger: "Debug the issues uncovered after switching .env.test DATABASE_URL from Supabase transaction-pooler port 6543 to session-pooler port 5432."
created: 2026-05-28T13:05:00-03:00
updated: 2026-05-28T13:14:00-03:00
---

# Debug Session: session-mode-lock-failures

## Symptoms

expected_behavior: "Root-cause the newly unskipped Phase 160 and Phase 161 failures against the milestone requirements before deciding whether each is a production bug or a test/spec mismatch. The relevant requirements source is `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Requirements.md`."

actual_behavior: "After changing `.env.test` `DATABASE_URL` to `aws-1-us-west-2.pooler.supabase.com:5432`, Phase 158 session-gated checks pass, but Phase 160 and Phase 161 session-gated checks now run and fail."

error_messages:
- "Phase 160: `tests/integration/folder-lock.integration.test.ts --testNamePattern T-I-012` times out after 20000ms and reports `LockTimeoutError` on a `dir:` shared sibling write resource."
- "Phase 160: combined folder/manage-directory run fails `T-I-012` and `T-I-011`; `manage-directory-advisory-lock.integration.test.ts` passes in that combined run."
- "Phase 161: `tests/integration/destination-lock.integration.test.ts --testNamePattern T-I-014` fails because expected successes array has length 0, not 1."
- "Phase 161: combined destination/EXDEV run fails `T-I-014`, `T-I-015`, `T-I-016`, and both `T-I-042` EXDEV integration tests."
- "Phase 161: `T-I-015` observed only one document lock acquire key where expected order had two keys."
- "Phase 161: `move-exdev-fallback.integration.test.ts` hooks time out at 10000ms."

timeline: "Began when `.env.test` moved from transaction-pooler `:6543` to session-pooler `:5432` during v3.9 milestone audit closure on 2026-05-28. Previously these suites skipped under `HAS_SESSION_CAPABLE_DATABASE_URL=false`."

reproduction:
- "Set `.env.test` `DATABASE_URL` to the Supabase session-pooler endpoint on port 5432."
- "Run `set -a; source .env.test; set +a; npm run test:integration -- tests/integration/folder-lock.integration.test.ts tests/integration/manage-directory-advisory-lock.integration.test.ts --testNamePattern \"T-I-011|T-I-012|T-I-013|T-I-046|T-I-047|folder-lock|manage-directory-advisory\"`."
- "Run `set -a; source .env.test; set +a; npm run test:integration -- tests/integration/destination-lock.integration.test.ts tests/integration/move-exdev-fallback.integration.test.ts --testNamePattern \"T-I-014|T-I-015|T-I-016|T-I-042|T-I-048|destination-lock|move-exdev\"`."
- "Focused repros: `folder-lock.integration.test.ts --testNamePattern T-I-012` and `destination-lock.integration.test.ts --testNamePattern T-I-014` still fail individually."

## Current Focus

hypothesis: "Resolved: failures were a mix of real production lock bugs and brittle/incorrect integration harness assumptions exposed by the session-pooler endpoint."
test: "Reran focused repros and the original combined Phase 160 / Phase 161 session-gated commands."
expecting: "All REQ-007, REQ-008, REQ-022, and REQ-024 integration checks pass against the session-pooler DATABASE_URL."
next_action: "none"
reasoning_checkpoint: "REQ-006 describes lock timeout for Tier 2 advisory acquisition, not pg client checkout; REQ-003 requires canonical keys for not-yet-existing destinations using realpath parent semantics, which also has to handle symlinked/nonexistent descendants under macOS /var -> /private temp paths."
tdd_checkpoint: ""

## Evidence

- timestamp: 2026-05-28T13:05:00-03:00
  observation: "Phase 158 session-gated checks passed after `.env.test` moved to port 5432: two-tier-lock plus lock-startup, 2 files / 5 tests."
- timestamp: 2026-05-28T13:05:00-03:00
  observation: "Phase 160 folder-lock checks no longer skip and fail with timeouts / LockTimeoutError."
- timestamp: 2026-05-28T13:05:00-03:00
  observation: "Phase 161 destination-lock and EXDEV checks no longer skip and fail with assertion errors/timeouts."
- timestamp: 2026-05-28T13:06:00-03:00
  observation: "Focused T-I-012 passed with a 10s lock timeout but failed with the test's 1s lock timeout, showing the timeout budget was being consumed by cold pg session-pooler checkout before advisory acquisition."
- timestamp: 2026-05-28T13:06:00-03:00
  observation: "Focused T-I-014's setup write_document returned a JSON conflict envelope for lock_timeout; the Phase 155 helper only checked isError and therefore treated expected-error envelopes as successful fixture creation, causing later not_found/cascade failures."
- timestamp: 2026-05-28T13:08:00-03:00
  observation: "T-I-011 used the 50ms contention timeout for the holder as well as the contender, so the holder could fail before establishing the descendant shared lock the test was meant to contend against."
- timestamp: 2026-05-28T13:09:00-03:00
  observation: "EXDEV setup exposed a real canonicalization bug: a not-yet-existing descendant under macOS temp paths used raw /var/.../T while the vault root canonicalized to /private/.../t, tripping the escapes-vault guard."
- timestamp: 2026-05-28T13:10:00-03:00
  observation: "T-I-046's pg_locks helper reconstructed bigint advisory keys from signed int4 classid/objid values without uint32 coercion, so visible locks with high-bit components could be filtered out incorrectly."
- timestamp: 2026-05-28T13:13:00-03:00
  observation: "Original Phase 160 command passed: 2 files, 6 tests."
- timestamp: 2026-05-28T13:13:00-03:00
  observation: "Original Phase 161 command passed: 2 files, 6 tests."

## Eliminated

- "REQ-007/REQ-024 requirements mismatch: eliminated. The requirements do expect shared sibling directory locks to overlap and exclusive manage_directory locks to contend."
- "Session-pooler advisory-lock incompatibility: eliminated. Direct shared/shared and exclusive/shared advisory lock probes behaved correctly, and the fixed suites pass on port 5432."
- "REQ-008 destination lock ordering bug for move_document: eliminated. T-I-015 passes once fixture creation no longer silently fails."

## Resolution

root_cause: "The session-pooler surfaced two production lock bugs (Tier 2 timeout starting before pg client checkout, and canonicalization of nonexistent symlinked descendants) plus test harness defects (holder using contention timeout, helper ignoring JSON error envelopes, pg_locks bigint reconstruction using signed int4 parts, and a Phase 158 visibility test computing the old raw key instead of the production canonical key)."
fix: "Started advisory-acquire timeout after pg client checkout; canonicalized nonexistent paths through the deepest existing realpath ancestor; fixed folder/EXDEV integration harness timeouts and error checks; corrected pg_locks bigint reconstruction; updated Phase 158 visibility assertion to use production key derivation."
verification: "Passed: `npm run build`; `npm run typecheck`; Phase 158 session integration command (5/5); Phase 160 combined integration command (6/6); Phase 161 combined integration command (6/6); focused T-I-012, T-I-014, T-I-046, and T-I-042 repros."
files_changed:
  - "src/services/document-lock.ts"
  - "tests/helpers/pg-locks.ts"
  - "tests/integration/two-tier-lock.integration.test.ts"
  - "tests/integration/folder-lock.integration.test.ts"
  - "tests/integration/move-exdev-fallback.integration.test.ts"
  - "tests/integration/vault-write-coherency-phase155-helpers.ts"
