#!/usr/bin/env python3
"""
Test: call_model trace_id echoed in envelope, cumulative totals across calls (L-14, L-15).
Coverage: L-14, L-15
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_call_model_trace.py --managed
Exit codes:
    0   PASS
    2   FAIL
    3   DIRTY
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestContext, TestRun, FQCServer  # noqa: E402
from fqc_client import _find_project_dir, _load_env_file  # noqa: E402

TEST_NAME = "test_call_model_trace"
COVERAGE = ["L-14", "L-15"]

CONFIGURED_LLM = {
    "llm": {
        "providers": [
            {
                "name": "openai",
                "type": "openai-compatible",
                "endpoint": "https://api.openai.com",
                "api_key": "${OPENAI_API_KEY}",
            },
            {
                "name": "broken",
                "type": "openai-compatible",
                "endpoint": "http://127.0.0.1:1",
                "api_key": "sk-broken-placeholder",
            },
        ],
        "models": [
            {
                "name": "fast",
                "provider_name": "openai",
                "model": "gpt-4o-mini",
                "type": "language",
                "cost_per_million": {"input": 0.15, "output": 0.6},
            },
            {
                "name": "broken-primary",
                "provider_name": "broken",
                "model": "anything",
                "type": "language",
                "cost_per_million": {"input": 0, "output": 0},
            },
        ],
        "purposes": [
            {
                "name": "general",
                "description": "General",
                "models": ["fast"],
                "defaults": {"temperature": 0.7},
            },
            {
                "name": "with_fallback",
                "description": "Primary broken, fast fallback",
                "models": ["broken-primary", "fast"],
            },
            {
                "name": "all_broken",
                "description": "All models unreachable",
                "models": ["broken-primary"],
            },
        ],
    }
}

TRACE_ID = "phase101-trace-test-1"


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    env = _load_env_file(project_dir) if project_dir else {}
    if "OPENAI_API_KEY" not in os.environ:
        os.environ["OPENAI_API_KEY"] = env.get("OPENAI_API_KEY") or "sk-test-placeholder"
    try:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=CONFIGURED_LLM) as server:
            ctx = TestContext(server)

            # L-14: First call with trace_id — envelope echoes trace_id, total_calls == 1
            result_1 = ctx.client.call_tool("call_model", {
                "resolver": "model",
                "name": "fast",
                "messages": [{"role": "user", "content": "What is 1+1?"}],
                "trace_id": TRACE_ID,
            })
            first_input_tokens = None
            if result_1 and not result_1.get("isError") and result_1.get("content"):
                try:
                    envelope_1 = json.loads(result_1["content"][0]["text"])
                    meta_1 = envelope_1.get("metadata", {})
                    cumulative_1 = meta_1.get("trace_cumulative", {})
                    total_calls_1 = cumulative_1.get("total_calls", 0)
                    first_input_tokens = meta_1.get("tokens", {}).get("input", 0)
                    run.step(
                        label="L-14: trace_id echoed in metadata and trace_cumulative.total_calls == 1",
                        passed=bool(
                            meta_1.get("trace_id") == TRACE_ID
                            and total_calls_1 == 1
                        ),
                        detail=f"trace_id={meta_1.get('trace_id')}, total_calls={total_calls_1}",
                    )
                except (json.JSONDecodeError, KeyError, TypeError) as exc:
                    run.step(
                        label="L-14: trace_id first call verification",
                        passed=False,
                        detail=f"parse error: {exc}",
                    )
            else:
                run.step(
                    label="L-14: trace_id first call failed",
                    passed=False,
                    detail=str(result_1)[:500],
                )

            # L-15: Second call with same trace_id — total_calls == 2, cumulative tokens grow
            result_2 = ctx.client.call_tool("call_model", {
                "resolver": "model",
                "name": "fast",
                "messages": [{"role": "user", "content": "What is 2+2?"}],
                "trace_id": TRACE_ID,
            })
            if result_2 and not result_2.get("isError") and result_2.get("content"):
                try:
                    envelope_2 = json.loads(result_2["content"][0]["text"])
                    meta_2 = envelope_2.get("metadata", {})
                    cumulative_2 = meta_2.get("trace_cumulative", {})
                    total_calls_2 = cumulative_2.get("total_calls", 0)
                    cumulative_input = cumulative_2.get("total_tokens", {}).get("input", 0)
                    run.step(
                        label="L-15: second call total_calls==2 and cumulative input tokens > first call's input tokens",
                        passed=bool(
                            total_calls_2 == 2
                            and (first_input_tokens is None or cumulative_input > first_input_tokens)
                        ),
                        detail=f"total_calls={total_calls_2}, cumulative_input={cumulative_input}, first_input={first_input_tokens}",
                    )
                except (json.JSONDecodeError, KeyError, TypeError) as exc:
                    run.step(
                        label="L-15: second trace call verification",
                        passed=False,
                        detail=f"parse error: {exc}",
                    )
            else:
                run.step(
                    label="L-15: second trace call failed",
                    passed=False,
                    detail=str(result_2)[:500],
                )

    except Exception as e:  # noqa: BLE001
        run.step(label="server lifecycle", passed=False, detail=f"exception: {type(e).__name__}: {e}")
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
