#!/usr/bin/env python3
"""
Test: call_model resolution edge cases — uppercase model name and empty-models purpose (L-04, L-07).
Coverage: L-04, L-07
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_call_model_resolution_edge_cases.py --managed
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

TEST_NAME = "test_call_model_resolution_edge_cases"
COVERAGE = ["L-04", "L-07"]
REQUIRES_MANAGED = True

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
            {
                "name": "empty_purpose",
                "description": "Purpose with no models assigned",
                "models": [],
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

            # L-04: resolver=model with uppercase name "FAST" should resolve to "fast" via case normalization
            result_l04 = client.call_tool("call_model", **{
                "resolver": "model",
                "name": "FAST",
                "messages": [{"role": "user", "content": "hi"}],
            })
            passed_l04 = bool(result_l04 and result_l04.ok)
            metadata_ok = False
            detail_l04 = str(result_l04)[:500]
            if passed_l04 and result_l04:
                try:
                    envelope = json.loads(result_l04.text)
                    meta = envelope.get("metadata", {})
                    metadata_ok = meta.get("resolved_model_name") == "fast"
                    passed_l04 = metadata_ok
                    detail_l04 = f"resolved_model_name={meta.get('resolved_model_name')!r}, ok={result_l04.ok}"
                except (json.JSONDecodeError, KeyError, TypeError) as exc:
                    passed_l04 = False
                    detail_l04 = f"parse error: {exc} — raw: {str(result_l04)[:400]}"
            run.step(
                label="L-04: resolver=model name='FAST' (uppercase) resolves to 'fast' — isError:false and metadata.resolved_model_name == 'fast'",
                passed=passed_l04,
                detail=detail_l04,
            )

            # L-07: resolver=purpose, name="empty_purpose" (no models assigned) returns isError:true
            # and response text identifies the purpose name
            result_l07 = client.call_tool("call_model", **{
                "resolver": "purpose",
                "name": "empty_purpose",
                "messages": [{"role": "user", "content": "hi"}],
            })
            text_l07 = result_l07.text if result_l07 else ""
            passed_l07 = bool(
                result_l07
                and not result_l07.ok
                and "empty_purpose" in text_l07
            )
            run.step(
                label="L-07: resolver=purpose name='empty_purpose' (no models assigned) returns isError:true containing 'empty_purpose'",
                passed=passed_l07,
                detail=str(result_l07)[:500],
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
