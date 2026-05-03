#!/usr/bin/env python3
"""
Test: discovery optional fields — omit-when-undeclared, preserve-declared-empty,
free-form capabilities taxonomy.
Coverage: L-39i, L-39j, L-39k, L-39l, L-39m, L-39n, L-39o
Modes: --managed
Usage: python test_discovery_optional_fields.py --managed
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

TEST_NAME = "test_discovery_optional_fields"
COVERAGE = ["L-39i", "L-39j", "L-39k", "L-39l", "L-39m", "L-39n", "L-39o"]

# Models exercise every variant of the omit/preserve rules.
LLM_OPTIONAL_VARIANTS = {
    "llm": {
        "providers": [{
            "name": "openai", "type": "openai-compatible",
            "endpoint": "https://api.openai.com",
        }],
        "models": [
            # All optional fields declared
            {
                "name": "with-tools",
                "provider_name": "openai",
                "model": "gpt-4o-mini",
                "type": "language",
                "cost_per_million": {"input": 0.15, "output": 0.6},
                "description": "Has tools and vision",
                "context_window": 131072,
                "capabilities": ["tools", "vision"],
            },
            # Declared-empty capabilities; no other optional fields
            {
                "name": "empty-caps",
                "provider_name": "openai",
                "model": "gpt-4o-mini",
                "type": "language",
                "cost_per_million": {"input": 0.15, "output": 0.6},
                "capabilities": [],
            },
            # No optional fields at all (omit-when-undeclared baseline)
            {
                "name": "bare",
                "provider_name": "openai",
                "model": "gpt-4o-mini",
                "type": "language",
                "cost_per_million": {"input": 0.15, "output": 0.6},
            },
            # Custom (non-conventional) capability strings
            {
                "name": "custom-caps",
                "provider_name": "openai",
                "model": "gpt-4o-mini",
                "type": "language",
                "cost_per_million": {"input": 0.15, "output": 0.6},
                "capabilities": ["custom_feature_x", "experimental_y"],
            },
        ],
        "purposes": [],
    }
}


def _list_models_body(client: FQCClient):
    r = client.call_tool("call_model", resolver="list_models")
    if not r.ok:
        return None, f"isError. text={r.text[:200]}"
    try:
        return json.loads(r.text), ""
    except Exception as e:
        return None, f"JSON parse error: {e}"


def _find(models, name):
    return next((m for m in models if m.get("name") == name), None)


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    env = _load_env_file(project_dir) if project_dir else {}
    if "OPENAI_API_KEY" not in os.environ:
        os.environ["OPENAI_API_KEY"] = env.get("OPENAI_API_KEY") or "sk-test-placeholder"

    try:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=LLM_OPTIONAL_VARIANTS) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            body, err = _list_models_body(client)
            if body is None:
                run.step(label="Setup: list_models", passed=False, detail=err)
                return run
            models = body.get("models", [])

            with_tools = _find(models, "with-tools") or {}
            empty_caps = _find(models, "empty-caps") or {}
            bare = _find(models, "bare") or {}
            custom = _find(models, "custom-caps") or {}

            # L-39i: ["tools", "vision"] verbatim
            ok = with_tools.get("capabilities") == ["tools", "vision"]
            run.step(label="L-39i: declared capabilities returned verbatim",
                     passed=ok, detail=f"with-tools={with_tools!r}")

            # L-39j: capabilities: [] preserved (NOT omitted)
            ok = "capabilities" in empty_caps and empty_caps.get("capabilities") == []
            run.step(label="L-39j: declared-empty capabilities preserved",
                     passed=ok, detail=f"empty-caps={empty_caps!r}")

            # L-39k: bare model OMITS capabilities, context_window, description
            ok = (
                "capabilities" not in bare
                and "context_window" not in bare
                and "description" not in bare
            )
            run.step(label="L-39k: undeclared optional fields OMITTED",
                     passed=ok, detail=f"bare={bare!r}")

            # L-39l: context_window present + value preserved on with-tools
            ok = with_tools.get("context_window") == 131072 and "context_window" not in bare
            run.step(label="L-39l: context_window value preserved; absent when undeclared",
                     passed=ok, detail=f"with-tools.cw={with_tools.get('context_window')}, bare cw absent={'context_window' not in bare}")

            # L-39m: custom (non-conventional) capability strings pass through
            ok = custom.get("capabilities") == ["custom_feature_x", "experimental_y"]
            run.step(label="L-39m: custom capability strings pass through verbatim",
                     passed=ok, detail=f"custom={custom!r}")

            # L-39n: description present on with-tools; omitted on bare
            ok = with_tools.get("description") == "Has tools and vision" and "description" not in bare
            run.step(label="L-39n: description present when declared, omitted when not",
                     passed=ok, detail=f"with-tools.desc={with_tools.get('description')}, bare desc absent={'description' not in bare}")

            # L-39o: search results entries follow same omit-when-undeclared rule
            r = client.call_tool("call_model", resolver="search",
                                  parameters={"query": "bare"})
            search_body = json.loads(r.text) if r.ok else {}
            search_models = (search_body.get("results") or {}).get("models", [])
            search_bare = _find(search_models, "bare") or {}
            ok = (
                bool(search_bare)
                and "capabilities" not in search_bare
                and "context_window" not in search_bare
                and "description" not in search_bare
            )
            run.step(label="L-39o: search response entries also OMIT undeclared optional fields",
                     passed=ok, detail=f"search bare={search_bare!r}")

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
