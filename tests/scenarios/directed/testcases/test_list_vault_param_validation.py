#!/usr/bin/env python3
"""
Test: list_vault — parameter validation tests: invalid date, bad show enum, path not found.

Coverage points: F-92, F-93, F-94, F-95

Modes:
    Default     Connects to an already-running FQC instance
    --managed   Starts a dedicated FQC subprocess

Usage:
    python test_list_vault_param_validation.py
    python test_list_vault_param_validation.py --managed
    python test_list_vault_param_validation.py --managed --json
    python test_list_vault_param_validation.py --managed --json --keep

Exit codes:
    0   PASS
    2   FAIL
    3   DIRTY
"""
from __future__ import annotations

COVERAGE = ["F-92", "F-93", "F-94", "F-95"]

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestContext, TestRun, expectation_detail

TEST_NAME = "test_list_vault_param_validation"


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

        # Create base_dir so F-95 can test with an existing dir
        ctx.client.call_tool("create_directory", paths=base_dir)

        # ── F-92: invalid 'after' date string → isError + message ─────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", after="not-a-date")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f92 = (
            not result.ok
            and "Invalid date format" in result.text
            and "YYYY-MM-DD" in result.text
        )

        run.step(
            label="F-92: invalid 'after' value returns isError with date format hint",
            passed=passed_f92,
            detail=f"ok={result.ok} has_invalid_msg={'Invalid date format' in result.text} has_yyyy={'YYYY-MM-DD' in result.text} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-93: invalid 'before' date string → isError + message ────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", before="also-bad")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f93 = not result.ok and "Invalid date format" in result.text

        run.step(
            label="F-93: invalid 'before' value returns isError with date format hint",
            passed=passed_f93,
            detail=f"ok={result.ok} has_invalid_msg={'Invalid date format' in result.text} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-94: non-existent path → isError ────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path="_definitely_nonexistent_xyzzy_path_")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        not_found_msg = (
            "not found" in result.text.lower()
            or "path not found" in result.text.lower()
            or "does not exist" in result.text.lower()
        )
        passed_f94 = not result.ok and not_found_msg

        run.step(
            label="F-94: non-existent path returns isError with 'not found' message",
            passed=passed_f94,
            detail=f"ok={result.ok} not_found_msg={not_found_msg} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-95: recursive=True with existing dir → ok ───────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, recursive=True)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f95 = result.ok

        run.step(
            label="F-95: recursive=True with existing directory returns ok",
            passed=passed_f95,
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
        description="Test: list_vault parameter validation — invalid date, bad path.",
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
