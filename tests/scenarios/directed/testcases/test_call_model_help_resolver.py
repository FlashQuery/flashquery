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
import time
import uuid
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


def _flatten_help_errors(errors: dict) -> set[str]:
    values: set[str] = set()
    for value in errors.values():
        if isinstance(value, str):
            values.add(value)
        elif isinstance(value, list):
            values.update(item for item in value if isinstance(item, str))
    return values


def _usage_snapshot(client: FQCClient, trace_id: str) -> tuple[dict | None, str | None]:
    result = client.call_tool("get_llm_usage", mode="summary", period="24h", trace_id=trace_id)
    if not result.ok:
        return None, f"get_llm_usage returned isError; text={result.text[:500]}"
    try:
        return json.loads(result.text), None
    except Exception as exc:
        return None, f"get_llm_usage JSON parse error: {exc}; text={result.text[:500]}"


def _check_help(client: FQCClient, *, expect_configured: bool) -> tuple[bool, str]:
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
    summary = body.get("summary", {})
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
    if expect_configured:
        ok = ok and "FlashQuery LLM is not configured" not in summary.get("purpose", "")
        ok = ok and "configuration_example" not in summary
    else:
        ok = (
            ok
            and summary.get("purpose", "").startswith("FlashQuery LLM is not configured")
            and "llm:" in summary.get("configuration_example", {}).get("yaml", "")
        )
    detail = json.dumps({
        "keys": list(body.keys()),
        "summary": summary,
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


def _check_help_no_usage_delta(client: FQCClient) -> tuple[bool, str]:
    trace_id = f"atl-ds-15-help-{uuid.uuid4().hex}"
    before, before_error = _usage_snapshot(client, trace_id)
    if before_error:
        return False, before_error

    help_result = client.call_tool("call_model", resolver="help", trace_id=trace_id)
    if not help_result.ok:
        return False, f"help returned isError; text={help_result.text[:500]}"
    time.sleep(1)

    after, after_error = _usage_snapshot(client, trace_id)
    if after_error:
        return False, after_error

    ok = (
        isinstance(before, dict)
        and isinstance(after, dict)
        and before.get("total_calls") == after.get("total_calls") == 0
        and before.get("total_spend_usd") == after.get("total_spend_usd") == 0
        and before.get("avg_latency_ms") == after.get("avg_latency_ms") == 0
    )
    return ok, json.dumps({"trace_id": trace_id, "before": before, "after": after}, sort_keys=True)


def _check_help_error_enumeration(client: FQCClient) -> tuple[bool, str]:
    help_result = client.call_tool("call_model", resolver="help")
    if not help_result.ok:
        return False, f"help returned isError; text={help_result.text[:500]}"
    try:
        help_body = json.loads(help_result.text)
    except Exception as exc:
        return False, f"help JSON parse error: {exc}; text={help_result.text[:500]}"

    ghost_ref = f"Missing/help_error_{uuid.uuid4().hex[:8]}.md"
    error_result = client.call_tool(
        "call_model",
        resolver="model",
        name="fast",
        messages=[{"role": "user", "content": f"Please read {{{{ref:{ghost_ref}}}}}."}],
    )
    try:
        error_body = json.loads(error_result.text) if error_result.text else {}
    except Exception as exc:
        return False, f"error JSON parse error: {exc}; text={error_result.text[:500]}"

    help_errors = _flatten_help_errors(help_body.get("errors", {}))
    failed = error_body.get("failed_references", [])
    failed_reasons = {
        item.get("reason")
        for item in failed
        if isinstance(item, dict) and isinstance(item.get("reason"), str)
    }
    ok = (
        not error_result.ok
        and error_body.get("error") in help_errors
        and bool(failed_reasons)
        and failed_reasons.issubset(help_errors)
    )
    return ok, json.dumps({
        "runtime_error": error_body.get("error"),
        "failed_reasons": sorted(failed_reasons),
        "help_errors": sorted(help_errors),
    }, sort_keys=True)


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    env = _load_env_file(project_dir) if project_dir else {}
    if "OPENAI_API_KEY" not in os.environ:
        os.environ["OPENAI_API_KEY"] = env.get("OPENAI_API_KEY") or "sk-test-placeholder"

    try:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=HELP_LLM_CONFIG, ready_timeout=120) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            ok, detail = _check_help(client, expect_configured=True)
            run.step(
                "ATL-DS-15 resolver help returns raw configured JSON without CallModelEnvelope keys",
                ok,
                detail,
            )
            ok, detail = _check_help_no_usage_delta(client)
            run.step(
                "ATL-DS-15 resolver help writes no public usage or trace rows",
                ok,
                detail,
            )
            ok, detail = _check_help_error_enumeration(client)
            run.step(
                "ATL-DS-15 public errors returned by call_model are enumerated by help.errors",
                ok,
                detail,
            )

        with FQCServer(fqc_dir=args.fqc_dir, ready_timeout=120) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            ok, detail = _check_help(client, expect_configured=False)
            run.step(
                "ATL-DS-15 resolver help returns unconfigured summary plus llm.yml snippet",
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
