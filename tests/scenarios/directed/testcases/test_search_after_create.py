#!/usr/bin/env python3
"""
Test: search_documents finds a file that was just created in the vault.

Scenario:
    1. Create a uniquely-titled markdown file directly in the vault
    2. Verify frontmatter was written correctly on disk
    3. Call force_file_scan so FQC indexes the new file
    4. Call search_documents by title — verify it's found
    5. Call search_documents by tag — verify exactly 1 result
    Cleanup is automatic (filesystem + database) even if the test fails.

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_search_after_create.py                            # existing server
    python test_search_after_create.py --managed                  # managed server
    python test_search_after_create.py --managed --json           # structured JSON with server logs
    python test_search_after_create.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["S-01", "S-02", "F-01"]

import argparse
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Add the framework directory to the path for shared imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_search_after_create"


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    unique_title = f"FQC Test {run.run_id}"
    test_file = f"_test/{TEST_NAME}_{run.run_id}.md"

    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Create file in vault ──────────────────────────
        t0 = time.monotonic()
        try:
            ctx.create_file(
                test_file,
                title=unique_title,
                body=(
                    f"## Test Document\n\n"
                    f"Created by {TEST_NAME} (run {run.run_id}) "
                    f"at {datetime.now(timezone.utc).isoformat()}.\n\n"
                    f"This file should be found by search_documents."
                ),
                tags=["fqc-test", "search-test", run.run_id],
            )
            elapsed = int((time.monotonic() - t0) * 1000)
            exists = ctx.vault.exists(test_file)
            run.step(
                label=f"Create test file: {test_file}",
                passed=exists,
                detail="" if exists else "File not found on disk after create_file()",
                timing_ms=elapsed,
            )
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label=f"Create test file: {test_file}",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run  # cleanup still runs via TestContext.__exit__

        # ── Step 2: Verify frontmatter on disk ────────────────────
        t0 = time.monotonic()
        try:
            doc = ctx.vault.read_file(test_file)
            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "title": doc.title == unique_title,
                "status": doc.status == "active",
                "run_id tag": run.run_id in doc.tags,
                "fqc_id present": doc.fqc_id is not None,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed checks: {', '.join(failed)}. "
                    f"title={doc.title!r}, status={doc.status!r}, "
                    f"tags={doc.tags!r}, fqc_id={doc.fqc_id!r}"
                )
            run.step("Verify frontmatter on disk", passed=all_ok, detail=detail, timing_ms=elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step("Verify frontmatter on disk", passed=False,
                     detail=f"Exception: {e}", timing_ms=elapsed)

        # ── Step 3: Force FQC to scan the vault ──────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan (sync)",
            passed=scan_result.ok,
            detail=scan_result.error or "",
            timing_ms=scan_result.timing_ms,
            tool_result=scan_result,
            server_logs=step_logs,
        )
        if not scan_result.ok:
            return run  # can't search if scan failed; cleanup still runs

        # ── Step 4: Search by unique title ────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        search_result = ctx.client.call_tool(
            "search_documents",
            query=unique_title,
            mode="filesystem",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        search_result.expect_contains(unique_title)
        search_result.expect_count_gte(1)

        run.step(
            label=f"search_documents(query='{unique_title}')",
            passed=(search_result.ok and search_result.status == "pass"),
            detail=expectation_detail(search_result),
            timing_ms=search_result.timing_ms,
            tool_result=search_result,
            server_logs=step_logs,
        )

        # ── Step 5: Search by unique tag ──────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        tag_result = ctx.client.call_tool(
            "search_documents",
            tags=[run.run_id],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        tag_result.expect_contains(unique_title)
        tag_result.expect_count_eq(1)

        run.step(
            label=f"search_documents(tags=['{run.run_id}'])",
            passed=(tag_result.ok and tag_result.status == "pass"),
            detail=expectation_detail(tag_result),
            timing_ms=tag_result.timing_ms,
            tool_result=tag_result,
            server_logs=step_logs,
        )

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


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Test: search_documents finds a newly created vault file.",
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
