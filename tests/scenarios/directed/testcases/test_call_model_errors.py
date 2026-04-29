#!/usr/bin/env python3
"""
Test: call_model error variants — unknown model, unknown purpose, unconfigured (L-09, L-10, L-13).
Coverage: L-09, L-10, L-13
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_call_model_errors.py --managed
Exit codes:
    0   PASS
    2   FAIL
    3   DIRTY
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestContext, TestRun, FQCServer  # noqa: E402
from fqc_client import _find_project_dir, _load_env_file  # noqa: E402

TEST_NAME = "test_call_model_errors"
COVERAGE = ["L-09", "L-10", "L-13"]

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

            # L-09: resolver=model, name="unknown-model" returns isError:true with helpful message
            result_l09 = ctx.client.call_tool("call_model", {
                "resolver": "model",
                "name": "unknown-model",
                "messages": [{"role": "user", "content": "hello"}],
            })
            text_l09 = (result_l09.get("content") or [{}])[0].get("text", "") if result_l09 else ""
            run.step(
                label="L-09: resolver=model name=unknown-model returns isError:true with 'Model ... not found' and 'Available models:'",
                passed=bool(
                    result_l09
                    and result_l09.get("isError") is True
                    and "Model 'unknown-model' not found" in text_l09
                    and "Available models:" in text_l09
                ),
                detail=str(result_l09)[:500],
            )

            # L-10: resolver=purpose, name="unknown-purpose" returns isError:true with helpful message
            result_l10 = ctx.client.call_tool("call_model", {
                "resolver": "purpose",
                "name": "unknown-purpose",
                "messages": [{"role": "user", "content": "hello"}],
            })
            text_l10 = (result_l10.get("content") or [{}])[0].get("text", "") if result_l10 else ""
            run.step(
                label="L-10: resolver=purpose name=unknown-purpose returns isError:true with 'Purpose ... not found' and 'Available purposes:'",
                passed=bool(
                    result_l10
                    and result_l10.get("isError") is True
                    and "Purpose 'unknown-purpose' not found" in text_l10
                    and "Available purposes:" in text_l10
                ),
                detail=str(result_l10)[:500],
            )

        # L-13: FQC started without llm: section → call_model returns clean unconfigured error
        with FQCServer(fqc_dir=args.fqc_dir, extra_config={}) as server_unconfigured:
            ctx2 = TestContext(server_unconfigured)
            result_l13 = ctx2.client.call_tool("call_model", {
                "resolver": "model",
                "name": "fast",
                "messages": [{"role": "user", "content": "hello"}],
            })
            text_l13 = (result_l13.get("content") or [{}])[0].get("text", "") if result_l13 else ""
            run.step(
                label="L-13: no llm: section → isError:true with 'LLM is not configured. Add an llm: section to flashquery.yml to use this tool.'",
                passed=bool(
                    result_l13
                    and result_l13.get("isError") is True
                    and text_l13 == "LLM is not configured. Add an llm: section to flashquery.yml to use this tool."
                ),
                detail=str(result_l13)[:500],
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
