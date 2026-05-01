#!/usr/bin/env python3
"""
Test: get_llm_usage recent mode returns newest-first entries with limit respected (L-21).
Coverage: L-21
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_get_llm_usage_recent.py --managed
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

TEST_NAME = "test_get_llm_usage_recent"
COVERAGE = ["L-21"]

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

            for i in range(3):
                client.call_tool("call_model", **{
                    "resolver": "purpose",
                    "name": "general",
                    "messages": [{"role": "user", "content": f"Reply with just the digit {i + 1}."}],
                })

            # L-21: recent returns newest-first; limit respected
            result = client.call_tool("get_llm_usage", **{
                "mode": "recent",
                "limit": 2,
            })
            ok = bool(result and result.ok)
            run.step(label="L-21: recent mode returns isError:false", passed=ok, detail=str(result)[:500])

            if ok and result:
                try:
                    parsed = json.loads(result.text)
                    entries = parsed.get("entries", [])
                    timestamps = [e.get("timestamp") for e in entries]
                    # newest-first: each adjacent pair must satisfy ts[i] >= ts[i+1]
                    monotonic_desc = all(timestamps[i] >= timestamps[i + 1] for i in range(len(timestamps) - 1))
                    shape_ok = (
                        parsed.get("mode") == "recent"
                        and isinstance(entries, list)
                        and len(entries) <= 2                    # limit honored
                        and monotonic_desc
                        and (len(entries) == 0 or all(
                            "timestamp" in e
                            and "purpose_name" in e
                            and "model_name" in e
                            and "provider_name" in e
                            and "tokens" in e
                            and "cost_usd" in e
                            and "latency_ms" in e
                            and "fallback_position" in e
                            and "trace_id" in e
                            for e in entries
                        ))
                    )
                    run.step(
                        label="L-21: recent entries newest-first, len<=limit, each has D-12 field set",
                        passed=shape_ok,
                        detail=f"len={len(entries)}, ts={timestamps}",
                    )
                except (json.JSONDecodeError, KeyError, TypeError) as exc:
                    run.step(label="L-21: parse error", passed=False, detail=str(exc))
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
