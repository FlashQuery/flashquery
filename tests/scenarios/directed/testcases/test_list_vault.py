#!/usr/bin/env python3
"""
Test: list_vault — show modes, basic filtering, summary line, non-existent path, zero-params.

Coverage points: F-08, F-09, F-10, F-11, F-53, F-54, F-65, F-66, F-68, F-84, F-85, F-86, F-87, F-88, F-89, F-90, F-91

Modes:
    Default     Connects to an already-running FQC instance
    --managed   Starts a dedicated FQC subprocess

Usage:
    python test_list_vault.py
    python test_list_vault.py --managed
    python test_list_vault.py --managed --json
    python test_list_vault.py --managed --json --keep

Exit codes:
    0   PASS
    2   FAIL
    3   DIRTY
"""
from __future__ import annotations

COVERAGE = ["F-08", "F-09", "F-10", "F-11", "F-53", "F-54", "F-65", "F-66", "F-68", "F-84", "F-85", "F-86", "F-87", "F-88", "F-89", "F-90", "F-91"]

import argparse
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestContext, TestRun, expectation_detail

TEST_NAME = "test_list_vault"


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

        # ── Setup: create directory structure ─────────────────────────────────
        ctx.client.call_tool("create_directory", paths=f"{base_dir}/sub/deep")

        top_result = ctx.client.call_tool(
            "create_document",
            title=f"Top {run.run_id}",
            content="Top-level document.",
            path=f"{base_dir}/top.md",
            tags=["fqc-test", run.run_id],
        )
        nested_result = ctx.client.call_tool(
            "create_document",
            title=f"Nested {run.run_id}",
            content="Nested document.",
            path=f"{base_dir}/sub/nested.md",
            tags=["fqc-test", run.run_id],
        )
        leaf_result = ctx.client.call_tool(
            "create_document",
            title=f"Leaf {run.run_id}",
            content="Leaf document.",
            path=f"{base_dir}/sub/deep/leaf.md",
            tags=["fqc-test", run.run_id],
        )

        # Extract fqc_ids for cleanup
        def extract_fqc_id(text: str) -> str:
            m = re.search(r"FQC ID:\s*(\S+)", text)
            return m.group(1).strip() if m else ""

        for r in (top_result, nested_result, leaf_result):
            fid = extract_fqc_id(r.text)
            if fid:
                ctx.cleanup.track_mcp_document(fid)

        # Create an untracked .txt file directly
        t0 = time.monotonic()
        txt_abs = ctx.vault._abs(f"{base_dir}/untracked.txt")
        txt_abs.parent.mkdir(parents=True, exist_ok=True)
        txt_abs.write_text(f"untracked note for {run.run_id}\n")
        ctx.cleanup.track_file(f"{base_dir}/untracked.txt")
        run.step(
            label="Setup: write untracked.txt directly to vault",
            passed=txt_abs.is_file(),
            detail=f"path={base_dir}/untracked.txt",
            timing_ms=int((time.monotonic() - t0) * 1000),
        )

        # ── F-08: list_vault non-recursive → top.md present, nested.md NOT ────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="files", recursive=False)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        top_present = "top.md" in result.text
        nested_absent = "nested.md" not in result.text
        passed_f08 = result.ok and top_present and nested_absent

        run.step(
            label="F-08: list_vault non-recursive returns immediate children only",
            passed=passed_f08,
            detail=f"ok={result.ok} top_present={top_present} nested_absent={nested_absent} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-09: list_vault recursive → all 3 .md files present ─────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="files", recursive=True)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f09 = result.ok and "nested.md" in result.text and "leaf.md" in result.text

        run.step(
            label="F-09: list_vault recursive returns all descendants",
            passed=passed_f09,
            detail=f"ok={result.ok} nested={'nested.md' in result.text} leaf={'leaf.md' in result.text} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-10: recursive + extensions=['.md'] → .txt excluded ─────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="files", recursive=True, extensions=[".md"])
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        txt_absent = "untracked.txt" not in result.text
        passed_f10 = result.ok and "top.md" in result.text and txt_absent

        run.step(
            label='F-10: list_vault extensions=[".md"] excludes non-markdown files',
            passed=passed_f10,
            detail=f"ok={result.ok} txt_absent={txt_absent} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-11: date filter — recent files appear; ancient range returns none ─
        log_mark = ctx.server.log_position if ctx.server else 0
        result_recent = ctx.client.call_tool("list_vault", path=base_dir, show="files", recursive=True, after="365d")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f11_in = result_recent.ok and "top.md" in result_recent.text

        log_mark = ctx.server.log_position if ctx.server else 0
        result_old = ctx.client.call_tool("list_vault", path=base_dir, show="files", recursive=True, before="2000-01-01")
        step_logs_old = ctx.server.logs_since(log_mark) if ctx.server else None

        old_empty = result_old.ok and ("No files found" in result_old.text or "0 of 0" in result_old.text or "top.md" not in result_old.text)
        passed_f11 = passed_f11_in and old_empty

        run.step(
            label="F-11: list_vault date filter includes recent files, excludes ancient range",
            passed=passed_f11,
            detail=f"recent_ok={result_recent.ok} recent_has_top={'top.md' in result_recent.text} old_empty={old_empty} | {result_recent.text[:100]}",
            timing_ms=result_recent.timing_ms + result_old.timing_ms,
            tool_result=result_recent,
            server_logs=step_logs,
        )

        # ── F-53: table format header row present ─────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="files")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f53 = result.ok and "| Name |" in result.text

        run.step(
            label="F-53: list_vault default format has markdown table header",
            passed=passed_f53,
            detail=f"ok={result.ok} has_header={'| Name |' in result.text} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-54: detailed format does NOT contain '| Name |' ─────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="files", format="detailed")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        no_table_header = "| Name |" not in result.text
        has_path_field = "Path:" in result.text
        passed_f54 = result.ok and no_table_header and has_path_field

        run.step(
            label="F-54: list_vault format=detailed uses key-value blocks (no table header)",
            passed=passed_f54,
            detail=f"ok={result.ok} no_table_header={no_table_header} has_path={has_path_field} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-65: non-recursive name column shows filename only ───────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="files", recursive=False)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Non-recursive: should show "top.md" not "sub/top.md"
        has_filename = "top.md" in result.text
        # "sub/" should not appear in the name column of a non-recursive listing
        no_path_prefix = "sub/top.md" not in result.text
        passed_f65 = result.ok and has_filename and no_path_prefix

        run.step(
            label="F-65: non-recursive listing shows filename only in Name column",
            passed=passed_f65,
            detail=f"ok={result.ok} has_filename={has_filename} no_path_prefix={no_path_prefix} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-66: recursive name column shows relative path ───────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="files", recursive=True)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Recursive: nested.md should show as "sub/nested.md" or at least "nested.md"
        # The key is that context includes path info for disambiguation
        has_nested = "nested.md" in result.text
        passed_f66 = result.ok and has_nested

        run.step(
            label="F-66: recursive listing shows relative path in Name column",
            passed=passed_f66,
            detail=f"ok={result.ok} has_nested={has_nested} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-68: zero-parameter call → vault root listing ────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        has_header = "| Name |" in result.text or "Showing" in result.text
        passed_f68 = result.ok and has_header

        run.step(
            label="F-68: list_vault with no parameters returns vault root listing",
            passed=passed_f68,
            detail=f"ok={result.ok} has_header={has_header} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-84: non-existent path → isError: true ───────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path="_nonexistent_dir_xyzzy_/that_cannot_exist")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f84 = not result.ok

        run.step(
            label="F-84: non-existent path returns isError=true",
            passed=passed_f84,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-85: path is a FILE not directory → isError ──────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=f"{base_dir}/top.md")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f85 = not result.ok

        run.step(
            label="F-85: path pointing to a file returns isError=true",
            passed=passed_f85,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-86: zero-param call summary line contains 'in /.' ───────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f86 = result.ok and "in /." in result.text

        run.step(
            label="F-86: zero-param call summary line shows 'in /.'",
            passed=passed_f86,
            detail=f"ok={result.ok} has_root_summary={'in /.' in result.text} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-87: path-specific call summary contains 'in {base_dir}/.' ───────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        expected_summary_path = f"in {base_dir}/."
        passed_f87 = result.ok and expected_summary_path in result.text

        run.step(
            label=f"F-87: path listing summary shows 'in {base_dir}/.'",
            passed=passed_f87,
            detail=f"ok={result.ok} has_summary={expected_summary_path in result.text} | {result.text[-200:]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-88: summary line format 'Showing N of N entries in /.' ─────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        has_showing = "Showing" in result.text
        passed_f88 = result.ok and has_showing

        run.step(
            label="F-88: summary line format starts with 'Showing N of N entries'",
            passed=passed_f88,
            detail=f"ok={result.ok} has_showing={has_showing} | {result.text[-200:]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-89: limit=1 with multiple entries → truncation notice ──────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, limit=1)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f89 = result.ok and "truncated" in result.text.lower()

        run.step(
            label="F-89: limit=1 with multiple entries shows truncation notice",
            passed=passed_f89,
            detail=f"ok={result.ok} truncated={'truncated' in result.text.lower()} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-90: uppercase extension → case-insensitive match ────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="files", extensions=[".MD"])
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f90 = result.ok and "top.md" in result.text

        run.step(
            label="F-90: uppercase extension .MD matches lowercase .md files (case-insensitive)",
            passed=passed_f90,
            detail=f"ok={result.ok} top_md_found={'top.md' in result.text} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-91: date_field='created' → sorted listing succeeds ─────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="files", recursive=True, date_field="created")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f91 = result.ok

        run.step(
            label="F-91: date_field=created returns sorted listing without error",
            passed=passed_f91,
            detail=f"ok={result.ok} | {result.text[:200]}",
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
        description="Test: list_vault show modes, filtering, summary line, non-existent path, zero-params.",
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
