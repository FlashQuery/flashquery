#!/usr/bin/env python3
"""
Test: Macro shell forbidden mutation flags are rejected before execution.

Scenario:
    1. Invoke call_macro with find -exec (REQ-068: sed -i is now allowed as a
       vault-jailed mutation; find -exec / find -delete remain forbidden).
    2. Assert the public MCP envelope is forbidden_shell_flag with isError=false.

Coverage points: ML-10
"""
from __future__ import annotations

COVERAGE = ["ML-10"]

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


TEST_NAME = "test_macro_forbidden_shell_flag"


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
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool(
            "call_macro",
            source='find "/vault" -name "*.md" -delete',
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        result.expect_json_equals("error", "forbidden_shell_flag")
        result.expect_json_equals("message", "Macro shell flag is forbidden.")
        result.expect_json_equals("details.verb", "find")
        result.expect_json_equals("details.flag", "-delete")
        result.expect_json_equals("details.reason", "find_delete_mutates_files")

        run.step(
            label="call_macro returns forbidden_shell_flag for find -delete",
            passed=(result.ok and result.status == "pass"),
            detail=expectation_detail(result) or result.error or "",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

    return run


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify macro shell forbidden flag rejection.")
    parser.add_argument("--fqc-dir", type=str, default=None)
    parser.add_argument("--url", type=str, default=None)
    parser.add_argument("--secret", type=str, default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"), default=None)
    parser.add_argument("--json", action="store_true", dest="output_json")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--vault-path", type=str, default=None)
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
