# Phase 158 Deferred Items

## Plan 05

- **Category:** out-of-scope stale test references
- **Found during:** `158-05` traceability sweep
- **Details:** Closed by the Phase 158 gap-resolution pass. Effective `ttlSeconds` fixture fields were removed from tests, the stale LLM config sync helper no longer reads `config.locking.ttlSeconds`, and dbtools no longer treats the retired `fqc_write_locks` table as an active cleanup/orphan target. Remaining `fqc_write_locks` references are limited to the intentional startup-drop integration test, the production one-way `DROP TABLE IF EXISTS` statement, docs noting retirement, and older directed scenarios that are outside the dbtools operational surface.
- **Command:** `rg -n "from ['\"].*services/write-lock|acquireLock|releaseLock|isLocked|ttlSeconds|fqc_write_locks" src tests --glob '!tests/unit/no-legacy-write-lock-imports.test.ts' --glob '!tests/integration/fqc-write-locks-drop.integration.test.ts'`
- **Status:** resolved by Phase 158 gap-resolution follow-up.
