#!/usr/bin/env python3
"""
Test: list_files → directory listing, recursive mode, extension filter, date range.

Scenario:
    1. Create a nested directory structure under _test/<run_id>/ via MCP create_document:
       top.md at the root, sub/nested.md, sub/deep/leaf.md
    2. Also drop an extra .txt file directly in the vault for the extension-filter check
    3. Force a synchronous file scan so the new files are tracked
    4. F-08: list_files non-recursive on _test/<run_id> → expect top.md present,
       nested files NOT present
    5. F-09: list_files recursive=True → expect all three .md files present
    6. F-10: list_files recursive=True extension=".md" → expect all .md files,
       and verify the .txt file is excluded
    7. F-11a: list_files recursive=True with today's date range → expect the new files
    8. F-11b: list_files recursive=True with an old date range → expect empty result
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: F-08, F-09, F-10, F-11

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_list_files.py                            # existing server
    python test_list_files.py --managed                  # managed server
    python test_list_files.py --managed --json           # structured JSON with server logs
    python test_list_files.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["F-08", "F-09", "F-10", "F-11"]

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

TEST_NAME = "test_list_files"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FQC key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _create_doc(ctx, run, title: str, path: str, label: str) -> tuple[str, str]:
    """Create a doc via MCP, register cleanup, record the step. Returns (fqc_id, path)."""
    log_mark = ctx.server.log_position if ctx.server else 0
    result = ctx.client.call_tool(
        "create_document",
        title=title,
        content=f"## {title}\n\nFile created by {TEST_NAME} (run {run.run_id}).",
        path=path,
        tags=["fqc-test", "list-files-test", run.run_id],
    )
    step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

    created_fqc_id = _extract_field(result.text, "FQC ID")
    created_path = _extract_field(result.text, "Path")

    if created_path:
        ctx.cleanup.track_file(created_path)
        parts = Path(created_path).parts
        for i in range(1, len(parts)):
            ctx.cleanup.track_dir(str(Path(*parts[:i])))
    if created_fqc_id:
        ctx.cleanup.track_mcp_document(created_fqc_id)

    result.expect_contains(title)

    run.step(
        label=label,
        passed=(result.ok and result.status == "pass"),
        detail=expectation_detail(result) or result.error or "",
        timing_ms=result.timing_ms,
        tool_result=result,
        server_logs=step_logs,
    )
    return created_fqc_id, created_path


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    base_dir = f"_test/{TEST_NAME}_{run.run_id}"
    top_path = f"{base_dir}/top.md"
    nested_path = f"{base_dir}/sub/nested.md"
    leaf_path = f"{base_dir}/sub/deep/leaf.md"
    txt_path = f"{base_dir}/note.txt"

    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Create the three .md files via MCP ────────────────
        _, top_actual = _create_doc(
            ctx, run, f"List Files Top {run.run_id}", top_path,
            "create_document(top.md)",
        )
        _, nested_actual = _create_doc(
            ctx, run, f"List Files Nested {run.run_id}", nested_path,
            "create_document(sub/nested.md)",
        )
        _, leaf_actual = _create_doc(
            ctx, run, f"List Files Leaf {run.run_id}", leaf_path,
            "create_document(sub/deep/leaf.md)",
        )

        # Use the actual paths returned by FQC if create_document re-mapped them
        eff_top = top_actual or top_path
        eff_nested = nested_actual or nested_path
        eff_leaf = leaf_actual or leaf_path

        # ── Step 2: Drop a non-markdown file directly in the vault ────
        # This file is invisible to list_files' .md scan, but should also be
        # invisible when an extension=".md" filter is applied. We track it
        # for manual cleanup since it wasn't created via MCP.
        t0 = time.monotonic()
        try:
            txt_abs = ctx.vault._abs(txt_path)
            txt_abs.parent.mkdir(parents=True, exist_ok=True)
            txt_abs.write_text(f"plain text note for {run.run_id}\n")
            ctx.cleanup.track_file(txt_path)
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="Write extra .txt file directly to vault",
                passed=txt_abs.is_file(),
                detail=f"path={txt_path}",
                timing_ms=elapsed,
            )
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="Write extra .txt file directly to vault",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 3: Force a synchronous file scan ─────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.client.call_tool("force_file_scan", background=False)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        run.step(
            label="force_file_scan(background=False)",
            passed=(scan_result.ok and scan_result.status == "pass"),
            detail=expectation_detail(scan_result) or scan_result.error or "",
            timing_ms=scan_result.timing_ms,
            tool_result=scan_result,
            server_logs=step_logs,
        )

        # ── Step 4 (F-08): list_files non-recursive ───────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        nonrec_result = ctx.client.call_tool(
            "list_files",
            path=base_dir,
            recursive=False,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        nonrec_result.expect_contains(eff_top)
        nonrec_result.expect_not_contains(eff_nested)
        nonrec_result.expect_not_contains(eff_leaf)

        run.step(
            label="F-08: list_files non-recursive returns immediate children only",
            passed=(nonrec_result.ok and nonrec_result.status == "pass"),
            detail=expectation_detail(nonrec_result) or nonrec_result.error or "",
            timing_ms=nonrec_result.timing_ms,
            tool_result=nonrec_result,
            server_logs=step_logs,
        )

        # ── Step 5 (F-09): list_files recursive ───────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        rec_result = ctx.client.call_tool(
            "list_files",
            path=base_dir,
            recursive=True,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        rec_result.expect_contains(eff_top)
        rec_result.expect_contains(eff_nested)
        rec_result.expect_contains(eff_leaf)

        run.step(
            label="F-09: list_files recursive returns all descendants",
            passed=(rec_result.ok and rec_result.status == "pass"),
            detail=expectation_detail(rec_result) or rec_result.error or "",
            timing_ms=rec_result.timing_ms,
            tool_result=rec_result,
            server_logs=step_logs,
        )

        # ── Step 6 (F-10): list_files recursive + extension=".md" ─────
        log_mark = ctx.server.log_position if ctx.server else 0
        ext_result = ctx.client.call_tool(
            "list_files",
            path=base_dir,
            recursive=True,
            extension=".md",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        ext_result.expect_contains(eff_top)
        ext_result.expect_contains(eff_nested)
        ext_result.expect_contains(eff_leaf)
        # The .txt file must NOT appear when filtering by .md
        ext_result.expect_not_contains(txt_path)

        run.step(
            label='F-10: list_files extension=".md" excludes non-markdown files',
            passed=(ext_result.ok and ext_result.status == "pass"),
            detail=expectation_detail(ext_result) or ext_result.error or "",
            timing_ms=ext_result.timing_ms,
            tool_result=ext_result,
            server_logs=step_logs,
        )

        # ── Step 7 (F-11a): list_files date range covering today ─────
        # date_to is exclusive in FQC's list_files contract, so use tomorrow
        # as the upper bound to include files created today.
        today_iso = time.strftime("%Y-%m-%d")
        tomorrow_iso = time.strftime(
            "%Y-%m-%d",
            time.gmtime(time.time() + 86400),
        )
        log_mark = ctx.server.log_position if ctx.server else 0
        date_in_result = ctx.client.call_tool(
            "list_files",
            path=base_dir,
            recursive=True,
            date_from=today_iso,
            date_to=tomorrow_iso,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        date_in_result.expect_contains(eff_top)
        date_in_result.expect_contains(eff_nested)
        date_in_result.expect_contains(eff_leaf)

        run.step(
            label=f"F-11: list_files date range including today ({today_iso}) returns new files",
            passed=(date_in_result.ok and date_in_result.status == "pass"),
            detail=expectation_detail(date_in_result) or date_in_result.error or "",
            timing_ms=date_in_result.timing_ms,
            tool_result=date_in_result,
            server_logs=step_logs,
        )

        # ── Step 8 (F-11b): list_files date range that excludes today ─
        log_mark = ctx.server.log_position if ctx.server else 0
        date_out_result = ctx.client.call_tool(
            "list_files",
            path=base_dir,
            recursive=True,
            date_from="2020-01-01",
            date_to="2020-01-02",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # None of the new files should appear in this historical window
        date_out_result.expect_not_contains(eff_top)
        date_out_result.expect_not_contains(eff_nested)
        date_out_result.expect_not_contains(eff_leaf)

        run.step(
            label="F-11: list_files date range excluding today returns no new files",
            passed=(date_out_result.ok and date_out_result.status == "pass"),
            detail=expectation_detail(date_out_result) or date_out_result.error or "",
            timing_ms=date_out_result.timing_ms,
            tool_result=date_out_result,
            server_logs=step_logs,
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
        description="Test: list_files directory listing, recursion, extension, and date filters.",
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
