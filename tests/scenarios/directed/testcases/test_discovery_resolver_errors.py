#!/usr/bin/env python3
"""
Test: discovery resolver negative scenarios + unconfigured-uniformity.
Coverage: L-39, L-39a, L-39b, L-39c, L-39d, L-39e
Modes: --managed
Usage: python test_discovery_resolver_errors.py --managed
Exit codes: 0 PASS, 2 FAIL, 3 DIRTY
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestRun, FQCServer  # noqa: E402
from fqc_client import FQCClient, _find_project_dir, _load_env_file  # noqa: E402

TEST_NAME = "test_discovery_resolver_errors"
COVERAGE = ["L-39", "L-39a", "L-39b", "L-39c", "L-39d", "L-39e"]

CONFIGURED_LLM = {
    "llm": {
        "providers": [{
            "name": "openai", "type": "openai-compatible",
            "endpoint": "https://api.openai.com",
        }],
        "models": [{
            "name": "fast", "provider_name": "openai",
            "model": "gpt-4o-mini", "type": "language",
            "cost_per_million": {"input": 0.15, "output": 0.6},
        }],
        "purposes": [{"name": "general", "description": "General", "models": ["fast"]}],
    }
}

# UNCONFIGURED_LLM intentionally omits the `llm:` key entirely
UNCONFIGURED_LLM: dict = {}


def _is_unconfigured_error(r) -> bool:
    """The Step 1 guard returns isError with text containing 'LLM is not configured'."""
    return (not r.ok) and "not configured" in (r.text or "").lower()


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    env = _load_env_file(project_dir) if project_dir else {}
    if "OPENAI_API_KEY" not in os.environ:
        os.environ["OPENAI_API_KEY"] = env.get("OPENAI_API_KEY") or "sk-test-placeholder"

    try:
        # ── Configured: parameter-validation failures ──────────────────
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=CONFIGURED_LLM) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)

            # L-39: search without parameters.query
            r = client.call_tool("call_model", resolver="search")
            ok = (not r.ok) and ("query" in (r.text or "").lower())
            run.step(label="L-39: search without parameters.query → clear error",
                     passed=ok, detail=f"text={r.text[:200]}", tool_result=r)

            # L-39a: resolver=model without name
            r = client.call_tool("call_model", resolver="model")
            ok = (not r.ok)
            run.step(label="L-39a: resolver=model without name → validation error",
                     passed=ok, detail=f"text={r.text[:200]}", tool_result=r)

            # L-39b: resolver=purpose without name
            r = client.call_tool("call_model", resolver="purpose")
            ok = (not r.ok)
            run.step(label="L-39b: resolver=purpose without name → validation error",
                     passed=ok, detail=f"text={r.text[:200]}", tool_result=r)

        # ── Unconfigured: uniform llm_not_configured across all 3 discovery resolvers ──
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=UNCONFIGURED_LLM) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)

            # L-39c: list_models unconfigured
            r = client.call_tool("call_model", resolver="list_models")
            run.step(label="L-39c: list_models unconfigured → llm_not_configured",
                     passed=_is_unconfigured_error(r),
                     detail=f"text={r.text[:200]}", tool_result=r)

            # L-39d: list_purposes unconfigured
            r = client.call_tool("call_model", resolver="list_purposes")
            run.step(label="L-39d: list_purposes unconfigured → llm_not_configured",
                     passed=_is_unconfigured_error(r),
                     detail=f"text={r.text[:200]}", tool_result=r)

            # L-39e: search unconfigured (guard fires BEFORE param validation)
            r = client.call_tool("call_model", resolver="search")
            run.step(label="L-39e: search unconfigured → llm_not_configured (guard before param validation)",
                     passed=_is_unconfigured_error(r),
                     detail=f"text={r.text[:200]}", tool_result=r)

    except Exception as e:
        run.step(label="Test crashed", passed=False, detail=str(e))

    return run


def main() -> int:
    parser = argparse.ArgumentParser(description=TEST_NAME)
    parser.add_argument("--managed", action="store_true", required=True)
    parser.add_argument("--fqc-dir", default=None)
    parser.add_argument("--vault-path", type=str, default=None)
    args = parser.parse_args()
    run = run_test(args)
    for line in run.summary_lines():
        print(line, file=sys.stderr)
    return run.exit_code


if __name__ == "__main__":
    sys.exit(main())
