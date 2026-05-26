# Phase 158 Deferred Items

## Plan 05

- **Category:** out-of-scope stale test references
- **Found during:** `158-05` traceability sweep
- **Details:** The repository-wide stale-reference sweep still reports legacy `ttlSeconds`, `fqc_write_locks`, and `services/write-lock` references in tests and scenario files outside Plan 05 ownership. Plan 05 removed stale references from its owned files only.
- **Command:** `rg -n "from ['\"].*services/write-lock|acquireLock|releaseLock|isLocked|ttlSeconds|fqc_write_locks" src tests --glob '!tests/unit/no-legacy-write-lock-imports.test.ts' --glob '!tests/integration/fqc-write-locks-drop.integration.test.ts'`
- **Status:** deferred to owning plans/files.
