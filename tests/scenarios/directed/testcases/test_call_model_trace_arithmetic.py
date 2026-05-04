#!/usr/bin/env python3
"""
Test: call_model trace_cumulative exact arithmetic across 3 sequential calls (L-47, L-48).

Scenario:
    1. Configure a single OpenAI-compatible model with non-zero cost rates.
    2. Make 3 sequential call_model calls sharing the same trace_id, capturing per-call
       metadata.cost_usd and metadata.tokens.input/output. Sleep between calls so the
       previous row commits before the next call's pre-snapshot query (the trace_cumulative
       implementation queries fqc_llm_usage BEFORE the LLM call and adds the current call
       in-memory; without the sleep, prior rows may not be visible against cloud Supabase).
    3. Assert on the 3rd response:
         - L-47: trace_cumulative.total_cost_usd === c1 + c2 + c3 within ±1e-9
         - L-48: trace_cumulative.total_tokens.input === sum of per-call inputs (strict ==)
                 trace_cumulative.total_tokens.output === sum of per-call outputs (strict ==)

Coverage points: L-47, L-48

Modes:
    --managed   Required (starts dedicated FQC subprocess)

Usage:
    python test_call_model_trace_arithmetic.py --managed

Exit codes:
    0   PASS    All steps passed
    2   FAIL    One or more steps failed
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import uuid as _uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestRun, FQCServer  # noqa: E402
from fqc_client import FQCClient, _find_project_dir, _load_env_file  # noqa: E402


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_call_model_trace_arithmetic"
COVERAGE = ["L-47", "L-48"]
REQUIRES_MANAGED = True

# Sleep between sequential calls so the previous fire-and-forget fqc_llm_usage row
# commits before the next call's pre-snapshot query runs. Without this, the test
# passes against local Supabase (sub-millisecond writes) and fails against cloud
# Supabase where network latency exposes the race.
INTER_CALL_SLEEP_SEC = 3

# Tolerance for L-47 cost_usd arithmetic — 1e-9 per the coverage spec.
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
                # Non-trivial decimals so a swap or arithmetic regression shows up.
                "cost_per_million": {"input": 0.59, "output": 0.79},
            },
        ],
        "purposes": [],
    }
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _per_call_metrics(envelope: dict) -> tuple[float | None, int | None, int | None]:
    """Pull (cost_usd, tokens.input, tokens.output) from a call_model response envelope."""
    meta = envelope.get("metadata", {}) if isinstance(envelope, dict) else {}
    cost = meta.get("cost_usd")
    tokens = meta.get("tokens", {}) if isinstance(meta, dict) else {}
    tin = tokens.get("input") if isinstance(tokens, dict) else None
    tout = tokens.get("output") if isinstance(tokens, dict) else None
    return cost, tin, tout


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    env = _load_env_file(project_dir) if project_dir else {}
    if "OPENAI_API_KEY" not in os.environ:
        os.environ["OPENAI_API_KEY"] = env.get("OPENAI_API_KEY") or "sk-test-placeholder"

    trace_id = f"trace-arith-{_uuid.uuid4().hex[:8]}"

    try:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=CONFIGURED_LLM) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)

            per_call: list[tuple[float, int, int]] = []
            envelopes: list[dict] = []

            for idx in range(3):
                r = client.call_tool(
                    "call_model",
                    resolver="model",
                    name="fast",
                    messages=[{"role": "user", "content": f"Reply with the digit {idx + 1}."}],
                    trace_id=trace_id,
                )
                if not (r and r.ok):
                    run.step(
                        label=f"Setup: call_model invocation #{idx + 1}",
                        passed=False,
                        detail=f"call_model failed: {str(r)[:500]}",
                    )
                    return run

                try:
                    env_obj = json.loads(r.text)
                except (json.JSONDecodeError, TypeError) as exc:
                    run.step(
                        label=f"Setup: parse envelope #{idx + 1}",
                        passed=False,
                        detail=f"JSON parse error: {exc} — raw: {str(r.text)[:300]}",
                    )
                    return run

                cost, tin, tout = _per_call_metrics(env_obj)
                if cost is None or tin is None or tout is None:
                    run.step(
                        label=f"Setup: per-call metrics present #{idx + 1}",
                        passed=False,
                        detail=f"missing fields: cost={cost!r}, tokens.input={tin!r}, tokens.output={tout!r}",
                    )
                    return run

                per_call.append((float(cost), int(tin), int(tout)))
                envelopes.append(env_obj)

                # Allow the previous fire-and-forget fqc_llm_usage row to commit
                # before the next call's pre-snapshot query. No sleep needed
                # after the 3rd call because we don't query trace state again.
                if idx < 2:
                    time.sleep(INTER_CALL_SLEEP_SEC)

            run.step(
                label="Setup: 3 sequential call_model invocations succeeded",
                passed=True,
                detail=(
                    f"per_call=[(cost={per_call[0][0]:.10f}, in={per_call[0][1]}, out={per_call[0][2]}), "
                    f"(cost={per_call[1][0]:.10f}, in={per_call[1][1]}, out={per_call[1][2]}), "
                    f"(cost={per_call[2][0]:.10f}, in={per_call[2][1]}, out={per_call[2][2]})]"
                ),
            )

            # 3rd-call cumulative is what L-47 / L-48 assert against.
            meta_3 = envelopes[2].get("metadata", {})
            cum_3 = meta_3.get("trace_cumulative", {}) if isinstance(meta_3, dict) else {}

            # Sanity check: total_calls should be 3 (snapshot of 2 + current).
            # If this fails, the per-call commit race is back and the arithmetic
            # assertions below will be misleading.
            total_calls = cum_3.get("total_calls")
            run.step(
                label="trace_cumulative.total_calls == 3 on the 3rd call (commit race guard)",
                passed=(total_calls == 3),
                detail=f"total_calls={total_calls!r} (expected 3); cum_3 keys={list(cum_3.keys())}",
            )

            # ── L-47: total_cost_usd ≈ c1 + c2 + c3 within ±1e-9 ────────
            expected_cost = per_call[0][0] + per_call[1][0] + per_call[2][0]
            actual_cost = cum_3.get("total_cost_usd")
            cost_ok = (
                isinstance(actual_cost, (int, float))
                and abs(float(actual_cost) - expected_cost) <= COST_TOLERANCE
            )
            run.step(
                label="L-47: trace_cumulative.total_cost_usd === c1 + c2 + c3 (±1e-9)",
                passed=cost_ok,
                detail=(
                    f"expected={expected_cost!r}, actual={actual_cost!r}, "
                    f"diff={(float(actual_cost) - expected_cost) if isinstance(actual_cost, (int, float)) else 'n/a'!r}, "
                    f"tolerance={COST_TOLERANCE}"
                ),
            )

            # ── L-48: total_tokens.input/output exact integer sums ──────
            expected_in = per_call[0][1] + per_call[1][1] + per_call[2][1]
            expected_out = per_call[0][2] + per_call[1][2] + per_call[2][2]
            total_tokens = cum_3.get("total_tokens", {}) if isinstance(cum_3, dict) else {}
            actual_in = total_tokens.get("input") if isinstance(total_tokens, dict) else None
            actual_out = total_tokens.get("output") if isinstance(total_tokens, dict) else None

            checks = {
                "total_tokens.input is int": isinstance(actual_in, int),
                "total_tokens.output is int": isinstance(actual_out, int),
                "total_tokens.input == sum(per-call inputs)": actual_in == expected_in,
                "total_tokens.output == sum(per-call outputs)": actual_out == expected_out,
            }
            run.step(
                label="L-48: trace_cumulative.total_tokens.input/output exact integer sums",
                passed=all(checks.values()),
                detail=(
                    f"checks={checks}, "
                    f"input: expected={expected_in}, actual={actual_in!r}; "
                    f"output: expected={expected_out}, actual={actual_out!r}"
                ),
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
    args = parser.parse_args()
    run = run_test(args)
    for line in run.summary_lines():
        print(line, file=sys.stderr)
    return run.exit_code


if __name__ == "__main__":
    sys.exit(main())
