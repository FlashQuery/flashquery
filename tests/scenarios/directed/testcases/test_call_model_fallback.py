#!/usr/bin/env python3
"""
Test: call_model fallback chain — primary unreachable advances chain, all fail produces error (L-11, L-12).
Coverage: L-11, L-12
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_call_model_fallback.py --managed
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

TEST_NAME = "test_call_model_fallback"
COVERAGE = ["L-11", "L-12"]

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

            # L-11: resolver=purpose with_fallback — broken-primary fails, fast succeeds at position 2
            result_l11 = ctx.client.call_tool("call_model", {
                "resolver": "purpose",
                "name": "with_fallback",
                "messages": [{"role": "user", "content": "Say hello"}],
            })
            passed_l11_basic = bool(result_l11 and not result_l11.get("isError"))
            if passed_l11_basic and result_l11 and result_l11.get("content"):
                try:
                    envelope = json.loads(result_l11["content"][0]["text"])
                    fallback_pos = envelope.get("metadata", {}).get("fallback_position")
                    run.step(
                        label="L-11: with_fallback purpose — broken-primary fails, fast succeeds at fallback_position >= 2",
                        passed=isinstance(fallback_pos, int) and fallback_pos >= 2,
                        detail=f"fallback_position={fallback_pos}, envelope_keys={list(envelope.get('metadata', {}).keys())}",
                    )
                except (json.JSONDecodeError, KeyError, TypeError) as exc:
                    run.step(
                        label="L-11: fallback chain verification",
                        passed=False,
                        detail=f"parse error: {exc}",
                    )
            else:
                run.step(
                    label="L-11: fallback chain — basic call failed or returned isError",
                    passed=False,
                    detail=str(result_l11)[:500],
                )

            # L-12: resolver=purpose all_broken — all models fail, returns LlmFallbackError envelope
            result_l12 = ctx.client.call_tool("call_model", {
                "resolver": "purpose",
                "name": "all_broken",
                "messages": [{"role": "user", "content": "Say hello"}],
            })
            text_l12 = (result_l12.get("content") or [{}])[0].get("text", "") if result_l12 else ""
            run.step(
                label="L-12: all_broken purpose — isError:true with multi-line chain-exhausted error",
                passed=bool(
                    result_l12
                    and result_l12.get("isError") is True
                    and "call_model failed: purpose 'all_broken'" in text_l12
                    and "models exhausted" in text_l12
                    and "[1] broken-primary" in text_l12
                ),
                detail=str(result_l12)[:500],
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
