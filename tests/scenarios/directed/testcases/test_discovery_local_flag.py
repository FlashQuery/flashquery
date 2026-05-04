#!/usr/bin/env python3
"""
Test: provider.local flag — explicit declaration, ollama auto-derive,
omit-when-undeclared on openai-compatible, and behavioral non-influence.

Coverage points: L-66a, L-66b, L-66c, L-66d

Scenario:
    1. Configure five providers (each with one model):
       - custom-edge:  openai-compatible, local: true (explicit)         -> L-66a
       - ollama-host:  type: ollama, NO local key (auto-derive)          -> L-66b
       - openai-paid:  openai-compatible, NO local key (omit baseline)   -> L-66c
       - paid-A:       openai-compatible, local: true (regression guard) -> L-66d (with paid-B)
       - paid-B:       openai-compatible, NO local key (regression guard)-> L-66d (with paid-A)
    2. Call call_model(resolver=list_models). Walk the model entries:
       - L-66a: edge-model entry has "local": true (explicit local flag)
       - L-66b: ollama-model entry has "local": true (auto-derived from type=ollama)
       - L-66c: openai-model entry OMITS the "local" key (not present-and-false, not null)
    3. L-66d (regression guard): make real call_model invocations against paid-A-model
       and paid-B-model. Verify both succeed with positive cost_usd. The local flag
       MUST NOT zero-out cost computation, MUST NOT affect routing/dispatch.

Modes:
    --managed   Required (starts dedicated FQC subprocess)

Usage:
    python test_discovery_local_flag.py --managed

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

TEST_NAME = "test_discovery_local_flag"
COVERAGE = ["L-66a", "L-66b", "L-66c", "L-66d"]
REQUIRES_MANAGED = True


CONFIGURED_LLM = {
    "llm": {
        "providers": [
            # L-66a: openai-compatible, explicit local=true
            {
                "name": "custom-edge",
                "type": "openai-compatible",
                "endpoint": "https://api.openai.com",
                "api_key": "${OPENAI_API_KEY}",
                "local": True,
            },
            # L-66b: ollama, no local key (auto-derive)
            {
                "name": "ollama-host",
                "type": "ollama",
                "endpoint": "http://localhost:11434",
            },
            # L-66c: openai-compatible, no local key (baseline omit)
            {
                "name": "openai-paid",
                "type": "openai-compatible",
                "endpoint": "https://api.openai.com",
                "api_key": "${OPENAI_API_KEY}",
            },
            # L-66d-A: openai-compatible, local=true (regression guard mirror of paid-B)
            {
                "name": "paid-A",
                "type": "openai-compatible",
                "endpoint": "https://api.openai.com",
                "api_key": "${OPENAI_API_KEY}",
                "local": True,
            },
            # L-66d-B: openai-compatible, NO local
            {
                "name": "paid-B",
                "type": "openai-compatible",
                "endpoint": "https://api.openai.com",
                "api_key": "${OPENAI_API_KEY}",
            },
        ],
        "models": [
            {
                "name": "edge-model",
                "provider_name": "custom-edge",
                "model": "gpt-4o-mini",
                "type": "language",
                "cost_per_million": {"input": 0.15, "output": 0.6},
            },
            {
                "name": "ollama-model",
                "provider_name": "ollama-host",
                "model": "llama3",
                "type": "language",
                "cost_per_million": {"input": 0, "output": 0},
            },
            {
                "name": "openai-model",
                "provider_name": "openai-paid",
                "model": "gpt-4o-mini",
                "type": "language",
                "cost_per_million": {"input": 0.15, "output": 0.6},
            },
            {
                "name": "paid-A-model",
                "provider_name": "paid-A",
                "model": "gpt-4o-mini",
                "type": "language",
                "cost_per_million": {"input": 0.15, "output": 0.6},
            },
            {
                "name": "paid-B-model",
                "provider_name": "paid-B",
                "model": "gpt-4o-mini",
                "type": "language",
                "cost_per_million": {"input": 0.15, "output": 0.6},
            },
        ],
        "purposes": [],
    }
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find(models, name):
    return next((m for m in models if m.get("name") == name), None)


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    env = _load_env_file(project_dir) if project_dir else {}
    if "OPENAI_API_KEY" not in os.environ:
        os.environ["OPENAI_API_KEY"] = env.get("OPENAI_API_KEY") or "sk-test-placeholder"

    try:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=CONFIGURED_LLM) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)

            # ── Setup: list_models ────────────────────────────────────
            r = client.call_tool("call_model", resolver="list_models")
            if not (r and r.ok):
                run.step(
                    label="Setup: list_models call returned ok",
                    passed=False,
                    detail=f"call_model failed: {str(r)[:500]}",
                )
                return run

            try:
                body = json.loads(r.text)
            except (json.JSONDecodeError, TypeError) as exc:
                run.step(
                    label="Setup: parse list_models JSON",
                    passed=False,
                    detail=f"JSON parse error: {exc} — raw: {str(r.text)[:300]}",
                )
                return run

            models = body.get("models", []) if isinstance(body, dict) else []
            edge = _find(models, "edge-model") or {}
            ollama = _find(models, "ollama-model") or {}
            openai_m = _find(models, "openai-model") or {}

            run.step(
                label="Setup: list_models returned model entries for all providers",
                passed=bool(edge) and bool(ollama) and bool(openai_m),
                detail=(
                    f"edge-present={bool(edge)}, ollama-present={bool(ollama)}, "
                    f"openai-present={bool(openai_m)}; total models={len(models)}"
                ),
            )

            # ── L-66a: explicit local=true on openai-compatible ──────
            l66a_ok = edge.get("local") is True and "local" in edge
            run.step(
                label="L-66a: edge-model entry has \"local\": true (explicit provider.local)",
                passed=l66a_ok,
                detail=(
                    f"'local' in edge={'local' in edge}, "
                    f"edge.get('local')={edge.get('local')!r}, edge={edge!r}"
                ),
            )

            # ── L-66b: auto-derived local=true on ollama-typed provider
            l66b_ok = "local" in ollama and ollama.get("local") is True
            run.step(
                label="L-66b: ollama-model entry has \"local\": true (auto-derived from type=ollama)",
                passed=l66b_ok,
                detail=(
                    f"'local' in ollama={'local' in ollama}, "
                    f"ollama.get('local')={ollama.get('local')!r}, ollama={ollama!r}"
                ),
            )

            # ── L-66c: omit-when-undeclared on openai-compatible ──────
            # The key must NOT appear at all — not present-and-false, not present-and-null.
            l66c_ok = "local" not in openai_m
            run.step(
                label="L-66c: openai-model entry OMITS \"local\" (key absent, not false/null)",
                passed=l66c_ok,
                detail=(
                    f"'local' in openai-model={'local' in openai_m}, "
                    f"openai-model.get('local')={openai_m.get('local')!r}, "
                    f"openai-model={openai_m!r}"
                ),
            )

            # ── L-66d: behavioral non-influence regression guard ─────
            # Use a small, deterministic-ish prompt for both calls.
            prompt = [{"role": "user", "content": "Reply with just the word OK."}]

            ra = client.call_tool(
                "call_model",
                resolver="model",
                name="paid-A-model",
                messages=prompt,
            )
            rb = client.call_tool(
                "call_model",
                resolver="model",
                name="paid-B-model",
                messages=prompt,
            )

            paid_a_ok = bool(ra and ra.ok)
            paid_b_ok = bool(rb and rb.ok)

            cost_a = None
            cost_b = None
            tokens_a = None
            tokens_b = None
            try:
                if paid_a_ok:
                    env_a = json.loads(ra.text)
                    meta_a = env_a.get("metadata", {}) if isinstance(env_a, dict) else {}
                    cost_a = meta_a.get("cost_usd")
                    tokens_a = meta_a.get("tokens")
            except (json.JSONDecodeError, TypeError):
                paid_a_ok = False
            try:
                if paid_b_ok:
                    env_b = json.loads(rb.text)
                    meta_b = env_b.get("metadata", {}) if isinstance(env_b, dict) else {}
                    cost_b = meta_b.get("cost_usd")
                    tokens_b = meta_b.get("tokens")
            except (json.JSONDecodeError, TypeError):
                paid_b_ok = False

            # Both calls must succeed.
            run.step(
                label="L-66d: both paid-A (local=true) and paid-B (no local) call_model invocations succeed",
                passed=paid_a_ok and paid_b_ok,
                detail=(
                    f"paid-A ok={paid_a_ok}, paid-B ok={paid_b_ok}; "
                    f"paid-A.text[:200]={str(ra.text if ra else '')[:200]!r}, "
                    f"paid-B.text[:200]={str(rb.text if rb else '')[:200]!r}"
                ),
            )

            if not (paid_a_ok and paid_b_ok):
                # Critical regression guard skipped if either call failed.
                run.step(
                    label="L-66d: cost_usd is computed for paid-A despite local=true (no zero-cost shortcut)",
                    passed=False,
                    detail="skipped — one or both call_model invocations failed",
                )
                return run

            # The most important regression check: paid-A (local=true) MUST still
            # report a positive cost_usd. A zero or null here means the local flag
            # is shorting cost computation.
            cost_a_is_num = isinstance(cost_a, (int, float)) and not isinstance(cost_a, bool)
            cost_b_is_num = isinstance(cost_b, (int, float)) and not isinstance(cost_b, bool)
            cost_a_positive = cost_a_is_num and float(cost_a) > 0
            cost_b_positive = cost_b_is_num and float(cost_b) > 0

            # Sanity bound — small prompt should yield very small but positive cost.
            cost_a_in_range = cost_a_is_num and 0 < float(cost_a) < 1e-3
            cost_b_in_range = cost_b_is_num and 0 < float(cost_b) < 1e-3

            l66d_checks = {
                "paid-A cost_usd is a number": cost_a_is_num,
                "paid-B cost_usd is a number": cost_b_is_num,
                "paid-A cost_usd > 0 (no zero-cost shortcut for local=true)": cost_a_positive,
                "paid-B cost_usd > 0": cost_b_positive,
                "paid-A cost_usd within small-prompt bound (0 < c < 1e-3)": cost_a_in_range,
                "paid-B cost_usd within small-prompt bound (0 < c < 1e-3)": cost_b_in_range,
            }

            run.step(
                label="L-66d: provider.local does NOT affect cost_usd computation (regression guard)",
                passed=all(l66d_checks.values()),
                detail=(
                    f"checks={l66d_checks}; "
                    f"paid-A cost_usd={cost_a!r}, tokens={tokens_a!r}; "
                    f"paid-B cost_usd={cost_b!r}, tokens={tokens_b!r}"
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
    parser.add_argument("--vault-path", default=None)
    args = parser.parse_args()
    run = run_test(args)
    for line in run.summary_lines():
        print(line, file=sys.stderr)
    return run.exit_code


if __name__ == "__main__":
    sys.exit(main())
