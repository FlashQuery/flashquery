#!/usr/bin/env python3
"""
Test: list_vault — Zod schema validation rejects invalid parameter types and values.

Scenario:
    1. F-92: list_vault with extensions="md" (string, not array) — rejected
    2. F-93: list_vault with limit=0 (must be positive integer) — rejected
    3. F-94: list_vault with limit=-5 (must be positive integer) — rejected
    4. F-95: list_vault with date_field="modified" (not "updated" or "created") — rejected
    No filesystem setup required. Cleanup is automatic.

Coverage points: F-92, F-93, F-94, F-95

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_list_vault_param_validation.py                            # existing server
    python test_list_vault_param_validation.py --managed                  # managed server
    python test_list_vault_param_validation.py --managed --json           # structured JSON with server logs
    python test_list_vault_param_validation.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
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
    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:

        # ── F-92: extensions as bare string (not array) → rejected ────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path="/", extensions="md")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        has_validation_error = any(
            kw in result.text.lower() for kw in ["invalid", "expected", "must be", "enum"]
        )
        passed_f92 = not result.ok and has_validation_error

        run.step(
            label="F-92: extensions='md' (string not array) rejected with validation error",
            passed=passed_f92,
            detail=f"ok={result.ok} has_validation_error={has_validation_error} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-93: limit=0 → rejected (must be positive integer) ──────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path="/", limit=0)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        has_validation_error = any(
            kw in result.text.lower() for kw in ["invalid", "expected", "must be", "enum"]
        )
        passed_f93 = not result.ok and has_validation_error

        run.step(
            label="F-93: limit=0 rejected with validation error (must be positive integer)",
            passed=passed_f93,
            detail=f"ok={result.ok} has_validation_error={has_validation_error} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-94: limit=-5 → rejected (must be positive integer) ─────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path="/", limit=-5)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        has_validation_error = any(
            kw in result.text.lower() for kw in ["invalid", "expected", "must be", "enum"]
        )
        passed_f94 = not result.ok and has_validation_error

        run.step(
            label="F-94: limit=-5 rejected with validation error (must be positive integer)",
            passed=passed_f94,
            detail=f"ok={result.ok} has_validation_error={has_validation_error} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-95: date_field="modified" → rejected (not "updated" or "created")
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path="/", date_field="modified")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        has_validation_error = any(
            kw in result.text.lower() for kw in ["invalid", "expected", "must be", "enum"]
        )
        passed_f95 = not result.ok and has_validation_error

        run.step(
            label="F-95: date_field='modified' rejected (must be 'updated' or 'created')",
            passed=passed_f95,
            detail=f"ok={result.ok} has_validation_error={has_validation_error} | {result.text[:300]}",
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
        description="Test: list_vault — Zod schema rejects invalid extensions, limit, and date_field values.",
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
