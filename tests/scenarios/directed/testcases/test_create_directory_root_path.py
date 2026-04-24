#!/usr/bin/env python3
"""
Test: create_directory — root_path parameter (relative base prefix, slash equivalence, nested prefix).

Coverage points: F-26, F-27, F-28

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_create_directory_root_path.py                            # existing server
    python test_create_directory_root_path.py --managed                  # managed server
    python test_create_directory_root_path.py --managed --json           # structured JSON with server logs
    python test_create_directory_root_path.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["F-26", "F-27", "F-28"]

import argparse
import sys
from pathlib import Path

# Add the framework directory to the path for shared imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_create_directory_root_path"


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

        # ── F-26: root_path + child paths ────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        crm_root = f"{base_dir}/CRM"
        result = ctx.client.call_tool(
            "create_directory",
            paths=["Contacts", "Companies"],
            root_path=crm_root,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        contacts_exists = ctx.vault._abs(f"{crm_root}/Contacts").is_dir()
        companies_exists = ctx.vault._abs(f"{crm_root}/Companies").is_dir()
        root_line_present = f"Root: {crm_root}/" in result.text
        passed_f26 = (
            result.ok
            and contacts_exists
            and companies_exists
            and root_line_present
        )

        run.step(
            label="F-26: root_path prefixes child paths; Root: line in response",
            passed=passed_f26,
            detail=f"contacts={contacts_exists} companies={companies_exists} root_line={root_line_present} | ok={result.ok} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-27: root_path='/' behaves same as no root_path (no Root: line) ─
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool(
            "create_directory",
            paths=f"{base_dir}/solo",
            root_path="/",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        solo_exists = ctx.vault._abs(f"{base_dir}/solo").is_dir()
        no_root_line = "Root:" not in result.text
        passed_f27 = result.ok and solo_exists and no_root_line

        run.step(
            label="F-27: root_path='/' is equivalent to no root_path (no Root: line)",
            passed=passed_f27,
            detail=f"solo={solo_exists} no_root_line={no_root_line} | ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-28: nested root_path prefix ────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        deep_root = f"{base_dir}/deep"
        result = ctx.client.call_tool(
            "create_directory",
            paths="sub/leaf",
            root_path=deep_root,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        leaf_exists = ctx.vault._abs(f"{deep_root}/sub/leaf").is_dir()
        root_line_present = f"Root: {deep_root}/" in result.text
        passed_f28 = result.ok and leaf_exists and root_line_present

        run.step(
            label="F-28: nested root_path + child creates full hierarchy under root",
            passed=passed_f28,
            detail=f"leaf={leaf_exists} root_line={root_line_present} | ok={result.ok} | {result.text[:200]}",
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
        description="Test: create_directory root_path parameter (prefix, slash, nested).",
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
