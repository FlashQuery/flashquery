#!/usr/bin/env python3
"""
Test: call_model parameter override and messages array relay (L-08).
Coverage: L-08
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_call_model_params.py --managed
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
from fqc_test_utils import TestRun, FQCServer  # noqa: E402
from fqc_client import FQCClient, _find_project_dir, _load_env_file  # noqa: E402

TEST_NAME = "test_call_model_params"
COVERAGE = ["L-08"]

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
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)

            # L-08: caller parameters.temperature=0.1 overrides purpose defaults (0.7)
            # The purpose "general" has defaults: {temperature: 0.7}. Caller passes temperature=0.1.
            # Verification: call succeeds end-to-end (deeper param verification is unit-test level).
            result_l08 = client.call_tool("call_model", **{
                "resolver": "purpose",
                "name": "general",
                "messages": [{"role": "user", "content": "Say hello"}],
                "parameters": {"temperature": 0.1},
            })
            run.step(
                label="L-08: resolver=purpose with parameters.temperature=0.1 overriding default 0.7 — call succeeds end-to-end",
                passed=bool(result_l08 and result_l08.ok),
                detail=str(result_l08)[:500],
            )

            # messages relay: system/user roles accepted (not a coverage-matrix behavior, but a useful smoke check)
            result_msgs = client.call_tool("call_model", **{
                "resolver": "model",
                "name": "fast",
                "messages": [
                    {"role": "system", "content": "Always respond in French."},
                    {"role": "user", "content": "Hello"},
                ],
            })
            run.step(
                label="messages relay: system/user roles accepted and call succeeds",
                passed=bool(result_msgs and result_msgs.ok),
                detail=str(result_msgs)[:500],
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
