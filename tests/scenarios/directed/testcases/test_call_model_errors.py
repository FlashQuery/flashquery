#!/usr/bin/env python3
"""
Test: call_model error variants — unknown model, unknown purpose, unconfigured (L-05, L-06).
Coverage: L-05, L-06
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
from fqc_test_utils import TestRun, FQCServer  # noqa: E402
from fqc_client import FQCClient, _find_project_dir, _load_env_file  # noqa: E402

TEST_NAME = "test_call_model_errors"
COVERAGE = ["L-05", "L-06"]

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

            # L-05: resolver=model, name="unknown-model" returns isError:true with name + available list
            result_l05 = client.call_tool("call_model", **{
                "resolver": "model",
                "name": "unknown-model",
                "messages": [{"role": "user", "content": "hello"}],
            })
            text_l05 = result_l05.text if result_l05 else ""
            run.step(
                label="L-05: resolver=model name=unknown-model returns isError:true with 'Model ... not found' and 'Available models:'",
                passed=bool(
                    result_l05
                    and not result_l05.ok
                    and "Model 'unknown-model' not found" in text_l05
                    and "Available models:" in text_l05
                ),
                detail=str(result_l05)[:500],
            )

            # L-06: resolver=purpose, name="unknown-purpose" returns isError:true with name + available list
            result_l06 = client.call_tool("call_model", **{
                "resolver": "purpose",
                "name": "unknown-purpose",
                "messages": [{"role": "user", "content": "hello"}],
            })
            text_l06 = result_l06.text if result_l06 else ""
            run.step(
                label="L-06: resolver=purpose name=unknown-purpose returns isError:true with 'Purpose ... not found' and 'Available purposes:'",
                passed=bool(
                    result_l06
                    and not result_l06.ok
                    and "Purpose 'unknown-purpose' not found" in text_l06
                    and "Available purposes:" in text_l06
                ),
                detail=str(result_l06)[:500],
            )

        # unconfigured: FQC started without llm: section → call_model returns clean error
        with FQCServer(fqc_dir=args.fqc_dir, extra_config={}) as server_unconfigured:
            client2 = FQCClient(base_url=server_unconfigured.base_url, auth_secret=server_unconfigured.auth_secret)
            result_unconf = client2.call_tool("call_model", **{
                "resolver": "model",
                "name": "fast",
                "messages": [{"role": "user", "content": "hello"}],
            })
            text_unconf = result_unconf.text if result_unconf else ""
            run.step(
                label="unconfigured: no llm: section → isError:true with 'LLM is not configured' message",
                passed=bool(
                    result_unconf
                    and not result_unconf.ok
                    and text_unconf == "LLM is not configured. Add an llm: section to flashquery.yml to use this tool."
                ),
                detail=str(result_unconf)[:500],
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
