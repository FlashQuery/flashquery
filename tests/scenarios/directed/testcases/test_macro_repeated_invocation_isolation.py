#!/usr/bin/env python3
"""
T-S-015: running the same macro source twice does not leak invocation state.
Coverage: ML-32
"""
from __future__ import annotations

COVERAGE = ["ML-32"]

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import FQCClient  # noqa: E402
from fqc_test_utils import TestContext, TestRun  # noqa: E402

TEST_NAME = "test_macro_repeated_invocation_isolation"


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    source = "counter = 0\ncounter = add $counter 1\nexit $counter"

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:
        client: FQCClient = ctx.client
        first = client.call_tool("call_macro", source=source)
        second = client.call_tool("call_macro", source=source)
        first_payload = json.loads(first.text) if first.text else {"error": first.error}
        second_payload = json.loads(second.text) if second.text else {"error": second.error}
        run.step(
            label="ML-32 / T-S-015 repeated public invocations start with isolated scope",
            passed=first_payload.get("result") == 1 and second_payload.get("result") == 1,
            detail=json.dumps({"first": first_payload, "second": second_payload}, sort_keys=True)[:1000],
            timing_ms=first.timing_ms + second.timing_ms,
            tool_result=second,
        )
        run.step(
            label="ML-32 / T-S-015 repeated invocations receive distinct task IDs",
            passed=(
                isinstance(first_payload.get("task_id"), str)
                and isinstance(second_payload.get("task_id"), str)
                and first_payload.get("task_id") != second_payload.get("task_id")
            ),
            detail=json.dumps({"first": first_payload, "second": second_payload}, sort_keys=True)[:1000],
        )

    return run


def main() -> int:
    parser = argparse.ArgumentParser(description=TEST_NAME)
    parser.add_argument("--fqc-dir", default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--url", default=None)
    parser.add_argument("--secret", default=None)
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"), default=None)
    parser.add_argument("--json", action="store_true", dest="output_json")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--vault-path", default=None)
    args = parser.parse_args()
    run = run_test(args)
    if args.output_json:
        print(run.to_json())
    else:
        for line in run.summary_lines():
            print(line, file=sys.stderr)
    return run.exit_code


if __name__ == "__main__":
    sys.exit(main())
