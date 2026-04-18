---
name: flashquery-directed-testgen
description: >
  Create, validate, run, debug, and register FlashQuery directed scenario test cases against
  the coverage matrix. Use this skill whenever the user wants to create a new directed scenario
  test, write a test case, add test coverage, cover a specific coverage point, or references
  DIRECTED_COVERAGE.md goals. Also trigger when the user says "create a test for X", "cover D-06",
  "write a test that exercises archive", "add coverage for memory lifecycle", "test the
  move_document tool", or any request to build a directed scenario test for FlashQuery. Even
  casual mentions like "let's cover more of the matrix" or "pick a coverage point and write a test"
  should trigger this skill. This skill handles the entire lifecycle: writing the script, verifying
  it addresses the coverage goals, running it, debugging failures automatically, and updating
  DIRECTED_COVERAGE.md when the test passes. Also use this skill when the user wants to build
  multiple tests in one session — e.g. "write tests for D-06, D-07, M-12 and the move_document
  tool", "cover everything in the Plugins category", "build tests for these behaviors in parallel".
  The skill has a batch mode that groups behaviors into independent tests and runs them in parallel
  subagents.
---

# FlashQuery Directed TestGen

You are creating a directed scenario test for FlashQuery (FlashQuery), an MCP server for document and memory
management. This skill guides you through writing a complete, self-contained test script that follows
the project's established patterns, then validates, runs, debugs, and registers it against the
coverage matrix.

## Input shapes

This skill is typically invoked in one of two ways:

**Fresh authoring.** The user asks for a new test against one or more coverage IDs, or against a described behavior. Follow the full workflow starting at Phase 1.

**Handoff from `flashquery-directed-run` with a findings packet.** When a suite run surfaces a failure that's been user-confirmed as a test bug or test-fixable environment issue, run-scenarios hands off with a pointer to a findings packet under `tests/scenarios/directed/reports/findings/`. The packet contains everything you need to pick up without redoing triage: the failing step, the tool call and response, the server logs scoped to that step, the DB state at failure, the git state (if applicable), and the confirmed categorization.

When handed a findings packet, read it first — it tells you what the user already agreed the failure is, which saves you from re-diagnosing. Treat the packet's `User-confirmed category` and `Recommended action` as authoritative on *what kind of fix* is needed; skip to the part of the workflow that does that specific fix rather than re-running the full Phase 1 scoping. The packet format is documented at `tests/scenarios/directed/reports/findings/README.md`.

If the handoff did not include a packet (older invocation, or run-scenarios couldn't write one), run your own debug loop as normal.

**When you resolve a packet-driven task, close the loop by filling in the packet.** The packet has a `Test-side resolution` section (and a `Final disposition` section at the bottom) that starts empty. Append to those sections with what you changed, which files were touched, how many debug iterations were used, and the outcome (passed, still failing and reclassified, or abandoned). If the outcome is that the test still fails and now looks like an FlashQuery defect, set the section's status to `resolved` for the testgen part but leave `Final disposition` open — run-scenarios or the user will re-route the packet to GSD. The packet should read as a complete record by the time it's actually closed.

## Companion reference: WRITING_SCENARIOS.md

The repo maintains a human-facing guide at `tests/scenarios/directed/WRITING_SCENARIOS.md` that documents
what directed scenario tests are, the framework's capabilities, the opt-in flags (`require_embedding`,
`enable_locking`, `enable_git`), the cleanup conventions, the debug workflow, and the rules about
what not to do. It is the authoritative source for "what's possible" in the framework — kept in
sync with this skill, and organized for people (and agents) reading cold.

Read `WRITING_SCENARIOS.md` early in any testgen run to confirm you have the current picture of
what the framework supports. If this skill and the doc ever disagree, treat the doc as
authoritative for capabilities and treat this skill as authoritative for the mechanical
conventions (exact section separators, docstring shape, CLI block, etc.). When new opt-in flags
or framework features ship, update both in the same session.

## Project Layout

All paths are relative to the flashquery-core project root. Find the project root by looking for
`tests/scenarios/directed/` — it's typically at something like `~/Work/fqc-workspace/flashquery-core/` but
discover it dynamically.

```
tests/scenarios/
  README.md                <- Top-level overview of all scenario test suites
  framework/               <- Shared Python modules (framework/ is NOT inside directed/)
    fqc_client.py          <- MCP HTTP client, ToolResult, expectations
    fqc_vault.py           <- Vault filesystem ops, VaultHelper, VaultDocument
    fqc_test_utils.py      <- TestContext, TestRun, FlashQueryServer, TestCleanup
    fqc_git.py             <- GitHelper for tests that use enable_git=True
  dbtools/                 <- Operational debug scripts (shared, NOT inside directed/)
    README.md
    snapshot.py / orphans.py / verify_cleanup.py / reset.py
  directed/                <- Directed scenario tests (you are here)
    README.md              <- Landing page / TOC for the directed suite
    WRITING_SCENARIOS.md   <- Human-facing guide to authoring tests (read as companion)
    DIRECTED_COVERAGE.md   <- Coverage matrix (read this first)
    run_suite.py           <- Suite runner (used to execute tests)
    testcases/
      test_*.py            <- Individual test scripts (your output goes here)
    reports/
      scenario-report-*.md <- Generated reports from suite runs
      findings/            <- Findings packets from triage runs
```

**Important:** `framework/` and `dbtools/` live at `tests/scenarios/` (one level above `directed/`),
NOT inside `directed/`. Test files must account for this in their `sys.path.insert` line (see below).

## Batch Mode (Multiple Tests in One Session)

The user can ask you to build several tests in one go — for example "write tests for D-06, D-07, M-12, and the move_document tool" or "cover everything in the Plugins category that's still uncovered." When that happens, do not try to write one giant test that covers everything, and do not silently process them one after another in this conversation. Instead, switch into batch mode.

The structure of batch mode is: plan once together, then fan out to parallel subagents for the per-test work, then come back together for the shared-state updates (DIRECTED_COVERAGE.md and the commit). Each test gets the full single-test workflow inside its own subagent, isolated from the others.

### When to enter batch mode

Enter batch mode when any of these are true:

- The user lists more than one coverage ID or behavior in the same request
- The user says "all of", "everything in category X", "the rest of these", "in parallel", or similar
- You proposed a grouping in Phase 1 and the user said "yes, do all of them"

If the user only wants one test, stay in single-test mode — batch mode adds overhead that isn't worth it for a single behavior.

### Phase B1 — Group behaviors into test plans

Coverage IDs aren't always one-per-test. Some IDs naturally cluster (e.g., D-06 "get document by path" and D-07 "get document by filename" probably belong in the same `test_get_document_by_identifier` script, since they exercise the same tool with different arguments). Others are independent and should be their own test.

Read `tests/scenarios/directed/DIRECTED_COVERAGE.md` once, then propose a grouping:

> Here's how I'd split these into independent tests:
>
> 1. **test_get_document_identifiers** — covers D-06, D-07, X-02, X-03 (get_document with path / filename / fqc_id)
> 2. **test_move_document** — covers D-16, D-17, D-18 (move_document path updates, dir creation, fqc_id preservation)
> 3. **test_memory_lifecycle** — covers M-01, M-02, M-03, M-08 (save / search / update / archive)
>
> Each one will run in its own subagent in parallel. Sound right?

Wait for confirmation. The user might collapse two groups, split one, drop one, or rename them. Adjust and re-confirm if needed.

If any test in the batch will need semantic search, flag that now — the same `require_embedding` / `.env.test` rules apply, and it's better to know up front than have one subagent fail late.

### Phase B2 — Fan out to subagents

Once the grouping is confirmed, spawn one subagent per test plan, all in the same turn. Each subagent gets a self-contained brief that lets it run phases 2–6 of the single-test workflow on its own, without needing to talk to the others.

The brief for each subagent should include:
- The test name and the list of target coverage IDs with their behavior descriptions
- The project root path
- A pointer to this skill (so the subagent can read the conventions for itself)
- The `require_embedding` flag if applicable
- Explicit instructions: "Do NOT modify DIRECTED_COVERAGE.md. Do NOT make a git commit. When you're done, return a structured summary of what you did so the parent agent can update DIRECTED_COVERAGE.md once for the whole batch."

What each subagent should return:

```
Test name: test_<name>
Target coverage IDs: <list>
Status: PASS | FAIL_DEFECT | FAIL_GAVE_UP
Test file path: tests/scenarios/directed/testcases/test_<name>.py (or "not written" if blocked)
Covered IDs: <IDs the test actually exercises and asserts>
Uncovered IDs from target list: <IDs that didn't make it in, with reasons>
Defect notes: <only if FAIL_DEFECT — what the test expected vs. what FlashQuery did>
Debug iterations used: <number>
```

Spawn all subagents in a single turn. Don't wait for one to finish before spawning the next — the whole point is parallelism.

If you have many tests in the batch (say, more than 5 or 6), consider whether running them all at once will overwhelm the system. It's fine to run them in a couple of waves if needed, but the default is "all in parallel."

### Phase B3 — Collect results and report status

When all subagents have returned, build a summary table for the user **before** touching DIRECTED_COVERAGE.md. The user needs to see the overall picture and have a chance to react to anything surprising:

```
Batch results:

| Test                          | Status      | Covered IDs              | Notes                                    |
|-------------------------------|-------------|--------------------------|------------------------------------------|
| test_get_document_identifiers | PASS        | D-06, D-07, X-02, X-03   | —                                        |
| test_move_document            | FAIL_DEFECT | (none)                   | move_document doesn't preserve fqc_id    |
| test_memory_lifecycle         | PASS        | M-01, M-02, M-03         | M-08 deferred (proposed new scenario)    |
```

Then describe what you're about to do with DIRECTED_COVERAGE.md and the commit, and ask the user to confirm before proceeding. The user might want to investigate a defect before you mark anything failing, drop a test from the commit, or rerun a flaky one.

### Phase B4 — Serialize the DIRECTED_COVERAGE.md update

Once the user confirms, do phase 7 of the single-test workflow **once, sequentially, with all the subagent results in hand**. Important reasons this stays serial in the parent agent:

- DIRECTED_COVERAGE.md is a shared file. Parallel edits would stomp each other.
- The "Date Updated" column needs to be set consistently across all updated rows.
- the Coverage Summary table needs to reflect the whole batch, not be recomputed N times.

For each subagent result, apply the standard phase 7 updates: "Covered By" gains the test name, "Last Passing" gets today's date for PASS rows or `FAIL (YYYY-MM-DD)` with a `*`-suffixed test name for FAIL_DEFECT rows. Add a `### test_<name>` entry under the Test Mapping section for every test that got written, even the failing ones. Update the Coverage Summary at the end, once.

If any subagent reported uncovered IDs that should become new proposed scenarios, add them to the Proposed Test Scenarios table in the same pass.

### Phase B5 — One batched commit

Roll the whole batch into a single commit instead of N tiny ones. Stage all the new test files, the DIRECTED_COVERAGE.md update, and any other touched files, then offer the commit to the user with a message like:

```
test: batch add <N> directed scenario tests covering <category-summary>

Tests added:
- test_get_document_identifiers (D-06, D-07, X-02, X-03) — passing
- test_memory_lifecycle (M-01, M-02, M-03) — passing
- test_move_document (D-16, D-17, D-18) — FAILING, see defect note below

Defects surfaced:
- D-18: move_document does not preserve fqc_id (test_move_document*)

All passing tests verified as of <YYYY-MM-DD>.
```

Same rule as the single-test workflow: don't push, leave that to the user.

### Batch mode notes

- **Failing tests still get committed.** A test that surfaces an FlashQuery defect is valuable — it locks in the regression detector and documents the gap. Commit it alongside the passing tests, with the defect clearly noted in DIRECTED_COVERAGE.md (`FAIL (YYYY-MM-DD)` and `*` suffix) and in the commit message.
- **Don't share state between subagents.** Each one writes its own test file, runs its own managed server (different ports), uses its own `run_id`. They can't see each other's work and shouldn't try to.
- **If a subagent gets stuck**, it should follow the single-test debug-loop rules (5 iteration cap, then report). The parent agent then surfaces that test in the batch summary as FAIL_GAVE_UP and asks the user how to handle it.
- **Coverage gap reporting is per-test.** Each subagent reports its own gaps; the parent agent aggregates them into proposed-scenario additions in phase B4.

### Environments without subagents

Batch mode assumes you can spawn parallel subagents (which works in Claude Code and Cowork). If you're running in an environment that doesn't support subagents, batch mode degrades gracefully to sequential execution: run the per-test workflow (phases 2–6) for each test plan one at a time in the parent context, then do phases B3–B5 normally at the end.

The structure stays the same — group up front, isolate each test's work, batch the DIRECTED_COVERAGE.md update and the commit at the end — you just lose the parallelism. Tell the user up front if you're running sequentially so they know to expect it to take longer, especially for batches with more than two or three tests.

Don't try to fake parallelism by interleaving steps across tests in the parent context. That's the worst of both worlds: it muddles the per-test isolation that makes the workflow reliable, and it doesn't actually save any wall-clock time.

The rest of this document describes the single-test workflow. Subagents in batch mode follow the same workflow within their own scope — the only differences are that they don't update DIRECTED_COVERAGE.md, don't commit, and return a structured summary instead of a conversational one.

## Phase 1: Determine Coverage Goals

Before writing any code, establish exactly which coverage points this test will hit.

### If the user references DIRECTED_COVERAGE.md IDs (e.g., "cover D-06, D-07, X-02, X-03"):
1. Read `tests/scenarios/directed/DIRECTED_COVERAGE.md` (or if the user mentions it, but the file cannot be found, ask the user for its location)
2. Find each referenced ID and note its behavior description
3. Confirm the list with the user: "This test will target: D-06 (get document by path), D-07 (get document by filename), X-02 (identifier resolution: path), X-03 (identifier resolution: filename). Sound right?"

### If the user describes behavior (e.g., "test the move_document tool"):
1. Read `tests/scenarios/directed/DIRECTED_COVERAGE.md`
2. Identify which uncovered IDs map to the described behavior
3. Propose the set: "For move_document, I'd target D-16 (path updates in DB), D-17 (creates intermediate directories), D-18 (preserves fqc_id). Want to include any others?"

### If the user says "pick something" or "cover more of the matrix":
1. Read `tests/scenarios/directed/DIRECTED_COVERAGE.md`
2. Look at the Proposed Test Scenarios table at the bottom — pick the one with the most uncovered points
3. Propose it: "The highest-value uncovered scenario is test_plugin_lifecycle (8 new points). Want me to go with that, or would you prefer something else?"

**Record the final list of target coverage IDs.** You will check against these at the end.

If any target ID involves semantic or mixed-mode search (e.g., `search_documents` with
`mode='semantic'` or `mode='mixed'`, or `search_all` relying on vector similarity), note
that the test will need `require_embedding=True` in TestContext. Flag this to the user now
so they know an embedding provider must be configured in `.env.test` before the test can run.

If any target ID involves write-lock contention, concurrent-write safety, or anything else
that relies on FlashQuery's file-lock machinery being active (e.g., X-04), the test will need
`enable_locking=True` in TestContext. The managed server runs with locking disabled by
default for speed and isolation, so contention tests must opt in explicitly.

If any target ID involves FlashQuery's git auto-commit behavior (commits produced when documents
are created, changed, or removed — e.g. anything in the `G-` category), the test will need
`enable_git=True` in TestContext. This initializes the managed server's temp vault as a
git repo with a test-scoped identity (`FlashQuery Test <test@flashquery.local>`) and flips
`git.auto_commit: true` in the generated flashquery.yml. The test then uses `ctx.git` —
a small helper exposing `head_sha()`, `commits_since(ref)`, `commit_touches(sha, path)`,
and `is_clean()` — to assert on commit behavior.

## Phase 2: Study the Existing Tests

Before writing any code, read both existing test files to absorb the conventions:
- `tests/scenarios/directed/testcases/test_search_after_create.py`
- `tests/scenarios/directed/testcases/test_create_read_update.py`

Also read the framework modules to understand the available APIs:
- `tests/scenarios/framework/fqc_test_utils.py` — TestContext, TestRun, TestCleanup, FlashQueryServer, expectation_detail
- `tests/scenarios/framework/fqc_client.py` — FlashQueryClient, ToolResult and its expect_* methods
- `tests/scenarios/framework/fqc_vault.py` — VaultHelper, VaultDocument

## Phase 3: Write the Test Script

### Code Style and Conventions

The following conventions are derived from the existing test scripts. New tests must follow
them exactly to maintain a consistent, self-documenting codebase.

#### File-level Structure

Every test file follows this exact section order, with dashed-line separators between sections:

```python
#!/usr/bin/env python3
"""<module docstring>"""

from __future__ import annotations

# Standard library imports (sorted alphabetically)
import argparse
import re
import sys
import time
from pathlib import Path

# Framework path setup — three levels up from testcases/ to reach scenarios/framework/
# testcases/ -> directed/ -> scenarios/ -> framework/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

# Framework imports — only what's needed
from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_<name>"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FlashQuery key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""

# ... any other test-specific helpers ...


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    ...


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    ...

if __name__ == "__main__":
    main()
```

**Note on the `sys.path.insert` line:** Test files live at `tests/scenarios/directed/testcases/`.
The framework modules live at `tests/scenarios/framework/`. That's three directory levels up from
the test file (`testcases/ → directed/ → scenarios/`), so the path needs `parent.parent.parent`.
This is different from what you might see in older test files — if an existing file still uses
`parent.parent`, that's a bug (it would look for `directed/framework/` which doesn't exist).
Always use `parent.parent.parent` in new and updated tests.

#### Module Docstring Format

The module docstring serves as both documentation and `--help` epilog text. It follows this
exact structure (note the alignment of usage examples):

```python
"""
Test: <one-line description using arrow notation for flows>

Scenario:
    1. Step description (including MCP tool name in parentheses)
    2. Step description
    ...
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: <comma-separated IDs from DIRECTED_COVERAGE.md>

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_name.py                            # existing server
    python test_name.py --managed                  # managed server
    python test_name.py --managed --json           # structured JSON with server logs
    python test_name.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
```

#### Section Separators

Use 75-char dashed-line comment blocks to separate major sections:

```python
# ---------------------------------------------------------------------------
# Section Name
# ---------------------------------------------------------------------------
```

Sections are: "Test identity", "Helpers" (if any), "Test implementation", and "CLI".

#### Step Comments

Inside `run_test()`, each step gets a visually prominent inline separator:

```python
        # ── Step N: Description ──────────────────────────────────
```

The em-dash prefix and trailing dashes create a scannable visual rhythm. Steps are numbered
sequentially. The description matches the step label where practical.

#### Inline Comments

Comments explain *why*, not *what*. Examples from existing tests:

```python
# Parse the fqc_id and path from the response for cleanup tracking
# Register for cleanup — both filesystem and database
# Use the fqc_id if available, otherwise fall back to path
# The response should contain the original body content
# Should contain the UPDATED body, not the original
# After `with` block: cleanup has run, server has stopped
```

Avoid comments that merely restate the code. Include comments when they add context about
FlashQuery behavior or explain non-obvious decisions.

#### Variable Naming

- Test data variables are defined at the top of `run_test()`, before the `TestContext` block
- Unique identifiers include `run.run_id`: `f"FlashQuery Test {run.run_id}"`
- Test file paths always use `_test/` prefix: `f"_test/{TEST_NAME}_{run.run_id}.md"`
- Tags always include `"fqc-test"` and `run.run_id` for unique identification
- Result variables: `create_result`, `read_result`, `update_result`, `search_result`, `tag_result`, `scan_result`
- Parsed response fields: `created_fqc_id`, `created_path`

#### String Formatting

- Use f-strings throughout (never `.format()` or `%`)
- Multi-line strings use parenthesized concatenation:
  ```python
  original_body = (
      f"## Original Content\n\n"
      f"Created by {TEST_NAME} (run {run.run_id}).\n\n"
      f"This document tests the create -> read -> update cycle."
  )
  ```

#### CLI Section

The CLI section is identical across all tests except for the `description` string. Copy it
verbatim from an existing test. Key details:
- `formatter_class=argparse.RawDescriptionHelpFormatter`
- `epilog=__doc__`
- Standard arguments: `--fqc-dir`, `--url`, `--secret`, `--managed`, `--port-range`, `--json` (dest=`output_json`), `--keep`

#### Disk Verification Pattern

Use a `checks` dict for rich diagnostics:
```python
checks = {
    "descriptive check name": boolean_expression,
    "another check": another_expression,
}
all_ok = all(checks.values())
detail = ""
if not all_ok:
    failed = [k for k, v in checks.items() if not v]
    detail = (
        f"Failed: {', '.join(failed)}. "
        f"field1={actual1!r}, field2={actual2!r}, ..."
    )
```


#### `--keep` and Server Log Blocks

Every test includes these blocks near the end of the `with TestContext` block:

```python
        # ── Optionally retain files for debugging ─────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Files retained under: {ctx.vault.vault_root / '_test'}",
            )

        # ── Attach full server logs to the run ────────────────────
        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    # After `with` block: cleanup has run, server has stopped
    run.record_cleanup(ctx.cleanup_errors)
    return run
```

### Required Patterns

**The `run_test(args)` function is mandatory.** The suite runner imports and calls it directly.

**Always pass `vault_path=getattr(args, "vault_path", None)` to TestContext** — unless the test
requires an opt-in flag (see the next rule), in which case the "force managed" shape applies
instead.

**Tests that require `require_embedding=True`, `enable_locking=True`, or `enable_git=True` must
force `managed=True`** rather than using `managed=args.managed`. The opt-in flags only take
effect when the framework starts its own managed server — they configure that server as it
boots. Under `run_suite.py --managed`, the runner starts one shared server without any flags
and hands each test the shared server's URL with `managed=False`, which means a flag passed
alongside `managed=args.managed` is silently ignored. The test will pass standalone
(`--managed`) and fail under the suite with a confusing error (e.g. "Semantic search
unavailable (no API key configured)").

The correct shape for a flag-requiring test:

```python
with TestContext(
    fqc_dir=args.fqc_dir,
    # Always start a dedicated managed server — <reason specific to the flag>.
    managed=True,
    port_range=port_range,
    require_embedding=True,  # or enable_locking=True, or enable_git=True
) as ctx:
    ...
```

Drop `url`, `secret`, and the `vault_path` passthrough in this shape — they're external-server
arguments that don't apply when the test owns its own server. Keep `fqc_dir` and `port_range`
so the test stays pointable at a different project tree or port range when needed. Include a
one-line comment explaining *why* the test is forcing managed (what flag it needs and why the
shared server can't provide it), so future readers know it's intentional.

Tests that don't declare any opt-in flags should keep the normal shape (`managed=args.managed`
with `url`, `secret`, and `vault_path` passthroughs) so they can run against whatever server
the runner or developer provides.

**For tests that exercise semantic search**, also pass `require_embedding=True` to TestContext.
This tells the managed server to read `EMBEDDING_PROVIDER`, `EMBEDDING_API_KEY` (or
`OPENAI_API_KEY`), and `EMBEDDING_MODEL` from `.env.test` (falling back to `.env`).
If credentials are missing, the server will refuse to start with a clear error — which is
correct, since the test result would be meaningless without a live embedding provider.
Tests that don't need semantic search should omit this flag (default: `False`, provider: none).

**For tests that exercise write-lock contention or concurrent-write behavior**, pass
`enable_locking=True` to TestContext. The managed server runs with locking disabled by
default for speed and test isolation, so any test that depends on lock acquisition,
contention detection, or wait-and-retry semantics must opt in explicitly. Tests that
don't depend on locking should omit this flag (default: `False`).

**For tests that exercise FlashQuery's git auto-commit behavior**, pass `enable_git=True` to
TestContext. The framework then initializes the managed server's temp vault as a git
repo (with a test-scoped identity and an initial commit so HEAD exists) and flips
`git.auto_commit: true` in the generated flashquery.yml. The helper `ctx.git` becomes
available with a narrow assertion API: `head_sha()`, `commits_since(ref)`,
`commit_touches(sha, path)`, and `is_clean()`. The canonical pattern is capture-HEAD,
call-tool, assert-new-commits:

```python
before = ctx.git.head_sha()
result = ctx.client.call_tool("create_document", ...)
new_commits = ctx.git.commits_since(before)
checks = {
    "exactly one commit": len(new_commits) == 1,
    f"commit touches {path}": ctx.git.commit_touches(new_commits[0].sha, path),
    "working tree clean": ctx.git.is_clean(),
}
```

Tests that don't depend on git should omit this flag (default: `False`, no git init,
`auto_commit: false`). `enable_git` only does useful work in `managed` mode — external
servers run with whatever git config the user set up, and `ctx.git` will be `None` in
that case.

**MCP tool call + step recording:**
```python
log_mark = ctx.server.log_position if ctx.server else 0
result = ctx.client.call_tool("tool_name", param1=value1, param2=value2)
step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

result.expect_contains("expected text")         # response text contains substring
# Other expectation methods (all mutate result.expectations and return bool):
# result.expect_not_contains("error text")      # text does NOT contain substring
# result.expect_count_eq(1)                     # exactly N result entries (counts "Title:" lines)
# result.expect_count_gte(2)                    # at least N result entries

run.step(
    label="description of what this step does",
    passed=(result.ok and result.status == "pass"),
    detail=expectation_detail(result) or result.error or "",
    timing_ms=result.timing_ms,
    tool_result=result,
    server_logs=step_logs,
)
```

**Cleanup tracking for MCP-created resources:**
```python
created_fqc_id = _extract_field(create_result.text, "FlashQuery ID")
created_path = _extract_field(create_result.text, "Path")

if created_path:
    ctx.cleanup.track_file(created_path)
    parts = Path(created_path).parts
    for i in range(1, len(parts)):
        ctx.cleanup.track_dir(str(Path(*parts[:i])))
if created_fqc_id:
    ctx.cleanup.track_mcp_document(created_fqc_id)
```

**Cleanup tracking for MCP-created memories:**
```python
created_memory_id = ...  # extract from save_memory response with regex \(id: ([^)]+)\)
if created_memory_id:
    ctx.cleanup.track_mcp_memory(created_memory_id)
```

**Cleanup tracking for plugin registrations:**
```python
if plugin_id:
    ctx.cleanup.track_plugin_registration(plugin_id, plugin_instance)
```

The rule: register *immediately after creation*, before any step that might throw. `track_mcp_memory` archives the memory on cleanup; `track_plugin_registration` calls `unregister_plugin` with `confirm_destroy=True` in reverse registration order.

**Convenience methods on `ctx` (create + auto-register in one call):**
```python
# ctx.create_file() wraps vault.create_file() and automatically calls
# cleanup.track_file() + cleanup.track_dir() for intermediate directories.
path = ctx.create_file(
    f"_test/{TEST_NAME}_{run.run_id}.md",
    title="My Test Doc",
    body="## Content",
    tags=["fqc-test", run.run_id],
)

# ctx.scan_vault() is a shorthand for force_file_scan(background=False).
scan_result = ctx.scan_vault()
```

Use `ctx.create_file()` when you need a vault file as a test fixture — it's the single-call equivalent of `vault.create_file()` + `cleanup.track_file()` + `cleanup.track_dir()`. Use `ctx.scan_vault()` whenever a test needs the indexer to catch up before a search.

**Early exit on critical failures:**
```python
if not result.ok:
    return run  # cleanup still runs via TestContext.__exit__
```

### FlashQuery Tool Quick Reference

Common tools and their key parameters:

- **create_document**: `title` (str), `content` (str), `path` (str, optional), `tags` (list, optional), `frontmatter` (dict, optional)
- **get_document**: `identifier` (str — path, fqc_id, or filename), `sections` (list, optional), `include_subheadings` (bool, optional), `occurrence` (int, optional)
- **update_document**: `identifier` (str), `content` (str, optional), `title` (str, optional), `tags` (list, optional), `frontmatter` (dict, optional)
- **archive_document**: `identifiers` (str or list)
- **search_documents**: `query` (str, optional), `tags` (list, optional), `tag_match` ('any'|'all', optional), `limit` (int, optional), `mode` ('filesystem'|'semantic'|'mixed', optional)
- **move_document**: `identifier` (str), `destination` (str)
- **copy_document**: `identifier` (str), `destination` (str, optional)
- **force_file_scan**: `background` (bool, optional)
- **append_to_doc**: `identifier` (str), `content` (str)
- **insert_in_doc**: `identifier` (str), `heading` (str, optional), `position` ('top'|'bottom'|'after_heading'|'before_heading'|'end_of_section'), `content` (str), `occurrence` (int, optional)
- **replace_doc_section**: `identifier` (str), `heading` (str), `content` (str), `include_subheadings` (bool, optional), `occurrence` (int, optional)
- **update_doc_header**: `identifier` (str), `updates` (dict)
- **insert_doc_link**: `identifier` (str), `target` (str), `property` (str, optional)
- **get_doc_outline**: `identifiers` (str or list), `max_depth` (int, optional), `exclude_headings` (bool, optional)
- **apply_tags**: `identifiers` (str or list, optional), `memory_id` (str, optional), `add_tags` (list, optional), `remove_tags` (list, optional)
- **save_memory**: `content` (str), `tags` (list, optional), `plugin_scope` (str, optional)
- **search_memory**: `query` (str), `tags` (list, optional), `tag_match` ('any'|'all', optional), `threshold` (float, optional), `limit` (int, optional)
- **update_memory**: `memory_id` (str), `content` (str), `tags` (list, optional)
- **get_memory**: `memory_ids` (str or list)
- **list_memories**: `tags` (list, optional), `tag_match` ('any'|'all', optional), `limit` (int, optional)
- **archive_memory**: `memory_id` (str)
- **list_files**: `path` (str), `recursive` (bool, optional), `extension` (str, optional), `date_from` (str, optional), `date_to` (str, optional)
- **remove_directory**: `path` (str)
- **register_plugin**: `schema_path` (str, optional), `schema_yaml` (str, optional), `plugin_instance` (str, optional)
- **get_plugin_info**: `plugin_id` (str), `plugin_instance` (str, optional)
- **create_record**: `plugin_id` (str), `table` (str), `fields` (dict), `plugin_instance` (str, optional)
- **get_record**: `plugin_id` (str), `table` (str), `id` (str), `plugin_instance` (str, optional)
- **update_record**: `plugin_id` (str), `table` (str), `id` (str), `fields` (dict), `plugin_instance` (str, optional)
- **archive_record**: `plugin_id` (str), `table` (str), `id` (str), `plugin_instance` (str, optional)
- **search_records**: `plugin_id` (str), `table` (str), `filters` (dict, optional), `query` (str, optional), `limit` (int, optional), `plugin_instance` (str, optional)
- **unregister_plugin**: `plugin_id` (str), `plugin_instance` (str, optional), `confirm_destroy` (bool, optional)
- **search_all**: `query` (str), `tags` (list, optional), `tag_match` ('any'|'all', optional), `limit` (int, optional), `entity_types` (list, optional)
- **get_briefing**: `tags` (list), `tag_match` ('any'|'all', optional), `limit` (int, optional), `plugin_id` (str, optional)
- **reconcile_documents**: `dry_run` (bool, optional)
- **discover_document**: `mode` ('flagged'|'paths'), `paths` (list, optional)

### Important Behavioral Notes

- **FlashQuery response format for documents:** Key-value entries: `Title: ...\nFlashQuery ID: ...\nPath: ...\nTags: [...]\nStatus: active`. Multiple results separated by `---`. Empty results: `"No documents found."`
- **Memory response formats differ by tool:**
  - `save_memory` → `Memory saved (id: {uuid}). Tags: ...` — extract ID with regex `\(id: ([^)]+)\)`, not `_extract_field`
  - `update_memory` → `Memory updated. New version id: {uuid}. Previous version id: {uuid}. Version: N.` — use `_extract_field(text, "New version id")`
  - `search_memory`, `list_memories` → key-value format — use `_extract_field(text, "Memory ID")`
- **Identifier resolution:** Most document tools accept fqc_id (UUID), vault-relative path, or filename.
- **Tags are normalized:** Lowercased, trimmed, deduplicated by FlashQuery.
- **Archived entities are excluded from search** but can still be retrieved by direct ID.
- **Plugin tests need a schema:** Write a YAML schema string and pass it to register_plugin via `schema_yaml`.

## Phase 4: Validate Before Running

Before executing, do a pre-flight check:

1. **Syntax check:** Run `python3 -c "import py_compile; py_compile.compile('<path>', doraise=True)"`
2. **Coverage alignment:** Verify each target coverage ID has a step that exercises and verifies it.
3. **Cleanup completeness:** Verify every created resource has cleanup registration.

Fix issues before proceeding.

## Phase 5: Execute and Debug

### Run the test

Execute the test via the suite runner (from the flashquery-core project root):

```bash
python3 tests/scenarios/directed/run_suite.py --managed <test_name_without_test_prefix>
```

The `test_` prefix is optional. Example: `python3 tests/scenarios/directed/run_suite.py --managed document_move`

**Key run_suite.py flags:**

| Flag | When to use |
|------|-------------|
| `--managed` | Start a shared managed server for all tests (default for development and CI) |
| `--strict-cleanup` | Fail if any test leaves DB residue — catches missed cleanup registration |
| `--per-test-server` | Fresh managed server per test — use when diagnosing test-to-test state leakage |
| `--stop-on-fail` | Stop after the first failure — useful during a focused debug session |
| `--seed N` | Shuffle test order reproducibly — catches order-dependent failures |
| `--require-embedding` | Enable embedding in the shared server — for suites that include semantic search tests |
| `--enable-git` | Initialize git in the shared server's vault — for suites that include git behavior tests |
| `--enable-locking` | Enable write-lock handling in the shared server — for suites that include contention tests |
| `--testcases DIR` | Point at a different testcases directory (default: `testcases/` next to run_suite.py) |
| `--report-dir DIR` | Write reports to a different directory (default: `reports/` next to run_suite.py) |

Note: `--require-embedding`, `--enable-git`, `--enable-locking` configure the **shared** server when using `--managed`. Tests that hardcode `managed=True` for their own server are unaffected by these flags — they configure their own server via the `TestContext` constructor. The suite-level flags are for the scenario where all (or most) tests in a run need a capability and you want to enable it once for the shared server, rather than each test spinning up its own.

If the environment cannot run the test (no network access to Supabase, missing build, etc.),
explain the blocker clearly and give the user the exact command to run themselves:

```
Run this in your terminal from the flashquery-core directory:
    python3 tests/scenarios/directed/run_suite.py --managed <test_name>

If it fails, paste the report from tests/scenarios/directed/reports/scenario-report-*.md
and I'll diagnose and fix it.
```

### Check the result

1. Read stderr output for the pass/fail summary
2. If failed, read the latest report at `tests/scenarios/directed/reports/scenario-report-*.md`
3. The report has per-step details: arguments, responses, expectations, server logs

### Debug aids (`tests/scenarios/dbtools/`)

The `dbtools/` directory has operational scripts that are valuable **while debugging a
failing test**. They are NOT for writing assertions inside the test — scenario tests
should only assert on FlashQuery's public surface. Use these as inspection tools in the debug
loop, the same way a developer would open a SQL client.

- **`snapshot.py --instance-id <id>`** — dumps every row in every instance-scoped table
  for the test's instance. Use this when the scenario report doesn't explain why an
  assertion failed. Example: the tool returned the wrong text — snapshot tells you
  whether the underlying row is correct (so the bug is in the response formatter) or
  wrong (so the bug is deeper). The runner prints the exact command for any failing
  test in a managed mode, so it's usually a copy-paste away.

- **`verify_cleanup.py --instance-id <id>`** — confirms whether a test's cleanup
  actually removed everything. Worth running between debug iterations, because a test
  with a cleanup bug often "works the first time but fails the second" in confusing
  ways that aren't the real failure.

- **`reset.py --instance-id <id>`** — hard-deletes every row for a test instance.
  Escape hatch when a test has left the DB in a state even cleanup can't recover from
  between iterations.

**When to reach for them.** The report is the primary debug source. Only pull in dbtools
when the report isn't enough — typically after two debug iterations have failed to
explain a failure, or when the symptom is state-handoff-ish ("second run behaves
differently from first"). Don't snapshot after every iteration; it adds noise.

**What dbtools should never lead to.** Adding a DB query to the test itself. If the
debug output suggests you need to assert on something only visible in the DB, that's a
signal that (a) FlashQuery should expose it through the public surface, or (b) the behavior
doesn't belong in a scenario test. Raise either with the user rather than reaching into
the DB from the test script.

### Debug loop

The debug loop has a strict scope: **only fix test code and test-fixture problems**, never
adjust a test to match incorrect behavior in FlashQuery itself.

Before touching anything, ask: is this failure caused by (a) a mistake in the test script, or
(b) FlashQuery behaving differently than the test correctly expects?

**Fixable in the loop (test or fixture issues):**
- Missing `force_file_scan` / timing gaps
- Wrong `vault_path` passthrough
- Incorrect `expect_contains` string that doesn't match the actual FlashQuery response format
- Missing cleanup registration causing state leakage between steps
- Argparse or import errors
- Wrong `sys.path.insert` (using `parent.parent` instead of `parent.parent.parent`)

**Not fixable here (report to the user as a defect):**
- FlashQuery returning wrong data, wrong status, or missing fields that the test correctly expects
- A tool that doesn't exist or behaves contrary to documented behavior
- A coverage point that FlashQuery simply doesn't implement yet

When the failure looks like FlashQuery is the problem, stop the debug loop immediately and:

1. Tell the user clearly: *"This test appears to be correctly written. The failure indicates a
   defect in FlashQuery: [describe what the test expects vs. what FlashQuery returned]. I'm not going to
   modify the test to pass — this should be investigated and fixed in the application."*

2. Update DIRECTED_COVERAGE.md for each affected coverage ID: set "Last Passing" to `FAIL (YYYY-MM-DD)`
   and update "Covered By" to include the test name with a `*` suffix (e.g., `test_move_document*`)
   so it's clear the test exists but is blocked by a defect.

3. Ask how the user would like to proceed (skip this coverage point, file a bug, investigate
   further, or keep the test in place as a regression detector).

Common fixable failure patterns:

- **"No documents found"** after MCP create: Add `force_file_scan(background=False)` or `time.sleep(0.5)`.
- **"Not found in vault"** on disk verification: Ensure `vault_path=getattr(args, "vault_path", None)` is passed to TestContext.
- **Expected text not found**: Read the actual FlashQuery response in the report first — if the format genuinely differs from what the test expects, adjust the assertion. If FlashQuery is returning wrong content, that's a defect.
- **Tool returned error**: Check for invalid parameters or missing required fields in the test.
- **ImportError on fqc_test_utils**: The `sys.path.insert` line is wrong. Fix to use `parent.parent.parent / "framework"`.

Fix, re-run, repeat. **Limit to 5 debug iterations on test/fixture issues.** If still failing, present the situation and options to the user.

## Phase 6: Final Verification

Once passing:
1. Re-read the test script — verify each target coverage ID is exercised and asserted.
2. Read the passing report — confirm all steps show PASS.

### Coverage gap check

Compare the original target coverage IDs (from Phase 1) against what the passing test
actually covers. If any IDs from the target list are missing or only partially exercised:

1. Explain to the user which IDs are not covered and why (e.g., they require a different
   setup, depend on state that conflicts with other steps, or simply grew too large for one
   scenario).
2. Offer to add one or more new proposed scenarios to the DIRECTED_COVERAGE.md "Proposed Test Scenarios"
   table that would cover the missing IDs — so they aren't lost and can be picked up in a
   future test.

## Phase 7: Update DIRECTED_COVERAGE.md

1. **Category tables:** For each covered ID, update:
   - "Covered By" — add the test name
   - "Last Passing" — set to today's date (YYYY-MM-DD)
   - "Date Updated" — set to today's date if this is the first time the behavior is covered, or if the behavior description itself was changed
2. **New behaviors:** When adding a brand-new row to any category table, set "Date Updated" to today's date.
3. **Test mapping section:** Add `### test_<name>` with `Covers: <IDs>`.
4. **Summary table:** Update Covered/Uncovered counts.
5. **Proposed scenarios table:** Remove if this test matches a proposed scenario.

## Phase 8: Offer a Git Commit

After DIRECTED_COVERAGE.md is updated, check whether the project is under git:

```bash
git -C <project_root> rev-parse --is-inside-work-tree 2>/dev/null
```

If yes, offer to commit the relevant files:

> "Everything is updated and passing. Would you like me to commit these changes? I'd include:
> - `tests/scenarios/directed/testcases/test_<name>.py`
> - `tests/scenarios/directed/DIRECTED_COVERAGE.md`
> - `.gitignore` (if modified)
> - Any other files changed during this session"

If the user agrees, stage and commit with a descriptive message. Use this format:

```
test: add test_<name> covering <comma-separated IDs>

Covers: <ID list>
All steps passing as of <YYYY-MM-DD>.
```

Do not push — leave that to the user.
