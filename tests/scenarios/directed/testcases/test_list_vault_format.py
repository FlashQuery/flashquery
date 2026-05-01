#!/usr/bin/env python3
"""
Test: list_vault — table format tests: column values, size formatting, date columns.

Coverage points: F-69, F-70, F-71, F-72, F-73, F-74, F-75, F-80, F-81, F-82

Modes:
    Default     Connects to an already-running FQC instance
    --managed   Starts a dedicated FQC subprocess

Usage:
    python test_list_vault_format.py
    python test_list_vault_format.py --managed
    python test_list_vault_format.py --managed --json
    python test_list_vault_format.py --managed --json --keep

Exit codes:
    0   PASS
    2   FAIL
    3   DIRTY
"""
from __future__ import annotations

COVERAGE = ["F-69", "F-70", "F-71", "F-72", "F-73", "F-74", "F-75", "F-80", "F-81", "F-82"]

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestContext, TestRun, expectation_detail

TEST_NAME = "test_list_vault_format"


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    base_dir = f"_test/{run.run_id}"
    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:
        ctx.cleanup.track_dir(base_dir)

        # ── Setup: create a tracked document, a subdirectory, and a nested file ─
        ctx.client.call_tool("create_directory", paths=f"{base_dir}/subdir")

        notes_result = ctx.client.call_tool(
            "create_document",
            title=f"Notes {run.run_id}",
            content="Hello world — 11 bytes",
            path=f"{base_dir}/notes.md",
            tags=["fqc-test", run.run_id],
        )

        # Create a file inside subdir so F-74 can verify recursive relative-path names
        deep_result = ctx.client.call_tool(
            "create_document",
            title=f"Deep {run.run_id}",
            content="Nested file.",
            path=f"{base_dir}/subdir/deep.md",
            tags=["fqc-test", run.run_id],
        )

        for r in (notes_result, deep_result):
            m = re.search(r"FQC ID:\s*(\S+)", r.text)
            if m:
                ctx.cleanup.track_mcp_document(m.group(1).strip())

        # ── F-69: table format has markdown table header ───────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, format="table")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f69 = result.ok and "| Name | Type | Size | Created | Updated |" in result.text

        run.step(
            label="F-69: format=table has '| Name | Type | Size | Created | Updated |' header",
            passed=passed_f69,
            detail=f"ok={result.ok} has_header={'| Name | Type | Size | Created | Updated |' in result.text} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-70: table format has separator row '|---|' ──────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, format="table")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f70 = result.ok and "|---" in result.text

        run.step(
            label="F-70: format=table has separator row '|---|'",
            passed=passed_f70,
            detail=f"ok={result.ok} has_separator={'|---' in result.text} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-71: file Size column shows human-readable size (e.g. "260 B") ────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="files", format="table")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        has_size_unit = any(u in result.text for u in [" B", "KB", "MB", "GB"])
        passed_f71 = result.ok and has_size_unit

        run.step(
            label="F-71: file Size column shows human-readable size (e.g. '260 B')",
            passed=passed_f71,
            detail=f"ok={result.ok} has_size_unit={has_size_unit} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-72: directory Size column shows 'items' ─────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="directories", format="table")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f72 = result.ok and "items" in result.text

        run.step(
            label="F-72: directory Size column shows 'N items' in table format",
            passed=passed_f72,
            detail=f"ok={result.ok} has_items={'items' in result.text} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-73: directory Name column trails with "/" ───────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, format="table")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # The Name column for a directory row must end with "/" (e.g., "| subdir/ |")
        has_trailing_slash = "subdir/" in result.text
        passed_f73 = result.ok and has_trailing_slash

        run.step(
            label="F-73: directory Name column trails with '/' (e.g. 'subdir/')",
            passed=passed_f73,
            detail=f"ok={result.ok} has_trailing_slash={has_trailing_slash} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-74: non-recursive Name shows filename only; recursive shows relative path ─
        # Non-recursive: notes.md appears as "notes.md", not as a path-prefixed form
        log_mark = ctx.server.log_position if ctx.server else 0
        result_nr = ctx.client.call_tool("list_vault", path=base_dir, show="files", format="table", recursive=False)
        # Recursive: subdir/deep.md must appear with its relative path
        result_r = ctx.client.call_tool("list_vault", path=base_dir, show="files", format="table", recursive=True)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        nr_filename_only = "notes.md" in result_nr.text and f"{base_dir}/notes.md" not in result_nr.text
        r_relative_path = "subdir/deep.md" in result_r.text
        passed_f74 = result_nr.ok and result_r.ok and nr_filename_only and r_relative_path

        run.step(
            label="F-74: non-recursive Name shows filename only; recursive Name shows relative path",
            passed=passed_f74,
            detail=f"ok_nr={result_nr.ok} nr_filename_only={nr_filename_only} ok_r={result_r.ok} r_relative_path={r_relative_path} | nr={result_nr.text[:150]} | r={result_r.text[:150]}",
            timing_ms=result_nr.timing_ms + result_r.timing_ms,
            tool_result=result_r,
            server_logs=step_logs,
        )

        # ── F-75: dates use YYYY-MM-DD format — no time component ────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, format="table")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Must match full YYYY-MM-DD pattern
        has_full_date = bool(re.search(r"\d{4}-\d{2}-\d{2}", result.text))
        # Must NOT have a time component immediately after the date
        has_time_component = bool(re.search(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:", result.text))
        passed_f75 = result.ok and has_full_date and not has_time_component

        run.step(
            label="F-75: dates use YYYY-MM-DD format with no time component",
            passed=passed_f75,
            detail=f"ok={result.ok} has_full_date={has_full_date} has_time_component={has_time_component} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-80: no format parameter → defaults to table format ─────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        # Call WITHOUT format param — default should produce a table
        result = ctx.client.call_tool("list_vault", path=base_dir)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f80 = result.ok and "| Name |" in result.text

        run.step(
            label="F-80: no format param → defaults to table (| Name | header present)",
            passed=passed_f80,
            detail=f"ok={result.ok} has_header={'| Name |' in result.text} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-81: invalid format value → isError: true ───────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, format="verbose")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f81 = not result.ok

        run.step(
            label="F-81: invalid format='verbose' returns isError: true",
            passed=passed_f81,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-82: format=table + show=directories → only directory rows ───────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, format="table", show="directories")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # notes.md is a file — it must NOT appear in a directories-only listing
        notes_absent = "notes.md" not in result.text
        dirs_present = "subdir/" in result.text
        passed_f82 = result.ok and notes_absent and dirs_present

        run.step(
            label="F-82: format=table + show=directories — only directory rows (notes.md absent)",
            passed=passed_f82,
            detail=f"ok={result.ok} notes_absent={notes_absent} dirs_present={dirs_present} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            run.step(label="Cleanup skipped (--keep)", passed=True,
                     detail=f"Files retained under: {ctx.vault.vault_root / '_test'}")

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    run.record_cleanup(ctx.cleanup_errors)
    return run


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Test: list_vault table format column values, size, and date tests.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--fqc-dir", type=str, default=None)
    parser.add_argument("--url", type=str, default=None)
    parser.add_argument("--secret", type=str, default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"), default=None)
    parser.add_argument("--json", action="store_true", dest="output_json")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--vault-path", type=str, default=None, dest="vault_path")
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
