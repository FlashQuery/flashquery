#!/usr/bin/env python3
"""
Test: call_model cost_usd exact arithmetic, token positivity, and precision (L-40, L-42, L-43).

Scenario:
    1. Configure ONE OpenAI-compatible model 'fast' with non-trivial decimal rates
       cost_per_million: {input: 0.59, output: 0.79}.
    2. Make ONE successful call_model invocation with a small short message
       expected to produce ~10 input + ~10 output tokens.
    3. From the single response metadata, assert all three behaviors:
         - L-42: tokens.input and tokens.output are both positive integers.
         - L-40: cost_usd === (tokens.input * rin + tokens.output * rout) / 1_000_000
                 within ±1e-9, with rin/rout READ FROM CONFIGURED_LLM (not hardcoded).
         - L-43: cost_usd precision is preserved beyond 4-decimal display rounding —
                 cost_usd != round(cost_usd, 4) (small-token call yields ~1.38e-5).

Coverage points: L-40, L-42, L-43

Note: The coverage spec uses metadata.tokens_used.{input,output} as the field path,
but the FlashQuery codebase emits metadata.tokens.{input,output}. This test asserts on
metadata.tokens which is what the implementation actually returns.

Modes:
    --managed   Required (starts dedicated FQC subprocess)

Usage:
    python test_call_model_cost_arithmetic_strict.py --managed

Exit codes:
    0   PASS    All steps passed
    2   FAIL    One or more steps failed
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


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_call_model_cost_arithmetic_strict"
COVERAGE = ["L-40", "L-42", "L-43"]
REQUIRES_MANAGED = True

# Tolerance for L-40 cost_usd arithmetic — 1e-9 per the coverage spec.
COST_TOLERANCE = 1e-9

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
                # Non-trivial decimals — chosen so a swap of input/output rates or a
                # `+`→`*` flip is detectable, and so a small-token call produces a
                # cost value that exercises precision past 4 decimals.
                "cost_per_million": {"input": 0.59, "output": 0.79},
            },
        ],
        "purposes": [],
    }
}


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    env = _load_env_file(project_dir) if project_dir else {}
    if "OPENAI_API_KEY" not in os.environ:
        os.environ["OPENAI_API_KEY"] = env.get("OPENAI_API_KEY") or "sk-test-placeholder"

    # Read rates back from CONFIGURED_LLM so the assertion uses the configured
    # values rather than hardcoded literals (per L-40 spec).
    cpm = CONFIGURED_LLM["llm"]["models"][0]["cost_per_million"]
    rin_per_million = float(cpm["input"])
    rout_per_million = float(cpm["output"])

    try:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=CONFIGURED_LLM) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)

            result = client.call_tool(
                "call_model",
                resolver="model",
                name="fast",
                messages=[{"role": "user", "content": "Reply with just the word OK."}],
            )

            if not (result and result.ok):
                run.step(
                    label="Setup: call_model invocation succeeded",
                    passed=False,
                    detail=f"call_model failed: {str(result)[:500]}",
                )
                return run

            try:
                envelope = json.loads(result.text)
            except (json.JSONDecodeError, TypeError) as exc:
                run.step(
                    label="Setup: parse call_model envelope",
                    passed=False,
                    detail=f"JSON parse error: {exc} — raw: {str(result.text)[:300]}",
                )
                return run

            meta = envelope.get("metadata", {}) if isinstance(envelope, dict) else {}
            tokens = meta.get("tokens", {}) if isinstance(meta, dict) else {}
            tin = tokens.get("input") if isinstance(tokens, dict) else None
            tout = tokens.get("output") if isinstance(tokens, dict) else None
            cost_usd = meta.get("cost_usd")

            run.step(
                label="Setup: call_model invocation succeeded",
                passed=True,
                detail=(
                    f"tokens.input={tin!r}, tokens.output={tout!r}, cost_usd={cost_usd!r}; "
                    f"rates: input={rin_per_million}/M, output={rout_per_million}/M"
                ),
            )

            # ── L-42: tokens.input/output are positive integers ──────────
            l42_checks = {
                "tokens.input is int": isinstance(tin, int) and not isinstance(tin, bool),
                "tokens.output is int": isinstance(tout, int) and not isinstance(tout, bool),
                "tokens.input > 0": isinstance(tin, int) and tin > 0,
                "tokens.output > 0": isinstance(tout, int) and tout > 0,
            }
            run.step(
                label="L-42: metadata.tokens.input/output are positive integers",
                passed=all(l42_checks.values()),
                detail=(
                    f"checks={l42_checks}, "
                    f"tokens.input={tin!r} (type={type(tin).__name__}), "
                    f"tokens.output={tout!r} (type={type(tout).__name__})"
                ),
            )

            # If L-42 failed, downstream arithmetic assertions will be misleading.
            if not all(l42_checks.values()):
                run.step(
                    label="L-40: metadata.cost_usd exact arithmetic",
                    passed=False,
                    detail="skipped — L-42 token positivity check failed",
                )
                run.step(
                    label="L-43: metadata.cost_usd precision preserved past 4 decimals",
                    passed=False,
                    detail="skipped — L-42 token positivity check failed",
                )
                return run

            # ── L-40: cost_usd exact arithmetic against configured rates ─
            expected_cost = (tin * rin_per_million + tout * rout_per_million) / 1_000_000
            cost_is_number = isinstance(cost_usd, (int, float)) and not isinstance(cost_usd, bool)
            cost_diff = (
                float(cost_usd) - expected_cost if cost_is_number else None
            )
            l40_ok = (
                cost_is_number
                and abs(float(cost_usd) - expected_cost) <= COST_TOLERANCE
            )
            run.step(
                label="L-40: cost_usd === (tin*rin + tout*rout) / 1_000_000 (±1e-9)",
                passed=l40_ok,
                detail=(
                    f"expected={expected_cost!r}, actual={cost_usd!r}, "
                    f"diff={cost_diff!r}, tolerance={COST_TOLERANCE}, "
                    f"formula: ({tin} * {rin_per_million} + {tout} * {rout_per_million}) / 1_000_000"
                ),
            )

            # ── L-43: cost_usd precision preserved beyond 4 decimal display ─
            # With rates 0.59/0.79 and ~10 in / ~10 out tokens, expected cost
            # is ~= 1.38e-5, well past 4-decimal precision. If cost_usd were
            # ever passed through toFixed(4) before being returned, this would
            # round to 0.0000 and equal round(cost_usd, 4) trivially.
            if cost_is_number:
                rounded_4 = round(float(cost_usd), 4)
                l43_ok = float(cost_usd) != rounded_4
                l43_detail = (
                    f"cost_usd={cost_usd!r}, round(cost_usd, 4)={rounded_4!r}, "
                    f"differ={l43_ok} — passes if cost_usd retains precision past 4 decimals"
                )
            else:
                l43_ok = False
                l43_detail = f"cost_usd is not a number: {cost_usd!r}"
            run.step(
                label="L-43: cost_usd precision preserved past 4-decimal rounding",
                passed=l43_ok,
                detail=l43_detail,
            )

    except Exception as e:  # noqa: BLE001
        run.step(label="server lifecycle", passed=False, detail=f"exception: {type(e).__name__}: {e}")
    return run


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description=TEST_NAME,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--fqc-dir", default=None)
    parser.add_argument("--managed", action="store_true", required=True)
    parser.add_argument("--url", default=None)
    parser.add_argument("--secret", default=None)
    parser.add_argument("--vault-path", default=None)
    args = parser.parse_args()
    run = run_test(args)
    for line in run.summary_lines():
        print(line, file=sys.stderr)
    return run.exit_code


if __name__ == "__main__":
    sys.exit(main())
