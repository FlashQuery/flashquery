# dbtools — operational utilities for the scenario test DB

Scripts in this directory query (and, in one case, modify) the FlashQuery
PostgreSQL database directly. They are **not tests** and are **not
imported by tests**. They exist to help developers inspect, verify, and
clean up the scenario test environment.

## When (and when not) to use these scripts

**Use them when:**

- A scenario test failed and the run report doesn't tell you enough —
  `snapshot.py` shows you exactly what ended up in the DB.
- You want to confirm that `TestCleanup` is actually cleaning up —
  `verify_cleanup.py` (per-run) or `orphans.py` (broad sweep).
- A test crashed and left residue that even cleanup can't recover from —
  `reset.py` hard-deletes everything for a given test instance.

**Do not use them to:**

- Write assertions inside scenario tests. Scenario tests verify FlashQuery's
  public surface (tool responses, vault state). Reaching behind the public
  surface to assert on DB rows couples tests to the schema and can mask the
  very bugs scenario tests exist to catch. If something matters to users
  but isn't observable through the public surface, the right fix is usually
  to expose it through the public surface — not to work around it from the
  test side.
- Seed fixture data via direct DB inserts. Build fixtures through the tool
  surface even when it's more code — the setup itself is useful coverage
  and ensures FlashQuery's invariants are respected.

## Configuration

All scripts reuse the framework's config loader, so they read the same
`flashquery.yml` / `flashquery.test.yml` and `.env` / `.env.test` files the
rest of the suite uses. Precedence for the database URL:

1. `DATABASE_URL` from the shell environment or `.env` / `.env.test`
2. `supabase.database_url` from `flashquery.test.yml`
3. `supabase.database_url` from `flashquery.yml`

Run the scripts from anywhere inside the repo, or set `FLASHQUERY_DIR` if you need
to run them from elsewhere.

## Dependencies

The scripts need a PostgreSQL driver:

```bash
pip install 'psycopg[binary]'    # preferred (psycopg v3)
# or
pip install psycopg2-binary       # fallback
```

Either works; the scripts auto-detect.

## Scope and safety

Every script scopes its queries by `instance_id`. The managed test server
generates IDs of the form `test-<hex8>`; the static test config uses
`test-flashquery`. By default the scripts only look at rows whose `instance_id`
matches `test-%`. You can override this with `--test-pattern`, but narrow
is the default for a reason.

**Destructive operations (reset.py only) enforce three guards:**

1. `--instance-id` is required (no unscoped deletes).
2. The instance must match the test pattern (no override, ever).
3. The DB URL must look local, or you must pass
   `--i-know-this-is-not-local`.

Read-only scripts (`snapshot.py`, `orphans.py`, `verify_cleanup.py`) only
enforce the test-pattern default, since reading can't damage anything.

## The scripts

### `snapshot.py` — dump DB footprint for a test instance

Pull every row from every instance-scoped FlashQuery table for a given
`instance_id`. Use when a test fails and you want to see exactly what state
it left behind.

```bash
python3 snapshot.py --instance-id test-ab12cd34
python3 snapshot.py --instance-id test-ab12cd34 --json > snap.json
python3 snapshot.py --limit 10            # cap rows per table
python3 snapshot.py                        # all test-pattern instances
```

Read-only. Exits 0.

### `orphans.py` — find residue across all test instances

Broad scan for rows matching the test pattern. These should all belong to
either currently-running tests or to `TestCleanup` that's about to delete
them — anything older is orphaned.

```bash
python3 orphans.py                    # quiet; exit 1 if orphans found
python3 orphans.py --verbose          # always print what was checked
python3 orphans.py --min-age 60       # only flag rows older than 60 min
python3 orphans.py --json             # machine-readable
```

`--min-age` is how you avoid false positives from tests that are currently
running (their rows are young; real orphans are old).

Read-only. Exits 1 if any orphans found, 0 otherwise — useful for CI.

### `verify_cleanup.py` — per-run cleanup verification

Narrower than `orphans.py`: checks one specific `instance_id`. Intended to
be called right after a test finishes (or from `run_suite.py` in a strict
mode) to confirm `TestCleanup` actually cleaned up.

```bash
python3 verify_cleanup.py --instance-id test-ab12cd34
python3 verify_cleanup.py --instance-id test-ab12cd34 --json
```

Read-only. Exits 0 if clean, 1 if residue found.

### `reset.py` — nuke a test instance (DESTRUCTIVE)

Hard-deletes every row for a given test `instance_id` across every
instance-scoped table. The escape hatch for when a test has wedged the DB
beyond normal cleanup.

```bash
python3 reset.py --instance-id test-ab12cd34              # interactive confirm
python3 reset.py --instance-id test-ab12cd34 --confirm    # skip prompt
python3 reset.py --instance-id test-ab12cd34 --dry-run    # plan only
```

Always prints a plan before touching anything. Runs the delete in a single
transaction. Will refuse to proceed if the instance_id isn't test-safe or
the DB isn't local (override the latter with
`--i-know-this-is-not-local`).

### `clean_test_tables.py` — reset all tables for fresh suite runs (DESTRUCTIVE)

Deletes all rows from every FlashQuery table, preserving table structure. Used
between tests in suite mode to ensure perfect isolation: each test starts
with a clean database slate, making residue detection reliable.

#### Why This Matters

When running the full test suite with `--managed` (shared server mode):

1. **Without cleanup:** Tests share database state → residue from one test masks failures in the next
2. **With cleanup:** Each test starts clean → any residue is guaranteed to come from that specific test

This makes debugging residue issues much easier: if a test leaves rows behind, you know it's that test's responsibility.

#### How It Works

**Automatic (integrated):**
```bash
cd tests/scenarios
python3 run_suite.py --managed --strict-cleanup
# Cleanup runs automatically between each test
```

**Manual (standalone):**
```bash
python3 dbtools/clean_test_tables.py
# Deletes all rows from: fqc_documents, fqc_memory, fqc_vault, fqc_plugin_registry, fqc_write_locks, fqc_change_queue
# Preserves table structure (no DROP TABLE)
```

#### Configuration

The script reads database credentials from (in order):
1. `DATABASE_URL` environment variable
2. `.env.test` file in current directory
3. `.env.test` in parent directory
4. `.env.test` in home directory

Example `.env.test`:
```
SUPABASE_URL=https://vyezmwvfvtgdxuffdfmu.supabase.co
DATABASE_URL=postgresql://postgres:PASSWORD@db.vyezmwvfvtgdxuffdfmu.supabase.co:5432/postgres
```

#### Usage in Shared Server Mode

When using `--managed` with a single shared FlashQuery server for all tests:

```bash
python3 run_suite.py --managed --strict-cleanup
```

Between each test, the runner will:
1. Run the test
2. Check for cleanup residue
3. **Clean all flashquery_* tables**
4. Proceed to next test

This ensures each test:
- Starts with empty database tables
- Any rows found after the test are its responsibility
- Can be debugged in isolation

#### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success — all rows deleted, tables verified empty |
| 1 | Error — connection/environment issue (check `.env.test` credentials) |
| 2 | Error — table deletion failed (check PostgreSQL permissions) |

#### Tables Cleaned (in order)

1. `fqc_change_queue`
2. `fqc_write_locks`
3. `fqc_documents`
4. `fqc_memory`
5. `fqc_vault`
6. `fqc_plugin_registry`

Order matters: tables with fewer dependencies are cleaned first.

#### Verification Behavior

**The script verifies tables are empty after deletion** — it confirms that all rows have been successfully removed before exiting. If any rows remain after deletion, the script exits with error code 2, indicating the cleanup failed. This guarantee of successful deletion is essential for test isolation: each subsequent test starts with a completely empty database.

#### Performance

Typical cleanup time: **< 1 second** for a full test suite (33 tests = 33 cleanups ≈ 30 seconds total)

#### Debugging Residue

If a test leaves residue after cleanup:

```bash
# 1. Check the cleanup script output
tail -20 /tmp/fqc_test_run_clean.log

# 2. Run the test individually with JSON output
python3 testcases/test_X.py --managed --json

# 3. Snapshot the DB after the test
python3 dbtools/snapshot.py --instance-id test-XXXX

# 4. Check if cleanup is running properly
python3 dbtools/clean_test_tables.py  # Run manually to see output
```

#### Implementation Notes

- **Tables are NOT dropped** — only rows are deleted. Structure is preserved.
- **All FlashQuery instances are cleaned** — the script doesn't filter by instance_id
- **Idempotent** — safe to run multiple times
- **Transactional** — either all tables clean or none

## Tables covered

The scripts operate on every instance-scoped FlashQuery table. The registry lives
in `_common.py` (`TABLES`). If FlashQuery adds a new instance-scoped table,
append it there and the scripts pick it up automatically.

Currently:

- `fqc_documents`
- `fqc_memory`
- `fqc_vault`
- `fqc_plugin_registry`
- `fqc_write_locks`
- `fqc_change_queue`

## Typical workflows

**After a failing scenario test:**

```bash
# 1. Look at what ended up in the DB
python3 snapshot.py --instance-id test-ab12cd34

# 2. If something's stuck, reset it
python3 reset.py --instance-id test-ab12cd34
```

**Periodic housekeeping of the test DB:**

```bash
# Find anything stale (older than an hour)
python3 orphans.py --verbose --min-age 60

# Reset each one
python3 reset.py --instance-id <id> --confirm
```

**Strict cleanup validation during a suite run:**

`run_suite.py --strict-cleanup` is now integrated. With this flag the
runner:

- Opens a DB connection at suite start (requires a psycopg driver).
- Captures a baseline row count per table right after the managed server
  starts. The baseline accounts for ambient rows the server seeds itself
  (e.g. `fqc_vault`), so "cleanup worked" means "counts returned to
  baseline," not "counts are zero."
- After each test, compares current counts to baseline. Any delta is
  recorded as `cleanup_residue` on the test result.
- Surfaces residue in the console summary and the scenario report, with a
  pointer to `snapshot.py` so you can inspect what got left behind.
- Returns exit code 3 if all tests passed but strict cleanup failed; exit
  code 2 if tests failed outright.

Requires `--managed` or `--per-test-server` — strict cleanup isn't
meaningful against an external server since the runner can't know that
server's instance is test-safe.

```bash
./run_suite.py --managed --strict-cleanup
./run_suite.py --per-test-server --strict-cleanup
```
