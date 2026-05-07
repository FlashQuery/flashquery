#!/usr/bin/env python3
"""
ATL-DS-15: call_model resolver="help" returns raw public help JSON.

Modes:
    --managed   Required
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_client import FQCClient, _find_project_dir, _load_env_file  # noqa: E402
from fqc_test_utils import FQCServer, TestRun  # noqa: E402

TEST_NAME = "test_call_model_help_resolver"
COVERAGE = ["ATL-DS-15", "VAL-119"]

HELP_LLM_CONFIG = {
    "llm": {
        "providers": [{
            "name": "openai",
            "type": "openai-compatible",
            "endpoint": "https://api.openai.com",
        }],
        "models": [{
            "name": "fast",
            "provider_name": "openai",
            "model": "gpt-4o-mini",
            "type": "language",
            "cost_per_million": {"input": 0.15, "output": 0.6},
            "capabilities": {"tool_calling": True, "usage_on_tool_calls": True},
        }],
        "purposes": [{"name": "general", "description": "General", "models": ["fast"]}],
    }
}

EXPECTED_KEYS = [
    "summary",
    "reference_syntax",
    "template_bindings",
    "modes",
    "envelope",
    "errors",
    "discovery",
    "examples",
]

EXPECTED_RESOLVERS = ["model", "purpose", "list_models", "list_purposes", "search", "help"]


def _check_help(client: FQCClient) -> tuple[bool, str]:
    result = client.call_tool(
        "call_model",
        resolver="help",
        name="ignored",
        return_messages=True,
        messages=[{"role": "user", "content": "{{ref:Docs/private.md}}"}],
    )
    if not result.ok:
        return False, f"resolver help returned isError; text={result.text[:500]}"
    try:
        body = json.loads(result.text)
    except Exception as exc:
        return False, f"JSON parse error: {exc}; text={result.text[:500]}"

    # ATL-DS-15: Help is raw JSON and not a CallModelEnvelope: no model
    # response, metadata, usage, or returned messages should appear even when
    # return_messages is set.
    forbidden_envelope_keys = ["response", "metadata", "usage", "messages"]
    reference_forms = body.get("reference_syntax", {}).get("forms", [])
    template_fields = body.get("template_bindings", {}).get("template_params", {}).get("alias_fields", {})
    mode_1 = body.get("modes", {}).get("mode_1", {})
    mode_2 = body.get("modes", {}).get("mode_2", {})
    discovery = body.get("discovery", {})
    examples = body.get("examples", {})
    ok = (
        list(body.keys()) == EXPECTED_KEYS
        and body.get("discovery", {}).get("resolvers") == EXPECTED_RESOLVERS
        and any("{{ref:path/to/doc.md}}" == form.get("syntax") for form in reference_forms)
        and any("{{ref:path/to/doc.md#Section}}" == form.get("syntax") for form in reference_forms)
        and any("{{ref:path/to/doc.md->frontmatter.path}}" == form.get("syntax") for form in reference_forms)
        and any("{{ref:@alias}}" == form.get("syntax") for form in reference_forms)
        and template_fields.get("_template")
        and template_fields.get("_items")
        and mode_1.get("resolver_values") == ["model", "purpose"]
        and mode_1.get("required") == ["name", "messages"]
        and mode_2.get("resolver_value") == "purpose"
        and "purpose.templates" in mode_2.get("enabled_by", [])
        and "max_iterations" in mode_2.get("controls", {})
        and "max_tokens_budget" in mode_2.get("controls", {})
        and "max_cost_usd" in mode_2.get("controls", {})
        and "metadata_tools" in body.get("envelope", {})
        and "reference_resolution_failed" in body.get("errors", {})
        and discovery.get("list_models", {}).get("returns") == ["models", "capability_diagnostics"]
        and "template_tool_conflicts" in discovery.get("list_purposes", {}).get("returns", [])
        and "help" in discovery
        and "direct_model" in examples
        and "parameterized_template" in examples
        and "mode_2_tools" in examples
        and all(key not in body for key in forbidden_envelope_keys)
    )
    detail = json.dumps({
        "keys": list(body.keys()),
        "resolvers": body.get("discovery", {}).get("resolvers"),
        "reference_forms": [form.get("syntax") for form in reference_forms],
        "template_alias_fields": list(template_fields.keys()),
        "mode_1": mode_1,
        "mode_2_controls": mode_2.get("controls", {}),
        "list_purposes_returns": discovery.get("list_purposes", {}).get("returns"),
        "examples": list(examples.keys()),
        "forbidden_present": [key for key in forbidden_envelope_keys if key in body],
    }, sort_keys=True)
    return ok, detail


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    env = _load_env_file(project_dir) if project_dir else {}
    if "OPENAI_API_KEY" not in os.environ:
        os.environ["OPENAI_API_KEY"] = env.get("OPENAI_API_KEY") or "sk-test-placeholder"

    try:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=HELP_LLM_CONFIG, ready_timeout=120) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            ok, detail = _check_help(client)
            run.step(
                "ATL-DS-15 resolver help returns raw JSON without CallModelEnvelope keys",
                ok,
                detail,
            )
    except Exception as exc:
        run.step(label="Test crashed", passed=False, detail=str(exc))

    return run


def main() -> int:
    parser = argparse.ArgumentParser(description=TEST_NAME)
    parser.add_argument("--fqc-dir", default=None)
    parser.add_argument("--managed", action="store_true", required=True)
    args = parser.parse_args()
    run = run_test(args)
    for line in run.summary_lines():
        print(line, file=sys.stderr)
    return run.exit_code


if __name__ == "__main__":
    sys.exit(main())
