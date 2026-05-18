#!/usr/bin/env python3
"""
Phase A MCP Broker: macro success, fail-fast isError handling, and reverse-request audit posture.
Coverage: MCB-01, MCB-02, MCB-18
"""
from __future__ import annotations

COVERAGE = ["MCB-01", "MCB-02", "MCB-18"]

import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import FQCClient  # noqa: E402
from fqc_test_utils import TestContext, TestRun  # noqa: E402

TEST_NAME = "test_mcp_broker_phase_a"


def _project_root(args: argparse.Namespace) -> Path:
    if args.fqc_dir:
        return Path(args.fqc_dir).resolve()
    return Path(__file__).resolve().parents[4]


def _broker_config(args: argparse.Namespace) -> dict:
    root = _project_root(args)
    node = shutil.which("node") or "node"
    fixture_dir = root / "tests" / "fixtures" / "mcp-servers"
    return {
        "host_mcp_tools": {"tools": ["call_macro"]},
        "mcp_servers": {
            "basic": {
                "transport": "stdio",
                "command": node,
                "args": ["--import", "tsx", str(fixture_dir / "server-basic.ts")],
                "cost_per_call": 0.125,
                "per_call_timeout_ms": 30000,
                "tool_overrides": {
                    "echo": {"cost_per_call": 0.25},
                },
            },
            "quirky": {
                "transport": "stdio",
                "command": node,
                "args": ["--import", "tsx", str(fixture_dir / "server-quirky.ts")],
                "cost_per_call": 0,
                "per_call_timeout_ms": 30000,
            },
        },
        "host": {"mcp_servers": ["basic", "quirky"], "tool_search": "disabled"},
    }


def _json_payload(result) -> dict:
    try:
        parsed = json.loads(result.text) if result.text else {}
    except json.JSONDecodeError:
        return {"raw_text": result.text, "error": result.error}
    return parsed if isinstance(parsed, dict) else {"payload": parsed}


def _log_contains_rejection(logs: list[str], *, server: str, method: str) -> bool:
    return any(
        "mcp_broker_reverse_request_rejected" in line
        and f"server={server}" in line
        and f"method={method}" in line
        and "status=rejected_unsupported" in line
        for line in logs
    )


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    secret_prompt = f"secret-reverse-prompt-{run.run_id}"

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        extra_config=_broker_config(args),
    ) as ctx:
        client: FQCClient = ctx.client

        success = client.call_tool(
            "call_macro",
            source='''
              echoed = basic.echo({ value: { phrase: "broker-success", count: 1 } })
              exit $echoed
            ''',
        )
        success_payload = _json_payload(success)
        success_result = success_payload.get("result") if isinstance(success_payload, dict) else None
        run.step(
            label="MCB-01 / T-S-001 macro calls brokered basic.echo and returns coerced JSON",
            passed=(
                success.ok
                and isinstance(success_result, dict)
                and success_result.get("value") == {"phrase": "broker-success", "count": 1}
                and success_payload.get("external_tool_calls") == 1
            ),
            detail=json.dumps(success_payload, sort_keys=True)[:1000],
            timing_ms=success.timing_ms,
            tool_result=success,
        )
        if not success.ok:
            return run

        failure = client.call_tool(
            "call_macro",
            source=f'''
              exit quirky.trigger_reverse_request({{ prompt: "{secret_prompt}" }})
            ''',
        )
        failure_payload = _json_payload(failure)
        failure_text = json.dumps(failure_payload, sort_keys=True)
        run.step(
            label="MCB-02 / T-S-002 brokered isError result fail-fast returns tool_call_failed",
            passed=(
                failure_payload.get("error") == "tool_call_failed"
                and "sampling/createMessage rejected_unsupported" in failure_text
                and "needs_user_input" not in failure_text
            ),
            detail=failure_text[:1000],
            timing_ms=failure.timing_ms,
            tool_result=failure,
        )

        logs = ctx.server.captured_logs if ctx.server else []
        log_text = "\n".join(logs)
        run.step(
            label="MCB-18 / T-S-018 rejected reverse request is audit-logged without raw prompt payload",
            passed=(
                _log_contains_rejection(logs, server="quirky", method="sampling/createMessage")
                and secret_prompt not in log_text
                and "needs_user_input" not in failure_text
            ),
            detail=json.dumps(
                {
                    "audit_log_found": _log_contains_rejection(logs, server="quirky", method="sampling/createMessage"),
                    "prompt_leaked": secret_prompt in log_text,
                    "matching_logs": [
                        line for line in logs if "mcp_broker_reverse_request_rejected" in line
                    ][-3:],
                    "payload": failure_payload,
                },
                sort_keys=True,
            )[:1200],
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
