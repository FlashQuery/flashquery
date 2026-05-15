#!/usr/bin/env python3
"""
T-S-016: public call_macro trace modes full, summary, and none.
Coverage: ML-18
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_client import FQCClient  # noqa: E402
from fqc_test_utils import TestContext, TestRun  # noqa: E402

TEST_NAME = "test_macro_trace_full_summary_none"
COVERAGE = ["ML-18"]


def _payload(client: FQCClient, trace: str) -> dict:
    result = client.call_tool("call_macro", source='echo "visible"\nexit "done"', trace=trace)
    if not result.ok:
        return {"error": result.error, "text": result.text}
    return json.loads(result.text)


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=args.vault_path,
        managed=args.managed,
        port_range=port_range,
    ) as ctx:
        client: FQCClient = ctx.client
        full = _payload(client, "full")
        summary = _payload(client, "summary")
        none = _payload(client, "none")
        full_trace = full.get("trace") or []
        summary_trace = summary.get("trace") or []
        run.step(
            label="ML-18 / T-S-016 full trace includes result values",
            passed=bool(full_trace and full_trace[-1].get("result") == "done"),
            detail=json.dumps(full, sort_keys=True)[:1000],
        )
        run.step(
            label="ML-18 / T-S-016 summary trace omits result values",
            passed=bool(summary_trace and "result" not in summary_trace[-1]),
            detail=json.dumps(summary, sort_keys=True)[:1000],
        )
        run.step(
            label="ML-18 / T-S-016 none omits trace field",
            passed="trace" not in none,
            detail=json.dumps(none, sort_keys=True)[:1000],
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
