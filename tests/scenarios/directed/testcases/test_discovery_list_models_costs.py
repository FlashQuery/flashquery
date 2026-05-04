#!/usr/bin/env python3
"""
Test: discovery list_models / list_purposes return per-million costs byte-for-byte
from the configured YAML — non-trivial decimals, and purpose-level costs reflect
the primary (first) model in the purpose's models: chain.
Coverage: L-63, L-64
Modes: --managed
Usage: python test_discovery_list_models_costs.py --managed
Exit codes: 0 PASS, 2 FAIL, 3 DIRTY
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

TEST_NAME = "test_discovery_list_models_costs"
COVERAGE = ["L-63", "L-64"]

# Two models with non-trivial decimals + a primary/secondary pair under one purpose.
#
# - "precise" exercises L-63: 6+ significant digits, neither rate a round number.
#   We assert the response has these values byte-equal to the configured YAML.
# - "fast" / "mid" + purpose "analysis" exercise L-64: list_purposes for "analysis"
#   must report fast's rates (0.59 / 0.79), NOT mid's (3.0 / 15.0), NOT an average
#   (~1.795 / ~7.895).
CONFIGURED_LLM = {
    "llm": {
        "providers": [{
            "name": "openai", "type": "openai-compatible",
            "endpoint": "https://api.openai.com",
        }],
        "models": [
            # L-63 — non-trivial decimals
            {
                "name": "precise",
                "provider_name": "openai",
                "model": "gpt-4o-mini",
                "type": "language",
                "cost_per_million": {"input": 0.594321, "output": 1.234567},
            },
            # L-64 primary
            {
                "name": "fast",
                "provider_name": "openai",
                "model": "gpt-4o-mini",
                "type": "language",
                "cost_per_million": {"input": 0.59, "output": 0.79},
            },
            # L-64 secondary — must NOT be reflected in the purpose entry
            {
                "name": "mid",
                "provider_name": "openai",
                "model": "gpt-4o-mini",
                "type": "language",
                "cost_per_million": {"input": 3.0, "output": 15.0},
            },
        ],
        "purposes": [
            {"name": "analysis", "description": "Analysis",
             "models": ["fast", "mid"]},
        ],
    }
}


def _find(items, name):
    return next((m for m in items if m.get("name") == name), None)


def _list_body(client: FQCClient, resolver: str):
    r = client.call_tool("call_model", resolver=resolver)
    if not r.ok:
        return None, f"isError true. text={r.text[:300]}"
    try:
        return json.loads(r.text), ""
    except Exception as e:
        return None, f"JSON parse error: {e}; text={r.text[:300]}"


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    env = _load_env_file(project_dir) if project_dir else {}
    if "OPENAI_API_KEY" not in os.environ:
        os.environ["OPENAI_API_KEY"] = env.get("OPENAI_API_KEY") or "sk-test-placeholder"

    try:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=CONFIGURED_LLM) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)

            # ── Step L-63: list_models cost fields are byte-equal to YAML ──
            body, err = _list_body(client, "list_models")
            if body is None:
                run.step(
                    label="L-63: list_models setup",
                    passed=False,
                    detail=err,
                )
                return run

            models = body.get("models", [])
            precise = _find(models, "precise") or {}

            # The expected values come straight from the configured YAML map above.
            # We assert == on JSON-decoded floats; both pass through the same
            # YAML→JSON path so any drift would be a defect. repr() in detail
            # surfaces precision issues if they ever appear.
            expected_in = 0.594321
            expected_out = 1.234567
            actual_in = precise.get("input_cost_per_million")
            actual_out = precise.get("output_cost_per_million")

            checks = {
                "precise entry present": bool(precise),
                "input_cost_per_million field present":
                    "input_cost_per_million" in precise,
                "output_cost_per_million field present":
                    "output_cost_per_million" in precise,
                "input_cost_per_million byte-equal to 0.594321":
                    actual_in == expected_in,
                "output_cost_per_million byte-equal to 1.234567":
                    actual_out == expected_out,
            }
            ok = all(checks.values())
            failed = [k for k, v in checks.items() if not v]
            detail = (
                f"precise={precise!r}; "
                f"actual_in={actual_in!r} (repr); "
                f"actual_out={actual_out!r} (repr); "
                f"expected_in={expected_in!r}, expected_out={expected_out!r}; "
                f"failed_checks={failed}"
            )
            run.step(
                label="L-63: list_models returns YAML-configured costs byte-for-byte (non-trivial decimals)",
                passed=ok,
                detail=detail,
            )

            # ── Step L-64: list_purposes cost reflects PRIMARY (fast), not mid, not average ──
            body, err = _list_body(client, "list_purposes")
            if body is None:
                run.step(
                    label="L-64: list_purposes setup",
                    passed=False,
                    detail=err,
                )
                return run

            purposes = body.get("purposes", [])
            analysis = _find(purposes, "analysis") or {}

            # Primary model 'fast' rates.
            expected_in = 0.59
            expected_out = 0.79
            # Rejected alternatives we want loud regression signal on:
            mid_in, mid_out = 3.0, 15.0
            avg_in = (0.59 + 3.0) / 2  # ≈ 1.795
            avg_out = (0.79 + 15.0) / 2  # ≈ 7.895

            actual_in = analysis.get("input_cost_per_million")
            actual_out = analysis.get("output_cost_per_million")

            checks = {
                "analysis entry present": bool(analysis),
                "input_cost_per_million field present":
                    "input_cost_per_million" in analysis,
                "output_cost_per_million field present":
                    "output_cost_per_million" in analysis,
                "input matches primary (fast) 0.59": actual_in == expected_in,
                "output matches primary (fast) 0.79": actual_out == expected_out,
                "input is NOT secondary (mid) 3.0": actual_in != mid_in,
                "output is NOT secondary (mid) 15.0": actual_out != mid_out,
                "input is NOT average (~1.795)": actual_in != avg_in,
                "output is NOT average (~7.895)": actual_out != avg_out,
            }
            ok = all(checks.values())
            failed = [k for k, v in checks.items() if not v]
            detail = (
                f"analysis={analysis!r}; "
                f"actual_in={actual_in!r} (repr), actual_out={actual_out!r} (repr); "
                f"expected primary fast=({expected_in!r}, {expected_out!r}); "
                f"rejected secondary mid=({mid_in!r}, {mid_out!r}); "
                f"rejected average=({avg_in!r}, {avg_out!r}); "
                f"failed_checks={failed}"
            )
            run.step(
                label="L-64: list_purposes cost reflects primary model (fast), not secondary (mid), not average",
                passed=ok,
                detail=detail,
            )

    except Exception as e:
        run.step(label="Test crashed", passed=False, detail=str(e))

    return run


def main() -> int:
    parser = argparse.ArgumentParser(description=TEST_NAME)
    parser.add_argument("--managed", action="store_true", required=True)
    parser.add_argument("--fqc-dir", default=None)
    parser.add_argument("--vault-path", type=str, default=None)
    parser.add_argument("--url", default=None)
    parser.add_argument("--secret", default=None)
    args = parser.parse_args()
    run = run_test(args)
    for line in run.summary_lines():
        print(line, file=sys.stderr)
    return run.exit_code


if __name__ == "__main__":
    sys.exit(main())
