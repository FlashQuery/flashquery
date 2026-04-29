#!/usr/bin/env python3
"""
Test: call_model resolver=model returns valid response envelope (L-04, L-06).
Coverage: L-04, L-06
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_call_model_by_model.py --managed
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

TEST_NAME = "test_call_model_by_model"
COVERAGE = ["L-04", "L-06"]

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


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    env = _load_env_file(project_dir) if project_dir else {}
    if "OPENAI_API_KEY" not in os.environ:
        os.environ["OPENAI_API_KEY"] = env.get("OPENAI_API_KEY") or "sk-test-placeholder"
    try:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=CONFIGURED_LLM) as server:
            ctx = TestContext(server)

            # L-04: resolver=model with valid name returns non-error result
            result = ctx.client.call_tool("call_model", {
                "resolver": "model",
                "name": "fast",
                "messages": [{"role": "user", "content": "Say hello in one word"}],
            })
            passed_l04 = bool(result and not result.get("isError"))
            run.step(
                label="L-04: resolver=model returns isError:false with response text",
                passed=passed_l04,
                detail=str(result)[:500],
            )

            # L-06: envelope shape verification
            if passed_l04 and result and result.get("content"):
                try:
                    envelope = json.loads(result["content"][0]["text"])
                    meta = envelope.get("metadata", {})
                    envelope_ok = (
                        meta.get("resolved_model_name") == "fast"
                        and meta.get("provider_name") == "openai"
                        and meta.get("fallback_position") is None
                        and isinstance(meta.get("tokens", {}).get("input"), (int, float))
                        and meta.get("tokens", {}).get("input", 0) > 0
                        and isinstance(meta.get("tokens", {}).get("output"), (int, float))
                        and meta.get("tokens", {}).get("output", 0) > 0
                        and meta.get("cost_usd", -1) >= 0
                        and meta.get("latency_ms", -1) >= 0
                    )
                    run.step(
                        label="L-06: envelope has resolved_model_name, provider_name, fallback_position=null, tokens, cost_usd, latency_ms",
                        passed=envelope_ok,
                        detail=str(meta)[:500],
                    )
                except (json.JSONDecodeError, KeyError, TypeError) as exc:
                    run.step(
                        label="L-06: envelope shape verification",
                        passed=False,
                        detail=f"parse error: {exc}",
                    )
            else:
                run.step(
                    label="L-06: envelope shape (skipped — L-04 failed)",
                    passed=False,
                    detail="L-04 did not return content to parse",
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
