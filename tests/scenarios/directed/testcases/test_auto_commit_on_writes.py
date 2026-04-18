#!/usr/bin/env python3
"""
Test: FQC auto-commits to the vault's git repo on every file create / change / remove.

Scenario:
    1. Capture baseline HEAD of the (framework-initialized) vault git repo
    2. Create a document via MCP (create_document) — expect one new commit,
       touching the new file, with a clean working tree afterwards
    3. Update the document via MCP (update_document) — expect one new commit,
       touching the file, with a clean working tree afterwards
    4. Archive the document via MCP (archive_document) — expect one new commit,
       touching the file, with a clean working tree afterwards
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: G-01, G-02, G-03

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Requires:
    enable_git=True on TestContext (the framework initializes the managed
    server's temp vault as a git repo and flips git.auto_commit on in the
    generated flashquery.yml). This test cannot run meaningfully against an
    external server that isn't already git-enabled.

Usage:
    python test_auto_commit_on_writes.py --managed                  # managed server
    python test_auto_commit_on_writes.py --managed --json           # structured JSON
    python test_auto_commit_on_writes.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["G-01", "G-02", "G-03"]
REQUIRES_MANAGED = True

import argparse
import re
import sys
import time
from pathlib import Path

# Add the framework directory to the path for shared imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_auto_commit_on_writes"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FQC key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _commit_assertion(ctx, baseline_sha: str, expected_path: str) -> tuple[bool, str]:
    """
    Assert that exactly one commit was produced since baseline_sha, that it
    touched expected_path, and that the working tree is clean afterwards.

    Returns (passed, detail). detail is "" on success or a diagnostic message
    listing which checks failed and what was actually observed.
    """
    new_commits = ctx.git.commits_since(baseline_sha)
    clean = ctx.git.is_clean()

    # Use the first (only) commit as the one under test if we got exactly one.
    # For the "zero commits" or "multiple commits" cases, commit_touches isn't
    # meaningful; report the count and skip the touches check.
    touches = False
    if len(new_commits) == 1:
        touches = ctx.git.commit_touches(new_commits[0].sha, expected_path)

    checks = {
        "exactly one commit produced": len(new_commits) == 1,
        f"commit touches {expected_path}": touches,
        "working tree clean after call": clean,
    }
    all_ok = all(checks.values())
    if all_ok:
        return True, ""

    failed = [k for k, v in checks.items() if not v]
    sha_list = ", ".join(c.sha[:8] for c in new_commits) or "(none)"
    return False, (
        f"Failed: {'; '.join(failed)}. "
        f"commits_since_baseline={len(new_commits)} [{sha_list}], "
        f"clean_tree={clean}"
    )


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    unique_title = f"FQC Git Test {run.run_id}"
    test_path = f"_test/{TEST_NAME}_{run.run_id}.md"
    original_body = (
        f"## Original Content\n\n"
        f"Created by {TEST_NAME} (run {run.run_id}).\n\n"
        f"This document tests FQC auto-commit on create / change / remove."
    )
    updated_body = (
        f"## Updated Content\n\n"
        f"Modified by {TEST_NAME} (run {run.run_id}).\n\n"
        f"Body changed to trigger an auto-commit on update."
    )
    original_tags = ["fqc-test", "git-test", run.run_id]

    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always start a dedicated managed server — enable_git=True initializes
        # the vault as a git repo; the shared suite server has no git setup.
        managed=True,
        port_range=port_range,
        enable_git=True,
    ) as ctx:

        # This test is only meaningful with a git-initialized vault. Managed
        # mode sets this up; external mode does not. Fail loudly if git isn't
        # wired rather than producing confusing downstream errors.
        if ctx.git is None:
            run.step(
                label="GitHelper available",
                passed=False,
                detail=(
                    "ctx.git is None. This test requires --managed so the "
                    "framework can initialize the vault as a git repo."
                ),
            )
            return run

        # ── Step 1: Capture baseline HEAD ─────────────────────────────
        t0 = time.monotonic()
        try:
            baseline_sha = ctx.git.head_sha()
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label=f"Capture baseline HEAD ({baseline_sha[:8]})",
                passed=True,
                detail=f"baseline_sha={baseline_sha}",
                timing_ms=elapsed,
            )
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="Capture baseline HEAD",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 2: create_document → expect one commit (G-01) ────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_result = ctx.client.call_tool(
            "create_document",
            title=unique_title,
            content=original_body,
            path=test_path,
            tags=original_tags,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        created_fqc_id = _extract_field(create_result.text, "FQC ID")
        created_path = _extract_field(create_result.text, "Path") or test_path

        # Register for cleanup — both filesystem and database
        ctx.cleanup.track_file(created_path)
        parts = Path(created_path).parts
        for i in range(1, len(parts)):
            ctx.cleanup.track_dir(str(Path(*parts[:i])))
        if created_fqc_id:
            ctx.cleanup.track_mcp_document(created_fqc_id)

        run.step(
            label="create_document via MCP",
            passed=(create_result.ok and create_result.status == "pass"),
            detail=expectation_detail(create_result) or create_result.error or "",
            timing_ms=create_result.timing_ms,
            tool_result=create_result,
            server_logs=step_logs,
        )
        if not create_result.ok:
            return run

        t0 = time.monotonic()
        _poll_deadline = t0 + 2.0
        while len(ctx.git.commits_since(baseline_sha)) < 1 and time.monotonic() < _poll_deadline:
            time.sleep(0.05)
        passed, detail = _commit_assertion(ctx, baseline_sha, created_path)
        run.step(
            label="G-01: auto-commit on document create",
            passed=passed,
            detail=detail,
            timing_ms=int((time.monotonic() - t0) * 1000),
        )

        # Advance the baseline so the next step measures only its own effect.
        after_create_sha = ctx.git.head_sha()

        # ── Step 3: update_document → expect one commit (G-02) ────────
        update_identifier = created_fqc_id or created_path

        log_mark = ctx.server.log_position if ctx.server else 0
        update_result = ctx.client.call_tool(
            "update_document",
            identifier=update_identifier,
            content=updated_body,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="update_document via MCP",
            passed=(update_result.ok and update_result.status == "pass"),
            detail=expectation_detail(update_result) or update_result.error or "",
            timing_ms=update_result.timing_ms,
            tool_result=update_result,
            server_logs=step_logs,
        )
        if not update_result.ok:
            return run

        t0 = time.monotonic()
        _poll_deadline = t0 + 2.0
        while len(ctx.git.commits_since(after_create_sha)) < 1 and time.monotonic() < _poll_deadline:
            time.sleep(0.05)
        passed, detail = _commit_assertion(ctx, after_create_sha, created_path)
        run.step(
            label="G-02: auto-commit on document update",
            passed=passed,
            detail=detail,
            timing_ms=int((time.monotonic() - t0) * 1000),
        )

        after_update_sha = ctx.git.head_sha()

        # ── Step 4: archive_document → expect one commit (G-03) ───────
        archive_identifier = created_fqc_id or created_path

        log_mark = ctx.server.log_position if ctx.server else 0
        archive_result = ctx.client.call_tool(
            "archive_document",
            identifiers=archive_identifier,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="archive_document via MCP",
            passed=(archive_result.ok and archive_result.status == "pass"),
            detail=expectation_detail(archive_result) or archive_result.error or "",
            timing_ms=archive_result.timing_ms,
            tool_result=archive_result,
            server_logs=step_logs,
        )
        if not archive_result.ok:
            return run

        t0 = time.monotonic()
        _poll_deadline = t0 + 2.0
        while len(ctx.git.commits_since(after_update_sha)) < 1 and time.monotonic() < _poll_deadline:
            time.sleep(0.05)
        passed, detail = _commit_assertion(ctx, after_update_sha, created_path)
        run.step(
            label="G-03: auto-commit on document archive/remove",
            passed=passed,
            detail=detail,
            timing_ms=int((time.monotonic() - t0) * 1000),
        )

        # ── Optionally retain files for debugging ─────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Files retained under: {ctx.vault.vault_root / '_test'}",
            )

        # ── Attach full server logs to the run ────────────────────────
        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    # After `with` block: cleanup has run, server has stopped
    run.record_cleanup(ctx.cleanup_errors)
    return run


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Test: FQC auto-commits on vault file create / change / remove.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--fqc-dir", type=str, default=None,
                         help="Path to flashquery-core directory.")
    parser.add_argument("--url", type=str, default=None,
                         help="Override FQC server URL (ignored with --managed).")
    parser.add_argument("--secret", type=str, default=None,
                         help="Override auth secret (ignored with --managed).")
    parser.add_argument("--managed", action="store_true",
                         help="Start a dedicated FQC server for this test run.")
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"),
                         default=None,
                         help="Port range for managed server (default: 9100 9199).")
    parser.add_argument("--json", action="store_true", dest="output_json",
                         help="Emit structured JSON to stdout.")
    parser.add_argument("--keep", action="store_true",
                         help="Retain test files for debugging (skip cleanup).")

    args = parser.parse_args()
    run = run_test(args)

    if args.output_json:
        print(run.to_json())
    else:
        for line in run.summary_lines():
            print(line, file=sys.stderr)

    sys.exit(run.exit_code)


if __name__ == "__main__":
    main()
