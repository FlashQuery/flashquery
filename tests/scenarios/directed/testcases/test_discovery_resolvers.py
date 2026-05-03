#!/usr/bin/env python3
"""
Test: discovery resolver positive scenarios (configured-but-empty + no-args).
Coverage: L-39f, L-39g, L-39h
Modes: --managed
Usage: python test_discovery_resolvers.py --managed
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

TEST_NAME = "test_discovery_resolvers"
COVERAGE = ["L-39f", "L-39g", "L-39h"]

EMPTY_MODELS_LLM = {
    "llm": {
        "providers": [{
            "name": "openai", "type": "openai-compatible",
            "endpoint": "https://api.openai.com",
        }],
        "models": [],
        "purposes": [],
    }
}

EMPTY_PURPOSES_LLM = {
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
        "purposes": [],
    }
}

POPULATED_LLM = {
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


def _check_models_empty(client: FQCClient) -> tuple[bool, str]:
    r = client.call_tool("call_model", resolver="list_models")
    if not r.ok:
        return False, f"isError true; expected success. text={r.text[:200]}"
    try:
        body = json.loads(r.text)
    except Exception as e:
        return False, f"JSON parse error: {e}"
    ok = body.get("models") == []
    return ok, f"body={body!r}"


def _check_purposes_empty(client: FQCClient) -> tuple[bool, str]:
    r = client.call_tool("call_model", resolver="list_purposes")
    if not r.ok:
        return False, f"isError true; expected success. text={r.text[:200]}"
    try:
        body = json.loads(r.text)
    except Exception as e:
        return False, f"JSON parse error: {e}"
    ok = body.get("purposes") == []
    return ok, f"body={body!r}"


def _check_no_args_list(client: FQCClient) -> tuple[bool, str]:
    # call_model with ONLY resolver — no messages, no name, no parameters
    r = client.call_tool("call_model", resolver="list_models")
    if not r.ok:
        return False, f"isError true. text={r.text[:200]}"
    try:
        body = json.loads(r.text)
    except Exception as e:
        return False, f"JSON parse error: {e}"
    ok = isinstance(body.get("models"), list) and len(body["models"]) >= 1
    return ok, f"body={body!r}"


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    env = _load_env_file(project_dir) if project_dir else {}
    if "OPENAI_API_KEY" not in os.environ:
        os.environ["OPENAI_API_KEY"] = env.get("OPENAI_API_KEY") or "sk-test-placeholder"

    try:
        # L-39f: empty models[] returns {models: []} (configured-but-empty)
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=EMPTY_MODELS_LLM) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            ok, detail = _check_models_empty(client)
            run.step(label="L-39f: configured-but-empty models[] returns {models: []}",
                     passed=ok, detail=detail)

        # L-39g: empty purposes[] returns {purposes: []}
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=EMPTY_PURPOSES_LLM) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            ok, detail = _check_purposes_empty(client)
            run.step(label="L-39g: configured-but-empty purposes[] returns {purposes: []}",
                     passed=ok, detail=detail)

        # L-39h: no-args call to list_models returns the populated list
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=POPULATED_LLM) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            ok, detail = _check_no_args_list(client)
            run.step(label="L-39h: no-args list_models returns populated list",
                     passed=ok, detail=detail)

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
