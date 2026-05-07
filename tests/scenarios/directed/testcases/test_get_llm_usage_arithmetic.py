#!/usr/bin/env python3
"""
Test: get_llm_usage aggregation arithmetic exactness (L-68, L-69, L-70).

Scenario:
    1. Configure a single OpenAI-compatible model with non-trivial cost rates and
       two purposes ('general', 'analysis') both routed to that model.
    2. L-68 + L-69: seed exactly 3 sequential call_model invocations on a unique
       trace_id, capturing each response's metadata.cost_usd. Sleep between calls
       so per-call fqc_llm_usage rows commit. After the 3rd, query
       get_llm_usage(mode=summary, period=24h, trace_id=...) and assert:
         - L-69: response.total_calls === 3 (strict integer equality).
         - L-68: |response.total_spend_usd - (c1+c2+c3)| <= 1e-9.
    3. L-70: on a separate unique trace_id, seed 2 'general' calls + 2 'analysis'
       calls + 1 direct 'fast' model call (5 total). Query both
       get_llm_usage(mode=summary, ...) and get_llm_usage(mode=by_purpose, ...)
       on the same period+trace_id and assert that
       sum(purposes[].spend_usd) + direct_model_calls.spend_usd ≈ summary.total_spend_usd
       within ±1e-9 (i.e. the by_purpose split is a true partition).

Coverage points: L-68, L-69, L-70

Modes:
    --managed   Required (starts dedicated FQC subprocess)

Usage:
    python test_get_llm_usage_arithmetic.py --managed

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
import time
import uuid as _uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestRun, FQCServer  # noqa: E402
from fqc_client import FQCClient, _find_project_dir, _load_env_file  # noqa: E402


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_get_llm_usage_arithmetic"
COVERAGE = ["L-68", "L-69", "L-70"]
REQUIRES_MANAGED = True

# Sleep between sequential call_model invocations and after the last one so that
# fire-and-forget fqc_llm_usage rows commit before the get_llm_usage queries run.
INTER_CALL_SLEEP_SEC = 3
POST_SEED_SLEEP_SEC = 3

# Tolerance for cost arithmetic — 1e-9 per the coverage spec.
COST_TOLERANCE = 1e-9

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
                # Non-trivial decimals so a swap or arithmetic regression shows up.
                "cost_per_million": {"input": 0.59, "output": 0.79},
            }
        ],
        "purposes": [
            {
                "name": "general",
                "description": "General",
                "models": ["fast"],
                "defaults": {"temperature": 0.7},
            },
            {
                "name": "analysis",
                "description": "Analysis",
                "models": ["fast"],
                "defaults": {"temperature": 0.7},
            },
        ],
    }
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _cost_from_envelope(envelope: dict) -> float | None:
    """Extract metadata.cost_usd from a call_model response envelope."""
    if not isinstance(envelope, dict):
        return None
    meta = envelope.get("metadata", {})
    if not isinstance(meta, dict):
        return None
    cost = meta.get("cost_usd")
    return float(cost) if isinstance(cost, (int, float)) else None


def _seed_call(client: FQCClient, *, resolver: str, name: str, prompt: str, trace_id: str) -> tuple[bool, dict | None, str]:
    """Make a single call_model invocation. Returns (ok, parsed_envelope, error_detail)."""
    r = client.call_tool(
        "call_model",
        resolver=resolver,
        name=name,
        messages=[{"role": "user", "content": prompt}],
        trace_id=trace_id,
    )
    if not (r and r.ok):
        return False, None, f"call_model failed: {str(r)[:500]}"
    try:
        env_obj = json.loads(r.text)
    except (json.JSONDecodeError, TypeError) as exc:
        return False, None, f"JSON parse error: {exc} — raw: {str(r.text)[:300]}"
    return True, env_obj, ""


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    env = _load_env_file(project_dir) if project_dir else {}
    if "OPENAI_API_KEY" not in os.environ:
        os.environ["OPENAI_API_KEY"] = env.get("OPENAI_API_KEY") or "sk-test-placeholder"

    trace_l69 = f"trace-arith-69-{_uuid.uuid4().hex[:8]}"
    trace_l70 = f"trace-arith-70-{_uuid.uuid4().hex[:8]}"

    try:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=CONFIGURED_LLM) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)

            # ── Step 1: Seed 3 sequential call_model invocations on trace_l69 ───
            captured_costs: list[float] = []
            seed_failed_detail = ""
            for idx in range(3):
                ok, envelope, err = _seed_call(
                    client,
                    resolver="purpose",
                    name="general",
                    prompt=f"Reply with the digit {idx + 1}.",
                    trace_id=trace_l69,
                )
                if not ok or envelope is None:
                    seed_failed_detail = f"seed call #{idx + 1} failed: {err}"
                    break
                cost = _cost_from_envelope(envelope)
                if cost is None:
                    seed_failed_detail = (
                        f"seed call #{idx + 1}: metadata.cost_usd missing or non-numeric "
                        f"(envelope keys={list(envelope.keys())})"
                    )
                    break
                captured_costs.append(cost)
                # Sleep between calls so prior fqc_llm_usage row commits.
                if idx < 2:
                    time.sleep(INTER_CALL_SLEEP_SEC)

            seed_ok = (len(captured_costs) == 3 and not seed_failed_detail)
            run.step(
                label="Setup (L-68/L-69): seed 3 call_model invocations on unique trace_id",
                passed=seed_ok,
                detail=(
                    seed_failed_detail
                    if not seed_ok
                    else (
                        f"trace_id={trace_l69!r}, "
                        f"costs=[{captured_costs[0]:.10f}, "
                        f"{captured_costs[1]:.10f}, {captured_costs[2]:.10f}]"
                    )
                ),
            )
            if not seed_ok:
                return run

            # Wait for the final fqc_llm_usage row to commit before querying.
            time.sleep(POST_SEED_SLEEP_SEC)

            # ── Step 2: Query summary on trace_l69 ──────────────────────
            summary_l69 = client.call_tool(
                "get_llm_usage",
                mode="summary",
                period="24h",
                trace_id=trace_l69,
            )
            summary_l69_ok = bool(summary_l69 and summary_l69.ok)
            parsed_l69: dict | None = None
            parse_err_l69 = ""
            if summary_l69_ok and summary_l69:
                try:
                    parsed_l69 = json.loads(summary_l69.text)
                except (json.JSONDecodeError, TypeError) as exc:
                    parse_err_l69 = f"JSON parse error: {exc}"
                    summary_l69_ok = False

            run.step(
                label="get_llm_usage(mode=summary, trace_id=trace_l69) returns parsed JSON",
                passed=summary_l69_ok and parsed_l69 is not None,
                detail=(parse_err_l69 or str(summary_l69)[:500] if not summary_l69_ok else f"parsed keys={list(parsed_l69.keys()) if parsed_l69 else None}"),
            )
            if not summary_l69_ok or parsed_l69 is None:
                return run

            # ── L-69: total_calls === 3 (strict integer) ────────────────
            total_calls = parsed_l69.get("total_calls")
            l69_ok = (isinstance(total_calls, int) and total_calls == 3)
            run.step(
                label="L-69: get_llm_usage summary total_calls === 3 (strict integer)",
                passed=l69_ok,
                detail=(
                    f"total_calls={total_calls!r} (type={type(total_calls).__name__}), "
                    f"expected 3"
                ),
            )

            # ── L-68: total_spend_usd ≈ c1 + c2 + c3 within ±1e-9 ───────
            expected_spend = captured_costs[0] + captured_costs[1] + captured_costs[2]
            actual_spend = parsed_l69.get("total_spend_usd")
            l68_ok = (
                isinstance(actual_spend, (int, float))
                and abs(float(actual_spend) - expected_spend) <= COST_TOLERANCE
            )
            run.step(
                label="L-68: get_llm_usage summary total_spend_usd === sum(per-call cost_usd) within ±1e-9",
                passed=l68_ok,
                detail=(
                    f"expected={expected_spend!r}, actual={actual_spend!r}, "
                    f"diff={(float(actual_spend) - expected_spend) if isinstance(actual_spend, (int, float)) else 'n/a'!r}, "
                    f"tolerance={COST_TOLERANCE}"
                ),
            )

            # ── Step 3: Seed 5 calls (2 general + 2 analysis + 1 direct) on trace_l70 ──
            l70_seed_failed = ""
            l70_calls = 0
            l70_seed_plan = [
                ("purpose", "general", "Reply with the digit 1."),
                ("purpose", "general", "Reply with the digit 2."),
                ("purpose", "analysis", "Reply with the digit 3."),
                ("purpose", "analysis", "Reply with the digit 4."),
                ("model", "fast", "Reply with the digit 5."),
            ]
            for idx, (resolver, name, prompt) in enumerate(l70_seed_plan):
                ok, _envelope, err = _seed_call(
                    client,
                    resolver=resolver,
                    name=name,
                    prompt=prompt,
                    trace_id=trace_l70,
                )
                if not ok:
                    l70_seed_failed = f"seed #{idx + 1} ({resolver}/{name}) failed: {err}"
                    break
                l70_calls += 1
                if idx < len(l70_seed_plan) - 1:
                    time.sleep(INTER_CALL_SLEEP_SEC)

            l70_seed_ok = (l70_calls == 5 and not l70_seed_failed)
            run.step(
                label="Setup (L-70): seed 2x general + 2x analysis + 1x direct call_model",
                passed=l70_seed_ok,
                detail=(
                    l70_seed_failed
                    if not l70_seed_ok
                    else f"trace_id={trace_l70!r}, calls_made={l70_calls}"
                ),
            )
            if not l70_seed_ok:
                return run

            time.sleep(POST_SEED_SLEEP_SEC)

            # ── Step 4: Query summary + by_purpose on trace_l70 ─────────
            summary_l70 = client.call_tool(
                "get_llm_usage",
                mode="summary",
                period="24h",
                trace_id=trace_l70,
            )
            by_purpose_l70 = client.call_tool(
                "get_llm_usage",
                mode="by_purpose",
                period="24h",
                trace_id=trace_l70,
            )

            queries_ok = bool(
                summary_l70 and summary_l70.ok
                and by_purpose_l70 and by_purpose_l70.ok
            )
            parsed_summary: dict | None = None
            parsed_by_purpose: dict | None = None
            parse_err = ""
            if queries_ok:
                try:
                    parsed_summary = json.loads(summary_l70.text)
                    parsed_by_purpose = json.loads(by_purpose_l70.text)
                except (json.JSONDecodeError, TypeError) as exc:
                    parse_err = f"JSON parse error: {exc}"
                    queries_ok = False

            run.step(
                label="get_llm_usage(summary) and (by_purpose) for trace_l70 both succeed",
                passed=queries_ok and parsed_summary is not None and parsed_by_purpose is not None,
                detail=(
                    parse_err
                    or (
                        f"summary={str(summary_l70)[:200]}; "
                        f"by_purpose={str(by_purpose_l70)[:200]}"
                    )
                ),
            )
            if not queries_ok or parsed_summary is None or parsed_by_purpose is None:
                return run

            # ── L-70: by_purpose partition equals summary total ─────────
            summary_total = parsed_summary.get("total_spend_usd")
            purposes_list = parsed_by_purpose.get("purposes")
            direct = parsed_by_purpose.get("direct_model_calls")

            shape_ok = (
                isinstance(summary_total, (int, float))
                and isinstance(purposes_list, list)
                and isinstance(direct, dict)
            )

            if not shape_ok:
                run.step(
                    label="L-70: by_purpose response shape (purposes:list, direct_model_calls:dict, summary.total_spend_usd:number)",
                    passed=False,
                    detail=(
                        f"summary.total_spend_usd={summary_total!r} (type={type(summary_total).__name__}), "
                        f"purposes={type(purposes_list).__name__}, "
                        f"direct_model_calls={type(direct).__name__}; "
                        f"by_purpose keys={list(parsed_by_purpose.keys())}"
                    ),
                )
                return run

            purposes_sum = sum(
                float(p.get("spend_usd", 0))
                for p in purposes_list
                if isinstance(p, dict) and isinstance(p.get("spend_usd"), (int, float))
            )
            direct_spend_raw = direct.get("spend_usd")
            direct_sum = float(direct_spend_raw) if isinstance(direct_spend_raw, (int, float)) else 0.0
            partition_total = purposes_sum + direct_sum

            l70_ok = abs(partition_total - float(summary_total)) <= COST_TOLERANCE

            # Sanity: confirm the by_purpose response actually saw the seeded direct call,
            # otherwise the partition equality could pass trivially against zero state.
            direct_calls_count = direct.get("calls", 0)
            partition_substantive = (
                isinstance(direct_calls_count, int)
                and direct_calls_count >= 1
                and len(purposes_list) >= 2
            )

            run.step(
                label="L-70: sum(purposes[].spend_usd) + direct_model_calls.spend_usd === summary.total_spend_usd (±1e-9)",
                passed=(l70_ok and partition_substantive),
                detail=(
                    f"summary.total_spend_usd={summary_total!r}, "
                    f"purposes_sum={purposes_sum!r} (over {len(purposes_list)} entries), "
                    f"direct.spend_usd={direct_sum!r} (calls={direct_calls_count}), "
                    f"partition_total={partition_total!r}, "
                    f"diff={partition_total - float(summary_total)!r}, "
                    f"tolerance={COST_TOLERANCE}, "
                    f"partition_substantive={partition_substantive}"
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
    parser.add_argument("--vault-path", default=None)
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
