# Directed Scenario Tests

Directed scenario tests verify that FlashQuery's MCP tools, vault filesystem, and database work together correctly across multi-step workflows. Where a unit test might confirm that a single function returns the right value, and an end-to-end test might confirm that a tool responds to a well-formed request, a directed scenario test asks a more interesting question: if I create a file in the vault, force a scan, and then search for it by title, does the whole pipeline actually work?

The distinction matters because FlashQuery's tools don't operate in isolation. A `search_documents` call is only useful if `force_file_scan` indexed the file correctly, which itself depends on the vault file having valid frontmatter in the format FlashQuery expects. Scenario tests exercise these chains of dependencies, and when something breaks, they capture enough context (server logs, tool responses, timing data) that you can figure out what actually happened rather than staring at a bare "assertion failed" message.

## Where to go for what

This README is a landing page. The deeper material lives in dedicated docs:

- **Writing a new directed test** — see [`WRITING_SCENARIOS.md`](./WRITING_SCENARIOS.md). Covers anatomy, TestContext setup, opt-in flags, cleanup, debugging, and conventions.
- **What behaviors exist and which tests cover them** — see [`DIRECTED_COVERAGE.md`](./DIRECTED_COVERAGE.md). The coverage matrix is the source of truth for what directed tests should be verifying.
- **Inspecting or cleaning up the test database** — see [`../dbtools/README.md`](../dbtools/README.md). Debug and operational scripts for the scenario test DB.
- **Running the full suite** — `run_suite.py` discovers every test under `testcases/`, runs them against a shared or per-test managed server, and produces a markdown report. `./run_suite.py --help` for the full flag list.
- **Automating test creation or coverage updates** — the `flashquery-directed-testgen` and `flashquery-directed-covgen` skills in `.claude/skills/` handle these workflows end-to-end. `WRITING_SCENARIOS.md` is the right doc if you're doing it by hand.

## ⚠️ Database Warning

**These test runners delete every row in every `fqc_*` table before and after each test.** This is intentional — it guarantees a clean slate between runs. The consequence is that any data in those tables is permanently destroyed.

**Only ever point these tests at a throwaway Supabase or PostgreSQL instance created specifically for testing.** Never use a development, staging, or production database. If your `DATABASE_URL` in `.env` or `.env.test` points at anything other than a dedicated test database, stop and fix that before running anything here.

## Prerequisites

**Python packages.** The framework depends on four packages beyond the standard library:

```bash
pip install requests pyyaml python-dotenv
```

`requests` handles HTTP communication with the MCP server, `pyyaml` reads the FlashQuery configuration files (and is required for managed server mode to generate temp configs), and `python-dotenv` loads `.env` files for credential resolution. The framework degrades somewhat gracefully if `pyyaml` or `python-dotenv` are missing (you can still pass connection details explicitly), but in practice you'll want all three.

For `run_suite.py --strict-cleanup` and the scripts under `dbtools/`, you also need a PostgreSQL driver:

```bash
pip install 'psycopg[binary]'     # preferred (psycopg v3)
# or
pip install psycopg2-binary        # fallback
```

Either works; the tools auto-detect. Skip this if you're not using `--strict-cleanup` or the dbtools.

**FlashQuery configuration files.** The framework auto-discovers connection settings from the project's existing config files, so these need to exist at the project root (the `flashquery-core/` directory):

- `flashquery.yml` or `flashquery.test.yml` — the FlashQuery server configuration. The framework walks up the directory tree from the test script's location until it finds one of these, so as long as you haven't moved them somewhere unusual, auto-discovery will find them.
- `.env` or `.env.test` — environment variables referenced as `${VAR}` in the YAML config. At a minimum, this needs to contain the Supabase credentials (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`) and the auth secret (`FQC_AUTH_SECRET`). If any tests use `require_embedding=True`, it also needs `EMBEDDING_PROVIDER`, `EMBEDDING_API_KEY` (or `OPENAI_API_KEY`), and `EMBEDDING_MODEL`. If you're already running FlashQuery locally for development, you almost certainly have these files already.

**A running FlashQuery server (unless using `--managed`).** If you're running tests against an existing server, that server needs to be up and reachable before you start. The framework expects streamable-http transport, so make sure the server was started with that transport mode. If you're using `--managed` mode instead, the test will start its own server, in which case you need FlashQuery to be built first (`npm run build` so that `dist/index.js` exists).

## How to Run

All commands below assume you're at the `flashquery` project root. Run `./tests/scenarios/directed/run_suite.py --help` for the full flag reference; the recipes below cover the common cases.

### Quick start

To run all the tests without spinning up FlashQuery first (the runner will build and start it):

```bash
python3 tests/scenarios/directed/run_suite.py --managed
```

To run all the tests when you are already hosting FlashQuery locally, or in a container:

```bash
python3 tests/scenarios/directed/run_suite.py --url http://localhost:3100
```

**Node.js (for managed server mode only).** When a test spins up its own FlashQuery instance via `--managed`, it launches `node dist/index.js start --config <path> --transport http` as a subprocess. So Node.js needs to be installed and `npm run build` needs to have been run at least once so the compiled output exists in `dist/`.

### A single test, standalone

The fastest feedback loop when you're developing a specific test. Each test file in `testcases/` is independently runnable.

```bash
# Run one test with a dedicated managed server
python3 tests/scenarios/directed/testcases/test_create_read_update.py --managed

# Same, but retain vault files + DB records afterwards for inspection
python3 tests/scenarios/directed/testcases/test_create_read_update.py --managed --keep

# Emit structured JSON on stdout (human summary still goes to stderr)
python3 tests/scenarios/directed/testcases/test_create_read_update.py --managed --json

# Against an already-running FlashQuery server (skips the managed subprocess)
python3 tests/scenarios/directed/testcases/test_create_read_update.py
```

Exit codes: `0` pass, `2` fail, `3` dirty (test passed but cleanup had errors).

### The full suite, via `run_suite.py`

Discovers every `test_*.py` under `testcases/`, runs them, and produces a timestamped markdown report under `reports/`.

```bash
# Run the entire suite on a shared managed server (fastest)
python3 tests/scenarios/directed/run_suite.py --managed

# Run a subset that matches one or more name patterns
python3 tests/scenarios/directed/run_suite.py --managed "search*"
python3 tests/scenarios/directed/run_suite.py --managed "search*" "memory*"

# Plain word — treated as a substring match (no wildcards needed)
# Runs all tests whose filename contains "document"
python3 tests/scenarios/directed/run_suite.py --managed document

# Re-run a single named test inside the suite machinery (useful after editing one)
python3 tests/scenarios/directed/run_suite.py --managed auto_commit_on_writes

# Bail on the first failure (fast signal when you're hunting a regression)
python3 tests/scenarios/directed/run_suite.py --managed --stop-on-fail

# Strict cleanup — fail the suite if any test leaves DB residue above baseline
python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup

# Isolation diagnostic: fresh managed server per test (slower but surfaces test-to-test
# state leakage that shared-server mode hides)
python3 tests/scenarios/directed/run_suite.py --per-test-server

# Shuffle order with a reproducible seed (catches order-dependent tests)
python3 tests/scenarios/directed/run_suite.py --managed --seed 42

# Combine: CI-style run with strict cleanup and fast-fail
python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup --stop-on-fail

# Point at an already-running FlashQuery server instead of spinning one up
python3 tests/scenarios/directed/run_suite.py --url http://localhost:3001/mcp --secret mysecret
```

A few things worth calling out:

**`--strict-cleanup`** captures a per-table row-count baseline right after the managed server starts, then checks after each test that counts have returned to baseline. Residue means the test didn't clean up after itself — the suite treats that as a failure and exits `3`. Requires a managed mode (`--managed` or `--per-test-server`) and a PostgreSQL driver.

**When a test fails in a managed mode**, the runner prints a ready-to-copy `dbtools/snapshot.py --instance-id <id>` command so you can immediately see what ended up in the DB. No hunting for the instance ID.

**Name patterns** are matched against the test's filename stem with or without the `test_` prefix. Plain words with no wildcard characters are treated as substring matches — `document` runs anything with "document" in the name. Explicit globs like `"search*"` or `"*memory*"` are also supported. `"search*"`, `"test_search*"`, `search`, and `search_modes` all work.

### Individual MCP tool wrappers

The scripts in `mcp/` are independently useful for quick checks and ad-hoc debugging.

```bash
# Basic search
python3 tests/scenarios/mcp/search_documents.py --query "authentication"

# Search with expectations (exit code reflects pass/fail)
python3 tests/scenarios/mcp/search_documents.py --query "auth" --expect-contains "Meeting Notes"

# Tag search, expecting at least 2 results
python3 tests/scenarios/mcp/search_documents.py --tags security,jwt --expect-count-gte 2

# Full structured JSON
python3 tests/scenarios/mcp/search_documents.py --query "auth" --json
```

### After a failure

When a test fails and the report isn't enough, reach for the `dbtools/` scripts:

```bash
# Inspect the DB state a failing test left behind
python3 tests/scenarios/dbtools/snapshot.py --instance-id <id>

# Check whether a specific test instance cleaned up
python3 tests/scenarios/dbtools/verify_cleanup.py --instance-id <id>

# Find stale residue from any past test runs
python3 tests/scenarios/dbtools/orphans.py --verbose --min-age 60

# Nuke a wedged test instance (interactive confirm)
python3 tests/scenarios/dbtools/reset.py --instance-id <id>
```

See [`dbtools/README.md`](./dbtools/README.md) for the full set, the safety guardrails, and when to reach for each.

## Directory Structure

```
tests/scenarios/
├── README.md               Top-level overview of all scenario test suites
│
├── framework/              Shared Python modules (used by both suites)
│   ├── fqc_client.py           MCP HTTP client, ToolResult, expectations
│   ├── fqc_vault.py            Vault filesystem ops, VaultHelper, frontmatter
│   ├── fqc_test_utils.py       TestContext, TestRun, FlashQuery Server, TestCleanup
│   └── fqc_git.py              GitHelper for git-aware tests
│
├── dbtools/                Debug / operational scripts for the test DB (shared)
│   ├── README.md               What these are and when to use them
│   ├── _common.py              Shared config, DB connection, scope guards
│   ├── snapshot.py             Dump DB footprint for a test instance
│   ├── orphans.py              Find residue across test instances
│   ├── verify_cleanup.py       Per-run cleanup verification
│   └── reset.py                Nuke a test instance (destructive)
│
├── mcp/                    CLI wrappers for individual MCP tools
│   └── search_documents.py     (one example; pattern for others)
│
├── directed/               ← you are here
│   ├── README.md               This file
│   ├── WRITING_SCENARIOS.md    How to author a new directed test
│   ├── DIRECTED_COVERAGE.md             Coverage matrix (behaviors + tests)
│   ├── run_suite.py            Suite runner: discovers and runs all tests
│   ├── testcases/              Multi-step directed test scripts (test_*.py)
│   │   ├── test_create_read_update.py     — the canonical reference
│   │   ├── test_auto_commit_on_writes.py  — example of a git-enabled test
│   │   ├── test_write_lock_contention.py  — example of a locking-enabled test
│   │   ├── test_search_modes.py           — example of an embedding test
│   │   └── ... ~30 others
│   └── reports/            Generated markdown reports from suite runs
│       └── scenario-report-YYYY-MM-DD-HHMMSS.md
│
└── integration/            YAML-based integration tests
    ├── README.md
    ├── INTEGRATION_DIRECTED_COVERAGE.md
    ├── run_integration.py
    ├── tests/              YAML test definitions
    └── reports/
```

**`framework/`** is the test infrastructure. `fqc_client.py` handles MCP communication over streamable-http, including session initialization, auth, and a `ToolResult` class that carries structured pass/fail/error status alongside the raw response data. `fqc_vault.py` reads and writes markdown files with YAML frontmatter in exactly the format FlashQuery expects, so tests can set up and inspect vault state without going through MCP. `fqc_test_utils.py` provides `TestContext` for test lifecycle management (including automatic cleanup), `TestRun` for structured result collection, and `FQCServer` for optionally spinning up a dedicated FlashQuery instance per test run. `fqc_git.py` exposes `GitHelper` for tests that need to assert on git commit behavior.

**`mcp/`** contains standalone CLI scripts, one per MCP tool, for ad-hoc debugging. Useful both for "does this tool actually work?" spot checks and as building blocks that higher-level test scripts compose.

**`testcases/`** contains the scenario tests themselves. Each one is a self-contained Python program that orchestrates multiple framework calls into a coherent workflow.

**`dbtools/`** holds operational scripts for inspecting and cleaning up the test DB. These are debug aids — they're not used from inside tests (scenario tests don't query the DB directly). See [`dbtools/README.md`](./dbtools/README.md) for the rationale and usage.

## Configuration

The framework auto-discovers connection details by walking up the directory tree from the script's location until it finds `flashquery.yml` or `flashquery.test.yml`, then loads `.env` or `.env.test` for any `${VAR}` references in the YAML. You can override any of this with CLI flags or environment variables:

| Priority | Source |
|----------|--------|
| Highest | `--url` and `--secret` CLI flags |
| | `FLASHQUERY_URL` and `FLASHQUERY_AUTH_SECRET` env vars |
| Lowest | Auto-discovered from `flashquery.yml` / `.env` |

In practice, if you're running against a local dev server and your config files are in the right place, you shouldn't need to pass any connection arguments at all.

## Framework Capabilities

`TestContext` has three opt-in flags that enable specific framework behaviors. Off by default; turn them on only when a test genuinely needs them.

| Flag | Purpose |
|------|---------|
| `require_embedding=True` | Test exercises semantic or mixed-mode search. Reads embedding credentials from `.env.test` / `.env`; fails loudly if missing. |
| `enable_locking=True` | Test exercises write-lock contention or concurrent-write behavior. Turns on FlashQuery's file-lock machinery (disabled by default for speed). |
| `enable_git=True` | Test exercises FlashQuery's git auto-commit behavior. Initializes the vault as a git repo, flips `auto_commit` on, and exposes `ctx.git` for assertions. |

These compose; a test can pass two or three at once. See [`WRITING_SCENARIOS.md`](./WRITING_SCENARIOS.md) for the full usage patterns and [`DIRECTED_COVERAGE.md`](./DIRECTED_COVERAGE.md) for which coverage IDs each one supports.

## Exit Codes

All scripts use the same exit code convention:

| Code | Status | Meaning |
|------|--------|---------|
| 0 | PASS | All steps passed, cleanup was clean |
| 1 | ERROR | Transport or tool-level failure (couldn't reach the server, malformed request, etc.) |
| 2 | FAIL | Test step(s) failed |
| 3 | DIRTY (test) / RESIDUE (suite) | Test passed but cleanup had errors; or all tests passed but strict cleanup found residue |

## Debugging a Failure

Work the debug path in this order:

1. **Read the stderr summary** — tells you which test and which step failed.
2. **Open the latest report under `reports/`** — per-step detail including tool arguments, raw responses, expectation outcomes, and server logs scoped to each step. This is usually enough.
3. **If the report isn't enough, use the `dbtools/` scripts** — see the "After a failure" recipes above, or [`dbtools/README.md`](./dbtools/README.md) for the full set.
4. **Before fixing anything, ask "is this a test bug or a FlashQuery defect?"** — if FlashQuery is returning wrong data that the test correctly expects, the test is right and FlashQuery is wrong. Flag it, don't tune the assertion. [`WRITING_SCENARIOS.md`](./WRITING_SCENARIOS.md) has the full guidance on this decision.

## Writing a New Scenario Test

See [`WRITING_SCENARIOS.md`](./WRITING_SCENARIOS.md) for the full guide — anatomy, `TestContext` setup, step patterns, cleanup conventions, debugging, and the rules about what *not* to do.

For the automated route, use the `flashquery-directed-testgen` skill (`.claude/skills/flashquery-directed-testgen/`): it handles the full lifecycle of picking coverage goals, writing the script, running it, debugging failures, and updating `DIRECTED_COVERAGE.md`. The skill and the writing guide follow identical conventions — pick whichever fits your workflow.

For adding a new MCP tool wrapper under `mcp/`, copy `mcp/search_documents.py` and modify the three sections marked `TOOL-SPECIFIC` in the comments: the argument parser, the `build_tool_args` function, and the `TOOL_NAME` constant. Everything else (connection handling, output formatting, expectation evaluation) stays the same.
