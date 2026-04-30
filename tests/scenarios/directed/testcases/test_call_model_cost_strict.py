#!/usr/bin/env python3
"""
Test: call_model metadata.cost_usd and latency_ms are strictly positive (L-10, L-11).
- L-10: metadata.cost_usd > 0 (strictly positive) after a successful call_model to a
        model configured with non-zero cost_per_million rates — verifies the
        token-count × rate computation returns a non-zero result for a real provider response
- L-11: metadata.latency_ms is a positive integer (> 0) in every successful call_model
        response — verifies the round-trip timer is wired and returns a real measurement,
        not a zero or null placeholder
Coverage: L-10, L-11
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_call_model_cost_strict.py --managed
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

TEST_NAME = "test_call_model_cost_strict"
COVERAGE = ["L-10", "L-11"]
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

            # Single call_model invocation — both L-10 and L-11 are verified from its response
            result = client.call_tool("call_model", **{
                "resolver": "model",
                "name": "fast",
                "messages": [{"role": "user", "content": "Reply with just the word yes."}],
            })

            if not (result and result.ok):
                run.step(
                    label="L-10: cost_usd > 0 (strictly positive)",
                    passed=False,
                    detail=f"call_model failed: {str(result)[:500]}",
                )
                run.step(
                    label="L-11: latency_ms is positive integer",
                    passed=False,
                    detail="call_model failed — skipped",
                )
                return run

            # Parse the JSON envelope
            try:
                envelope = json.loads(result.text)
            except (json.JSONDecodeError, TypeError) as exc:
                run.step(
                    label="L-10: cost_usd > 0 (strictly positive)",
                    passed=False,
                    detail=f"JSON parse error: {exc} — raw: {str(result.text)[:300]}",
                )
                run.step(
                    label="L-11: latency_ms is positive integer",
                    passed=False,
                    detail="JSON parse failed — skipped",
                )
                return run

            meta = envelope.get("metadata", {})

            # L-10: cost_usd must be strictly greater than 0
            cost_usd = meta.get("cost_usd")
            cost_ok = cost_usd is not None and cost_usd > 0
            run.step(
                label="L-10: cost_usd > 0 (strictly positive)",
                passed=cost_ok,
                detail=f"cost_usd={cost_usd!r} (expected > 0, model has non-zero cost_per_million rates)",
            )

            # L-11: latency_ms must be a positive integer (> 0)
            latency_ms = meta.get("latency_ms")
            latency_ok = isinstance(latency_ms, int) and latency_ms > 0
            run.step(
                label="L-11: latency_ms is positive integer",
                passed=latency_ok,
                detail=f"latency_ms={latency_ms!r} (type={type(latency_ms).__name__}, expected int > 0)",
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
