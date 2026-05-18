#!/usr/bin/env python3
"""
Phase B MCP Broker: macro TOFU drift, approve/reject re-entry, and decision audit logging.
Coverage: MCB-03, MCB-04, MCB-05, MCB-17
"""
from __future__ import annotations

COVERAGE = ["MCB-03", "MCB-04", "MCB-05", "MCB-17"]

import argparse
import json
import shutil
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import FQCClient  # noqa: E402
from fqc_test_utils import TestContext, TestRun  # noqa: E402

TEST_NAME = "test_mcp_broker_phase_b"


def _project_root(args: argparse.Namespace) -> Path:
    if args.fqc_dir:
        return Path(args.fqc_dir).resolve()
    return Path(__file__).resolve().parents[4]


def _tool_snapshot(name: str, required: list[str]) -> dict[str, Any]:
    return {
        "name": name,
        "description": f"{name} fixture tool with {' and '.join(required)}.",
        "inputSchema": {
            "type": "object",
            "properties": {field: {"type": "string"} for field in required},
            "required": required,
        },
    }


def _broker_config(args: argparse.Namespace) -> dict[str, Any]:
    root = _project_root(args)
    node = shutil.which("node") or "node"
    fixture_dir = root / "tests" / "fixtures" / "mcp-servers"
    initial_tools = [_tool_snapshot("stable", ["value"]), _tool_snapshot("rejectable", ["value"])]
    later_tools = [
        _tool_snapshot("stable", ["value", "token"]),
        _tool_snapshot("rejectable", ["value", "token"]),
    ]
    return {
        "host_mcp_tools": {"tools": ["call_macro"]},
        "mcp_servers": {
            "quirky": {
                "transport": "stdio",
                "command": node,
                "args": ["--import", "tsx", str(fixture_dir / "server-quirky.ts")],
                "env": {
                    "QUIRK_INITIAL_TOOLS": json.dumps(initial_tools),
                    "QUIRK_LATER_TOOLS": json.dumps(later_tools),
                    "QUIRK_EMIT_LIST_CHANGED_MS": "150",
                },
                "cost_per_call": 0,
                "per_call_timeout_ms": 30000,
                "tool_overrides": {},
            },
        },
        "host": {"mcp_servers": ["quirky"], "tool_search": "disabled"},
    }


def _json_payload(result: Any) -> dict[str, Any]:
    try:
        parsed = json.loads(result.text) if result.text else {}
    except json.JSONDecodeError:
        return {"raw_text": result.text, "error": result.error}
    return parsed if isinstance(parsed, dict) else {"payload": parsed}


def _call_macro(client: FQCClient, source: str, input_vars: dict[str, Any] | None = None) -> Any:
    args: dict[str, Any] = {"source": source, "trace": "summary"}
    if input_vars is not None:
        args["input_vars"] = input_vars
    return client.call_tool("call_macro", **args)


def _decision(decision: str, tool: str) -> dict[str, Any]:
    return {
        "frontmatter": {
            "user_decisions": {
                f"quirky__{tool}": {"tofu_decision": decision},
            },
        },
    }


def test_macro_brokered_tofu_drift_exit(client: FQCClient) -> tuple[bool, dict[str, Any], Any]:
    result = _call_macro(
        client,
        '''
          echoed = quirky.stable({ value: "after-drift", token: "pending" })
          exit $echoed
        ''',
    )
    payload = _json_payload(result)
    drift = payload.get("payload") if isinstance(payload.get("payload"), dict) else {}
    passed = (
        payload.get("reason") == "needs_user_input"
        and drift.get("event") == "schema_drift_detected"
        and drift.get("server") == "quirky"
        and drift.get("tool") == "stable"
        and isinstance(drift.get("old_schema"), dict)
        and isinstance(drift.get("new_schema"), dict)
    )
    return passed, payload, result


def test_macro_tofu_reapproval_approve_resume(client: FQCClient) -> tuple[bool, dict[str, Any], Any]:
    result = _call_macro(
        client,
        '''
          echoed = quirky.stable({ value: "after-approve", token: "approved" })
          exit $echoed
        ''',
        _decision("approve", "stable"),
    )
    payload = _json_payload(result)
    macro_result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
    passed = (
        result.ok
        and macro_result.get("tool") == "stable"
        and macro_result.get("arguments") == {"value": "after-approve", "token": "approved"}
    )
    return passed, payload, result


def test_macro_tofu_reapproval_reject_blocked(client: FQCClient) -> tuple[bool, dict[str, Any], Any]:
    pending_result = _call_macro(
        client,
        '''
          echoed = quirky.rejectable({ value: "before-reject", token: "pending" })
          exit $echoed
        ''',
    )
    pending_payload = _json_payload(pending_result)
    decision_result = _call_macro(
        client,
        '''
          exit "reject-recorded"
        ''',
        _decision("reject", "rejectable"),
    )
    decision_payload = _json_payload(decision_result)
    result = _call_macro(
        client,
        '''
          echoed = quirky.rejectable({ value: "after-reject", token: "rejected" })
          exit $echoed
        ''',
    )
    payload = _json_payload(result)
    text = json.dumps(payload, sort_keys=True)
    pending_drift = pending_payload.get("payload") if isinstance(pending_payload.get("payload"), dict) else {}
    passed = (
        pending_payload.get("reason") == "needs_user_input"
        and pending_drift.get("tool") == "rejectable"
        and decision_payload.get("result") == "reject-recorded"
        and payload.get("error") in {"unknown_tool", "unknown_server"}
        and "rejectable" in text
        and "needs_user_input" not in text
    )
    return passed, {"pending": pending_payload, "decision": decision_payload, "blocked": payload}, result


def test_tofu_approval_audit_log(logs: list[str]) -> tuple[bool, dict[str, Any]]:
    matching = [
        line
        for line in logs
        if (
            "mcp_broker_tofu_decision" in line
            and "server=quirky" in line
            and "tool=stable" in line
            and "decision=approve" in line
        )
    ]
    return len(matching) == 1, {"matching_logs": matching[-3:], "count": len(matching)}


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        extra_config=_broker_config(args),
    ) as ctx:
        client: FQCClient = ctx.client

        first = _call_macro(
            client,
            '''
              echoed = quirky.stable({ value: "first" })
              exit $echoed
            ''',
        )
        first_payload = _json_payload(first)
        first_result = first_payload.get("result") if isinstance(first_payload.get("result"), dict) else {}
        if not (first.ok and first_result.get("tool") == "stable"):
            run.step(
                label="Setup / initial stable schema is silently trusted",
                passed=False,
                detail=json.dumps(first_payload, sort_keys=True)[:1000],
                timing_ms=first.timing_ms,
                tool_result=first,
            )
            return run

        time.sleep(0.35)

        passed, payload, result = test_macro_brokered_tofu_drift_exit(client)
        run.step(
            label="MCB-03 / T-S-003 macro TOFU drift exits with needs_user_input payload",
            passed=passed,
            detail=json.dumps(payload, sort_keys=True)[:1200],
            timing_ms=result.timing_ms,
            tool_result=result,
        )
        if not passed:
            return run

        passed, payload, result = test_macro_tofu_reapproval_approve_resume(client)
        run.step(
            label="MCB-04 / T-S-004 approve decision lets macro resume and complete",
            passed=passed,
            detail=json.dumps(payload, sort_keys=True)[:1200],
            timing_ms=result.timing_ms,
            tool_result=result,
        )

        passed, payload, result = test_macro_tofu_reapproval_reject_blocked(client)
        run.step(
            label="MCB-05 / T-S-005 reject decision keeps brokered tool blocked",
            passed=passed,
            detail=json.dumps(payload, sort_keys=True)[:1200],
            timing_ms=result.timing_ms,
            tool_result=result,
        )

        logs = ctx.server.captured_logs if ctx.server else []
        passed, detail = test_tofu_approval_audit_log(logs)
        run.step(
            label="MCB-17 / T-S-017 TOFU approval is audit-logged in trace stream",
            passed=passed,
            detail=json.dumps(detail, sort_keys=True)[:1200],
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
