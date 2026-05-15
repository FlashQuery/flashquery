#!/usr/bin/env python3
"""
Test: Public call_macro does not accept caller identity spoofing.

Scenario:
    1. Fetch tools/list and assert call_macro's advertised input schema has no
       callerKind property.
    2. Invoke public call_macro with a callerKind field anyway and assert it is
       ignored: execution uses host tool exposure, succeeds with fq.search, and
       the response does not echo callerKind.

Coverage points: ML-17
Requirements: MACRO-DISP-07
"""
from __future__ import annotations

COVERAGE = ["ML-17"]

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


TEST_NAME = "test_macro_caller_identity"


def _payload(result) -> dict:
    try:
        return json.loads(result.text or "{}")
    except json.JSONDecodeError:
        return {}


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
            "llm": {
                "providers": [],
                "models": [],
                "purposes": [
                    {
                        "name": "research",
                        "description": "Purpose with no native search allowance",
                        "models": [],
                        "tools": [],
                    }
                ],
            },
        },
    ) as ctx:
        if not ctx.client.session_id:
            ctx.client.initialize()
        list_tools_raw = ctx.client._post_mcp({
            "jsonrpc": "2.0",
            "id": "tools-list",
            "method": "tools/list",
            "params": {},
        })
        tools = ((list_tools_raw.get("result") or {}).get("tools") or [])
        call_macro = next((tool for tool in tools if tool.get("name") == "call_macro"), {})
        properties = ((call_macro.get("inputSchema") or {}).get("properties") or {})
        schema_passed = "callerKind" not in properties
        run.step(
            label="ML-17 call_macro tools/list schema omits callerKind",
            passed=schema_passed,
            detail=json.dumps({"call_macro_properties": sorted(properties.keys())}, sort_keys=True),
            timing_ms=0,
        )

        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool(
            "call_macro",
            source='exit fq.search({ query: "caller identity", mode: "filesystem", entity_types: ["documents"], limit: 1 })',
            callerKind="delegated",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        payload = _payload(result)
        execution_passed = (
            result.ok
            and payload.get("error") is None
            and "result" in payload
            and "callerKind" not in (result.text or "")
        )
        run.step(
            label="ML-17 supplied callerKind is ignored and host allowlist executes fq.search",
            passed=execution_passed,
            detail=expectation_detail(result) or result.error or json.dumps(payload, sort_keys=True),
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

    return run


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify public call_macro caller identity behavior.")
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
