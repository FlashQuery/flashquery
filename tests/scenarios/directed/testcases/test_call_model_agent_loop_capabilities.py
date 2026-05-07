#!/usr/bin/env python3
"""
Test: call_model agent-loop capability admission errors are public and actionable.

Scenario:
    1. Start FlashQuery with Mode 2 purposes whose fallback models cannot prove
       tool-calling and tool-call usage support.
    2. Assert startup/config errors name the exact capability key and whether
       the value was declared unsupported or unknown.
    3. Start a valid tool-exposing purpose whose model cannot combine
       response_format with tools, then assert call_model fails before provider
       dispatch.

Coverage: ATL-DS-14

Modes:
    --managed   Required

Exit codes:
    0   PASS
    2   FAIL
    3   DIRTY
"""
from __future__ import annotations

import argparse
import sys
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_client import FQCClient  # noqa: E402
from fqc_test_utils import FQCServer, TestRun  # noqa: E402

TEST_NAME = "test_call_model_agent_loop_capabilities"
COVERAGE = ["ATL-DS-14"]


def _base_llm(model_capabilities: dict | None, purpose_extra: dict | None = None) -> dict:
    model = {
        "name": "agent-model",
        "provider_name": "fixture",
        "model": "fixture-model",
        "type": "language",
        "cost_per_million": {"input": 0, "output": 0},
    }
    if model_capabilities is not None:
        model["capabilities"] = model_capabilities

    purpose = {
        "name": "agentic",
        "description": "Agentic Mode 2 fixture",
        "models": ["agent-model"],
        "tools": ["get_document"],
    }
    if purpose_extra:
        purpose.update(purpose_extra)

    return {
        "llm": {
            "providers": [
                {
                    "name": "fixture",
                    "type": "openai-compatible",
                    "endpoint": "http://127.0.0.1:1",
                    "api_key": "sk-test-placeholder",
                }
            ],
            "models": [model],
            "purposes": [purpose],
        }
    }


def _startup_error(fqc_dir: str | None, config: dict) -> str:
    try:
        with FQCServer(fqc_dir=fqc_dir, extra_config=config):
            return "server unexpectedly started"
    except RuntimeError as exc:
        return str(exc)


def _record_startup_case(
    run: TestRun,
    *,
    label: str,
    fqc_dir: str | None,
    config: dict,
    expected_capability: str,
    expected_state: str,
    expected_remediation: str | None = None,
) -> None:
    captured_error = _startup_error(fqc_dir, config)
    passed = (
        "server unexpectedly started" not in captured_error
        and expected_capability in captured_error
        and expected_state in captured_error
        and (expected_remediation is None or expected_remediation in captured_error)
    )
    run.step(
        label=label,
        passed=passed,
        detail=captured_error[-1200:],
    )


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    _record_startup_case(
        run,
        label="ATL-DS-14: tool_calling false blocks tool-exposing purpose with declared unsupported diagnostic",
        fqc_dir=args.fqc_dir,
        config=_base_llm({"tool_calling": False, "usage_on_tool_calls": True}),
        expected_capability="tool_calling",
        expected_state="declared unsupported",
    )

    _record_startup_case(
        run,
        label="ATL-DS-14: missing tool_calling blocks tool-exposing purpose with unknown declaration diagnostic",
        fqc_dir=args.fqc_dir,
        config=_base_llm({"usage_on_tool_calls": True}),
        expected_capability="tool_calling",
        expected_state="unknown declaration",
        expected_remediation="capabilities.tool_calling: true|false",
    )

    _record_startup_case(
        run,
        label="ATL-DS-14: usage_on_tool_calls false blocks template-exposing purpose with declared unsupported diagnostic",
        fqc_dir=args.fqc_dir,
        config=_base_llm(
            {"tool_calling": True, "usage_on_tool_calls": False},
            {"tools": [], "templates": ["Templates/research-skill.md"]},
        ),
        expected_capability="usage_on_tool_calls",
        expected_state="declared unsupported",
    )

    _record_startup_case(
        run,
        label="ATL-DS-14: missing usage_on_tool_calls blocks template-exposing purpose with unknown declaration diagnostic",
        fqc_dir=args.fqc_dir,
        config=_base_llm({"tool_calling": True}, {"tools": [], "templates": ["Templates/research-skill.md"]}),
        expected_capability="usage_on_tool_calls",
        expected_state="unknown declaration",
        expected_remediation="capabilities.usage_on_tool_calls: true|false",
    )

    _record_startup_case(
        run,
        label="ATL-DS-14: permissive template exposure blocks no-binding purpose with unknown capabilities",
        fqc_dir=args.fqc_dir,
        config=_base_llm({"usage_on_tool_calls": True}, {"tools": []}),
        expected_capability="tool_calling",
        expected_state="unknown declaration",
        expected_remediation="capabilities.tool_calling: true|false",
    )

    runtime_config = _base_llm(
        {
            "tool_calling": True,
            "usage_on_tool_calls": True,
            "structured_outputs_with_tools": False,
        }
    )
    runtime_config = deepcopy(runtime_config)
    runtime_config["llm"]["purposes"][0]["defaults"] = {"response_format": {"type": "json_object"}}

    try:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=runtime_config) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            result = client.call_tool(
                "call_model",
                resolver="purpose",
                name="agentic",
                messages=[{"role": "user", "content": "return JSON"}],
            )
            passed = (
                not result.ok
                and "response_format" in result.text
                and "structured_outputs_with_tools" in result.text
                and "declared unsupported" in result.text
            )
            run.step(
                label="ATL-DS-14: response_format with model-visible tools fails before provider dispatch",
                passed=passed,
                detail=result.text[:1200] or result.error or "",
                timing_ms=result.timing_ms,
                tool_result=result,
            )
    except Exception as exc:  # noqa: BLE001
        run.step(
            label="ATL-DS-14: response_format runtime guard server lifecycle",
            passed=False,
            detail=f"{type(exc).__name__}: {exc}",
        )

    return run


def main() -> int:
    parser = argparse.ArgumentParser(description=TEST_NAME)
    parser.add_argument("--fqc-dir", default=None)
    parser.add_argument("--managed", action="store_true", required=True)
    parser.add_argument("--url", default=None)
    parser.add_argument("--secret", default=None)
    args = parser.parse_args()
    run = run_test(args)
    for line in run.summary_lines():
        print(line, file=sys.stderr)
    return run.exit_code


if __name__ == "__main__":
    sys.exit(main())
