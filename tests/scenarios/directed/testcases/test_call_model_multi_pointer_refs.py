#!/usr/bin/env python3
"""
Test: call_model with multiple pointer-deref refs and repeated placeholders.
Coverage: L-59, L-60
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_call_model_multi_pointer_refs.py --managed
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
import uuid as _uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestRun, FQCServer  # noqa: E402
from fqc_client import FQCClient, _find_project_dir, _load_env_file  # noqa: E402

TEST_NAME = "test_call_model_multi_pointer_refs"
COVERAGE = ["L-59", "L-60"]

CONFIGURED_LLM = {
    "llm": {
        "providers": [{
            "name": "openai",
            "type": "openai-compatible",
            "endpoint": "https://api.openai.com",
            "api_key": "${OPENAI_API_KEY}",
        }],
        "models": [{
            "name": "fast",
            "provider_name": "openai",
            "model": "gpt-4o-mini",
            "type": "language",
            "cost_per_million": {"input": 0.15, "output": 0.6},
        }],
        "purposes": [],
    }
}


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    env_vars = _load_env_file(project_dir) if project_dir else {}
    if "OPENAI_API_KEY" not in os.environ:
        os.environ["OPENAI_API_KEY"] = env_vars.get("OPENAI_API_KEY") or "sk-test-placeholder"

    try:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=CONFIGURED_LLM) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            run_id = _uuid.uuid4().hex[:8]

            # ── Setup L-59: two distinct targets + one source with TWO pointers ──
            target_summary_path = f"_test/{TEST_NAME}_{run_id}/target_summary.md"
            target_summary_body = "summary content for L-59"
            create_summary = client.call_tool(
                "create_document",
                title=f"{TEST_NAME} target_summary {run_id}",
                path=target_summary_path,
                content=target_summary_body,
            )
            if not create_summary.ok:
                run.step(label="Setup: target_summary", passed=False,
                         detail=create_summary.error or create_summary.text[:200])
                return run

            target_action_path = f"_test/{TEST_NAME}_{run_id}/target_action.md"
            target_action_body = "action items content for L-59"
            create_action = client.call_tool(
                "create_document",
                title=f"{TEST_NAME} target_action {run_id}",
                path=target_action_path,
                content=target_action_body,
            )
            if not create_action.ok:
                run.step(label="Setup: target_action", passed=False,
                         detail=create_action.error or create_action.text[:200])
                return run

            # Source doc with both pointers in frontmatter — written raw so we
            # control the fq_id and ensure the projections.* keys are present
            # exactly as the test references them.
            multi_source_path = f"_test/{TEST_NAME}_{run_id}/source_multi.md"
            multi_source_fq_id = str(_uuid.uuid4())
            p_multi = server.vault_path / multi_source_path
            p_multi.parent.mkdir(parents=True, exist_ok=True)
            p_multi.write_text(
                f"---\n"
                f"fq_id: {multi_source_fq_id}\n"
                f"projections:\n"
                f"  summary: \"{target_summary_path}\"\n"
                f"  action_items: \"{target_action_path}\"\n"
                f"---\n\n"
                f"multi-pointer source\n"
            )

            # ── Setup L-60: one target + one source with single pointer ────
            l60_target_path = f"_test/{TEST_NAME}_{run_id}/l60_target.md"
            l60_target_body = "L-60 target body"
            create_l60_target = client.call_tool(
                "create_document",
                title=f"{TEST_NAME} l60_target {run_id}",
                path=l60_target_path,
                content=l60_target_body,
            )
            if not create_l60_target.ok:
                run.step(label="Setup: l60_target", passed=False,
                         detail=create_l60_target.error or create_l60_target.text[:200])
                return run

            l60_source_path = f"_test/{TEST_NAME}_{run_id}/l60_source.md"
            l60_source_fq_id = str(_uuid.uuid4())
            p_l60 = server.vault_path / l60_source_path
            p_l60.parent.mkdir(parents=True, exist_ok=True)
            p_l60.write_text(
                f"---\n"
                f"fq_id: {l60_source_fq_id}\n"
                f"ptr: \"{l60_target_path}\"\n"
                f"---\n\n"
                f"L-60 source\n"
            )

            # Trigger scan once for both raw-written source files.
            client.call_tool("force_file_scan", background=False)

            # ── Step L-59: two pointer refs against same source, different paths ──
            r = client.call_tool(
                "call_model",
                resolver="model",
                name="fast",
                messages=[
                    {"role": "system",
                     "content": f"{{{{ref:{multi_source_path}->projections.summary}}}}"},
                    {"role": "user",
                     "content": (
                         f"{{{{ref:{multi_source_path}->projections.action_items}}}}"
                         f" Reply OK."
                     )},
                ],
            )
            resp = json.loads(r.text) if r.ok else {}
            metadata = resp.get("metadata", {}) if isinstance(resp, dict) else {}
            injected = metadata.get("injected_references", [])
            resolved_to_values = [e.get("resolved_to") or "" for e in injected] if injected else []
            both_targets_present = (
                any(rv.endswith("target_summary.md") for rv in resolved_to_values)
                and any(rv.endswith("target_action.md") for rv in resolved_to_values)
            )
            traversal_order_ok = (
                len(resolved_to_values) == 2
                and resolved_to_values[0].endswith("target_summary.md")
                and resolved_to_values[1].endswith("target_action.md")
            )
            checks = {
                "ok": r.ok,
                "injected has 2 entries":
                    isinstance(injected, list) and len(injected) == 2,
                "both entries have resolved_to":
                    injected and all(e.get("resolved_to") for e in injected),
                "resolved_to values differ":
                    len(resolved_to_values) == 2
                    and resolved_to_values[0] != resolved_to_values[1],
                "both target files appear in resolved_to (any order)":
                    both_targets_present,
            }
            run.step(
                label="L-59: two pointer refs (same source, different paths) both resolved",
                passed=all(checks.values()),
                detail=(
                    f"checks={checks}, resolved_to={resolved_to_values}, "
                    f"document_traversal_order(system_first)={traversal_order_ok}"
                ),
                timing_ms=r.timing_ms,
                tool_result=r,
            )

            # ── Step L-60: identical placeholder repeated across two messages ──
            placeholder = f"{{{{ref:{l60_source_path}->ptr}}}}"
            r = client.call_tool(
                "call_model",
                resolver="model",
                name="fast",
                messages=[
                    {"role": "system", "content": f"context: {placeholder}"},
                    {"role": "user", "content": f"again: {placeholder} Reply OK."},
                ],
            )
            resp = json.loads(r.text) if r.ok else {}
            metadata = resp.get("metadata", {}) if isinstance(resp, dict) else {}
            injected = metadata.get("injected_references", [])
            refs_equal = (
                len(injected) == 2
                and injected[0].get("ref") == injected[1].get("ref")
            )
            resolved_equal = (
                len(injected) == 2
                and injected[0].get("resolved_to") == injected[1].get("resolved_to")
                and bool(injected[0].get("resolved_to"))
            )
            chars_equal = (
                len(injected) == 2
                and injected[0].get("chars") == injected[1].get("chars")
                and isinstance(injected[0].get("chars"), int)
            )
            checks = {
                "ok": r.ok,
                "injected has 2 entries (NOT deduplicated)":
                    isinstance(injected, list) and len(injected) == 2,
                "both entries share the same .ref": refs_equal,
                "both entries share the same .resolved_to": resolved_equal,
                "both entries share the same .chars": chars_equal,
            }
            run.step(
                label="L-60: identical placeholder repeated produces 2 entries (no dedup)",
                passed=all(checks.values()),
                detail=(
                    f"checks={checks}, count={len(injected)}, "
                    f"refs={[e.get('ref') for e in injected]}, "
                    f"resolved_to={[e.get('resolved_to') for e in injected]}, "
                    f"chars={[e.get('chars') for e in injected]}"
                ),
                timing_ms=r.timing_ms,
                tool_result=r,
            )

    except Exception as e:  # noqa: BLE001
        run.step(label="Test crashed", passed=False, detail=f"exception: {type(e).__name__}: {e}")

    return run


def main() -> int:
    parser = argparse.ArgumentParser(description=TEST_NAME)
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
