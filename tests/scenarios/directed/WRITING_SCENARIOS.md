# Writing Scenario Tests

This guide explains how to author a new scenario test for FlashQuery. It covers how these tests are structured, what the framework gives you, which opt-in flags exist, how to handle cleanup, and what not to do.

If you want an automated authoring workflow, the `flashquery-directed-testgen` skill in `.claude/skills/` handles the whole lifecycle — picking coverage goals, writing the script, running and debugging it, and updating `DIRECTED_COVERAGE.md`. This document is for people writing tests by hand, or who just want to understand what the skill is doing under the hood. The two are aligned: both follow the same conventions and produce the same shape of output.

## What makes a scenario test a scenario test

Scenario tests ask: *if a user (or LLM) does X through FlashQuery's public surface, does the system as a whole do the right thing?* They verify end-to-end behavior — tool call goes in, the right thing happens across MCP, the vault filesystem, and the database, the right response comes back.

Three principles follow from that scope:

**The public surface is the contract.** Tests assert on tool responses, vault filesystem state, and the tool's own return values. They do not query the database directly, read internal logs, or poke at private fields. If the only way to verify something is behind the public surface, it's probably not a scenario behavior in the first place — see the "what belongs in the matrix" section of `DIRECTED_COVERAGE.md` for the criteria.

**Tests verify intended behavior, not current behavior.** Writing an assertion to match whatever FlashQuery happens to return today produces self-fulfilling tests that can't catch regressions. When an assertion fails, the right question is "is my test wrong, or is FlashQuery wrong?" and the answer should come from the spec, not from running the test a second time with a tweaked assertion.

**Each test is self-contained.** Sets up its own state, runs its own workflow, cleans up after itself, and doesn't depend on any other test having run first. Tests should pass in any order and any number of times.

## Anatomy of a test file

Every test file in `testcases/` follows the same shape. The structure exists for concrete reasons:

- A module-level `run_test(args)` function so the suite runner (`run_suite.py`) can import and call it directly without shelling out.
- A `main()` CLI block so the test can also be run standalone (useful during development and debugging).
- A `TEST_NAME` constant so all logs, cleanup tags, and run IDs are consistent.
- Section separator comments so a human can skim the file and find the step they care about.

```python
#!/usr/bin/env python3
"""
Test: <one-line description>

Scenario:
    1. Step description (with MCP tool name in parentheses)
    2. ...
    Cleanup is automatic.

Coverage points: <comma-separated IDs from DIRECTED_COVERAGE.md>

Modes:
    Default     Connects to an already-running FlashQuery instance
    --managed   Starts a dedicated FlashQuery subprocess for this test

Usage:
    python test_name.py                            # existing server
    python test_name.py --managed                  # managed server
    python test_name.py --managed --json           # structured output
    python test_name.py --managed --json --keep    # retain files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_my_behavior"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FlashQuery's key-value response format."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    # ... test body ...
    return run


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    # argparse scaffolding (copy verbatim from any existing test)
    ...

if __name__ == "__main__":
    main()
```

`test_create_read_update.py` is the cleanest complete reference; `test_search_after_create.py` is the simplest. `test_auto_commit_on_writes.py` shows how opt-in flags (`enable_git` in that case) plug into the pattern.

## The TestContext

Every test runs inside a `TestContext` block. The context manages three related concerns that a test would otherwise have to juggle individually:

- It wires up the MCP client (for tool calls) and the vault helper (for filesystem reads/writes) against either an existing server or a fresh managed one.
- It provides a `TestCleanup` object that tracks resources the test creates and tears them down on exit — on success, failure, or exception.
- Under `--managed`, it starts and stops a dedicated FlashQuery subprocess for the test, captures its logs, and generates a per-test flashquery.yml with test-scoped settings.

Minimum usage:

```python
with TestContext(
    fqc_dir=args.fqc_dir,
    url=args.url,
    secret=args.secret,
    vault_path=getattr(args, "vault_path", None),
    managed=args.managed,
    port_range=port_range,
) as ctx:
    # ctx.client — MCP client
    # ctx.vault  — vault filesystem helper
    # ctx.cleanup — cleanup tracker
    # ctx.server — managed FlashQuery server, or None for external
    ...
```

**Always pass `vault_path=getattr(args, "vault_path", None)`.** The suite runner supplies this via `SimpleNamespace` in `--managed` shared mode so each test can see the shared vault; standalone runs default to `None` and the framework picks a temp directory. Skipping this argument is the most common cause of "file created but not found on disk" failures in shared mode.

### Opt-in flags

Three constructor arguments enable specific framework behaviors that are off by default (they cost time, require credentials, or change the environment). Turn them on when a test genuinely needs them; leave them off otherwise.

**`require_embedding=True`** — needed for any test that exercises semantic or mixed-mode search. Tells the managed server to read `EMBEDDING_PROVIDER`, `EMBEDDING_API_KEY` (or `OPENAI_API_KEY`), and `EMBEDDING_MODEL` from `.env.test` (falling back to `.env`), and fails loudly at startup if credentials are missing. Without this flag, the server runs with `embedding.provider: "none"` and semantic search will return errors or empty results.

**`enable_locking=True`** — needed for any test that exercises write-lock contention, concurrent writes, or wait-and-retry semantics. Turns on the file-lock machinery in the managed server (disabled by default for speed and test isolation). Tests that don't care about locking should omit this flag.

**`enable_git=True`** — needed for any test that exercises FlashQuery's git auto-commit behavior. Initializes the managed server's temp vault as a git repo (with a test-scoped identity and an initial commit) and flips `git.auto_commit: true` in the generated flashquery.yml. When enabled, `ctx.git` becomes available with a small assertion API (`head_sha()`, `commits_since(ref)`, `commit_touches(sha, path)`, `is_clean()`).

These compose freely: a test can pass two or three flags if it needs more than one capability.

### Tests that use opt-in flags must force `managed=True`

There's one subtlety that catches new tests: the opt-in flags take effect **only when the framework starts its own managed server**. Under `run_suite.py --managed`, the runner starts a single shared server with no flags enabled, then hands each test the shared server's URL with `managed=False`. A test that does this:

```python
with TestContext(
    ...
    managed=args.managed,          # False under the shared suite runner
    require_embedding=True,        # silently ignored — not our server to configure
) as ctx:
    ...
```

will pass standalone (`--managed`) but fail under `run_suite.py --managed` with a confusing error like "Semantic search unavailable (no API key configured)." The flag is plumbed through, but there's no managed server for it to apply to.

The fix is to hardcode `managed=True` when the test genuinely requires a flag. The test then always spins up its own dedicated server, regardless of how the runner invokes it:

```python
with TestContext(
    fqc_dir=args.fqc_dir,
    # Always start a dedicated managed server — embeddings must be enabled
    # for semantic memory search to work, and the shared suite server runs
    # with embedding.provider: "none".
    managed=True,
    port_range=port_range,
    require_embedding=True,
) as ctx:
    ...
```

Drop `url`, `secret`, and the `vault_path` passthrough in this case — they're external-server arguments that don't apply to a test which owns its own server. Keep `fqc_dir` and `port_range` so the test can be pointed at a different project tree or port range when needed.

The same rule applies to `enable_locking=True` and `enable_git=True`. If the test doesn't declare any flags, keep the normal `managed=args.managed` / `url` / `secret` shape so the test can run against whatever server the runner or developer points it at. The "force managed" pattern is specifically for tests that need the framework to configure the server for them.

## Step structure

A scenario test is a sequence of named steps. Each step runs some code, records an outcome, and flows into the next step — pass or fail. The suite report and JSON output are keyed on these steps, so naming them clearly pays off during debugging.

The canonical step shape for an MCP tool call:

```python
# ── Step N: <description> ────────────────────────────────
log_mark = ctx.server.log_position if ctx.server else 0
result = ctx.client.call_tool("tool_name", arg1=value1, arg2=value2)
step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

result.expect_contains("expected text")

run.step(
    label="description of what this step does",
    passed=(result.ok and result.status == "pass"),
    detail=expectation_detail(result) or result.error or "",
    timing_ms=result.timing_ms,
    tool_result=result,
    server_logs=step_logs,
)
if not result.ok:
    return run  # cleanup still runs via TestContext.__exit__
```

The `log_position` / `logs_since` pattern associates the managed server's log output with the step that produced it, so when a step fails the report can show exactly what FlashQuery was doing at that moment. In external-server mode those fields are `None` and the pattern is a no-op.

For filesystem or programmatic verification steps (no tool call), the shape is simpler:

```python
# ── Step N: Verify frontmatter on disk ───────────────────
t0 = time.monotonic()
try:
    doc = ctx.vault.read_file(created_path)
    checks = {
        "title matches": doc.title == expected_title,
        "status is active": doc.status == "active",
        "fqc_id present": doc.fqc_id is not None,
    }
    all_ok = all(checks.values())
    detail = ""
    if not all_ok:
        failed = [k for k, v in checks.items() if not v]
        detail = f"Failed: {', '.join(failed)}. title={doc.title!r}, ..."
    run.step("Verify frontmatter", passed=all_ok, detail=detail,
             timing_ms=int((time.monotonic() - t0) * 1000))
except Exception as e:
    run.step("Verify frontmatter", passed=False, detail=f"Exception: {e}",
             timing_ms=int((time.monotonic() - t0) * 1000))
```

The `checks` dictionary pattern is the one we use for any step with multiple assertions — it produces clear diagnostic messages ("Failed: title matches, fqc_id present") rather than opaque "False != True" errors.

## Cleanup

Every resource a test creates needs to be registered with `ctx.cleanup` so the context manager can tear it down afterward. This runs on exit regardless of whether the test passed, failed, or crashed.

```python
# After creating a document via MCP:
if created_path:
    ctx.cleanup.track_file(created_path)
    # Also track any intermediate directories so empty ones get removed
    parts = Path(created_path).parts
    for i in range(1, len(parts)):
        ctx.cleanup.track_dir(str(Path(*parts[:i])))
if created_fqc_id:
    ctx.cleanup.track_mcp_document(created_fqc_id)
```

For memories, use `track_mcp_memory(memory_id)`. For plugin registrations, `track_plugin_registration(plugin_id, plugin_instance)`. The common rule: **register immediately after creation**, before any step that might throw. Registering late is the most common cause of test residue surviving a crash.

`--keep` mode clears the trackers at the end of the test so files stay on disk for inspection. That's only for local debugging — don't leave `--keep` on in CI or committed code.

## Failure modes and debugging

When a test fails, work the debug path in this order:

1. **Read the pass/fail summary on stderr.** The last line tells you which step failed and what assertion.
2. **Read the latest report in `reports/`.** The markdown report has per-step detail: tool arguments, raw responses, expectation outcomes, server logs scoped to the step. This is usually enough.
3. **If the report isn't enough, use `dbtools/`.** The runner prints a ready-to-copy command for any failing test in a managed mode — `python3 dbtools/snapshot.py --instance-id <id>` gives you every DB row the test created. See `dbtools/README.md` for the full set.
4. **Before fixing anything, ask "is this a test bug or a FlashQuery defect?"** If FlashQuery is returning wrong data that the test correctly expects, the test is right and FlashQuery is wrong — flag it, don't tune the assertion. If the test has a wrong assertion, a timing gap, or missed cleanup tracking, that's a fix.

Common fixable failure patterns:

- **"No documents found" after MCP create** — add `force_file_scan(background=False)` or a brief `time.sleep(0.5)` to give the indexer time to catch up.
- **"Not found in vault" on disk verification** — `vault_path=getattr(args, "vault_path", None)` was omitted from the `TestContext` construction.
- **Expected text not found** — read the actual FlashQuery response in the report first. If the format genuinely differs from what the test expected, adjust the assertion. If FlashQuery is returning wrong content, that's a defect.

## What not to do

A few firm rules that keep scenario tests useful over time:

**Don't assert on database state directly from inside a test.** Scenario tests verify the public surface. Reaching into the DB to confirm what a tool already told you creates schema coupling, doubles the surface area, and can mask the exact class of bugs ("public surface lies about state") scenario tests exist to catch. If a behavior can only be checked by querying the DB, that's either (a) a signal the behavior should be exposed through the public surface, or (b) a signal the behavior isn't a scenario concern at all.

**Don't tune assertions to match current behavior when FlashQuery is wrong.** The whole point of writing against intended behavior is that the test will catch FlashQuery when it drifts. "The assertion was failing so I made it pass" is the opposite of useful.

**Don't modify the framework to make your test pass.** The framework should stay general. If a test needs something the framework doesn't offer, the answer is usually a new opt-in flag (like `enable_git`), a new helper method, or a test-local helper — not a special case for this one test.

**Don't seed state via direct DB inserts.** Build fixtures through the tool surface even when it's more code. Direct inserts bypass FlashQuery's invariants and produce state that the rest of FlashQuery wouldn't have created, which tends to trigger code paths that never fire in real usage.

**Don't skip cleanup registration to simplify the test.** A test that doesn't track what it creates isn't simpler — it's a future debugging session for someone else.

## Coverage and the matrix

Every test should exist to cover one or more behaviors in `DIRECTED_COVERAGE.md`. Before writing a test, pick the IDs it will target; after writing it, record those IDs in the module docstring (`Coverage points: ...`) and in the `Covered By` column of the matrix. The matrix doubles as a changelog — `Date Updated` and `Last Passing` columns track when each behavior was added, modified, or verified.

The `flashquery-directed-covgen` skill handles adding new behaviors to the matrix when FlashQuery's functionality changes; the `flashquery-directed-testgen` skill handles updating `Covered By` and `Last Passing` after a test passes. Both skills are optional — you can do either by hand by following the same conventions.

## Running a test you've just written

```bash
# Standalone (fastest feedback loop for development)
python3 tests/scenarios/directed/testcases/test_my_behavior.py --managed

# Via the suite runner (what CI will do)
python3 tests/scenarios/directed/run_suite.py --managed my_behavior

# With strict cleanup enforcement (catches missed cleanup registrations)
python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup my_behavior
```

If it passes standalone but fails in suite mode, the most likely cause is missing cleanup registration — state from your test leaked into a later test's vault. `--strict-cleanup` is the tool for catching that before it bites in CI.

## Reference material

- **`DIRECTED_COVERAGE.md`** — what behaviors exist and which tests cover them
- **`../dbtools/README.md`** — debug-aid scripts for inspecting the test DB
- **`../framework/fqc_test_utils.py`** — the `TestContext`, `TestRun`, FlashQuery Server, and `TestCleanup` source
- **`../framework/fqc_client.py`** — MCP client and `ToolResult` / `expect_*` API
- **`../framework/fqc_vault.py`** — vault filesystem reads/writes and frontmatter
- **`../framework/fqc_git.py`** — `GitHelper` for git-aware tests
- **`.claude/skills/flashquery-directed-testgen/SKILL.md`** — the automated authoring workflow; also the canonical list of mechanical conventions
- **`.claude/skills/flashquery-directed-covgen/SKILL.md`** — the coverage-matrix-update workflow
