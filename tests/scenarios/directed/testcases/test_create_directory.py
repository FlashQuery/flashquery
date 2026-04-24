#!/usr/bin/env python3
"""
Test: create_directory — basic creation, deep hierarchy, idempotency, partial-existing, trailing slash.

Coverage points: F-19, F-20, F-21, F-22, F-29

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_create_directory.py                            # existing server
    python test_create_directory.py --managed                  # managed server
    python test_create_directory.py --managed --json           # structured JSON with server logs
    python test_create_directory.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["F-19", "F-20", "F-21", "F-22", "F-29"]

import argparse
import sys
from pathlib import Path

# Add the framework directory to the path for shared imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_create_directory"


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

        # Pre-create base_dir so that per-step tests measure exactly the new subdirs created
        ctx.vault._abs(base_dir).mkdir(parents=True, exist_ok=True)

        # ── F-19: create_directory creates a single directory ────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("create_directory", paths=f"{base_dir}/inbox")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        dir_exists = ctx.vault._abs(f"{base_dir}/inbox").is_dir()
        # base_dir pre-exists, so only inbox is created → exactly 1 new directory
        passed_f19 = result.ok and dir_exists and "Created 1 directory:" in result.text

        run.step(
            label="F-19: create_directory creates single directory",
            passed=passed_f19,
            detail=f"dir_exists={dir_exists} | ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-20: create_directory creates deep hierarchy (mkdir -p) ────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("create_directory", paths=f"{base_dir}/alpha/beta/gamma")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        alpha_exists = ctx.vault._abs(f"{base_dir}/alpha").is_dir()
        beta_exists = ctx.vault._abs(f"{base_dir}/alpha/beta").is_dir()
        gamma_exists = ctx.vault._abs(f"{base_dir}/alpha/beta/gamma").is_dir()
        dirs_created = alpha_exists and beta_exists and gamma_exists
        passed_f20 = result.ok and dirs_created and "directories:" in result.text

        run.step(
            label="F-20: create_directory creates deep hierarchy (mkdir -p)",
            passed=passed_f20,
            detail=f"alpha={alpha_exists} beta={beta_exists} gamma={gamma_exists} | ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-21: calling create_directory on existing directory is idempotent
        log_mark = ctx.server.log_position if ctx.server else 0
        # Create the dir first
        ctx.client.call_tool("create_directory", paths=f"{base_dir}/dupe")
        # Call again — should succeed with "already exists"
        result = ctx.client.call_tool("create_directory", paths=f"{base_dir}/dupe")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f21 = (
            result.ok
            and "already exists" in result.text
            and "Created 0 directories:" in result.text
        )

        run.step(
            label="F-21: create_directory is idempotent on existing directory",
            passed=passed_f21,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-22: partial-existing hierarchy — only new segments counted ─────
        log_mark = ctx.server.log_position if ctx.server else 0
        # Create partial hierarchy first
        ctx.client.call_tool("create_directory", paths=f"{base_dir}/hier/a/b")
        # Now extend it — a and b already exist, c and d are new
        result = ctx.client.call_tool("create_directory", paths=f"{base_dir}/hier/a/b/c/d")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        c_exists = ctx.vault._abs(f"{base_dir}/hier/a/b/c").is_dir()
        d_exists = ctx.vault._abs(f"{base_dir}/hier/a/b/c/d").is_dir()
        passed_f22 = (
            result.ok
            and c_exists
            and d_exists
            and "already exists" in result.text
            and "created" in result.text
        )

        run.step(
            label="F-22: partial-existing hierarchy — new segments created, existing reported",
            passed=passed_f22,
            detail=f"c_exists={c_exists} d_exists={d_exists} | ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-29: trailing slash in path is normalized (no double-slash artifact)
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("create_directory", paths=f"{base_dir}/withslash/")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        dir_exists = ctx.vault._abs(f"{base_dir}/withslash").is_dir()
        # Response should show the path without double-slash
        no_double_slash = "//" not in result.text
        passed_f29 = result.ok and dir_exists and no_double_slash and "withslash/" in result.text

        run.step(
            label="F-29: trailing slash in path is normalized (no double-slash artifact)",
            passed=passed_f29,
            detail=f"dir_exists={dir_exists} no_double_slash={no_double_slash} | ok={result.ok} | {result.text[:200]}",
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
        description="Test: create_directory basic creation, hierarchy, and idempotency.",
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
