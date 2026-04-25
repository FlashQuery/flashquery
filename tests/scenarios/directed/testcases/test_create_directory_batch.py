#!/usr/bin/env python3
"""
Test: create_directory — batch operations (batch all-new, size limit, partial success, all-fail).

Coverage points: F-23, F-24, F-25, F-45

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_create_directory_batch.py                            # existing server
    python test_create_directory_batch.py --managed                  # managed server
    python test_create_directory_batch.py --managed --json           # structured JSON with server logs
    python test_create_directory_batch.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["F-23", "F-24", "F-25", "F-45"]

import argparse
import sys
from pathlib import Path

# Add the framework directory to the path for shared imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_create_directory_batch"


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

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

        # ── F-23: batch all-new — multiple paths created in one call ─────────
        log_mark = ctx.server.log_position if ctx.server else 0
        batch_paths = [f"{base_dir}/batch_a", f"{base_dir}/batch_b", f"{base_dir}/batch_c/sub"]
        result = ctx.client.call_tool("create_directory", paths=batch_paths)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        batch_a_exists = ctx.vault._abs(f"{base_dir}/batch_a").is_dir()
        batch_b_exists = ctx.vault._abs(f"{base_dir}/batch_b").is_dir()
        batch_c_exists = ctx.vault._abs(f"{base_dir}/batch_c").is_dir()
        batch_c_sub_exists = ctx.vault._abs(f"{base_dir}/batch_c/sub").is_dir()
        all_batch_exist = batch_a_exists and batch_b_exists and batch_c_exists and batch_c_sub_exists
        passed_f23 = (
            result.ok
            and all_batch_exist
            and "directories:" in result.text
        )

        run.step(
            label="F-23: batch all-new — multiple paths created in one call",
            passed=passed_f23,
            detail=(
                f"ok={result.ok} batch_a={batch_a_exists} batch_b={batch_b_exists} "
                f"batch_c={batch_c_exists} batch_c/sub={batch_c_sub_exists} | {result.text[:200]}"
            ),
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-45: 51-path batch is rejected immediately before any paths are processed ──
        log_mark = ctx.server.log_position if ctx.server else 0
        paths_51 = [f"{base_dir}/p{i}" for i in range(51)]
        result = ctx.client.call_tool("create_directory", paths=paths_51)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # None of the 51 dirs should have been created
        none_created = not any(ctx.vault._abs(p).exists() for p in paths_51)
        passed_f45 = (
            not result.ok
            and "Too many paths: 51 provided, maximum is 50." in result.text
            and none_created
        )

        run.step(
            label="F-45: 51-path batch is rejected immediately before any paths are processed",
            passed=passed_f45,
            detail=f"ok={result.ok} none_created={none_created} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-24: mixed valid/invalid batch returns partial success ──────────
        log_mark = ctx.server.log_position if ctx.server else 0
        mixed_paths = [f"{base_dir}/good1", "../../escape", f"{base_dir}/good2"]
        result = ctx.client.call_tool("create_directory", paths=mixed_paths)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        good1_exists = ctx.vault._abs(f"{base_dir}/good1").is_dir()
        good2_exists = ctx.vault._abs(f"{base_dir}/good2").is_dir()
        # isError must be false (partial success — D-04); Failed block must be present
        passed_f24 = (
            result.ok  # isError=false → result.ok=True
            and good1_exists
            and good2_exists
            and "Failed (1 path):" in result.text
            and "../../escape" in result.text
        )

        run.step(
            label="F-24: mixed batch returns partial success (isError=false, failed block present)",
            passed=passed_f24,
            detail=f"ok={result.ok} good1={good1_exists} good2={good2_exists} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-25: all paths fail → isError: true ─────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        all_fail_paths = ["../../etc", "../../tmp", "../../var"]
        result = ctx.client.call_tool("create_directory", paths=all_fail_paths)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f25 = (
            not result.ok
            and "All paths failed:" in result.text
        )

        run.step(
            label="F-25: all paths fail (traversal) → isError: true, All paths failed: header",
            passed=passed_f25,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── Optionally retain files for debugging ─────────────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Files retained under: {ctx.vault.vault_root / '_test'}",
            )

        # ── Attach full server logs to the run ────────────────────────────────
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
        description="Test: create_directory batch operations (size limit, partial success).",
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
    parser.add_argument("--vault-path", type=str, default=None, dest="vault_path",
                        help="Override vault path for managed server.")

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
