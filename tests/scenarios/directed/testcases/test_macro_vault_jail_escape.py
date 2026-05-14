#!/usr/bin/env python3
"""
Test: Macro shell vault jail rejects escaping paths.

Scenario:
    1. Invoke call_macro with a read-only shell verb targeting ../etc/passwd.
    2. Assert the public MCP envelope is forbidden_path with isError=false.

Coverage points: ML-09
"""
from __future__ import annotations

COVERAGE = ["ML-09"]

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


TEST_NAME = "test_macro_vault_jail_escape"


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
        result = ctx.client.call_tool("call_macro", source='exit cat "../etc/passwd"')
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        result.expect_json_equals("error", "forbidden_path")
        result.expect_json_equals("message", "macro shell verbs cannot reach outside the vault root")
        result.expect_json_equals("details.reason", "resolves_outside_vault")
        result.expect_json_equals("details.path", "../etc/passwd")

        run.step(
            label="call_macro returns forbidden_path for a vault-jail escape",
            passed=(result.ok and result.status == "pass"),
            detail=expectation_detail(result) or result.error or "",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

    return run


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify macro shell vault-jail escape rejection.")
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
