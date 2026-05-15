#!/usr/bin/env python3
"""
T-S-017: public call_macro progress milestones honor progressToken and suppress iteration chatter.
Coverage: ML-19
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_client import FQCClient  # noqa: E402
from fqc_test_utils import TestContext, TestRun  # noqa: E402

TEST_NAME = "test_macro_progress_milestones"
COVERAGE = ["ML-19"]


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    token = "phase-137-progress-token"
    source = '''
      for item in [1,2] do
        echo $item
      done
      exit fq.call_model({ resolver: "list_models" })
    '''
    port_range = tuple(args.port_range) if args.port_range else None
    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
        extra_config={
            "host_mcp_tools": {"tools": ["call_macro", "call_model"]},
            "llm": {"providers": [], "models": [], "purposes": []},
        },
    ) as ctx:
        client: FQCClient = ctx.client
        result, notifications = client.call_tool_with_progress(
            "call_macro",
            {"source": source, "progress": "milestones"},
            progress_token=token,
        )
        payload = json.loads(result.text) if result.ok else {"error": result.error}
        messages = [item.get("params", {}).get("message", "") for item in notifications]
        run.step(
            label="ML-19 / T-S-017 captured notifications/progress entries carry requested progressToken",
            passed=result.ok and bool(notifications) and all(item.get("params", {}).get("progressToken") == token for item in notifications),
            detail=json.dumps(notifications, sort_keys=True)[:1000],
            timing_ms=result.timing_ms,
            tool_result=result,
        )
        run.step(
            label="ML-19 / T-S-017 milestones includes model-call boundary and excludes per-iteration progress",
            passed=(
                any(msg.startswith("model_call:") and msg.endswith("fq.call_model") for msg in messages)
                and not any(msg.startswith("for ") for msg in messages)
            ),
            detail=json.dumps({"messages": messages, "payload": payload}, sort_keys=True)[:1000],
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
