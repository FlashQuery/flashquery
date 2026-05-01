#!/usr/bin/env python3
"""
Test: call_model metadata.resolver and metadata.name echo the request values (L-03).
- L-03: resolver=purpose call → metadata.resolver=="purpose" and metadata.name=="general"
- L-03: resolver=model call → metadata.resolver=="model" and metadata.name=="fast"
Coverage: L-03
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_llm_cost_tracking.py --managed
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

TEST_NAME = "test_llm_cost_tracking"
COVERAGE = ["L-03"]

CONFIGURED_LLM = {
    "llm": {
        "providers": [
            {
                "name": "openai",
                "type": "openai-compatible",
                "endpoint": "https://api.openai.com",
                "api_key": "${OPENAI_API_KEY}",
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
        ],
        "purposes": [
            {
                "name": "general",
                "description": "General",
                "models": ["fast"],
                "defaults": {"temperature": 0.7},
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

            # L-03: resolver=purpose — metadata.resolver and metadata.name echo the request values
            result_purpose = client.call_tool("call_model", **{
                "resolver": "purpose",
                "name": "general",
                "messages": [{"role": "user", "content": "Reply with just the digit 3."}],
            })
            if result_purpose and result_purpose.ok:
                try:
                    env_p = json.loads(result_purpose.text)
                    meta_p = env_p.get("metadata", {})
                    run.step(
                        label="L-03 (purpose): metadata.resolver=='purpose' and metadata.name=='general'",
                        passed=bool(meta_p.get("resolver") == "purpose" and meta_p.get("name") == "general"),
                        detail=f"resolver={meta_p.get('resolver')}, name={meta_p.get('name')}",
                    )
                except (json.JSONDecodeError, KeyError, TypeError) as exc:
                    run.step(label="L-03 (purpose): parse error", passed=False, detail=str(exc))
            else:
                run.step(label="L-03 (purpose): call failed", passed=False, detail=str(result_purpose)[:500])

            # L-03: resolver=model — metadata.resolver and metadata.name echo the request values
            result_model = client.call_tool("call_model", **{
                "resolver": "model",
                "name": "fast",
                "messages": [{"role": "user", "content": "Reply with just the digit 4."}],
            })
            if result_model and result_model.ok:
                try:
                    env_m = json.loads(result_model.text)
                    meta_m = env_m.get("metadata", {})
                    run.step(
                        label="L-03 (model): metadata.resolver=='model' and metadata.name=='fast'",
                        passed=bool(
                            meta_m.get("resolver") == "model"
                            and meta_m.get("name") == "fast"
                        ),
                        detail=f"resolver={meta_m.get('resolver')}, name={meta_m.get('name')}",
                    )
                except (json.JSONDecodeError, KeyError, TypeError) as exc:
                    run.step(label="L-03 (model): parse error", passed=False, detail=str(exc))
            else:
                run.step(label="L-03 (model): call failed", passed=False, detail=str(result_model)[:500])

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
