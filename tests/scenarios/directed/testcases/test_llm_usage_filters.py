#!/usr/bin/env python3
"""
Test: get_llm_usage purpose_name filter, model_name filter, and exact limit enforcement (L-12, L-13, L-14).
- L-12: purpose_name filter returns only records for the specified purpose
- L-13: model_name filter returns only records for the specified model alias
- L-14: mode=recent with limit=N returns exactly N entries when more than N records exist
Coverage: L-12, L-13, L-14
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_llm_usage_filters.py --managed
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

TEST_NAME = "test_llm_usage_filters"
COVERAGE = ["L-12", "L-13", "L-14"]
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
            {
                "name": "precise",
                "provider_name": "openai",
                "model": "gpt-4o-mini",  # same underlying model, different alias
                "type": "language",
                "cost_per_million": {"input": 0.15, "output": 0.6},
            },
        ],
        "purposes": [
            {
                "name": "general",
                "description": "General purpose",
                "models": ["fast"],
                "defaults": {"temperature": 0.7},
            },
            {
                "name": "analysis",
                "description": "Analysis purpose",
                "models": ["precise"],
                "defaults": {"temperature": 0.3},
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

            # ── Seeding: 3 total calls ──────────────────────────────────────────
            # Call 1: general/fast
            client.call_tool("call_model", **{
                "resolver": "purpose",
                "name": "general",
                "messages": [{"role": "user", "content": "Reply with just the digit 1."}],
            })
            # Call 2: analysis/precise
            client.call_tool("call_model", **{
                "resolver": "purpose",
                "name": "analysis",
                "messages": [{"role": "user", "content": "Reply with just the digit 2."}],
            })
            # Call 3: general/fast again (gives us N+1=3 total for L-14 with limit=2)
            client.call_tool("call_model", **{
                "resolver": "purpose",
                "name": "general",
                "messages": [{"role": "user", "content": "Reply with just the digit 3."}],
            })

            # ── Step 1: L-12 — purpose_name filter ─────────────────────────────
            result_12 = client.call_tool("get_llm_usage", **{
                "mode": "recent",
                "period": "24h",
                "purpose_name": "general",
            })
            ok_12 = bool(result_12 and result_12.ok)
            run.step(
                label="L-12: purpose_name filter returns isError:false",
                passed=ok_12,
                detail=str(result_12)[:500],
            )

            if ok_12 and result_12:
                try:
                    parsed_12 = json.loads(result_12.text)
                    entries_12 = parsed_12.get("entries", [])
                    all_general = all(e.get("purpose_name") == "general" for e in entries_12)
                    no_analysis = all(e.get("purpose_name") != "analysis" for e in entries_12)
                    has_results = len(entries_12) >= 1
                    filter_ok = all_general and no_analysis and has_results
                    run.step(
                        label="L-12: purpose_name filter — all entries are 'general', none are 'analysis', count>=1",
                        passed=filter_ok,
                        detail=(
                            f"len={len(entries_12)}, "
                            f"all_general={all_general}, "
                            f"no_analysis={no_analysis}, "
                            f"purposes={[e.get('purpose_name') for e in entries_12]}"
                        ),
                    )
                except (json.JSONDecodeError, KeyError, TypeError) as exc:
                    run.step(label="L-12: parse error", passed=False, detail=str(exc))

            # ── Step 2: L-13 — model_name filter ───────────────────────────────
            result_13 = client.call_tool("get_llm_usage", **{
                "mode": "recent",
                "period": "24h",
                "model_name": "fast",
            })
            ok_13 = bool(result_13 and result_13.ok)
            run.step(
                label="L-13: model_name filter returns isError:false",
                passed=ok_13,
                detail=str(result_13)[:500],
            )

            if ok_13 and result_13:
                try:
                    parsed_13 = json.loads(result_13.text)
                    entries_13 = parsed_13.get("entries", [])
                    all_fast = all(e.get("model_name") == "fast" for e in entries_13)
                    no_precise = all(e.get("model_name") != "precise" for e in entries_13)
                    has_results = len(entries_13) >= 1
                    filter_ok = all_fast and no_precise and has_results
                    run.step(
                        label="L-13: model_name filter — all entries are 'fast', none are 'precise', count>=1",
                        passed=filter_ok,
                        detail=(
                            f"len={len(entries_13)}, "
                            f"all_fast={all_fast}, "
                            f"no_precise={no_precise}, "
                            f"models={[e.get('model_name') for e in entries_13]}"
                        ),
                    )
                except (json.JSONDecodeError, KeyError, TypeError) as exc:
                    run.step(label="L-13: parse error", passed=False, detail=str(exc))

            # ── Step 3: L-14 — exact limit enforcement ──────────────────────────
            # We seeded 3 total calls; limit=2 must return exactly 2 (not 1, not 3).
            result_14 = client.call_tool("get_llm_usage", **{
                "mode": "recent",
                "period": "24h",
                "limit": 2,
            })
            ok_14 = bool(result_14 and result_14.ok)
            run.step(
                label="L-14: limit=2 returns exactly 2 entries (exact limit enforcement)",
                passed=ok_14,
                detail=str(result_14)[:500],
            )

            if ok_14 and result_14:
                try:
                    parsed_14 = json.loads(result_14.text)
                    entries_14 = parsed_14.get("entries", [])
                    exact_two = len(entries_14) == 2
                    run.step(
                        label="L-14: limit=2 returns exactly 2 entries when 3 exist",
                        passed=exact_two,
                        detail=f"len={len(entries_14)} (expected exactly 2, seeded 3 calls)",
                    )
                except (json.JSONDecodeError, KeyError, TypeError) as exc:
                    run.step(label="L-14: parse error", passed=False, detail=str(exc))

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
