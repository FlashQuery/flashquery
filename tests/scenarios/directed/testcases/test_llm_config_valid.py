#!/usr/bin/env python3
"""
Test: LLM three-layer config valid startup — DB tables populated (L-01).

Scenario:
    1. Start FQC with a valid three-layer llm: config injected via extra_config
    2. Verify startup succeeds (server ready)
    3. Query Supabase and verify fqc_llm_providers has 1 row with name='openai', source='yaml'
    4. Verify fqc_llm_models has 1 row with name='gpt-4o', source='yaml', provider_name='openai',
       cost_per_million_input=2.5, cost_per_million_output=10
    5. Verify fqc_llm_purposes has 1 row with name='default', source='yaml'
    6. Verify fqc_llm_purpose_models has 1 row with purpose_name='default', model_name='gpt-4o', position=1
    7. Verify api_key_ref column stores the literal '${OPENAI_API_KEY}' reference, not the resolved value

Coverage: L-01 (DB-01, DB-02, CONF-07, COST-01 DDL)

Modes:
    --managed   Required (starts dedicated FQC subprocess)

Usage:
    python test_llm_config_valid.py --managed

Exit codes:
    0   PASS
    2   FAIL
    3   DIRTY
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestContext, TestRun, FQCServer  # noqa: E402
from fqc_client import _find_project_dir, _load_env_file  # noqa: E402

TEST_NAME = "test_llm_config_valid"
COVERAGE = ["L-01"]


VALID_LLM_CONFIG = {
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
                "name": "gpt-4o",
                "provider_name": "openai",
                "model": "gpt-4o",
                "type": "language",
                "cost_per_million": {"input": 2.5, "output": 10.0},
            },
        ],
        "purposes": [
            {
                "name": "default",
                "description": "General",
                "models": ["gpt-4o"],
            },
        ],
    }
}


def _query_supabase(env: dict, instance_id: str, table: str, filters: dict) -> list:
    """Query a Supabase table via the REST API using the service role key.

    Uses the requests library (already a scenario framework dependency).
    Returns the parsed JSON list.
    """
    import requests as _requests
    import urllib.parse

    base = env["SUPABASE_URL"].rstrip("/")
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    params: dict = {"instance_id": f"eq.{instance_id}", "select": "*"}
    for k, v in filters.items():
        params[k] = f"eq.{v}"
    url = f"{base}/rest/v1/{table}"
    resp = _requests.get(
        url,
        params=params,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()



def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    env = _load_env_file(project_dir) if project_dir else {}

    # OPENAI_API_KEY must be present in the subprocess environment so the server
    # can resolve ${OPENAI_API_KEY} to an actual value at runtime (used for LLM
    # calls in Phase 99+). Without it, expandEnvVars leaves the literal
    # '${OPENAI_API_KEY}' in place, which is valid for startup but useless for
    # actual LLM calls. Set a placeholder if absent so the test is self-contained.
    if "OPENAI_API_KEY" not in os.environ:
        os.environ["OPENAI_API_KEY"] = env.get("OPENAI_API_KEY") or "sk-test-placeholder-not-used-in-phase-98"

    try:
        with FQCServer(
            fqc_dir=args.fqc_dir,
            extra_config=VALID_LLM_CONFIG,
        ) as server:
            run.step(label="server starts with valid llm: config", passed=True, detail=f"port={server.port}")

            instance_id = server.instance_id

            # Verify provider row.
            providers = _query_supabase(env, instance_id, "fqc_llm_providers", {"name": "openai"})
            run.step(
                label="fqc_llm_providers contains openai with source=yaml",
                passed=len(providers) == 1 and providers[0].get("source") == "yaml",
                detail=str(providers),
            )
            run.step(
                label="api_key_ref stores ${OPENAI_API_KEY} literal (not resolved value)",
                passed=len(providers) == 1 and providers[0].get("api_key_ref") == "${OPENAI_API_KEY}",
                detail=f"api_key_ref={providers[0].get('api_key_ref') if providers else 'MISSING'}",
            )

            # Verify model row.
            models = _query_supabase(env, instance_id, "fqc_llm_models", {"name": "gpt-4o"})
            run.step(
                label="fqc_llm_models contains gpt-4o with provider_name=openai, source=yaml",
                passed=(
                    len(models) == 1
                    and models[0].get("provider_name") == "openai"
                    and models[0].get("source") == "yaml"
                    and float(models[0].get("cost_per_million_input", 0)) == 2.5
                    and float(models[0].get("cost_per_million_output", 0)) == 10.0
                ),
                detail=str(models),
            )

            # Verify purpose row.
            purposes = _query_supabase(env, instance_id, "fqc_llm_purposes", {"name": "default"})
            run.step(
                label="fqc_llm_purposes contains default with source=yaml",
                passed=len(purposes) == 1 and purposes[0].get("source") == "yaml",
                detail=str(purposes),
            )

            # Verify purpose_models row with 1-indexed position.
            purpose_models = _query_supabase(
                env, instance_id, "fqc_llm_purpose_models", {"purpose_name": "default", "model_name": "gpt-4o"}
            )
            run.step(
                label="fqc_llm_purpose_models contains (default, gpt-4o, position=1)",
                passed=len(purpose_models) == 1 and int(purpose_models[0].get("position", 0)) == 1,
                detail=str(purpose_models),
            )

            # Verify ready-banner LLM line appeared.
            logs = "\n".join(server.captured_logs)
            run.step(
                label="ready banner shows '1 provider(s), 1 purpose(s)'",
                passed="1 provider(s), 1 purpose(s)" in logs,
                detail=logs[-500:] if logs else "no logs captured",
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
