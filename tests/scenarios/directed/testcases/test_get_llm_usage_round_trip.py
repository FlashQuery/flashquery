#!/usr/bin/env python3
"""
Test: get_llm_usage round-trip cost equality + no-row-on-failure (L-46, L-67).

Scenario:
    1. Configure a single OpenAI-compatible model with non-trivial decimal cost rates so
       the persisted cost has precision worth byte-for-byte checking.
    2. L-46 — Round-trip cost equality:
        a. Make a successful call_model with a fresh trace_id T, capture
           metadata.cost_usd (X) from the envelope.
        b. Sleep INTER_CALL_SLEEP_SEC so the fire-and-forget fqc_llm_usage row commits.
        c. Call get_llm_usage(mode=recent, limit=1, trace_id=T) and assert
           entries[0].cost_usd === X (strict equality — JSON round-tripped floats).
    3. L-67 — Failed call writes NO row:
        a. Seed: one successful call_model with a fresh trace_id T2.
        b. Sleep, then snapshot get_llm_usage(mode=summary, period=24h, trace_id=T2)
           total_calls (N).
        c. Make a failing call_model with {{ref:nonexistent.md}} sharing trace_id=T2.
           Assert isError:true, error == reference_resolution_failed.
        d. Sleep again, then re-query summary with the same trace filter and assert
           total_calls is unchanged (the failed call wrote no fqc_llm_usage row).

Coverage points: L-46, L-67

Modes:
    --managed   Required (starts dedicated FQC subprocess)

Usage:
    python test_get_llm_usage_round_trip.py --managed

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

TEST_NAME = "test_get_llm_usage_round_trip"
COVERAGE = ["L-46", "L-67"]
REQUIRES_MANAGED = True

# Sleep between a fire-and-forget call_model invocation and a get_llm_usage query
# that depends on the previous row being committed. Matches the convention used
# in test_call_model_trace_arithmetic.py.
INTER_CALL_SLEEP_SEC = 3

# Non-trivial decimal cost rates so the persisted cost has precision worth
# byte-for-byte checking. A round-trip drift would surface as a cost mismatch.
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

    trace_rt = f"trace-rt-{_uuid.uuid4().hex[:8]}"
    trace_fail = f"trace-fail-{_uuid.uuid4().hex[:8]}"

    try:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=CONFIGURED_LLM) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)

            # ── Step 1: L-46 setup — successful call_model, capture cost_usd ──
            r1 = client.call_tool(
                "call_model",
                resolver="model",
                name="fast",
                messages=[{"role": "user", "content": "Reply with just the digit 1."}],
                trace_id=trace_rt,
            )
            if not (r1 and r1.ok):
                run.step(
                    label="L-46 Setup: successful call_model",
                    passed=False,
                    detail=f"call_model failed: {str(r1)[:500]}",
                )
                return run

            try:
                env_obj = json.loads(r1.text)
            except (json.JSONDecodeError, TypeError) as exc:
                run.step(
                    label="L-46 Setup: parse call_model envelope",
                    passed=False,
                    detail=f"JSON parse error: {exc} — raw: {str(r1.text)[:300]}",
                )
                return run

            meta = env_obj.get("metadata", {}) if isinstance(env_obj, dict) else {}
            cost_usd_X = meta.get("cost_usd")
            traceback_id = meta.get("trace_id")

            seed_ok_checks = {
                "metadata.cost_usd is numeric": isinstance(cost_usd_X, (int, float)),
                "metadata.trace_id matches seed": traceback_id == trace_rt,
            }
            run.step(
                label="L-46 Setup: call_model returned cost_usd + trace_id in metadata",
                passed=all(seed_ok_checks.values()),
                detail=(
                    f"cost_usd={cost_usd_X!r} (repr={cost_usd_X!r}), "
                    f"trace_id={traceback_id!r} (expected {trace_rt!r}), "
                    f"checks={seed_ok_checks}"
                ),
                timing_ms=r1.timing_ms,
                tool_result=r1,
            )
            if not all(seed_ok_checks.values()):
                return run

            # Allow the fire-and-forget fqc_llm_usage write to commit before query.
            time.sleep(INTER_CALL_SLEEP_SEC)

            # ── Step 2: L-46 assertion — round-trip cost equality ─────
            r2 = client.call_tool(
                "get_llm_usage",
                mode="recent",
                limit=1,
                trace_id=trace_rt,
            )
            if not (r2 and r2.ok):
                run.step(
                    label="L-46: get_llm_usage(recent, limit=1, trace_id=T) returned isError:false",
                    passed=False,
                    detail=f"get_llm_usage failed: {str(r2)[:500]}",
                )
                return run

            try:
                usage = json.loads(r2.text)
            except (json.JSONDecodeError, TypeError) as exc:
                run.step(
                    label="L-46: parse get_llm_usage response",
                    passed=False,
                    detail=f"JSON parse error: {exc} — raw: {str(r2.text)[:300]}",
                )
                return run

            entries = usage.get("entries", []) if isinstance(usage, dict) else []
            entry_cost = entries[0].get("cost_usd") if entries else None
            entry_trace = entries[0].get("trace_id") if entries else None

            # L-46 tolerance: envelope cost_usd carries IEEE-754 binary FP noise
            # (e.g. 0.000009640000000000001) while the persisted Supabase row is
            # stored in NUMERIC(18,10) (per src/storage/supabase.ts:511) which
            # strips the FP tail to 0.00000964. Both are correct representations
            # of the same arithmetic; strict equality is over-specified. Match
            # L-47's tolerance approach for total_cost_usd. L-40 separately pins
            # the formula-exactness within ±1e-9.
            cost_delta = (
                abs(entry_cost - cost_usd_X)
                if isinstance(entry_cost, (int, float)) and isinstance(cost_usd_X, (int, float))
                else None
            )
            l46_checks = {
                "exactly 1 entry returned for trace": isinstance(entries, list) and len(entries) == 1,
                "entry.trace_id matches seed": entry_trace == trace_rt,
                "entry.cost_usd is numeric": isinstance(entry_cost, (int, float)),
                "entry.cost_usd ≈ metadata.cost_usd (±1e-9)":
                    cost_delta is not None and cost_delta <= 1e-9,
            }
            run.step(
                label="L-46: get_llm_usage round-trip cost_usd matches call_model cost_usd within ±1e-9",
                passed=all(l46_checks.values()),
                detail=(
                    f"checks={l46_checks}, "
                    f"call_model.cost_usd={cost_usd_X!r}, "
                    f"entry.cost_usd={entry_cost!r}, "
                    f"delta={cost_delta!r}, "
                    f"entry.trace_id={entry_trace!r}, "
                    f"entries_len={len(entries)}"
                ),
                timing_ms=r2.timing_ms,
                tool_result=r2,
            )

            # ── Step 3: L-67 setup — seed one successful call with new trace ──
            r3 = client.call_tool(
                "call_model",
                resolver="model",
                name="fast",
                messages=[{"role": "user", "content": "Reply with just the digit 2."}],
                trace_id=trace_fail,
            )
            if not (r3 and r3.ok):
                run.step(
                    label="L-67 Setup: seed successful call_model with trace_fail",
                    passed=False,
                    detail=f"call_model failed: {str(r3)[:500]}",
                )
                return run
            run.step(
                label="L-67 Setup: seed successful call_model with trace_fail",
                passed=True,
                detail=f"trace_id={trace_fail!r}",
                timing_ms=r3.timing_ms,
                tool_result=r3,
            )

            # Allow seed to commit before pre-snapshot.
            time.sleep(INTER_CALL_SLEEP_SEC)

            # ── Step 4: L-67 pre-snapshot — count rows for trace_fail ─
            r4 = client.call_tool(
                "get_llm_usage",
                mode="summary",
                period="24h",
                trace_id=trace_fail,
            )
            if not (r4 and r4.ok):
                run.step(
                    label="L-67: pre-fail get_llm_usage(summary, trace_id) returned isError:false",
                    passed=False,
                    detail=f"get_llm_usage failed: {str(r4)[:500]}",
                )
                return run

            try:
                pre = json.loads(r4.text)
            except (json.JSONDecodeError, TypeError) as exc:
                run.step(
                    label="L-67: parse pre-fail summary",
                    passed=False,
                    detail=f"JSON parse error: {exc} — raw: {str(r4.text)[:300]}",
                )
                return run

            total_calls_before = pre.get("total_calls")
            run.step(
                label="L-67 Setup: captured pre-fail total_calls (expected >= 1 from seed)",
                passed=isinstance(total_calls_before, int) and total_calls_before >= 1,
                detail=(
                    f"total_calls_before={total_calls_before!r}, "
                    f"trace_id={trace_fail!r}, mode=summary, period=24h"
                ),
                timing_ms=r4.timing_ms,
                tool_result=r4,
            )

            # ── Step 5: L-67 — failed call_model with same trace_id ───
            ghost_ref = f"Nonexistent/ghost_llm67_{_uuid.uuid4().hex[:6]}.md"
            r5 = client.call_tool(
                "call_model",
                resolver="model",
                name="fast",
                messages=[
                    {"role": "user",
                     "content": f"{{{{ref:{ghost_ref}}}}} reply"},
                ],
                trace_id=trace_fail,
            )
            try:
                fail_resp = json.loads(r5.text) if r5 and r5.text else {}
            except (json.JSONDecodeError, TypeError):
                fail_resp = {}

            fail_checks = {
                "isError:true": bool(r5) and (not r5.ok),
                "error == reference_resolution_failed":
                    fail_resp.get("error") == "reference_resolution_failed",
            }
            run.step(
                label="L-67: failed call_model with {{ref:nonexistent.md}} returned reference_resolution_failed",
                passed=all(fail_checks.values()),
                detail=(
                    f"checks={fail_checks}, "
                    f"resp_keys={list(fail_resp.keys())}, "
                    f"trace_id={trace_fail!r}"
                ),
                timing_ms=r5.timing_ms if r5 else None,
                tool_result=r5,
            )
            if not all(fail_checks.values()):
                return run

            # Allow any (incorrectly) written row to commit before post-snapshot.
            time.sleep(INTER_CALL_SLEEP_SEC)

            # ── Step 6: L-67 post-snapshot — count must be unchanged ──
            r6 = client.call_tool(
                "get_llm_usage",
                mode="summary",
                period="24h",
                trace_id=trace_fail,
            )
            if not (r6 and r6.ok):
                run.step(
                    label="L-67: post-fail get_llm_usage(summary, trace_id) returned isError:false",
                    passed=False,
                    detail=f"get_llm_usage failed: {str(r6)[:500]}",
                )
                return run

            try:
                post = json.loads(r6.text)
            except (json.JSONDecodeError, TypeError) as exc:
                run.step(
                    label="L-67: parse post-fail summary",
                    passed=False,
                    detail=f"JSON parse error: {exc} — raw: {str(r6.text)[:300]}",
                )
                return run

            total_calls_after = post.get("total_calls")
            l67_unchanged = (
                isinstance(total_calls_after, int)
                and isinstance(total_calls_before, int)
                and total_calls_after == total_calls_before
            )
            run.step(
                label="L-67: total_calls unchanged after failed call (no fqc_llm_usage row written)",
                passed=l67_unchanged,
                detail=(
                    f"total_calls_before={total_calls_before!r}, "
                    f"total_calls_after={total_calls_after!r}, "
                    f"trace_id={trace_fail!r}, "
                    f"delta={(total_calls_after - total_calls_before) if isinstance(total_calls_after, int) and isinstance(total_calls_before, int) else 'n/a'!r}"
                ),
                timing_ms=r6.timing_ms,
                tool_result=r6,
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
    parser.add_argument("--vault-path", default=None)
    parser.add_argument("--url", default=None)
    parser.add_argument("--secret", default=None)
    args = parser.parse_args()
    run = run_test(args)
    for line in run.summary_lines():
        print(line, file=sys.stderr)
    return run.exit_code


if __name__ == "__main__":
    sys.exit(main())
