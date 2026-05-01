#!/usr/bin/env python3
"""
Test: get_llm_usage trace_id filter narrows results to matching calls only (L-22).
Coverage: L-22
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_get_llm_usage_trace.py --managed
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

TEST_NAME = "test_get_llm_usage_trace"
COVERAGE = ["L-22"]

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

            client.call_tool("call_model", **{
                "resolver": "purpose",
                "name": "general",
                "messages": [{"role": "user", "content": "Say A."}],
                "trace_id": "trace-l22-target",
            })
            client.call_tool("call_model", **{
                "resolver": "purpose",
                "name": "general",
                "messages": [{"role": "user", "content": "Say B."}],
                "trace_id": "trace-l22-target",
            })
            client.call_tool("call_model", **{
                "resolver": "purpose",
                "name": "general",
                "messages": [{"role": "user", "content": "Say C."}],
                "trace_id": "trace-l22-other",
            })

            # L-22: trace_id filter narrows results to the matching trace only
            result = client.call_tool("get_llm_usage", **{
                "mode": "summary",
                "period": "24h",
                "trace_id": "trace-l22-target",
            })
            ok = bool(result and result.ok)
            run.step(label="L-22: trace_id filter returns isError:false", passed=ok, detail=str(result)[:500])

            if ok and result:
                try:
                    parsed = json.loads(result.text)
                    shape_ok = (
                        parsed.get("mode") == "summary"
                        and parsed.get("total_calls") == 2   # only the two with trace-l22-target
                    )
                    run.step(
                        label="L-22: trace_id='trace-l22-target' filter returns total_calls=2 (excludes the third call)",
                        passed=shape_ok,
                        detail=f"total_calls={parsed.get('total_calls')}",
                    )
                except (json.JSONDecodeError, KeyError, TypeError) as exc:
                    run.step(label="L-22: parse error", passed=False, detail=str(exc))
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
