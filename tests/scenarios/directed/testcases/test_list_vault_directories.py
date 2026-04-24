#!/usr/bin/env python3
"""
Test: list_vault — directory-specific tests: dot-dir filtering, depth sort, limit behavior.

Coverage points: F-55, F-56, F-57, F-58, F-62, F-63, F-64, F-67

Modes:
    Default     Connects to an already-running FQC instance
    --managed   Starts a dedicated FQC subprocess

Usage:
    python test_list_vault_directories.py
    python test_list_vault_directories.py --managed
    python test_list_vault_directories.py --managed --json
    python test_list_vault_directories.py --managed --json --keep

Exit codes:
    0   PASS
    2   FAIL
    3   DIRTY
"""
from __future__ import annotations

COVERAGE = ["F-55", "F-56", "F-57", "F-58", "F-62", "F-63", "F-64", "F-67"]

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestContext, TestRun, expectation_detail

TEST_NAME = "test_list_vault_directories"


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
        # Create: base_dir/alpha/, base_dir/beta/, base_dir/alpha/child/
        ctx.client.call_tool("create_directory", paths=f"{base_dir}/alpha/child")
        ctx.client.call_tool("create_directory", paths=f"{base_dir}/beta")

        # Create dot-prefixed directory directly (create_directory also creates it)
        ctx.client.call_tool("create_directory", paths=f"{base_dir}/.hidden")

        # ── F-55: show='directories' → only directories, no files ────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="directories")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f55 = result.ok and "alpha/" in result.text

        run.step(
            label="F-55: show=directories returns only directory entries",
            passed=passed_f55,
            detail=f"ok={result.ok} alpha_present={'alpha/' in result.text} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-56: recursive=True → child/ appears in listing ─────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="directories", recursive=True)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f56 = result.ok and "child/" in result.text

        run.step(
            label="F-56: show=directories recursive=True includes nested subdirectories",
            passed=passed_f56,
            detail=f"ok={result.ok} child_present={'child/' in result.text} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-57: sort order — alpha/ before beta/ (alphabetical at same depth) ─
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="directories")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        alpha_pos = result.text.find("alpha/")
        beta_pos = result.text.find("beta/")
        passed_f57 = result.ok and alpha_pos != -1 and beta_pos != -1 and alpha_pos < beta_pos

        run.step(
            label="F-57: directories sorted alphabetically at same depth (alpha/ before beta/)",
            passed=passed_f57,
            detail=f"ok={result.ok} alpha_pos={alpha_pos} beta_pos={beta_pos} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-58: .hidden/ is NOT in response text ────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="directories")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        hidden_absent = ".hidden" not in result.text
        passed_f58 = result.ok and hidden_absent

        run.step(
            label="F-58: dot-prefixed directory .hidden/ is not visible in listing",
            passed=passed_f58,
            detail=f"ok={result.ok} hidden_absent={hidden_absent} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-62: directory Size column shows 'items' ─────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="directories")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f62 = result.ok and "items" in result.text

        run.step(
            label="F-62: directory Size column shows 'N items' not byte count",
            passed=passed_f62,
            detail=f"ok={result.ok} has_items={'items' in result.text} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-63: format='detailed' → 'Type: directory' present ──────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="directories", format="detailed")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f63 = result.ok and "Type: directory" in result.text

        run.step(
            label="F-63: format=detailed directory entry has 'Type: directory' field",
            passed=passed_f63,
            detail=f"ok={result.ok} has_type={'Type: directory' in result.text} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-64: limit=1 with 2+ dirs → truncation notice ───────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="directories", limit=1)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f64 = result.ok and "truncated" in result.text.lower()

        run.step(
            label="F-64: limit=1 with multiple directories shows truncation notice",
            passed=passed_f64,
            detail=f"ok={result.ok} truncated={'truncated' in result.text.lower()} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-67: extensions filter with show='directories' → not an error ────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="directories", extensions=[".md"])
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f67 = result.ok  # No isError — extensions silently ignored for directories

        run.step(
            label="F-67: extensions filter with show=directories is silently ignored (not an error)",
            passed=passed_f67,
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
        description="Test: list_vault directory-specific tests.",
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
