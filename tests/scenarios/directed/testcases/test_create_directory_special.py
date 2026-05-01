#!/usr/bin/env python3
"""
Test: create_directory — special cases (dot-prefixed directory creation, F-51 list_vault integration, F-52 deferred).

Coverage points: F-50, F-51

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_create_directory_special.py                            # existing server
    python test_create_directory_special.py --managed                  # managed server
    python test_create_directory_special.py --managed --json           # structured JSON with server logs
    python test_create_directory_special.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["F-50", "F-51"]

import argparse
import sys
from pathlib import Path

# Add the framework directory to the path for shared imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_create_directory_special"


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

        # ── F-50: dot-prefixed directory IS created ───────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("create_directory", paths=f"{base_dir}/.plugin-staging/temp")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        staging_exists = ctx.vault._abs(f"{base_dir}/.plugin-staging").is_dir()
        temp_exists = ctx.vault._abs(f"{base_dir}/.plugin-staging/temp").is_dir()
        passed_f50 = (
            result.ok
            and staging_exists
            and temp_exists
            and ".plugin-staging/" in result.text
        )

        run.step(
            label="F-50: dot-prefixed directory (.plugin-staging) is created successfully",
            passed=passed_f50,
            detail=f"staging={staging_exists} temp={temp_exists} | ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-51: dot-prefixed directory invisible to list_vault ─────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", show="directories", path=base_dir)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        hidden_visible = ".plugin-staging/" in result.text
        passed_f51 = result.ok and not hidden_visible

        run.step(
            label="F-51: dot-prefixed directory invisible to list_vault",
            passed=passed_f51,
            detail=f"ok={result.ok} hidden_visible={hidden_visible} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-52: shutdown check — deferred to unit test ─────────────────────
        # Cannot simulate in-process shutdown state from a subprocess-based directed
        # test. Covered by tests/unit/files-tools.test.ts instead.
        run.step(
            label="F-52: shutdown check — DEFERRED (cannot mock in-process state from subprocess)",
            passed=True,
            detail="Not a coverage claim. See tests/unit/files-tools.test.ts for this behavior.",
            timing_ms=0,
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
        description="Test: create_directory special cases (dot-prefix, F-51 deferred, F-52 deferred).",
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
