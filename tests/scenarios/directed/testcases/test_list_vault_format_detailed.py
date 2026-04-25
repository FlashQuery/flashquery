#!/usr/bin/env python3
"""
Test: list_vault — detailed format tests: tracked/untracked field order, DB metadata.

Coverage points: F-76, F-77, F-78, F-79, F-83

Modes:
    Default     Connects to an already-running FQC instance
    --managed   Starts a dedicated FQC subprocess

Usage:
    python test_list_vault_format_detailed.py
    python test_list_vault_format_detailed.py --managed
    python test_list_vault_format_detailed.py --managed --json
    python test_list_vault_format_detailed.py --managed --json --keep

Exit codes:
    0   PASS
    2   FAIL
    3   DIRTY
"""
from __future__ import annotations

COVERAGE = ["F-76", "F-77", "F-78", "F-79", "F-83"]

import argparse
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestContext, TestRun, expectation_detail

TEST_NAME = "test_list_vault_format_detailed"


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

        # ── Setup: create tracked document and a subdirectory ─────────────────
        ctx.client.call_tool("create_directory", paths=f"{base_dir}/subdir")

        tracked_result = ctx.client.call_tool(
            "create_document",
            title=f"Tracked Doc {run.run_id}",
            content="Tracked document content.",
            path=f"{base_dir}/tracked.md",
            tags=["fqc-test", run.run_id],
        )

        m = re.search(r"FQC ID:\s*(\S+)", tracked_result.text)
        if m:
            ctx.cleanup.track_mcp_document(m.group(1).strip())

        # Create an untracked file directly for F-77
        t0 = time.monotonic()
        untracked_abs = ctx.vault._abs(f"{base_dir}/untracked.md")
        untracked_abs.parent.mkdir(parents=True, exist_ok=True)
        untracked_abs.write_text(f"# Untracked\n\nNot in DB for {run.run_id}.\n")
        ctx.cleanup.track_file(f"{base_dir}/untracked.md")
        run.step(
            label="Setup: write untracked.md directly to vault",
            passed=untracked_abs.is_file(),
            detail=f"path={base_dir}/untracked.md",
            timing_ms=int((time.monotonic() - t0) * 1000),
        )

        # ── F-76: tracked file detailed block has expected fields ─────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="files", format="detailed")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        has_title = "Title:" in result.text
        has_path = "Path:" in result.text
        has_fqc_id = "fqc_id:" in result.text or "fq_id:" in result.text
        passed_f76 = result.ok and has_title and has_path and has_fqc_id

        run.step(
            label="F-76: tracked file detailed block has Title:, Path:, fqc_id: fields",
            passed=passed_f76,
            detail=f"ok={result.ok} has_title={has_title} has_path={has_path} has_fqc_id={has_fqc_id} | {result.text[:400]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-77: untracked file detailed block shows Tracked: false ─────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="files", format="detailed")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        has_tracked_false = "Tracked: false" in result.text
        passed_f77 = result.ok and has_tracked_false

        run.step(
            label="F-77: untracked file detailed block shows 'Tracked: false'",
            passed=passed_f77,
            detail=f"ok={result.ok} has_tracked_false={has_tracked_false} | {result.text[:400]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-78: directory detailed block shows 'Type: directory' ───────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="directories", format="detailed")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f78 = result.ok and "Type: directory" in result.text

        run.step(
            label="F-78: directory detailed block contains 'Type: directory'",
            passed=passed_f78,
            detail=f"ok={result.ok} has_type={'Type: directory' in result.text} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-79: multiple entries are separated by '---' ────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, format="detailed")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f79 = result.ok and "---" in result.text

        run.step(
            label="F-79: detailed format entries are separated by '---' delimiter",
            passed=passed_f79,
            detail=f"ok={result.ok} has_separator={'---' in result.text} | {result.text[:400]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-83: detailed format has summary line ────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, format="detailed")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f83 = result.ok and "Showing" in result.text

        run.step(
            label="F-83: detailed format has 'Showing N of N entries' summary line",
            passed=passed_f83,
            detail=f"ok={result.ok} has_showing={'Showing' in result.text} | {result.text[-200:]}",
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
        description="Test: list_vault detailed format tracked/untracked field order and DB metadata.",
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
