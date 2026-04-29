#!/usr/bin/env python3
"""
Test: get_llm_usage summary mode returns aggregate shape after call_model calls (L-18).
Coverage: L-18
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_get_llm_usage_summary.py --managed
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
from fqc_test_utils import TestRun, FQCServer  # noqa: E402
from fqc_client import FQCClient, _find_project_dir, _load_env_file  # noqa: E402

TEST_NAME = "test_get_llm_usage_summary"
COVERAGE = ["L-18"]

CONFIGURED_LLM = {
    "llm": {
        "providers": [
            {
                "name": "openai",
                "type": "openai-compatible",
                "endpoint": "https://api.openai.com",
                "api_key": "${OPENAI_API_KEY}",
            }
        ],
        "models": [
            {
                "name": "fast",
                "provider_name": "openai",
                "model": "gpt-4o-mini",
                "type": "language",
                "cost_per_million": {"input": 0.15, "output": 0.6},
            }
        ],
        "purposes": [
            {
                "name": "general",
                "description": "General",
                "models": ["fast"],
                "defaults": {"temperature": 0.7},
            }
        ],
    }
}


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    env = _load_env_file(project_dir) if project_dir else {}
    if "OPENAI_API_KEY" not in os.environ:
        os.environ["OPENAI_API_KEY"] = env.get("OPENAI_API_KEY") or "sk-test-placeholder"
    try:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=CONFIGURED_LLM) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)

            # Seed fqc_llm_usage with two call_model calls so summary has data to aggregate.
            client.call_tool("call_model", **{
                "resolver": "purpose",
                "name": "general",
                "messages": [{"role": "user", "content": "Reply with just the digit 1."}],
            })
            client.call_tool("call_model", **{
                "resolver": "model",
                "name": "fast",
                "messages": [{"role": "user", "content": "Reply with just the digit 2."}],
            })

            # L-18: get_llm_usage summary mode returns aggregate shape with totals
            result = client.call_tool("get_llm_usage", **{
                "mode": "summary",
                "period": "24h",
            })
            ok = bool(result and result.ok)
            run.step(label="L-18: summary mode returns isError:false", passed=ok, detail=str(result)[:500])

            if ok and result:
                try:
                    parsed = json.loads(result.text)
                    shape_ok = (
                        parsed.get("mode") == "summary"
                        and isinstance(parsed.get("total_calls"), int)
                        and parsed.get("total_calls") >= 2
                        and isinstance(parsed.get("total_spend_usd"), (int, float))
                        and parsed.get("total_spend_usd") >= 0
                        and "avg_cost_per_call_usd" in parsed
                        and "avg_latency_ms" in parsed
                        and "top_purpose" in parsed
                        and "top_model_name" in parsed
                        and "vs_prior_period" in parsed   # period: 24h is not "all", so vs_prior_period must be present (D-05)
                    )
                    run.step(
                        label="L-18: summary response shape matches D-06/D-07 (total_calls, total_spend_usd, avg_*, top_*, vs_prior_period present)",
                        passed=shape_ok,
                        detail=str(parsed)[:500],
                    )
                except (json.JSONDecodeError, KeyError, TypeError) as exc:
                    run.step(label="L-18: parse error", passed=False, detail=str(exc))
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
