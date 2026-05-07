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
import uuid
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestRun, FQCServer  # noqa: E402
from fqc_client import FQCClient, _find_project_dir, _load_env_file  # noqa: E402

TEST_NAME = "test_discovery_resolvers"
COVERAGE = ["L-39f", "L-39g", "L-39h", "L-39h_purposes", "VAL-119"]

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
    "templates": {"default_access": "restrictive"},
    "llm": {
        "providers": [{
            "name": "openai", "type": "openai-compatible",
            "endpoint": "https://api.openai.com",
        }, {
            "name": "fixture", "type": "openai-compatible",
            "endpoint": "http://127.0.0.1:1",
        }],
        "models": [{
            "name": "fast", "provider_name": "openai",
            "model": "gpt-4o-mini", "type": "language",
            "cost_per_million": {"input": 0.15, "output": 0.6},
            "capabilities": {
                "tool_calling": True,
                "usage_on_tool_calls": True,
                "strict_tools": True,
                "parallel_tool_calls": True,
                "structured_outputs_with_tools": True,
            },
        }, {
            "name": "unknown-caps", "provider_name": "fixture",
            "model": "unknown-caps", "type": "language",
            "cost_per_million": {"input": 0, "output": 0},
        }, {
            "name": "unsupported-caps", "provider_name": "fixture",
            "model": "unsupported-caps", "type": "language",
            "cost_per_million": {"input": 0, "output": 0},
            "capabilities": {"tool_calling": False, "usage_on_tool_calls": False},
        }],
        "purposes": [{
            "name": "agentic",
            "description": "Agentic discovery purpose with native and template tools",
            "models": ["fast"],
            "tools": ["get_document"],
            "templates": [
                "Templates/Research Skill.md",
                "Templates/Invalid Namespace.md",
                "Templates/Missing Template.md",
            ],
        }],
    }
}


def _write_doc(vault: Path, rel_path: str, body: str, **frontmatter: object) -> None:
    path = vault / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    fm_lines = [
        f"fq_id: {uuid.uuid4()}",
        "fq_status: active",
        *[f"{key}: {json.dumps(value)}" for key, value in frontmatter.items()],
    ]
    path.write_text("---\n" + "\n".join(fm_lines) + "\n---\n\n" + body)


def _load_json_result(result: Any) -> tuple[dict[str, Any] | None, str | None]:
    try:
        return json.loads(result.text), None
    except Exception as exc:
        return None, f"JSON parse error: {exc}; text={result.text[:500]}"


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


def _diagnostic_states(model: dict[str, Any]) -> dict[str, str]:
    return {
        diag.get("capability"): diag.get("state")
        for diag in model.get("capability_diagnostics", [])
    }


def _check_model_diagnostics(client: FQCClient) -> tuple[bool, str]:
    result = client.call_tool("call_model", resolver="list_models")
    if not result.ok:
        return False, f"isError true. text={result.text[:500]}"
    body, error = _load_json_result(result)
    if error:
        return False, error
    models = {model.get("name"): model for model in body.get("models", [])}
    fast = models.get("fast", {})
    unknown = models.get("unknown-caps", {})
    unsupported = models.get("unsupported-caps", {})
    unknown_states = _diagnostic_states(unknown)
    unsupported_states = _diagnostic_states(unsupported)
    fast_states = _diagnostic_states(fast)
    ok = (
        fast_states.get("tool_calling") == "supported"
        and fast_states.get("usage_on_tool_calls") == "supported"
        and unknown_states.get("tool_calling") == "unknown_declaration"
        and unknown_states.get("usage_on_tool_calls") == "unknown_declaration"
        and unsupported_states.get("tool_calling") == "declared_unsupported"
        and unsupported_states.get("usage_on_tool_calls") == "declared_unsupported"
        and "declare 'capabilities.tool_calling: true|false'" in json.dumps(unknown)
    )
    return ok, json.dumps({
        "fast": fast.get("capability_diagnostics"),
        "unknown": unknown.get("capability_diagnostics"),
        "unsupported": unsupported.get("capability_diagnostics"),
    }, sort_keys=True)


def _check_no_args_list_purposes(client: FQCClient) -> tuple[bool, str]:
    # Phase 4 Gap 9: parallel to _check_no_args_list but for the
    # list_purposes resolver. Call call_model with ONLY resolver — no
    # messages, no name, no parameters — and verify the populated
    # purposes[] is returned (uniformity with list_models).
    r = client.call_tool("call_model", resolver="list_purposes")
    if not r.ok:
        return False, f"isError true. text={r.text[:200]}"
    try:
        body = json.loads(r.text)
    except Exception as e:
        return False, f"JSON parse error: {e}"
    purposes = body.get("purposes")
    ok = isinstance(purposes, list) and len(purposes) >= 1
    return ok, f"body={body!r}"


def _check_purpose_diagnostics(client: FQCClient) -> tuple[bool, str]:
    result = client.call_tool("call_model", resolver="list_purposes")
    if not result.ok:
        return False, f"isError true. text={result.text[:500]}"
    body, error = _load_json_result(result)
    if error:
        return False, error
    purpose = next((p for p in body.get("purposes", []) if p.get("name") == "agentic"), {})
    native_diagnostics = purpose.get("native_tool_diagnostics", {})
    template_tools = purpose.get("template_tools", [])
    template_warnings = purpose.get("template_tool_warnings", [])
    conflicts = purpose.get("template_tool_conflicts")
    dangling = purpose.get("dangling_template_paths", [])
    ok = (
        "get_document" in purpose.get("native_tools", [])
        and "get_document" in native_diagnostics.get("explicit_tools", [])
        and isinstance(native_diagnostics.get("expanded_tiers"), list)
        and any(
            tool.get("name") == "flashquery_skill_research_skill"
            and tool.get("template_path") == "Templates/Research Skill.md"
            and "parameters" in tool
            for tool in template_tools
        )
        and any(
            warning.get("template_path") == "Templates/Invalid Namespace.md"
            and warning.get("code") == "invalid_namespace"
            for warning in template_warnings
        )
        and conflicts == []
        and any(item.get("template_path") == "Templates/Missing Template.md" for item in dangling)
    )
    return ok, json.dumps({"purpose": purpose}, sort_keys=True)[:3000]


def _check_search_hits(client: FQCClient) -> tuple[bool, str]:
    expectations = {
        "tool_calling": "models",
        "usage_on_tool_calls": "models",
        "template_tools": "purposes",
        "template_tool_conflicts": "purposes",
        "dangling_template_paths": "purposes",
        "help": "models_or_purposes",
    }
    details: dict[str, Any] = {}
    for query, expected_bucket in expectations.items():
        result = client.call_tool("call_model", resolver="search", parameters={"query": query})
        if not result.ok:
            return False, f"query={query!r} isError true. text={result.text[:500]}"
        body, error = _load_json_result(result)
        if error:
            return False, f"query={query!r} {error}"
        results = body.get("results", {})
        model_hits = results.get("models", [])
        purpose_hits = results.get("purposes", [])
        details[query] = {
            "models": [item.get("name") for item in model_hits],
            "purposes": [item.get("name") for item in purpose_hits],
        }
        if expected_bucket == "models" and not model_hits:
            return False, json.dumps(details, sort_keys=True)
        if expected_bucket == "purposes" and not purpose_hits:
            return False, json.dumps(details, sort_keys=True)
        if expected_bucket == "models_or_purposes" and not (model_hits or purpose_hits):
            return False, json.dumps(details, sort_keys=True)
    return True, json.dumps(details, sort_keys=True)


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
            _write_doc(
                server.vault_path,
                "Templates/Research Skill.md",
                "Research {{topic}}",
                fq_template=True,
                fq_expose_as_tool=True,
                fq_namespace="skill",
                fq_desc="Research skill",
                fq_params={"topic": {"type": "string", "required": True}},
            )
            _write_doc(
                server.vault_path,
                "Templates/Invalid Namespace.md",
                "Invalid namespace body",
                fq_template=True,
                fq_expose_as_tool=True,
                fq_namespace="Skill",
                fq_desc="Invalid namespace fixture",
            )
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            ok, detail = _check_no_args_list(client)
            run.step(label="L-39h: no-args list_models returns populated list",
                     passed=ok, detail=detail)

            ok, detail = _check_model_diagnostics(client)
            run.step(
                label="VAL-119: list_models exposes capability_diagnostics with supported, unknown_declaration, and declared_unsupported states",
                passed=ok,
                detail=detail,
            )

            # Phase 4 Gap 9: parallel coverage for list_purposes — same
            # populated config, but invoke the list_purposes resolver with
            # no args. The spec requires uniformity across resolvers; without
            # this parallel a regression that handled no-args correctly for
            # list_models but not list_purposes would not be caught.
            ok, detail = _check_no_args_list_purposes(client)
            run.step(label="L-39h_purposes: no-args list_purposes returns populated list (Phase 4 Gap 9)",
                     passed=ok, detail=detail)

            ok, detail = _check_purpose_diagnostics(client)
            run.step(
                label="VAL-119: list_purposes exposes native_tools, native_tool_diagnostics, template diagnostics, conflicts, and dangling paths",
                passed=ok,
                detail=detail,
            )

            ok, detail = _check_search_hits(client)
            run.step(
                label="VAL-119: search resolver matches tool_calling, usage_on_tool_calls, template diagnostics, dangling paths, and help metadata",
                passed=ok,
                detail=detail,
            )

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
