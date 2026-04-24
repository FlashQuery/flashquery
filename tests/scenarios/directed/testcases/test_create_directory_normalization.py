#!/usr/bin/env python3
"""
Test: create_directory — path normalization (duplicate slashes, dot collapse, URL-encoded pass-through).

Coverage points: F-30, F-31, F-32

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_create_directory_normalization.py                            # existing server
    python test_create_directory_normalization.py --managed                  # managed server
    python test_create_directory_normalization.py --managed --json           # structured JSON with server logs
    python test_create_directory_normalization.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["F-30", "F-31", "F-32"]

import argparse
import sys
from pathlib import Path

# Add the framework directory to the path for shared imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_create_directory_normalization"


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

        # ── F-30: duplicate slashes are collapsed ─────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("create_directory", paths=f"{base_dir}//double//slash")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Expect the normalized dir to exist (no double-slash in actual path)
        dir_exists = ctx.vault._abs(f"{base_dir}/double/slash").is_dir()
        no_double_slash_response = "//" not in result.text
        passed_f30 = result.ok and dir_exists and no_double_slash_response

        run.step(
            label="F-30: duplicate slashes in path are collapsed",
            passed=passed_f30,
            detail=f"dir_exists={dir_exists} no_double={no_double_slash_response} | ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-31: dot segments (./here) are collapsed ─────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("create_directory", paths=f"{base_dir}/./here")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        dir_exists = ctx.vault._abs(f"{base_dir}/here").is_dir()
        no_dot_in_response = "/./here" not in result.text
        passed_f31 = result.ok and dir_exists and no_dot_in_response

        run.step(
            label="F-31: dot segment (./here) is collapsed to 'here'",
            passed=passed_f31,
            detail=f"dir_exists={dir_exists} no_dot={no_dot_in_response} | ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-32: URL-encoded chars are NOT decoded (passed through as-is) ────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("create_directory", paths=f"{base_dir}/has%20space")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # The literal directory name must be 'has%20space' NOT 'has space'
        encoded_dir_exists = ctx.vault._abs(f"{base_dir}/has%20space").is_dir()
        decoded_dir_absent = not ctx.vault._abs(f"{base_dir}/has space").exists()
        passed_f32 = result.ok and encoded_dir_exists and decoded_dir_absent

        run.step(
            label="F-32: URL-encoded chars (%20) are NOT decoded — passed through as-is",
            passed=passed_f32,
            detail=f"encoded_exists={encoded_dir_exists} decoded_absent={decoded_dir_absent} | ok={result.ok} | {result.text[:200]}",
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
        description="Test: create_directory path normalization (slashes, dots, URL-encoding).",
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
