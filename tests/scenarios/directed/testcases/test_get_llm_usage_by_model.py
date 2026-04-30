#!/usr/bin/env python3
"""
Test: get_llm_usage by_model mode returns per-model stats with pct_of_total_calls (L-20).
Coverage: L-20
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_get_llm_usage_by_model.py --managed
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

TEST_NAME = "test_get_llm_usage_by_model"
COVERAGE = ["L-20"]

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

            for i in range(2):
                client.call_tool("call_model", **{
                    "resolver": "model",
                    "name": "fast",
                    "messages": [{"role": "user", "content": f"Reply with just the digit {i + 1}."}],
                })

            # L-20: by_model returns per-model stats including pct_of_total_calls and avg_fallback_position
            result = client.call_tool("get_llm_usage", **{
                "mode": "by_model",
                "period": "24h",
            })
            ok = bool(result and result.ok)
            run.step(label="L-20: by_model mode returns isError:false", passed=ok, detail=str(result)[:500])

            if ok and result:
                try:
                    parsed = json.loads(result.text)
                    models = parsed.get("models", [])
                    fast_entry = next((m for m in models if m.get("model_name") == "fast"), None)
                    shape_ok = (
                        parsed.get("mode") == "by_model"
                        and isinstance(models, list)
                        and fast_entry is not None
                        and "pct_of_total_calls" in fast_entry
                        and "avg_fallback_position" in fast_entry  # may be null for all-direct calls
                        and "spend_usd" in fast_entry
                        and "avg_cost_per_call_usd" in fast_entry
                        and "avg_latency_ms" in fast_entry
                        and fast_entry.get("provider_name") == "openai"
                        and fast_entry.get("calls", 0) >= 2
                        and 0 < fast_entry.get("pct_of_total_calls", 0) <= 1
                    )
                    run.step(
                        label="L-20: by_model entry has model_name, provider_name, calls, pct_of_total_calls, avg_fallback_position, spend_usd, avg_cost_per_call_usd, avg_latency_ms",
                        passed=shape_ok,
                        detail=str(fast_entry)[:500],
                    )
                except (json.JSONDecodeError, KeyError, TypeError) as exc:
                    run.step(label="L-20: parse error", passed=False, detail=str(exc))
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
