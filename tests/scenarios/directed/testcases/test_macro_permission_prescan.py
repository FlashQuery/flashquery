#!/usr/bin/env python3
"""
Test: Macro permission prescan rejects forbidden FlashQuery tools before dispatch.

Scenario:
    1. Invoke call_macro with a known but host-disallowed write tool and assert
       a forbidden_tools envelope, including forbidden and allowed lists.
    2. Invoke call_macro with multiple forbidden tool references nested in
       branch and loop bodies and assert the prescan reports them together
       before any nested result or side effect can occur.

Coverage points: ML-13, ML-14
Requirements: REQ-028, REQ-029
"""
from __future__ import annotations

COVERAGE = ["ML-13", "ML-14"]

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


TEST_NAME = "test_macro_permission_prescan"


def _payload(result) -> dict:
    try:
        return json.loads(result.text or "{}")
    except json.JSONDecodeError:
        return {}


def _has_items(values: object, expected: list[str]) -> bool:
    return isinstance(values, list) and all(item in values for item in expected)


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
        extra_config={
            "host_mcp_tools": {"tools": ["call_macro", "search"]},
        },
    ) as ctx:
        log_mark = ctx.server.log_position if ctx.server else 0
        single = ctx.client.call_tool(
            "call_macro",
            source='exit fq.archive_document({ identifiers: ["blocked.md"] })',
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        single_payload = _payload(single)
        single_details = single_payload.get("details") or {}
        single_passed = (
            single.ok
            and single_payload.get("error") == "forbidden_tools"
            and _has_items(single_details.get("forbidden"), ["fq.archive_document"])
            and _has_items(single_details.get("allowed"), ["fq.search"])
            and "nested" not in single_payload
        )
        run.step(
            label="ML-13 known host-disallowed write tool is forbidden before dispatch",
            passed=single_passed,
            detail=expectation_detail(single) or single.error or json.dumps(single_payload, sort_keys=True),
            timing_ms=single.timing_ms,
            tool_result=single,
            server_logs=step_logs,
        )

        source = """
if true then
  found = fq.search({ query: "allowed prescan probe" })
  for item in [1] do
    fq.write_document({ mode: "create", path: "blocked-a.md", title: "Blocked A", content: "blocked" })
  done
else
  while false do
    archived = fq.archive_document({ identifiers: ["blocked-b.md"] })
  done
fi
"""
        log_mark = ctx.server.log_position if ctx.server else 0
        nested = ctx.client.call_tool("call_macro", source=source)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        nested_payload = _payload(nested)
        nested_details = nested_payload.get("details") or {}
        nested_passed = (
            nested.ok
            and nested_payload.get("error") == "forbidden_tools"
            and _has_items(nested_details.get("forbidden"), ["fq.write_document", "fq.archive_document"])
            and _has_items(nested_details.get("allowed"), ["fq.search"])
            and "nested" not in nested_payload
        )
        run.step(
            label="ML-14 nested forbidden references are reported together by prescan",
            passed=nested_passed,
            detail=expectation_detail(nested) or nested.error or json.dumps(nested_payload, sort_keys=True),
            timing_ms=nested.timing_ms,
            tool_result=nested,
            server_logs=step_logs,
        )

    return run


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify macro permission prescan forbidden_tools behavior.")
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
