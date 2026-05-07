#!/usr/bin/env python3
"""
Test: call_model zero-cost path (L-41) and list_models cost-fields-not-omitted-when-zero (L-65).
- L-41: metadata.cost_usd === 0 exactly (strict numeric equality) when the resolved model is
        configured with cost_per_million.input: 0 AND cost_per_million.output: 0 — exercises
        the local/Ollama zero-cost path (verified using a model that points at OpenAI but
        declares 0/0 rates, so the cost-tracking math runs locally and yields tokens × 0 = 0).
- L-65: call_model with resolver=list_models for a model configured with
        cost_per_million: { input: 0, output: 0 } returns response entry with the literal keys
        "input_cost_per_million" === 0 AND "output_cost_per_million" === 0 (key present,
        value strictly === 0). Cost fields are NOT omitted (they are required per §8.2.1) and
        are NOT null. Verifies the omit-when-absent rule (L-39k) does NOT apply to required
        cost fields — zero is treated as a declared value, not absence.
Coverage: L-41, L-65
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_call_model_zero_cost.py --managed
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

TEST_NAME = "test_call_model_zero_cost"
COVERAGE = ["L-41", "L-65"]
REQUIRES_MANAGED = True

# Single model "local-zero" with both cost rates set to 0. Provider points at the real OpenAI
# endpoint (so call_model will succeed against gpt-4o-mini), but the cost-tracking math runs
# in FlashQuery — tokens × 0 / 1e6 == 0, exercising the zero-cost path without needing
# Ollama running locally.
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
                "name": "local-zero",
                "provider_name": "openai",
                "model": "gpt-4o-mini",
                "type": "language",
                "cost_per_million": {"input": 0, "output": 0},
            },
        ],
        "purposes": [],
    }
}


def _find(models, name):
    return next((m for m in models if m.get("name") == name), None)


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    env = _load_env_file(project_dir) if project_dir else {}
    if "OPENAI_API_KEY" not in os.environ:
        os.environ["OPENAI_API_KEY"] = env.get("OPENAI_API_KEY") or "sk-test-placeholder"

    try:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=CONFIGURED_LLM) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)

            # ── Step L-41: cost_usd === 0 exactly on call_model with zero-cost rates ─
            call_result = client.call_tool("call_model", **{
                "resolver": "model",
                "name": "local-zero",
                "messages": [{"role": "user", "content": "Reply OK."}],
            })

            if not (call_result and call_result.ok):
                run.step(
                    label="L-41: metadata.cost_usd === 0 (zero-cost path)",
                    passed=False,
                    detail=f"call_model failed: {str(call_result)[:500]}",
                )
            else:
                try:
                    envelope = json.loads(call_result.text)
                except (json.JSONDecodeError, TypeError) as exc:
                    run.step(
                        label="L-41: metadata.cost_usd === 0 (zero-cost path)",
                        passed=False,
                        detail=(
                            f"JSON parse error: {exc} — raw: {str(call_result.text)[:300]}"
                        ),
                    )
                else:
                    meta = envelope.get("metadata", {}) if isinstance(envelope, dict) else {}
                    cost_usd = meta.get("cost_usd", "MISSING")
                    # Strict numeric equality: cost_usd must be a number AND == 0.
                    # Reject None, missing, or any non-zero value (including 1e-15).
                    is_number = isinstance(cost_usd, (int, float)) and not isinstance(cost_usd, bool)
                    cost_ok = is_number and cost_usd == 0
                    run.step(
                        label="L-41: metadata.cost_usd === 0 (zero-cost path)",
                        passed=cost_ok,
                        detail=(
                            f"cost_usd={cost_usd!r} (type={type(cost_usd).__name__}); "
                            f"is_number={is_number}; equals_zero={is_number and cost_usd == 0}; "
                            f"expected: numeric value strictly == 0 for model with "
                            f"cost_per_million.input=0 AND output=0"
                        ),
                    )

            # ── Step L-65: list_models entry has cost keys present with value === 0 ───
            list_result = client.call_tool("call_model", resolver="list_models")

            if not (list_result and list_result.ok):
                run.step(
                    label="L-65: list_models entry has zero cost keys present (not omitted, not null)",
                    passed=False,
                    detail=f"list_models failed: {str(list_result)[:500]}",
                )
            else:
                try:
                    body = json.loads(list_result.text)
                except (json.JSONDecodeError, TypeError) as exc:
                    run.step(
                        label="L-65: list_models entry has zero cost keys present (not omitted, not null)",
                        passed=False,
                        detail=(
                            f"JSON parse error: {exc} — raw: {str(list_result.text)[:300]}"
                        ),
                    )
                else:
                    models = body.get("models", []) if isinstance(body, dict) else []
                    entry = _find(models, "local-zero") or {}
                    input_present = "input_cost_per_million" in entry
                    output_present = "output_cost_per_million" in entry
                    input_val = entry.get("input_cost_per_million", "MISSING")
                    output_val = entry.get("output_cost_per_million", "MISSING")
                    # Strict: keys MUST be present AND each value MUST equal 0 (and not be None).
                    input_ok = (
                        input_present
                        and input_val is not None
                        and isinstance(input_val, (int, float))
                        and not isinstance(input_val, bool)
                        and input_val == 0
                    )
                    output_ok = (
                        output_present
                        and output_val is not None
                        and isinstance(output_val, (int, float))
                        and not isinstance(output_val, bool)
                        and output_val == 0
                    )
                    all_ok = bool(entry) and input_ok and output_ok
                    run.step(
                        label="L-65: list_models entry has zero cost keys present (not omitted, not null)",
                        passed=all_ok,
                        detail=(
                            f"entry={entry!r}; "
                            f"input_cost_per_million present={input_present}, "
                            f"value={input_val!r} (type={type(input_val).__name__}); "
                            f"output_cost_per_million present={output_present}, "
                            f"value={output_val!r} (type={type(output_val).__name__}); "
                            f"expected: both keys present with strict numeric value == 0"
                        ),
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
    parser.add_argument("--vault-path", type=str, default=None)
    args = parser.parse_args()
    run = run_test(args)
    for line in run.summary_lines():
        print(line, file=sys.stderr)
    return run.exit_code


if __name__ == "__main__":
    sys.exit(main())
